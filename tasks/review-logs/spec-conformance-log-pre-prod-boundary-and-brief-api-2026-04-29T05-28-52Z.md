# Spec Conformance Log

**Spec:** `docs/superpowers/specs/2026-04-29-pre-prod-boundary-and-brief-api-spec.md`
**Spec commit at check:** `4435c8ae` (HEAD; spec last touched in `e2bc5702` — spec-reviewer iter 3)
**Branch:** `pre-prod-boundary-and-brief-api`
**Base:** `6f24feed` (merge-base with main)
**Scope:** all-of-spec — Phases 1–7, full implementation per caller confirmation
**Changed-code set:** 73 files (committed) + 2 unstaged spec/brief edits + 5 untracked review-log files; 24 in-scope code files this audit verified against
**Run at:** 2026-04-29T05-28-52Z

---

**Verdict:** CONFORMANT_AFTER_FIXES (1 mechanical gap closed; 0 directional items routed)

---

## Summary

- Requirements extracted:     49
- PASS:                       48
- MECHANICAL_GAP → fixed:     1
- DIRECTIONAL_GAP → deferred: 0
- AMBIGUOUS → deferred:       0
- OUT_OF_SCOPE → skipped:     0

---

## Requirements extracted (full checklist)

### Phase 1 — Multer

| REQ # | Category | Spec § | Requirement | Verdict | Evidence |
|---|---|---|---|---|---|
| 1.1 | config | §6.1 | `multer.diskStorage({ destination: os.tmpdir() })` for all uploads | PASS | `server/middleware/validate.ts:19-22` |
| 1.2 | config | §6.1 | `limits.fileSize = 50 * 1024 * 1024` (50 MB hard cap) | PASS | `server/middleware/validate.ts:21` |
| 1.3 | behavior | §6.1 | `res.on('close')` cleanup hook in `validateMultipart` iterating `req.files` array; ENOENT silent; warns `multer.cleanup_failed` on other errors | PASS | `server/middleware/validate.ts:83-95` |

### Phase 2 — Rate-limit primitive

