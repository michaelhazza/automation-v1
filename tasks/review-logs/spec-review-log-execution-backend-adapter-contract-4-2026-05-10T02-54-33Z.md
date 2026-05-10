# Iteration 4 — execution-backend-adapter-contract

**Date:** 2026-05-10
**Spec commit at start:** bee0d05106f0d09d22a6d5c1da8b88c70cd7e927
**Codex output:** tasks/review-logs/_codex_spec_review_execution-backend-adapter-contract_iter4_2026-05-10T02-54-33Z.txt

## Findings classification

### Codex findings
| # | Section | Severity | Class | Disposition |
|---|---|---|---|---|
| 1 | §13.1, §13.3 vs §4.1 | important | mechanical | accept — no-op predicate inconsistent across sections |
| 2 | §4.1 BackendTerminalState | minor | mechanical | accept — two `task_type` references missed in iter3 sweep |

### Rubric findings (my own pass)

None new this iteration.

## Mechanical changes applied

**§13.1 idempotency table (F1):**
Re-wrote the `finaliseAgentRunFromBackend()` row's mechanism column to match § 4.1 exactly: no-op only when BOTH `parentRun.status ∈ TERMINAL_RUN_STATUSES` AND `terminalState.eventEmittedAt !== null`. Cited `shared/runStatus.ts` as the source of truth for the terminal set. Replaced the looser `parent.status !== 'delegated'` predicate.

**§13.3 concurrency guard (F1):**
Re-wrote the handler-vs-cron race description to match the same predicate: second commit's adapter sees parent terminal AND eventEmittedAt set → returns race-loser shape per § 4.1.

**§4.1 BackendTerminalState (F2):**
Replace-all `task_type` → `type` in comments (two occurrences inside the BackendTerminalState interface doc-block). Spec is now consistent with the actual `iee_runs.type` column name across every reference.

## Rejected / reclassified findings

None.

## Iteration 4 Summary

- Mechanical findings accepted:  2 (Codex: 2, Rubric: 0)
- Mechanical findings rejected:  0
- Directional findings:          0
- Ambiguous findings:            0
- Reclassified → directional:    0
- Autonomous decisions (directional/ambiguous): 0

The spec's no-op predicate is now uniform — every section references the same `terminal AND eventEmittedAt !== null` rule rooted at § 4.1. The `task_type` cleanup is complete.
