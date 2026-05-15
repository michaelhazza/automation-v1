# Pre-Freeze Codebase Audit — 2026-05-15

**Branch:** `claude/pre-production-audit-BnSzp`
**Scope:** Deep-dive sweep for gaps, security holes, and inconsistencies NOT already tracked in `tasks/todo.md` or in flight on other refactoring branches.
**Method:** Five parallel agents (two adversarial-reviewer, three general-purpose) covering: auth & permissions, tenant isolation & RLS, half-implementations, operational readiness, frontend security.
**Exclusions applied:** All 86 open items in `tasks/todo.md` + all `tasks/builds/*/handoff.md` deferred items + active refactor work on other branches.

---

## Table of contents

1. Executive summary
2. CRITICAL — fix before any test pass
3. HIGH — fix before production
4. MEDIUM — strongly recommended before freeze
5. LOW — hygiene / cleanup
6. Recommended new CI gates
7. Items needing product judgement
8. Appendix — items NOT raised

---

## 1. Executive summary

Five things matter most:

1. **JWT revocation is broken on the two paths that need it most** — both self-service and admin password resets fail to bump `passwordChangedAt`. A stolen token survives a password change for up to 24 hours.
2. **Stripe webhook HMAC verification is structurally broken** — the router is mounted after the global JSON body parser, so the raw body needed for HMAC is empty by the time verification runs.
3. **`workflowGateStallNotifyJob` is silently dead** — it queries `delegation_outcomes` without setting the admin role, so RLS returns zero rows. Cross-owner approval timeouts, stall notifications, and stranded-event retries never fire today.
4. **GHL location-scope webhooks accept unsigned events when the webhook secret is missing** — no production guard. Confirmed independently by two adversarial agents.
5. **JWT lives in `localStorage` on the client** — any XSS surface (including the one `dangerouslySetInnerHTML` pattern noted below) becomes a full session-theft surface.

Below: ~50 findings grouped by severity. Each carries a file:line pointer and a fix sketch. Roughly half are 1-2 line code changes.

---

## 2. CRITICAL — fix before any test pass

### C1. Self-service password change does NOT invalidate JWTs
- **Where:** `server/services/userService.ts:225` (`updateCurrentUserProfile`).
- **Issue:** Updates `passwordHash` but never sets `passwordChangedAt`. The JWT revocation gate at `server/middleware/auth.ts:97` compares `iat` against `passwordChangedAt` — without an update, the check never fires.
- **Impact:** Stolen JWT survives a victim's password change for up to 24h.
- **Fix:** Add `passwordChangedAt: new Date(Math.floor(Date.now() / 1000) * 1000)` to the `update` payload when `data.newPassword` is set. Mirror `authService.resetPassword`.

### C2. System-admin password reset does NOT invalidate JWTs
- **Where:** `server/services/userService.ts:410` (`resetUserPassword`), called from `POST /api/system/users/:id/reset-password`.
- **Issue:** Same root cause as C1 — admin reset path does not bump `passwordChangedAt`.
- **Impact:** Admin reset of a compromised account does not force logout. Attacker keeps the session.
- **Fix:** Same 1-line addition to the update payload.

### C3. Stripe webhook HMAC verification structurally broken
- **Where:** `server/index.ts:424` mounts `stripeAgentWebhookRouter` AFTER the global `express.json({ limit: '10mb' })` at line 325. The router uses `raw({ type: 'application/json' })` which expects `req.body` to be a Buffer, but the global parser has already consumed it.
- **Impact:** Either legitimate Stripe deliveries always fail, OR (depending on signature-header edge cases) an attacker can call `/api/webhooks/stripe-agent/:connectionId` without a valid signature.
- **Fix:** Move the Stripe router mount to alongside the other raw-body routers at lines 312-315, BEFORE `express.json()`.

