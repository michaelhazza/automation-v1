# Staged rollout for agent and skill changes: dev-session brief

**Status.** Pre-spec brief, ready for a dev session that produces a full spec.
**Owner.** Product (Synthetos).
**Source material.** Three independent deep-research passes on staged rollout patterns (Claude, Gemini, ChatGPT). See `tasks/research-briefs/03-staged-rollout-for-agents-and-skills.md` for the research prompt; raw outputs archived separately. Existing mockup set at `prototypes/skill-agent-rings/` (paused; needs the updates noted in §5).

---

## Contents

1. One-paragraph summary
2. Context
   - 2.1 Glossary
   - 2.2 What exists today (with file paths)
   - 2.3 Why now, why this shape
3. Architectural decisions
   - 3.1 Per-run version pinning (the foundational primitive)
   - 3.2 Ring shape
   - 3.3 Cohort selection and stratification
   - 3.4 Gate metrics, hard stops and soft stops
   - 3.5 Rollback semantics
   - 3.6 Reversibility taxonomy and skill classification
   - 3.7 Emergency per-skill disable flag
   - 3.8 Detection threshold calibration (no-op canary)
4. What is explicitly out of scope (Phase 1)
5. Sequencing inside Phase 1
6. Open questions for the dev session
7. Success criteria
8. Known failure modes we are designing against
9. What this brief is not

---

## 1. One-paragraph summary

We are building a four-ring promotion pipeline (Dev → Test → Canary → Prod, with Prod itself ramping 10% → 25% → 50% → 100%) for safely shipping changes to system-tier skills and agents. The foundational primitive is per-run version pinning: every multi-step run records its prompt, skill, and model versions at first step and uses those pinned versions for all subsequent steps, so a global rollback affects only new runs and never breaks an in-flight run mid-stream. Cohort selection is stratified random (use case, volume bucket, behavioural cluster), not pure random. Auto-pause uses a hard-stop / soft-stop split: safety regressions, tool failure spikes, and operator correction spikes trigger automatic rollback; latency, cost, and non-safety scorecard regressions pause for manual review. Cache-hit-rate delta is a diagnostic signal only, never an auto-rollback trigger, because a prompt change invalidates the prefix cache by design. Phase 1 ships the internal-release flavour (Synthetos staff promoting system-skill changes through internal test subaccounts); the customer-rollout flavour activates when first live customer lands and `spec-context.md`'s `rollout_model` flag flips.

This feature is the safety harness for the upward-promotion path of the amendment-primitive feature (see `tasks/research-briefs/closed-loop-skill-improvement-dev-brief.md`). Without this pipeline, that feature cannot safely graduate subaccount-discovered improvements to system tier.

## 2. Context

### 2.1 Glossary

- **Ring.** A named promotion stage with a defined cohort, gate metrics, and dwell time. We have four: Dev, Test, Canary, Prod.
- **Cohort.** The set of subaccounts (or runs) that receive a particular version of a skill or agent at a given moment.
- **Dwell time.** Minimum time a version must spend in a ring with all gates green before promotion to the next ring.
- **Gate metric.** A measurable signal compared between the new version and the baseline; gates can be hard-stop (auto-rollback) or soft-stop (pause for manual review).
- **Version pin.** The immutable record on a run of which prompt, skill, model, and prefix-hash versions it started with. Used for in-flight-run safety during rollback.
- **Hard stop.** A gate breach that triggers automatic rollback without human intervention (safety regression, tool failure spike, operator correction spike).
- **Soft stop.** A gate breach that pauses the rollout and requires explicit human approval to continue (latency, cost, non-safety scorecard).
- **Stratified random sampling.** Cohort selection that ensures coverage across defined axes (use case, volume, behavioural cluster) before randomising within strata.
- **No-op canary.** A canary that runs the unchanged version, tagged as canary, used solely to measure the natural variance of gate metrics so real thresholds can be calibrated above noise.
- **Reversibility class.** A classification of a skill's actions on the {Idempotent, Reversible, Compensable, Irreversible} taxonomy, used to decide rollback and approval requirements.
- **Internal release flavour.** The pipeline operating on Synthetos-internal cohorts (staff test subaccounts) for system-skill changes shipped by Synthetos. Live now, Phase 1.
- **Customer rollout flavour.** The same pipeline operating on customer cohorts. Activates when first live customer lands. Phase 2.

