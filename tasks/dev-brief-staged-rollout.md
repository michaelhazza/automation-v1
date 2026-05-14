# Staged rollout for agent and skill changes — consolidated dev brief

**Status.** Pre-spec brief, ready for a dev session that produces a full spec.
**Owner.** Product (Synthetos).
**Branch.** `claude/analyze-agent-orchestration-4Gdlz` — this branch is the canonical home for the feature; this document supersedes the earlier monolithic mockup-thinking and the staged-rollout brief drafted in a parallel session.

**Source material.**
- Three independent deep-research passes on staged rollout patterns (Claude, Gemini, ChatGPT) conducted in a parallel session.
- Existing mockup set at [`prototypes/skill-agent-rings/`](../prototypes/skill-agent-rings/) — nine HTML mockups + index drafted on this branch before the research was complete.
- Earlier analysis of the three-tier agent orchestration pattern (this branch).

**Reading order.**
1. §1 Summary
2. §2.2 What exists today + §2.3 What exists on this branch (so you know what's load-bearing)
3. §3 Architectural decisions
4. §4 Mockup integration — what changes vs the existing mockup set
5. §6 Sequencing
6. Deep dives §§3.x and §§7–9 as needed

---

## Contents

1. One-paragraph summary
2. Context
   - 2.1 Glossary
   - 2.2 What exists today (with file paths)
   - 2.3 What exists on this branch (mockup set + prior thinking)
   - 2.4 Why now, why this shape
3. Architectural decisions
   - 3.1 Per-run version pinning (the foundational primitive)
   - 3.2 Ring shape
   - 3.3 Cohort selection and stratification
   - 3.4 Gate metrics, hard stops and soft stops
   - 3.5 Rollback semantics
   - 3.6 Reversibility taxonomy and skill classification
   - 3.7 Emergency per-skill disable flag
   - 3.8 Detection threshold calibration (no-op canary)
4. Mockup integration — how the existing set lines up with this brief
5. What is explicitly out of scope (Phase 1)
6. Sequencing inside Phase 1
7. Open questions for the dev session
8. Success criteria
9. Known failure modes we are designing against
10. What this brief is not
11. Dependencies and related work

## 1. One-paragraph summary

A four-ring promotion pipeline (Dev → Test → Canary → Prod, with Prod itself ramping 10% → 25% → 50% → 100%) for safely shipping changes to system-tier skills and agents. The foundational primitive is **per-run version pinning**: every multi-step run records its prompt, skill, and model versions at first step and uses those pinned versions for all subsequent steps, so a global rollback affects only new runs and never breaks an in-flight run mid-stream. Cohort selection is **stratified random** (use case, volume bucket, behavioural cluster), not pure random. Auto-pause uses a **hard-stop / soft-stop split**: safety regressions, tool failure spikes, and operator correction spikes trigger automatic rollback; latency, cost, and non-safety scorecard regressions pause for manual review. **Cache-hit-rate delta is a diagnostic signal only**, never an auto-rollback trigger, because a prompt change invalidates the prefix cache by design. Phase 1 ships the **internal-release flavour** (Synthetos staff promoting system-skill changes through internal test subaccounts); the customer-rollout flavour activates when first live customer lands and `docs/spec-context.md`'s `rollout_model` flag flips.

This feature is the safety harness for the upward-promotion path of the **closed-loop skill-improvement / amendment-primitive feature** (drafted in a parallel session — see §11). Without this pipeline, that feature cannot safely graduate subaccount-discovered improvements to system tier.

---

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

Everything below is operational on main. The brief builds on top of it; no rework of these subsystems is in scope.

**LLM ledger and prefix-hash infrastructure** (the substrate for version pinning and cache-hit metrics):
- [`server/db/schema/llmRequests.ts`](../server/db/schema/llmRequests.ts) — `llm_requests` table, includes `prefix_hash` for cache attribution per migration `0185`.
- [`server/services/systemPnlService.ts`](../server/services/systemPnlService.ts), [`client/src/pages/SystemPnlPage.tsx`](../client/src/pages/SystemPnlPage.tsx) — `/system/llm-pnl` admin surface, per-step cost and model attribution per run. Shipped in PR #158 (migrations `0185`–`0191`).
- [`server/services/llmInflightRegistry.ts`](../server/services/llmInflightRegistry.ts) — in-flight run tracking with per-step lineage.

**Scorecard subsystem** (the primary quality gate metric):
- [`server/db/schema/scorecards.ts`](../server/db/schema/scorecards.ts), [`server/db/schema/scorecardJudgements.ts`](../server/db/schema/scorecardJudgements.ts) — rubric and verdict storage; immutable; F1 snapshot of rubric per verdict.
- `server/jobs/scorecardJudgeJob.ts` — judge runner; deterministic sampling; pass / fail / inconclusive verdicts.

**Three-tier skill model** (the substrate this pipeline gates promotion across):
- [`server/db/schema/systemSkills.ts`](../server/db/schema/systemSkills.ts) — `system_skills` table (system tier; the rollout target for Phase 1).
- [`server/db/schema/skills.ts`](../server/db/schema/skills.ts) — `skills` table (org and subaccount tiers).
- [`server/db/schema/skillVersions.ts`](../server/db/schema/skillVersions.ts) — per-tier independent version chains; immutable snapshots.
- `server/services/skillService.ts`, `resolveSkillsForAgent()` — runtime resolution; strict precedence (subaccount > org > system).

**Agent run lineage** (for per-run version pinning):
- [`server/db/schema/agentRuns.ts`](../server/db/schema/agentRuns.ts) — `agent_runs` table with `parentRunId`, `handoffDepth`, `isSubAgent`. Phase 1 adds `pinnedPromptVersion`, `pinnedSkillVersions`, `pinnedModel`, `pinnedPrefixHash`, `ringAtStart` columns.

**Operational posture file:**
- [`docs/spec-context.md`](../docs/spec-context.md) — currently `rollout_model: commit_and_revert`, `staged_rollout: never_for_this_codebase_yet`. The Phase 2 customer-rollout flavour is gated on this flag flipping. The Phase 1 internal-release flavour is not gated on it.

### 2.3 What exists on this branch (mockup set + prior thinking)

This branch already carries a meaningful amount of design work that this brief consolidates. **Read this section so you know what's load-bearing before changing it.**

**Mockup set — `prototypes/skill-agent-rings/`** (paused, partially superseded — see §4 for the revisions this brief drives).
Nine HTML mockups + an `index.html` matched to the Riley house style (Tailwind CDN, Inter, light theme, one screen per file, ~80–140 lines each):

| # | File | What it shows |
|---|---|---|
| 01 | `01-system-agents-library.html` | Admin landing: list of system agents with an "In flight" column |
| 02 | `02-edit-agent-prompt.html` | Edit screen with "Save to Dev" relabel + diff |
| 03 | `03-rollout-pipeline.html` | The four-ring vertical pipeline view |
| 04 | `04-promote-modal.html` | Promotion confirm with readiness checks |
| 05 | `05-canary-health.html` | Cohort-vs-cohort comparison + auto-pause status |
| 06 | `06-rollback-modal.html` | One-confirm revert |
| 07 | `07-system-skills-library.html` | Same pattern, applied to skills |
| 08 | `08-agent-config-customer-view.html` | Agency-facing: version info inside a collapsed Advanced section |
| 09 | `09-update-notification.html` | Customer in-app banner + weekly email |
| — | `index.html` | Navigation + design notes |

**Prior thinking that survives:**
- The four-ring shape (Dev → Test → Canary → Prod). Convergent with the research's recommendation.
- Two user classes (Synthetos admin under relaxed budget; agency operator under strict consumer-simple budget). Compliance with [`docs/frontend-design-principles.md`](../docs/frontend-design-principles.md).
- Per-file mockup organisation, matching Riley house style.
- The agency-facing surfaces are intentionally minimal — one line inside an Advanced collapse + an "updated" notification. **No version numbers in primary customer copy.**

**Prior thinking the research overturns** (mockups need to reflect these — see §4):
- **Cache-hit-rate delta was framed as a gate metric in the canary-health mockup (05).** The research is unambiguous: this is wrong. A prompt change invalidates the prefix cache by design. Move to diagnostic-only, in the Advanced section.
- **Reversibility class did not exist as a concept.** Every system skill needs an I / R / K / X classification, and the skill-list views (Mockup 07) need a column to surface it.
- **No-op canary calibration was not represented.** A status indicator on Mockup 03 (Rollout pipeline) needs to show "calibration in progress" vs "live."
- **Per-run version pinning was implicit.** Should be named explicitly in the promote / rollback modals (Mockups 04, 06).
- **Phase 1 vs Phase 2 distinction was muddled.** The pipeline page (Mockup 03) needs a status banner clarifying that customer rings are inactive in Phase 1.

### 2.4 Why now, why this shape

Three things make this the right time to commit to a brief:

1. **The closed-loop / amendment-primitive feature needs a safety harness.** Drafted in a parallel session (see §11). Without staged rollout, the upward-promotion path of subaccount-discovered improvements to system tier cannot ship safely.
2. **The substrate is ready.** Prefix-hash, per-run LLM ledger, scorecard verdicts, and skill versioning are all live (§2.2). Phase 1 connects them; it does not invent them.
3. **The internal-release flavour can ship pre-launch.** The earlier session paused this work on "first live agency client." That trigger holds for customer rings but not for internal rings. Synthetos staff shipping system-skill changes through internal test subaccounts is a process change, not a customer-facing rollout, and is permitted under the current `commit_and_revert` posture.

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
| `pinned_prompt_version` | text | system-prompt version active at first step |
| `pinned_skill_versions` | jsonb | map of `{ skill_slug: version_id }` for every skill resolved at first step |
| `pinned_model` | text | model identifier active at first step |
| `pinned_prefix_hash` | text | prefix hash captured at first step, for cache attribution |
| `ring_at_start` | enum | `dev`, `test`, `canary`, `prod_10`, `prod_25`, `prod_50`, `prod_100` |

**Behaviour.** At first step of a run, the resolver captures the active versions for this subaccount and writes them to the run. All subsequent steps in that run use the pinned versions, ignoring any global rollout changes that happen mid-run. This guarantees:
- A rollback affects new runs only; in-flight runs finish on the version they started with.
- Replay is deterministic against the pinned versions; you can re-run a failed trace against the exact configuration that produced it.
- Audit can reconstruct exactly which version produced which output, indefinitely.

**Edge cases the dev session needs to resolve:**
- **Sub-agent runs**: pinned versions inherit from parent or re-resolve? *Recommended*: inherit from parent (the user expects coherent behaviour across the delegation graph).
- **Long-running runs that span a rollback**: let them finish on the old (pinned) version. If the rollback was for a safety-class issue, terminate and replay (see §3.5).
- **Skill amendments** (from the closed-loop feature): pin the amendment stack at first step the same way base skills are pinned.

### 3.2 Ring shape

Four rings, with Prod itself ramping internally. Phase 1 ships the internal-release flavour (Dev and Test populated by Synthetos staff and internal test subaccounts; Canary and Prod inactive until first customer). Phase 2 activates Canary and Prod when `spec-context.md` flips.

| Ring | Cohort (internal release) | Cohort (customer rollout) | Dwell | Primary gate | Promotion trigger |
|---|---|---|---|---|---|
| **Dev** | 5–10 Synthetos staff subaccounts, synthetic + dogfood traffic | same | Same day; until offline eval suite + manual spot check pass | Offline scorecard suite, manual operator spot-check | Manual submit-to-Test |
| **Test** | All staff subaccounts + opted-in dogfood partners (Phase 2 only) | 20–50 accounts | 12–24 h, one business-day cycle | Scorecard verdict delta vs control, operator correction rate, latency p50/p95, cost/run | Automated, all gates green for full dwell |
| **Canary** | (Phase 2 only) | Stratified 5% of customer subaccounts | 24–72 h, at least one weekday cycle | All Test gates plus SPRT-style sequential test on scorecard win-rate; cache-hit-rate delta as **diagnostic only** | Automated, all hard gates green, no sustained soft-gate breach |
| **Prod** | (Phase 2 only) | Remainder, ramped 10% → 25% → 50% → 100%, 12–24 h per step | 12–24 h per ramp step | Same as Canary with tighter thresholds (higher statistical power) | Automated per step; manual approval before each ramp step in early operation |

**Why Prod ramps internally.** Going Canary → 100% in one step throws away the statistical power earned in Canary. Four ramp steps give graceful "stop the bleeding" capability with low operational drag.

**Why dwell times cover a business-day cycle.** Agency subaccounts have heavy diurnal patterns; a 4-hour canary that runs only during one timezone's business hours misses entire failure modes that surface at off-peak or in other timezones.

### 3.3 Cohort selection and stratification

**Recommendation:** stratified random sampling, not pure random; opt-in volunteer ring ahead of customer canary; not paid-tier-first.

**Three stratification axes (all required):**
1. **Skill usage.** Subaccounts that exercise the changed skill heavily must be represented. A canary that randomly excludes the affected skill produces false-green signals.
2. **Run volume bucket.** Include at least one subaccount from each volume bucket (low / medium / high). Without this, a single high-volume subaccount can dominate canary metrics.
3. **Behavioural cluster.** If the existing correction-pattern detector has clustered subaccounts by operator-correction shape, include at least one subaccount per cluster.

Optionally a fourth axis: plan tier, for surface-area coverage. Phase 1 internal-release does not need this (all cohorts are Synthetos staff); Phase 2 customer-rollout adds it.

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

**Primary statistical test.** SPRT (sequential probability ratio test) on scorecard win-rate against a 7-day Prod baseline. α = 0.05 in Canary, α = 0.01 in Prod. SPRT is the right shape because scorecard verdicts are inherently sequential and sampled; a fixed-N test wastes runs once the answer is statistically clear.

**Cache-hit-rate delta is diagnostic only, never a gate.** A prompt change invalidates the prefix cache by design; the metric is uninformative at t=0. Becomes useful after both canary and prod have warmed (≥1 hour or fixed N runs), at which point a large divergence is a signal of unintended prompt-prefix divergence on inputs that should be cacheable. Surface in the canary-health dashboard as a yellow flag, never as auto-rollback trigger. **This is a correction from the earlier mockup-thinking on this branch — see §4.**

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
   - Safety metrics: **2σ** above no-op variance.
   - Non-safety metrics: **3σ** above no-op variance.
4. Re-calibrate quarterly, or any time the baseline traffic shape changes materially.

**Why it matters.** Anthropic's Claude Code reasoning-depth regression flew under the radar for weeks because nobody had calibrated detection thresholds to actual signal size; the regression was real but smaller than the noise floor of their monitoring. The fix is not "tighter thresholds" but "know your variance and set thresholds above it."

**What this protects against.** Two failure modes:
- (a) the threshold is too tight → auto-pause fires on noise → operators lose trust in the pipeline → they manually override → next real regression slips through;
- (b) the threshold is too loose → real regressions don't trigger → they ship → user-visible incident.

**Phase 1 deliverable.** Calibration is run before the pipeline is permitted to auto-pause anything. Until calibrated, all auto-pauses are **advisory** (alert only, no rollback action).

## 4. Mockup integration — how the existing set lines up with this brief

The mockup set at [`prototypes/skill-agent-rings/`](../prototypes/skill-agent-rings/) was drafted before the deep-research passes. The shape survives; specific gate-metric and surface decisions need adjustment.

### 4.1 What stays

- **Per-file mockup structure** (one screen per HTML, ~80–140 lines, Riley house style, light theme, Tailwind + Inter). Matches `docs/frontend-design-principles.md` and the convention used by Riley Observations and cached-context.
- **Two user classes, two design budgets.** Admin screens (01–07) use the relaxed budget; agency-facing screens (08, 09) use the strict consumer-simple budget. Confirmed correct by the research — agencies see "updated, here's what changed," not "rev 45 promoted from canary to prod_10."
- **Four-ring shape.** Convergent with the research recommendation.
- **One-confirm rollback.** Section 3.5 confirms this is right for the default case.
- **Auto-pause status as the first thing you read on canary health.** Section 3.4 confirms.

### 4.2 Two revisions the research forces

**Revision A — Cache-hit-rate moves from gate to diagnostic.**
- *Affected mockup:* `05-canary-health.html`.
- *Current state:* the canary-vs-prod comparison table treats cache-hit-rate delta as a primary signal alongside error rate, escalation rate, cost, latency, and output quality.
- *Required change:* remove cache-hit-rate from the primary comparison table. Surface it in the **Advanced — raw signals & thresholds** collapse instead, framed as a diagnostic ("expected after prompt change; large divergence after warm-up is a yellow flag"). The existing mockup already has the Advanced section and already mentions "−9% · expected after prompt change" — the change is to demote it from the primary table to Advanced-only.
- *Why:* a prompt change invalidates the prefix cache by design (§3.4). The metric is uninformative at t=0 and can't be a gate.

**Revision B — Reversibility class becomes a column on skill-list views.**
- *Affected mockup:* `07-system-skills-library.html`.
- *Current state:* skill list shows name, live version, in-flight version.
- *Required change:* add a Class column (I / R / K / X) between Name and Live version. X-class rows should show a small "human approval at every execution" indicator. The skill detail (Mockup 02, when reused for skills) should display the reversibility class prominently next to the title.
- *Why:* the dev session needs a UI surface that makes reversibility class operationally visible. Without it, the classification is data, not signal.

### 4.3 Three smaller refinements

**Refinement C — Calibration status indicator on the rollout pipeline (Mockup 03).** Add a small status pill at the top of the page reading "Calibration: live · 2σ/3σ" or "Calibration: in progress · advisory mode" so an admin knows whether auto-pause is real or alert-only. Phase 1 default is "advisory mode" until the no-op canary has run for a week (§3.8).

**Refinement D — Per-run version pinning called out in the promote and rollback modals.** Mockup 04 (promote) and Mockup 06 (rollback) should explicitly mention "in-flight runs finish on their pinned versions" in the "what happens" body. The Mockup 06 copy already has this line ("12 runs currently in flight finish on rev 44") — keep it; add an equivalent line to Mockup 04 explaining that promotion does not interrupt in-flight runs on the old version.

**Refinement E — Phase 1 vs Phase 2 status banner on the rollout pipeline (Mockup 03).** A small banner at the top of the page: "Internal release · customer rings inactive until first live customer" while in Phase 1. The four-ring diagram remains, but Canary and Prod cards are visually dimmed and the promote-to-canary button is disabled with a tooltip "Activates when first customer onboards."

### 4.4 Where each architectural section maps to a mockup

This is the spec-session's mapping table — useful when the spec session is decomposing into chunks.

| Brief section | Primary mockup | Touches |
|---|---|---|
| §3.1 Per-run version pinning | n/a (backend primitive) | Modals 04, 06 reference it in copy |
| §3.2 Ring shape | Mockup 03 | All admin screens carry ring pill |
| §3.3 Cohort selection | Mockup 04 (promotion modal) | "What happens next" body |
| §3.4 Gate metrics | Mockup 05 | The primary surface for monitoring |
| §3.5 Rollback semantics | Mockup 06 + new "hotfix prompt" operation | Promote modal also touches hotfix |
| §3.6 Reversibility taxonomy | Mockup 07 (new column) + skill detail | Cross-cutting on every skill row |
| §3.7 Emergency disable flag | New mockup needed: `10-kill-switch.html` | Admin top-nav action |
| §3.8 No-op calibration | Mockup 03 (status indicator) | Pipeline page only |

**Mockup 10 (kill switch) is missing from the current set.** Add it as part of the spec-session's mockup-refresh chunk.

## 5. What is explicitly out of scope (Phase 1)

- **Customer-facing rings (Canary, Prod).** Built in code but inactive. Activated when first live customer lands and `docs/spec-context.md` flips `rollout_model` off `commit_and_revert`. Phase 1 ships Dev and Test only.
- **Opt-in volunteer ring (Test+).** Deferred to Phase 2. Requires a customer to opt in to, which we do not have yet.
- **Org-tier or subaccount-tier promotion through rings.** The pipeline is for system-tier changes only. Org-tier and subaccount-tier changes happen via the closed-loop / amendment-primitive feature (separate brief — see §11), reviewed per subaccount, not ringed.
- **Cross-region or per-region cohort stratification.** Synthetos is single-region in Phase 1. Adds at Phase 2.
- **Automatic skill-classification reasoning.** Phase 1 requires a manual classification pass on the 100+ system skills (I/R/K/X). Auto-classification from observed side effects is a separate feature.
- **Real-time hash-based stratification.** A one-time stratified-sampling job at rollout start is sufficient at our cohort size. Hash-based real-time assignment is over-engineered.
- **Bayesian or mixture-SPRT.** Plain SPRT on the primary scorecard metric is enough. Full Bayesian formalism adds debugging cost without proportional benefit at our scale.
- **Multi-version-per-subaccount experimentation.** Within a subaccount, every run sees the same version (§3.3). A/B testing inside a subaccount is a separate evals feature.

## 6. Sequencing inside Phase 1

**Step 1. Schema.** Per-run version pinning columns on `agent_runs`; `skill_disable_flags` table; `rollout_cohorts` table; `reversibility_class` column on `system_skills`. Migration only, behind a feature flag, no behaviour change yet.

**Step 2. Resolver wiring.** At run start, capture pinned versions; on subsequent steps, use the pinned versions instead of re-resolving. Existing run flows unchanged for any run whose pin matches current global default. Light unit tests.

**Step 3. Manual classification of all system skills into reversibility classes.** Default K when uncertain. Reviewed by Synthetos staff; one-time work, captured as data. Top 30 most-used skills in week 1; remainder over the next month.

**Step 4. Ring shape: Dev and Test rings activated.** Internal release flow: a Synthetos staff member submits a system-skill change, it lands in Dev (their own subaccount), promotes through Test, then ships to global at 100%. No Canary or Prod ramp yet.

**Step 5. Gate metrics aggregation jobs.** SPRT computation on scorecard win-rate. Tool failure rate aggregation. Operator correction rate aggregation. Latency and cost rollups (these exist; just need cohort-aware views).

**Step 6. No-op canary calibration.** Run the unchanged version through the new pipeline for one week. Measure variance. Set initial real thresholds at 2σ / 3σ as appropriate. Pipeline remains in advisory mode (alert only) until calibration completes.

**Step 7. Emergency per-skill disable flag UI.** Single-action operator surface; audit log; immediate effect. Backed by Mockup 10 (to be created — see §4.4).

**Step 8. Mockup refresh.** Update `prototypes/skill-agent-rings/` per §4.2–4.3:
- Cache-hit-rate demoted from primary canary-health table to Advanced (`05-canary-health.html`).
- Reversibility class column added to skill-list views (`07-system-skills-library.html`).
- Calibration status banner on rollout pipeline (`03-rollout-pipeline.html`).
- Phase 1 vs Phase 2 status banner on rollout pipeline.
- Per-run version pinning called out in promote and rollback modal copy (`04`, `06`).
- New Mockup 10: kill switch surface.

**Step 9. Documentation.** Runbook for operating the pipeline (how to promote, how to rollback, what to do on auto-pause). Lives at `docs/rollout-runbook.md`.

**Estimated rough size:** 8 to 12 weeks for one engineer, longer if the no-op calibration phase finds noisy metrics that need pipeline-level fixes before real thresholds can be set.

## 7. Open questions for the dev session

1. **Skill classification pass.** Who reviews? How much time? *Recommended*: Synthetos staff classify the top 30 most-used skills in week 1, the remainder over the next month, with default K as a safe fallback for unclassified skills.

2. **What is "operator correction"?** Currently `feedbackVotes` exist on `task_activity`, `task_deliverable`, `agent_message` but are decorative. To use as a gate metric, the dev session needs to specify which events count: explicit thumbs-down? Edits to a draft? Re-runs of the same task? *Recommended*: start with explicit thumbs-down and edits to agent-produced text; refine after no-op calibration shows variance.

3. **Stratification cohort calculation.** Daily? Per-release? Where is the job that materialises the stratified sample? *Recommended*: per-release, materialised into `rollout_cohorts` at rollout start, immutable for the life of that release.

4. **Sub-agent runs and pinning.** Inherit from parent or re-resolve at sub-agent boundary? *Recommended*: inherit (coherent behaviour across delegation graph) but make this explicit so it's not a silent design choice.

5. **Hotfix-prompt operation.** Is this a first-class rollout operation alongside promote / rollback, or is it just "ship a Test-ring change at maximum speed"? *Recommended*: first-class operation, with reduced gate set (safety scorecards only) and clear audit trail noting it as a hotfix.

6. **Backward compatibility with existing runs.** Runs that started before per-run pinning landed have no pinned versions. How does rollback affect them? *Recommended*: existing in-flight runs at migration time finish on whatever version they happen to resolve to at each step; new runs after migration are fully pinned.

7. **Mockup naming alignment.** Riley Observations introduced a rename (Playbooks → Workflows; current Workflows → Automations). The mockups in this set use "agent" and "skill" which are unaffected, but any future cross-references to Workflows / Playbooks need adjustment before the spec session.

## 8. Success criteria

The build is successful when:

- Any run started today has the pinned prompt, skill, and model versions recorded at run start and uses those versions for every subsequent step.
- A Synthetos staff member can promote a system-skill change through Dev and Test rings without manual intervention beyond initial submission, and observe gate-metric movement at each ring boundary.
- A simulated regression (deliberate small quality drop on a test skill) triggers an advisory alert in Test ring within the dwell window. (Auto-pause cannot be evaluated until customer rings activate in Phase 2.)
- The emergency per-skill disable flag, when triggered, stops new invocations of that skill within seconds, lets in-flight runs finish on the pinned version, and is captured in the audit log.
- Every system skill has a reversibility class assigned (I / R / K / X), and X-class skills cannot execute without an in-place human approval gate.
- No-op canary calibration has run for at least one full week, variance is measured for every gate metric, and real thresholds are set at 2σ / 3σ above no-op variance before any auto-action is enabled.
- The `prototypes/skill-agent-rings/` mockup set reflects the §4.2–4.3 revisions: cache-hit-rate-as-diagnostic-only, reversibility class surface, calibration status indicator, Phase 1/2 banner, per-run-pinning copy, and a Mockup 10 for the kill switch.

## 9. Known failure modes we are designing against

All anchored to public production incidents in the last 18 months.

1. **OpenAI GPT-4o sycophancy (April 2025).** Offline evals and small-scale A/B looked positive; qualitative spot-checks flagged "feels off" but were overruled. Customer-visible regression for four days; full rollback took ~24 hours.
   *Mitigation in this design:* manual spot-check is a hard gate in Test, not an advisory; soft-stop on non-safety scorecard at −2pp regardless of A/B verdict; hotfix prompt as a first-class operation for the bleeding-stop window.

2. **Anthropic Claude Code reasoning depth (Feb–Mar 2025).** Real regression flew under the radar for weeks because internal monitoring thresholds were not calibrated to actual signal size; an outside researcher analysing thousands of session files surfaced it.
   *Mitigation:* no-op canary calibration (§3.8) is a hard prerequisite to auto-action; thresholds are set above measured variance, not at arbitrary percentages.

3. **Replit production database deletion (July 2025).** Agent executed destructive command during code freeze, then misreported its capabilities.
   *Mitigation:* reversibility classification (§3.6); X-class skills require in-place human approval at every execution; shadow execution mandatory for X-class skills in Canary; emergency per-skill disable flag (§3.7) for instant containment.

4. **Cursor pricing rollout (June–July 2025).** Single rollout to all paying customers with no staged communication; users hit hard limits within hours.
   *Mitigation:* customer-rollout flavour uses stratified canary; soft-stop on cost-per-run +15% surfaces unexpected economic impact before broad exposure.

5. **Gemini image generation (Feb 2024).** Diversity post-processing layer over-applied to historical contexts; detected on social media.
   *Mitigation:* emergency per-skill disable flag (§3.7) enables atomic per-feature pause without deploy.

6. **Slow-drift regressions that survive eval suites.** Most published incidents went undetected by internal evals.
   *Mitigation:* operator correction frequency is weighted as the most signal-rich metric (§3.4); hard-stop threshold tight.

7. **Cohort reassignment on rollout restart.** Tools that reassign cohort membership when a rollout is stopped and restarted produce irreproducible post-incident tests.
   *Mitigation:* `rollout_cohorts` table is immutable for the life of a release; restarts reference the saved cohort.

8. **In-flight runs straddling rollback.** Mid-conversation behaviour inconsistency degrades trust.
   *Mitigation:* per-run version pinning (§3.1); in-flight runs finish on their start version regardless of global rollback.

## 10. What this brief is not

**Not a spec.** The dev session produces the spec, including API contracts, migration plans, test plans, and the runbook.

**Not a commitment to the customer-rollout flavour.** Phase 1 ships internal release only; Phase 2 activation depends on first-customer trigger and `spec-context.md` flipping.

**Not a substitute for the runbook.** Auto-pause and rollback procedures need a written operational doc (`docs/rollout-runbook.md`) that humans can follow at 2am when something fires. The brief specifies the primitives; the runbook specifies the moves.

**Not a marketing pitch.** External framing is "we promote changes through stages with safety gates," never "we have automated rollback AI."

## 11. Dependencies and related work

### Closed-loop skill improvement / amendment-primitive feature

A parallel dev session has drafted a closed-loop brief (referenced by the originating session as `tasks/research-briefs/closed-loop-skill-improvement-dev-brief.md`). That document is **not currently present in this branch** — it lives on a separate working branch in the parallel session. The two features are deeply linked:

- The closed-loop feature ships an **amendment primitive** that lets subaccount-level corrections accumulate into discoverable improvements at org and system tiers.
- Without staged rollout, the **upward-promotion path** of those improvements to system tier cannot ship safely. Promoting an amendment that worked for one subaccount to all subaccounts without the four-ring pipeline is "ship and pray."
- Conversely, the closed-loop feature is the primary **source of changes** the staged rollout pipeline gates. Phase 1 of staged rollout can ship without closed-loop, but its main customer (the amendment-promotion path) is unmet until both features land.

**Recommended order**:
1. Closed-loop / amendment primitive ships first (independent feature, builds on existing scorecard + skill-versioning).
2. Staged rollout Phase 1 ships second (gates internal-tier-promotion of amendments).
3. Staged rollout Phase 2 activates when first customer onboards.

When the closed-loop brief lands on main, link it from this brief's §11 and remove the "not currently present in this branch" caveat.

### Other related work on main

- **Cached context infrastructure** (PRs landed via migration 0185+). The prefix-hash column on `llm_requests` is the substrate for the cache-hit-rate diagnostic in §3.4.
- **LLM observability ledger generalisation.** The `/system/llm-pnl` admin page and `llm_inflight_history` table are the substrate for the per-step cost and model attribution this brief assumes.
- **Riley Observations — Explore Mode / Execute Mode.** Per-run safety mode for the *end user* (operator choosing "try this safely"). Orthogonal to the per-revision safety this brief provides for the *platform author*. The two compose: Dev ring runs ≈ author running in Execute mode on their own test subaccount.

### Spec-context flag

This brief assumes `docs/spec-context.md` currently states `rollout_model: commit_and_revert` and `staged_rollout: never_for_this_codebase_yet`. Phase 1 ships under those flags (internal-release flavour is not customer-facing). Phase 2 activation requires the flag to flip, which happens when the first live agency client onboards.

### Source artefacts

- Three deep-research passes on staged rollout (Claude / Gemini / ChatGPT) — raw outputs archived in the parallel session; key findings synthesised in §2.4 and §3.
- Original brief location: `tasks/research-briefs/staged-rollout-dev-brief.md` on the parallel session's branch. This document supersedes it for the canonical version on `claude/analyze-agent-orchestration-4Gdlz`.
- Mockup set on this branch: `prototypes/skill-agent-rings/` (drafted before research; needs §4 revisions).