### C4. `workflowGateStallNotifyJob` queries `delegation_outcomes` without admin role
- **Where:** `server/jobs/workflowGateStallNotifyJob.ts:64, 164, 231, 339` — all three sweep paths (`workflowGateStallNotifyHandler`, `retryStrandedTerminalEmits`, `crossOwnerApprovalTimeoutSweep`) use bare `db`. No `withAdminConnection` + `SET LOCAL ROLE admin_role`.
- **Impact:** RLS fail-closed returns zero rows for every iteration. Cross-owner approval timeouts never fire. Stalled gates never get notification. Stranded terminal-event emits never retry. The optimistic-claim UPDATE writes (lines 196-203, 309, 312) also dead.
- **Fix:** Wrap all selects/updates in `withAdminConnection(async (tx) => { await tx.execute(sql\`SET LOCAL ROLE admin_role\`); ... })`. The pattern is already in `ieeBrowserDailyRollupJob.ts` and `memoryDedupJob.ts` — copy it.

---

## 3. HIGH — fix before production

### H1. GHL location-scope webhook accepts unsigned events when secret is missing
- **Where:** `server/routes/webhooks/ghlWebhook.ts:192-194`. The location-scoped branch (line 138+) logs a warning and proceeds if `config.webhookSecret` is null. Unlike the lifecycle branch, there is no `NODE_ENV === 'production'` guard.
- **Impact:** Any connector row with a missing `webhook_secret` accepts arbitrary CRM mutations from any caller who knows the `locationId` (visible in any GHL URL).
- **Fix:** Match the lifecycle branch — return 503 in production when secret is absent. Also: add a connector-create invariant that `webhook_secret IS NOT NULL`.
- **Confirmed by two independent agents.**

### H2. JWT stored in `localStorage`
- **Where:** `client/src/lib/auth.ts:11, 14, 18` + 5 reader sites.
- **Impact:** Any XSS becomes full session theft. The codebase has at least one `dangerouslySetInnerHTML` pattern (see M14) plus risk from future markdown rendering of agent output.
- **Fix:** Move to `httpOnly; Secure; SameSite=Lax` cookie set by login response. Strip the `getToken/setToken/removeToken` API; rely on `withCredentials: true` on axios. Pre-prod is the right window — this is invasive.

### H3. 78 `console.*` calls shipping to production bundle
- **Where:** `vite.config.ts` has no `esbuild.drop`. Production ships ~70 `console.error/warn` calls leaking stack traces and internal log namespaces.
- **Impact:** Recon aid for attackers + leaked customer data in browser console.
- **Fix:** Add `esbuild: { drop: ['console', 'debugger'] }` to `vite.config.ts`. Two lines.

### H4. `webhook_adapter_configs.authSecret` / `callbackSecret` stored PLAINTEXT
- **Where:** `server/db/schema/webhookAdapterConfigs.ts:22, 28`. Comment marks it "MVP plaintext".
- **Impact:** DB breach = every customer's outbound webhook auth secret exfiltrated.
- **Fix:** Encrypt at write using existing `encryptionService` / `TOKEN_ENCRYPTION_KEY` patterns. Add migration to encrypt-in-place.

### H5. `/health` endpoint does NOT check DB or queue health
- **Where:** `server/routes/health.ts:7-9`, `server/services/healthService.ts:5-12`. Returns hardcoded `status: 'healthy'`.
- **Impact:** A liveness probe sees green when DB is down. No production-grade readiness signal.
- **Fix:** Add `/readyz` that runs `SELECT 1` against `db`, pings pg-boss, returns 503 on failure. Keep `/health` as a simple liveness signal but at least cover boot completion.

### H6. No DB TLS enforcement at code level
- **Where:** `server/db/index.ts:7-11` and `server/lib/pgBossInstance.ts:15` — neither passes an `ssl` option to `postgres()`. Relies entirely on `sslmode` in the connection string, which is silently optional in most managed Postgres providers.
- **Fix:** In production, force `ssl: { rejectUnauthorized: true }` and refuse to boot if the connection negotiated plaintext. One-line guard + docstring.

### H7. Boot-time secrets validation incomplete
- **Where:** `server/index.ts:611-624` covers only `WEBHOOK_SECRET`, `TOKEN_ENCRYPTION_KEY`, and the security-audit sentinel.
- **Missing:** `JWT_SECRET` entropy check (zod requires `min(32)` but no rand-byte check); `DATABASE_URL` reachability ping; `WORKER_SHARED_SECRET` set when worker routes are mounted; OAuth provider pair-presence (e.g. `OAUTH_GMAIL_CLIENT_ID` set but `OAUTH_GMAIL_CLIENT_SECRET` missing → first user click fails silently).
- **Fix:** Extend the existing `runBootInvariants()` block with these assertions.

