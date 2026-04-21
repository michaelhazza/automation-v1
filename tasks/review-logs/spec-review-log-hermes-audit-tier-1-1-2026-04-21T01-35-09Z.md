# Spec Review Iteration 1 — Log

**Spec:** `tasks/hermes-audit-tier-1-spec.md`
**Spec commit at iteration start:** `947111d0ddb919023ddb7bdfd58af8579197499a`
**Spec-context commit:** `00a67e9bec29554f6ca9cb10d1387e7f5eeca73f`
**Iteration:** 1 of 5
**Timestamp:** 2026-04-21T01:35:09Z

## Pre-loop context check

- `docs/spec-context.md` loaded; framing statements match spec's own framing section (pre-production, rapid-evolution, commit-and-revert, no feature flags).
- §11.1 ("No feature flag. No phased rollout.") aligns with `rollout_model: commit_and_revert`.
- One testing-posture deviation present (RTL + route integration tests) — NOT acknowledged inline as a deviation. Surfaced in Codex finding #6; classified directional, HITL pending.
- Pre-loop check passes; proceeded to iteration 1.

## Codex output

Codex ran successfully. Produced 6 findings (1 P1 inventory-drift, 1 P1 breaker-path contradiction, 3 P2 in-section contradictions, 1 P1 testing-posture deviation). Full Codex output preserved at `C:/Users/micha/.claude/projects/c--Files-Projects-automation-v1/7564114d-23fa-4bef-a8d8-37b476b4fd0c/tool-results/bq7akdpmw.txt`.

## Rubric pass

Ran full rubric against spec sections. Findings:

- File-inventory drift matches Codex P1 #1 — no additional items.
- `runResultStatus` write-once invariant (§6.3.1) has a named mechanism. OK.
- `isUnverified` semantics change (§6.7.1) has a documented compatibility check + fallback. OK.
- Every phase has a verdict; gate order pinned in §9.5. OK.
- Deferred Items section exists at §11.4 with 8 enumerated deferrals. OK.
- One testing-posture deviation matches Codex #6 — classified directional.

No additional rubric findings beyond what Codex surfaced.

## Finding classifications

### FINDING #1 — File inventory drift
- **Source:** Codex P1 #1 + Rubric (Section 2 of spec-authoring-checklist)
- **Section:** §4.1, §4.2, §4.5
- **Description:** §4.1 `shared/types/runCost.ts` row omits `totalTokensIn`/`totalTokensOut`; §4.2 missing `agentExecutionServicePure.ts` + test; §4.2 `workspaceMemories.ts` row contradicts §4.5.
- **Classification:** mechanical
- **Reasoning:** Pure file-inventory drift; no scope, phase, or direction change. Each missing/conflicting entry already described elsewhere in the spec.
- **Disposition:** auto-apply

### FINDING #2 — Phase C breaker read path
- **Source:** Codex P1 #2 + Rubric (Section 8 self-consistency)
- **Section:** §4.3, §7.4.1, §8.3
- **Classification:** mechanical
- **Reasoning:** Reviewer verified `cost_aggregates` IS updated asynchronously (via `routerJobService.enqueueAggregateUpdate` at `llmRouter.ts:897`; no synchronous trigger in migrations). §7.4.1 already names "switch to direct `llm_requests` sum" as the conservative default. The spec made the direction decision; §4.3 and §8.3 just cascade.
- **Disposition:** auto-apply

### FINDING #3 — `runIsTerminal` in RunCostPanel contract
- **Source:** Codex P2 #3 + Rubric
- **Section:** §5.3 vs §5.2.1 vs §4.1 examples
- **Classification:** mechanical
- **Reasoning:** Direct intra-spec contradiction with obviously-correct single resolution: §5.2.1 makes the prop load-bearing, so §5.3 and callers cascade into alignment.
- **Disposition:** auto-apply

### FINDING #4 — Failed-run guard service inputs
- **Source:** Codex P2 #4 + Rubric (load-bearing-claim-without-mechanism)
- **Section:** §6.4 / §8.3 / §6.8 / §6.9
- **Classification:** mechanical
- **Reasoning:** §6.8 already decided on two structured signals. Missing piece is plumbing `errorMessage` into the service — caller already has it in scope. One-shot signature extension + done-criteria wording fix.
- **Disposition:** auto-apply

### FINDING #5 — False-trajectory per-entry verdicts
- **Source:** Codex P2 #5 + Rubric
- **Section:** §6.5 matrix row `success|false|any`
- **Classification:** mechanical
- **Reasoning:** Spec's intent is clear from the other rows and prose. Expanding the row into five concrete rows is matrix completeness, not direction change.
- **Disposition:** auto-apply

### FINDING #6 — Testing-posture deviation
- **Source:** Codex P1 #6 + Rubric (Section 9 of spec-authoring-checklist)
- **Section:** §9.1, §9.3, §4.1, §5.9 done #3
- **Classification:** DIRECTIONAL
- **Reasoning:** Testing-posture changes are on the directional signals list ("Add frontend unit tests", "Introduce a test framework"). Regardless of how obviously correct a resolution looks, the human must own the posture decision.
- **Disposition:** HITL checkpoint at `tasks/spec-review-checkpoint-hermes-audit-tier-1-1-2026-04-21T01-35-09Z.md`

## Adjudication log

```
[ACCEPT] §4.1 / §4.2 / §4.5 — File inventory drift
  Fix: §4.1 extended roles for `shared/types/runCost.ts` and `llmUsage.ts`; §4.2 gained agentExecutionServicePure.ts row + test; `workspaceMemories.ts` "no change" row removed; note added pointing to §4.5; LoC tally updated.

[ACCEPT] §4.3 / §7.4.1 / §8.3 — Phase C breaker read path
  Fix: §4.3 runCostBreaker.ts row now describes the direct-ledger read path as code change. §7.4.1 pinned regime as confirmed async; decision as "switch to direct ledger sum for LLM caller". §8.3 updated to state exported signatures stay, internal read path is new.

[ACCEPT] §5.3 / §5.2.1 / §4.1 — runIsTerminal contract
  Fix: §5.3 RunCostPanelProps includes runIsTerminal. §5.2.1 now references TERMINAL_RUN_STATUSES from shared/runStatus.ts. §4.1 caller examples updated.

[ACCEPT] §6.4 / §6.8 / §6.9 / §8.3 / §4.2 — Failed-run guard
  Fix: RunOutcome extended with errorMessage. §6.8 guard reads outcome.errorMessage. §6.9 done #4 reworded. Inventory rows updated. §1 summary bullet updated.

[ACCEPT] §6.5 — False-trajectory verdicts
  Fix: `success|false|any` row expanded into five per-entry-type rows.

[HITL] §9 et al. — Testing-posture deviation
  Reason: Directional.
  Checkpoint: tasks/spec-review-checkpoint-hermes-audit-tier-1-1-2026-04-21T01-35-09Z.md
```

## Iteration 1 Summary

- Mechanical findings accepted: 5
- Mechanical findings rejected: 0
- Directional findings: 1
- Ambiguous findings: 0
- Reclassified → directional: 0
- HITL checkpoint path: `tasks/spec-review-checkpoint-hermes-audit-tier-1-1-2026-04-21T01-35-09Z.md`
- HITL status: pending
- Spec commit after iteration: (uncommitted working-tree edits)

Loop halts here. Iteration 2 cannot start until the HITL checkpoint's `Decision:` line is resolved.