| REQ # | Category | Spec § | Requirement | Verdict | Evidence |
|---|---|---|---|---|---|
| 2.1 | migration | §6.2.1 | `migrations/0253_rate_limit_buckets.sql` creates `rate_limit_buckets (key, window_start, count)` PK + index | PASS | `migrations/0253_rate_limit_buckets.sql` |
| 2.2 | migration | §6.2.1 | `down.sql` drops the table | PASS | `migrations/0253_rate_limit_buckets.down.sql:1` |
| 2.3 | schema | §6.2.2 | `server/db/schema/rateLimitBuckets.ts` Drizzle mirror | PASS | `server/db/schema/rateLimitBuckets.ts` |
| 2.4 | export | §5 | exported from schema barrel | PASS | `server/db/schema/index.ts:239` |
| 2.5 | allowlist | §8 | `rate_limit_buckets` in `scripts/rls-not-applicable-allowlist.txt` with spec ref | PASS | `scripts/rls-not-applicable-allowlist.txt:70` |
| 2.6 | file | §6.2.3 | primitive at `server/lib/inboundRateLimiter.ts` (renamed from `rateLimiter.ts` per plan §4 — `server/lib/rateLimiter.ts` already exists for the outbound provider limiter) | PASS | `server/lib/inboundRateLimiter.ts` |
| 2.7 | interface | §7.1 | `RateLimitCheckResult { allowed, remaining, resetAt }` exported | PASS | `server/lib/inboundRateLimiter.ts:19-31` |
| 2.8 | function | §7.1 | `getRetryAfterSeconds(resetAt)` exported, uses `Math.max(1, Math.ceil(...))` | PASS | `server/lib/inboundRateLimiter.ts:37-39` |
| 2.9 | function | §7.1 | `check(key, limit, windowSec): Promise<RateLimitCheckResult>` exported | PASS | `server/lib/inboundRateLimiter.ts:71-137` |
| 2.10 | impl | §6.2.3 | single CTE round-trip with DB-time alignment, no in-process cache | PASS | `server/lib/inboundRateLimiter.ts:76-103` |
| 2.11 | helper | §6.2.3 | `computeEffectiveCount` pure helper with mandatory clamp `Math.min(1, Math.max(0, …))` | PASS | `server/lib/inboundRateLimiterPure.ts:20-27` |
| 2.12 | observability | §7.1 | `logger.info('rate_limit.denied', { key, limit, windowSec, currentCount, effectiveCount, remaining, resetAt })` once per denial | PASS | `server/lib/inboundRateLimiter.ts:124-134` |
| 2.13 | file | §6.2.4 | `server/lib/rateLimitCleanupJob.ts` — batched DELETE with `FOR UPDATE SKIP LOCKED`, batch=5000, iter cap=20, TTL=2 hours, warns `rate_limit.cleanup_capped` | PASS | `server/lib/rateLimitCleanupJob.ts:1-74` |
| 2.14 | boot | §5 | cleanup job registered in `server/index.ts start()` every 5 min | PASS | `server/index.ts:489` |
| 2.15 | call site | §6.2.5 | login: `rateLimitCheck(rateLimitKeys.authLogin(ip, email), 10, 900)` + Retry-After header | PASS | `server/routes/auth.ts:51-56` |
| 2.16 | call site | §6.2.5 | signup: `rateLimitCheck(rateLimitKeys.authSignup(ip), 10, 900)` | PASS | `server/routes/auth.ts:24-29` |
| 2.17 | call site | §6.2.5 | forgot: `rateLimitCheck(rateLimitKeys.authForgot(ip), 5, 900)` | PASS | `server/routes/auth.ts:93-98` |
| 2.18 | call site | §6.2.5 | reset: `rateLimitCheck(rateLimitKeys.authReset(ip), 5, 900)` | PASS | `server/routes/auth.ts:111-116` |
| 2.19 | call site | §6.2.5 | formSubmission: per-IP (5,60) + per-page (50,60) | PASS | `server/routes/public/formSubmission.ts:25-36` |
| 2.20 | call site | §6.2.5 | pageTracking: per-IP (60,60) | PASS | `server/routes/public/pageTracking.ts:22-27` |
| 2.21 | deletion | §6.2.5 | `server/lib/testRunRateLimit.ts` deleted | PASS | git: deleted in 177c719e |
| 2.22 | call sites | §6.2.5 | 4 test-run routes call `rateLimitCheck(rateLimitKeys.testRun(userId), TEST_RUN_RATE_LIMIT_PER_HOUR, 3600)` | PASS | `agents.ts:169`, `skills.ts:160`, `subaccountAgents.ts:288`, `subaccountSkills.ts:127` |
| 2.23 | deletion | §5 | `testRunRateLimitPure.test.ts` deleted | PASS | git: deleted in 177c719e |
| 2.24 | test | §12 | `rateLimiterPure.test.ts` covers boundary, mid, full window, plus -1e-9 and 1+1e-9 edge cases | PASS | `server/services/__tests__/rateLimiterPure.test.ts:28-65` |
| 2.25 | cleanup | §6.2.5 | `import rateLimit from 'express-rate-limit'` removed from `auth.ts`; `loginAttemptTimestamps`, `enforceLoginRateLimit`, `forgotPasswordRateLimit`, `resetPasswordRateLimit` all removed | PASS | `server/routes/auth.ts:1-11`; grep confirms no remnants |
| 2.26 | header | §6.2.5 | every 429 path sets `Retry-After` via `setRateLimitDeniedHeaders` (which uses `getRetryAfterSeconds`) | PASS | invoked at every call site (auth × 4, formSubmission × 2, pageTracking, test-run × 4, sessionMessage) |

### Phase 3 — Webhook secret