### H8. ~50 env vars read at runtime but undocumented in `.env.example` AND `docs/env-manifest.json` AND missing from the zod schema
- **Examples:** `WORKER_SHARED_SECRET`, `STRIPE_PLATFORM_SECRET_KEY`, `SESSION_SECRET`, `PULSE_CURSOR_SECRET`, `PAGES_BASE_DOMAIN`, all 25 `SYSTEM_MONITOR_*`, `AKR_*`, `RERANKER_*`, `GOOGLE_CLIENT_ID/SECRET`, `HUBSPOT_CLIENT_ID/SECRET`.
- **Impact:** Deployment surprises. Missing vars fail at first user request, not at boot.
- **Fix:** Register every runtime-read var in the zod schema with explicit `optional()` vs `required()`. Extend `scripts/verify-env-manifest.sh` to diff `process.env.X` references against manifest names.

### H9. `pg-boss` v9.0.3 is 3 majors behind; `multer` v1.4.5-lts.2 has known CVEs
- **Where:** `package.json`.
- **CVEs:** Multer 1.x — CVE-2024-43799, CVE-2025-47935 family (file-upload DoS / path-traversal).
- **Fix:** Schedule both upgrades pre-launch. pg-boss v12 has breaking changes — read the migration guide; multer v2 should be a near-drop-in.

### H10. Public routes read `x-forwarded-for` header directly, enabling rate-limit bypass
- **Where:** `server/routes/public/pageTracking.ts:18`, `server/routes/public/formSubmission.ts:20`.
- **Impact:** Any client can cycle the `X-Forwarded-For` header to bypass IP rate limits on unauthenticated routes.
- **Fix:** Replace direct header reads with `req.ip ?? 'unknown'`. Two-line change per file.

### H11. `corrections.ts` client uses raw `fetch()` — no auth header attached
- **Where:** `client/src/lib/api/corrections.ts:17` (called by `CorrectDialog.tsx:58`).
- **Impact:** Either the corrections endpoint silently 401s for every user, OR — worse — the endpoint accepts unauthenticated POSTs and that's a separate hole.
- **Fix:** Route through the `api` axios instance like everything else. Audit `silentCatchHelper.ts:15` (same pattern, hits `/api/client-errors`).

### H12. `agentActivityService.getRunWithAgentInfo` uses bare `db` with no `organisationId` filter
- **Where:** `server/services/agentActivityService.ts:496-506`. Called from `agentRuns.ts:651`.
- **Issue:** Violates the explicit-filter invariant. Relies entirely on RLS as defence; a GUC-leak on the connection pool would expose run metadata across tenants.
- **Fix:** Add `eq(agentRuns.organisationId, orgId)` to the WHERE clause, or migrate the call to `getOrgScopedDb(orgId)`.

---

## 4. MEDIUM — strongly recommended before freeze

### Configuration & secrets
- **M1.** `previewTokenService.ts:10-12` accepts `JWT_SECRET || SESSION_SECRET` fallback. `SESSION_SECRET` is undocumented and unvalidated — a future deployer setting only this var unknowingly downgrades signing. Drop the fallback or document + validate.
- **M2.** `PULSE_CURSOR_SECRET` unset → `clientPulseHighRiskService.ts:163-180` silently falls back to a deterministic per-org SHA256 seed with only a `console.warn`. `.env.example:71` says "Required in production" but boot does not fail. Add a `WEBHOOK_SECRET`-style fail-fast.
- **M3.** No boot assertion verifies `security_audit_events` and `audit_events` tables exist. Only the sentinel org row is checked. A schema drift (table renamed) is detected only on first write, which silently swallows. Extend `validateSecurityAuditSentinelOrgOrThrow` to also run `SELECT 1 FROM <table> LIMIT 0`.

