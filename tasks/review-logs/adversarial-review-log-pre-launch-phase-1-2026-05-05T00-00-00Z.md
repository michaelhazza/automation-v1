# Adversarial Review Log — pre-launch-phase-1

**Branch:** `claude/pre-launch-phase-1` vs `main`
**Reviewed at:** 2026-05-05T00:00:00Z
**Verdict:** HOLES_FOUND (1 confirmed-hole, 2 likely-holes; all three fixed in-branch before chatgpt-pr-review)

---

## Findings

### 1.1 — CONFIRMED-HOLE (fixed)

**File:** `server/services/taskEventService.ts:69`  
**Category:** RLS / Tenant isolation

`appendAndEmitTaskEvent` opened a fresh `db.transaction()` from the module-level `db` pool without issuing `SET set_config('app.organisation_id', ...)`. Both `task_events` and `tasks` carry FORCE RLS — with no GUC set, all writes silently no-op. The durable event log introduced by D-P0-5 was non-functional in production (callers use fire-and-forget so the failure was invisible).

**Fix:** Added `await tx.execute(sql\`SELECT set_config('app.organisation_id', ${ctx.organisationId}, true)\`)` as the first statement inside the `db.transaction()` callback in `taskEventService.ts`.

---

### 2.1 — LIKELY-HOLE (fixed)

**File:** `server/index.ts` (no `trust proxy` config), `server/lib/rateLimitKeys.ts:24`  
**Category:** Auth

Express only reads `X-Forwarded-For` for `req.ip` when `app.set('trust proxy', ...)` is configured. Without it, `req.ip` is the direct TCP peer (the load balancer IP in production), making every rate-limit key's IP component identical for all users. The compound-key auth rate limiter (`login:${ip}:${email}`) reduced to a per-email-only limiter, defeating the IP-based distributed-credential-stuffing protection.

**Fix:** Added `if (isProduction) { app.set('trust proxy', 1); }` in `server/index.ts` after the express app is created.

---

### 3.1 — LIKELY-HOLE (fixed)

**File:** `server/services/queueService.ts:1339`, `server/jobs/resumeRunAfterOAuthJob.ts:46`  
**Category:** Race condition / correctness

The `run:resumeAfterOAuth` pg-boss worker was registered with `resolveOrgContext: () => null`, opting out of the `createWorker` org-scoped tx wrapper. The comment acknowledged that `WorkflowRunPauseStopService` uses the module-level `db` — but that means the GUC is never set. `workflow_runs` has FORCE RLS; without the GUC, the SELECT returns zero rows and every resume attempt throws `{ statusCode: 404, message: 'Workflow run not found' }`. The C-P0-2 OAuth resume path was permanently broken: enqueue and dequeue succeed, the worker exhausts all retries with 404s, then routes the job to the DLQ.

**Fix (two-part):**
1. `queueService.ts` — removed `resolveOrgContext: () => null` so the default resolver reads `organisationId` from the payload and opens an org-scoped tx with the GUC set.
2. `workflowRunPauseStopService.ts` — migrated all three methods (`pauseRun`, `resumeRun`, `stopRun`) from `import { db }` + `db.transaction()` to `getOrgScopedDb('workflowRunPauseStopService.<method>')`. The service now picks up the GUC-set tx from ALS — whether supplied by the HTTP org-scoping middleware or by the `createWorker` wrapper.

---

## Worth-Confirming (not fixed — routed to tasks/todo.md)

| # | File | Description | Disposition |
|---|------|-------------|-------------|
| 1.2 | `migrations/0277_oauth_state_nonces.sql` | Missing `-- system-scoped: <reason>` header comment per DEVELOPMENT_GUIDELINES §6.3; the rationale lives in `rls-not-applicable-allowlist.txt` but not inline in the migration. Gate compliance gap. | Deferred — low risk; allowlist entry exists; not a security hole. Add header in a follow-up migration comment PR. |
| 2.2 | `server/routes/auth.ts:23` | Signup RL uses IP-only key; under the proxy-IP issue (now fixed for auth routes), all signups share one bucket per IP (=proxy IP). Same root cause as 2.1; now partially mitigated by the `trust proxy` fix. | Deferred — residual risk low post-fix; signup RL is a second-line defence. Consider adding email dimension in Phase 2. |
| 5.1 | `server/routes/oauthIntegrations.ts:424-432` | 15s `Promise.race` timeout does not cancel in-flight per-row `db.transaction()` calls inside `autoEnrolAgencyLocations`. Large-agency OAuth callback can hold pool connections for up to 15s after the response has redirected. | Deferred — no data-correctness impact; operational concern. Add location count cap in Phase 2. |
| 6.1 | `server/routes/oauthIntegrations.ts:424-425` | `withOrgTx({ tx: db })` fakes GUC context in ALS. Works today because `autoEnrolAgencyLocations` opens its own `db.transaction()` with explicit GUC. Fragile pattern — any future refactor that uses `getOrgScopedDb()` in that call chain would silently have no GUC. | Deferred — current code is safe; pattern is fragile. Document in KNOWLEDGE.md. |

---

## No-Findings Summary

- `oauth_state_nonces` table: no RLS correctly; documented in `rls-not-applicable-allowlist.txt`; single-use DELETE...RETURNING prevents nonce replay.
- `returnPath` open-redirect mitigation: correct — relative-path regex + `!startsWith('//')` + `appBase` prepend prevents external-domain redirect.
- Run-depth guard: `MAX_WORKFLOW_RUN_DEPTH = 10` + `MAX_WORKFLOW_DEPTH = 3` (stricter sub-limit for skill dispatch). Both enforced before DB writes; no bypass path found.
- `useOAuthPopup.ts` `ALLOWED_ORIGINS` allowlist: correctly adds `VITE_API_ORIGIN` alongside `window.location.origin`.
- SQL injection: all new parameterised Drizzle templates use bind parameters; no string concatenation.
- Injection in `returnPath` validation: correct allowlist regex + absolute-URL rejection.
