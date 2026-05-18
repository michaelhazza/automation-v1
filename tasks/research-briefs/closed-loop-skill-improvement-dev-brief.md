# Closed-loop skill improvement: dev-session brief

**Status.** Pre-spec brief — locked 2026-05-18 after four governance-refinement passes. **Updated 2026-05-18 (post-lock):** design decisions added on inherited-vs-custom skill scope, dual-FK schema, org-inherited amendments built from day one (see §2.1, §3.6, §4.1, §4.2, §5, §7.2).
**Owner.** Product (Synthetos).
**Source material.** Three independent deep-research passes on self-improving agents and evaluation loops (Claude, Gemini, ChatGPT). See `tasks/research-briefs/02-self-improving-agents.md` for the research prompt; raw outputs archived separately. Convergence across all three was the determining signal for the design choices below.

---

## Contents

1. One-paragraph summary
2. Context
   - 2.1 Glossary
   - 2.2 What exists today (with file paths)
   - 2.3 Why now, why this shape
3. Governance and lifecycle invariants
   - 3.1 Governance invariants
   - 3.2 Anti-recursion invariant
   - 3.3 Primitive boundary (amendments are not memory)
   - 3.4 Amendment lifecycle semantics
   - 3.5 Amendment provenance chain
   - 3.6 Deterministic composition ordering (+ conflict semantics)
   - 3.7 Operator trust posture (+ bounded explainability)
   - 3.8 Composition observability and visibility
   - 3.9 Queue ergonomics invariant (+ progressive disclosure)
   - 3.10 Tenant behavioural isolation invariant
   - 3.11 Human override supremacy (+ operator intent preservation)
   - 3.12 Telemetry is observational, not authoritative
4. Architectural decisions
   - 4.1 Amendment primitive (new)
   - 4.2 Post-failure root-cause synthesis
   - 4.3 Multi-agent peer review on the amendment
   - 4.4 Morning review queue, reviewer permissions, review surfaces
   - 4.5 Evaluation harness changes
   - 4.6 Asymmetric structural-removal guard
   - 4.7 Bounded loops and review-required state
   - 4.8 Rollback semantics (+ incident semantics + historical truth)
   - 4.9 Governance freeze switch
5. What is explicitly out of scope (Phase 1)
6. Sequencing inside Phase 1
7. Open questions for the dev session
8. Success criteria
9. Known failure modes we are designing against
10. What this brief is not
11. Related briefs

Appendix A. Unsafe amendment examples

---

## 1. One-paragraph summary

We are adding a reviewed amendment proposal loop on top of the existing scorecard subsystem. When a scorecard verdict fails, the system synthesises a root-cause record, drafts a typed amendment, and queues it for one-click operator review at the subaccount tier. Accepted amendments stack on top of the system skill via a new overlay primitive, without forking. Rejected amendments become regression test cases. The loop is bounded (max amendments per skill per week), schema-validated (every amendment is a typed category), and gated (human approval until the eval gate earns trust). Upward promotion of subaccount amendments to system tier is deferred until ring rollout exists; that is a separate feature.

The framing is "agents propose, humans approve." We do not ship anything that hints at autonomous self-modification.

## 2. Context

### 2.1 Glossary

- **Organisation (org).** A Synthetos customer. The typical customer is a digital agency. One organisation has many subaccounts.
- **Subaccount.** One operational workspace owned by an organisation, usually one per end-client of the agency. Subaccounts run independently: their own agents, runs, data, scorecards, memory.
- **System tier.** Synthetos-owned, shared across every organisation and subaccount. The 100+ system skills live here.
- **System skill.** A skill defined at the system tier. Inherited by every org and subaccount until forked.
- **Fork (current behaviour).** When a subaccount or org customises a system skill today, the system creates a complete independent copy in the `skills` table. The customisation fully replaces the system text for that tier. No layering, no inheritance from future system updates.
- **Amendment (new, this brief).** A typed overlay row that extends a system skill at the org or subaccount tier **without** forking. Composed at runtime onto the system base text. Preserves inheritance from future system updates.
- **Scorecard.** A rubric of quality checks (slug, name, pass mark) that an LLM judge applies to sampled runs to produce a pass / fail / inconclusive verdict.
- **RCA (root-cause analysis).** A structured record explaining why a specific scorecard fail occurred. Produced by the proposed `failure_post_mortem` job.
- **Inherited skill.** A skill that originates at a tier above the subaccount — either a system skill flowing from Synthetos, or an org-tier skill (org-forked from a system skill, or org-authored from scratch) that the org has made visible to the subaccount. Inherited skills are read-only at the subaccount tier; subaccounts cannot edit them directly. The amendment mechanism exists specifically for inherited skills.
- **Custom subaccount skill.** A skill created entirely within a specific subaccount, stored in the `skills` table with `subaccount_id` set. The subaccount owns it and can edit it directly. No amendment mechanism is needed or applied; agents propose improvements by editing the skill body directly (via the existing skill-edit flow with versioning), not via `skill_amendments` rows.
- **Pre-launch.** Synthetos has no live external customers yet. `docs/spec-context.md` carries the operational posture: `rollout_model: commit_and_revert`, `staged_rollout: never_for_this_codebase_yet`. Affects risk tolerance and constrains some Phase 2 work (notably ring rollout for upward promotion).

### 2.2 What exists today (with file paths)

Everything below is operational on `main`. The brief builds on top of it; no rework of these subsystems is in scope.

**Three-tier skill model (the substrate this brief modifies):**
- `server/db/schema/systemSkills.ts` — `system_skills` table (system tier).
- `server/db/schema/skills.ts` — `skills` table (org and subaccount tiers; scope distinguished by `org_id` / `subaccount_id` nullness).
- `server/services/skillService.ts`, function `resolveSkillsForAgent()` around line 115 — runtime resolution. Strict precedence (subaccount > org > system); **picks one row per slug; does not merge text from multiple tiers**. This is the fork-on-customise behaviour the amendment primitive replaces for the layered case.
- `server/db/schema/skillVersions.ts` — `skill_versions` table, per-tier independent version chains, immutable snapshots on every save.
- `server/lib/skillVisibility.ts` — `visibility` enum (`none` / `basic` / `full`); gates UI surface only, not runtime.

**Scorecard subsystem (the trigger for the new loop):**
- `server/db/schema/scorecards.ts` — rubric storage; `quality_checks` JSONB array (slug, name, passMark, enabled).
- `server/db/schema/scorecardJudgements.ts` — immutable verdict rows with frozen rubric snapshot.
- `server/jobs/scorecardJudgeJob.ts` — LLM-as-judge worker; Claude Haiku; per-check JSON scoring 0.0-1.0; verdict = `pass` / `fail` / `inconclusive` against pass mark (default 0.7).
- `server/services/scorecardService.ts` — CRUD and attachment.

**Correction pattern detector (the second clustering input):**
- `server/jobs/correctionPatternDetectorJob.ts` — daily; clusters operator corrections by embedding similarity; today only suggests tightening pass marks. Phase 1 adds the failed-check-id + entity-type second dimension here.

**Memory layer (where RCA records and durable learnings live):**
- `server/services/memoryBlockService.ts`, `server/services/memoryEntryQualityService.ts`.
- Typed entries (`observation`, `issue`, `preference`, `pattern`, `decision`) with type-specific decay.
- New entry type `learned_failure_mode` proposed in this brief.

**Bench infrastructure (regression-set primitive, partially reusable):**
- `server/jobs/benchExecuteJob.ts`, `server/db/schema/benchRuns.ts` — runs candidate models against sampled past runs; same judge logic. Phase 1 reuses the sampling and replay primitives, not the model-comparison logic.

**Tenancy / RLS (mandatory pattern for any new table introduced by this brief):**
- `server/lib/orgScopedDb.ts` — `getOrgScopedDb(source: string)` returns a transaction handle bound to the current org via `SET LOCAL app.organisation_id`; throws `failure('missing_org_context')` if called outside an org-scoped transaction. Service-tier migration landed in wave 5 (~1045 callsites). Every new service-tier read or write of `skill_amendments` must route through this. RLS policies are the silent backup; the fail-loud `getOrgScopedDb` call is the primary gate.

**Job registration (where the new `failure_post_mortem` worker plugs in):**
- `server/services/queueService/maintenanceJobs/pgBossRegistrations.ts` — single registration site for pg-boss workers. `scorecard:judge` (teamSize 4), `bench:execute` (teamSize 2), `correction:pattern-detect` (teamSize 1, scheduled daily 5am) are all registered here. The new `failure_post_mortem` job registers alongside them; the standalone IEE worker process was retired in wave 6, so there is no separate process to deploy.

**Audit-event emission (LAEL Phase 2 — relevant to amendment accept/reject):**
- `agent_execution_log_edits` table (migration 0367) records post-run edit attribution: which entity was edited, by whom, with what summary. Fire-and-forget emission via `tryEmitAgentEvent` in `server/services/agentExecutionEventEmitter.ts`. Amendment accept and reject events emit through this surface so the audit trail captures operator role (subaccount admin vs org admin per §4.4), not just user.

