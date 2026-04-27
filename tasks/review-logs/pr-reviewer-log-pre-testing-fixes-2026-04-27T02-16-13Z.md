# pr-reviewer log — pre-testing-fixes (LAEL-P1-1)

**Branch:** `claude/pre-testing-fixes-OPR8w`
**Reviewed:** 2026-04-27
**Diff scope:** LAEL-P1-1 wiring in `server/services/llmRouter.ts` plus build-slug + `tasks/todo.md` updates.

## Outcome

APPROVE WITH MINOR FOLLOW-UPS. No blockers.

## Reviewer findings — disposition

| ID | Finding | Disposition |
|---|---|---|
| Strong-1 | Add a comment near the `llm.requested` emission explaining that captured `provider`/`model`/`attempt` reflect the FIRST attempt to reach the emit site, NOT the eventually-successful provider | APPLIED — comment added at the `llmRequestedEmitted = true` line. |
| Strong-2 | `payloadPreviewTokens` field name is ambiguous; clarify it's INPUT-side context-token estimate | APPLIED — comment added inline at the field assignment. |
| Strong-3 | `tryEmitAgentEvent` fire-and-forget is non-atomic with the tx commit | NO ACTION — reviewer self-noted this is correct per spec §4.1 ("emit must not gate the agent loop"). The emitter catches and logs internally. |
| Strong-4 | Runtime tests missing for the four pairing/atomicity invariants (budget_blocked, non-agent-run, parse-failure-then-success, streaming) | DEFERRED — runtime tests for non-pure logic deferred per `DEVELOPMENT_GUIDELINES.md §7` until testing posture flips. Captured in `tasks/todo.md` LAEL-P1-1 RESOLVED entry as a deferred follow-up. |
| NB-1 | Synthetic failure response could include `attemptNumber` + `provider` + `fallbackChain` for forensic richness | DEFERRED — optional polish; ledger join recovers all fields. |
| NB-2 | Pre-existing spec drift (`requestClarificationMiddleware` vs `requestClarification`) | NO ACTION — pre-existing, not this PR's scope. |
| NB-3 | Add comment that `llmCallStartedAt` MUST be assigned BEFORE `tryEmitAgentEvent` to prevent bogus `Date.now() - 0` durations | APPLIED — comment added immediately above the assignment. |
| NB-4 | Verify `agentRunLlmPayloads` import is in scope | CONFIRMED — already imported. |
| NB-5 | Doc updates align with code | CONFIRMED. |
| NB-6 | No drive-by reformatting | CONFIRMED. |
| NB-7 | `Date.now() - llmCallStartedAt` closure-read safety | CONFIRMED — single-execution-path closure read. |

## Files changed for review-feedback round

- `server/services/llmRouter.ts` — three clarifying comments (Strong-1, Strong-2, NB-3). No semantic changes.
- `tasks/todo.md` — captured Strong-4 deferred test-coverage follow-up under the LAEL-P1-1 RESOLVED entry.
- `tasks/review-logs/pr-reviewer-log-pre-testing-fixes-2026-04-27T02-16-13Z.md` — this log.
