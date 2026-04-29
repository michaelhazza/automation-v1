# Pre-Production Boundary Security + Brief API — Dev Brief

**Slug:** `pre-prod-boundary-and-brief-api`
**Branch:** `pre-prod-boundary-and-brief-api`
**Class:** Major (architect first; full review pipeline)
**Migration range reserved:** `0253` (rate-limit table; reserve more if needed)
**Sister branches (do not edit their files):** `pre-prod-tenancy`, `pre-prod-workflow-and-delegation`

---

## Goal

Harden the HTTP boundary, ship a production-grade DB-backed rate limiter, unify the brief-creation API contract, and bound entity-search performance. This is the "outside-facing surface" stream — every item below either improves what an external client sees or governs what an external client can do.

## Why

The HTTP boundary still has shipped-in TODOs (Helmet CSP disabled, CORS allows wildcards with credentials, Multer accepts 500MB, no rate limit on password-reset). The rate limiter is in-memory and resets on restart. Webhook auth is optional. Brief creation has two divergent endpoints — `/api/briefs` and `/api/session/message` — and the layout modal still uses the older one. `findEntitiesMatching` runs `%ILIKE%` with no min-length guard. None of these are catastrophic individually; together they are the surface that attackers and load-testers will touch first.

## Scope (in)

### Phase 1 — Bootstrap security (`server/index.ts`)

- **#19** — Enable Helmet CSP. Permissive policy first (allow self + inline for now); leave a `TODO: tighten CSP` comment with the specific directives that need narrowing.
- **#20** — Pin CORS origin allowlist. Read from env (`CORS_ORIGINS`, comma-separated). `credentials: true` requires explicit non-wildcard origin matching.
- **#26** — Strip stack/internal codes from production error envelope. Default `{ error: { code, message } }`; include `detail` only when `process.env.NODE_ENV !== 'production'`.

### Phase 2 — Middleware hardening

- **#23** — `server/middleware/auth.ts:42-48`: system admin cross-org access via `X-Organisation-Id` has no audit trail. Add structured log: `logger.info('auth.cross_org_access', { actorUserId, actorOrgId, requestedOrgId, route, method })`.
- **#24** — `server/middleware/validate.ts:16-19`: drop Multer cap from 500MB to 25–50MB. Switch to disk storage above a 5MB threshold using `multer.diskStorage({ destination: os.tmpdir() })`.

### Phase 3 — DB-backed rate limiter

- **#21 + P3-M1** — Replace `server/lib/testRunRateLimit.ts` (in-memory, per-process) with a sliding-window primitive backed by Postgres.
  - New module: `server/lib/rateLimiter.ts` exporting `check(key: string, limit: number, windowSec: number): Promise<{ allowed: boolean; remaining: number; resetAt: Date }>`.
  - New table (migration `0253`): `rate_limit_buckets (key text, window_start timestamptz, count int, primary key (key, window_start))` with TTL cleanup job.
  - Replace use sites: `server/routes/auth.ts`, `server/routes/public/formSubmission.ts`, `server/routes/public/pageTracking.ts`. Delete `server/lib/testRunRateLimit.ts`.

### Phase 4 — Auth + webhook hardening

- **#25** — Wire rate-limiter to password-reset / forgot-password routes (`server/routes/auth.ts:72-85`). Suggested: 5/min/IP and 10/hr/email.
- **#22** — `server/services/webhookService.ts:72-74`: webhook auth currently optional. Add boot-time assertion: if `process.env.NODE_ENV === 'production' && !process.env.WEBHOOK_SECRET` throw at startup. Per-request HMAC verification stays mandatory.

### Phase 5 — Brief API unification

- **F1** — Unify `/api/briefs` and `/api/session/message`. Currently `/api/briefs` returns `{ briefId, conversationId, fastPathDecision }`; `/api/session/message` returns `{ type: 'brief_created', ...context }` with context-switch side effects. Layout modal posts to `/api/briefs`; GlobalAskBar posts to `/api/session/message`. Approach: extract a shared `createBriefAndRespond({ source, ... })` service in `server/services/briefCreationService.ts`. Rebuild `/api/briefs` as a thin wrapper. Update `client/src/components/Layout.tsx` and `client/src/components/global-ask-bar/GlobalAskBar.tsx` to consume the unified response shape.