### Security headers & middleware
- **M4.** `server/index.ts:266-294` uses `helmet()` with CSP, but `Strict-Transport-Security`, `X-Frame-Options`/`frame-ancestors`, and `Referrer-Policy` rely on helmet defaults — none explicit. Lock them: `hsts: { maxAge: 31536000, includeSubDomains: true, preload: true }`, `frameAncestors: ["'none'"]`, `referrerPolicy: { policy: 'strict-origin-when-cross-origin' }`.
- **M5.** CORS in non-production passes `'*'` with `credentials: true` — browsers silently reject the combination. Use explicit `localhost` allowlist in dev so the same code path works.
- **M6.** `trust proxy` is hard-coded to `1`. If the deploy chain is CDN → LB → app (>1 hop), `req.ip` collapses to the LB IP. Make hop count env-driven (`TRUST_PROXY_HOPS`).

### Resource & DoS hardening
- **M7.** Four upload routes use `multer.memoryStorage()` with caps of 30/10/5/20 MB. Combined with `QUEUE_CONCURRENCY=5` and parallel users → ~325 MB resident upload buffer ceiling. Routes: `dropZone.ts:31`, `referenceDocuments.ts:18`, `systemAgents.ts:9`, `configDocuments.ts:31`. Switch to disk storage with bounded quota. (Separate from the 500 MB issue already tracked in todo.md.)
- **M8.** Three of those four upload routes have NO `fileFilter` MIME/extension allowlist. SVG, HTML, .exe pass through. Add explicit per-route allowlist.
- **M9.** `canonicalDataService.ts:690` hardcodes `.limit(1000)` on contact tag tally — silently truncated for multi-thousand-contact subaccounts. Move aggregation to SQL-side `unnest(tags) GROUP BY`.
- **M10.** Hardcoded `.limit(500)` in `knowledgeService.ts:87, 134` and `memoryBlockSynthesisService.ts:132` with no caller cursor. Cursor them.

### Frontend safety
- **M11.** Ten `target="_blank"` sites missing `rel="noopener noreferrer"`. Tabnabbing surface. Sites: `AgentMailboxPage.tsx:179`, `AgentCalendarPage.tsx:221`, `support/TicketDetailPage.tsx:146`, `operate/ActivityPage.tsx:301`, `PageProjectDetailPage.tsx:174, 305`, `ActivityDetailModal.tsx:141`, `SpendLedgerPage.tsx:218`, `onboarding-wizard/Step4Baseline.tsx:111`, `ConfigAssistantPopup.tsx:72`. Ten-line PR.
- **M12.** SSE reconnect in `client/src/lib/agentPresenceStream.ts:100, 132` uses fixed 2s/5s — no exponential backoff, no jitter, no cap. Thundering-herd amplifier on recovery. Add exp-backoff (2s → 30s with jitter).
- **M13.** Single shared `ErrorBoundary` in `App.tsx` covers all protected routes via `<Outlet />`. A throw in any one route blanks the entire protected surface. Wrap each top-level route element in its own boundary, or per-guard-group.
- **M14.** `MigrateWorkspaceModal.tsx:156` uses `dangerouslySetInnerHTML` on `.replace()` output. Input is hardcoded today (safe), but the pattern is a trap. Delete the only `dangerouslySetInnerHTML` in the client tree — render `<code>` JSX nodes instead.

### Half-implementations (production code paths)
- **M15.** `voiceProfile/samplers/gmailSentSampler.ts:21` and `driveDocSampler.ts:22` are `TODO V1` stubs — voice profile sampling returns empty for Gmail/Drive. Either implement or remove the sampler registration.
- **M16.** `draftCandidatesService.ts:5` is in-memory — "replace with persistent implementation once draft_candidates schema lands." Data lost on restart. Add the schema or remove the feature wiring.
- **M17.** `routerJobService.ts:192` — `TODO: Insert into invoices table / create Stripe invoice` — billing path stubbed. Revenue from router jobs is not recorded.
- **M18.** `stripeAgentWebhookService.ts:15` — `TODO(Chunk 13): call agentSpendAggregateService.upsertAgentSpend on succeed/refund` — agent spend rollups never updated from Stripe events.
- **M19.** `onboarding.ts:68, 76` — `TODO: Wire to GHL connector service` + `TODO: Store preference on org or user record`. Onboarding "wizard complete" silently no-ops.
- **M20.** `agentResumeService.ts:149` — hardcoded `integrationId: ''` with `TODO(v2)`. Resume path emits a blank integration id, polluting downstream attribution.
- **M21.** `operator_run_files` (migration 0353) is written by `operatorSandboxFileEventBridge.ts` but has zero readers anywhere. Confirm intended consumer; remove if dead.
- **M22.** `teamworkAdapter.ts:635` — `TODO: verify exact endpoint` for Teamwork Desk message create. Adapter will fail on first real send.
- **M23.** `retrieval.always_available.mode_changed` event type is validated in `agentExecutionEventServicePure.ts:416` but has zero emit sites. Either emit or remove from the validator.

