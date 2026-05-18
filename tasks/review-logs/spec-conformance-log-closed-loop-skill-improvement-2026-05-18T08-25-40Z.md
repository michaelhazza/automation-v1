# Spec Conformance Log

**Spec:** `docs/superpowers/specs/2026-05-18-closed-loop-skill-improvement-spec.md`
**Spec commit at check:** `2558d421` (Phase 1 complete)
**Branch:** `claude/review-mockup-suggestions-tVf84`
**Base:** merge-base with `main` (post 51a0c752 merge)
**Scope:** Major build — full spec (§§5–18 + §21) against full changed-code set; 9 chunks reported done in `tasks/builds/closed-loop-skill-improvement/progress.md`
**Changed-code set:** ~140 files (10 commits: c4b84b77 → f9cc84ad)
**Run at:** 2026-05-18T08-25-40Z

---

## Contents

1. Summary
2. Requirements extracted — §7.1 `skill_amendments`
3. Requirements extracted — §7.2–7.8 (remaining schema tables)
4. Requirements extracted — §8 Resolver
5. Requirements extracted — §9 Jobs (proposer, replay, stale-retire, effectiveness)
6. Requirements extracted — §§10–15 (modified jobs, service, routes, client, contracts)
7. Requirements extracted — §§18–21 (safety contracts, testing)
8. Mechanical fixes applied
9. Directional gaps routed to tasks/todo.md
10. Files modified
11. Next step

---

## 1. Summary

- Requirements extracted:     48
- PASS:                       33
- MECHANICAL_GAP → fixed:      0
- DIRECTIONAL_GAP → deferred: 15
- AMBIGUOUS → deferred:        0
- OUT_OF_SCOPE → skipped:      0

**Verdict:** NON_CONFORMANT (15 blocking gaps — schema-level divergences from spec §7 require an operator decision before merge; routed to `tasks/todo.md`)

The implementation builds the full pipeline end-to-end and most behavioural contracts (state machine, terminal events, snapshot divergence, peer review routing, RLS coverage) match the spec. The gaps are concentrated in §7 Data Model: columns renamed or dropped, enums collapsed, types changed, and one column added (`subaccount_id` on `skill_amendment_freezes`) that is not in the spec. These compound into one behavioural defect (`acceptAfterEdit` using `rejected` instead of `retired/superseded`) and one telemetry bug (proposer-vs-peer-reviewer model version confusion in `amendment_proposer_metrics`). None of the schema gaps are mechanically fixable: migration 0370 is append-only and shipped; a corrective migration 0372 is genuine design work with backfill questions.

---

## 2. Requirements extracted — §7.1 `skill_amendments`

| REQ | Verdict | Evidence | Note |
|---|---|---|---|
| Table exists, PK `uuid` | PASS | `migrations/0370_skill_amendments_phase_1.sql:15-16` | |
| `org_id NOT NULL` + FK organisations | PASS | line 17 | |
| `system_skill_id / org_skill_id` dual-FK with XOR CHECK | PASS | lines 19-23 (`skill_amendments_skill_xor_ck`) | |
| `subaccount_id uuid \| null` (spec §7.1) | DIRECTIONAL #1 | line 18 is `NOT NULL` | Phase 1 proposer only writes subaccount-scoped (spec §7.1 paragraph 2); behaviour OK, schema cannot persist org-scoped amendments |
| `kind` enum (5 values) + CHECK | PASS | lines 24-26 | |
| Per-kind body length CHECK (800/1500/400/300/600) | PASS | lines 35-42 | |
| `source` enum (7 values per spec §7.1) | DIRECTIONAL #2 | lines 30-32 — only 2 values (`agent_proposed_from_failure`, `operator_manual`) | Renamed `operator_authored` → `operator_manual`; dropped 5 other values |
| `status` enum (5 values) + CHECK | PASS | lines 27-29 | |
| `reject_reason` enum (7 values per spec §7.1) | DIRECTIONAL #3 | lines 63-65 — only 4 values (`incorrect_root_cause`, `redundant`, `unsafe`, `other`) | Missing 4 spec values; `'other'` is in migration but not in spec at all; spec §13.2 explicitly retains all 7 for system-authored writes |
| `blast_radius_estimate` enum + CHECK | PASS | lines 43-45 | |
| `confidence numeric(3,2) NOT NULL default 0.00` | DIRECTIONAL #4 | line 46 is `double precision` nullable, no default | Type drift |
| `version_number integer NOT NULL default 1` | PASS | line 47 | |
| `proposer_run_id`, `scorecard_judgement_id`, `rca_record_id`, `rca_json` | PASS (FK deferred) | lines 50-53 | FK to `agent_runs`/`scorecard_judgements` deferred per migration header |
| `proposer_model_version`, `peer_reviewer_model_version`, `peer_reviewer_verdict`, `peer_reviewer_reasoning` | PASS | lines 55-58 | |
| `human_reviewer_user_id`, `human_reviewer_role` (spec §7.1) | DIRECTIONAL #6 | code has `activated_by_user_id`, `rejected_by_user_id`; no role column at all | Split into two columns; `role` channel dropped entirely; service accepts `_role` param but discards it |
| `activated_at`, `retired_at`, `retirement_reason`, `incident_severity` | PASS | lines 68-76 | |
| `superseded_by_amendment_id` (spec §7.1) | DIRECTIONAL #6 | absent | Reverse pointer doesn't exist; spec §11 `acceptAfterEdit` documents it |
| `lineage_root_id` self-ref | PASS | line 49 | |
| `originating_correction_cluster_id` (Phase 2 deferred FK) | PASS | line 60 | |
| `occurrence_count DEFAULT 1` (spec §7.1) | DIRECTIONAL #5 | `DEFAULT 0` (line 62) | A new row should logically show 1 occurrence (this run), not 0 |
| Partial unique on `scorecard_judgement_id WHERE status != 'retired'` | PASS | migration lines 82-84 | |
| FORCE RLS + canonical policy | PASS | lines 89-91 | |
| RLS_PROTECTED_TABLES entry | PASS | `rlsProtectedTables.ts:1390-1393` | |

