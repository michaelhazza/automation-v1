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

<!-- APPEND_HERE -->