### Logging discipline
- **M24.** Webhook + OAuth paths use raw `console.*` (20+ in `ghlWebhook.ts`, 4+ in `slackWebhook.ts`, sites in `githubApp.ts`, `oauthIntegrations.ts`). These are the highest-value paths for observability and should be on the structured `logger`. Migrate them.
- **M25.** `queueService.ts` has ~15 `console.log(JSON.stringify(...))` calls mixed with `logger`. Unify on `logger`.

### Operational
- **M26.** `gracefulShutdown` (`server/index.ts:1087-1146`) does not flush Langfuse client (last 5s of traces lost), does not flush `agentRunPayloadEncryptionService` writes, and the outer 15s timeout can fire while DB pool is mid-flush. Add `langfuse.shutdownAsync()`; bump outer timeout to 30s; parallelise sub-closes.
- **M27.** `runOrgSubaccountMigration` (`server/index.ts:986-989`) runs unconditionally on every boot if migration_states is empty. Expensive idempotent migration in the HTTP-bind hot path. Gate behind a feature flag or move to a one-shot CLI.

---

## 5. LOW — hygiene / cleanup

### Dead code (>40 LOC, knip-confirmed zero callers)
- **L1.** `server/services/dataRetentionService.ts` (73 LOC).
- **L2.** `server/services/adminOpsService.ts` (159 LOC, "v7.1 stub handlers").
- **L3.** `server/services/sdrService.ts` (99 LOC) + transitive `leadDiscovery/googlePlacesProvider.ts` + `hunterProvider.ts` (3-file subtree).
- **L4.** `server/services/configAssistantModeService.ts` (95 LOC).
- **L5.** `server/services/processedResourceService.ts` (137 LOC).
- **L6.** `server/services/retentionSuccessService.ts` (41 LOC).
- **L7.** `server/services/orchestratorTaskCommentTemplate.ts`.
- **L8.** `server/services/briefArtefactBackstop.ts` (stateful wrapper, only `briefArtefactBackstopPure` is consumed).
- **L9.** `server/services/alertFatigueGuard.ts`.
- **L10.** `server/routes/orgWorkspace.ts` (38 LOC, router-mount removed; two of four handlers return 501).
- **L11.** Client orphan pages: `AdminPermissionSetsPage.tsx`, `AdminSettingsPage.tsx`, `BriefDetailPage.tsx`, `HierarchyTemplatesPage.tsx`, `IntegrationsAndCredentialsPage.tsx`, `ConnectorConfigsPage.tsx`, `McpServersPage.tsx`.

### Duplication
- **L12.** `slugify` is defined 10 separate times (6 server, 4 client). One canonical export already exists at `skillParserServicePure.slugify`. Migrate consumers.
- **L13.** `formatTimestamp` duplicated across `client/src/components/runs/RunTraceView.tsx:115` and `client/src/pages/ConfigSessionHistoryPage.tsx:48` (distinct from `PAGE-SPLITS-T1`).

### Inconsistent error envelopes
- **L14.** `server/routes/public/pagePreview.ts:129` and `pageServing.ts:175` use `res.status(404).send('Page not found')` (raw string) where the rest of the codebase uses JSON.
- **L15.** `server/routes/externalDocumentReferences.ts` uses snake_case error codes exclusively; neighbours use prose. Pick one and migrate.