| REQ # | Category | Spec § | Requirement | Verdict | Evidence |
|---|---|---|---|---|---|
| 3.1 | boot | §6.3.1 | `if (env.NODE_ENV === 'production' && !env.WEBHOOK_SECRET)` throw, after `validateSystemSkillHandlers()` | PASS | `server/index.ts:580-585` |
| 3.2 | warn | §6.3.2 / §7.3 | `webhookService.verifyCallbackToken` emits `logger.warn('webhook.open_mode_active', { reason, nodeEnv })` once per process via module-level `webhookOpenModeWarned` flag | PASS | `server/services/webhookService.ts:29, 79-87` |

### Phase 4 — Brief envelope

| REQ # | Category | Spec § | Requirement | Verdict | Evidence |
|---|---|---|---|---|---|
| 4.1 | type | §7.4 | `BriefCreationEnvelope` exported from `shared/types/briefFastPath.ts` with all 7 required fields | PASS | `shared/types/briefFastPath.ts:33-48` |
| 4.2 | route | §6.4.2 / §7.4 | `POST /api/briefs` returns `BriefCreationEnvelope` (typed) | PASS | `server/routes/briefs.ts:73-82` |
| 4.3 | route | §6.4.2 / §7.4 | every `brief_created` arm of sessionMessage (Path A/B/C) returns `{ type: 'brief_created' } & BriefCreationEnvelope` | PASS | `server/routes/sessionMessage.ts:25-29, 194-203, 259-268` |
| 4.4 | client | §6.4.3 | `client/src/components/Layout.tsx` New Brief modal typed as `BriefCreationEnvelope` | PASS | `client/src/components/Layout.tsx:2, 546` |
| 4.5 | client | §6.4.3 | `GlobalAskBar.tsx` and `GlobalAskBarPure.ts` use `BriefCreationEnvelope` (Pure carries the union; the consumer imports `SessionMessageResponse`) | PASS | `client/src/components/global-ask-bar/GlobalAskBarPure.ts:1, 25, 30`; `GlobalAskBar.tsx:5` |

### Phase 5 — Scope-resolution perf guard

| REQ # | Category | Spec § | Requirement | Verdict | Evidence |
|---|---|---|---|---|---|
| 5.1 | helper | §6.5 | `shouldSearchEntityHint(hint)` exported, `hint.trim().length >= 2`, called at top of `findEntitiesMatching` | PASS | `server/services/scopeResolutionPure.ts:8-10`; re-exported `scopeResolutionService.ts:6`; called `scopeResolutionService.ts:31`. Helper lives in a sibling Pure file (so the Pure test has zero DB transitive imports per `DEVELOPMENT_GUIDELINES § 7`); the service file re-exports it so callers' import sites are unchanged. |
| 5.2 | test | §12 | `scopeResolutionPure.test.ts` covers `''`, `' '`, `'a'`, `'ab'`, longer | PASS | `server/services/__tests__/scopeResolutionPure.test.ts:27-53` |

### Phase 6 — Rate limit + tests on /api/session/message

| REQ # | Category | Spec § | Requirement | Verdict | Evidence |
|---|---|---|---|---|---|
| 6.1 | route | §6.6.1 | rate-limit middleware: `rateLimitCheck(rateLimitKeys.sessionMessage(userId), 30, 60)` | PASS | `server/routes/sessionMessage.ts:35-43` |
| 6.2 | ordering | §6.6.1 | middleware order `authenticate → rateLimit → requireOrgPermission(BRIEFS_WRITE)` | PASS | `server/routes/sessionMessage.ts:32-47` |
| 6.3 | failure | §6.6.1 | 429 returns `{ type: 'error', message: 'Too many requests, please slow down.' }` + Retry-After header | **MECHANICAL_GAP → FIXED** | spec quote: `{ type: 'error', message: 'Too many requests, please slow down.' }`. Pre-fix code used `'Too many requests. Please try again later.'` Fix landed at `server/routes/sessionMessage.ts:39`. Shape, header, and now message all match spec. |
| 6.4 | test | §6.6.2 | `sessionMessage.test.ts` covers T1–T8 (Path A/B/C, cross-tenant, stale-subaccount-drop) | PASS | `server/routes/__tests__/sessionMessage.test.ts:1-363` (T0 ordering + T1–T8 + T3b system_admin cross-tenant) |

