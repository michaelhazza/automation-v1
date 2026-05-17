# Auto-Fix Loop — wave-6-cleanup-batch — 2026-05-17T12:20:00Z

PR: #346
Branch: claude/wave-6-cleanup-batch
Started: 2026-05-17T12:20:00Z
Iteration cap: 5
Guardrails active: G1 (test files off-limits), G2 (50-line diff cap), G3 (category allowlist), G4 (this log)

## Iteration 1 — 2026-05-17T12:20:00Z

- **Failed check:** unit tests → `verify-error-code-taxonomy.sh` (blocking gate inside the `test:gates` step)
- **Root cause (one sentence):** dual-reviewer's fix to OSI-DEF-7 in `server/routes/operatorSessionConnections.ts:502` introduced the errorCode literal `'invalid_agent_id'`, which is not yet registered in `shared/types/errorCodes.ts` `ERROR_CODES`; the taxonomy gate fail-closes on unknown codes.
- **Category (G3 allowlist match):** registry-entry-missing (Missing-or-wrong-imports adjacent — same shape: add a known-named symbol to a canonical list so a downstream check resolves it). Auto-fix allowed.
- **Guardrail status:** G1=PASS, G2=1/50, G3=PASS, G4=logged
- **Fix:** Add `'invalid_agent_id'` to `shared/types/errorCodes.ts` `ERROR_CODES` between `'idempotency_key_collision_unresolvable'`'s neighbour `'invalid_form_values'` (alphabetical insertion).
- **Diff:** (pending commit)
- **CI re-fire result:** pending at next poll

**Local gate verify before commit:** `bash scripts/verify-error-code-taxonomy.sh` → exit 0 (was exit 1 with "unknown error code 'invalid_agent_id'" message before fix).

**Note for finalisation log:** this also closes the pr-reviewer R2 RR-N1 consider item that was routed to `tasks/todo.md § W6Q-RR-N1` — the taxonomy gate turned what looked like a deferrable consistency drift into a blocking gate. RR-N1 backlog entry should be removed.
