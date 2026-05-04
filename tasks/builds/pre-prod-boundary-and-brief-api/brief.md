# Pre-Production Boundary Security + Brief API — Dev Brief (narrowed)

**Slug:** `pre-prod-boundary-and-brief-api`
**Branch:** `pre-prod-boundary-and-brief-api`
**Class:** Major (architect first; full review pipeline)
**Migration range reserved:** `0253` (rate-limit table; reserve more if architect calls for it)
**Sister branches (do not edit their files):** `pre-prod-tenancy`, `pre-prod-workflow-and-delegation`
**Original-brief commit:** `b150d759` (`chore(planning): add pre-prod hardening briefs + PR #233 review diffs`).
**Narrowed:** 2026-04-29 after Section 0 verification against `main` HEAD `93e855e7`. Items already shipped were folded into the *Verified closed during Section 0* table below; the in-scope phase list shrank from eight phases to seven.

---

## Table of contents

1. Goal
2. Why
3. Scope (in)
   - Phase 1 — Multer cap + disk spillover
   - Phase 2 — DB-backed rate-limit primitive
   - Phase 3 — Webhook hardening
   - Phase 4 — Brief API envelope harmonisation
   - Phase 5 — Scope-resolution perf guard
   - Phase 6 — Rate limit + tests on `/api/session/message`
   - Phase 7 — Dev-script safety
4. Scope (out)
5. Verified closed during Section 0 (no work in this branch)
6. Acceptance criteria
7. References
8. Pipeline

---

## Goal

Harden the remaining HTTP-boundary surface, ship a production-grade DB-backed rate limiter, harmonise the brief-creation response envelope, and bound entity-search performance. Every in-scope item either improves what an external client sees or governs what an external client can do.

## Why

Recent hardening closed several brief items in-line (Helmet CSP, CORS allowlist, cross-org audit, password-reset route-level rate-limit wiring, error envelope) but the underlying primitives remain in-process. The rate limiter resets on restart and is bypassable in a multi-process deployment. Webhook auth is silently optional when `WEBHOOK_SECRET` is unset. Multer accepts 500 MB into process memory. The two brief-creation routes share the underlying service but emit divergent response envelopes — Layout modal and GlobalAskBar see different shapes for the same operation. `findEntitiesMatching` runs `%ILIKE%` with no service-level guard. Reseed scripts run unconditionally and outside transactions.

## Scope (in)

### Phase 1 — Multer cap + disk spillover

- **#24** — `server/middleware/validate.ts:17-20`: drop the Multer cap from 500 MB to 25–50 MB. Switch to `multer.diskStorage({ destination: os.tmpdir() })` above a 5 MB threshold so large uploads don't sit in process memory. Single shared `upload` instance — file routes inherit the new cap unchanged.

### Phase 2 — DB-backed rate-limit primitive (the linchpin)

- **#21 + P3-M1** — Replace `server/lib/testRunRateLimit.ts` (in-memory, per-process) with a sliding-window primitive backed by Postgres.
  - **New module:** `server/lib/rateLimiter.ts` exporting `check(key: string, limit: number, windowSec: number): Promise<{ allowed: boolean; remaining: number; resetAt: Date }>`.
  - **New table** (migration `0253`): `rate_limit_buckets (key text, window_start timestamptz, count int, primary key (key, window_start))` with a TTL cleanup job. Architect to call: cron / job-queue tick vs lazy cleanup on read.
  - **Replace at these call sites in this phase:**
    - `server/routes/auth.ts` — login limiter (delete the in-line `loginAttemptTimestamps` Map + `enforceLoginRateLimit` helper).
    - `server/routes/auth.ts` — forgot-password and reset-password routes (delete the `express-rate-limit` instances at lines 11–12).
    - `server/routes/public/formSubmission.ts` and `server/routes/public/pageTracking.ts` — public-traffic limiters that share the same TODO marker.
    - `server/lib/testRunRateLimit.ts` callers (test-run check). Delete the file once callers migrate.
  - All five sites use the new primitive; no callers of the old in-process limiters remain.

### Phase 3 — Webhook hardening