### Phase 7 — Reseed scripts

| REQ # | Category | Spec § | Requirement | Verdict | Evidence |
|---|---|---|---|---|---|
| 7.1 | guard | §6.7.1 | `_reseed_drop_create.ts` throws when `process.env.NODE_ENV !== 'development'` at top | PASS | `scripts/_reseed_drop_create.ts:3-7` |
| 7.2 | tx | §6.7.2 / §7.5 | `_reseed_restore_users.ts` leases `pool.connect()` client, BEGIN/UPDATE-loop/COMMIT/ROLLBACK on the leased client, releases in finally | PASS | `scripts/_reseed_restore_users.ts:20, 25-53` |

---

## Mechanical fixes applied

`server/routes/sessionMessage.ts` (1 fix):

- **REQ 6.3** — message text aligned with spec verbatim string. Line 39: `'Too many requests. Please try again later.'` → `'Too many requests, please slow down.'`. Spec §6.6.1 quotes the literal envelope `{ type: 'error', message: 'Too many requests, please slow down.' }` as the 429 payload; only the message string differed. Shape, status code, and `setRateLimitDeniedHeaders` already matched. Re-verified by reading lines 37–41 after the edit.

`npx tsc --noEmit` is clean after the fix.

---

## Directional / ambiguous gaps (routed to tasks/todo.md)

None. All gaps were mechanical and closed in-session.

---

## Out-of-scope observations (recorded for traceability — not blocking)

These items appeared during scanning but are **not** spec gaps; recorded so a future reader doesn't reopen them as findings:

1. **`server/routes/systemUsers.ts` and `server/routes/users.ts` still import `express-rate-limit`.** The spec's call-site enumeration (§6.2.5) explicitly lists only `auth.ts`, `formSubmission.ts`, `pageTracking.ts`, and the four test-run routes. `systemUsers.ts` / `users.ts` are NOT in the enumeration, NOT modified on this branch, and the spec's G3 wording ("No `express-rate-limit` imports remain in `server/routes/auth.ts`") is scoped to `auth.ts` only. These two files are out-of-scope for this spec; a follow-up sweep can close them.
2. **Outbound/abuse-domain rate limiters retained.** `server/services/scrapingEngine/rateLimiter.ts`, `server/services/systemMonitor/triage/rateLimit.ts`, and `server/services/budgetService.ts checkRateLimits` are domain-specific (scraping, incident triage, LLM budget) — not boundary/HTTP rate limiters. Spec G2/G3 target inbound boundary limiters only.
3. **Key-builder version prefix.** `rateLimitKeys.*` builders prefix keys with `rl:v1:` (e.g. `rl:v1:auth:login:<ip>:<email>`). The spec §6.2.5 table writes raw shapes like `'auth:login:' + ip + ':' + emailLower`. The primitive treats keys as opaque (`§7.1` "Conventional shape ... primitive treats keys as opaque strings"), so the prefix is conformant with the spec's intent. The plan §4 documents the centralisation rationale.

---

## Files modified by this run

- `server/routes/sessionMessage.ts` — message-text fix only (line 39)

Plus this log file:

- `tasks/review-logs/spec-conformance-log-pre-prod-boundary-and-brief-api-2026-04-29T05-28-52Z.md`

`tasks/todo.md` — NOT modified (zero directional/ambiguous gaps).

---

## Next step

**CONFORMANT_AFTER_FIXES** — one mechanical gap closed in-session (sessionMessage 429 message text). Re-run `pr-reviewer` on the expanded changed-code set so the reviewer sees the post-fix state. Then proceed to PR creation per the standard pipeline.

The review-pipeline contract (`tasks/review-logs/README.md`) requires the caller to: re-run `pr-reviewer` on the expanded changed-code set, then optionally `dual-reviewer` (local-only, user-explicit). No re-invocation of `spec-conformance` needed — verdict was binary mechanical, no directional ambiguity remained.
