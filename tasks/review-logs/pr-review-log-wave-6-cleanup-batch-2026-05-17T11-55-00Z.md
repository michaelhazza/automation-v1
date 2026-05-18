# PR Re-Review — wave-6-cleanup-batch (post dual-reviewer fix-up)

**Branch:** claude/wave-6-cleanup-batch
**HEAD:** 81790166 (was 4e552afb at prior pr-reviewer pass)
**Scope of this re-review:** commit e4f0a556 only (`server/routes/operatorSessionConnections.ts:495-506` — safeParse + duck-shape 400 throw, replacing the regression introduced by OSI-DEF-7's `.parse()`). Commit 81790166 is log-only.
**Reviewed at:** 2026-05-17T11:55:00Z

Blocking: 0 / Should-fix: 1 / Consider: 2
**Verdict:** APPROVED

---

## 🔴 Blocking — must be fixed before merge

No blocking issues found.

End-to-end trace of the new flow:

1. `z.string().uuid().safeParse(req.params.agentId)` — non-throwing; returns a discriminated union.
2. On `success === false`, handler throws `{ statusCode: 400, errorCode: 'invalid_agent_id', message: 'agentId must be a UUID' }`.
3. `asyncHandler` (`server/lib/asyncHandler.ts:44-46`) catches → delegates to `normaliseRouteError` (`server/lib/asyncHandlerNormalisationPure.ts:30-43`) → duck-shape branch matches (`typeof statusCode === 'number'`) → wraps in synthetic `AppError { code: 'invalid_agent_id', statusCode: 400 }`.
4. `statusCode < 500` branch (asyncHandler.ts:110-121): no `logger.error('unhandled_route_error')`, no `recordIncident()`. Response: `{ error: { code: 'invalid_agent_id', message: 'agentId must be a UUID' }, correlationId }` with HTTP 400.

The fix correctly defeats Codex's `[ACCEPT]` finding. The duck-shape pattern matches established precedent: `server/routes/agents.ts:172`, `server/routes/agentRuns.ts:634`, `server/routes/baselines.ts:85-90`, `server/routes/automationConnectionMappings.ts:43`. The dual-reviewer's chosen pattern is the right one.

---

## 🟡 Should-fix

- [🟡] **RR-S1** `server/routes/__tests__/operatorSessionConnections.test.ts` (does not exist) — Missing regression test pinning the new 400 path.
  Why: The regression that Codex caught (the original `.parse()` causing 500 + incident on a malformed UUID) had zero test coverage; without a test, the same regression can recur via a future "simplify validation" refactor.
  Resolution: added in fix-up commit alongside this log.

---

## 💭 Consider — taste / future-proofing / nice-to-have

- [💭] **RR-N1** `server/routes/operatorSessionConnections.ts:502` — `errorCode: 'invalid_agent_id'` is not registered in `shared/errorCodes.ts:APP_ERROR_CODES`. The normaliser casts it via `as AppErrorCode`, so TypeScript will not flag it. Consistency drift, not a contract bug.
  Resolution: routed to backlog as W6Q-RR-N1.

- [💭] **RR-N2** `server/routes/operatorSessionConnections.ts:495-497` — The dual-review log named ~28 other `.parse(req.body|params|query)` call sites with the same anti-pattern. A one-line tracking entry in `tasks/todo.md` for a future targeted sweep closes the loop.
  Resolution: routed to backlog as W6Q-RR-N2.

---

Blocking: 0 / Should-fix: 1 / Consider: 2
**Verdict:** APPROVED
