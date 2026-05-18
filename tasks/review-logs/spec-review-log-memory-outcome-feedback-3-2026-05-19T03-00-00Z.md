# Spec Review Log — memory-outcome-feedback — Iteration 3

- Date: 2026-05-19
- Spec commit at start: `65d73a18` (iter2 output)
- Codex output: `tasks/review-logs/_codex_memory-outcome-feedback_iter3_2026-05-19T03-00-00Z.txt`
- Codex findings: 5 (all new; Codex explicitly said spec is "not yet mechanically tight" — the savepoint/conflict primitive was the blocker)
- Rubric findings (Claude-side): 0 additional

## Dispositions

All 5 findings are mechanical consistency fixes. All 5 applied. No reclassifications. No rejections.

- **F1 — Postgres transaction error handling.** §4.6 now pins the primitives: `ON CONFLICT (run_id, entry_id, source) DO NOTHING` for the expected 23505 case (no error raised; row count distinguishes written vs idempotent); per-row `SAVEPOINT` for unexpected non-conflict errors. Same-tx advisory-lock invariant preserved.
- **F2 — Scorecard idempotency contradicts later-judgement.** §10.3 adds rule (b.2) for scorecards mirroring (b.1) for approvals: first-signal-sticks per `(run_id, entry_id, source)`; second judgement classified as `idempotent`. §10.1 wording updated; §18 deferred item extended.
- **F3 — Approval lookup scope inconsistent.** §4.5.2 now reads `approvalsForTask` by `(taskId, artefactId)` not `taskId`. Matches §3.4's canonical-store contract.
- **F4 — `written` scalar vs object.** §10.4 now defines `writtenTotal = counts.written.positive + counts.written.negative`; §10.4 / §10.5 use `writtenTotal` consistently.
- **F5 — `reason: 'flag_off'` missing from schema.** §6.5 terminal-event shape adds optional `reason?: 'flag_off' | 'no_runs_resolved' | 'all_none' | 'no_memory'`.

## Iteration 3 counts

- Mechanical findings accepted:  5
- Mechanical findings rejected:  0
- Directional findings:          0
- Ambiguous findings:            0
- Reclassified -> directional:    0
- Autonomous decisions:          0
- Spec commit after iteration:   (set after auto-commit step)

This is a mechanical-only round. Iteration 2 was also mechanical-only. Per the stopping heuristic ("two consecutive mechanical-only rounds = stop"), iteration 4 would NOT be started after this — convergence reached.

Subject to one final convergence-confirmation iteration in case Codex's iter3 commentary ("not yet mechanically tight" with savepoint + scorecard-uniqueness as the blockers, both now addressed) was the load-bearing remaining concern. The agent runs iteration 4 to confirm convergence.