### 2.2 What exists today (with file paths)

Everything below is operational on `main`. The brief builds on top of it; no rework of these subsystems is in scope.

**LLM ledger and prefix-hash infrastructure (the substrate for version pinning and cache-hit metrics):**
- `server/db/schema/llmRequests.ts` — `llm_requests` table, includes `prefix_hash` for cache attribution per migration 0185.
- `server/services/systemPnlService.ts`, `client/src/pages/SystemPnlPage.tsx` — `/system/llm-pnl` admin surface, per-step cost and model attribution per run. Shipped in PR #158 (migrations 0185-0191).
- `server/services/llmInflightRegistry.ts` — in-flight run tracking with per-step lineage.

**Scorecard subsystem (the primary quality gate metric):**
- `server/db/schema/scorecards.ts`, `server/db/schema/scorecardJudgements.ts` — rubric and verdict storage; immutable; F1 snapshot of rubric per verdict.
- `server/jobs/scorecardJudgeJob.ts` — Claude Haiku judge; deterministic sampling; pass / fail / inconclusive verdicts.

**Three-tier skill model (the substrate this pipeline gates promotion across):**
- `server/db/schema/systemSkills.ts` — `system_skills` table (system tier; the rollout target for Phase 1).
- `server/db/schema/skills.ts` — `skills` table (org and subaccount tiers).
- `server/db/schema/skillVersions.ts` — per-tier independent version chains; immutable snapshots.
- `server/services/skillService.ts`, `resolveSkillsForAgent()` around line 115 — runtime resolution; strict precedence (subaccount > org > system).

**Agent run lineage (for per-run version pinning):**
- `server/db/schema/agentRuns.ts` — `agent_runs` table with `parentRunId`, `handoffDepth`, `isSubAgent`. Phase 1 adds `pinnedPromptVersion`, `pinnedSkillVersion`, `pinnedModel` columns.

**Existing rings mockup work (paused, needs research-driven updates):**
- `prototypes/skill-agent-rings/` — nine mockup HTML files + index. Riley house style (Tailwind, Inter, light theme). Five updates flagged in the previous coordinator session; this brief refines two of them based on the research (cache-hit-rate becomes diagnostic-only; the canary-health metrics table changes accordingly).

**Operational posture file:**
- `docs/spec-context.md` — currently `rollout_model: commit_and_revert`, `staged_rollout: never_for_this_codebase_yet`. The Phase 2 customer-rollout flavour is gated on this flag flipping. The Phase 1 internal-release flavour is **not** gated on it (internal release is a Synthetos-internal process, not a customer-facing rollout).

### 2.3 Why now, why this shape

Three things make this the right time:

- **The amendment primitive needs a safety harness.** Without staged rollout, the upward-promotion path of subaccount amendments to system tier cannot ship safely. That feature has been scoped, and this is its missing dependency.
- **The substrate is ready.** Prefix-hash, per-run LLM ledger, scorecard verdicts, and skill versioning are all live. Phase 1 connects them; it does not invent them.
- **The internal-release flavour can ship pre-launch.** The previous coordinator session paused this work on "first live agency client." That trigger holds for customer rings but not for internal rings. Synthetos staff shipping system-skill changes through internal test subaccounts is a process change, not a customer-facing rollout, and is permitted under the current `commit_and_revert` posture.

The shape is convergent across all three deep-research passes:

