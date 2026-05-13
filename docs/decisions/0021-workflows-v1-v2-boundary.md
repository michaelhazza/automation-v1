# ADR-0021: Workflows V1 → V2 boundary contract

**Status:** proposed
**Date:** 2026-05-13
**Domain:** workflow-engine
**Supersedes:** _n/a_
**Superseded by:** _n/a_

## Context

Workflows V1 (PRs #252, #258) shipped with several boundary parameters that were deliberately left soft for V1 but need to be locked before V2 work begins. Multiple deferred items in the legacy `tasks/todo.md` (W1-F10 lineage-cost budget, REQ 15-7 / 15-8 step quotas, R2-4 `task_id NOT NULL` enforcement, M1-M4 architect-time quotas, F21 / F23 / F24 / F38 / F40 / F42 runtime quotas) all converge on a single question: **what is the contract V2 callers can rely on from V1 runs?** Without that contract, V2 work re-litigates these quotas in every spec.

## Decision

We will lock the **V1 → V2 boundary contract** as:

1. **Depth cap.** Workflows are flat (depth = 1) in V1. No `invoke_workflow` step type. No callback composition. V2 may introduce nested workflows, but any V2 run that calls back into V1 must respect depth = 1 at the V1 boundary (the V1 engine rejects nested-workflow inputs).
2. **Lineage-cost budget.** V1 runs carry a per-run lineage-cost ceiling enforced via the existing cost-breaker (`assertWithinRunBudgetFromLedger`). V2 may inherit / scale this budget but must respect V1's ceiling when the parent is a V1 run.
3. **Two-step migration.** V1 → V2 migration is two steps: (a) V2 ships in parallel to V1 with explicit `engineVersion` discrimination on the `workflows` table; (b) V1 runs are read-only-archived after V2 reaches steady state. No in-place re-execution of V1 runs by V2 (the engine versions are independent).
4. **`task_id NOT NULL` and step quotas.** V2 must respect V1's existing schema invariants on `workflow_step_runs.task_id NOT NULL` and the architect-time runtime quotas (max steps per run, max concurrent steps, max runtime duration) inherited from V1's `workflowEngineService.ts`. Quota values themselves are configuration, not contract; the contract is "these caps exist and are enforced".

## Consequences

- **Positive:**
  - V2 work can begin without re-deciding the boundary parameters.
  - V1 runs become immutable once V2 ships — predictable read pattern for audit and analytics.
  - Closes the "should V2 retry old V1 runs?" question (no — read-only archive).
- **Negative:**
  - V2 engineers cannot reuse V1 runtime infrastructure unconditionally; the `engineVersion` discriminator is a permanent fork point.
  - One-time work to add the `engineVersion` column + read-only archive enforcement before V2 ships.
- **Neutral:**
  - The boundary contract is intentionally narrow. V2 is free to choose any internal shape that satisfies the four rules above.

## Alternatives considered

- **In-place V1 → V2 upgrade** — rejected. Re-executing V1 runs under V2 semantics breaks audit determinism and exposes V1 callers to V2 behaviour changes they did not opt into.
- **Allow V2 to bypass V1's lineage-cost budget** — rejected. Cost-budget breaker is a tenant-safety invariant, not an engine-version detail.

## When to revisit

Re-open when **any one** of these triggers fires:
- V2 engineering starts and the four rules above prove insufficient or wrong in a way that surfaces during the V2 spec authoring.
- A V1 run shape is discovered that the boundary contract cannot express (e.g. cross-run state V2 needs to read).

## References

- Spec: `docs/workflows-dev-spec.md`
- Related items from legacy todo.md: W1-F10, REQ 15-7 / 15-8, R2-4 (`task_id NOT NULL`), M1–M4, F21 / F23 / F24 / F38 / F40 / F42
- Related stub spec: `tasks/builds/workflows-v1-runtime-quotas/spec.md`, `tasks/builds/workflows-v2-strategic-followups/spec.md`
