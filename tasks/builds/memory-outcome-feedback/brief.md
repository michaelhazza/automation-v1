# Brief — Memory Outcome Feedback (close the loop between scorecard verdicts and memory confidence)

**Status:** DRAFT v1 (2026-05-18) — operator-captured from LinkedIn trend analysis + post-merge gap re-assessment
**Type:** Decision / scope brief — NOT an implementation spec
**Build slug:** `memory-outcome-feedback`
**Class:** Significant
**Source pattern:** localmem (https://github.com/jordanaftermidnight/localmem) confidence-decay-on-failure and effective-score formula; LinkedIn OP commentary on "learn only from resolved outcomes" and "failures decay confidence." Pattern lift only — no code adoption.
**Surfaces validated against main:** commit `6e48183` (2026-05-19). Hook sites confirmed: `server/jobs/scorecardJudgeJob.ts` (verdict write), `server/services/taskApprovalService.ts` (approval decision write), `server/services/workspaceMemoryService/reinforcementBatch.ts` + `decayPure.ts` (signal layer), `server/config/memoryConsolidationConfig.ts` (versioned signal weights), `scripts/audit/audit-memory-consolidation.ts` (extendable audit script).

## Table of contents

1. What already exists (extends — does NOT re-introduce)
2. Problem
3. Goal
4. Non-goals
5. Proposed approach (architect locks at spec)
6. Operational constraints
7. Determinism & replayability
8. Rollout & rollback
9. Files in scope
10. Out of scope
11. Success criteria
12. What unblocks when this ships
13. Concurrent safety note
14. Provenance
15. How to start

---

## What already exists (extends — does NOT re-introduce)

Two adjacent systems just shipped and almost touch but do not yet connect:

- **`closed-loop-skill-improvement`** (PR #353, merged 2026-05-18) — `scorecardJudgeService` writes scorecard verdicts (PASS / FAIL / MIXED); accepted amendments are tracked; rejected amendments become regression cases. The signal that "this run was judged failed" is now produced reliably.
- **`memory-tiered-consolidation`** (PR #351, merged 2026-05-18) — memory blocks decay by tier-specific Ebbinghaus formulas; promotion is driven by three reinforcement signals (`reinforcement_count`, `cross_session_recurrence`, `recency`); reinforcement-on-access is batched. Signal weights live in `MemoryConsolidationConfig` and are versioned.
- **`memory-improvements`** (PR #298, merged 2026-05-13) — `agent_run_prompts.injected_entry_ids` already records which memory blocks were injected into which run. The provenance link from "run" to "memory blocks consulted" exists today.

## Problem

When an agent acts on a memory block and the resulting action is then rolled back, rejected by approval, or judged FAIL by the scorecard, the memory block that informed the action is not penalised. Conversely, when a memory block contributes to a successful run that survives all gates, the block gets only the access bump — not a stronger signal that "this memory led to a verifiable good outcome."

Result: memory confidence today is correlated with **use**, not with **outcome quality**. Popular-but-wrong memory decays slower than rare-but-right memory. Over time the memory store drifts toward "what gets cited" rather than "what gets cited and then ratified by the scorecard."

This is the missing link between two systems that are otherwise self-improving in isolation.

## Goal

Add an `outcome_feedback` signal that connects scorecard verdicts and approval decisions back to the memory blocks that informed the run. Three contracts:

1. **On scorecard FAIL + approval REJECT + rollback fires** — decay the confidence of memory blocks listed in `agent_run_prompts.injected_entry_ids` for that run.
2. **On scorecard PASS + all approvals granted + no rollback** — boost those blocks beyond the usual access bump.
3. **On scorecard MIXED / inconclusive / cancelled run** — no signal either way.

The signal composes alongside the three existing reinforcement signals (`reinforcement_count`, `cross_session_recurrence`, `recency`) in `MemoryConsolidationConfig.signalWeights`. No new flag; reuses the existing `MEMORY_CONSOLIDATION_TIER_ENABLED` flag.

## Non-goals

- **DO NOT** auto-delete memory based on negative feedback. Decay only; never auto-delete; deletion stays an operator action.
- **DO NOT** surface a "memory block recently penalised" UI in v1. Decay is silent; operator-facing memory-inspector affordances are a follow-up.
- **DO NOT** attempt precise causal isolation — v1 attributes coarsely to the full set of blocks injected into a run. Per-block causal attribution within a run is deferred.
- **DO NOT** apply outcome feedback to runs that were blocked / cancelled / never produced a verdict. No signal either way.
- **DO NOT** cross tenant boundaries. Outcome feedback is strictly scoped per `(organisation_id, subaccount_id)`.
- **DO NOT** replace or duplicate scorecard or amendment systems. This is a downstream consumer.
- **DO NOT** introduce a separate "outcome feedback" flag. Reuse `MEMORY_CONSOLIDATION_TIER_ENABLED`.

## Proposed approach (architect locks at spec)

### Signal integration
- Add `outcome_feedback` to `MemoryConsolidationConfig.signalWeights`. Bump config version (audit script records config_version per retrieval today).
- Signal value is a signed delta in `[-1.0, +1.0]`, scaled by the per-tier weight and clamped per-block per-week (anti-recursive ceiling mirroring closed-loop's bounded amendment cadence).

### Dispatch
- On every scorecard verdict write (in `server/jobs/scorecardJudgeJob.ts`, the surface that writes to `scorecardJudgements`) — subordinate `memory:outcome-feedback` pg-boss dispatch inside the same transaction (mirrors the `failure:post-mortem` dispatch pattern shipped by closed-loop).
- On every approval decision write (in `server/services/taskApprovalService.ts`) — same dispatch.
- On every rollback event (when workspace snapshot rollback ships under `task-preview-mode`) — same dispatch. v1 may stub this path if `task-preview-mode` has not landed.

### Job processing
- Reads `injected_entry_ids` from `agent_run_prompts` for the affected run.
- Classifies the outcome: `pass | fail | mixed` (mixed = no signal).
- Emits a signed delta to `reinforcementBatch` (the existing batch flush layer). No new write hot path; integrates with the existing 60s / 500-event batch flush.
- Per-block per-week magnitude cap enforced at write time. Block already saturated this week → delta is dropped with structured log.

### Observability
- Extend `memory.retrieved` event payload with `lastOutcomeFeedbackAt` and `lastOutcomeFeedbackVerdict`.
- New event type `memory.block.outcome_feedback` — `run_id`, `verdict`, `delta`, `block_ids`, `config_version`.
- New counter `outcome_feedback_deltas_applied` per tenant per day in structured logs.

### Replayability
- Deltas recorded against `MemoryConsolidationConfig` version. Same config version + same outcome stream + same seed produces same final scores.

### Audit-script extension
- Extend `scripts/audit/audit-memory-consolidation.ts` with a new check: outcome-feedback firing rate per tenant per day; per-tier delta magnitude distribution; saturated-block count.
- Flag-flip gate (the existing 4-consecutive-pass rule on staging) absorbs the new checks — outcome-feedback ships together with tier-consolidation behaviour or not at all.

## Operational constraints

- No new write hot path. Outcome feedback flushes through the existing `reinforcementBatch`.
- Bounded per block per week. Adversarial inputs (a tenant generating thousands of FAIL verdicts on the same block) cannot decay a block infinitely fast.
- Bounded LLM cost. The job does NOT invoke an LLM — verdict classification is read directly from the scorecard row.
- Tenant isolation enforced at SQL. No cross-tenant outcome feedback ever.

## Determinism & replayability

- Signal weights versioned in `MemoryConsolidationConfig`. Per-run retrieval records the config_version it ran against (already shipped by memory-tiered-consolidation).
- Per-block per-week cap enforced deterministically (no randomness in the feedback application).
- Outcome-feedback deltas applied within the existing reinforcementBatch — same flush semantics, same replay behaviour.

## Rollout & rollback

- Reuses `MEMORY_CONSOLIDATION_TIER_ENABLED` flag. No new flag.
- Flag-off behaviour: outcome-feedback dispatcher runs but applies zero delta (config weight = 0 when flag off) — emits no events, mutates no rows. Behaviour identical to pre-build.
- Rollback: lower the `outcome_feedback` weight in `MemoryConsolidationConfig` to 0 and bump the config version. No code rollback required.

## Files in scope (architect locks at spec authoring)

- New job: `server/jobs/memoryOutcomeFeedbackJob.ts`
- New service: `server/services/memoryOutcomeFeedbackService.ts` + `*Pure.ts`
- Modify `server/jobs/scorecardJudgeJob.ts` — add subordinate `memory:outcome-feedback` dispatch inside the verdict-write transaction (mirrors the `failure:post-mortem` dispatch pattern shipped by closed-loop). Verdict rows live in `server/db/schema/scorecardJudgements.ts`.
- Modify `server/services/taskApprovalService.ts` — add subordinate dispatch on decided approvals (the decision-write surface for the approval gate flow).
- Modify `server/services/workspaceMemoryService/reinforcementBatch.ts` — accept signed deltas in addition to access bumps
- Modify `server/services/workspaceMemoryService/decayPure.ts` (or the post-fusion boost layer) — incorporate `outcome_feedback` into the signal score
- Modify `server/config/memoryConsolidationConfig.ts` — add `outcome_feedback` weight; bump config version
- Modify `scripts/audit/audit-memory-consolidation.ts` — new checks
- New permission check: none (job-level only)
- Tests: pure outcome→delta calculation, bounded-per-block-per-week invariant, replayability against config version, signed-delta math in reinforcementBatch, RLS isolation across tenants

## Out of scope

- Per-block causal attribution within a run (deferred — v1 attributes to the full injected set)
- Operator-facing "recently penalised" UI (deferred to follow-up)
- Cross-tenant outcome learning (explicitly out — closed-loop's same non-goal)
- Auto-deletion of low-confidence memory (decay only)
- LLM-based outcome interpretation (verdicts are read directly from scorecard)
- Feedback signal on cancelled / blocked runs (no signal either way)
- Backfilling historical outcomes onto historical memory blocks (forward-only; v1 starts producing signal at flag-on)

## Success criteria

1. A memory block injected into a scorecard-FAIL run with rejected approval has its retrieval score reduced on the next retrieval cycle relative to its prior score, all other signals held constant.
2. A memory block injected into a scorecard-PASS run with approved actions and no rollback gets a positive delta beyond the access bump.
3. Per-block per-week magnitude cap holds under fuzz testing — adversarial input cannot move a block's score faster than the cap.
4. Tenant isolation invariants hold — no outcome feedback ever crosses `organisation_id × subaccount_id`. RLS fuzz tests pass.
5. Audit script's new outcome-feedback checks pass against a seeded fixture set.
6. Replayability: same config version + same outcome stream produces same final scores.
7. Flag-off behaviour: dispatcher runs but applies zero delta, mutates no rows.

## What unblocks when this ships

- Memory drift toward "popular but wrong" is corrected by an outcome signal anchored in production reality.
- Closed-loop-skill-improvement and memory-tiered-consolidation become one self-correcting learning surface rather than two adjacent systems.
- Foundation for operator-facing memory inspector (deferred): "show me blocks recently penalised by outcome feedback" becomes a tractable query.
- Foundation for the `overnight-digest`'s "lessons learned" bucket — outcome-feedback events become first-class content in the digest.
- Strongest single answer to the LinkedIn OP's "learn only from resolved outcomes" claim: ours is multi-tenant-safe and bounded; his is asserted but not architected.

## Concurrent safety note

Touches `workspaceMemoryService/reinforcementBatch.ts` and `decayPure.ts` AND the verdict / approval write paths. Does NOT collide with `task-preview-mode`, `browser-vision-grounding`, or `browser-hardening-primitives`.

Prerequisites — both must be merged before this brief proceeds:
- `memory-tiered-consolidation` — merged 2026-05-18 (PR #351) ✓
- `closed-loop-skill-improvement` — merged 2026-05-18 (PR #353) ✓

Should NOT run concurrent with `memory-block-edges` if both are scoped at the same time — they both touch the retrieval signal layer. Sequence them.

## Provenance

LinkedIn trend analysis 2026-05-18 (operator-anchored deep dive on the persistent-memory / overnight-agent post). The OP's claim that "failures decay confidence" and "learn only from resolved outcomes" was identified as one of three remaining gaps after `closed-loop-skill-improvement` (PR #353) and `memory-tiered-consolidation` (PR #351) closed the prior two.

External pattern provenance: confidence-decay-on-failure pattern from localmem (effective-score formula `effective = base * (1 + α·access) * exp(-decay·age)`, extended here with outcome signal as a fourth factor). dreamgraph's `validates` / `invalidates` lifecycle reinforces the contract (positive vs negative signal as first-class). No external code adoption; pattern lift only.

## How to start (paste into a new Claude Code session)

```
launch spec-coordinator from tasks/builds/memory-outcome-feedback/brief.md
```
