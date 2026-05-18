**Status:** reviewing
**Spec date:** 2026-05-18
**Last updated:** 2026-05-18 (spec-reviewer iteration 1 mechanical cleanup)
**Author:** Michael
**Build slug:** closed-loop-skill-improvement

---

## Lifecycle Declaration

| Field | Value |
|---|---|
| Capability cluster | Agent Runtime, Audit & Governance, Approvals |
| Capability owner | ai-agent |
| Lifecycle state on launch | Inception |
| Risk surface | server/db/schema, server/routes, agent runtime, approvals |
| Review cadence | quarterly |

---

## ABCd Lifecycle Estimate

| Dimension | Sizing | Notes |
|---|---|---|
| Acquire | L | No off-the-shelf equivalent at this precision of governance + typed-overlay semantics |
| Build | L | New subsystem: 8 tables, 4 new jobs, resolver rewrite, morning queue UI, 6 sequencing steps |
| Carry | M | Ongoing: amendment stack monitoring, proposer-quality telemetry, quarterly baseline resets |
| decommission | M | Schema tables, resolver branch, UI surfaces, and pg-boss job registrations all need coordinated removal |

---

## Table of Contents

1. [Summary](#1-summary)
2. [Goals](#2-goals)
3. [Non-Goals](#3-non-goals)
4. [Framing Assumptions](#4-framing-assumptions)
5. [Existing Primitives](#5-existing-primitives)
6. [Governance Invariants](#6-governance-invariants)
7. [Data Model](#7-data-model)
   - 7.1 `skill_amendments`
   - 7.2 `skill_regression_cases`
   - 7.3 `peer_reviewer_drops`
   - 7.4 `skill_amendment_effectiveness`
   - 7.5 `amendment_proposer_metrics`
   - 7.6 `amendment_proposer_entropy`
   - 7.7 `skill_amendment_run_snapshot`
   - 7.8 `skill_amendment_freezes`
8. [Resolver Changes](#8-resolver-changes)
9. [New Jobs](#9-new-jobs)
   - 9.1 `failure_post_mortem`
   - 9.2 Regression replay job
   - 9.3 Freshness-window auto-retirement job
   - 9.4 Effectiveness-metrics update job
10. [Modified Jobs](#10-modified-jobs)
    - 10.1 `scorecardJudgeJob`
    - 10.2 `correctionPatternDetectorJob`
11. [New Service — `skillAmendmentService`](#11-new-service)
12. [Routes](#12-routes)
13. [Client Changes](#13-client-changes)
14. [Permissions and RLS Checklist](#14-permissions-and-rls-checklist)
15. [Contracts](#15-contracts)
16. [Execution Model](#16-execution-model)
17. [Phase Sequencing](#17-phase-sequencing)
18. [Execution-Safety Contracts](#18-execution-safety-contracts)
19. [Trust Boundary Diagram](#19-trust-boundary-diagram)
20. [Failure Atomicity Definitions](#20-failure-atomicity-definitions)
21. [Testing Posture](#21-testing-posture)
22. [Deferred Items](#22-deferred-items)
23. [Self-Consistency Pass](#23-self-consistency-pass)
24. [Open Questions](#24-open-questions)

---

## 1. Summary

This spec defines Phase 1 of the closed-loop skill improvement system: a human-gated amendment proposal loop that turns scorecard failures into reviewed, typed behavioural overlays on inherited skills. When a scorecard verdict fails, a new `failure_post_mortem` pg-boss job synthesises a root-cause record, drafts a typed amendment, submits it for peer review (GPT-class via OpenAI), and — if the peer reviewer confirms it addresses the root cause — queues it in the existing morning review surface (Inbox / ReviewQueuePage) for one-click operator approval. Accepted amendments are composed deterministically on top of the inherited skill base without forking it. Rejected amendments become regression test cases. The loop is bounded (5 proposals/skill/week, 20 active/skill lifetime), schema-validated (5 typed amendment kinds with per-kind length ceilings), anti-recursive (evaluator surfaces are resolved through a separate code path that never consults `skill_amendments`), and gated by mandatory human approval.

The framing is: agents propose, humans approve. Nothing in this system activates behaviour autonomously.

---

## 2. Goals

- Introduce the `skill_amendments` table as the typed overlay primitive on top of inherited skills (system-tier and org-tier), without forking.
- Implement the `failure_post_mortem` pg-boss job: root-cause synthesis → schema-validated amendment draft → GPT-class peer review → queue insertion.
- Implement deterministic amendment composition in the skill resolver (`resolveSkillsForAgent`) with ordering, tie-breaking, fail-closed truncation, and `skill_amendment_run_snapshot` for historical replay.
- Deliver the morning queue amendment section (band below existing Needs Review tab content) with accept / edit-and-accept / reject flows, audit attribution, and regression-set tagging on every decision.
- Deliver the inline amendment stack on the SubaccountSkillsPage (expanded row for inherited skills) with retire and rollback-class retire actions.
- Deliver the inline composition panel on the RunTracePage (collapsed by default; shows snapshot and amendments-used tabs per §3.8 of dev brief; see §13.4 for the spec-level surface).
- Deliver the governance freeze switch (§4.9 of dev brief; see §7.8 + §13 in this spec) as a skill-detail admin surface.
- Implement evaluation harness additions: `skill_regression_cases` table, freshness-window auto-retirement (14 days), amendment effectiveness sidecar, proposer-quality telemetry.

---

## 3. Non-Goals

- Upward promotion of subaccount amendments to system tier (requires ring rollout — separate brief).
- Org-scoped amendments that fan out to all subaccounts in one authoring action.
- Autonomous amendment activation without human approval.
- Cross-subaccount pattern detection or learning.
- Prompt mutation / DSPy-style optimisation.
- Automatic semantic conflict reconciliation.
- Shadow-mode simulation of amendments against historical runs before surfacing.
- Amendment portability across skill clone, template, or export paths.
- `learned_failure_mode` memory entry type (deferred to Phase 2 — see §22).
- Auto-retirement of low-value amendments (Phase 2 escalation; §22).
- Surface B: cross-subaccount org-admin roll-up queue (deferred; §22).

---

## 4. Framing Assumptions

- Pre-production, no live external customers (`docs/spec-context.md`: `pre_production: yes`, `rollout_model: commit_and_revert`).
- Scorecard subsystem is operational: `scorecardJudgeJob`, immutable `scorecard_judgements` verdict rows, frozen rubric snapshots.
- Correction-pattern detector job (`correctionPatternDetectorJob.ts`) is operational and runs daily.
- Memory layer with typed entries and decay is operational.
- `getOrgScopedDb` / `withOrgTx` are the mandatory access pattern for all new tenant-scoped tables — no exemption.
- Skill resolution precedence (subaccount > org > system) is unchanged for forked skills; amendments apply only to the inherited-skill resolution path.
- No feature flag needed: data-gated — an empty `skill_amendments` table produces identical resolver output to today.
- The `failure_post_mortem` job runs only on `verdict = 'fail'` rows; `pass` and `inconclusive` verdicts do not trigger it.
- Custom subaccount skills (`skills` table rows where `subaccount_id` is set) are not amendable; they are edited directly.
- OpenAI API is already configured in the environment; GPT-class peer review is a new usage of an existing dependency.

---

## 5. Existing Primitives

Every new primitive below is justified against the existing codebase. Where a primitive is being extended rather than invented, the extension is named.

| Proposing | Existing primitive | Decision |
|---|---|---|
| Amendment overlay on skills | `skills` table (fork-on-customise) | New `skill_amendments` table — reuse is insufficient because forks sever inheritance; overlay is a structurally different primitive |
| Amendment composition at resolution | `resolveSkillsForAgent()` in `server/services/skillService.ts` | Extend — add amendment lookup + composition step after existing precedence resolution |
| Post-failure job | `correctionPatternDetectorJob.ts`, `scorecardJudgeJob.ts` | New `failure_post_mortem` job — distinct responsibility (synthesis + proposal) from detection (clustering) and judging |
| Regression set storage | `bench_runs` / `benchExecuteJob` | New `skill_regression_cases` table — bench_runs models model comparison; regression cases are held-out fail guards; structurally different |
| Amendment CRUD service | `skillService.ts` | New `skillAmendmentService.ts` barrel — amendment semantics (accept/reject/retire/rollback lifecycle) do not belong in the general skill service |
| Peer reviewer API call | `llmRouter.ts` | Direct OpenAI SDK call inside the proposer job — peer review is a one-shot binary verdict, not a routed multi-turn inference; does not need llmRouter's caching/retry/cost-tracking machinery |
| Morning queue UI section | `ReviewQueuePage.tsx`, `NewBriefModal.tsx` sibling pattern | Extend ReviewQueuePage with a new amendment-proposals band; new `AmendmentReviewDrawer.tsx` component under `client/src/components/review-queue/` per the established sibling convention |
| Inline amendment stack on skills page | `SubaccountSkillsPage.tsx` | Extend — new expanded-row panel for inherited skills; follows the existing expanded-row convention |
| Run trace composition panel | `RunTracePage.tsx`, `RunTraceEventRenderer.tsx` | Extend — new event card + collapsed composition detail section; follows the existing event-card pattern |
| Governance freeze | No existing freeze primitive | New `skill_amendment_freezes` table + admin UI section on skill detail page |

---

## 6. Governance Invariants

These invariants bind every implementation decision and are verified in §23. They are taken verbatim from the dev brief and are non-negotiable.

1. **Human approval mandatory.** No amendment activates without an explicit operator accept action. No automated activation, confidence threshold bypass, or silent activation path.
2. **Anti-recursion.** Amendments compose only into agent runtime skill bodies. Scorecard judge prompts, RCA proposer prompts, and peer-review prompts are resolved through a separate code path that never consults `skill_amendments`. Schema validation rejects any `proposed_remedy_body` whose declared target is an evaluator surface.
3. **Amendments are not memory.** Amendments are skill-scoped behaviour overlays; memory is per-entity recall. The two primitives are distinct; code, audit events, and UI copy must not conflate them.
4. **No hidden composition.** Every active amendment affecting runtime behaviour is discoverable from operator-visible surfaces. No invisible runtime-only overlays.
5. **Tenant isolation.** No amendment, RCA record, replay artefact, or proposer context may incorporate behavioural signals from another organisation or subaccount.
6. **Resolver determinism.** The composition step (`composeAmendmentsPure` — see §8.1) is a pure function of: system-skill snapshot, amendment snapshot set, resolver version, and explicit runtime inputs. No wall-clock time, mutable external services, or live model calls inside the composition step. The `resolveSkillsForAgent` entry-point wrapper persists the `skill_amendment_run_snapshot` row as a fire-and-forget side effect AFTER composition returns (§8.1 step 5); this write is outside the pure composition boundary.
7. **Fail-closed truncation.** If composition would exceed 12,000 chars total, the resolver returns the resolved-base body alone (system-tier or org-tier — whichever the precedence step selected) without any amendment overlays, and emits an alert. Silent truncation is forbidden.
8. **Retirement is non-destructive.** Retired amendment rows persist with full provenance; the regression linkage survives retirement.
9. **Operator trust posture.** UI copy uses "Proposed amendment from a failed run" not "Fix found"; "Apply" not "Approve"; "Why this was proposed" not "Why this is correct." Multi-paragraph AI-generated rationales are forbidden in the queue UI.

---

## 7. Data Model

Eight new tables. All tenant-scoped tables use `org_id NOT NULL` and route through `getOrgScopedDb`. All migrations land in sequence; migration numbers are assigned at implementation time (next after the current highest).

### 7.1 `skill_amendments`

Primary table. One row per amendment version.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| system_skill_id | uuid \| null | FK `system_skills.id`. Set when amendment overlays a system-tier inherited skill. |
| org_skill_id | uuid \| null | FK `skills.id` where `org_id` IS NOT NULL AND `subaccount_id` IS NULL. Set when amendment overlays an org-tier skill. |
| org_id | uuid NOT NULL | Tenancy anchor. |
| subaccount_id | uuid \| null | Subaccount scope if set; org scope if null. Phase 1 proposer only writes subaccount-scoped rows. |
| kind | enum NOT NULL | `instruction_extension` \| `example` \| `guardrail` \| `context_fact` \| `exception` |
| body | text NOT NULL | Overlay content. Per-kind length ceiling enforced by CHECK constraint (see below). |
| source | enum NOT NULL | `operator_authored` \| `agent_proposed_from_failure` \| `agent_proposed_from_correction_cluster` (Phase 2 — see §22) \| `promoted_from_subaccount` (Phase 2 ring rollout — see §22) \| `imported_from_fork` \| `migrated_from_system_update` \| `copied_from_org_template` (reserved). The Phase 1 proposer writes only `agent_proposed_from_failure`. |
| status | enum NOT NULL | `draft` \| `pending_review` \| `accepted` \| `rejected` \| `retired` |
| version_number | integer NOT NULL default 1 | Per-amendment versioning. |
| proposer_run_id | uuid \| null | FK `agent_runs.id`. Run whose failure triggered this proposal. |
| scorecard_judgement_id | uuid \| null | FK `scorecard_judgements.id`. Verdict row that fired the post-mortem. |
| rca_record_id | uuid \| null | Provenance UUID (NOT a foreign key). Copied from `rca_json.record_id` at insert time and stored as a flat column to enable cross-table provenance queries without JSONB extraction. Stable identifier for the RCA record embedded in `rca_json`. |
| rca_json | jsonb \| null | Full RCA output: `failure_mode`, `contributing_factors[]`, `proposed_remedy_kind`, `proposed_remedy_body`, `confidence`. Stored inline to keep the provenance chain self-contained. |
| proposer_model_version | text \| null | Model family + version of the proposer (e.g. `claude-opus-4-7`). |
| peer_reviewer_model_version | text \| null | Model family + version of the peer reviewer (e.g. `gpt-4o`). |
| peer_reviewer_verdict | boolean \| null | `true` = addresses root cause; `false` = does not. Null until peer review runs. |
| peer_reviewer_reasoning | text \| null | One-sentence reasoning from peer reviewer. |
| human_reviewer_user_id | uuid \| null | User who accepted / rejected. Null while pending. |
| human_reviewer_role | enum \| null | `subaccount_admin` \| `org_admin` |
| activated_at | timestamptz \| null | Accept timestamp. |
| retired_at | timestamptz \| null | Retirement timestamp. |
| retirement_reason | enum \| null | `graceful` \| `rollback` \| `stale` \| `superseded` \| `baseline_reset` |
| incident_severity | enum \| null | `sev1` \| `sev2`. Set only on rollback-class retirements. |
| superseded_by_amendment_id | uuid \| null | FK to replacement row in edit-as-new-version chains. |
| lineage_root_id | uuid \| null | Denormalised root of the supersession chain (for query efficiency). Set at insert; equals `id` for the root row. |
| originating_correction_cluster_id | uuid \| null | Reserved for Phase 2. FK target — the correction-cluster sidecar table — is deferred to Phase 2 (§22). Always NULL in Phase 1: the Phase 1 proposer is triggered by `scorecard_judgement_id` only, never by cluster ID. The Phase 2 migration that adds the cluster sidecar will also add this FK constraint. |
| reject_reason | enum \| null | `incorrect_root_cause` \| `overfit` \| `unsafe` \| `redundant` \| `low_confidence` \| `duplicate` \| `insufficient_context`. Set only on reject. |
| blast_radius_estimate | enum NOT NULL | `low` \| `medium` \| `high` |
| confidence | numeric(3,2) NOT NULL default 0.00 | Proposer self-reported 0.00–1.00. Advisory only. |
| occurrence_count | integer NOT NULL default 1 | Incremented on dedup match against a pending row. |
| suppressed_duplicate_count | integer NOT NULL default 0 | Incremented on dedup match against an active accepted row. |
| created_at | timestamptz NOT NULL default now() | |
| updated_at | timestamptz NOT NULL default now() | |

**CHECK constraints:**
- `CHECK ((system_skill_id IS NOT NULL) <> (org_skill_id IS NOT NULL))` — exactly one FK set.
- Per-kind body length: `instruction_extension` ≤ 800, `example` ≤ 1500, `guardrail` ≤ 400, `context_fact` ≤ 300, `exception` ≤ 600. Enforced as a CHECK per kind.
- `context_fact` declarative-only: CHECK that rejects bodies containing imperative modals (`must`, `should`, `never`, `always`, `do`, `do not`) — enforced at application layer in `skillAmendmentService` before insert, not DB-level regex (too expensive at insert time; service validation is the primary gate).

**RLS:** `FORCE ROW LEVEL SECURITY`. Policy: `org_id = current_setting('app.organisation_id')::uuid`. All service-layer access via `getOrgScopedDb`.

**RLS_PROTECTED_TABLES entry:** `skill_amendments` — added in the same migration.

### 7.2 `skill_regression_cases`

Holds the regression set per skill. Held out from the proposer; re-run on every amendment acceptance.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| org_id | uuid NOT NULL | Tenancy anchor. |
| subaccount_id | uuid NOT NULL | Regression cases are always subaccount-scoped. |
| system_skill_id | uuid \| null | Mirrors the amendment's FK. |
| org_skill_id | uuid \| null | Mirrors the amendment's FK. |
| scorecard_judgement_id | uuid NOT NULL | The original fail verdict row. |
| amendment_id | uuid \| null | The amendment proposed for this failure. Null if the proposal was dropped before reaching the queue (peer-review drop). |
| tag | enum NOT NULL | `fix_proposed` (amendment accepted) \| `fix_wrong` (amendment rejected) \| `unresolved` (pending or not yet reviewed) |
| created_at | timestamptz NOT NULL default now() | |

**UNIQUE constraint:** `UNIQUE (scorecard_judgement_id) WHERE amendment_id IS NULL` (partial). Backs the idempotency claim in §18.1 for the §9.1 step 10 peer-review-drop path that writes a null-amendment regression case; a job retry after the drop runs will hit `23505` and no-op. Non-null `amendment_id` rows are not subject to this constraint — multiple regression cases can reference the same judgement under different amendments (e.g. a `fix_wrong` from rejected amendment A and a later `fix_proposed` from accepted amendment B for the same original failure).

**RLS:** `FORCE ROW LEVEL SECURITY`. Same org-scoped policy as `skill_amendments`. Entry in `RLS_PROTECTED_TABLES`.

### 7.3 `peer_reviewer_drops`

Shadow telemetry for peer-reviewer false-negative analysis.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| org_id | uuid NOT NULL | |
| scorecard_judgement_id | uuid NOT NULL | |
| proposer_output_json | jsonb NOT NULL | Full RCA output from the proposer. |
| peer_reviewer_reasoning | text NOT NULL | One-sentence reasoning from the peer reviewer. |
| proposer_model_version | text NOT NULL | |
| peer_reviewer_model_version | text NOT NULL | |
| created_at | timestamptz NOT NULL default now() | |

**UNIQUE constraint:** `UNIQUE (scorecard_judgement_id)` — one drop row per failed verdict. Backs the idempotency claim in §18.1: a `failure_post_mortem` retry after a peer-review drop already wrote this row will hit `23505` and treat it as no-op, preventing duplicate drop telemetry.

**RLS:** `FORCE ROW LEVEL SECURITY`. Org-scoped. Entry in `RLS_PROTECTED_TABLES`.

### 7.4 `skill_amendment_effectiveness`

Sidecar metrics per accepted amendment. Written by the regression replay job; updated on each replay.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| amendment_id | uuid NOT NULL | FK `skill_amendments.id`. UNIQUE — one effectiveness row per amendment (supports `ON CONFLICT (amendment_id) DO UPDATE` from §9.4). |
| org_id | uuid NOT NULL | |
| regressions_prevented | integer NOT NULL default 0 | |
| subsequent_fail_rate_delta | numeric(5,4) \| null | Change in pass rate since activation. |
| operator_override_frequency | integer NOT NULL default 0 | |
| inactivity_decay_candidate | boolean NOT NULL default false | Set when no run composed this amendment in 30 days, or zero delta after 60 days. |
| last_replay_judge_version | text \| null | Last regression-replay (§9.2) judge model + version that produced verdicts feeding this row. |
| last_replay_resolver_version | text \| null | Last regression-replay resolver version composed for replays. |
| last_replay_model_version | text \| null | Last regression-replay agent model version replayed (`benchExecuteJob` produced these verdicts). |
| last_replay_at | timestamptz \| null | Timestamp of the last regression replay; updated on every replay run. |
| last_computed_at | timestamptz NOT NULL default now() | |

**UNIQUE constraint:** `UNIQUE (amendment_id)` — one sidecar row per amendment.

**RLS:** Org-scoped. Entry in `RLS_PROTECTED_TABLES`.

### 7.5 `amendment_proposer_metrics`

Per-proposer-model-version quality telemetry. Written on every accept / reject / edit / peer-review-drop.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| proposer_model_version | text NOT NULL | |
| period_start | date NOT NULL | |
| proposal_count | integer NOT NULL default 0 | |
| accept_clean_count | integer NOT NULL default 0 | |
| accept_after_edit_count | integer NOT NULL default 0 | |
| reject_count | integer NOT NULL default 0 | |
| peer_review_drop_count | integer NOT NULL default 0 | |
| regression_failure_after_accept_count | integer NOT NULL default 0 | |
| rollback_count | integer NOT NULL default 0 | |
| created_at | timestamptz NOT NULL default now() | |

**RLS:** No org-scoping — proposer quality metrics are system-wide. Not in `RLS_PROTECTED_TABLES`. Admin-only route guard.

### 7.6 `amendment_proposer_entropy`

Per-skill, per-month diversity metrics.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| system_skill_id | uuid \| null | |
| org_skill_id | uuid \| null | |
| org_id | uuid NOT NULL | |
| period_month | date NOT NULL | First day of month. |
| template_repetition_rate | numeric(5,4) \| null | |
| lexical_diversity | numeric(5,4) \| null | |
| remedy_category_distribution | jsonb \| null | `{kind: count}` map. |
| created_at | timestamptz NOT NULL default now() | |

**RLS:** Org-scoped. Entry in `RLS_PROTECTED_TABLES`.

### 7.7 `skill_amendment_run_snapshot`

Composition snapshot per run for historical replay correctness (§4.8 of dev brief).

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| run_id | uuid NOT NULL | FK `agent_runs.id`. |
| org_id | uuid NOT NULL | |
| system_skill_id | uuid \| null | |
| org_skill_id | uuid \| null | |
| resolver_version | text NOT NULL | Semver of the resolver code at run time. |
| amendment_version_set_hash | text NOT NULL | SHA-256 of the sorted amendment ID + version_number set. |
| composed_body | text NOT NULL | The actual resolved body the agent received. |
| included_amendment_ids | uuid[] NOT NULL | Amendment rows composed in. |
| excluded_amendment_ids | uuid[] NOT NULL | Retired or not-yet-accepted rows explicitly excluded. |
| composed_size_chars | integer NOT NULL | |
| truncated | boolean NOT NULL default false | True if fail-closed truncation fired. |
| created_at | timestamptz NOT NULL default now() | |

**UNIQUE constraint:** `UNIQUE NULLS NOT DISTINCT (run_id, system_skill_id, org_skill_id)` (PostgreSQL 15+). Backs the `ON CONFLICT (run_id, system_skill_id, org_skill_id) DO NOTHING` idempotency claim in §18.2 — at most one snapshot row per (run, skill) pair, regardless of which FK is set.

**RLS:** Org-scoped. Entry in `RLS_PROTECTED_TABLES`.

### 7.8 `skill_amendment_freezes`

Records active and historical freeze events for the governance freeze switch (§4.9 of dev brief). Note: `org_id` is `NOT NULL` on every row — true cross-org "global" freezes would violate the tenant-isolation invariant (§6.5) and are out of scope. Org-wide freezes use `scope = 'org'` with `scope_id = NULL` (the `org_id` column already pins the tenant).

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| org_id | uuid NOT NULL | |
| scope | enum NOT NULL | `skill` \| `subaccount` \| `org` |
| scope_id | uuid \| null | The skill/subaccount ID being frozen. Null for `scope = 'org'` (the `org_id` column already pins the tenant for org-wide freezes). Not null for `scope = 'skill'` or `scope = 'subaccount'`. |
| freeze_type | enum NOT NULL | `proposal_generation` \| `proposal_surfacing` \| `amendment_activation` \| `replay_execution` \| `review_required` |
| reason | text NOT NULL | Required before applying any freeze. |
| created_by_user_id | uuid \| null | Null when system-authored (e.g. `review_required` auto-freezes set by resolver on truncation or by proposer job on lifetime-cap hit; see §8.1 step 4 and §9.1 step 2). Required for operator-authored freezes. |
| thawed_at | timestamptz \| null | Null while active. |
| thawed_by_user_id | uuid \| null | |
| created_at | timestamptz NOT NULL default now() | |

**RLS:** Org-scoped. Entry in `RLS_PROTECTED_TABLES`.

**`review_required` semantics.** The `review_required` freeze type is the concrete primitive for the "review_required state" referenced elsewhere in this spec (§8.1 step 4, §9.1 step 2, §13.1, §17 Step 5). It is created system-authored — not by an operator — when one of two conditions fires:

1. Resolver fail-closed truncation (§8.1 step 4) — composition would exceed 12,000 chars; the resolver writes a `review_required` freeze with `scope = 'skill'`, `reason = 'composition_size_exceeded'`.
2. Lifetime amendment cap hit (§9.1 step 2) — 20 accepted amendments for this (org, subaccount, skill); the proposer job writes a `review_required` freeze with `scope = 'skill'`, `reason = 'lifetime_cap_reached'`.

A `review_required` freeze suppresses new proposals (same effect as `proposal_generation`), surfaces an orange warning badge in the morning queue band, and shows a warning banner on the skill detail page. Operators clear it by thawing the freeze (DELETE route §12).

**File:** `server/services/skillService.ts` — function `resolveSkillsForAgent()` (~line 115).

### 8.1 Amendment composition step

The amendment composition path has two layers:

- **`resolveSkillsForAgent(skillSlugs, ctx)` — impure wrapper** (in `server/services/skillService.ts`). Performs all I/O: precedence resolution, DB query for amendments, DB query for active freezes, snapshot write, freeze-row insert on truncation.
- **`composeAmendmentsPure({ baseRow, amendments, activeFreeze })` — pure function** (in `server/services/skillServicePure.ts`, new file). Takes the already-fetched data; returns `{ composedBody, includedAmendmentIds, excludedAmendmentIds, composedSizeChars, truncated, reviewRequiredReason }`. No DB, no clock, no network.

After the existing precedence resolution (subaccount > org > system picks the base skill row), the wrapper checks whether the resolved skill is inherited (i.e. `system_skill_id` or `org_skill_id` is set — not a custom subaccount skill). If inherited, it runs:

**Wrapper I/O steps (`resolveSkillsForAgent`):**

1. **Fetch amendments.** Query `skill_amendments` WHERE `(system_skill_id = $base OR org_skill_id = $base)` AND `org_id = $org` AND `(subaccount_id IS NULL OR subaccount_id = $subaccount)` AND `status = 'accepted'` — via `getOrgScopedDb`. The `subaccount_id IS NULL` branch matches org-scoped amendments; Phase 1's proposer only writes subaccount-scoped rows, but the resolver is org-scope-ready.
2. **Fetch active freeze.** Query `skill_amendment_freezes` for an active row (`thawed_at IS NULL`) scoped to this skill/subaccount/org with `freeze_type = 'amendment_activation'`. (Other freeze types — `proposal_generation`, `review_required` — are not consulted here; they're for the proposer, not the resolver.)
3. **Call pure step.** Invoke `composeAmendmentsPure({ baseRow, amendments, activeFreeze })`. The pure step applies composition ordering (§3.6 of dev brief — bucket order: org guardrails → org instruction_extensions → org examples → org context_facts → org exceptions → subaccount guardrails → subaccount instruction_extensions → subaccount examples → subaccount context_facts → subaccount exceptions; within a bucket: ascending `activated_at`, then ascending `id` as tiebreak), concatenates base text + amendment bodies, and returns the assembled body plus `truncated` and `reviewRequiredReason` outputs.
4. **Handle pure-step outputs:**
   - If `activeFreeze` was present: pure step returned the resolved-base body alone (without amendment overlays). Return that.
   - If `truncated === true` (total chars > 12,000): wrapper emits `composition.degraded` alert and inserts a `skill_amendment_freezes` row with `freeze_type = 'review_required'`, `scope = 'skill'`, `scope_id = <skill_id>`, `reason = 'composition_size_exceeded'`, `created_by_user_id = NULL` (system-authored). The pure step has already returned the resolved-base body alone; the wrapper does not retry composition. See §7.8 for `review_required` semantics.
5. **Snapshot write (fire-and-forget).** Wrapper writes a `skill_amendment_run_snapshot` row (`ON CONFLICT DO NOTHING` per §18.2) with the resolver version, amendment IDs used/excluded, composed body, and hash. The snapshot write is outside the pure composition boundary (§6.6) — failure to persist the snapshot does not roll back resolution.
6. **Return composed body.**

Custom subaccount skills (where the resolved row has `subaccount_id` set in the `skills` table) skip the amendment step entirely.

### 8.2 Anti-recursion code path

Scorecard judge prompts, RCA proposer prompts, and peer-review prompts are resolved via a separate function `resolveSkillForEvaluator(slug)` that reads from `system_skills` or `skills` directly, never calls `resolveSkillsForAgent`, and never consults `skill_amendments`. This structural separation is the §6 anti-recursion invariant enforcement.

### 8.3 Resolver versioning

The resolver version is a semver constant in `server/services/skillService.ts` (e.g. `RESOLVER_VERSION = '1.0.0'`). Increment the patch version on any composition-logic change; increment minor on new amendment kind support; increment major on ordering-invariant changes. The version string is written to `skill_amendment_run_snapshot.resolver_version` on every run.

### 8.4 Cache invalidation

Resolver output is cached per the 5-tuple `(org_id, COALESCE(system_skill_id, org_skill_id), subaccount_id, amendment_version_set_hash, active_freeze_id_or_null)`. The COALESCE handles inherited skills uniformly (either FK is set, never both per §7.1 CHECK). The freeze-id component invalidates the cache when an `amendment_activation` freeze is created or thawed (§8.1 step 2 reads this freeze state — the resolver result depends on it). Cache is in-process (Map keyed on the 5-tuple); not persisted. In-flight runs keep their resolved body for the run lifetime (resolution happens once at agent boot). Any status change on a `skill_amendments` row (accept, reject, retire, rollback) recomputes `amendment_version_set_hash` and produces a new cache key; the previous entry ages out naturally.

---

## 9. New Jobs

Registered in `server/services/queueService/maintenanceJobs/pgBossRegistrations.ts` alongside existing jobs.

### 9.1 `failure_post_mortem`

**Queue name:** `failure:post-mortem`
**TeamSize:** 2
**Trigger:** Subordinate pg-boss `send('failure:post-mortem', payload)` dispatched by `scorecardJudgeJob` inside the same transaction that writes the verdict row, on `verdict = 'fail'` only.
**Payload:** `{ scorecard_judgement_id, run_id, org_id, subaccount_id, skill_slug }`

**Job steps:**

1. **Freeze check.** Query `skill_amendment_freezes` for an active row with `freeze_type IN ('proposal_generation', 'review_required')` scoped to this skill, subaccount, or org. (Both types suppress proposal generation; see §7.8 — `review_required` is the system-authored variant set by resolver truncation or lifetime-cap hit, while `proposal_generation` is operator-authored.) If found, log `proposal_suppressed: freeze_active` (terminal event `amendment.dropped.freeze_active`, §18.4) and exit.
2. **Cap check.** Count `skill_amendments` WHERE `org_id`, `subaccount_id`, `system_skill_id|org_skill_id` match AND `status = 'accepted'`. If ≥ 20, insert a `skill_amendment_freezes` row with `freeze_type = 'review_required'`, `scope = 'skill'`, `scope_id = <skill_id>`, `reason = 'lifetime_cap_reached'`, `created_by_user_id = NULL` (system-authored); log and exit without drafting. See §7.8 for `review_required` semantics.
3. **Weekly cap check.** Count amendments created in the last 7 days for this (org, subaccount, skill). If ≥ 5, drop and log.
4. **Inherited-skill detection.** Primary path: read the `skill_amendment_run_snapshot` for this run's skill — `system_skill_id` set means system-tier inherited, `org_skill_id` set means org-tier inherited, both null is impossible per the §7.1 CHECK constraint. Fallback: if no snapshot row exists (the §8.1 step 5 write is fire-and-forget and may have been lost), re-resolve the base by calling `resolveSkillsForAgent` with `payload.skill_slug` — deterministic, returns the same FK origin. Abort with terminal event `amendment.dropped.custom_skill` if the resolved row is a custom subaccount skill (`subaccount_id` set in `skills`).
5. **Context assembly.** Gather the 6 inputs (failed run transcript, rubric snapshot from verdict row, failed check reasoning, entity record, recent operator corrections on this skill+subaccount, current amendment stack on this skill+subaccount). No cross-tenant data.
6. **RCA synthesis.** Call Claude Opus (frontier-class) with the assembled context. Schema-validate the output: `failure_mode` (string), `contributing_factors` (list ≤ 5, each references an input field), `proposed_remedy_kind` (one of 5 kinds or `no_remedy_proposed`), `proposed_remedy_body` (text, within kind ceiling), `confidence` (0.0–1.0). If `no_remedy_proposed`, exit cleanly.
7. **Anti-recursion check.** Reject any proposal whose `proposed_remedy_kind` or `proposed_remedy_body` targets evaluator surfaces (scorecard judge prompts, RCA proposer prompts, peer-review prompts). Log and exit if rejected.
8. **`context_fact` declarative-only check.** Reject bodies containing imperative modals (`must`, `should`, `never`, `always`, `do`, `do not`). Discard silently; log.
9. **Deduplication.** Hash `(skill_id, kind, normalised_body)`. Check against active accepted rows (suppress + increment `suppressed_duplicate_count`), pending rows (increment `occurrence_count`), and recently-rejected rows within 14-day freshness window (suppress unless ≥ 3 distinct failing runs in 7 days).
10. **Peer review.** Call GPT-class model via OpenAI API. Input: proposed amendment + RCA context. Output: `{ addresses_root_cause: boolean, reasoning: string }`. If `false`: write to `peer_reviewer_drops`, write a `skill_regression_cases` row with `amendment_id = NULL`, `tag = 'unresolved'`, then exit. (The null-amendment regression row matches the §7.2 documented semantics: "Null if the proposal was dropped before reaching the queue (peer-review drop)" — it preserves the failed run as a regression candidate for future re-evaluation, even though no amendment was proposed.) If `true`: proceed.
11. **Write amendment row.** Insert into `skill_amendments` with `status = 'draft'`, then immediately transition to `status = 'pending_review'` via a second update (preserving the draft→pending_review state transition for audit). Populate all provenance columns (§7.1).
12. **Write regression case.** Insert into `skill_regression_cases` with `tag = 'unresolved'`, `amendment_id` set.

**Idempotency:** keyed on `scorecard_judgement_id` — unique constraint `skill_amendments(scorecard_judgement_id)` where `status != 'retired'` prevents duplicate proposals for the same verdict.

### 9.2 Regression Replay Job

**Queue name:** `amendment:regression-replay`
**TeamSize:** 1
**Trigger:** Dispatched by `skillAmendmentService.accept()` after writing the amendment row to `accepted`.
**Payload:** `{ amendment_id, org_id, subaccount_id, system_skill_id, org_skill_id }`

**Per-case expected verdict (derived from tag):**

- `fix_proposed` (amendment accepted) → expected verdict on replay = **pass**. The accepted amendment is supposed to have fixed the failure mode. A `pass → fail` flip is a regression — it means a newly-accepted amendment broke a previously-fixed case.
- `fix_wrong` (amendment rejected) → expected verdict on replay = **fail**. The rejected amendment was correctly judged not to address the root cause; the case is still expected to fail. Informational only; not a rollback trigger.
- `unresolved` (pending or not reviewed) → not replayed in Phase 1 (no amendment context).

Only `fix_proposed` cases drive rollback decisions. `fix_wrong` results are tracked but advisory.

**Job steps:**

1. Load `skill_regression_cases` for this skill+subaccount WHERE `tag IN ('fix_proposed', 'fix_wrong')`.
2. For each case, replay the original scorecard verdict using the `benchExecuteJob` replay primitives against the current composed skill body (includes the newly accepted amendment).
3. **Regression detection.** For each `fix_proposed` case whose replay verdict is `fail` (expected `pass` per the derivation above): the newly-accepted amendment regressed a previously-fixed case. Auto-retire the just-accepted amendment (`status → retired`, `retirement_reason = 'rollback'`, `incident_severity = 'sev2'`) in a new transaction, emit incident alert, increment `amendment_proposer_metrics.regression_failure_after_accept_count` and `rollback_count`. The `accepted → rejected` transition is forbidden (§18.6); rollback-class retirement is the canonical post-acceptance failure path (§20). `fix_wrong` cases that unexpectedly pass under the new composition are recorded but do NOT trigger rollback (their replay result is advisory only).
4. Write `skill_amendment_effectiveness` row with initial metrics (`ON CONFLICT (amendment_id) DO NOTHING` — only the first replay creates the row; subsequent replays update via §9.4).
5. Update `skill_amendment_effectiveness` for this `amendment_id`: set `last_replay_judge_version`, `last_replay_resolver_version`, `last_replay_model_version`, `last_replay_at = now()` (single most-recent-replay snapshot per §7.4 — Phase 1 does not retain per-replay-verdict history; if per-verdict provenance is needed later it can be added in Phase 2 as a separate table).

### 9.3 Freshness-window auto-retirement job

**Queue name:** `amendment:stale-retire`
**TeamSize:** 1
**Trigger:** Scheduled daily via pg-boss `schedule`. Runs in the existing maintenance job window.
**Payload:** `{}` (job enumerates orgs internally).

**Job steps:**

1. For each org, query `pending_review` amendments with `created_at < now() - interval '14 days'`.
2. Batch update to `status = 'retired'`, `retired_at = now()`, `retirement_reason = 'stale'`. State-based predicate: `WHERE status = 'pending_review' AND created_at < now() - interval '14 days'`.
3. Increment `amendment_proposer_metrics.reject_count` (tracking attrition).
4. Tag the associated `skill_regression_cases` row as `fix_wrong`.

Idempotency is implicit in the state-based predicate (already-retired rows are excluded). See §20 Failure Atomicity.

### 9.4 Effectiveness-metrics update job

**Queue name:** `amendment:effectiveness-update`
**TeamSize:** 1
**Trigger:** Scheduled daily via pg-boss `schedule`. Runs in the existing maintenance job window.
**Payload:** `{}` (job enumerates orgs and accepted amendments internally).

**Job steps:**

1. For each accepted amendment, compute `regressions_prevented`, `subsequent_fail_rate_delta`, `operator_override_frequency` from `scorecard_judgements` and `skill_amendment_run_snapshot` reads.
2. Set `inactivity_decay_candidate = true` when no run composed this amendment in 30 days, or zero delta after 60 days.
3. Upsert into `skill_amendment_effectiveness` keyed on `amendment_id` (`ON CONFLICT (amendment_id) DO UPDATE`).
4. Set `last_computed_at = now()`.

Idempotency: key-based on `amendment_id` (upsert). Multi-run safe within the daily window.

---

## 10. Modified Jobs

### 10.1 `scorecardJudgeJob`

**File:** `server/jobs/scorecardJudgeJob.ts`

**Change:** After writing the `scorecard_judgements` verdict row, if `verdict = 'fail'`, dispatch `boss.send('failure:post-mortem', payload)` inside the same transaction. The send is fire-and-forget within the transaction; if the transaction rolls back, the dispatch is also rolled back (pg-boss transactional send semantics). No change to the judge's existing scoring logic or output shape.

### 10.2 `correctionPatternDetectorJob`

**File:** `server/jobs/correctionPatternDetectorJob.ts`

**Change:** Add two new clustering dimensions alongside the existing embedding-similarity dimension:
- `failed_check_id` — the `quality_checks` slug from the `scorecard_judgements` verdict row linked to the correction.
- `entity_type` — the entity type referenced by the corrected run (customer, contact, deliverable, etc.).

Clusters that converge on a (`failed_check_id`, `entity_type`, embedding-similarity) triple are flagged as stronger amendment signal candidates. **In Phase 1**, the detector's existing output shape (memory-block writes via `memoryService`) is unchanged; the new clustering dimensions only influence which clusters get flagged. **Deferred to Phase 2 (§22):** a new `correction_clusters` sidecar table + a read path from `failure_post_mortem` keyed on `originating_correction_cluster_id`. Phase 1's proposer is triggered exclusively by `scorecard_judgement_id` (§9.1) and never reads cluster rows. The existing "suggest tightening pass marks" output is unchanged.

---

## 11. New Service

**File:** `server/services/skillAmendmentService.ts`

Thin barrel exporting the following functions. All functions route through `getOrgScopedDb`.

| Function | Description |
|---|---|
| `listPendingAmendments(orgId, subaccountId)` | List `pending_review` amendments for a subaccount, priority-ordered per §4.4 of dev brief (priority order replicated in §13.1 of this spec). |
| `getAmendment(id, orgId)` | Fetch one amendment with provenance columns. |
| `accept(id, userId, role, orgId)` | Transition `pending_review` → `accepted`. Writes `activated_at`, `human_reviewer_user_id`, `human_reviewer_role`. Dispatches regression replay job. Emits audit event (`accept_clean`). |
| `acceptAfterEdit(id, editedBody, userId, role, orgId)` | Accept with body edit. Creates a new `skill_amendments` row (supersedes the original via `superseded_by_amendment_id`), sets `source = 'operator_authored'` on the new row. Emits audit event (`accept_after_edit`). |
| `reject(id, rejectReason, userId, role, orgId)` | Transition `pending_review` → `rejected`. Tags the `skill_regression_cases` row as `fix_wrong`. Emits audit event (`reject`). |
| `retire(id, retirementReason, orgId, incidentSeverity?)` | Transition `accepted` → `retired`. Sets `retired_at`, `retirement_reason`. If `rollback` class: sets `incident_severity`, emits incident alert. Invalidates resolver cache. |
| `validateAmendmentBody(kind, body)` | Schema validation: kind ceiling, `context_fact` declarative-only rule, anti-recursion target check. Returns `{ valid, errors[] }`. Used by the proposer job before insert and by the accept route for operator-authored amendments. |

---

## 12. Routes

All routes are authenticated (`authenticate` middleware) and org-scoped (`resolveOrg` middleware). Permission key: `manage_skill_amendments` (new key, added to the permissions registry).

| Method | Path | Handler | Notes |
|---|---|---|---|
| GET | `/api/subaccounts/:subaccountId/skill-amendments` | List pending amendments | Subaccount admin + org admin. Priority-ordered. |
| GET | `/api/subaccounts/:subaccountId/skill-amendments/:id` | Get one amendment | |
| POST | `/api/subaccounts/:subaccountId/skill-amendments/:id/accept` | Accept amendment | Body: `{}`. Emits `accept_clean` audit event. |
| POST | `/api/subaccounts/:subaccountId/skill-amendments/:id/accept-after-edit` | Accept with body edit | Body: `{ body: string }`. Validates body before accepting. Emits `accept_after_edit`. |
| POST | `/api/subaccounts/:subaccountId/skill-amendments/:id/reject` | Reject amendment | Body: `{ rejectReason: RejectReasonEnum }`. Emits `reject`. |
| POST | `/api/subaccounts/:subaccountId/skill-amendments/:id/retire` | Retire amendment | Body: `{ retirementReason, incidentSeverity? }`. For accepted amendments. |
| GET | `/api/subaccounts/:subaccountId/skills/:skillId/amendments` | List all amendments for a skill | For the SubaccountSkillsPage expanded row. Includes accepted, retired, rejected. |
| GET | `/api/subaccounts/:subaccountId/skill-amendment-freezes` | List freeze events | For governance admin surface. |
| POST | `/api/subaccounts/:subaccountId/skill-amendment-freezes` | Create freeze | Body: `{ scope, scopeId?, freezeType, reason }`. Org admin only. |
| DELETE | `/api/subaccounts/:subaccountId/skill-amendment-freezes/:id` | Thaw freeze | Org admin only. **Soft-thaw semantics:** DELETE does NOT remove the row; it sets `thawed_at = now()` and `thawed_by_user_id = <caller>`. The row is retained for audit. Returns `204 No Content` on success, `409` if already thawed. |

**HTTP status mapping for state-based and unique-constraint conflicts:**
- Duplicate accept / reject / retire / acceptAfterEdit on the same amendment: `409 Conflict` from the state-based predicate (`UPDATE ... WHERE status='<expected>'` returning 0 rows; see §18.1). No `23505` is involved — amendment `id` is the primary key, so duplicate-id writes are impossible.
- Duplicate freeze for the same scope + type (active row exists): `409 Conflict` from `23505` on the unique partial index `(org_id, scope, scope_id, freeze_type) NULLS NOT DISTINCT WHERE thawed_at IS NULL` (`NULLS NOT DISTINCT` required for null `scope_id` on org-wide freezes — see §18.1).
- Duplicate failure_post_mortem dispatch for the same `scorecard_judgement_id` (active row exists): `23505` on the partial unique constraint `skill_amendments(scorecard_judgement_id) WHERE status != 'retired'`, caught in the job handler and treated as no-op (not surfaced as HTTP since this is a job, not a route).

---

## 13. Client Changes

Design source of truth: `prototypes/closed-loop-skill-improvement/` (4 screens, Round 5 CLEAN).

### 13.1 `ReviewQueuePage.tsx` — amendment proposals section

**File:** `client/src/pages/ReviewQueuePage.tsx`

Add a "Skill improvements" section band below the existing Needs Review tab content. Not a third tab — the tab pill (Briefs / Needs Review) is unchanged. The band:
- Renders when `listPendingAmendments()` returns ≥ 1 row.
- Priority-ordered per §4.4 of dev brief: incident-flagged rollback alerts, conflict banners, `review_required` warnings (rows whose skill has an active `skill_amendment_freezes` row of `freeze_type = 'review_required'`), high-blast-radius, high-occurrence, stale-soon, medium-blast, low-blast-grouped.
- Each row: skill name, kind tag, brief failure trigger (one sentence), blast-radius badge, occurrence badge (if > 1), stale-soon chip (if within 2 days of expiry). Click opens the drawer.

### 13.2 `AmendmentReviewDrawer.tsx` — new component

**File:** `client/src/components/review-queue/AmendmentReviewDrawer.tsx`

Sibling of `NewBriefModal.tsx`. Drawer (overlay) opened from the amendments section. Sections:
- Header: "Proposed amendment from a failed run" (per operator trust posture, §6.9). Kind tag. Skill name.
- What would change: before/after diff (composed body without amendment vs. with).
- Why this was proposed: failure trigger (run ID, scorecard check name, judge reasoning sentence). Collapsed by default — "Show why this was proposed" toggle.
- Accept / Edit & accept / Reject footer.
- Reject flow: 3 plain-English categorical buttons (per Round 5 CLEAN mockup at `prototypes/closed-loop-skill-improvement/s2-review-drawer.html`). Single confirm step. Mapping to `reject_reason` enum:
  - **"Not the right fix"** → `incorrect_root_cause` (canonical mapping; also the catch-all for operator-judged `overfit` / `low_confidence` cases — the operator-facing UI does not distinguish these subtypes).
  - **"Don't want this here"** → `redundant` (canonical mapping; also the catch-all for `duplicate` / `insufficient_context` cases).
  - **"Unsafe: don't suggest again"** → `unsafe`.
- The enum retains all 7 values for system-authored writes — dedup logic writes `duplicate` directly when an exact match is suppressed (§9.1 step 9); proposer schema validation writes `insufficient_context` when the RCA context bundle is incomplete.
- "Show technical detail" expander (collapsed by default): peer-review verdict, root-cause record, provenance chain (7 rows per §3.5 of dev brief).

### 13.3 `SubaccountSkillsPage.tsx` — amendment stack on skill rows

**File:** `client/src/pages/SubaccountSkillsPage.tsx`

For inherited skills (system-tier or org-tier), clicking the row expands an inline panel showing:
- Active amendments list (composition order numbered badges, kind tag, short body preview, Retire action).
- "Pause suggestions" toggle: creates a `skill_amendment_freezes` row with `freeze_type = 'proposal_generation'` for this skill.
- "Show advanced details" expander: stack-health mini-metrics (amendment_density, rollback_rate, edit_frequency), lineage graph for amended rows.

For custom subaccount skills, clicking expands a direct-edit panel (textarea + Save/Cancel). Note: "Custom skills are edited directly. Automatic improvement suggestions apply only to inherited skills."

### 13.4 `RunTracePage.tsx` / `RunTraceEventRenderer.tsx` — improvement event + composition panel

**File:** `client/src/pages/operate/RunTracePage.tsx` and `client/src/pages/operate/components/RunTraceEventRenderer.tsx`

- New event card: "Improvement proposed" (violet dot + badge). Compact card with skill name, kind tag, "Review" link to open the drawer.
- "Show composition detail" toggle at bottom of event stream (collapsed by default). Reveals two tabs:
  - **Snapshot tab:** resolver version, composed size in chars, amendment-version-set hash.
  - **Amendments used tab:** included amendments (ID, kind, activated_at) and excluded amendments (ID, retirement_reason).

---

## 14. Permissions and RLS Checklist

**RLS posture:** RLS enforces the organisation boundary; subaccount filtering is service-layer.

All seven org-scoped new tables (`skill_amendments`, `skill_regression_cases`, `peer_reviewer_drops`, `skill_amendment_effectiveness`, `amendment_proposer_entropy`, `skill_amendment_run_snapshot`, `skill_amendment_freezes`) use `FORCE ROW LEVEL SECURITY` with policy `org_id = current_setting('app.organisation_id')::uuid`. All service-layer access routes through `getOrgScopedDb`. Entries added to `server/config/rlsProtectedTables.ts` in the same migration that creates each table.

`amendment_proposer_metrics` is intentionally not org-scoped (system-wide quality signals). No RLS policy; admin-only route guard.

| Table | RLS policy | RLS_PROTECTED_TABLES entry | Route guard | Principal-scoped context |
|---|---|---|---|---|
| `skill_amendments` | org-scoped | yes | `authenticate` + `requirePermission('manage_skill_amendments')` | yes — resolver reads via `getOrgScopedDb` |
| `skill_regression_cases` | org-scoped | yes | admin-read only (not directly exposed to operators) | no — internal to replay job |
| `peer_reviewer_drops` | org-scoped | yes | admin-read only | no |
| `skill_amendment_effectiveness` | org-scoped | yes | readable via skill amendments list route | no |
| `amendment_proposer_metrics` | none (system-wide) | no | system-admin route only | no |
| `amendment_proposer_entropy` | org-scoped | yes | readable via admin dashboard | no |
| `skill_amendment_run_snapshot` | org-scoped | yes | readable via run trace route | no |
| `skill_amendment_freezes` | org-scoped | yes | `requirePermission('manage_skill_amendments')` + org-admin for write | no |

**New permission key:** `manage_skill_amendments` — added to `server/lib/permissions.ts` and `ALL_PERMISSIONS`. Granted to: `subaccount_admin`, `org_admin`.

---

## 15. Contracts

### 15.1 `failure_post_mortem` job payload

```json
{
  "scorecard_judgement_id": "uuid",
  "run_id": "uuid",
  "org_id": "uuid",
  "subaccount_id": "uuid",
  "skill_slug": "string"
}
```

Producer: `scorecardJudgeJob`. Consumer: `failure_post_mortem` job handler.

### 15.2 RCA output schema (proposer output)

```json
{
  "record_id": "uuid — generated by the proposer; copied to skill_amendments.rca_record_id",
  "failure_mode": "string — short categorical tag",
  "contributing_factors": ["string", "string"],
  "proposed_remedy_kind": "instruction_extension | example | guardrail | context_fact | exception | no_remedy_proposed",
  "proposed_remedy_body": "string — within kind length ceiling",
  "confidence": 0.87
}
```

Producer: Claude Opus inside `failure_post_mortem`. Consumer: schema validator in `skillAmendmentService.validateAmendmentBody`, then stored in `skill_amendments.rca_json`. The `record_id` is also copied to `skill_amendments.rca_record_id` (flat provenance column, not an FK; see §7.1).

Nullability: `proposed_remedy_body` is absent when `proposed_remedy_kind = 'no_remedy_proposed'`. `contributing_factors` is a list of 1–5 strings; each string must reference a field that exists in the job's 6-input context bundle.

### 15.3 Peer reviewer request / response

**Request to OpenAI GPT-class:**
```
System: "You are a peer reviewer evaluating whether a proposed skill amendment addresses a stated root cause. Reply with valid JSON only: { addresses_root_cause: boolean, reasoning: string }. Reasoning must be one sentence."

User: "Root cause: <failure_mode + contributing_factors>\nProposed amendment (<kind>): <body>"
```

**Response (parsed):**
```json
{ "addresses_root_cause": true, "reasoning": "The guardrail directly prevents the identified over-permissive refund step." }
```

Producer: `failure_post_mortem` job. Consumer: same job. Drop path writes to `peer_reviewer_drops`.

### 15.4 Amendment list API response item

```json
{
  "id": "uuid",
  "skillSlug": "string",
  "skillName": "string",
  "kind": "guardrail",
  "bodyPreview": "string — first 120 chars",
  "failureTrigger": {
    "runId": "uuid",
    "scorecardCheckName": "string",
    "judgeReasoning": "string — one sentence"
  },
  "blastRadiusEstimate": "low | medium | high",
  "occurrenceCount": 1,
  "expiresAt": "ISO8601 | null",
  "peerReviewerVerdict": true,
  "peerReviewerReasoning": "string"
}
```

Producer: `GET /api/subaccounts/:subaccountId/skill-amendments`. Consumer: `ReviewQueuePage` amendment band.

### 15.5 Source-of-truth precedence

When an amendment row and a `skill_amendment_run_snapshot` row disagree (e.g. amendment was retired after the run): **snapshot wins for replay purposes** (the agent received the composed body in the snapshot; that is historical truth). Live tables win for current operator views. Precedence: snapshot > live `skill_amendments` for audit/replay queries; live `skill_amendments` > snapshot for current queue/skill-detail views.

---

## 16. Execution Model

| Operation | Model | Notes |
|---|---|---|
| Scorecard failure detection | Inline (within `scorecardJudgeJob`) | Verdict write + subordinate dispatch in same DB transaction |
| `failure_post_mortem` | Queued async (pg-boss `failure:post-mortem`) | teamSize 2; retryable; decoupled from judge latency |
| Peer review (OpenAI) | Inline within `failure_post_mortem` | One-shot API call; not routed through `llmRouter` |
| Amendment row insert | Inline within `failure_post_mortem` | After peer review passes |
| Amendment composition at resolution | Inline (within `resolveSkillsForAgent`, calling `composeAmendmentsPure`) | Pure composition step; result cached per `(skill, subaccount, amendment_version_set_hash)` |
| Snapshot write | Inline within `resolveSkillsForAgent` wrapper (after composition returns) | Fire-and-forget insert; does not block resolution return; outside the pure composition boundary |
| Regression replay | Queued async (pg-boss `amendment:regression-replay`) | Dispatched by `accept()` after writing `accepted` status |
| Effectiveness metrics update | Queued async (pg-boss, periodic) | Scheduled daily; not on the critical accept path |
| Freshness-window auto-retirement (14 days) | Scheduled (existing maintenance job window) | New pg-boss scheduled job `amendment:stale-retire` |
| Accept / reject / retire | Inline synchronous HTTP (route handler → service) | Returns immediately; regression replay is async |

No cached prompt partitions are introduced. No LLM calls inside the resolver.

---

## 17. Phase Sequencing

Six steps in dependency order. No backward references.

### Step 1 — Schema + resolver (no UI)

- Migrations: `skill_amendments`, `skill_regression_cases`, `peer_reviewer_drops`, `skill_amendment_effectiveness`, `amendment_proposer_metrics`, `amendment_proposer_entropy`, `skill_amendment_run_snapshot`, `skill_amendment_freezes` — seven org-scoped tables with RLS + `RLS_PROTECTED_TABLES` entries (all except `amendment_proposer_metrics`, which is intentionally system-wide per §7.5 / §14 with an admin-only route guard and no manifest entry).
- Resolver extension in `resolveSkillsForAgent`: amendment composition step (§8.1), anti-recursion code path (§8.2), resolver versioning (§8.3), cache invalidation (§8.4).
- `RESOLVER_VERSION = '1.0.0'` constant.
- `skill_amendment_run_snapshot` writes on every run from this step forward.
- No UI, no proposer job yet. An empty `skill_amendments` table produces identical agent output to today.

**Dependencies:** None.

### Step 2 — `failure_post_mortem` job (RCA only, no amendment drafts yet)

- Register `failure:post-mortem` in `pgBossRegistrations.ts`.
- Implement job handler: §9.1 steps 1–6 (freeze check, weekly + lifetime caps, inherited-skill detection, context assembly, RCA synthesis). Do NOT yet implement steps 7+ (anti-recursion, declarative-only, dedup, peer review, amendment insert, regression case insert) — those land in Step 3.
- `scorecardJudgeJob` modification: dispatch `failure:post-mortem` on `verdict = 'fail'`.
- Inspect RCA outputs in job logs only. No `skill_amendments` rows are written in Step 2 — row insertion is gated on schema validation + peer review (Step 3, §9.1 step 11).
- Sanity gate: inspect real RCA outputs from at least 10 internal fail verdicts before wiring amendment proposals in Step 3.

**Dependencies:** Step 1 (tables, resolver).

### Step 3 — Amendment proposer + peer review

- Add §9.1 steps 7–12 of the `failure_post_mortem` job: anti-recursion check, `context_fact` declarative-only check, deduplication, peer review (OpenAI) including the null-amendment regression-case write on drop, amendment insert to `pending_review`, regression case insert.
- `peer_reviewer_drops` writes on peer-review `false`.
- Proposer-quality telemetry writes to `amendment_proposer_metrics` on each emit.
- `correctionPatternDetectorJob` modification: add `failed_check_id + entity_type` clustering dimension.
- Amendments reach `pending_review` but no UI yet to act on them.

**Dependencies:** Step 2 (job exists, RCA validated), Step 1 (tables).

### Step 4 — Morning queue UI + accept/reject flows

- `ReviewQueuePage` amendment section band (§13.1).
- `AmendmentReviewDrawer` component (§13.2).
- All routes (§12): list, get, accept, accept-after-edit, reject.
- `skillAmendmentService`: `listPendingAmendments`, `getAmendment`, `accept`, `acceptAfterEdit`, `reject`.
- Regression replay job (`amendment:regression-replay`) wired to `accept()`.
- Audit event emission on accept / accept-after-edit / reject via `tryEmitAgentEvent` + `agent_execution_log_edits`.
- `manage_skill_amendments` permission key added and granted.

**Dependencies:** Steps 1–3 (amendments exist in `pending_review`).

### Step 5 — Skill detail + run trace UI + rollback + freeze switch

- SubaccountSkillsPage amendment stack expanded row (§13.3).
- RunTracePage composition panel (§13.4).
- Retire and rollback-class retire routes + service functions.
- Governance freeze switch UI on skill detail page.
- Freeze routes (§12): list, create, thaw.
- Asymmetric removal guard (§4.6 of dev brief): resolver fingerprints composed body against system-skill guardrails; alerts if any guardrail-shape element is contradicted.
- `review_required` state behaviour (per §7.8): proposer suppression (same path as `proposal_generation` freezes), orange badge in queue, skill detail warning banner. Clearing requires an operator to DELETE the freeze row (§12 thaw route).

**Dependencies:** Step 4 (UI foundation, service barrel exists).

### Step 6 — Evaluation harness

- `skill_amendment_effectiveness` update job (periodic daily).
- Freshness-window auto-retirement job (`amendment:stale-retire`): 14-day window, `retirement_reason = 'stale'`.
- Proposer-entropy telemetry writes to `amendment_proposer_entropy` monthly.
- Stack-health metrics computation (amendment_density, conflict_rate, rollback_rate, stale_ratio, edit_frequency, composition_size_trend) surfaced on skill detail page and org dashboard.
- Held-out human-labelled ground truth sample setup (operational process, not code — but the table hooks for divergence detection are wired here).

**Dependencies:** Steps 4–5 (accept/reject/retire flows, regression replay).

---

## 18. Execution-Safety Contracts

### 18.1 Idempotency posture

| Operation | Posture | Mechanism |
|---|---|---|
| `failure_post_mortem` job execution (success path) | key-based | Unique constraint on `skill_amendments(scorecard_judgement_id)` WHERE status != 'retired'. Duplicate dispatch → `23505` caught → no-op. |
| `failure_post_mortem` job execution (peer-review drop path) | key-based (compound) | (a) `UNIQUE (scorecard_judgement_id)` on `peer_reviewer_drops` (§7.3); (b) `UNIQUE (scorecard_judgement_id) WHERE amendment_id IS NULL` partial on `skill_regression_cases` (§7.2). On retry after a drop, both writes hit `23505` and the job no-ops cleanly. |
| Amendment accept | state-based | `UPDATE skill_amendments SET status='accepted' WHERE id=$id AND status='pending_review'`. 0 rows updated = already actioned → 409. |
| Amendment acceptAfterEdit | state-based (compound) | Within one `withOrgTx` transaction: (1) `UPDATE skill_amendments SET status='retired', retirement_reason='superseded' WHERE id=$origId AND status='pending_review'` — if 0 rows updated, return 409 and DO NOT insert the replacement. (2) INSERT new row with `status='accepted'`, `superseded_by_amendment_id=NULL` on the new row, and `UPDATE` the original's `superseded_by_amendment_id` to point at the new row's id. Transaction rollback on any failure guarantees no orphaned replacement row. |
| Amendment reject | state-based | Same predicate, `status='pending_review'`. |
| Amendment retire | state-based | `UPDATE ... WHERE status='accepted'`. 0 rows = already retired → 409. |
| Regression replay job | key-based | One replay job per `amendment_id`; pg-boss key deduplication. |
| Freeze create | key-based | Unique partial index on `(org_id, scope, scope_id, freeze_type) NULLS NOT DISTINCT WHERE thawed_at IS NULL` (PostgreSQL 15+). The `NULLS NOT DISTINCT` clause is required because org-wide freezes have `scope_id = NULL` (§7.8); without it Postgres treats nulls as distinct and would allow duplicate active org freezes. Duplicate active freeze → 409. |
| Freeze thaw (DELETE route) | state-based | `UPDATE skill_amendment_freezes SET thawed_at=now(), thawed_by_user_id=$user WHERE id=$id AND thawed_at IS NULL`. 0 rows = already thawed → 409. |

### 18.2 Retry classification

| Operation | Classification | Notes |
|---|---|---|
| `failure_post_mortem` job | safe | Idempotency key prevents duplicate amendment rows on retry |
| OpenAI peer review call | guarded | Retried up to 3 times with exponential backoff; idempotency key from `scorecard_judgement_id` passed as OpenAI request header |
| Claude Opus RCA synthesis | guarded | Same retry budget; job-level idempotency prevents double insert |
| Amendment accept HTTP | unsafe | Caller must not retry without checking current status first |
| Resolver snapshot write | safe | Write is idempotent: `ON CONFLICT (run_id, system_skill_id, org_skill_id) DO NOTHING` |

### 18.3 Concurrency guards for racing writes

- **Double-accept race:** Two concurrent accept requests for the same amendment → one wins (state-based predicate returns 1 row), other gets 0 rows → service returns 409. First caller's audit event is canonical.
- **Double-acceptAfterEdit race:** Two concurrent edit-accept requests on the same original amendment → both attempt the §18.1 compound transaction. The first to commit the `UPDATE original SET status='retired'` succeeds; the second sees 0 rows updated, returns 409, and the transaction rolls back so no orphaned replacement row is created. First caller's replacement row is canonical.
- **Accept + acceptAfterEdit race:** Both paths use the same state-based predicate on the original row (`status='pending_review'`). First commit wins; loser gets 409.
- **Accept during regression replay:** Regression replay job checks `status = 'accepted'` before running; if a parallel rollback fired and status is already `retired`, the replay job exits cleanly.
- **Double freeze race:** Unique partial index prevents two concurrent freeze creates for the same scope/type. Loser gets `23505` → 409.
- **Double-thaw race:** Two concurrent DELETE requests on the same freeze → state-based predicate `WHERE thawed_at IS NULL` matches once; second gets 0 rows → 409.

### 18.4 Terminal event guarantee

The `failure_post_mortem` job emits exactly one terminal log event per execution:
- `amendment.proposed` — amendment row written to `pending_review`
- `amendment.suppressed` — dedup match against active accepted or pending row
- `amendment.dropped.no_remedy` — proposer returned `no_remedy_proposed`
- `amendment.dropped.peer_review` — peer reviewer returned `false`
- `amendment.dropped.schema_invalid` — schema validation failed
- `amendment.dropped.cap_exceeded` — weekly or lifetime cap hit
- `amendment.dropped.freeze_active` — freeze gate blocked
- `amendment.dropped.custom_skill` — custom subaccount skill excluded

Post-terminal prohibition: no further events with the same `scorecard_judgement_id` after a terminal event from the same job run.

### 18.5 No-silent-partial-success

The `failure_post_mortem` job either completes fully (amendment in `pending_review`) or emits a `dropped` terminal event. There is no partial success path — if any step fails, the job retries from the start (idempotency key prevents double-insert).

### 18.6 State machine closure

**`skill_amendments.status` valid transitions:**

| From | To | Trigger |
|---|---|---|
| (insert) | `accepted` | `acceptAfterEdit()` — new row inserted directly at `accepted` with full reviewer fields, `lineage_root_id`, and `superseded_by_amendment_id`-reverse-pointer set; bypasses `pending_review` (the operator's accept-on-edit IS the human review). |
| `draft` | `pending_review` | Proposer job transitions immediately after insert |
| `pending_review` | `accepted` | Operator accept action |
| `pending_review` | `rejected` | Operator reject action |
| `pending_review` | `retired` (`stale`) | Freshness-window job (14-day expiry, §9.3) |
| `pending_review` | `retired` (`superseded`) | Original row when `acceptAfterEdit()` creates a replacement row |
| `accepted` | `retired` | Operator retire; rollback; regression replay auto-rollback (§9.2); baseline reset |

Forbidden transitions: `rejected` → any; `retired` → any; `accepted` → `rejected` (regression replay must go through `retire` with `retirement_reason = 'rollback'`, see §9.2 step 3); `draft` → `accepted` (proposer-authored amendments must pass through `pending_review`; only `acceptAfterEdit()` inserts directly into `accepted` and that path is operator-driven, not proposer-driven).

The status enum is closed. Adding a new status value requires a spec amendment.

---

## 19. Trust Boundary Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│ PROPOSER CONTEXT (failure_post_mortem job — §4.2 of dev brief;     │
│  spec inputs in §9.1 step 5)                                        │
│  ✓ Failed run transcript (this run only)                            │
│  ✓ Rubric snapshot from this verdict row                            │
│  ✓ Failed check reasoning text                                      │
│  ✓ Entity record for this run                                       │
│  ✓ Recent operator corrections on this skill in this subaccount     │
│  ✓ Current amendment stack on this skill in this subaccount         │
│  ✗ Full run history (excluded)                                      │
│  ✗ Regression suite (excluded — proposer never sees the holdout)   │
│  ✗ Other subaccounts' amendments (excluded — tenant isolation)      │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ schema-validated output
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│ PEER REVIEWER (OpenAI GPT-class)                                    │
│  Input: candidate amendment + RCA only                              │
│  Output: { addresses_root_cause, reasoning }                        │
│  ✗ Cross-tenant baselines (excluded)                                │
│  ✗ Regression set (excluded)                                        │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ passes → pending_review
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│ HUMAN REVIEW BOUNDARY                                               │
│  What reaches the queue: schema-valid + peer-review-passing +       │
│    non-duplicate + non-capped + non-frozen amendments               │
│  What is dropped before the queue: peer-review drops, schema        │
│    rejections, dedup suppressions, cap exceedances, freeze blocks   │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ operator accept
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│ RUNTIME COMPOSITION PATH                                            │
│  resolveSkillsForAgent():                                           │
│    system base → org overlays → subaccount overlays → resolver →   │
│    composed body → agent runtime                                    │
│  ✗ Evaluator surfaces never consult skill_amendments               │
│  ✗ Resolver makes no live model calls                              │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ run_id + amendment IDs + composed body
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│ REPLAY ISOLATION                                                    │
│  skill_amendment_run_snapshot: immutable snapshot per run           │
│  Historical replay reads snapshot, not live tables                  │
│  Snapshot stores resolver_version + amendment_version_set_hash      │
└─────────────────────────────────────────────────────────────────────┘

EVALUATOR CONTEXT (separate code path — resolveSkillForEvaluator):
  Reads system_skills / skills directly
  Never calls resolveSkillsForAgent
  Never consults skill_amendments
  ─────────────────────────────────────
  [Scorecard judge] [RCA proposer] [Peer reviewer]
  All resolved through this path. Anti-recursion invariant.

TENANCY BOUNDARY:
  org_id IS NOT NULL on every persisted row
  RLS policy: org_id = current_setting('app.organisation_id')::uuid
  getOrgScopedDb enforced at service layer — fail-loud if called without org context
  No cross-tenant signal flows: proposer context, peer-reviewer input, and
  effectiveness metrics are all scoped to (org_id, subaccount_id)
```

---

## 20. Failure Atomicity Definitions

### Amendment acceptance

Sub-steps: DB write (`status = 'accepted'`, `activated_at`) → regression-set tag (`fix_proposed`) → cache invalidation → audit event emission → regression replay dispatch.

Atomicity boundary: DB write + regression-set tag are in a single `withOrgTx` transaction. Cache invalidation is synchronous after the transaction commits. Audit event is fire-and-forget via `tryEmitAgentEvent` (best-effort; failure does not roll back the accept). Regression replay dispatch is pg-boss `send` inside the transaction — rolls back with the transaction if the transaction fails.

If regression replay later fails: the amendment stays `accepted`; the job retries. If the replay job determines a regression: it transitions the amendment to `retired` (`retirement_reason = 'rollback'`) in a new transaction — the original accept transaction is not affected.

### Amendment retirement (including rollback)

Sub-steps: DB write (`status = 'retired'`, `retired_at`, `retirement_reason`) → cache invalidation → incident alert emission (rollback only) → audit event.

Atomicity: DB write in one transaction. Cache invalidation synchronous after commit. Alert and audit event are fire-and-forget. If alert fails: amendment is still retired; operator sees it in the skill detail page.

### Rollback (urgent retirement)

Same as retirement but additionally: emits an operational incident event (separate from the morning queue), surfaces at tier 1 in the queue, captures audit trail (operator, telemetry signal, affected runs). Incident emission is fire-and-forget — if it fails, the rollback DB write has already committed.

### Regression replay

Sub-steps: Load regression cases → replay each case via bench primitives → score → check for regressions → (if regression) auto-retire amendment → write effectiveness sidecar.

If any replay sub-step fails: the job retries from the top (idempotent — `ON CONFLICT DO NOTHING` on sidecar writes; amendment status check prevents double-retire). If the auto-retire sub-step fails: the amendment stays `accepted`; the job retries; an alert is emitted.

### Freshness-window auto-retirement

Sub-steps: Query `pending_review` rows older than 14 days → batch update to `status = 'retired', retirement_reason = 'stale'` → write `amendment_proposer_metrics` update.

Atomic per row. If the job crashes mid-batch: already-retired rows have `retirement_reason = 'stale'`; unprocessed rows are retried on the next daily run. No duplicate retirements possible (state-based predicate: `WHERE status = 'pending_review' AND created_at < now() - interval '14 days'`).

---

## 21. Testing Posture

Per `docs/spec-context.md`: `testing_posture: static_gates_primary`, `runtime_tests: pure_function_only`, `frontend_tests: none_for_now`.

- **Resolver composition logic** (`composeAmendmentsPure` — ordering, fail-closed truncation, `context_fact` declarative-only check, `validateAmendmentBody`) — pure function tests via Vitest. The `resolveSkillsForAgent` wrapper (DB query + snapshot write) is not unit-tested at this level; covered by the existing skill-resolution integration paths.
- **Amendment status machine** (valid/forbidden transitions) — pure unit tests.
- **Deduplication hash logic** (`normalised_body` computation) — pure unit test.
- **Anti-recursion gate** (rejects amendments targeting evaluator surfaces) — pure unit test.
- **Proposer job handler** — not unit-tested (LLM call + pg-boss). Covered by the Step 2 sanity gate (manual inspection of real RCA outputs on 10 internal fail verdicts before Step 3 is wired).
- No API contract tests, no E2E tests, no frontend tests. Static gates (`verify-rls-coverage.sh`, `verify-rls-contract-compliance.sh`) enforce RLS presence.

---

## 22. Deferred Items

- **Surface B: cross-subaccount org-admin roll-up queue.** The org-admin persona's cross-workspace queue view is deferred. Phase 1 delivers Surface A (in-workspace queue per subaccount). Surface B requires the same underlying data but a different query and permission shape; it is low-risk to add post-Phase 1. Reason: Phase 1 prioritises proving the loop works in a single subaccount before scaling to the roll-up view.
- **`learned_failure_mode` memory entry type.** Deferred to Phase 2. Nothing in Phase 1 reads this entry type back into agent runtime context. RCA records on `skill_amendments.rca_json` provide Phase 1 provenance. Reason: the memory layer entry type and its decay policy deserve a separate spec section once Phase 1 has validated the RCA output quality.
- **Upward promotion to system tier.** Requires ring rollout primitive (separate brief: `tasks/research-briefs/staged-rollout-dev-brief.md`). The schema supports it (`source = 'promoted_from_subaccount'` enum value); the promotion path is not built.
- **Org-scoped amendments (fan-out writing path).** Schema supports org scope; proposer does not write org-scoped rows in Phase 1. No UI exposes them.
- **Shadow-mode simulation.** Amendments surfaced directly after peer review passes. Simulation against historical runs before surfacing is deferred until replay infrastructure matures and queue volume proves to be the bottleneck.
- **Auto-retirement of low-value amendments.** Effectiveness state (§7.4) surfaces candidates; the operator decides in Phase 1. Auto-retirement is a Phase 2 escalation.
- **Amendment portability.** What travels with a cloned/exported/templated skill (amendments? provenance? regression set?) is undefined in Phase 1. Schema does not block portability; policy is not written yet.
- **Cross-subaccount pattern detection.** Deferred per tenant isolation invariant (§6.5); requires a separate brief.
- **Correction-cluster sidecar table + read path.** Phase 1's amendment proposer is triggered by `scorecard_judgement_id` only (§9.1). The `originating_correction_cluster_id` column exists in `skill_amendments` but is always NULL in Phase 1. Phase 2 will add a `correction_clusters` table (sidecar for the correction-pattern detector), backfill the FK constraint on `originating_correction_cluster_id`, and add a cluster-triggered branch to `failure_post_mortem`. Reason: cluster-triggered proposals are an escalation path that needs the Phase 1 failure-mode-triggered loop validated first.
- **Evaluator Stress Test integration.** The EST gaming-statistic computation (`G(y)`) for amendment-gaming detection is deferred to Phase 2. Phase 1 has peer review and the held-out regression set as the primary defences.
- **Periodic baseline reset automation.** Quarterly merge of stable amendments into the system skill is an operational process in Phase 1 (not automated code). Phase 2 consideration if volume justifies it.

---

## 23. Self-Consistency Pass

- **Goals ↔ Implementation:** All 8 Goals in §2 map to explicit implementation sections (resolver: §8; proposer job: §9.1; regression replay: §9.2; morning queue UI: §13.1–13.2; skill detail UI: §13.3; run trace UI: §13.4; freeze switch: §7.8 + §13; evaluation harness: §9.2 + §17 Step 6). No goal is prose-only.
- **Non-goals encoded:** Surface B deferred to §22. `learned_failure_mode` deferred to §22. Autonomous activation prohibited by §18.1 (state-based predicate requires explicit operator action).
- **Count reconciliation:** 8 new tables (§7.1–7.8). 4 new jobs (§9.1–9.4). 2 modified jobs (§10.1–10.2). 1 new service (§11). 10 new routes (§12). 4 client change areas (§13.1–13.4). File inventory lock: see §17 Phase Sequencing steps for complete file list per step.
- **Load-bearing claims verified:**
  - "Amendments never activate without operator approval" — enforced by state machine (§18.6): `pending_review → accepted` requires explicit `accept()` call from a route handler guarded by `requirePermission('manage_skill_amendments')`.
  - "Proposer never sees the regression set" — enforced by §19 trust boundary: proposer context inputs (§9.1 step 5) are listed explicitly and do not include `skill_regression_cases`.
  - "Resolver composition step is deterministic" — §6.6 and §8.1: `composeAmendmentsPure` has no mutable external service calls, no model calls, no wall-clock time. The `resolveSkillsForAgent` wrapper performs the snapshot DB write as a fire-and-forget side effect outside the pure boundary.
  - "RLS enforces org boundary" — §14: all tenant-scoped tables use `FORCE ROW LEVEL SECURITY` + `getOrgScopedDb` service-layer gate.
- **Phase dependency graph:** Step 1 (schema) ← Step 2 (RCA job) ← Step 3 (proposer + peer review) ← Step 4 (UI + accept/reject) ← Step 5 (skill detail + freeze) ← Step 6 (harness). No backward references detected.
- **Execution model consistent:** All async operations are pg-boss queued; all HTTP route handlers are synchronous returns; resolver is inline synchronous. No mixed-model operations.

---

## 24. Open Questions

None. All design decisions were resolved during the grill-me Q&A (see `tasks/builds/closed-loop-skill-improvement/intent.md § Grill-me Q&A`) and the dev brief §7 (all questions marked CLOSED at brief-lock time).