### Auth defence-in-depth
- **L16.** `/api/auth/invite/accept` (`server/routes/auth.ts:170`) has no rate limit. Every other unauthenticated auth mutation does. Add the standard inbound rate-limiter.
- **L17.** `server/routes/systemUsers.ts:8-9` uses memory-backed `express-rate-limit` rather than the Postgres-backed `inboundRateLimiter`. Defence-in-depth for system-admin routes — already gated by `requireSystemAdmin`.

### Frontend polish
- **L18.** SSE stream-token re-fetched on every reconnect with no cache. Combined with the fixed 2s backoff → ~30 token requests/min during degraded periods. Cache until near `expiresAt`.
- **L19.** Onboarding-check race: `useOnboardingRedirect` fires two API calls on every protected-route mount with no caching. Read `needsOnboarding` from `/api/auth/me` instead.
- **L20.** `Modal.tsx:127` uses `aria-label={title}` while also rendering the title as visible `<h2>`. Should be `aria-labelledby="dialog-title"`.

### Minor
- **L21.** `agentPresenceStreamPublisher.ts:52-55` ring-buffer key is `workspace:${subaccountId}` — no org prefix. Safe today because subaccount UUIDs are globally unique, but the invariant isn't enforced at the publisher. Prepend org.
- **L22.** `initWebSocket(httpServer)` (`server/index.ts:1029`) is mounted before the HTTP listen retry loop. Fragile if first bind fails. Move after successful listen.

---

## 6. Recommended new CI gates

These would have caught several findings above. Each is a small shell/grep script.

1. **`verify-route-auth.sh`** — scan `server/routes/**.ts` for `router.(get|post|put|patch|delete)` calls without an `authenticate` in the same chain. Allowlist `/webhooks/*`, `/public/*`, `/health`, `/readyz`. (Would have caught H10, H11, C3 root cause.)
2. **`verify-rls-force-on-new-tables.sh`** — extend `verify-rls-protected-tables.sh` to grep `FORCE ROW LEVEL SECURITY` per `CREATE TABLE ... organisation_id ...` in each migration file.
3. **`verify-env-manifest-completeness.sh`** — diff `process.env.X` references in `server/`/`shared/` against names in `docs/env-manifest.json`. Fail on undeclared.
4. **`verify-job-admin-role.sh`** — scan `server/jobs/**.ts` for `db.select`/`db.update`/`db.insert` calls not inside a `withAdminConnection` or `withOrgTx` block. (Would have caught C4.)
5. **`verify-password-revocation.sh`** — grep for `passwordHash` updates that are not in the same `update()` call as `passwordChangedAt`. (Would have caught C1, C2.)

---

## 7. Items needing product judgement

A few things look like gaps but might be intentional. Before fixing, decide:

- **`webhookAdapterConfigs` plaintext secrets** (H4) — was "MVP" planned to extend through this freeze, or is encrypted-at-rest a launch requirement?
- **Voice-profile Gmail/Drive samplers** (M15) — ship empty, or remove the registration so the UI doesn't promise capability that isn't delivered?
- **`routerJobService` billing stub** (M17) and **`stripeAgentWebhookService` agent-spend rollup stub** (M18) — financial paths. Were these intentionally deferred past the freeze? If yes, document; if no, ship before any paying use.
- **JWT in `localStorage` → `httpOnly` cookie migration** (H2) — invasive (5 client files, 1 server change, full re-login forced on existing sessions). Right before a test freeze is the right window IF a re-login is acceptable.
- **pg-boss v9 → v12 upgrade** (H9) — breaking changes. Decide whether to absorb the upgrade now or accept the risk for the limited-prod window.

---

## 8. Appendix — items NOT raised (already covered elsewhere)

For session continuity, these were checked and excluded:

- Everything in `/tmp/open-todo-items.txt` (86 items from `tasks/todo.md`).
- Build-specific deferrals in `tasks/builds/*/handoff.md` (sandbox-isolation, personal-assistant-v2, agent-workspace, page-splits, baseline-capture, consolidation-govern, etc.).
- Refactor work in flight on other branches (page splits, agentExec split, skillExecutor split, workflowEngine split, skill-analyzer split — all merged via PRs #308-#314).
- Pre-launch P0/P1/P2 hardening items already shipped (PRs #261, #264, #267, #284).

End of audit.
