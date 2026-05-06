```adversarial-review-log
date: 2026-05-06T03:10:00Z
branch: claude/pre-launch-phase-3
slug: pre-launch-phase-3-deferred-backlog
reviewer: adversarial-reviewer (read-only)
verdict: ADVISORY — 2 confirmed holes, 0 escalations
```

## Confirmed Holes

### F-1 — Silent RLS bypass: GHL pagination job INSERT (CRITICAL)
**Classification:** Tenant-isolation / RLS bypass
**File:** `server/jobs/ghlAutoEnrolLocationsPageJob.ts` step 9
**Finding:** `db.execute(sql\`INSERT INTO subaccounts...\`)` runs on the module-level pool connection outside any transaction. `subaccounts` has `FORCE ROW LEVEL SECURITY` with a `WITH CHECK (organisation_id = current_setting('app.organisation_id', true)::uuid)` policy. The module-level `db` handle never has `app.organisation_id` set in a pg-boss worker context — pg-boss does not call any GUC-setting middleware. Every INSERT is silently rejected. The worker emits `enrolProgress` and `enrolCompleted` audit events with correct counts, but writes zero subaccount rows. A cross-tenant attacker cannot exploit this (the job is write-only, not read-bypassing), but the feature is entirely broken — enrolled locations do not appear as subaccounts.
**Attack surface:** Data loss (feature silently non-functional). Not a cross-tenant leakage path, but classified as a confirmed hole because the FORCE RLS invariant is violated.
**Remediation:** Wrap each INSERT in `db.transaction(async tx => { await setOrgGUC(tx, organisationId); await tx.execute(sql\`INSERT...\`); })`.
**Status (post-fix):** CLOSED. Fix applied in fix pass — each INSERT now runs in its own org-scoped transaction.

### F-2 — OAuth state audit events lack request attribution
**Classification:** Observability / security-event completeness
**File:** `server/routes/ghl.ts` (setGhlOAuthState), `server/routes/oauthIntegrations.ts` (consumeGhlOAuthState)
**Finding:** Both call sites omit the `context` parameter. The four OAuth state audit events (`stateIssued`, `stateConsumed`, `stateExpired`, `stateNotFound`) write `userAgent: null, ip: null`. This eliminates the ability to correlate state issuance and consumption to a specific client — making these events useless for detecting state reuse attacks or credential stuffing from a specific IP.
**Attack surface:** Detection evasion — an attacker replaying expired or stolen state nonces cannot be attributed. Classified advisory (phase 1) since state-nonce validity is enforced by the DELETE-returning pattern regardless.
**Remediation:** Pass `{ userAgent: req.get('user-agent') ?? null, ip: req.ip ?? null }` to both call sites.
**Status (post-fix):** CLOSED. Fix applied in fix pass.

---

## Advisory Notes (non-blocking)

### A-1 — In-memory queue workers never set system context
**File:** `server/services/queueService.ts`
**Finding:** `setSystemWorkerContext(true)` is called only in the pg-boss boot path. The in-memory queue fallback (used in dev/test without a database) registers workers without setting the flag. Any worker code that calls `assertSystemWorkerContext()` will throw in the in-memory path. Low blast radius (dev/test only), but could mask bugs in test environments.
**Status:** Deferred — noted in tasks/todo.md.

### A-2 — `external_id_namespace` omitted from inline and webhook INSERT paths
**File:** `server/services/ghlAgencyOauthService.ts`, `server/services/ghlWebhookMutationsService.ts`
**Finding:** Both paths insert subaccounts without `external_id_namespace = 'ghl_location'`. The migration 0285 partial unique index only applies to `ghl_location`-namespaced rows — without this value, the idempotency guarantee doesn't hold for these paths.
**Status:** CLOSED — fixed in fix pass.