- **#22** — `server/services/webhookService.ts:74-77`: `verifyCallbackToken` silently returns `true` when no secret is configured (open mode). Add a boot-time assertion in `server/index.ts`: if `env.NODE_ENV === 'production' && !env.WEBHOOK_SECRET` throw at startup with a clear error. Non-production keeps the open-mode fallback (developer ergonomics) but emits a one-time `logger.warn` so the fallback is visible. Per-request HMAC verification stays mandatory when a secret is present.

### Phase 4 — Brief API envelope harmonisation

- **F1 (rescoped)** — Both routes already share `createBrief()` from `server/services/briefCreationService.ts`. The remaining gap is the response envelope:
  - `/api/briefs` returns the raw `createBrief()` result.
  - `/api/session/message` Path C wraps it as `{ type: 'brief_created', briefId, conversationId, organisationId/Name, subaccountId/Name }`.
  - **Approach:** define a single `BriefCreationEnvelope` contract in `shared/types/` (extend an existing brief types file rather than introducing a new one). Both routes return that envelope on the brief-creation path. `/api/session/message` Path A and Path B (disambiguation, context-switch) keep their distinct response shapes — they're not brief-creation results. Update `client/src/components/Layout.tsx` (New Brief modal) and `client/src/components/global-ask-bar/GlobalAskBar.tsx` to consume the unified shape; remove any per-route response-shape branches in client code.
  - **Out of scope here:** the `createBrief` triple-split refactor (F5 from PR #233 deferred items) — its own focused PR.

### Phase 5 — Scope-resolution perf guard

- **F7** — `server/services/scopeResolutionService.ts:27-30` `findEntitiesMatching`: add a service-level min-hint-length guard (≥ 2 chars; below that return `[]`). The route-level guard at `sessionMessage.ts:84` already covers Path B, but defence-in-depth at the service layer protects any future caller. Defer `pg_trgm` index — separate spec with perf measurement.

### Phase 6 — Rate limit + tests on `/api/session/message`

- **F6** — Wire the Phase 2 rate-limiter to `/api/session/message`. Suggested starting limit: 30/min/user (architect to confirm key shape: per-user vs per-user+org).
- **F8** — Integration tests for `server/routes/sessionMessage.ts`: Path A (org-only context switch via candidate selection), Path B (subaccount candidate via context-switch command), Path C (`brief_created`), cross-tenant rejection (admin sets `X-Organisation-Id` to a different org), stale-subaccount drop. New file: `server/routes/__tests__/sessionMessage.test.ts`. Real DB transactions per existing integration test patterns.

### Phase 7 — Dev-script safety

- **Reseed env guard** — `scripts/_reseed_drop_create.ts`: at top of `main()`, throw if `process.env.NODE_ENV !== 'development'` (or if `DATABASE_URL` matches a known production host pattern). `DROP DATABASE` must not be runnable anywhere else.
- **Reseed transaction** — `scripts/_reseed_restore_users.ts`: wrap the restore loop in `db.transaction(async (tx) => { ... })`. Verify all DML uses `tx`, not the global pool. No behaviour change on success path; on failure the DB is unchanged so re-run is idempotent.

## Scope (out)

- Anything under `migrations/*.sql` for tenancy / RLS hardening — owned by `pre-prod-tenancy`. **Exception:** the rate-limit table migration (`0253`) is in this stream.
- Anything in `server/services/workflowEngineService.ts`, `workflowRunService.ts`, `invokeAutomationStepService.ts`, `agentExecutionService.ts`, `agentScheduleService.ts`, `agentRunHandoffService.ts` — owned by `pre-prod-workflow-and-delegation`.
- **Tightening Helmet CSP further.** Production CSP is already in place with a sensible directive set ([server/index.ts:188-213](server/index.ts#L188-L213)); weakening or rewriting it is out of scope. Dev-mode `false` is intentional (Vite HMR ergonomics) and stays.
- **Adding a `detail` field to the error envelope.** Optional follow-up; current envelope already strips internals in production.
- **F5 `createBrief` triple-split refactor** — separate PR per the deferred entry at `tasks/todo.md:341`.
- **pg_trgm migration for `findEntitiesMatching`** — follow-up spec with perf measurement.
- **#27 Centralised auth/permission audit trail** — broader than this stream; architect to scope as a follow-up.

## Verified closed during Section 0 (no work in this branch)

Per `docs/spec-authoring-checklist.md § 0`, the items below were verified against current `main` and confirmed already shipped. Listed for traceability so reviewers see they were considered.

| Brief ID | Original ask | Closed by |
|---|---|---|
| **#19** | Enable Helmet CSP | Production CSP enabled with non-trivial directives at [server/index.ts:188-213](server/index.ts#L188-L213). Dev mode intentionally `false`. |
| **#20** | Pin CORS origin allowlist | `env.CORS_ORIGINS` parsed comma-separated, prod fails fast on `*`, `credentials: true` set at [server/index.ts:215-228](server/index.ts#L215-L228). |
| **#23** | Cross-org admin audit trail | Implemented via `auditService.log({ action: 'cross_org_access', … })` at [server/middleware/auth.ts:82-96](server/middleware/auth.ts#L82-L96) — persisted, queryable. The brief originally asked for `logger.info`; the auditService route is stricter. |
| **#25** (route wiring) | Wire rate-limiter to forgot/reset password | `forgotPasswordRateLimit` + `resetPasswordRateLimit` (5/15 min) wired at [server/routes/auth.ts:11-12](server/routes/auth.ts#L11-L12) and applied at lines 108 + 120. The remaining work — swap from `express-rate-limit` (in-memory) to the DB-backed primitive — is folded into Phase 2. |
| **#26** | Strip stack/internal codes from prod errors | Envelope is `{ error: { code, message }, correlationId }`; prod 5xx replaces `message` with "Internal server error" at [server/index.ts:436-443](server/index.ts#L436-L443). |
| **F1** (service extraction) | Extract a shared brief-creation service | Both routes already call `createBrief()` from `server/services/briefCreationService.ts`. Only the response-envelope harmonisation remains — captured as Phase 4. |

## Acceptance criteria

- Multer caps at 25–50 MB; uploads > 5 MB stream to disk; existing file routes accept the new cap unchanged.
- `server/lib/rateLimiter.ts` shipped with unit tests covering window edges, concurrent-increment race, and TTL cleanup behaviour.
- All five rate-limit call sites migrated; `server/lib/testRunRateLimit.ts` deleted; in-line `loginAttemptTimestamps` Map removed; `forgotPasswordRateLimit` / `resetPasswordRateLimit` `express-rate-limit` instances removed.
- Production boot fails fast with a clear error if `WEBHOOK_SECRET` is unset; non-production logs a one-time fallback warning. Per-request HMAC verification unchanged when a secret is present.
- `/api/briefs` and `/api/session/message` brief-creation path return the same `BriefCreationEnvelope` shape. Layout modal + GlobalAskBar consume the unified shape; no per-route response-shape branching remains in client code.
- `findEntitiesMatching` returns `[]` for hint length < 2 (verified by unit test on the pure helper).
- `/api/session/message` rate-limited at the new primitive.
- `sessionMessage.test.ts` covers Path A / B / C, cross-tenant rejection, stale-subaccount drop. Real DB transactions per existing integration test patterns.
- Reseed: `_reseed_drop_create.ts` throws unless `NODE_ENV=development`; `_reseed_restore_users.ts` wraps the restore loop in `db.transaction`.
- `npx tsc --noEmit` clean for both server and client.

## References

- Source backlog: `tasks/todo.md` lines 41–53 (security findings #19–#27 — see *Verified closed* table for status), line 916 (P3-M1), lines 340–344 (F1, F6, F7, F8 from PR #233 round 1), lines 1337–1346 (reseed scripts).
- ChatGPT review log (PR #233): `tasks/review-logs/chatgpt-pr-review-brief-feature-updates-2026-04-29T01-05-59Z.md`.
- Audit log (older): `tasks/todo.md` lines 1–66 (Pre-Testing Fix List header).
- Section 0 verification reads against `main` HEAD `93e855e7` (2026-04-29).

## Pipeline

1. Author full dev spec from this brief — phase ordering, rate-limit primitive contract (key shape, sliding-window vs token-bucket, concurrency invariants, TTL cleanup ownership), brief-API envelope shape, test matrix.
2. `architect` agent — focus on the two non-trivial design calls: (a) the rate-limit primitive shape, (b) the unified brief-creation envelope.
3. Stop at the plan gate.
4. Implement chunked (per architect's plan).
5. `spec-conformance`.
6. `pr-reviewer`.