---

## 3. Requirements extracted — §7.2–7.8

### §7.2 `skill_regression_cases`

| REQ | Verdict | Evidence | Note |
|---|---|---|---|
| Table + `org_id NOT NULL` + FK | PASS | migration lines 97-99 | |
| `subaccount_id uuid NOT NULL`, `system_skill_id`, `org_skill_id` (spec §7.2) | DIRECTIONAL #9 | columns absent | Regression replay job (§9.2) cannot determine which skill a null-amendment regression case (peer-review drop) applies to |
| `scorecard_judgement_id uuid NOT NULL` | PASS | line 101 | |
| `amendment_id uuid \| null` FK | PASS | line 100 | |
| `tag` enum + CHECK | PASS | lines 102-104 | |
| Partial UNIQUE `(scorecard_judgement_id) WHERE amendment_id IS NULL` | PASS | lines 110-112 | |
| FORCE RLS + manifest entry | PASS | lines 114-116; manifest 1396 | |

### §7.3 `peer_reviewer_drops`

| REQ | Verdict | Evidence | Note |
|---|---|---|---|
| Table + `org_id`, `scorecard_judgement_id`, `peer_reviewer_model_version`, timestamps | PARTIAL | lines 122-127 | |
| `proposer_output_json jsonb NOT NULL` (spec §7.3) | DIRECTIONAL #8 | absent | Spec's stated purpose ("Shadow telemetry for peer-reviewer false-negative analysis") is impossible without this column |
| `peer_reviewer_reasoning text NOT NULL` (separate from drop_reason) | DIRECTIONAL #8 | absent — only `drop_reason text NOT NULL` (line 126) | Code writes `prResult.reasoning` to `drop_reason`; spec names the column `peer_reviewer_reasoning` |
| `proposer_model_version text NOT NULL` | DIRECTIONAL #8 | absent | Spec wants both proposer + peer-reviewer model versions |
| `peer_reviewer_model_version text NOT NULL` | DIRECTIONAL #8 | line 127 is **nullable** | |
| UNIQUE (scorecard_judgement_id) | PASS | line 129 | |
| FORCE RLS + manifest entry | PASS | lines 132-134; manifest 1402 | |

### §7.4 `skill_amendment_effectiveness`

| REQ | Verdict | Evidence | Note |
|---|---|---|---|
| Table + `org_id`, `amendment_id` UNIQUE | PASS | migration lines 140-153 | |
| Counter columns + decay candidate boolean | PASS | lines 144-147 | |
| `last_replay_judge_version`, `last_replay_resolver_version`, `last_replay_model_version`, `last_replay_at`, `last_computed_at` | DIRECTIONAL #10 | code has `last_replay_run_at`, `last_replay_verdict` only | Replay-provenance audit (spec §7.4) requires the 3 version columns; `regressionReplayJob` line 281-285 only writes the two existing columns |
| FORCE RLS + manifest entry | PASS | lines 155-157; manifest 1408 | |