- **Four rings is the right count.** Three is not enough power to detect mid-sized regressions before customer impact; five is over-engineered for our run volume. Prod itself ramps internally.
- **Detection is rarely from internal evals.** Every published incident in the last 18 months (OpenAI sycophancy, Anthropic Claude Code reasoning depth, Replit deletion, Cursor pricing, Gemini image) was detected externally first. Production telemetry on operator corrections is the most signal-rich metric, not scorecard verdicts.
- **Stratified random sampling beats pure random at our cohort size.** At 5% of hundreds of subaccounts, pure random can let one high-volume tenant dominate the canary metrics.
- **Per-run version pinning is the rollback primitive that code rollback does not need.** Multi-step agent runs span the rollback boundary in a way HTTP requests do not. Without pinning, you either terminate in-flight runs (their own failure mode) or you accept inconsistent behaviour mid-conversation. Pinning solves both.

## 3. Architectural decisions

### 3.1 Per-run version pinning (the foundational primitive)

The single most important schema change. Without it, no other section of this brief works correctly.

**New columns on `agent_runs`:**

| Column | Type | Notes |
|---|---|---|
| pinned_prompt_version | text | system-prompt version active at first step |
| pinned_skill_versions | jsonb | map of `{ skill_slug: version_id }` for every skill resolved at first step |
| pinned_model | text | model identifier active at first step |
| pinned_prefix_hash | text | prefix hash captured at first step, for cache attribution |
| ring_at_start | enum | `dev`, `test`, `canary`, `prod_10`, `prod_25`, `prod_50`, `prod_100` |

**Behaviour.** At first step of a run, the resolver captures the active versions for this subaccount and writes them to the run. All subsequent steps in that run use the pinned versions, ignoring any global rollout changes that happen mid-run. This guarantees:

1. A rollback affects new runs only; in-flight runs finish on the version they started with.
2. Replay is deterministic against the pinned versions; you can re-run a failed trace against the exact configuration that produced it.
3. Audit can reconstruct exactly which version produced which output, indefinitely.

**Edge cases the dev session needs to resolve:**
- Sub-agent runs: pinned versions inherit from parent or re-resolve? Recommended: inherit from parent (the user expects coherent behaviour across the delegation graph).
- Long-running runs that span a rollback: let them finish on the old (pinned) version. If the rollback was for a safety-class issue, terminate and replay (see §3.5).
- Skill amendments (from the closed-loop feature): pin the amendment stack at first step the same way base skills are pinned.

### 3.2 Ring shape

Four rings, with Prod itself ramping internally. Phase 1 ships the internal-release flavour (Dev and Test populated by Synthetos staff and internal test subaccounts; Canary and Prod inactive until first customer). Phase 2 activates Canary and Prod when `spec-context.md` flips.

| Ring | Cohort (internal release) | Cohort (customer rollout) | Dwell | Primary gate | Promotion trigger |
|---|---|---|---|---|---|
| **Dev** | 5-10 Synthetos staff subaccounts, synthetic + dogfood traffic | same | Same day; until offline eval suite + manual spot check pass | Offline scorecard suite, manual operator spot-check ("vibe check") | Manual submit-to-Test |
| **Test** | All staff subaccounts + opted-in dogfood partners (Phase 2 only) | 20-50 accounts | 12-24 h, one business-day cycle | Scorecard verdict delta vs control, operator correction rate, latency p50/p95, cost/run | Automated, all gates green for full dwell |
| **Canary** | (Phase 2 only) | Stratified 5% of customer subaccounts | 24-72 h, at least one weekday cycle | All Test gates plus SPRT-style sequential test on scorecard win-rate; cache-hit-rate delta as diagnostic only | Automated, all hard gates green, no sustained soft-gate breach |
| **Prod** | (Phase 2 only) | Remainder, ramped 10% → 25% → 50% → 100%, 12-24 h per step | 12-24 h per ramp step | Same as Canary with tighter thresholds (higher statistical power) | Automated per step; manual approval before each ramp step in early operation |

**Why Prod ramps internally.** Going Canary → 100% in one step throws away the statistical power earned in Canary. Four ramp steps give graceful "stop the bleeding" capability with low operational drag.

**Why dwell times cover a business-day cycle.** Agency subaccounts have heavy diurnal patterns; a 4-hour canary that runs only during one timezone's business hours misses entire failure modes that surface at off-peak or in other timezones.

