# Dual Review Log — ghl-module-c-oauth review-fixes

**Files reviewed:** `server/adapters/ghlAdapter.ts`, `server/routes/webhooks/ghlWebhook.ts`, `server/services/connectorConfigService.ts`, `server/services/ghlAgencyOauthService.ts`, `server/services/ghlWebhookMutationsService.ts`, `server/services/locationTokenService.ts`, `tasks/todo.md`

**Iterations run:** 3/3
**Timestamp:** 2026-05-03T06:46:28Z
**Branch:** ghl-agency-oauth
**Codex CLI:** v0.118.0 (gpt-5.4)

---

## Iteration 1

All three findings rooted in the same architectural fact: `db.transaction(async (tx) => { tx.execute(set_config('app.organisation_id', $1, true)); ... })` does NOT scope queries the inner code issues against the module-level `db` handle — `tx` and `db.<query>()` use different pool connections. My S2/B2/B3 fixes wrapped the inserts and the auto-start dispatch in `db.transaction(... set_config)`, which works for the inserts (via `tx.execute`) but is a no-op for downstream service calls using module-level `db`.

```
[ACCEPT] [P1] server/routes/webhooks/ghlWebhook.ts:105 — recordGhlMutation runs without org-scoped DB context
  canonical_subaccount_mutations has FORCE RLS. The unauthenticated webhook route has
  no app.organisation_id GUC on the pool connection. Calling recordGhlMutation from
  there means every INSERT fails the WITH CHECK clause AND the lookback SELECT in
  resolveExternalUserKind returns 0 rows. Real defect in S2 code (lifecycle path) and
  pre-existing for the location-scoped path. Fix: refactor recordGhlMutation +
  resolveExternalUserKind to use withAdminConnection + SET LOCAL ROLE admin_role.

[REJECT-but-PARTIAL-MITIGATE] [P2] server/services/ghlAgencyOauthService.ts:278 — autoStart from unauthenticated context
  Proper fix is a refactor of subaccountOnboardingService to be admin-bypass capable
  (uses module-level `db`; queries org_subscriptions, workflow_runs, workflow_templates).
  High blast radius; scope-too-large for review-loop. PARTIAL MITIGATION: my wrapper
  gave false confidence — removing it. Defer proper fix to tasks/todo.md.

[REJECT-but-PARTIAL-MITIGATE] [P2] server/services/ghlWebhookMutationsService.ts:259 — same issue, LocationCreate path
  Same root cause, same mitigation.
```

**Changes:** `ghlWebhookMutationsService.ts` — imported `withAdminConnection`; refactored `recordGhlMutation` insert + `resolveExternalUserKind` SELECT to admin bypass; removed misleading `db.transaction(... set_config)` around `autoStartOwedOnboardingWorkflows`. `ghlAgencyOauthService.ts` — same wrapper removal; updated comment block. `tasks/todo.md` — added deferred entry "GHL unauthenticated auto-start onboarding silently no-ops under FORCE RLS".

`npm run lint` + `npm run typecheck` clean.

---

## Iteration 2

Two new findings — genuine regressions either introduced by iteration 1 or pre-existing in S2.

```
[ACCEPT] [P1] server/routes/webhooks/ghlWebhook.ts:105 — Lifecycle recordGhlMutation result not inspected
  recordGhlMutation never throws — returns { status: 'error', error } on DB failure.
  My route try/catch is dead code. So a future RLS regression / DB outage drops the
  row silently while the webhook 200-acks AND marks dedupe. Location-scoped call at
  line 274 already inspects mutationResult.status — the lifecycle path must too.
  Fix: replace try/catch with explicit result inspection.

[ACCEPT] [P1] server/services/ghlWebhookMutationsService.ts:249 — Slug-fallback inside aborted tx
  My iteration-1 layout put the slug-fallback for-loop INSIDE a single db.transaction.
  When the first INSERT raises 23505 slug-collision and the catch `continue`s to the
  second slug, Postgres has marked the tx aborted ("current transaction is aborted,
  commands ignored until end of transaction block"). Real regression — webhook 503s
  on every retry whenever baseSlug already exists. Fix: mirror autoEnrolAgencyLocations
  pattern (for-loop OUTSIDE, db.transaction INSIDE per-row).
```