### §7.5 `amendment_proposer_metrics`

| REQ | Verdict | Evidence | Note |
|---|---|---|---|
| Table + all counter columns | PASS | migration lines 165-177 | |
| `UNIQUE (proposer_model_version, period_start)` — for the UPSERT shape (plan R10) | PASS | line 176 | |
| No RLS (system-wide) + header comment | PASS | lines 161-162 | |
| NOT in RLS_PROTECTED_TABLES | PASS | not added (correct) | |

### §7.6 `amendment_proposer_entropy`

| REQ | Verdict | Evidence | Note |
|---|---|---|---|
| Table + `org_id`, period_month, metrics columns | PASS | migration lines 183-195 | |
| `system_skill_id uuid \| null` + `org_skill_id uuid \| null` (two FK columns per spec) | DIRECTIONAL #11 | migration uses single `skill_id text NOT NULL` (line 187) | Cannot FK-validate or distinguish system-vs-org skill |
| FORCE RLS + manifest entry | PASS | lines 197-199; manifest 1414 | |

### §7.7 `skill_amendment_run_snapshot`

| REQ | Verdict | Evidence | Note |
|---|---|---|---|
| Table + all columns + UNIQUE NULLS NOT DISTINCT | PASS | migration lines 206-226 | First-class snapshot uniqueness invariant correctly enforced |
| `composed_body_hash` (used by divergence check) | PASS | line 215 | |
| FORCE RLS + manifest entry | PASS | lines 228-230; manifest 1420 | |

### §7.8 `skill_amendment_freezes`

| REQ | Verdict | Evidence | Note |
|---|---|---|---|
| Table + `org_id NOT NULL`, scope/scope_id/freeze_type/reason/created_by/thawed_*/timestamps | PASS | migration lines 238-255 | |
| `subaccount_id` column (NOT in spec §7.8) | DIRECTIONAL #12 | line 240 adds nullable `subaccount_id` | Spec encodes location via `scope`/`scope_id`; impl adds a separate column. Routes filter by it. Schema extension not specified by spec |
| `review_required` freeze_type included | PASS | line 248 | |
| Partial UNIQUE NULLS NOT DISTINCT WHERE thawed_at IS NULL | PASS | lines 261-263 | |
| FORCE RLS + manifest entry | PASS | lines 265-267; manifest 1426 | |

---

## 4. Requirements extracted — §8 Resolver

| REQ | Verdict | Evidence |
|---|---|---|
| `composeAmendmentsPure` — pure, bucket ordering, fail-closed truncation 12000 | PASS | `server/services/skillResolution/composeAmendmentsPure.ts` |
| `RESOLVER_VERSION = '1.0.0'` | PASS | `server/services/skillResolution/types.ts:3` |
| `resolveSkillsForAgent` requires `ctx.runId` (non-optional) | PASS | `server/services/skillService.ts:162-168` |
| `resolveSkillsForInspection` (read-only, no snapshot) | PASS | `skillService.ts:217-251` |
| `resolveSkillForEvaluator` (anti-recursion path; never consults `skill_amendments`) | PASS | `skillService.ts:258-296` |
| `writeRunSnapshot` with `ON CONFLICT DO NOTHING ... RETURNING` + divergence detection | PASS | `snapshotWrite.ts:53-146` |
| `composition.divergence` typed error (non-retryable) | PASS | `snapshotWrite.ts:124-146` |
| `composition.snapshot_write_failed` typed error (retryable) | PASS | `snapshotWrite.ts:79-90` |
| `invalidateResolverCache` exported | PASS | `skillService.ts:52` |
| CI grep gate `verify-resolver-runid-invariant.sh` | PASS | `scripts/verify-resolver-runid-invariant.sh` |
| Active `amendment_activation` freeze suppresses overlays | PASS | `composeAmendmentsPure.ts:59-69` |

---

## 5. Requirements extracted — §9 Jobs

### §9.1 `failure_post_mortem` (steps 1–12)

