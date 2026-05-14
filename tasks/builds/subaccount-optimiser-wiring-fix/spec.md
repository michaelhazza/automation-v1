# Stub: Subaccount-optimiser orchestrator wiring fix

**Trigger to activate:** Before the optimiser surface goes live to a real customer — `runOptimiser` is currently never invoked.

**Scope (one paragraph).** Close the critical wiring gap: `runOptimiser` is registered as a job handler but never enqueued. Consolidate: REQ #B7 (runOptimiser never invoked from any orchestrator path), OPS orphan-schedules sweep, DG-4 (timezone-UTC normalisation), DG-6 (cost-gate cost-budget integration). The single coherent "make the optimiser actually run" fix.

**Origin:** Subaccount-optimiser wiring items in legacy `tasks/todo.md`.
