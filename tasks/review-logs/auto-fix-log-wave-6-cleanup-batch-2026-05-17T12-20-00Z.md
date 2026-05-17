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

## Iteration 2 — 2026-05-17T12:32:00Z

- **Failed check:** unit tests → `verify-types-used.sh` (blocking gate inside the `test:gates` step)
- **Root cause (one sentence):** iter-1's `'invalid_agent_id'` insertion in `shared/types/errorCodes.ts` shifted the `ErrorCode` type definition from line 314 to line 315; the gate's baseline file `scripts/.gate-baselines/types-used.txt` still pinned the `ErrorCode is exported but not referenced` entry to line 314, which the gate's diff-against-baseline now reads as a NEW violation while the line-314 entry is "missing" — flipping the gate from `[WARNING] violations=166` (iter-0 / iter-1 same count, same exit code 2 advisory) to `[BLOCKING FAIL]`.
- **Category (G3 allowlist match):** Gate-script bugs (advisory→blocking flips); specifically the documented baseline-line-realignment precedent — see baseline header comments at lines 6-19 documenting prior realignments by PR #331 / #332 / #337 for the same `errorCodes.ts ErrorCode` line shift.
- **Guardrail status:** G1=PASS, G2=3/50 (1 line update + 2 header-comment lines), G3=PASS, G4=logged
- **Fix:** update `scripts/.gate-baselines/types-used.txt:110` `errorCodes.ts:314` → `errorCodes.ts:315`; add header-comment realignment entry citing wave-6-cleanup-batch PR #346 iter-2 alongside the prior 4 realignment notes.
- **Diff:** (pending commit)
- **CI re-fire result:** pending at next poll

**Local gate verify before commit:** `bash scripts/verify-types-used.sh` → exit 0 (was exit 1 with 1 line-shifted entry before fix). Violation count unchanged at 166 (baseline matches; no net regression).

