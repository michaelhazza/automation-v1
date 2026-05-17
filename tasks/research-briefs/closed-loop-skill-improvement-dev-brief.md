# Closed-loop skill improvement: dev-session brief

**Status.** Pre-spec brief, ready for a dev session that produces a full spec.
**Owner.** Product (Synthetos).
**Source material.** Three independent deep-research passes on self-improving agents and evaluation loops (Claude, Gemini, ChatGPT). See `tasks/research-briefs/02-self-improving-agents.md` for the research prompt; raw outputs archived separately. Convergence across all three was the determining signal for the design choices below.

---

## Contents

1. One-paragraph summary
2. Context
   - 2.1 Glossary
   - 2.2 What exists today (with file paths)
   - 2.3 Why now, why this shape
3. Architectural decisions
   - 3.1 Amendment primitive (new)
   - 3.2 Post-failure root-cause synthesis
   - 3.3 Multi-agent peer review on the amendment
   - 3.4 Morning review queue, reviewer permissions, review surfaces
   - 3.5 Evaluation harness changes
   - 3.6 Asymmetric structural-removal guard
   - 3.7 Bounded loops
4. What is explicitly out of scope (Phase 1)
5. Sequencing inside Phase 1
6. Open questions for the dev session
7. Success criteria
8. Known failure modes we are designing against
9. What this brief is not
10. Related briefs

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
- `agent_execution_log_edits` table (migration 0367) records post-run edit attribution: which entity was edited, by whom, with what summary. Fire-and-forget emission via `tryEmitAgentEvent` in `server/services/agentExecutionEventEmitter.ts`. Amendment accept and reject events emit through this surface so the audit trail captures operator role (subaccount admin vs org admin per §3.4), not just user.

