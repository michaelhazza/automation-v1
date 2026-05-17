# Spec Review Plan — feat-split-workflowrunpage

- Spec path: `tasks/builds/feat-split-workflowrunpage/spec.md`
- Spec commit at start: uncommitted (working tree at session start)
- Spec-context commit: `62497257bb53bc99cf55b9f442af951cf4ddd318`
- HEAD at start: `960bc28284e8b307373ae2b0ed92c3756e5bfe9f`
- MAX_ITERATIONS: 5
- Staleness gate: spec-context.md last_reviewed_at = 2026-05-11, today = 2026-05-15, age = 4 days → green.
- Cross-reference: spec framing aligned with context (pre-production, frontend-only refactor, pure-function unit test for `formatDuration` only). No mismatches.
- Stopping heuristic: two consecutive mechanical-only rounds = stop before cap.
- Batch context: batch 2 of page-split refactors. Batch 1 specs (AdminSubaccountDetailPage, Layout, UsagePage) are READY_FOR_BUILD. Pattern: pure refactor, no behaviour change, single Vitest for the surviving pure helper.