### 3.3 Cohort selection and stratification

**Recommendation: stratified random sampling, not pure random; opt-in volunteer ring ahead of customer canary; not paid-tier-first.**

**Three stratification axes (all required):**

1. **Skill usage.** Subaccounts that exercise the changed skill heavily must be represented. A canary that randomly excludes the affected skill produces false-green signals.
2. **Run volume bucket.** Include at least one subaccount from each volume bucket (low / medium / high). Without this, a single high-volume subaccount can dominate canary metrics.
3. **Behavioural cluster.** If the existing correction-pattern detector has clustered subaccounts by operator-correction shape, include at least one subaccount per cluster.

Optionally a fourth axis: **plan tier**, for surface-area coverage. Phase 1 internal-release does not need this (all cohorts are Synthetos staff); Phase 2 customer-rollout adds it.

**Cohort assignment is sticky within a release but rotates across releases.** The same subaccounts should not be in canary every time (rolled-update-fatigue degrades feedback quality). Rotate cohort membership at the release level, not the run level.

**Reproducibility of cohorts after restart.** A subtle but important point: most rollout tools, if you stop a rollout and restart it later, will reassign different members to canary. For post-incident re-tests this is a footgun. The dev session needs to specify: cohort assignments are recorded as immutable rows in a `rollout_cohorts` table at rollout start; restart references the saved cohort, not a fresh random sample.

**Randomisation unit: subaccount, not run.** Within a subaccount, every run sees the same version. Mixed versions within one subaccount creates confusing operator-facing inconsistency.

**Volunteer / opt-in ring (Phase 2 addition).** Add a "Test+" sub-ring for customers who opt in to receive pre-Canary releases in exchange for being a feedback channel. OpenAI's post-sycophancy commitment was to add exactly this. Phase 1 deliberately defers it (no customers yet).

### 3.4 Gate metrics, hard stops and soft stops

Two classes of gate. Hard stops trigger automatic rollback; soft stops pause for manual approval before the next ramp step.

**Hard stops (auto-rollback, no human in the loop):**

| Metric | Threshold | Source signal |
|---|---|---|
| Safety scorecard regression | Any drop on any safety-class quality check (toxicity, PII, jailbreak, action-policy) | Existing `scorecard_judgements` table, filtered by `quality_check.safety_class = true` |
| Tool execution failure rate | >1% absolute, or 2× baseline, sustained 30 min | Existing run telemetry; needs aggregation job |
| Operator correction frequency | +30% relative in Canary, +20% in Prod ramp, sustained 30 min | Operator-correction records on `task_activity` |
| Refusal rate spike | +5% over baseline on previously-successful query shapes | Run output analysis, needs new job |
| Sample-ratio mismatch | Cohort sampling diverges materially from intended distribution | Rollout assignment audit |

**Soft stops (pause for manual review):**

| Metric | Threshold | Source signal |
|---|---|---|
| Non-safety scorecard win-rate | -2pp absolute, sustained over SPRT window at α=0.05 in Canary, α=0.01 in Prod | `scorecard_judgements` |
| Latency p50 | +20% over baseline | `llm_requests.latency_ms` |
| Latency p95 | +25% over baseline | same |
| Latency p99 | +50% over baseline (looser because noisier at small cohorts) | same |
| Cost per run | +15% in Canary, +10% in Prod | `cost_aggregates` |
| Step count per run | +30% (a prompt change that doubles tool calls reads as latency regression but is really behaviour change) | new aggregation on `agent_runs.handoffDepth` or step lineage |

**Composite rule.** Auto-pause on any single hard stop OR any two simultaneous soft-stop breaches sustained across two consecutive observation windows. Single soft-stop breaches log and alert but do not pause; this prevents alert fatigue on noisy metrics.