### Phase 6 — Scope-resolution perf guard

- **F7** — `server/services/scopeResolutionService.ts` `findEntitiesMatching`: add min-hint-length guard (≥ 2 chars; below that return `[]`). Defer `pg_trgm` index to post-launch — that's a separate spec with perf measurement.

### Phase 7 — Rate-limit + tests on `/api/session/message`

- **F6** — Wire the Phase 3 rate-limiter to `/api/session/message`. Suggested starting limit: 30/min/user.
- **F8** — Integration tests for `server/routes/sessionMessage.ts`: Path A (org-only context switch), Path B (subaccount candidate), Path C (`brief_created`), cross-tenant rejection (admin sets `X-Organisation-Id` to a different org), stale-subaccount drop. New file: `server/routes/__tests__/sessionMessage.test.ts`.

### Phase 8 — Dev-script safety (small, fits here)

- **Reseed env guard** — `scripts/_reseed_drop_create.ts`: at top of `main()`, throw if `process.env.NODE_ENV !== 'development'` (or if `DATABASE_URL` matches a known production host).
- **Reseed transaction** — `scripts/_reseed_restore_users.ts`: wrap restore body in `db.transaction(async (tx) => { ... })`.

## Scope (out)

- Anything under `migrations/*.sql` for tenancy (RLS hardening) — owned by `pre-prod-tenancy`. **Exception:** the rate-limit table migration (`0253`) is in this stream.
- Anything in `server/services/workflowEngineService.ts`, `workflowRunService.ts`, `invokeAutomationStepService.ts`, `agentExecutionService.ts`, `agentScheduleService.ts`, `agentRunHandoffService.ts` — owned by `pre-prod-workflow-and-delegation`.
- Tightening CSP directives beyond a permissive baseline — follow-up spec.
- pg_trgm migration for `findEntitiesMatching` — follow-up spec.

## Acceptance criteria

- Helmet CSP serves a non-empty policy on every response.
- CORS rejects requests from origins not in `CORS_ORIGINS`.
- Production error envelope strips internals (verified with a triggered 500 in production-mode build).
- Cross-org admin requests produce `auth.cross_org_access` audit log lines.
- Multer caps at 25–50MB; >5MB writes hit disk.
- `server/lib/rateLimiter.ts` shipped with unit tests covering window edges + concurrent increment race.
- `server/lib/testRunRateLimit.ts` deleted; old call sites use new primitive.
- Password-reset routes rate-limited; verified manually.
- Production boot fails with clear error if `WEBHOOK_SECRET` unset.
- `/api/briefs` and `/api/session/message` route through a shared service; both return a uniform envelope (or briefs returns a documented subset).
- `findEntitiesMatching` returns `[]` for hint length < 2.
- `/api/session/message` rate-limited.
- `sessionMessage.test.ts` covers Path A/B/C, cross-tenant rejection, stale-subaccount drop. Real DB transactions per existing integration patterns.
- Reseed scripts safe.
- `npx tsc --noEmit` clean for both server and client.

## References

- Source backlog: `tasks/todo.md` lines 41–53 (security findings #19–#27), line 916 (P3-M1), lines 340–344 (F1, F6, F7, F8 from PR #233 round 1), lines 1337–1346 (reseed scripts).
- ChatGPT review log: `tasks/review-logs/chatgpt-pr-review-brief-feature-updates-2026-04-29T01-05-59Z.md`.
- Audit log (older): `tasks/todo.md` lines 1–66 (Pre-Testing Fix List header).

## Pipeline

1. Author full dev spec from this brief — phase ordering, rate-limit primitive contract, brief-API envelope shape, test matrix.
2. `architect` agent — focus on the rate-limit primitive design and the brief-API unification (both have multiple viable shapes).
3. Implement chunked.
4. `spec-conformance`.
5. `pr-reviewer`.