**Changes:** `ghlWebhookMutationsService.ts` — restructured LocationCreate slug-fallback so each slug attempt opens its own `db.transaction`. `ghlWebhook.ts` — replaced try/catch around lifecycle `recordGhlMutation` with explicit result inspection (mirrors location-scoped path).

`npm run lint` + `npm run typecheck` clean.

---

## Iteration 3

Two findings.

```
[REJECT] [P2] server/routes/webhooks/ghlWebhook.ts:110 — INSTALL/UNINSTALL forwarded with subaccountId=null, recordGhlMutation skips
  INTENTIONAL deferred behaviour, already documented in tasks/todo.md "Agency-level
  canonical mutation rows". canonical_subaccount_mutations.subaccount_id is NOT NULL
  today; the schema decision (allow null OR materialise an "agency root" subaccount)
  is pending and needs spec-level approval. Skip is now logged so it's visible.

[ACCEPT] [P2] server/services/ghlWebhookMutationsService.ts:302 — LocationUpdate falls through default return
  classifyWebhookEvent returns 'location_update' for LocationUpdate events but
  dispatchWebhookSideEffects has no case — falls through to default { statusCode: 200 }
  with no organisationId. Route only calls recordGhlMutation when organisationId is
  present. Result: every LocationUpdate webhook is acknowledged without writing the
  location_updated mutation row that ghlWebhookMutationsPure.ts:170 specifically
  produces. Spec §5.4: "LocationUpdate: existing canonical-mutation row is sufficient;
  no new side effect required" — meaning the canonical mutation IS the spec-named
  outcome and it's currently dead. Fix: add 'location_update' case that resolves
  org+subaccount via existing connection lookup + subaccounts admin-bypass query.
```

**Changes:** `ghlWebhookMutationsService.ts` — imported `subaccounts`; added `if (eventClass === 'location_update')` case. Resolves agency connection by `companyId` then looks up subaccount via `withAdminConnection` + `SET LOCAL ROLE admin_role`, scoped by `(organisationId, connectorConfigId, externalId, isNull(deletedAt))`. Returns `{ statusCode: 200, organisationId, subaccountId }` so the route's `recordGhlMutation` fires.

`npm run lint` + `npm run typecheck` clean.

---

## Changes Made

- `server/services/ghlWebhookMutationsService.ts` — recordGhlMutation + resolveExternalUserKind use admin-bypass; LocationCreate slug-fallback restructured to per-row tx (fixes aborted-tx regression); removed misleading set_config wrapper around autoStart call; added LocationUpdate dispatch case.
- `server/services/ghlAgencyOauthService.ts` — removed misleading set_config wrapper around autoStart call; updated `autoEnrolAgencyLocations` comment block to honestly describe what is scoped vs not.
- `server/routes/webhooks/ghlWebhook.ts` — replaced try/catch around lifecycle recordGhlMutation with explicit result inspection (mirrors location-scoped path); logs `error` and `skipped_no_subaccount` separately.
- `tasks/todo.md` — added deferred entry "GHL unauthenticated auto-start onboarding silently no-ops under FORCE RLS" with rationale + fix options.

## Rejected Recommendations

- **Iter 1 [P2] x2 — autoStartOwedOnboardingWorkflows architectural fix.** Proper fix is a refactor of `subaccountOnboardingService` to accept an explicit tx parameter or use `getOrgScopedDb()`, with high blast radius via downstream `WorkflowRunService.startRun` (also FORCE-RLS). Out of scope for review-loop. PARTIALLY MITIGATED — removed the misleading wrapper that gave false confidence; logged limitation in code comments + tasks/todo.md.
- **Iter 3 [P2] — INSTALL/UNINSTALL agency-level mutation rows.** Already deferred via the pr-reviewer/adversarial-reviewer round under "Agency-level canonical mutation rows". `subaccount_id IS NOT NULL` constraint vs "agency root" subaccount decision is a schema-level choice that needs spec-level approval, not in-loop adjudication. Skip is logged.

---

**Verdict:** APPROVED (3 iterations, 6 fixes applied across 3 files + 1 deferred-item entry; 2 architectural items intentionally deferred to tasks/todo.md with full rationale)