| REQ | Verdict | Evidence |
|---|---|---|
| Queue `failure:post-mortem` registered, teamSize 2 | PASS | `pgBossRegistrations.ts:1088` |
| Subordinate dispatch from `scorecardJudgeJob` via `sendWithTx` | PASS | `scorecardJudgeJob.ts:193-204` (R9 mitigation correctly applied) |
| Step 1 — freeze check (`proposal_generation` + `review_required`) | PASS | `failurePostMortemJob.ts:83` |
| Step 2 — lifetime cap → write `review_required` freeze | PASS | `failurePostMortemJob.ts:150-167` |
| Step 3 — weekly cap | PASS | line 174 |
| Step 4 — inherited-skill detection via snapshot read; `amendment.dropped.snapshot_missing` + `composition.degraded` on miss | PASS | lines ~107-225 |
| Step 5 — context assembly from snapshot (NOT live query) | PASS | uses `deriveAmendmentStackFromSnapshot` |
| Step 6 — RCA synthesis via `llmRouter.routeCall`; terminal `schema_invalid`/`no_remedy` emitted | PASS | |
| Step 7 — anti-recursion check on evaluator surfaces | PASS | line 281 |
| Step 8 — context_fact declarative-only | PASS | line 291 |
| Step 9 — deduplication (active/pending/recently-rejected) | PASS | `amendmentDedupPure.ts` |
| Step 10 — peer review via `llmRouter`; router-exhaustion terminal | PASS | line 508 |
| Step 11 — amendment INSERT draft → UPDATE pending_review | PASS | lines 584-627 |
| Step 12 — regression case INSERT | PASS | line 642-650 |
| Terminal events from §18.4 (8 dropped variants + proposed + suppressed) | PASS | all emitted |
| `amendment_proposer_metrics` UPSERT uses RCA proposer model version | DIRECTIONAL #13 | line 664: writes `prResult.peerReviewerModelVersion` for `proposerModelVersion` field — **semantic bug**, telemetry is corrupted |
| `amendment_proposer_metrics` UPSERT on router-exhausted writes `'unknown'` | DIRECTIONAL #14 | line 517 — masks distinct proposer models behind a single bucket |

### §9.2 Regression replay job

| REQ | Verdict | Evidence |
|---|---|---|
| Queue `amendment:regression-replay`, teamSize 1 | PASS | `pgBossRegistrations.ts:1101` |
| Triggered by `accept()` via `sendWithTx` inside accept tx | PASS | `skillAmendmentService.ts:243-249` |
| Per-tag expected verdict (`fix_proposed → pass`, `fix_wrong → fail`, `unresolved → skip`) | PASS | `amendmentRegressionReplayJobPure.ts:expectedVerdictForTag` |
| Auto-retire on `fix_proposed → fail` flip with `retirement_reason='rollback'`, `incident_severity='sev2'` | PASS | line 142 |
| `accepted → rejected` transition forbidden (uses retire/rollback) | PASS | uses `retire` |
| Effectiveness sidecar UPSERT | PASS | `upsertEffectiveness` helper |
| Proposer metrics `rollback_count` + `regression_failure_after_accept_count` increment | PASS | lines 148-156 |

### §9.3 Freshness-window auto-retire

| REQ | Verdict | Evidence |
|---|---|---|
| Queue `amendment:stale-retire`, scheduled daily 06:00 UTC | PASS | `pgBossRegistrations.ts:1192` (cron `0 6 * * *`) |
| 14-day cutoff, state-based predicate, `retirement_reason='stale'` | PASS | `amendmentStaleRetireJob.ts` |
| Tag associated regression cases as `fix_wrong` | PASS | (verified in handler) |

### §9.4 Effectiveness-metrics update

| REQ | Verdict | Evidence |
|---|---|---|
| Queue `amendment:effectiveness-update`, scheduled daily 07:00 UTC | PASS | `pgBossRegistrations.ts:1205` (cron `0 7 * * *`) |
| Inactivity decay candidate logic (30d/60d) | PASS | `amendmentEffectivenessUpdateJob.ts` |
| UPSERT on `amendment_id` | PASS | `ON CONFLICT (amendment_id) DO UPDATE` |

### Bonus — `amendment_proposer_entropy` monthly job

| REQ | Verdict | Evidence |
|---|---|---|
| Queue `amendment:proposer-entropy`, scheduled monthly 1st of month 03:00 UTC | PASS | `pgBossRegistrations.ts:1218` (cron `0 3 1 * *`) |

---

## 6. Requirements extracted — §§10–15

### §10 Modified jobs

| REQ | Verdict | Evidence |
|---|---|---|
| `scorecardJudgeJob` dispatches `failure:post-mortem` on `verdict='fail'` inside verdict tx | PASS | `scorecardJudgeJob.ts:193-204` |
| `correctionPatternDetectorJob` adds `failed_check_id` + `entity_type` clustering | PASS | `correctionPatternDetectorJob.ts`, `correctionPatternDetectorPure.ts` |

