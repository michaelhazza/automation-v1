# Spec Review — Iteration 2

**Spec:** `docs/superpowers/specs/2026-04-29-pre-prod-boundary-and-brief-api-spec.md`
**Iteration:** 2 of 5
**Timestamp:** 2026-04-29T02-45-11Z
**Branch HEAD at start:** `1034c9c0` (iter1 commit)
**Spec-context commit:** `03cf81883b6c420567c30cfc509760020d325949`

---

## Findings (Codex output)

Codex returned 16 findings.

### i2-F1 — Phase 1 leaves 50 MB vs 25 MB hedge despite G1/AC1 committing to 50 MB
- Section: §6.1 lines 133–136; §2 G1; §14 AC1
- Classification: mechanical (cross-section contradiction)
- Disposition: ACCEPT
- Fix: removed "Architect to confirm 50 MB vs 25 MB" hedge; commit verdict to 50 MB.

### i2-F2 — Tempfile cleanup hook location undecided
- Section: §6.1 lines 136–138; §10.6
- Classification: mechanical (architect-call hedge for a local middleware decision)
- Disposition: ACCEPT
- Fix: committed verdict — cleanup hook lives inside `validateMultipart` (middleware-level). Removed the "Architect to confirm" line.

### i2-F3 — Cleanup-job pg-boss vs setInterval undecided (re-flag of iter1 F7)
- Section: §6.2.4; §9
- Classification: rejected-mechanical (intentional architect-deferral per the user's invocation note)
- Disposition: REJECT (same reason as iter1 F7)
- Reason: per the user's note, "cleanup-job pg-boss vs setInterval" is one of the architect-call items intentionally deferred. The spec already names pg-boss as the default recommendation; the architect agent will record the final verdict during plan breakdown. Codex's claim that this contradicts the file inventory was addressed by iter1 F6 (file inventory now lists `server/index.ts` for both Phase 2 and Phase 3 — covers either implementation choice). No further spec edit required.

### i2-F4 — TTL cleanup deletes buckets too early for the 1-hour test-run limiter (CRITICAL)
- Section: §6.2.4 lines 184–186; §6.2.5 line 199; §7.1
- Classification: mechanical (load-bearing claim with broken mechanism)
- Disposition: ACCEPT
- Reasoning: this is a real correctness bug. The sliding-window read needs the *previous* window's bucket. The longest `windowSec` in the call-site set is 3600 (test-run hourly limiter). A 1-hour cutoff would delete the previous-window row at the same moment the current window rolls over, silently degrading the sliding-window approximation back to a fixed window.
- Fix: cleanup cutoff extended to `2 * max(windowSec) = 2 hours`. §6.2.4 carries the retention rationale ("if a longer-window call site is ever added, this constant is updated in the same PR"). §7.1 cleanup example and §10.2 operation both updated to `interval '2 hours'`.

### i2-F5 — Contract "does not throw" vs §10.1 "treat a failed check() as a 500"
- Section: §7.1; §10.1
- Classification: mechanical (cross-section contradiction)
- Disposition: ACCEPT
- Fix: §7.1 JSDoc rewritten — "does NOT throw for denial outcomes" (denial is `allowed: false`); operational DB errors propagate as a rejected promise (caller maps to 500). Aligns with the no-retry contract in §10.1.

### i2-F6 — "Single round-trip" claim with no SQL shape pinned
- Section: §6.2.3; §7.1; §10.1
- Classification: mechanical (load-bearing claim without backing mechanism)
- Disposition: ACCEPT
- Fix: §6.2.3 now carries the explicit CTE — `WITH upserted AS (INSERT … ON CONFLICT DO UPDATE …), prev AS (SELECT … FROM rate_limit_buckets WHERE … window_start = $previous_window_start) SELECT upserted.current_count, COALESCE(prev.prev_count, 0) FROM upserted LEFT JOIN prev ON true`. The single-statement CTE is the mechanism behind "one round-trip"; the prior wording ("read + UPSERT") was 2 round-trips and inconsistent with the claim.

### i2-F7 — Login limiter pre-validation but key uses email (re-flag of iter1 F13)
- Section: §6.2.5; §8 access-control table
- Classification: directional (re-flag — already AUTO-DECIDED in iter1)
- Disposition: REJECT-as-duplicate
- Reason: this exact concern was AUTO-DECIDED in iter1 F13 and routed to `tasks/todo.md` for the human to confirm. Codex re-flags it because the spec text still describes the original ordering. The decision is intentional — the route order is a design call deferred to the architect / human. No further spec edit; the entry remains in `tasks/todo.md` § Deferred from spec-reviewer review.

### i2-F8 — `checkTestRunRateLimit` callers not enumerated
- Section: §5 lines 109–110; §6.2.5; §14
- Classification: mechanical (file-inventory drift; "architect to enumerate" hedge)
- Disposition: ACCEPT
- Fix: enumerated all four caller routes — `server/routes/agents.ts:167`, `server/routes/skills.ts:158`, `server/routes/subaccountAgents.ts:286`, `server/routes/subaccountSkills.ts:125`. Added a new file-inventory entry for the existing `server/services/__tests__/testRunRateLimitPure.test.ts` (deleted alongside `testRunRateLimit.ts`; equivalent coverage from `computeEffectiveCount` pure tests + static inspection). §6.2.5 row updated to make the four call sites explicit and to note they become async.

### i2-F9 — Inventory missing `package.json`, lockfile, and new pure-unit test files
- Section: §5
- Classification: mechanical (file-inventory drift)
- Disposition: ACCEPT
- Fix: added rows for `package.json` (server workspace) + lockfile (express-rate-limit removal); `server/services/__tests__/rateLimiterPure.test.ts` (new, Phase 2, `computeEffectiveCount` tests); `server/services/__tests__/scopeResolutionPure.test.ts` (new, Phase 5, `shouldSearchEntityHint` tests). The reseed-guard test file was NOT added because i2-F13 changed that verification to static inspection.

### i2-F10 — Retry-After triple-state contradiction
- Section: §6.2.5 line 207; §7.1; §13
- Classification: mechanical (cross-section contradiction)
- Disposition: ACCEPT
- Fix: chose the mandatory verdict (matches the §7.1 contract example). §6.2.5 on-failure clause: "the route responds with 429 + body + `Retry-After: <secondsUntilResetAt>` header derived from `result.resetAt`. Mandatory across every 429 path the new primitive emits." §13 deferred-items entry replaced with a one-line HTML comment noting "NOT deferred — Phase 2 / 6 mandate it everywhere."

### i2-F11 — Phase 4 says "Path C only" but contract requires every `brief_created` arm
- Section: §5; §6.4.2; §6.6.2; §7.4
- Classification: mechanical (cross-section contradiction; the contract producer + tests + integration table all explicitly cover Path A pendingRemainder, Path B decisive, Path C plain)
- Disposition: ACCEPT
- Fix: §5 inventory rows for `sessionMessage.ts` and `GlobalAskBar.tsx` rewritten to "every `brief_created` arm (Paths A/B/C)". §6.4.2 prose retitled to "every `brief_created` arm" with explicit enumeration. §6.4.3 GlobalAskBar prose updated. §7.4 contract Consumer line: "every `brief_created` arm handler (Paths A/B/C)".

### i2-F12 — Envelope "optional" prose vs "required nullable" interface
- Section: §6.4.1; §7.4
- Classification: mechanical (terminology drift; prose says "optional" but the TypeScript interface declares the fields as required-nullable)
- Disposition: ACCEPT
- Fix: §6.4.1 prose updated — "the resolved-context fields (`organisationId`, `subaccountId`, `organisationName`, `subaccountName`). All envelope fields are required at the type level; the name fields and `subaccountId` may be `null` …". The interface in §7.4 is unchanged (it was correct).

### i2-F13 — Reseed env guard "pure unit test" not mechanically pure
- Section: §6.7.1; §12
- Classification: mechanical (testing-posture vs implementation drift; the literal `if (process.env.NODE_ENV !== 'development') throw …` block is not a pure helper)
- Disposition: ACCEPT
- Fix: §12 row changed to "Static inspection: the top-of-script guard block is present and runs before any `pool.connect()` / DDL statement. No runtime test — the guard is a single literal check; introducing a pure helper to test it would add abstraction the script doesn't otherwise need."

### i2-F14 — Reseed prose drift (`pool.query('BEGIN')` vs leased `client.query`)
- Section: §6.7.2; §10.7
- Classification: mechanical (prose drift between intro line and code block; the introductory line said `pool.query('BEGIN')` but `pool.query` would not establish a transaction — every call could land on a different connection)
- Disposition: ACCEPT
- Fix: §6.7.2 intro rewritten — "lease a single `client` via `pool.connect()` and run all of `BEGIN` / `UPDATE` / `COMMIT` / `ROLLBACK` through `client.query`. Never call `pool.query` for any of these — that returns a different connection per call and would not establish a transaction." Aligns with the code block immediately below.

### i2-F15 — Webhook open-mode warning prose says "boot" but implementation is first-call
- Section: §6.3.2; §7.3; §9
- Classification: mechanical (prose drift)
- Disposition: ACCEPT
- Fix: §6.3.2 closing sentence updated — "a single warning on the first callback verification per process answers that". The actual implementation (§3.2 first-call branch) is correct; only the prose was wrong.

### i2-F16 — Test matrix still says "spillover smoke check" after all-disk verdict
- Section: §6.1; §12
- Classification: mechanical (stale phrase after iter1 F3 resolution)
- Disposition: ACCEPT
- Fix: "Multer disk-spillover tests beyond a smoke check that a >5 MB upload survives a round-trip without OOM" → "Multer upload-flow tests beyond a manual PR smoke that a sizeable upload (e.g. ~20 MB, well under the 50 MB cap) survives a round-trip via the new `multer.diskStorage` configuration without OOM".

---

## Rubric findings (my own pass, not from Codex)

No new rubric findings beyond Codex's set. The Codex pass picked up every contradiction and stale phrase the rubric pass would have surfaced.

---

## Iteration 2 Summary

- Mechanical findings accepted:  14 (i2-F1, i2-F2, i2-F4, i2-F5, i2-F6, i2-F8, i2-F9, i2-F10, i2-F11, i2-F12, i2-F13, i2-F14, i2-F15, i2-F16) = **14 mechanical fixes applied**
- Mechanical findings rejected:   2 (i2-F3 architect-deferral; i2-F7 already AUTO-DECIDED in iter1)
- Directional findings:           0 NEW (i2-F7 is a re-flag of iter1's F13 — already routed to tasks/todo.md)
- Ambiguous findings:             0
- Reclassified → directional:     0
- Autonomous decisions (directional/ambiguous): 0
  - AUTO-REJECT (framing):    0
  - AUTO-REJECT (convention): 0
  - AUTO-ACCEPT (convention): 0
  - AUTO-DECIDED:             0
- Spec commit after iteration:   pending — committed at end of Step 8b

**Stopping heuristic check:** N=2, mechanical_accepted=14, mechanical_rejected=2, directional=0 NEW. Iteration 2 produced ZERO new directional findings — only mechanical fixes and re-flags of already-decided items. This is the first mechanical-only iteration. If iteration 3 also returns only mechanical findings (and zero new directional), the loop will exit per the "two consecutive mechanical-only rounds" stopping heuristic. Proceed to iteration 3.
