# PR Review Log — ghl-module-c-oauth

**Branch:** `ghl-agency-oauth`
**Reviewed at:** 2026-05-03T05:58:35Z
**Reviewer:** `pr-reviewer` (independent post-implementation review)
**Spec:** `docs/ghl-module-c-oauth-spec.md`
**Plan:** `docs/superpowers/plans/2026-05-03-ghl-agency-oauth.md`
**Prior review:** `tasks/review-logs/spec-conformance-log-ghl-module-c-oauth-2026-05-03T04-47-51Z.md` (NON_CONFORMANT, 2 mechanical fixes applied, 3 directional gaps deferred to `tasks/todo.md`)

**Verdict:** CHANGES_REQUESTED (3 blocking, 4 strong)

Spec-conformance was already CONFORMANT_AFTER_FIXES on the static spec match. This independent review surfaces three runtime correctness issues that the static spec match could not catch — all rooted in the same class: writes from unauthenticated handlers against FORCE-RLS tables without admin-bypass.

**Files reviewed (in scope per caller):** migrations 0268/0269, server/adapters/ghlAdapter.ts (+ tests), server/config/oauthProviders.ts (GHL block), server/config/rlsProtectedTables.ts, server/db/schema/{connectorConfigs,connectorLocationTokens,subaccounts}.ts, server/db/schema/index.ts, server/jobs/connectorPollingTick.ts, server/lib/ghlOAuthStateStore.ts, server/routes/{ghl.ts, oauthIntegrations.ts, webhooks/ghlWebhook.ts}, server/services/{connectorConfigService, ghlAgencyOauthService, ghlAgencyOauthServicePure, ghlWebhookMutationsService, ghlWebhookMutationsPure, locationTokenService}.ts (+ Pure variants and tests).

---

## Contents

1. Blocking Issues (B1, B2, B3)
2. Strong Recommendations (S1, S2, S3, S4)
3. Non-Blocking Improvements
4. Verification expectations on author

---

## Blocking Issues

### B1 — OAuth callback insert blocked by FORCE RLS on `connector_configs`

**File:** `server/services/connectorConfigService.ts:300-344` (`upsertAgencyConnection`)
**Caller:** `server/routes/oauthIntegrations.ts:368` (the unauthenticated `/api/oauth/callback`)

`connector_configs` carries `FORCE ROW LEVEL SECURITY` with the canonical org-isolation policy (migration 0245, lines 193-208). The policy's `WITH CHECK` clause requires `current_setting('app.organisation_id', true)` to be set and to match the row's `organisation_id`. The OAuth callback route is intentionally unauthenticated (browser redirect, no JWT), so it never goes through `authenticate`/`withOrgTx` middleware that sets the GUC. `upsertAgencyConnection` then calls `db.insert(connectorConfigs)...` on a plain pooled connection where `app.organisation_id` is empty — the `WITH CHECK` evaluates false — INSERT fails with permission denied.

The same class applies to the cross-org SELECT in `findAgencyConnectionByCompanyId` (line 346-360), which on a plain `db` handle returns zero rows under FORCE RLS.

The fix is the same pattern already used in `refreshAgencyTokenIfExpired` (line 362-449) and `connectorPollingTick.refreshNearExpiryAgencyTokens` — wrap the cross-org write in `withAdminConnection` + `SET LOCAL ROLE admin_role`. The author was aware of the constraint (the comment block at line 363-367 spells it out) but applied the fix only to the polling-tick path. The OAuth-callback path was missed, and Phase 6 (real-agency verification) was the only place this would surface — too late.

**Proposed fix:** Wrap the INSERT in `upsertAgencyConnection` and the SELECT in `findAgencyConnectionByCompanyId` in `withAdminConnection({ source: 'ghl_oauth_callback', skipAudit: true }, async (adminDb) => { await adminDb.execute(sql\`SET LOCAL ROLE admin_role\`); ... })`. The `params.orgId` in `upsertAgencyConnection` is provided by the caller (the validated state nonce), so org isolation is upheld at the application layer — this is exactly the contract `withAdminConnection` is designed for.

### B2 — Webhook side-effect handlers cannot see the connector under FORCE RLS

**File:** `server/services/ghlWebhookMutationsService.ts:121, 150, 198` (`dispatchWebhookSideEffects`)
**Caller:** `server/routes/webhooks/ghlWebhook.ts:73` (the unauthenticated `/api/webhooks/ghl`)

