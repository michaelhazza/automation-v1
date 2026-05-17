# Iteration 5 — Spec Review Log

Spec: `tasks/builds/wave-4-audit-absorber/spec.md`
Spec commit at start: `b4ee0139`

## Codex findings + classifications

**FINDING #1 — §5.2 — `enqueueHandoff` doesn't return runId; the worker creates the run**
- Classification: mechanical (load-bearing claim against actual primitive).
- Verification: `enqueueHandoff` at pipeline.ts:183 does `pgBossSend` only; `agent_runs` row is created by the `agent-handoff-run` worker.
- Disposition: AUTO-APPLY. Restructured §5.2's "required `enqueueHandoff` extensions" to require pre-creating the child `agent_runs` row inside the extended `enqueueHandoff`, then having the worker resolve the existing row by id. Documented this is a behaviour change in the worker as well.

**FINDING #2 — §5.2 idempotency posture mismatched the actual primitive**
- Classification: mechanical (load-bearing claim against actual primitive).
- Verification: `enqueueHandoff` uses `(agentId, taskId, subaccountId)` running-row check, not pg-boss `singletonKey`; `payload-key` is a handler contract.
- Disposition: AUTO-APPLY. Replaced "pg-boss collapses singleton" with the actual `(agentId, taskId, subaccountId)` mechanism. Today's handler already creates a unique task per sub-task (handoff.ts:225-265), making the existing check work natively. Documented an alternate `dedupKey + unique index` path if chunk 0 picks differently.

**FINDING #3 — §5.2 result shape contradiction (`pending` is additive; `task_id` was omitted)**
- Classification: mechanical (self-contradiction + missing existing field).
- Verification: handoff.ts:319 + 332 emit `task_id` per child.
- Disposition: AUTO-APPLY. Added `task_id` to the result-shape spec; explicitly acknowledged `pending` as an additive (NOT byte-identical) extension; updated `actionRegistry` note to reflect the one LLM-visible shape change.

**FINDING #4 — DUP6 file-path drift**
- Classification: mechanical (file-inventory drift).
- Verification: actual path is `server/services/workflowEngine/queueLifecycle/agentStep.ts`.
- Disposition: AUTO-APPLY. Added `server/services/` prefix wherever `workflowEngine/queueLifecycle/agentStep.ts` was referenced (replace_all).

**FINDING #5 — SK2 inventory missing `server/skills/support/*-*.md`**
- Classification: mechanical (file-inventory drift).
- Verification: 25 kebab files total (16 top-level + 9 in `support/` subtree).
- Disposition: AUTO-APPLY. Expanded inventory to all 25 files; updated gate to walk recursively.

**FINDING #6 — MC7 handler-registration inventory misses service/lib registration sites**
- Classification: mechanical.
- Disposition: AUTO-APPLY. Broadened the inventory scope to `server/jobs/*.ts` + `server/services/*.ts` (e.g. `agentScheduleService.ts`) + `server/lib/*Job.ts`.

## Rubric findings (my own pass — iteration 5)

None. Codex's source-verification pass is finding more than my rubric pass would.

## Iteration 5 Summary

- Mechanical findings accepted:  6 (all Codex)
- Mechanical findings rejected:  0
- Directional findings:          0
- Ambiguous findings:            0
- Reclassified → directional:    0
- Autonomous decisions (directional/ambiguous): 0
- Spec commit after iteration:   <pending>