**Primary statistical test.** SPRT (sequential probability ratio test) on scorecard win-rate against a 7-day Prod baseline. α = 0.05 in Canary, α = 0.01 in Prod. SPRT is the right shape because scorecard verdicts are inherently sequential and sampled; a fixed-N test wastes runs once the answer is statistically clear. (Patronus AI's 2024 write-up is the cleanest practitioner reference; the math transfers cleanly.)

**Cache-hit-rate delta is diagnostic only, never a gate.** A prompt change invalidates the prefix cache by design; the metric is uninformative at t=0. Becomes useful after both canary and prod have warmed (≥1 hour or fixed N runs), at which point a large divergence is a signal of unintended prompt-prefix divergence on inputs that should be cacheable. Surface in the canary-health dashboard as a yellow flag, never as auto-rollback trigger.

**The most signal-rich metric is operator corrections.** Across every published incident in the last 18 months, internal evals missed the regression and users surfaced it. Operator corrections are humans literally typing "the agent got this wrong"; the signal-to-noise is higher than any automated metric. Weight it the highest and tune thresholds tightly.

### 3.5 Rollback semantics

Four operations, used in different situations.

**1. Hard rollback (default).** Flip the global default version for new runs to the last-known-good. In-flight runs finish on their pinned versions (see §3.1). This is your default for any non-catastrophic regression. Anchored to OpenAI's GPT-4o sycophancy rollback (~24 hours, in-flight conversations carried on).

**2. Per-subaccount version pin.** Maintain a `subaccount.pinned_version` field. Use to leave specific subaccounts on the new version for diagnosis, or pin specific subaccounts to the old version because they hit the bug specifically. The operational cost is small because the LLM ledger is already per-run; we just need a sticky version selector at run-start.

**3. Shadow execution.** Run old and new versions in parallel on the shadowed traffic; old version's output wins, new version's output is logged for comparison. Expensive (2× cost on shadowed traffic), reserved for high-stakes changes: any skill in reversibility class K (compensable) or X (irreversible), any skill that emits to a customer-visible channel, any system-prompt or tool-description change. The Replit deletion incident is the cautionary tale for why shadow exists.

**4. Replay.** Re-run affected work on the reverted version. Practically scoped to safety-class regressions where the output already emitted is the problem. Re-run with temperature pinned to 0 if possible; compare reverted output to original; flag any case where they differ substantively for human review. Promise replay-then-review, not auto-resolved replay.

**In-flight runs:** let finish on the pinned version unless the failure mode is catastrophic (data loss, security violation, content policy breach). Mid-run termination has its own failure mode (partial tool calls leave inconsistent state). The exception is safety-class regression, in which case you terminate and replay.

**Hotfix prompt as intermediate step.** OpenAI's sycophancy rollback used a system-prompt patch late Sunday night to mitigate the worst behaviour while preparing the full rollback. This is a useful intermediate option: a constrained-behaviour amendment that ships fast while the full rollback is being prepared. Recommend supporting it as an explicit operation in the rollout UI.

### 3.6 Reversibility taxonomy and skill classification

Every skill is classified into one of four reversibility classes. The classification dictates rollout cadence, gate strictness, and rollback requirements.

| Class | Definition | Example | Approval gate | Rollback approach |
|---|---|---|---|---|
| **I** Idempotent | Read-only; no side effects | Read CRM contact, query memory | None required | Stop the run; no rollback action needed |
| **R** Reversible | Has an undo path that can be executed automatically | Create draft email, schedule message in queue | Pre-execute approval not required if class verified | Trigger the registered undo action |
| **K** Compensable | Side effect that can be undone with a manual counter-action | Charge card, send invoice, post to public channel | Reversibility-aware staged rollout; full four-ring | Surface compensation steps for human execution |
| **X** Irreversible | No undo possible | Send transactional email, submit form to third-party, delete production data | **Human approval gate before each execution**, not just before rollback | Cannot rollback; only forward correction possible |

**Phase 1 deliverable.** Every system skill is classified. The classification is a new column on `system_skills`. The rollout pipeline reads the column and adjusts: I-class skills can use a fast-revert path with flag-only rollout; X-class skills require shadow execution in Canary and an in-place human approval gate at every execution (not just at rollout time).

**Default classification when uncertain: K (compensable).** Forces a conservative posture. Re-classify down when audit confirms full reversibility.

**Change classification matters as much as skill classification.** Independent axis:

| Change shape | Rollout requirement |
|---|---|
| Typo / rephrase in non-tool-using skill | Test ring only, then 100% behind a flag |
| Substantive prompt rewrite in single skill | Full four-ring |
| System-prompt change | Full four-ring + shadow on a sample |
| Tool description change | Full four-ring (treat as system-prompt-equivalent) |
| New tool added to agent | Full four-ring + enforced sandboxing in Canary |
| Agent graph topology change | Full four-ring at slowest cadence |

### 3.7 Emergency per-skill disable flag

A no-deploy kill switch per skill, per scope (global, org, subaccount). When triggered:

- All new runs that would have invoked the skill receive a deterministic "skill temporarily unavailable" response.
- In-flight runs that are mid-execution complete on the pinned version (do not interrupt).
- Operator audit log captures who flipped the flag, when, and why.
- The flag flip propagates within seconds; not behind any deploy pipeline.

Anchored to two incidents: Gemini Feb 2024 paused image generation within hours; Replit's commitment after the deletion was a "planning-only mode" switchable atomically.

**Implementation.** Single `skill_disable_flags` table with `(skill_slug, scope_org_id, scope_subaccount_id, disabled_at, disabled_by, reason)`. Resolver checks this table at run start, after version pinning. Skill is treated as unavailable for that scope until row is deleted.

### 3.8 Detection threshold calibration (no-op canary)

The discipline that protects the pipeline from false-positive fatigue and false-negative miss.

**The procedure.** Before going live with real auto-pause thresholds:

1. Run a no-op canary: same version as Prod, tagged as canary, for one week.
2. Measure standard deviation of every gate metric in the canary cohort against the Prod cohort.
3. Set real auto-pause thresholds at:
   - Safety metrics: 2σ above no-op variance.
   - Non-safety metrics: 3σ above no-op variance.
4. Re-calibrate quarterly, or any time the baseline traffic shape changes materially.

**Why it matters.** Anthropic's Claude Code reasoning-depth regression flew under the radar for weeks because nobody had calibrated detection thresholds to actual signal size; the regression was real but smaller than the noise floor of their monitoring. The fix is not "tighter thresholds" but "know your variance and set thresholds above it."

**What this protects against.** Two failure modes: (a) the threshold is too tight → auto-pause fires on noise → operators lose trust in the pipeline → they manually override → next real regression slips through; (b) the threshold is too loose → real regressions don't trigger → they ship → user-visible incident.

**Phase 1 deliverable.** Calibration is run before the pipeline is permitted to auto-pause anything. Until calibrated, all auto-pauses are advisory (alert only, no rollback action).

## 4. What is explicitly out of scope (Phase 1)

- **Customer-facing rings (Canary, Prod).** Built in code but inactive. Activated when first live customer lands and `docs/spec-context.md` flips `rollout_model` off `commit_and_revert`. Phase 1 ships Dev and Test only.
- **Opt-in volunteer ring (Test+).** Deferred to Phase 2. Requires a customer to opt in to, which we do not have yet.
- **Org-tier or subaccount-tier promotion through rings.** The pipeline is for system-tier changes only. Org-tier and subaccount-tier changes happen via the amendment-primitive feature (separate brief), reviewed per subaccount, not ringed.
- **Cross-region or per-region cohort stratification.** Synthetos is single-region in Phase 1. Adds at Phase 2.
- **Automatic skill-classification reasoning.** Phase 1 requires a manual classification pass on the 100+ system skills (I/R/K/X). Auto-classification from observed side effects is a separate feature.
- **Real-time hash-based stratification.** A one-time stratified-sampling job at rollout start is sufficient at our cohort size. Hash-based real-time assignment is over-engineered.
- **Bayesian or mixture-SPRT.** Plain SPRT on the primary scorecard metric is enough. Full Bayesian formalism adds debugging cost without proportional benefit at our scale.

## 5. Sequencing inside Phase 1

**Step 1.** Schema: per-run version pinning columns on `agent_runs`; `skill_disable_flags` table; `rollout_cohorts` table; reversibility-class column on `system_skills`. Migration only, behind a feature flag, no behaviour change yet.

**Step 2.** Resolver wiring: at run start, capture pinned versions; on subsequent steps, use the pinned versions instead of re-resolving. Existing run flows unchanged for any run whose pin matches current global default. Light unit tests.

**Step 3.** Manual classification of all system skills into reversibility classes. Default K when uncertain. Reviewed by Synthetos staff; one-time work, captured as data.

**Step 4.** Ring shape: Dev and Test rings activated. Internal release flow: a Synthetos staff member submits a system-skill change, it lands in Dev (their own subaccount), promotes through Test, then ships to global at 100%. No Canary or Prod ramp yet.

**Step 5.** Gate metrics aggregation jobs. SPRT computation on scorecard win-rate. Tool failure rate aggregation. Operator correction rate aggregation. Latency and cost rollups (these exist; just need cohort-aware views).

**Step 6.** No-op canary calibration. Run the unchanged version through the new pipeline for one week. Measure variance. Set initial real thresholds at 2σ / 3σ as appropriate. Pipeline remains in advisory mode (alert only) until calibration completes.

**Step 7.** Emergency per-skill disable flag UI. Single-action operator surface; audit log; immediate effect.

**Step 8.** Mockup refresh. Update `prototypes/skill-agent-rings/` based on this brief's changes:
- Cache-hit-rate moves from gate to diagnostic; canary-health table rewritten.
- Reversibility class column added to skill-list views.
- Status banner clarifying internal-release-only in Phase 1.
- Reference to per-run version pinning in promote / rollback modals.

**Step 9.** Documentation: runbook for operating the pipeline (how to promote, how to rollback, what to do on auto-pause). Lives at `docs/rollout-runbook.md`.

Estimated rough size: 8 to 12 weeks for one engineer, longer if the no-op calibration phase finds noisy metrics that need pipeline-level fixes before real thresholds can be set.

## 6. Open questions for the dev session

1. **Skill classification pass.** Who reviews? How much time? Recommended: Synthetos staff classify the top 30 most-used skills in week 1, the remainder over the next month, with default K as a safe fallback for unclassified skills.

2. **What is "operator correction"?** Currently `feedbackVotes` exist on `task_activity`, `task_deliverable`, `agent_message` but are decorative. To use as a gate metric, the dev session needs to specify which events count: explicit thumbs-down? Edits to a draft? Re-runs of the same task? Recommended: start with explicit thumbs-down and edits to agent-produced text; refine after no-op calibration shows variance.

3. **Stratification cohort calculation.** Daily? Per-release? Where is the job that materialises the stratified sample? Recommended: per-release, materialised into `rollout_cohorts` at rollout start, immutable for the life of that release.

4. **Sub-agent runs and pinning.** Inherit from parent or re-resolve at sub-agent boundary? Recommended: inherit (coherent behaviour across delegation graph) but make this explicit so it's not a silent design choice.

5. **Hotfix-prompt operation.** Is this a first-class rollout operation alongside promote / rollback, or is it just "ship a Test-ring change at maximum speed"? Recommended: first-class operation, with reduced gate set (safety scorecards only) and clear audit trail noting it as a hotfix.

6. **Backward compatibility with existing runs.** Runs that started before per-run pinning landed have no pinned versions. How does rollback affect them? Recommended: existing in-flight runs at migration time finish on whatever version they happen to resolve to at each step; new runs after migration are fully pinned.

7. **Mockup naming alignment.** Previous coordinator session flagged a planned rename (Playbooks → Workflows; current Workflows → Automations). The mockups use "agent" and "skill" which are unaffected, but any references to Workflows or Playbooks need adjustment before the spec session.

## 7. Success criteria

Build is successful when:

1. Any run started today has the pinned prompt, skill, and model versions recorded at run start and uses those versions for every subsequent step.
2. A Synthetos staff member can promote a system-skill change through Dev and Test rings without manual intervention beyond initial submission, and observe gate-metric movement at each ring boundary.
3. A simulated regression (deliberate small quality drop on a test skill) triggers an advisory alert in Test ring within the dwell window. (Auto-pause cannot be evaluated until customer rings activate in Phase 2.)
4. The emergency per-skill disable flag, when triggered, stops new invocations of that skill within seconds, lets in-flight runs finish on the pinned version, and is captured in the audit log.
5. Every system skill has a reversibility class assigned (I / R / K / X), and X-class skills cannot execute without an in-place human approval gate.
6. No-op canary calibration has run for at least one full week, variance is measured for every gate metric, and real thresholds are set at 2σ / 3σ above no-op variance before any auto-action is enabled.
7. The `prototypes/skill-agent-rings/` mockup set reflects the cache-hit-rate-as-diagnostic-only change and the reversibility class surface.

## 8. Known failure modes we are designing against

(All anchored to public production incidents in the last 18 months.)

- **OpenAI GPT-4o sycophancy (April 2025).** Offline evals and small-scale A/B looked positive; qualitative spot-checks flagged "feels off" but were overruled. Customer-visible regression for four days; full rollback took ~24 hours. *Mitigation in this design:* manual spot-check is a hard gate in Test, not an advisory; soft-stop on non-safety scorecard at -2pp regardless of A/B verdict; hotfix prompt as a first-class operation for the bleeding-stop window.
- **Anthropic Claude Code reasoning depth (Feb-Mar 2025).** Real regression flew under the radar for weeks because internal monitoring thresholds were not calibrated to actual signal size; an outside researcher analyzing thousands of session files surfaced it. *Mitigation:* no-op canary calibration (§3.8) is a hard prerequisite to auto-action; thresholds are set above measured variance, not at arbitrary percentages.
- **Replit production database deletion (July 2025).** Agent executed destructive command during code freeze, then misreported its capabilities. *Mitigation:* reversibility classification (§3.6); X-class skills require in-place human approval at every execution; shadow execution mandatory for X-class skills in Canary; emergency per-skill disable flag (§3.7) for instant containment.
- **Cursor pricing rollout (June-July 2025).** Single rollout to all paying customers with no staged communication; users hit hard limits within hours. *Mitigation:* customer-rollout flavour uses stratified canary; soft-stop on cost-per-run +15% surfaces unexpected economic impact before broad exposure.
- **Gemini image generation (Feb 2024).** Diversity post-processing layer over-applied to historical contexts; detected on social media. *Mitigation:* emergency per-skill disable flag (§3.7) enables atomic per-feature pause without deploy.
- **Slow-drift regressions that survive eval suites.** Most published incidents went undetected by internal evals. *Mitigation:* operator correction frequency is weighted as the most signal-rich metric (§3.4); hard-stop threshold tight.
- **Cohort reassignment on rollout restart.** Tools that reassign cohort membership when a rollout is stopped and restarted produce irreproducible post-incident tests. *Mitigation:* `rollout_cohorts` table is immutable for the life of a release; restarts reference the saved cohort.
- **In-flight runs straddling rollback.** Mid-conversation behaviour inconsistency degrades trust. *Mitigation:* per-run version pinning (§3.1); in-flight runs finish on their start version regardless of global rollback.

## 9. What this brief is not

Not a spec. The dev session produces the spec, including API contracts, migration plans, test plans, and the runbook.

Not a commitment to the customer-rollout flavour. Phase 1 ships internal release only; Phase 2 activation depends on first-customer trigger and `spec-context.md` flipping.

Not a substitute for the runbook. Auto-pause and rollback procedures need a written operational doc (`docs/rollout-runbook.md`) that humans can follow at 2am when something fires. The brief specifies the primitives; the runbook specifies the moves.

Not a marketing pitch. External framing is "we promote changes through stages with safety gates," never "we have automated rollback AI."