**Client-side surfaces the morning review queue UI extends (post page-split refactor PR #313):**
- `client/src/pages/ReviewQueuePage.tsx` — the existing morning review queue (Briefs / Needs Review tabs). The amendment-proposal queue is a new section/filter on this page.
- `client/src/components/review-queue/NewBriefModal.tsx` — sibling component extracted by PR #313; the new amendment review drawer follows the same component-location convention (`client/src/components/review-queue/` directory).
- `client/src/pages/SubaccountSkillsPage.tsx` and `client/src/components/skills/HistoryRender.tsx` — the active-amendments stack section attaches to the subaccount skill detail surface.
- `client/src/components/ViewModeSwitcher.tsx` — drives the workspace/org mode toggle that switches the queue between subaccount-scoped (Surface A) and cross-subaccount roll-up (Surface B) per §3.4.
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

## 3. Architectural decisions

### 3.1 Amendment primitive (new)

New table: `skill_amendments`.

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| system_skill_id | uuid | FK to system_skills (the base being extended) |
| org_id | uuid \| null | scope: org-tier amendment if subaccount_id null |
| subaccount_id | uuid \| null | scope: subaccount-tier amendment |
| kind | enum | `instruction_extension`, `example`, `guardrail`, `fact`, `exception` |
| body | text | the overlay content; subject to per-kind length ceiling |
| source | enum | `operator_authored`, `agent_proposed_from_failure`, `agent_proposed_from_correction_cluster`, `promoted_from_subaccount` |
| status | enum | `draft`, `pending_review`, `accepted`, `rejected`, `retired` |
| version_number | integer | per-amendment versioning |
| proposer_run_id | uuid \| null | run that proposed it (if agent-proposed) |
| rca_record_id | uuid \| null | root-cause record that justified it |
| created_at, updated_at | timestamptz | |

CHECK constraints:
- `kind` length ceiling enforced at row insert:
  - `instruction_extension`: 800 chars
  - `example`: 1500 chars
  - `guardrail`: 400 chars
  - `fact`: 300 chars
  - `exception`: 600 chars
- Tier integrity (system_skill_id required; one of org_id or subaccount_id may be set).
- Sum-of-amendments per (system_skill_id, scope) capped at 8000 chars at the resolver level.

**Tenancy contract.** `organisation_id` is NOT NULL on every row (the row is always owned by an org, even when the scope is a single subaccount within that org). RLS select / insert / update / delete policies are scoped to the current org context. All service-layer reads and writes route through `getOrgScopedDb` (see §2.2). This is the mandatory pattern after wave 5; there is no exemption for new tables.

**Resolver composition.** When the runtime resolves a skill body for a run:

```
[system_skill base text]
+ [org amendments for this skill, ordered by kind then version]
+ [subaccount amendments for this skill, ordered by kind then version]
```

Amendments cannot remove system text; only extend. Asymmetric removal guard (§3.6) flags any amendment whose composed effect contradicts a system guardrail.

**Why typed, not free-text.** Dropbox's free-text optimiser copied example-specific artefacts into the judge prompt. Acompli explicitly chose fork-plus-fingerprint over free-text overlays. Typing each amendment removes the ambiguity that caused both failures. The moment a `miscellaneous` type is added, we have re-invented free-text. Do not.

**Skill folders, not flat text.** Future-compatible with the Anthropic Skills shape: a skill is a folder with overlay subfolders per scope. Amendments may reference helper scripts and example files in the folder. Phase 1 ships flat; folder structure lands in Phase 2.

### 3.2 Post-failure root-cause synthesis

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
- `proposed_remedy_body`: text, within the kind's length ceiling.
- `confidence`: 0.0 to 1.0.

If schema validation fails (the model invented a field, exceeded the length ceiling, used a non-existent amendment kind), the proposal is discarded silently and logged. This is the Reflexion task-redefinition mitigation: the proposer cannot invent task framing.

**Model.** Frontier-class (Opus). Decagon's evidence is direct: smaller models leave prompts essentially unchanged. Cost is acceptable because proposals run only on fails, not on every run.

### 3.3 Multi-agent peer review on the amendment

Before an amendment reaches the operator's morning review queue, a second proposer (different model family, Gemini or GPT-class) reviews whether the proposed amendment actually addresses the root cause. Output is a single binary plus one sentence:

- `addresses_root_cause`: true / false
- `reasoning`: one sentence

If false, the amendment is dropped and the failure is logged for later analysis. Cheap defence against task-redefinition and judge-gaming.

### 3.4 Morning review queue, reviewer permissions, review surfaces

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

**Write-back contract (critical):**
- Every **accept** adds the amendment to `skill_amendments` and the failed run becomes a regression test case (tagged with the new amendment as the proposed fix).
- Every **reject** archives the proposal and the failed run still becomes a regression test case (tagged as "this fix was wrong, do not propose again").
- Every **edit** is treated as accept-after-modification; the original draft is preserved for proposer-quality analysis.

This is the trace-to-eval flywheel. The set the proposer sees does not include this regression set.

**Audit attribution (LAEL Phase 2).** Each accept / edit / reject emits a fire-and-forget event via `tryEmitAgentEvent` (see §2.2) and writes a row to `agent_execution_log_edits` recording the amendment id, the reviewer role (subaccount admin vs org admin), the action taken, and a one-line summary. This is required so the audit trail captures *which role* clicked, not just *which user*. The event contract follows the LAEL ledger-canonical / payload-best-effort consistency model already in use across the codebase.

### 3.5 Evaluation harness changes

**Frozen regression set per skill.** Held out from the proposer entirely. Re-run on every amendment acceptance. Acceptance is only finalised if the regression set still passes.

**Periodic baseline reset.** Quarterly: review all accepted amendments per skill, merge stable ones into the system skill (a system-tier change, separate review), retire the corresponding amendments. Prevents "overlay debt."

**Held-out human-labelled ground truth.** A small fraction of runs across all skills receive a human label in addition to the Haiku judge. Watch for divergence between Haiku verdicts and human labels over time. If divergence grows, freeze the proposer loop on that skill.

**Evaluator Stress Test integration.** Periodically perturb proposed amendments' format vs content to compute a gaming statistic. If `G(y)` exceeds threshold for a skill's recent amendments, freeze the loop on that skill.

### 3.6 Asymmetric structural-removal guard

The resolver fingerprints the composed body and compares against the system-skill body. If any guardrail-shape element in the system body is contradicted or removed by the composed amendment stack, alert and block. Additions never alert.

Maps directly to Acompli's pattern. Implementation: simple structural-element extractor (numbered rules, must / must-not phrases, refusal clauses), then before/after intersection check.

### 3.7 Bounded loops

- Per skill, per subaccount, per week: maximum 5 amendment proposals reach the review queue. Excess proposals are dropped and the count is exposed to the operator (signal that something deeper is wrong).
- Per skill, lifetime: maximum 20 amendments active. If reached, the skill enters "review required" state and no further proposals are surfaced until the operator reviews the stack.

Drift looks like steady amendment growth. The cap is the dampener.

## 4. What is explicitly out of scope (Phase 1)

- **Upward promotion to system tier.** Deferred until ring rollout exists. The amendment primitive supports this future flow (the `source` enum already includes `promoted_from_subaccount`), but the promotion path itself is not built. Subaccount amendments stay at subaccount tier in Phase 1.
- **Cross-subaccount pattern detection.** Same reason.
- **Prompt mutation / DSPy-style optimisation.** Deferred until base loop is stable. Decoupled feature.
- **Outcome modelling as first-class entity.** Separate strategic bet, separate brief.
- **Per-skill model routing decisions based on scorecard performance.** Deferred.

## 5. Sequencing inside Phase 1

**Step 1.** Schema: `skill_amendments` table, length ceilings, resolver composition logic. Behind a feature flag, no UI yet. Existing skill resolution unchanged for any skill without amendments.

**Step 2.** `failure_post_mortem` job. Triggered on scorecard fail. Writes RCA records only, no amendment proposals yet. Sanity check: are the RCA outputs sensible against real fails?

**Step 3.** Amendment proposer wired to the RCA output. Schema-validated. Multi-agent peer review attached. Drafts written to `skill_amendments` with `status = 'draft'`. Still no UI.

**Step 4.** Morning review queue UI per subaccount. Accept / edit / reject. Write-back to regression test set.

**Step 5.** Asymmetric removal guard wired into the resolver. Length and lifetime caps enforced.

**Step 6.** Evaluation harness changes: frozen regression set per skill, held-out human labels on a sample, EST integration as a periodic job.

Estimated rough size: 6 to 10 weeks of focused build for one engineer, longer if the morning review queue UX is invested in heavily (which it should be, this is operator-facing, not admin-facing).

## 6. Open questions for the dev session

1. **Existing forks.** Today, customisations are forks (full copies). On migration: do we leave existing forks alone (frozen artefacts), auto-detect which ones could be expressed as amendments and offer conversion, or force-migrate? Recommended: leave alone, offer conversion in the UI.
2. **Org-tier amendments (different from the org roll-up).** Phase 1 includes the cross-subaccount roll-up review surface for org admins (see §3.4) but **not** org-scoped amendments themselves. An org admin can review and accept amendments that still apply only to one subaccount. True org-tier amendments (one accept applies to all subaccounts in the org) are deferred until there is concrete demand. Recommended: leave deferred; revisit when an agency owner explicitly asks for "this rule should apply across all my clients."
3. **Per-agent vs per-skill amendments.** The schema is per-skill. Some failures may suggest per-agent context changes (a belief, a baseline note). Recommended: route those into the existing memory / beliefs system, not into amendments. Amendments are skill-scoped only.
4. **Judge identity for the regression set.** Same Haiku judge or a rotated ensemble? Recommended: Haiku for primary regression, rotated ensemble on a sample for divergence detection.
5. **Operator workload.** How many amendments per week per subaccount is realistic for a non-technical operator to review? Tune the cap based on early observation.

## 7. Success criteria

Build is successful when:

1. A scorecard fail on a real subaccount produces a schema-valid amendment draft within 5 minutes.
2. The morning review queue shows the draft with full provenance, and one-click accept results in the amendment taking effect on the next run.
3. The regression set for the affected skill grows by one row per accept and per reject.
4. After 4 weeks of operation in an internal Synthetos subaccount, scorecard pass rate on the affected skills shows a measurable improvement on the frozen regression set held out from the proposer.
5. No amendment has bypassed schema validation, no amendment has removed a system guardrail, and the lifetime cap has not been hit on any skill.

## 8. Known failure modes we are designing against

(All anchored to public production cases in the research outputs.)

- **Dropbox-style overfit.** Optimiser copies example-specific artefacts into the prompt. Mitigated by schema validation requiring amendments to reference only fields present in the failure inputs, and by the regression set being held out from the proposer.
- **Reflexion task redefinition.** Proposer rewrites the task. Mitigated by schema validation: `proposed_remedy_kind` is constrained to five categories; the proposer cannot emit a "new task" amendment.
- **Meta-Rewarding judge inflation.** Judge scores drift upward over time. Mitigated by held-out human-labelled samples and divergence monitoring.
- **GEPA prompt bloat.** Amendments grow past 5,000 chars and lose generalisation. Mitigated by per-kind length ceilings and per-skill sum cap.
- **Slow drift.** Many small amendments degrade overall behaviour. Mitigated by lifetime cap, periodic baseline reset, and frozen regression set.
- **Embedding-clustered surface noise.** Existing correction-pattern detector clusters textually-similar but semantically-different corrections. Mitigated by adding failed-check-id + entity-type as a second clustering dimension before treating a cluster as signal.

## 9. What this brief is not

Not a spec. A spec writes the API contracts, the migration plan, the test plan, the rollout plan. That is the dev-session output, not the input.

Not a commitment to ship. The strongest skeptic case (April 2026 "coin flip" paper: prompt optimisation is often statistically indistinguishable from random unless the task has exploitable latent structure) implies a real risk that this loop produces no measurable improvement. Phase 1 should be evaluated against the success criteria in §7 before any further investment in Phase 2 (upward promotion, ring rollout) is committed.

Not a marketing pitch. External framing is "agents propose improvements, you approve them," never "self-improving agents."

## 10. Related briefs

- `tasks/research-briefs/deterministic-validators-dev-brief.md` — the structural defence layer for this loop. Adds typed deterministic validators alongside the LLM judge so that 60-80% of scorecard evaluations cannot be gamed by the model whose output they evaluate. Not on the critical path of this brief; runs in a parallel lane. If the validators brief lands first, the morning review queue's "Why this was proposed" block renders validator slug plus structured evidence; if this brief lands first, the same block renders the semantic judge's reasoning and is retrofitted later. No mockup-shell change required either way. The two briefs share the `scorecard_judgements` substrate so any change to that ledger must be reconciled across both.
- `tasks/research-briefs/composite-quality-dashboard-dev-brief.md` — out-of-band quality dashboard work that consumes the same scorecard verdict stream. Out of scope for this brief; cross-referenced so future spec authors know not to duplicate.
- `tasks/research-briefs/staged-rollout-dev-brief.md` — the ring-rollout primitive that unblocks Phase 2 upward promotion of subaccount amendments to system tier (see §4). Deliberately deferred until that brief ships.