### §11 `skillAmendmentService`

| REQ | Verdict | Evidence |
|---|---|---|
| `listPendingAmendments`, `getAmendment`, `accept`, `acceptAfterEdit`, `reject`, `retire`, `listAmendmentsForSkill`, `validateAmendmentBody` | PASS | all exported on `skillAmendmentService` |
| `freezes.list`, `freezes.create`, `freezes.thaw` | PASS | service barrel |
| `acceptAfterEdit` transitions original to `retired` with `retirement_reason='superseded'` (spec §11, §18.1, §18.6) | DIRECTIONAL #7 | `skillAmendmentService.ts:297-299` — transitions to **`rejected` with `rejectReason='other'`** instead | Behavioural defect; corrupts proposer-metrics signal (reject_count++ instead of accept_after_edit_count++); also: `superseded_by_amendment_id` column doesn't exist, so reverse pointer can't be set |
| All functions route through `getOrgScopedDb` | PASS | every method |
| `human_reviewer_role` recorded on accept | DIRECTIONAL #6 (overlap) | accept accepts `_role` parameter but discards it; no column to persist to |

### §12 Routes

| REQ | Verdict | Evidence |
|---|---|---|
| 7 amendment routes (list/get/accept/accept-after-edit/reject/retire/skill-amendments-for-skill) | PASS | `server/routes/skillAmendments.ts` |
| 3 freeze routes (list/create/thaw) | PASS | `server/routes/skillAmendmentFreezes.ts` |
| All routes `authenticate + requireSubaccountPermission(SKILL_AMENDMENTS_MANAGE) + resolveSubaccount` | PASS | verified each route |
| DELETE freeze returns 204; freeze is soft-thaw (UPDATE thawed_at) | PASS | `routes/skillAmendmentFreezes.ts:62`; `service.freezes.thaw` does UPDATE |
| Routes mounted in `server/index.ts` | PASS | lines 431-432 |
| `validateAmendmentBody` called in `acceptAfterEdit` route before insert | PASS | service line 289-292 |

### §13 Client

| REQ | Verdict | Evidence |
|---|---|---|
| `AmendmentSection` mounted in `ReviewQueuePage` below tab content | PASS | `client/src/pages/ReviewQueuePage.tsx:702` |
| `AmendmentReviewDrawer` exists + sibling pattern | PASS | `client/src/components/review-queue/AmendmentReviewDrawer.tsx` |
| Reject mapping: 3 plain-English buttons → `incorrect_root_cause` / `redundant` / `unsafe` | PASS | `AmendmentReviewDrawer.tsx:5-9` |
| `SkillAmendmentStackExpanded` mounted in `SubaccountSkillsPage` | PASS | line 413 |
| `SkillFreezeSwitch` exists | PASS | `client/src/components/skills/SkillFreezeSwitch.tsx` |
| `RunTraceCompositionPanel` mounted in `RunTracePage` | PASS | lines 438, 471 |
| `RunTraceImprovementEvent` registered in `RunTraceEventRenderer` | PASS | line 296 |

### §14 Permissions and RLS Checklist

| REQ | Verdict | Evidence |
|---|---|---|
| Permission key for amendment routes | PASS (plan-locked) | `permissions.ts:220` uses `subaccount.skill_amendments.manage`. Plan.md Chunk 5 documents this as "implementation supersedes spec"; not re-flagged here |
| 7 org-scoped tables in `RLS_PROTECTED_TABLES` | PASS | manifest lines 1390-1428 |
| `amendment_proposer_metrics` NOT in manifest (system-scoped) | PASS | correctly absent |

### §15 Contracts

| REQ | Verdict | Evidence |
|---|---|---|
| `failure_post_mortem` payload shape | PASS | `FailurePostMortemPayload` interface |
| RCA output schema validation (5 fields + recordId) | PASS | `validateRcaProposerOutput` in `failurePostMortemJobPure.ts` |
| Peer-review via `llmRouter.routeCall({ taskType: 'peer_review', sourceType: 'failure_post_mortem' })` | PASS | `peerReviewCaller.ts` |
| `peer_review` appended to TASK_TYPES; `failure_post_mortem` appended to SOURCE_TYPES | PASS | `llmRequests.ts:256`, `272` |
| Migration 0371 extends `llm_requests_attribution_ck` + `llm_requests_execution_phase_ck` | PASS | `migrations/0371_extend_llm_request_enums.sql` |
| Snapshot wins for replay (§15.5) | PASS | RCA proposer reads from snapshot's `included_amendment_ids`/`excluded_amendment_ids`, not live query |