Same root cause as B1. The webhook route is unauthenticated by design (GHL has no JWT), and the lifecycle handler dispatches into `dispatchWebhookSideEffects` without any `withOrgTx` or `withAdminConnection` wrapper. Inside, every branch (`install_company`, `uninstall`, `location_create`) calls `connectorConfigService.findAgencyConnectionByCompanyId(event.companyId)` against `connector_configs` (FORCE RLS) — the SELECT returns zero rows because no GUC is set, the handler's `if (!connection) return { statusCode: 200 }` guard fires, and **every lifecycle webhook silently no-ops**. Subsequent `db.update(connectorConfigs)`/`db.update(connectorLocationTokens)`/`db.execute(sql\`INSERT INTO subaccounts...\`)` calls in the UNINSTALL and `location_create` branches would also be RLS-blocked even if the connection lookup succeeded.

This breaks REQ #27 (webhook → org mapping), REQ #28/29/30/31 (INSTALL/UNINSTALL/LocationCreate side effects), and the redundancy mechanism in §5.4. From the spec's perspective, this code is dead at runtime.

**Proposed fix:** Wrap the entire `dispatchWebhookSideEffects` body in `withAdminConnection` once the `companyId → connection.organisationId` lookup is done; OR have `findAgencyConnectionByCompanyId` use `withAdminConnection` internally (cleaner, since it's a deliberate cross-org primitive) and have each branch open a `withOrgTx(connection.organisationId, ...)` for the subsequent tenant-scoped writes (UNINSTALL UPDATE on `connector_configs`/`connector_location_tokens`, `location_create` INSERT on `subaccounts`). The latter is the cleaner separation: cross-org lookup uses admin, then tenant writes use the now-known org.

### B3 — `autoEnrolAgencyLocations` `subaccounts` INSERT blocked from OAuth callback

**File:** `server/services/ghlAgencyOauthService.ts:201-215` (the inline `INSERT INTO subaccounts ...`)
**Caller:** `server/routes/oauthIntegrations.ts:404` (OAuth callback) and `server/services/ghlWebhookMutationsService.ts:125` (INSTALL_company webhook)

`subaccounts` is FORCE RLS (migration 0245 batch). `autoEnrolAgencyLocations` runs `db.execute(sql\`INSERT INTO subaccounts ...\`)` on a plain `db` handle. Both call sites lack `withOrgTx` (the OAuth callback is unauthenticated; the webhook is unauthenticated). The INSERT will fail at the WITH CHECK clause for the same reason as B1/B2.

The same pattern repeats verbatim at `ghlWebhookMutationsService.ts:209-216` for the LocationCreate side effect — same fix needed.

**Proposed fix:** Once B2's fix lands and `connection.organisationId` is in scope, open `withOrgTx({ organisationId: connection.organisationId, ... })` and run the subaccount INSERT inside it. The DB handle inside the tx will have `app.organisation_id` set correctly, RLS will pass, and downstream `subaccountOnboardingService.autoStartOwedOnboardingWorkflows` will inherit the org context via `AsyncLocalStorage`. This also addresses why the spec invariant in REQ #25 (queue invariant) was deferred — once you're inside `withOrgTx`, the existing pg-boss enqueue helpers can be invoked correctly.

---

## Strong Recommendations

### S1 — Lifecycle webhook path bypasses the dedupe check

**File:** `server/routes/webhooks/ghlWebhook.ts:67-93`

The lifecycle branch calls `dispatchWebhookSideEffects` first, then `webhookDedupeStore.isDuplicate(webhookId)` only on the success path. `isDuplicate(eventId)` is side-effecting (it both checks AND marks). On a duplicate redelivery from GHL, the dedupe mark is set on the second call, but the side effects have already re-fired in between. The spec §5.4 hard invariant says "dedupe row written ONLY after side effects commit" — that part is satisfied — but the consequence is that GHL retries always reprocess. The side effects are designed to be idempotent (xmax=0 upsert pattern), so this is "safe but wasteful," not a correctness bug. Worth tightening: inside the lifecycle branch, peek at the dedupe store first (e.g., add a `peek(id)` method) — if already marked, skip directly to the 200 ack without dispatching. Otherwise the in-process dedupe table is dead code for the lifecycle path.

### S2 — Lifecycle events never write canonical mutation rows

**File:** `server/routes/webhooks/ghlWebhook.ts:46-94` (lifecycle branch returns at line 93)

`recordGhlMutation` only runs in the location-scoped second branch (line 238). Lifecycle events (`INSTALL`, `UNINSTALL`, `LocationCreate`, `LocationUpdate`) hit the early return at line 93 and never reach `recordGhlMutation`. But `ghlWebhookMutationsPure.ts` defines `app_installed`, `app_uninstalled`, `location_created`, `location_updated` mutation types specifically to be persisted into `canonical_subaccount_mutations` (Phase 1 follow-up — the comment at line 376-380 of `ghlAdapter.ts` confirms this is the design intent). Today these mutation types are dead code. The Staff Activity Pulse (§2.0b) loses visibility into install/uninstall/location-create operator events as a result.

**Proposed fix:** After `dispatchWebhookSideEffects` returns 200, call `recordGhlMutation({ organisationId: connection.organisationId, subaccountId: <mapped if applicable>, event })` before marking dedupe. For events without a mapped subaccount (INSTALL/UNINSTALL on the agency itself), `recordGhlMutation` already returns `skipped_no_subaccount` — but a per-org agency-level mutation log still has value. Either map to the org-default subaccount or extend the canonical table to allow `subaccountId IS NULL` for agency-scope mutations (out of scope for this PR — log a follow-up).

### S3 — `verifySignature` may break on `sha256=`-prefixed signature header

**File:** `server/adapters/ghlAdapter.ts:286-296`

The function compares the raw header value to a hex digest via `Buffer.from(signature)` + `Buffer.from(computed)`. If GHL's actual delivery contains a `sha256=<hex>` prefix (as GitHub does), the lengths differ → `crypto.timingSafeEqual` throws → caught → returns false → all signed payloads rejected. This is a fail-closed availability bug, not a security one, but it would make Stage 6a fail as soon as `GHL_WEBHOOK_SIGNING_SECRET` is configured. Add a small normaliser: `const sigHex = signature.startsWith('sha256=') ? signature.slice(7) : signature;` and compare buffers of equal hex length. Verify against an actual GHL webhook delivery (Stage 6a) and document the canonical header format in `docs/create-ghl-app.md` § Webhook signing secret.

### S4 — `ghlWebhook.ts` does not use `asyncHandler`

**File:** `server/routes/webhooks/ghlWebhook.ts:25`

Sister webhook routes (`teamworkWebhook.ts`, `slackWebhook.ts`) all use `asyncHandler`. `ghlWebhook.ts` does not — it uses an inline `async (req, res) => {...}`. Each top-level path has its own try/catch so unhandled rejections are unlikely in practice, but if a future contributor adds an `await` outside the existing catches, Express will not handle the rejection. Convention violation per architecture.md § Route Files. Wrap in `asyncHandler` and remove the redundant try/catch around `dispatchWebhookSideEffects`.

---

## Non-Blocking Improvements

- `oauthProviders.ts:52-72` — the GHL `tokenUrl` is now unused for the agency callback path (the new handler in `oauthIntegrations.ts:307` calls `exchangeGhlAuthCode` which hard-codes `https://services.leadconnectorhq.com/oauth/token`). Either route the callback through the registry-driven helper or remove the duplication; do not let the URL drift in two places.
- `connectorLocationTokens.ts:18-22` — the unique partial index `connector_location_tokens_live_uniq` exists in SQL only (Drizzle cannot express partial-where in the index DSL); add a `// SQL-only: <index name>` comment block.
- `locationTokenService.ts:120` — `.onConflictDoNothing()` without an explicit target catches any unique violation. Tighten to `.onConflictDoNothing({ target: [connectorLocationTokens.connectorConfigId, connectorLocationTokens.locationId], where: isNull(connectorLocationTokens.deletedAt) })`.
- `locationTokenService.ts:69-70` — `companyId = agencyConnection.companyId!` non-null assertion. Replace with a defensive guard.
- `oauthIntegrations.ts:399-402` — the dynamic-import + duck-typed cast for `autoEnrolAgencyLocations` is obsolete. Replace with a top-level static import.
- `connectorConfigService.ts:336` — the 23505 constraint matcher `pg.constraint?.includes('global_agency')` is brittle; promote to a constant.
- `ghlOAuthStateStore.ts:13-16` — comment correctly flags the single-instance limitation. Add a startup assertion that fails loudly if accidentally going multi-instance in production.
- Naming inconsistency: `docs/create-ghl-app.md` says `GHL_APP_WEBHOOK_SECRET` but `env.ts`/`ghlWebhook.ts` use `GHL_WEBHOOK_SIGNING_SECRET`. Align both files.
- `ghlAgencyOauthService.ts:201-215` — pin a comment that the `ON CONFLICT (...) WHERE ...` predicate must match the migration 0268 partial-index predicate exactly.

---

## Verification expectations on author

- Run `npm run lint && npm run typecheck` before marking done. Surface any new lint/typecheck failures in changed files.
- Run only the new unit-test files authored to address S1 / S3 via `npx vitest run <path-to-test>`. Do NOT run `npm run test:gates` or other whole-repo gate suites locally — CI handles those.
- After fixing B1/B2/B3, re-run `pr-reviewer` on the expanded changed set so the post-fix state is reviewed.
