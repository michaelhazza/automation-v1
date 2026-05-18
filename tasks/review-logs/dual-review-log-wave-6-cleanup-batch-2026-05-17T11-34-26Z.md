# Dual Review Log — wave-6-cleanup-batch

**Files reviewed:** `git diff origin/main...HEAD` — 46 files, ~575 insertions / 65 deletions. Scope summary: 12 code fixes + 2 doc additions + 1 mechanical sweep + 18 stale-status flips + 9 duplicate-entry closures, plus inline pr-reviewer fix-up commit.
**Iterations run:** 2/3
**Timestamp:** 2026-05-17T11:34:26Z
**Branch HEAD at start:** `4e552afb`
**Commit at finish:** `e4f0a556`

---

## Iteration 1

Codex raised one finding against `git diff origin/main...HEAD`:

```
[ACCEPT] server/routes/operatorSessionConnections.ts:495 — Invalid UUID returns 500 + records incident instead of 400
  Reason: Verified — the newly-added `z.string().uuid().parse(req.params.agentId)`
  throws a bare ZodError. ZodError has no `statusCode` field, so
  asyncHandlerNormalisationPure.normaliseRouteError() falls through to the
  `kind: 'unknown'` branch → asyncHandler returns 500 AND records an incident.
  The global Express error handler at server/index.ts:552 DOES handle
  ZodError → 400, but asyncHandler intercepts the error first and never
  delegates to next() — so the global handler never runs for errors thrown
  inside asyncHandler.

  This regression was introduced in this branch (5cddc767, OSI-DEF-7).
  Other call sites with the same pattern (~28 occurrences across server/routes/)
  are pre-existing tech debt and out of scope for this fix — surfaced for
  a future targeted clean-up, not patched here per §6 surgical-changes.

  Fix applied: switch to z.string().uuid().safeParse(req.params.agentId) and
  throw the canonical duck-typed { statusCode: 400, errorCode, message } 400
  shape used elsewhere in the codebase (matches server/routes/agents.ts:172
  precedent).
```

## Iteration 2

Codex output: *"The change replaces a throwing Zod parse with safeParse and returns the existing structured 400 error shape for malformed agent IDs. No regressions or actionable bugs were identified in the modified code."*

Loop terminates — no further findings.

---

## Changes Made

- `server/routes/operatorSessionConnections.ts` — Replace `z.string().uuid().parse(req.params.agentId)` with `safeParse` + duck-typed 400 throw, with an inline comment explaining why bare ZodError would otherwise become a 500.

## Rejected Recommendations

None. Codex raised one finding; it was accepted and fixed.

**Out-of-scope items surfaced (not applied per §6 surgical-changes):**
The same `parse(req.body)` → unhandled-ZodError-becomes-500 anti-pattern exists at ~28 other call sites across `server/routes/` (counts via `grep .parse\(req\.(body|params|query)`). These were not modified — they pre-date this batch and addressing them belongs in a dedicated targeted fix, not a cleanup-batch dual-review iteration. Surfacing here for the operator to optionally backlog.

---

**Verdict:** APPROVED (2 iterations, 1 fix applied — invalid-UUID 500-to-400 regression in OSI-DEF-7 route closed)