---

## 7. Requirements extracted — §§18–21

### §18 Execution-Safety Contracts

| REQ | Verdict | Evidence |
|---|---|---|
| State-based idempotency on accept/reject/retire (`WHERE status='<expected>'` returning 0 → 409) | PASS | every state transition uses the predicate |
| Unique-constraint idempotency on freeze create (409 on 23505) | PASS | `freezes.create:528-530` |
| State-based idempotency on freeze thaw | PASS | `freezes.thaw:545-551` |
| State machine closure (§18.6 valid transitions; forbidden `accepted → rejected`) | DIRECTIONAL #7 (overlap) | `acceptAfterEdit` uses `pending_review → rejected` instead of `pending_review → retired (superseded)` |
| Terminal events guarantee (§18.4) | PASS | all events emitted, post-terminal prohibition observed |
| Typed resolution errors (§18.7) | PASS | `composition.divergence`, `composition.snapshot_write_failed` |

### §21 Testing Posture

| REQ | Verdict | Evidence |
|---|---|---|
| Pure function tests for `composeAmendmentsPure`, `validateAmendmentBody`, dedup, state-machine guard, regression-replay pure, stale-retire pure, stack-health pure, RCA prompt builder, correction-pattern pure | PASS | `server/**/__tests__/*Pure.test.ts` files all present |
| No frontend tests / no API contract tests (per `docs/spec-context.md: frontend_tests: none_for_now`) | PASS | none added |

---

## 8. Mechanical fixes applied

None. All 15 gaps were classified as DIRECTIONAL — each requires an operator design decision (schema-shape choice, corrective migration scoping, telemetry semantics) that exceeds the mechanical-fix mandate. Specifically:

- 10 of 15 gaps live in migration 0370 (DEVELOPMENT_GUIDELINES §6.1: migrations are append-only — cannot edit). A corrective migration 0372 to bring the schema into spec compliance would need to make column-shape, enum-extension, and column-rename decisions that are genuine design work (not surgical addition of a spec-named missing item).
- 2 of 15 are the resulting behavioural defects (DIRECTIONAL #7 `acceptAfterEdit` state transition, DIRECTIONAL #13 proposer-vs-peer model channel) that depend on a schema decision first.
- 3 of 15 are missing-column gaps in tables that need columns the spec names but the migration omitted; same constraint applies.

Pre-emptively applying a corrective migration would silently extend scope into design work the operator should authorise.

---

## 9. Directional / ambiguous gaps (routed to tasks/todo.md)

See `## Deferred from spec-conformance review — closed-loop-skill-improvement (2026-05-18)` in `tasks/todo.md`. 15 line items.

---

## 10. Files modified by this run

- `tasks/todo.md` (appended one section with 15 deferred items)
- `tasks/review-logs/spec-conformance-log-closed-loop-skill-improvement-2026-05-18T08-25-40Z.md` (this log)

---

## 11. Next step

NON_CONFORMANT — 15 directional gaps must be addressed by the main session before `pr-reviewer`.

Gap concentration: 10 of 15 in §7 Data Model (schema). 2 propagate into behavioural defects (`acceptAfterEdit` state transition; proposer-vs-peer model version in metrics). 3 are missing columns required by service-level usage (regression case skill identity; effectiveness replay-version provenance; entropy skill FK).

**Operator decisions required:**

1. **Schema reconciliation.** Author corrective migration `0372_skill_amendments_phase_1_corrections.sql` that brings the schema into spec compliance, OR amend the spec to reflect the shipped shape. The plan.md Chunk 5 already documents a precedent for "implementation supersedes spec" lock-ins; the operator can extend that pattern if the shipped shape is preferred. Specific decisions per gap routed in `tasks/todo.md`.
2. **Non-schema bugs (independent of schema decision).** Two items can be fixed surgically once decided:
   - DIRECTIONAL #7 — `acceptAfterEdit` must transition the original row to `retired (superseded)`, not `rejected (other)`. If `superseded_by_amendment_id` is not added back, `lineage_root_id` already chains forward — but the audit signal of "this was edit-accepted, not rejected" still needs the right `status`/`retirement_reason`.
   - DIRECTIONAL #13 — `amendment_proposer_metrics` UPSERT must record the **RCA proposer** model version (Claude Opus), not the peer-reviewer (GPT) model version. Three call sites in `failurePostMortemJob.ts` need this fix.
