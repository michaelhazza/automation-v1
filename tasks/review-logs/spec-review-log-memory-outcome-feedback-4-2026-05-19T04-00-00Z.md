# Spec Review Log — memory-outcome-feedback — Iteration 4

- Date: 2026-05-19
- Spec commit at start: `97762d54` (iter3 output)
- Codex output: `tasks/review-logs/_codex_memory-outcome-feedback_iter4_2026-05-19T04-00-00Z.txt`
- Codex findings: 1 (tenant-consistency pre-validation absent at write time)
- Rubric findings (Claude-side): 0 additional

## Dispositions

One finding. Mechanical. Applied.

- **F1 — Tenant-consistency invariant prose-only.** §5.1 declared the invariant; §4.5 / §4.5.1 did not enforce it at write time. The invariant was only detectable historically by Check 8. Fix:
  - Added new §4.5.3 "Tenant-consistency pre-validation" with a batched `SELECT id FROM workspace_memory_entries WHERE id = ANY($1) AND organisation_id = $2 AND subaccount_id IS NOT DISTINCT FROM $3` query under `withOrgTx`.
  - Step 4 of §4.5 now invokes §4.5.3 before the per-entry loop.
  - Added new `tenantMismatch` counter to terminal-event `counts` (§6.5).
  - Added new event type `memory.outcome_feedback.tenant_mismatch` (§6.5).
  - §11 event-type count bumped 6 → 7.
  - §5.1 prose paragraph updated to cite §4.5.3 as the explicit guard.
  - §15 added the pure helper `filterTenantMatched` to the test inventory.
  - Example terminal logs updated with `tenantMismatch` field and (for noop) `reason: 'flag_off'` from iter3 F5.

Codex's closing sentence ("Everything else looks mechanically tight inside the stated framing") signals that the spec is otherwise converged.

## Iteration 4 counts

- Mechanical findings accepted:  1
- Mechanical findings rejected:  0
- Directional findings:          0
- Ambiguous findings:            0
- Reclassified -> directional:    0
- Autonomous decisions:          0
- Spec commit after iteration:   (set after auto-commit step)

## Stopping decision

Iterations 2, 3, 4 are all mechanical-only (no directional, no ambiguous, no reclassified). Three consecutive mechanical-only rounds exceeds the "two consecutive" stopping threshold. Iteration 5 is NOT started — the lifetime cap is preserved for any future re-review.

Codex's iter4 final commentary ("everything else looks mechanically tight inside the stated framing") + the single finding being a precise, isolated guard addition (not a structural rework) confirms convergence.