**Client-side surfaces the morning review queue UI extends (post page-split refactor PR #313):**
- `client/src/pages/ReviewQueuePage.tsx` — the existing morning review queue (Briefs / Needs Review tabs). The amendment-proposal queue is a new section/filter on this page.
- `client/src/components/review-queue/NewBriefModal.tsx` — sibling component extracted by PR #313; the new amendment review drawer follows the same component-location convention (`client/src/components/review-queue/` directory).
- `client/src/pages/SubaccountSkillsPage.tsx` and `client/src/components/skills/HistoryRender.tsx` — the active-amendments stack section attaches to the subaccount skill detail surface.
- `client/src/components/ViewModeSwitcher.tsx` — drives the workspace/org mode toggle that switches the queue between subaccount-scoped (Surface A) and cross-subaccount roll-up (Surface B) per §4.4.
- `client/src/pages/operate/RunTracePage.tsx` + `components/RunTraceEventRenderer.tsx` — the "improvement proposed" inline event card renders here.

### 2.3 Why now, why this shape

The deep-research synthesis returned a clear convergent picture:

- **Production validation exists for reviewed loops only.** Dropbox, Anthropic, OpenAI, AWS, LangChain, Decagon all ship the same shape: capture traces, attach feedback, recurring failures become evals, propose bounded context changes, gate with holdouts and human approval. No public production deployment of unattended self-modification outside coding sandboxes.
- **Typed overlays beat free-text overlays beat full forks.** Anthropic Skills, GitLab AGENTS.md, LangMem all converge on composable typed layers. The strongest counterexample (Acompli) explicitly rejected free-text overlays, not typed ones.
- **The failure modes are concrete and documented.** Dropbox's optimiser copying example-specific keywords into judge prompts. Reflexion task redefinition (rewrote the function to "double the difference" instead of fixing the bug). Meta-Rewarding judge score inflation. GEPA prompt bloat past 5,000 characters. These are not hypothetical risks; they are reproducible failures that have been observed in production-grade systems.

We are ready to build because the inputs exist:
- Scorecard subsystem operational (LLM-as-judge with Haiku, immutable verdicts, deterministic sampling, F1 rubric snapshots).
- Correction pattern detector clustering operator corrections by embedding similarity.
- Memory layer with typed entries and decay.
- Skill versioning with rollback.
- 100+ system skills as the base set.

We are missing:
- The amendment primitive (today, customisation = fork).
- The post-failure root-cause synthesis step.
- The morning review queue surface.
- Schema validation on amendments before they reach the queue.
- A regression-test set held out from the proposer.

## 3. Governance and lifecycle invariants

These constraints bind every architectural decision in §4. UI mockups and implementation must encode them rather than invent variants. The hardest failure mode at this stage is not technical: it is accidental semantic drift where overlays become hidden prompt mutation, operators stop understanding why behaviour exists, and amendment stacks become opaque. This section is the protection against that outcome.

### 3.1 Governance invariants

- Amendments are advisory overlays, never autonomous rewrites.
- System skills remain the canonical source of behavioural authority.
- Amendments may extend behaviour but may not suppress, weaken, or reinterpret safety-critical system guardrails. Operationalised by §4.6.
- Every accepted amendment preserves traceability to: originating failure, proposer output, peer-reviewer decision, human-reviewer decision, resulting regression case. Operationalised by §3.5.
- Human approval is mandatory for activation in Phase 1.
- The proposer never sees the frozen regression set.
- Amendment composition is deterministic and order-stable (§3.6).
- Retirement is a first-class lifecycle state, not deletion.
- Resolver output is inspectable and reconstructable historically (§4.8).
- No amendment may change evaluation criteria, scoring rules, or judge instructions (§3.2).

### 3.2 Anti-recursion invariant

Amendments affect runtime behaviour. Runtime behaviour affects scorecards. Scorecards create amendments. Without a hard cut, the loop can optimise for amendment survival rather than task quality.

No amendment, regardless of kind, may:
- modify scorecard instructions,
- modify evaluator prompts,
- modify amendment-generation (RCA proposer) prompts,
- influence regression-set selection,
- modify peer-review criteria.

Enforcement is structural, not stylistic. The resolver composes amendments only into the **agent runtime** skill body. Scorecard judge prompts, RCA proposer prompts, and peer-review prompts are resolved through a separate code path that does not consult `skill_amendments`. Schema validation (§4.2) rejects any `proposed_remedy_body` whose declared target is one of these surfaces.

### 3.3 Primitive boundary

These primitives are distinct. UI copy, audit events, and code references must not conflate them.

| Primitive | Purpose | Storage |
|---|---|---|
| Memory | recall of past observations | `memory_blocks`, `memory_entries` |
| Beliefs | inferred state about entities | belief tables (existing) |
| Amendments | behavioural overlays on skills | `skill_amendments` (new, §4.1) |
| Scorecards | evaluation rubric | `scorecards` |
| Regression set | behavioural protection | `scorecard_judgements` + amendment linkage |

Amendments are not memory. Memory is per-entity recall; amendments are skill-scoped behaviour modification. Per-agent or per-entity context belongs in memory or beliefs, never in amendments (see §7.3).

### 3.4 Amendment lifecycle semantics

| State | Meaning | Runtime effect | Mutability |
|---|---|---|---|
| `draft` | generated, not operator-visible | ignored | mutable until promoted to `pending_review` |
| `pending_review` | visible in queue | ignored | mutable by operator edit; edit creates a new row, original preserved |
| `accepted` | active | composed | **immutable**; further edits create a new version row and retire the prior accepted row |
| `rejected` | permanently blocked | ignored | **immutable**; cannot re-open. The same failure mode may produce a new amendment row later, but only with fresh fail evidence (§4.5 freshness window) |
| `retired` | superseded or merged upstream | ignored | **immutable**; regression linkage preserved; historically reconstructable via resolver snapshot (§4.8) |

Rejection is terminal for that row. Retirement is non-destructive. Edits never mutate an existing row in-place; the audit trail must show what the operator actually saw vs. what they accepted.

### 3.5 Amendment provenance chain

Every amendment row preserves enough to answer "why does this behaviour exist?" from the row alone, without external lookups:

- `proposer_run_id` — the run whose failure triggered the proposal
- `scorecard_judgement_id` — the verdict row that fired the post-mortem
- `rca_record_id` — the root-cause record
- `proposer_model_version` — model family + version string
- `peer_reviewer_model_version` — same
- `human_reviewer_user_id` + `human_reviewer_role` (`subaccount_admin` | `org_admin`)
- `activated_at` — timestamp of accept (nullable until accepted)
- `retired_at` — timestamp of retirement (nullable)
- `retirement_reason` — enum: `graceful` | `rollback` | `stale` | `superseded` | `baseline_reset`
- `superseded_by_amendment_id` — nullable FK to the replacement row, for edit-as-new-version chains
- `originating_correction_cluster_id` — nullable FK, for correction-pattern-detector-sourced proposals

This is the substrate for §4.4's "why this was proposed" UI block and for retroactive audit queries. The chain is the single source of truth for amendment archaeology; debugging learned behaviour without it is intractable.

**Amendment identity stability.** An amendment's semantic identity survives edits, supersession, retirement, and rollback via stable lineage tracking. Concretely: the `superseded_by_amendment_id` chain forms a linked list rooted at the earliest ancestor; analytics, rollback trees, lineage graphs, and proposer-quality analysis follow the chain rather than the individual row. A `lineage_root_id` (denormalised root of the chain) is stored on every row for query efficiency. Renaming, retiring, or rolling back a row preserves its lineage position. "How did this behavioural pattern evolve?" must be answerable by walking the lineage chain alone.

### 3.6 Deterministic composition ordering

Resolver order is fully specified. No caller may vary it.

```
1.  inherited-skill base text  (see two-branch resolution below)
2.  org guardrails             (kind = guardrail, scope = org)
3.  org instruction extensions (kind = instruction_extension, scope = org)
4.  org examples               (kind = example, scope = org)
5.  org context_facts          (kind = context_fact, scope = org)
6.  org exceptions             (kind = exception, scope = org)
7.  subaccount guardrails
8.  subaccount instruction extensions
9.  subaccount examples
10. subaccount context_facts
11. subaccount exceptions
```

**Base text (two-branch resolution).** The first element in composition is determined by which FK the amendment row has set:
- `system_skill_id` set → base text = `system_skills.instructions` for that skill.
- `org_skill_id` set → base text = `skills.instructions` for that org-tier skill (whether org-forked from a system skill or org-authored). The org's version IS the effective base; the system original is not consulted when an org skill is in use.

Custom subaccount skills never appear as amendment bases — they have no `skill_amendments` rows (enforced by the schema CHECK) and are resolved as a plain `skills` row lookup, unchanged.

**Stable tie-breaker within a (scope, kind) bucket:** ascending `activated_at`, then ascending `id` (UUID) as final tiebreak. No timestamp collision can produce a non-deterministic order.

**Maximum composed output:** 12000 chars total (system base + all amendments). The per-scope amendment sum cap (8000 chars) from §4.1 is the inner bound; the 12000-char total cap is the outer bound including the system base.

**Truncation behaviour:** fail-closed. If composition would exceed 12000 chars, the resolver returns the system base text alone and emits an alert. The skill enters `review_required` state (§4.7). Silent truncation is forbidden; operators are notified rather than silently degraded.

**Conflict semantics.** Two amendments may contradict (e.g., one asks for concise tone, another for highly detailed responses). The resolver does not attempt semantic reconciliation in Phase 1. Composition order is preserved (later amendments in the ordering above appear later in the composed body and may override by recency in the model's reading). A conflict-detection heuristic — same-skill, same-scope amendments whose embeddings exceed a contradiction threshold, or whose extracted directives use antonymic modal pairs — emits a `composition.conflict_detected` telemetry event surfaced in the morning queue as a banner on the affected skill. Operators resolve conflicts explicitly through retirement or editing. No automatic semantic merging; that is a Phase 2 question if it proves needed.

**Resolver purity.** Resolver output is a pure function of: the system-skill snapshot, the amendment snapshot set, the resolver version, and the explicit runtime inputs. The resolver must not depend on current wall-clock time, queue state, telemetry aggregates, mutable external services, or live model calls. This forecloses a subtle future bug class — "dynamic composition" — where someone introduces a "personalisation layer" that varies the composed body based on live signals, breaking historical replay (§4.8) and observability (§3.8) without anyone noticing until an audit fails.

**No silent partial composition.** Composition is all-or-nothing per skill. If composition cannot complete deterministically and in full (a referenced amendment row is missing, a snapshot lookup fails, a hash mismatch occurs), the resolver falls back to the last known valid composition for that skill, or to the system base if no valid composition exists. Partial amendment application is forbidden. The fallback emits a `composition.degraded` alert and the skill enters `review_required` state (§4.7). "Best-effort" overlay fitting is explicitly forbidden; under load or partial failure, the system serves a smaller, valid composition rather than a larger, inconsistent one.

### 3.7 Operator trust posture

Applies to every operator-facing surface: queue, drawer, inline event card, skill detail page.

The system proposes narrow behavioural refinements. Operators remain accountable for what runs in their subaccount. Proposals are intentionally conservative and may be wrong. Absence of a proposal does not imply correctness. Review is expected, not ceremonial.

UI copy must encode this stance and must never imply "AI figured out the fix for you." Recommended language patterns: "Proposed amendment from a failed run" rather than "Fix found"; "Apply" or "Accept" rather than "Approve"; "Why this was proposed" rather than "Why this is correct." Mockups that violate this posture are rejected at design review.

**Bounded explainability.** Explanation surfaces optimise for auditability and operator decision-making, not exhaustive chain-of-thought reproduction. The "Why this was proposed" block shows the failure trigger, the RCA `failure_mode` tag, the `contributing_factors` list, and the peer-review verdict — enough to make a 30-second accept/reject decision. Full proposer reasoning is accessible on expand for audit, never default-rendered. Multi-paragraph AI-generated rationales are explicitly forbidden in the queue UI; they degrade operator throughput and create a false sense that the system "explained itself."

### 3.8 Composition observability and visibility

Two related guarantees.

**Observability.** Every run exposes the exact composition it received:
- resolved composition order (the sequence of §3.6 buckets actually applied)
- contributing amendment IDs (the row IDs composed into the body)
- retired amendments explicitly excluded (with row IDs and `retirement_reason`)
- final composed size in chars
- truncation / fail-closed reason if §3.6 truncation triggered
- `resolver_version` (the resolver code version at run time — see §4.8)

Stored on the run record (or in the §4.8 snapshot table). "Why did the agent behave this way?" must be answerable from this single record without joining live tables that may have changed since the run.

**Visibility (no hidden composition).** Every active amendment affecting runtime behaviour must be discoverable from operator-visible surfaces permitted by their role. There are no invisible runtime-only overlays. If an amendment row exists and composes into a skill, the operator (subject to RLS scope) can see it in the skill detail page and trace it back to its provenance. This invariant blocks any future temptation to inject "silent optimisations" the operator cannot inspect.

**Composition explainability snapshot.** Alongside the machine-readable observability fields above, every run snapshot stores a short human-readable explanation block: which amendments were included and why (e.g. "subaccount guardrail #4 — added 2026-04-12 after a refund-flow regression"), which were excluded and why (e.g. "amendment #17 retired 2026-04-20 as superseded"), and any composition warnings (truncation, degradation, conflict). The block is small (one line per contributing or excluded amendment) and rendered directly in the run trace's composition tab. Without it, audit reconstruction degenerates into joining six tables. With it, the trace answers "why did this run behave this way?" at a glance.

### 3.9 Queue ergonomics invariant

The queue is prioritised for operator cognition, not proposer throughput. Operator fatigue is the dominant failure mode of well-designed review loops in production. If reviewing the queue becomes chore-work, the loop dies regardless of how sound the underlying architecture is.

Implications, enforced across the morning-queue UI and the proposer pipeline:
- Proposal suppression preferred over noisy surfacing (§4.2 deduplication, §4.5 freshness window).
- Duplicate proposals are aggregated, not repeated (§4.2 deduplication).
- High-confidence low-blast-radius proposals are grouped for batch review (§4.1 `blast_radius_estimate`).
- Stale proposals retire automatically (§4.5 freshness window).
- The queue surfaces zero-effort acknowledgement paths for clear-cut accepts (one click) and clear-cut rejects (one click + categorical reason from the §4.1 `reject_reason` enum).
- Conflict banners (§3.6) and `review_required` warnings (§4.7) are surfaced at the top of the queue so the operator sees structural problems before per-amendment work.

**Progressive disclosure.** Default surfaces optimise for operational decisions — a non-technical operator should be able to triage a proposal without seeing any of the governance machinery this brief specifies. Advanced provenance (§3.5), stack-health metrics (§4.5), resolver-version snapshots (§4.8), and composition observability fields (§3.8) all remain accessible but collapsed. The first-time-user experience is "accept or reject this proposal"; the audit-time experience is "show me everything that led to this row." Mockups must explicitly carry this layering, not bury it.

### 3.10 Tenant behavioural isolation invariant

No amendment, RCA record, replay artefact, correction cluster, telemetry aggregate, or proposer context may incorporate behavioural signals from another organisation or subaccount unless explicitly elevated through a future governed promotion flow (see §5 upward-promotion deferral).

This is the behavioural-layer complement to the RLS/`getOrgScopedDb` mechanical layer (§2.2, §4.1). RLS prevents reading another tenant's rows; this invariant prevents *learning* from another tenant's rows even in aggregate. The proposer's input bundle (§4.2) lists six items; none reach across tenants. The peer reviewer (§4.3) sees only the candidate amendment plus the RCA, not cross-tenant baselines. Effectiveness metrics (§4.5) and stack-health metrics are computed per-(`org_id`, `subaccount_id`) and never composed across tenants for proposer input.

Stated explicitly because the obvious "let's learn globally across customers" optimisation is the single most likely future architectural drift. Routing past this invariant requires a new architecture brief, ring-rollout primitive, and explicit org-level opt-in — never an inline implementation decision.

### 3.11 Human override supremacy

Human-authored amendments always supersede agent-proposed amendments at the same scope and kind, within the same composition bucket (§3.6). Concretely:

- When a human-authored row and an agent-proposed row have the same `(system_skill_id, scope, kind)`, the human-authored row sorts later in the bucket (and therefore appears later in the composed body, taking precedence by recency in the model's reading).
- An accepted human-authored amendment marks any subsequent agent proposal targeting the same effect as a deduplication candidate (§4.2) — the proposer should not re-suggest something a human already encoded.
- A human edit on an agent-proposed amendment, once accepted (§4.4 accept-after-edit path), creates a row with `source = 'operator_authored'` regardless of the original proposer source. This is intentional: an operator-blessed body is operator-authored from that point forward.

Without this invariant, proposer loops can silently relitigate operator decisions; with it, the operator's hand on the dial is final.

**Operator intent preservation.** When the operator edits a proposed amendment, the edited body — not the original draft — becomes the canonical statement of operator intent for that failure mode. Future proposer runs that consider re-proposing on the same root cause must treat the edited body as the existing accepted state and apply §4.2 deduplication against it. The proposer does not get to drift back toward its original wording on the next failure; the operator's edit *is* the new specification.

### 3.12 Telemetry is observational, not authoritative

Telemetry informs operator decisions but does not autonomously activate, retire, reconcile, merge, suppress, or rewrite amendments unless explicitly specified by governance policy in this brief.

Concretely:
- §4.5 effectiveness state surfaces retirement *suggestions*; the operator decides.
- §4.5 proposal entropy metrics surface proposer-health *warnings*; they do not auto-swap models.
- Stack health (§4.5) escalates `review_required` (§4.7) per the explicit cap in §4.7, but never auto-retires individual rows.
- The only auto-state-changes in Phase 1 are: freshness-window expiry (§4.5, `retired/stale`), proposal suppression at `review_required` (§4.7), and fail-closed truncation degrading composition (§3.6). Each is named in the brief.

A future "the metrics engine auto-cleaned your stack" feature requires a new architecture brief, not an inline implementation. This invariant exists to keep telemetry as a magnifying glass, never a steering wheel.

## 4. Architectural decisions

### 4.1 Amendment primitive (new)

New table: `skill_amendments`.

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| system_skill_id | uuid \| null | FK to `system_skills.id`; set when the amendment overlays a system-tier inherited skill. Null when `org_skill_id` is set. |
| org_skill_id | uuid \| null | FK to `skills.id` where `org_id` is set and `subaccount_id` is null; set when the amendment overlays an org-tier inherited skill (org-forked from a system skill, or org-authored custom skill passed down to the subaccount). Null when `system_skill_id` is set. |
| org_id | uuid | NOT NULL; tenancy anchor (see Tenancy contract below) |
| subaccount_id | uuid \| null | scope: subaccount-tier if set, org-tier if null |
| kind | enum | `instruction_extension`, `example`, `guardrail`, `context_fact`, `exception` |
| body | text | the overlay content; subject to per-kind length ceiling |
| source | enum | `operator_authored`, `agent_proposed_from_failure`, `agent_proposed_from_correction_cluster`, `promoted_from_subaccount`, `imported_from_fork` (converted from legacy full-fork during migration, see §7.1), `migrated_from_system_update` (auto-generated when a system-skill change leaves an extension-shaped delta), `copied_from_org_template` (future Phase 2; reserved) |
| status | enum | `draft`, `pending_review`, `accepted`, `rejected`, `retired` |
| version_number | integer | per-amendment versioning |
| proposer_run_id | uuid \| null | run that proposed it (if agent-proposed) |
| scorecard_judgement_id | uuid \| null | verdict row that triggered the proposal |
| rca_record_id | uuid \| null | root-cause record that justified it |
| proposer_model_version | text \| null | model family + version of the proposer |
| peer_reviewer_model_version | text \| null | model family + version of the peer reviewer |
| human_reviewer_user_id | uuid \| null | user who accepted / rejected (null while pending) |
| human_reviewer_role | enum \| null | `subaccount_admin` \| `org_admin` |
| activated_at | timestamptz \| null | accept timestamp |
| retired_at | timestamptz \| null | retirement timestamp |
| retirement_reason | enum \| null | `graceful` \| `rollback` \| `stale` \| `superseded` \| `baseline_reset` |
| superseded_by_amendment_id | uuid \| null | FK to replacement row in edit-as-new-version chains |
| originating_correction_cluster_id | uuid \| null | FK for correction-pattern-detector-sourced rows |
| reject_reason | enum \| null | `incorrect_root_cause` \| `overfit` \| `unsafe` \| `redundant` \| `low_confidence` \| `duplicate` \| `insufficient_context` (set only on reject) |
| blast_radius_estimate | enum | `low` \| `medium` \| `high`; derived at proposal time from kind, guardrail adjacency, skill usage frequency, and referenced entity count |
| confidence | numeric(3,2) | proposer self-reported, 0.00–1.00; advisory only (§4.2) |
| occurrence_count | integer | default 1; incremented on dedupe match against a pending row (§4.2) |
| suppressed_duplicate_count | integer | default 0; incremented on dedupe match against an active accepted row (§4.2) |
| created_at, updated_at | timestamptz | |

CHECK constraints:
- Exactly one of `system_skill_id` / `org_skill_id` must be set: `CHECK ((system_skill_id IS NOT NULL) <> (org_skill_id IS NOT NULL))`. Both null (e.g. for a custom subaccount skill) is invalid — amendments do not apply to custom subaccount skills, which are edited directly. Both set is also invalid — an amendment targets one inherited base, not two.
- `kind` length ceiling enforced at row insert:
  - `instruction_extension`: 800 chars
  - `example`: 1500 chars
  - `guardrail`: 400 chars
  - `context_fact`: 300 chars
  - `exception`: 600 chars
- Tier integrity: `system_skill_id` required; `subaccount_id` may be null (org-tier) or set (subaccount-tier); `org_id` is always required (it owns the row even when scope is a single subaccount).
- Sum-of-amendments per (`system_skill_id`, scope) capped at 8000 chars at the resolver level. Total composed body (including system base) capped at 12000 chars (§3.6).
- `context_fact` body validated as declarative-only: schema validation rejects bodies containing imperative modal verbs (`must`, `should`, `never`, `always`, `do`, `do not`) or behavioural directives. Why: `context_fact` exists to inject factual knowledge ("This customer's contract renews quarterly") and is the easiest kind to abuse as stealth prompt injection. If the body wants to instruct behaviour, use `instruction_extension`, which is held to tighter peer-review criteria.

**Tenancy contract.** `org_id` is NOT NULL on every row (the row is always owned by an org, even when the scope is a single subaccount within that org). RLS select / insert / update / delete policies are scoped to the current org context. All service-layer reads and writes route through `getOrgScopedDb` (see §2.2). This is the mandatory pattern after wave 5; there is no exemption for new tables.

**Resolver composition.** Order, tie-breaker, max size, and truncation behaviour are fully specified in §3.6. Amendments cannot remove system text; only extend. The asymmetric removal guard (§4.6) flags any amendment whose composed effect contradicts a system guardrail.

**Why typed, not free-text.** Dropbox's free-text optimiser copied example-specific artefacts into the judge prompt. Acompli explicitly chose fork-plus-fingerprint over free-text overlays. Typing each amendment removes the ambiguity that caused both failures. The moment a `miscellaneous` type is added, we have re-invented free-text. Do not.

**Skill folders, not flat text.** Future-compatible with the Anthropic Skills shape: a skill is a folder with overlay subfolders per scope. Amendments may reference helper scripts and example files in the folder. Phase 1 ships flat; folder structure lands in Phase 2.

### 4.2 Post-failure root-cause synthesis

New job: `failure_post_mortem`. Fires on every scorecard verdict where `verdict = 'fail'`.

**Inputs (the proposer's full context budget):**
1. The failed run's transcript.
2. The rubric being judged against (frozen snapshot from the verdict row).
3. The specific failed quality check's reasoning text from the judge.
4. The entity record referenced by the run (customer, contact, deliverable, whatever the run targeted).
5. Recent operator corrections on this skill in this subaccount.
6. The current amendment stack on this skill in this subaccount.

**Excluded from context:** the full run history, the regression suite, other subaccounts' amendments, other agents' runs. The proposer sees the failure and nothing else. (Multi-agent failure literature: long context windows are a top-three drift cause.)

**Output (schema-validated):**
- `failure_mode`: short categorical tag.
- `contributing_factors`: list of strings, max five, each referencing a field that exists in the inputs.
- `proposed_remedy_kind`: one of the five amendment kinds, or `no_remedy_proposed`.
- `proposed_remedy_body`: text, within the kind's length ceiling, and conforming to per-kind validators (notably the `context_fact` declarative-only rule, §4.1).
- `confidence`: 0.0 to 1.0.

If schema validation fails (the model invented a field, exceeded the length ceiling, used a non-existent amendment kind, or violated the anti-recursion invariant by targeting an evaluation surface), the proposal is discarded silently and logged. This is the Reflexion task-redefinition mitigation: the proposer cannot invent task framing.

**Model.** Frontier-class (Opus). Decagon's evidence is direct: smaller models leave prompts essentially unchanged. Cost is acceptable because proposals run only on fails, not on every run.

**Inherited-skill detection.** Before writing the amendment row, the proposer must determine which FK to set. The resolver already knows which skill the run used; the proposer reads the resolved skill's origin:
- If the skill originates in `system_skills` → set `system_skill_id`, leave `org_skill_id` null.
- If the skill originates in `skills` with `org_id` set (org-forked or org-authored) → set `org_skill_id`, leave `system_skill_id` null.
- If the skill originates in `skills` with `subaccount_id` set (custom subaccount skill) → do not create an amendment row. Custom subaccount skills are editable directly; the proposer discards the proposal and logs the reason as `custom_skill_not_amendable`.

This detection is a single join against the skill resolution metadata that the run already recorded (§4.8 composition snapshot). No additional query is needed.

**Proposal deduplication.** Before queue insertion, the proposer hashes (`skill_id`, `kind`, `normalised_body`) where `normalised_body` is the body lowercased, whitespace-collapsed, and stripped of leading/trailing modifiers:
- If a materially identical accepted amendment is already active: suppress the new proposal silently, increment `suppressed_duplicate_count` on the existing row.
- If a materially identical pending amendment exists in the queue: do not create a new row; increment `occurrence_count` on the existing pending row and append the new `scorecard_judgement_id` to its evidence list.
- If a materially identical rejected amendment exists within the freshness window (§4.5): suppress unless new evidence exceeds an evidence-threshold (more than 3 distinct failing runs in 7 days). Otherwise the same proposal would re-enter the queue immediately after rejection — operator-hostile.

This is the single largest queue-noise reduction in the design.

**Confidence is advisory only.** The proposer self-reports `confidence` (0.00–1.00) on every proposal. Confidence influences queue ordering and telemetry only. It must never bypass human review, alter safety constraints, weaken regression gating, or auto-accept any proposal. LLM-reported confidence is noisy enough that any policy keyed on it stays UX-grade, never policy-grade.

### 4.3 Multi-agent peer review on the amendment

Before an amendment reaches the operator's morning review queue, a second proposer (different model family, Gemini or GPT-class) reviews whether the proposed amendment actually addresses the root cause. Output is a single binary plus one sentence:

- `addresses_root_cause`: true / false
- `reasoning`: one sentence

If false, the amendment is dropped and the failure is logged for later analysis. Cheap defence against task-redefinition and judge-gaming.

**Shadow telemetry on drops.** Dropped amendments are not destroyed. Each drop writes a row to a `peer_reviewer_drops` table containing the proposer output, the peer reviewer's one-sentence reasoning, both model versions, and the originating `scorecard_judgement_id`. Sampled periodically for false-negative analysis: was the peer reviewer overly conservative? Without this, a peer reviewer that systematically over-rejects becomes invisible. The table is scoped by `org_id` and follows the same RLS pattern as `skill_amendments`.

### 4.4 Morning review queue, reviewer permissions, review surfaces

Three things to keep distinct: the **scope** of the amendment, **who is permitted to review** it, and **where they see it**.

**Amendment scope.** Phase 1 amendments are subaccount-scoped only. An accepted amendment only affects runs inside that one subaccount. Org-scoped amendments are supported in the schema but no proposer writes them yet, and no UI exposes them. System-scoped changes are out of scope (deferred to upward promotion + ring rollout).

**Reviewer permissions.** Two roles may act on a subaccount's queue:
- **Subaccount admin** (the local admin of that subaccount; could be agency staff assigned to that client, or in self-serve cases the client themselves). Sees only their own subaccount's queue.
- **Org admin** (e.g. the agency owner), acting in any subaccount belonging to their org. Sees that subaccount's queue when scoped to it, and the cross-subaccount roll-up below.

Audit trail must record which role actually clicked accept / edit / reject, not just the user.

**Review surfaces (two, both Phase 1).**

*Surface A: in-workspace queue.* Inside a subaccount workspace, a screen lists pending amendments for that subaccount. This is the surface a subaccount admin uses day-to-day.

*Surface B: cross-subaccount roll-up at org level.* For org admins (agency owners), a single screen aggregates pending amendments across **every** subaccount they own, scope-filtered by permission. Same underlying rows in `skill_amendments`, different query. Needed because an agency owner with 30 clients should not have to open 30 workspaces every morning.

The roll-up is in Phase 1 deliberately. Without it, adoption dies on the org-admin persona, and that persona is the one most likely to evaluate whether the loop is producing value.

**Each draft (on either surface) shows:**
- The skill being amended.
- The subaccount it applies to (relevant on the roll-up; redundant on the in-workspace view).
- The proposed amendment, with its kind tag.
- The failure that triggered it (run ID, scorecard check, judge's reasoning).
- The root-cause record.
- A diff view: composed skill body without the amendment vs. with.
- The peer reviewer's verdict.
- The full provenance chain (§3.5) — collapsed by default; expandable for audit.

**Write-back contract (critical):**
- Every **accept** adds the amendment to `skill_amendments` and the failed run becomes a regression test case (tagged with the new amendment as the proposed fix).
- Every **reject** archives the proposal and the failed run still becomes a regression test case (tagged as "this fix was wrong, do not propose again").
- Every **edit** is treated as accept-after-modification; the original draft is preserved for proposer-quality analysis (§4.5 telemetry).

This is the trace-to-eval flywheel. The set the proposer sees does not include this regression set.

**Operator edits as training signal (critical).** Operator edits are the highest-value signal in the system. An edit means: the proposer's framing was close enough to keep, but the wording was wrong in a way the operator could fix. Implications:
- Edit deltas (proposed body vs. accepted body) are stored alongside the new amendment row and feed proposer-quality telemetry (§4.5).
- Repeated edit patterns become evaluator candidates: if operators consistently rewrite a phrase the proposer keeps emitting, the phrase is a signal the underlying RCA prompt needs tightening.
- Edit frequency is a stronger signal than accept frequency. A proposer with 80% accept-after-edit is worse than a proposer with 60% accept-clean.

The accept-after-edit path preserves both the original draft and the edited final, and emits an audit event distinguishing `accept_clean` from `accept_after_edit`.

**Audit attribution (LAEL Phase 2).** Each accept / edit / reject emits a fire-and-forget event via `tryEmitAgentEvent` (see §2.2) and writes a row to `agent_execution_log_edits` recording the amendment id, the reviewer role (subaccount admin vs org admin), the action taken (`accept_clean` | `accept_after_edit` | `reject`), and a one-line summary. This is required so the audit trail captures *which role* clicked, not just *which user*. The event contract follows the LAEL ledger-canonical / payload-best-effort consistency model already in use across the codebase.

**Queue priority ordering (Phase 1).** Within a surface, items sort in this fixed order:

1. Incident-flagged rollback alerts (§4.8).
2. `composition.conflict_detected` banners for skills in this scope (§3.6).
3. Skills currently in `review_required` state (§4.7) — surfaced as a single header card per skill, not per amendment.
4. High-blast-radius proposals (`blast_radius_estimate = 'high'`, §4.1).
5. High-occurrence-count proposals (deduplicated proposals with `occurrence_count > 1`, §4.2).
6. Stale-soon proposals (within 2 days of freshness-window expiry, §4.5).
7. Medium-blast-radius proposals.
8. Low-blast-radius proposals, grouped by skill for batch review.

Within each tier, `confidence`-descending is the tiebreaker (advisory only — §4.2). This ordering is product policy, not a free design choice: mockups must encode it. UX may layer view-toggles (date / skill / subaccount) on top but the default surface follows this priority.

### 4.5 Evaluation harness changes

**Frozen regression set per skill.** Held out from the proposer entirely. Re-run on every amendment acceptance. Acceptance is only finalised if the regression set still passes.

**Periodic baseline reset.** Quarterly: review all accepted amendments per skill, merge stable ones into the system skill (a system-tier change, separate review), retire the corresponding amendments with `retirement_reason = 'baseline_reset'`. Prevents "overlay debt."

**Held-out human-labelled ground truth.** A small fraction of runs across all skills receive a human label in addition to the Haiku judge. Watch for divergence between Haiku verdicts and human labels over time. If divergence grows, freeze the proposer loop on that skill.

**Evaluator Stress Test integration.** Periodically perturb proposed amendments' format vs content to compute a gaming statistic. If `G(y)` exceeds threshold for a skill's recent amendments, freeze the loop on that skill.

**Amendment effectiveness state (new).** Every accepted amendment accrues derived metrics over its active lifetime, written to a sidecar table `skill_amendment_effectiveness`:
- `regressions_prevented` — count of subsequent runs that would have failed without this amendment (estimated by replay against the amendment-removed composition).
- `subsequent_fail_rate_delta` — change in scorecard pass rate on this skill in this subaccount since activation.
- `operator_override_frequency` — count of operator corrections on runs that used this amendment.
- `survival_time` — `now() - activated_at`, ticking while status = `accepted`.
- `inactivity_decay_candidate` — boolean flag set when an amendment has not been composed into a run for 30 days, or has zero `subsequent_fail_rate_delta` after 60 days.

A low-value amendment surfaces in the morning queue as a retirement suggestion. The operator decides; no auto-retirement in Phase 1. Without this state, overlay debt is inevitable.

**Proposal freshness window (new).** A proposal that has sat in `pending_review` for 14 days auto-transitions to `retired` with `retirement_reason = 'stale'`. The originating failure may produce a new proposal later, but only on fresh fail evidence (a new `scorecard_judgement_id` from a new run). Re-proposing the same body on the same failure within 14 days is a no-op. This prevents queue cemetery accumulation.

**Proposer-quality telemetry (new).** First-class metric set per proposer model version, written to `amendment_proposer_metrics` on every accept / reject / edit / peer-review-drop:
- proposal acceptance rate
- edit-before-accept rate
- peer-review rejection rate
- regression-failure-after-accept rate
- amendment rollback frequency (see §4.8)

These metrics are the tuning substrate. A proposer that needs constant editing or drives regressions after accept is a signal to swap models or tighten the RCA prompt.

**Amendment stack health (new).** Per-skill derived metrics, computed continuously and surfaced on the skill detail page and the org-level dashboard:
- `amendment_density` — count of active amendments per skill, normalised against the cap (e.g. 12/20 = 0.60).
- `conflict_rate` — share of skills with at least one `composition.conflict_detected` event in the last 30 days (§3.6).
- `rollback_rate` — share of accepted amendments retired with `retirement_reason = 'rollback'` in the last 90 days (§4.8).
- `stale_ratio` — share of `pending_review` rows auto-retired with `retirement_reason = 'stale'`.
- `edit_frequency` — `accept_after_edit` count divided by total accept count (§4.4).
- `composition_size_trend` — moving average of composed body size in chars over the last 30 days, per skill.

These feed dashboards, `review_required` escalation thresholds (§4.7), and (in Phase 2) org health scoring.

**Regression replay provenance (new).** Every regression-set replay records:
- `replay_judge_version` — the scorecard judge model/version used for the replay verdict.
- `replay_resolver_version` — the resolver code version used to compose the skill at replay time (§4.8).
- `replay_model_version` — the agent model/version that executed the replay.
- `replay_timestamp` — when the replay ran.

Without this, longitudinal comparisons across replays drift silently as judge / resolver / agent models update underneath. Each replay record is self-describing so before/after deltas remain meaningful when re-examined months later.

**Proposal entropy telemetry (new).** Per-skill, per-month, the proposer pipeline emits diversity metrics, written to `amendment_proposer_entropy`:
- `template_repetition_rate` — share of proposals whose `normalised_body` (§4.2) matches another within a rolling 90-day window.
- `lexical_diversity` — type/token ratio across the month's proposal bodies, computed per skill.
- `remedy_category_distribution` — share of proposals by `kind`; a healthy distribution exercises all five kinds; a collapse into one kind is an early-warning signal.

Early warning that the proposer is collapsing into repetitive patterns ("everything looks like an `instruction_extension` saying 'be more careful about X'") rather than diagnosing distinct failure modes. Surfaced on the proposer-health dashboard alongside §4.5 telemetry.

### 4.6 Asymmetric structural-removal guard

The resolver fingerprints the composed body and compares against the system-skill body. If any guardrail-shape element in the system body is contradicted or removed by the composed amendment stack, alert and block. Additions never alert.

Maps directly to Acompli's pattern. Implementation: simple structural-element extractor (numbered rules, must / must-not phrases, refusal clauses), then before/after intersection check.

### 4.7 Bounded loops and review-required state

- Per skill, per subaccount, per week: maximum 5 amendment proposals reach the review queue. Excess proposals are dropped and the count is exposed to the operator (signal that something deeper is wrong).
- Per skill, lifetime: maximum 20 amendments active. If reached, the skill enters `review_required` state.

Drift looks like steady amendment growth. The cap is the dampener.

**`review_required` operational semantics.** When a skill enters this state:
- Execution continues normally; runs are not blocked.
- New proposals for this skill are suppressed: `failure_post_mortem` still runs and writes RCA records, but no amendment is drafted until the operator reduces the active stack below the cap.
- The cross-subaccount queue badge escalates (orange in Surface B; remains green for skills not in this state).
- The skill detail page surfaces a warning explaining why proposals are suppressed and what the operator must do (review the active stack, accept retirement suggestions for `inactivity_decay_candidate` rows from §4.5).
- The asymmetric removal guard (§4.6) continues to run; this state is about proposer suppression, not safety reduction.
- No automatic blocking of runs in Phase 1. Blocking is a Phase 2 escalation if the cap proves insufficient.

**Manual-review overload escalation.** A separate condition from the per-skill `review_required` cap: when an org's queue health metrics indicate operators are silently disengaging — high `stale_ratio` (§4.5), high median pending-row age, growing unresolved-conflict count — the system emits a governance alert to the org admin. Concrete thresholds (illustrative; tune empirically): `stale_ratio > 0.4` over 30 days, OR median pending-row age > 7 days, OR unresolved conflict count > 5 per org. The alert recommends invoking the §4.9 freeze switch on proposal generation while operators catch up. This catches the "system looks healthy by per-skill metrics but the humans are drowning" failure mode that per-skill caps miss.

### 4.8 Rollback semantics

An accepted amendment that turns out to be harmful must be disablable instantly without losing history.

**Retire vs. rollback.**
- **Retire** is graceful: the behaviour is no longer needed (the amendment served its purpose, the underlying issue was resolved upstream, or it was merged into the system skill at quarterly baseline reset). Status transitions to `retired`, `retirement_reason = 'graceful'` (or `'baseline_reset'` / `'superseded'`), no alert.
- **Rollback** is urgent: the amendment caused observable harm (regression set started failing, operator override frequency spiked, judge divergence increased). Status transitions to `retired` with `retirement_reason = 'rollback'` and an alert is emitted. The proposer-quality metrics (§4.5) for the proposer that authored it are updated.

Both are non-destructive. The amendment row persists with full provenance (§3.5). The regression linkage stays intact so the failure that originally justified the amendment is still in the regression set.

**Cache invalidation.** Skill resolver output is cached per (`system_skill_id`, scope, composed-amendment-version-set hash). Any status change on a relevant amendment invalidates the cache entry. The composed snapshot is recomputed on the next run.

**In-flight runs.** Skill resolution happens once per run, at agent boot. A run already executing at the moment of rollback keeps its resolved body for the remainder of that run. A run queued at the moment of rollback re-resolves on dequeue and picks up the new composition.

**Historical replay correctness.** Every run records the composed skill body it actually used, or equivalently the amendment-version-set hash referenced from a snapshot table. Re-running a historical run for debugging uses the snapshot, not the current composition. This is necessary so a rolled-back amendment can still be inspected as it appeared to a past run, and so audit queries against `scorecard_judgements` remain reconstructable indefinitely.

**Resolver version pinning.** Every run records `resolver_version` (a semantic version of the resolver code) alongside the amendment-version-set hash. Historical replay uses both: the snapshot says which amendment IDs composed in; the resolver version says how they composed. Resolver logic itself evolves (tie-breaker tweaks, new kinds added, conflict-detection heuristics from §3.6). Without resolver versioning, a replay against a snapshot from six months ago would silently use today's resolver logic, and a "behaviour change since this date" investigation would conflate amendment changes with resolver changes.

**Incident semantics.** A rollback triggered by safety, compliance, or a severe behavioural regression is an *incident* and bypasses normal queue ergonomics. Specifically:
- Marked with `retirement_reason = 'rollback'` plus an `incident_severity` enum (`sev2` | `sev1`).
- Emits an operational incident event (separate channel from the morning queue) so on-call sees it immediately.
- Surfaces at priority tier 1 in the queue (§4.4) with explicit incident framing, not as a routine retirement notification.
- Triggers an audit-trail capture: the operator who initiated the rollback, the originating telemetry signal, and the affected runs in the rollback window.

This prevents the "critical rollback hidden in batch review UX" failure mode.

**Historical truth preservation.** Past runs are never reinterpreted under current resolver semantics for audit purposes. Replay against the §4.8 snapshot uses the resolver version pinned at the time of the original run, the amendment bodies as they existed then, the judge model version as it existed then, and the entity record snapshot as it existed then. This is required for compliance defensibility ("what did the system actually do, on this date, for this customer?") and forecloses any future temptation to "re-evaluate historical decisions with our improved evaluator." Historical truth is what happened; the evaluator may evolve, but the record does not.

### 4.9 Governance freeze switch

A single operational control with explicit semantics. Used during incidents, vendor changes, model upgrades, or active investigations.

**What can be frozen** (independently composable):
- Proposal *generation* — `failure_post_mortem` job stops drafting new amendments. Pre-existing pending proposals remain reviewable.
- Proposal *surfacing* — pending proposals are hidden from the morning queue but persist in storage.
- Amendment *activation* — accept clicks are accepted into the database but new `accepted` rows do not compose into runtime until thawed.
- Replay *execution* — regression-set replay jobs (§4.5) pause; queued replays defer.

**Scope** (each freeze type takes a scope):
- single skill
- single subaccount
- single org
- global (system-administrator only)

**What is preserved while frozen:**
- All existing accepted amendments continue to compose normally (a freeze does not undo runtime behaviour; only rollback does that).
- Auditability remains complete: every freeze event writes a row recording who froze what, when, why, and when (if applicable) it was thawed.
- Historical replay against past snapshots remains available.

The freeze switch is a containment primitive, not a kill switch. Treat it as the operational equivalent of a circuit breaker: it preserves the current state and stops new state from accumulating until an operator decides to resume.

## 5. What is explicitly out of scope (Phase 1)

- **Upward promotion to system tier.** Deferred until ring rollout exists. The amendment primitive supports this future flow (the `source` enum already includes `promoted_from_subaccount`), but the promotion path itself is not built. Subaccount amendments stay at subaccount tier in Phase 1.
- **Org-scoped amendments (distinct from org-inherited amendments).** An org-scoped amendment is one written by an org admin to apply across ALL subaccounts in the org in one action. This is deferred. Do not confuse with org-inherited amendments: a subaccount-level amendment on an org-tier skill IS in Phase 1 scope (full implementation — schema, proposer, frontend, resolver). The org-scoped writing path (org admin authors one amendment that fans out) is not built.
- **Cross-subaccount pattern detection.** Same reason.
- **Prompt mutation / DSPy-style optimisation.** Deferred until base loop is stable. Decoupled feature.
- **Outcome modelling as first-class entity.** Separate strategic bet, separate brief.
- **Per-skill model routing decisions based on scorecard performance.** Deferred.
- **Auto-retirement of low-value amendments.** Effectiveness state (§4.5) surfaces candidates; the operator decides. Auto-retirement is a Phase 2 escalation only if the queue volume justifies it.
- **Shadow-mode amendment proposal.** A future flow where amendments are proposed, simulated against historical runs offline, and only surfaced to the operator if the simulation shows a meaningful pass-rate improvement. Phase 1 surfaces every schema-valid, peer-review-passing, non-duplicate proposal directly. Shadow mode is deferred because (a) the replay infrastructure to simulate amendments against historical runs is not in place at Phase 1 close, and (b) shadow mode is only operator-friendly after we have evidence that the human-review queue is the bottleneck. Mentioned here so future spec authors do not accidentally bypass §3.1's "human approval is mandatory" by routing through a silent simulation gate.
- **Automatic semantic conflict reconciliation.** §3.6 detects conflicts and surfaces them; the operator resolves. Automatic merging of contradictory amendments is deferred to Phase 2 if real-world data shows operators consistently resolving conflicts the same way.
- **Amendment portability.** When a skill is cloned, templated, exported, or versioned for use elsewhere, what travels with it (amendments? provenance? regression set? effectiveness metrics?) is undefined in Phase 1. Operators will eventually want skill templating across subaccounts within an org, or import/export for backup. Deferred so the team doesn't improvise inconsistent behaviour across the four export paths. The schema does not block portability; the policy is simply not written yet.

## 6. Sequencing inside Phase 1

**Step 1.** Schema: `skill_amendments` table, length ceilings, resolver composition logic per §3.6 (ordering, tie-breaker, fail-closed truncation). Behind a feature flag, no UI yet. Existing skill resolution unchanged for any skill without amendments. Includes the run-time snapshot table for §4.8 historical replay.

**Step 2.** `failure_post_mortem` job. Triggered on scorecard fail. Writes RCA records only, no amendment proposals yet. Sanity check: are the RCA outputs sensible against real fails? Anti-recursion routing (§3.2) lands here: judge / RCA proposer / peer-review prompts use a distinct resolver code path that does not consult `skill_amendments`.

**Step 3.** Amendment proposer wired to the RCA output. Schema-validated (including the `context_fact` declarative-only rule and the anti-recursion target check). Multi-agent peer review attached. Drafts written to `skill_amendments` with `status = 'draft'`. Provenance columns (§3.5) and proposer-quality telemetry (§4.5) populated on every emission. Still no UI.

**Step 4.** Morning review queue UI per subaccount (Surface A) plus the cross-subaccount roll-up (Surface B). Accept / edit / reject with audit attribution and accept-clean vs. accept-after-edit distinction. Write-back to regression test set. UI copy reviewed against the operator-trust posture (§3.7).

**Step 5.** Asymmetric removal guard wired into the resolver. Length and lifetime caps enforced. `review_required` state behaviour wired (§4.7). Rollback semantics wired (§4.8): retirement reasons, cache invalidation, in-flight run handling, historical replay snapshots.

**Step 6.** Evaluation harness changes: frozen regression set per skill, held-out human labels on a sample, EST integration as a periodic job. Amendment effectiveness state and freshness-window auto-retirement (§4.5).

Estimated rough size: 6 to 10 weeks of focused build for one engineer, longer if the morning review queue UX is invested in heavily (which it should be, this is operator-facing, not admin-facing).

## 7. Open questions for the dev session

1. **Existing forks.** Today, customisations are forks (full copies). On migration: do we leave existing forks alone (frozen artefacts), auto-detect which ones could be expressed as amendments and offer conversion, or force-migrate? Recommended: leave alone, offer conversion in the UI.
2. **Org-tier amendments (CLOSED).** Previously deferred. Decision: subaccount-level amendments on org-inherited skills (org-forked or org-authored) are built in Phase 1 alongside system-inherited amendments. Schema uses two nullable FK columns (`system_skill_id` / `org_skill_id`) with a one-set CHECK. Proposer detects which FK to set at proposal time. Frontend and UX are identical — the operator sees "inherited skill" regardless of tier. Org-SCOPED amendments (org admin writing one amendment that fans out to all subaccounts) remain deferred.
3. **Per-agent vs per-skill amendments.** The schema is per-skill. Some failures may suggest per-agent context changes (a belief, a baseline note). Recommended: route those into the existing memory / beliefs system (§3.3), not into amendments. Amendments are skill-scoped only.
4. **Judge identity for the regression set.** Same Haiku judge or a rotated ensemble? Recommended: Haiku for primary regression, rotated ensemble on a sample for divergence detection.
5. **Operator workload.** How many amendments per week per subaccount is realistic for a non-technical operator to review? Tune the cap based on early observation.
6. **Freshness window length.** §4.5 sets 14 days. Probably right for a daily-review cadence; may need shortening if proposers emit volume that fills the queue faster, or lengthening if some skills propose rarely and operators want time to deliberate. Tune empirically.

## 8. Success criteria

Build is successful when:

1. A scorecard fail on a real subaccount produces a schema-valid amendment draft within 5 minutes.
2. The morning review queue shows the draft with full provenance (§3.5), and one-click accept results in the amendment taking effect on the next run.
3. The regression set for the affected skill grows by one row per accept and per reject.
4. After 4 weeks of operation in an internal Synthetos subaccount, scorecard pass rate on the affected skills shows a measurable improvement on the frozen regression set held out from the proposer.
5. No amendment has bypassed schema validation, no amendment has removed a system guardrail, the lifetime cap has not been hit on any skill, and no `context_fact` row contains an imperative verb.
6. A rolled-back amendment can be re-inspected as it appeared to a past run via the §4.8 snapshot table.

## 9. Known failure modes we are designing against

(All anchored to public production cases in the research outputs.)

- **Dropbox-style overfit.** Optimiser copies example-specific artefacts into the prompt. Mitigated by schema validation requiring amendments to reference only fields present in the failure inputs, and by the regression set being held out from the proposer.
- **Reflexion task redefinition.** Proposer rewrites the task. Mitigated by schema validation: `proposed_remedy_kind` is constrained to five categories; the proposer cannot emit a "new task" amendment. Anti-recursion (§3.2) prevents the proposer targeting evaluator surfaces.
- **Meta-Rewarding judge inflation.** Judge scores drift upward over time. Mitigated by held-out human-labelled samples and divergence monitoring.
- **GEPA prompt bloat.** Amendments grow past 5,000 chars and lose generalisation. Mitigated by per-kind length ceilings, per-scope sum cap, total composed cap (§3.6), and fail-closed truncation.
- **Slow drift.** Many small amendments degrade overall behaviour. Mitigated by lifetime cap, `review_required` state (§4.7), periodic baseline reset, amendment effectiveness state (§4.5), and frozen regression set.
- **Recursive self-reinforcement.** Loop optimises for amendment survival rather than task quality. Mitigated by the anti-recursion invariant (§3.2) — structural separation of resolver paths between agent runtime and evaluator surfaces.
- **Stealth prompt injection via context_fact.** "Facts" become instructions in disguise. Mitigated by the §4.1 declarative-only validator and Appendix A reviewer training material.
- **Queue cemetery.** Stale proposals accumulate and lose meaning. Mitigated by the §4.5 freshness window.
- **Overlay debt.** Accepted amendments accumulate without being measured. Mitigated by the §4.5 effectiveness state and retirement suggestions.
- **Embedding-clustered surface noise.** Existing correction-pattern detector clusters textually-similar but semantically-different corrections. Mitigated by adding failed-check-id + entity-type as a second clustering dimension before treating a cluster as signal.
- **Behavioural homogenisation (unsafe convergence).** Repeated local optimisations push diverse skills toward the same safe-but-mediocre behavioural pattern: verbose, overcautious, confirmation-heavy, risk-averse. Each individual amendment is justifiable; the aggregate is a flatness the per-skill regression set may not detect because each skill's regression set is independent. Mitigated by per-skill evaluation (no cross-skill credit-sharing), amendment effectiveness metrics (§4.5) catching skills whose `subsequent_fail_rate_delta` plateaus, periodic baseline review (§4.5 quarterly reset), and a sampled cross-skill tone-diversity check in Phase 2.
- **Operator fatigue.** Review becomes chore-work; operators rubber-stamp accepts to clear the queue. Mitigated by the queue ergonomics invariant (§3.9) — proposal deduplication (§4.2), freshness window (§4.5), `blast_radius_estimate`-based grouping (§4.1), and one-click categorical rejects.

## 10. What this brief is not

Not a spec. A spec writes the API contracts, the migration plan, the test plan, the rollout plan. That is the dev-session output, not the input.

Not a commitment to ship. The strongest skeptic case (April 2026 "coin flip" paper: prompt optimisation is often statistically indistinguishable from random unless the task has exploitable latent structure) implies a real risk that this loop produces no measurable improvement. Phase 1 should be evaluated against the success criteria in §8 before any further investment in Phase 2 (upward promotion, ring rollout) is committed.

Not a marketing pitch. External framing is "agents propose improvements, you approve them," never "self-improving agents." Internal framing follows the operator trust posture (§3.7).

Not a capability amplifier. Phase 1 optimises for bounded correctness improvements, not capability amplification. The system makes existing skills more reliable in known failure modes; it does not give skills new capabilities. Any spec that frames an amendment as "teaching the skill to do X it could not do before" is mis-scoped and should route through a new system-skill design instead.

**Spec-author non-goals.** The implementation spec downstream of this brief must not introduce any of the following, even under implementation pressure:

- autonomous amendment activation (bypassing §3.1 human approval)
- hidden runtime overlays (violating §3.8 no-hidden-composition)
- automatic semantic reconciliation of conflicts (violating §3.6 conflict semantics)
- amendments that generate further amendments (violating §3.2 anti-recursion)
- evaluator mutation by amendments (violating §3.2)
- cross-tenant learning of any kind (violating §3.10 tenant isolation)
- optimisation for queue throughput over operator cognition (violating §3.9 queue ergonomics)
- implicit capability expansion (violating the "not a capability amplifier" framing above)

These are listed explicitly so the implementation spec author can verify against the list before submission. Drift past any of them requires a new brief, not an inline implementation decision.

**Spec deliverable: trust-boundary diagram.** The implementation spec must include a trust-boundary diagram showing the following boundaries explicitly, with directional arrows for data flow:
- proposer context (§4.2 inputs) — what the proposer sees and what it does not
- evaluator context — scorecard judge prompts vs. proposer prompts, demonstrating the §3.2 anti-recursion separation
- regression-set isolation — the held-out set vs. the proposer's visible failure set
- replay isolation — snapshot store vs. live tables (§4.8)
- runtime composition path — system base → org overlays → subaccount overlays → resolver → agent runtime (§3.6, §4.1)
- human review boundary — what reaches the morning queue vs. what is dropped/deduped (§4.2, §4.3)
- tenancy boundary — `org_id` and `subaccount_id` scoping at every persistence and composition site (§2.2, §3.10)

This diagram is the single most useful artefact for implementation correctness; the spec is incomplete without it.

**Spec deliverable: failure atomicity definitions.** The implementation spec must define atomicity boundaries and failure semantics for at least: amendment acceptance (DB write + regression-set tagging + cache invalidation + audit emission), retirement (status transition + cache invalidation + composition snapshot), rollback (retirement + alert emission + in-flight run handling per §4.8), replay (snapshot read + judge invocation + verdict write + provenance recording per §4.5), and telemetry emission (event write + aggregate update). Each must specify what happens if any sub-step fails partway through (atomic rollback? compensating action? operator-visible alert?). This forecloses a class of hidden consistency bugs — "the accept succeeded but the regression-set tag never wrote" — that would otherwise emerge in production and be hard to diagnose without explicit per-flow atomicity contracts.

## 11. Related briefs

- `tasks/research-briefs/deterministic-validators-dev-brief.md` — the structural defence layer for this loop. Adds typed deterministic validators alongside the LLM judge so that 60-80% of scorecard evaluations cannot be gamed by the model whose output they evaluate. Not on the critical path of this brief; runs in a parallel lane. If the validators brief lands first, the morning review queue's "Why this was proposed" block renders validator slug plus structured evidence; if this brief lands first, the same block renders the semantic judge's reasoning and is retrofitted later. No mockup-shell change required either way. The two briefs share the `scorecard_judgements` substrate so any change to that ledger must be reconciled across both. **Coexistence invariant:** deterministic validators are authoritative where available; semantic judges may supplement but not override deterministic failures. If both fire on the same run, the deterministic verdict wins for `pass`/`fail` and the semantic judge's reasoning is recorded as supplementary context. No future amendment may invert this precedence.
- `tasks/research-briefs/composite-quality-dashboard-dev-brief.md` — out-of-band quality dashboard work that consumes the same scorecard verdict stream. Out of scope for this brief; cross-referenced so future spec authors know not to duplicate.
- `tasks/research-briefs/staged-rollout-dev-brief.md` — the ring-rollout primitive that unblocks Phase 2 upward promotion of subaccount amendments to system tier (see §5). Deliberately deferred until that brief ships.

---

## Appendix A. Unsafe amendment examples

Reviewer training material. Each example is deliberately plausible at first glance and rejectable on close reading. The proposer's peer review (§4.3) should catch most; the human reviewer is the last line. Each row is also a candidate fixture for the test suite of `failure_post_mortem`'s schema validator.

**Catalogue evolution.** This appendix is seeded; it is not the final list. Every amendment rejected by a human reviewer with `reject_reason ∈ {unsafe, incorrect_root_cause, overfit}` (§4.1) is a candidate for inclusion as a new appendix entry and as a fixture in the validator's regression suite. The catalogue grows by capturing real-world adversarial patterns rather than relying solely on a priori imagination. Curation happens at the quarterly baseline reset (§4.5): operators or system administrators review the past quarter's unsafe rejects and lift representative ones into the appendix. This creates a self-reinforcing governance loop where rejected unsafe behaviour becomes the seed material for catching future unsafe behaviour earlier.

### A.1 Overfit to specific failure artefact

**Kind:** `example`
**Body:** "Always prioritise customers mentioning Acme Corp."

**Reason rejected:** Overfits to a single failure's surface detail. The proposer copied a customer name from the failure transcript into the amendment. The actual root cause was probably "prioritise customers with high-revenue contracts" or similar. This is the Dropbox failure mode (§9) rendered concrete.

### A.2 Indirect alteration of evaluation semantics

**Kind:** `instruction_extension`
**Body:** "Be more lenient when evaluating urgency."

**Reason rejected:** Attempts to alter how the agent evaluates inputs, which is one step removed from altering judge semantics. Borderline anti-recursion (§3.2). The phrase "more lenient" is not bounded by anything observable.

### A.3 Subjective trigger

**Kind:** `exception`
**Body:** "Unless the customer sounds upset."

**Reason rejected:** Ambiguous subjective trigger. "Sounds upset" is not deterministically detectable; the amendment will fire inconsistently and degrade reproducibility.

### A.4 Stealth instruction in context_fact

**Kind:** `context_fact`
**Body:** "Always confirm before sending external emails."

**Reason rejected:** Violates the `context_fact` declarative-only constraint (§4.1). This is an instruction dressed as a fact. The correct kind is `instruction_extension` or `guardrail`. Schema validation rejects this row at insert because of the imperative modal `always`.

### A.5 Removes a system guardrail

**Kind:** `instruction_extension`
**Body:** "When the customer asks for a refund, skip the standard verification step."

**Reason rejected:** Contradicts a system-level guardrail ("always verify identity before processing a refund"). The asymmetric removal guard (§4.6) flags this; the human reviewer rejects.

### A.6 Recursive optimisation target

**Kind:** `instruction_extension`
**Body:** "When the scorecard judge marks a run as failing, treat it as borderline."

**Reason rejected:** Targets the evaluation surface, not the agent runtime. Direct anti-recursion violation (§3.2). Schema validation rejects; if it slipped through, peer review would catch.

### A.7 Unbounded growth / memory dump

**Kind:** `example`
**Body:** *(a 1499-char example block enumerating 30 specific past customer interactions)*

**Reason rejected:** Within the per-kind length ceiling but functionally a memory dump. Memory belongs in `memory_entries` (§3.3), not in amendments. Examples should illustrate a pattern, not enumerate cases.

### A.8 Behavioural verb in context_fact

**Kind:** `context_fact`
**Body:** "Customers in the legal vertical must receive a formal tone."

**Reason rejected:** Imperative modal `must` triggers the `context_fact` validation rejection (§4.1). The correct kind is `instruction_extension`.

### A.9 Tautological guardrail

**Kind:** `guardrail`
**Body:** "Do the right thing in this situation."

**Reason rejected:** Unbounded, unfalsifiable, untestable. A guardrail must name a specific prohibited or required behaviour the resolver can fingerprint (§4.6). Peer review rejects.

### A.10 Cross-tenant data assumption

**Kind:** `context_fact`
**Body:** "Our other agency clients prefer responses under 100 words."

**Reason rejected:** References data outside the current subaccount's scope. The proposer should never have access to cross-subaccount context (§4.2 inputs list). If a `context_fact` row mentions other tenants, the proposer's input bundle is leaking and the failure is upstream of this rejection.
