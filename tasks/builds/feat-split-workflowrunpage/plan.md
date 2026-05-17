# Plan — feat-split-workflowrunpage

**Spec:** `tasks/builds/feat-split-workflowrunpage/spec.md` (§10 migration plan is source of truth).

**Source file:** `client/src/pages/subaccount/WorkflowRunPage.tsx` (952 LOC).
**Target host LOC:** ≤ 200.

Chunks (per spec §10):
1. `types.ts` (types + constants) + `format.ts` + tests.
2. `useWorkflowRunEnvelope` hook (envelope state, WS subscription, polling fallback, default selection).
3. `StepDetailPane` extraction.
4. `RunHeader` + `StepDag` extraction.
5. `HitlActionBar` extraction.
6. Verify + cleanup.

Notes:
- The hook owns `selectedStepRunId` so default-selection stays co-located with envelope derivation (spec §7).
- `useSocketRoom('workflow-run', runId, events, refetch)` — 8 event handlers all call `refetch()`; `onReconnectSync = refetch` (spec §7).
- 12s polling fires only while `!socketConnected && envelope.run.status` non-terminal.
- `TERMINAL_RUN_STATUSES`, `STATUS_COLORS`, `STATUS_DOT_COLORS`, `SIDE_EFFECT_COLORS` constants move to `types.ts`.
- `orderedStepRuns` topological sort, `stepDefById`, `selectedStep` derivation stay in host across all chunks (spec §7 final note).
- No `.js` suffixes on relative imports.
