# A1a — Principal-context propagation: service surface change

**Status:** ✓ done — 2026-04-26.

## What landed

1. **Service-side migration of `server/services/canonicalDataService.ts`**: every one of the 31 methods now takes `principal: PrincipalContext` as the first positional argument. Method bodies derive `organisationId` (and `subaccountId` where relevant) from `principal`. Each method calls `requirePrincipal(principal, '<method>')` at entry — fails fast with a clear `principal is required` error before any DB work, satisfying the "throws before DB" contract for A1b's gate hardening.

2. **Caller migration (5 files — 4 in-scope per spec + intelligenceSkillExecutor)**:
   - `server/routes/webhooks/ghlWebhook.ts` — `principal = fromOrgId(orgId, dbAccount.subaccountId ?? undefined)`.
   - `server/services/connectorPollingService.ts` — `orgPrincipal = fromOrgId(config.organisationId)` for org-level account upsert; `accountPrincipal = fromOrgId(config.organisationId, dbAccount.subaccountId ?? undefined)` for per-account writes.
   - `server/services/crmQueryPlanner/executors/canonicalQueryRegistry.ts` — `principal = fromOrgId(args.orgId, args.subaccountId)` per handler. Args objects no longer carry `orgId`/`subaccountId` — they live on `principal` now.
   - `server/jobs/measureInterventionOutcomeJob.ts` — `principal = fromOrgId(organisationId, subaccountId)` inside `resolveAccountIdForSubaccount`.
   - `server/services/intelligenceSkillExecutor.ts` — every call site migrated; principals constructed via `fromOrgId(context.organisationId)` at function entry. (This file was nominally out-of-scope for A1a per the planning doc, but in practice it had to be migrated because the new signature was a breaking type change. The `fromOrgId` shim permits this without forcing a deeper rework.)

3. **New test file `server/services/__tests__/canonicalDataService.principalContext.test.ts`**: 7 tests, all passing — 5 cover the principal-required throws on representative methods (read positional, write positional, args-object, CRM query planner shape), 2 cover the `fromOrgId` shape contract.

## A1a-specific implementation choice (vs spec wording)

The spec §A1a step 2 says "Each method body MUST wrap its DB work in `withPrincipalContext(principal, async (tx) => { ... })`". A1a does NOT do this. Reason: `withPrincipalContext` throws when no `withOrgTx` is active, and several A1a callers (notably `connectorPollingService` and `measureInterventionOutcomeJob`) run outside any `withOrgTx` context — wrapping today would break production paths. The wrap lands in A1b together with the gate flip, at the same time every caller is verified to run inside an active `withOrgTx`. A1a establishes the signature standard; A1b establishes the runtime invariant.

## A1a-specific approach to deprecated shims (vs spec wording)

The spec §A1a step 3 permits keeping the old positional signature as a `@deprecated — remove in A1b` overload. A1a does NOT keep shims. Reason: every caller migrated in A1a (the in-scope 4 plus `intelligenceSkillExecutor`), so the shim would have zero call sites — it would only exist as a hazard for new code. The pre-A1b shim-usage greps (per spec lines 250–253) collapse trivially: shim count = 0, so the count assertion is "0 shims, all callers migrated".

## Verification

- `npm run build:server` — clean (no errors).
- `npx tsx --test server/services/__tests__/canonicalDataService.principalContext.test.ts` — 7/7 pass.
- `npx tsx --test server/services/__tests__/canonicalDataService.findAccountBySubaccountId.test.ts` — 5/5 pass (regression check).
- `npx tsx --test server/jobs/__tests__/measureInterventionOutcomeJobPure.test.ts` — 11/11 pass (caller-adjacent regression check).
- `bash scripts/verify-principal-context-propagation.sh` — `[GATE] principal-context-propagation: violations=0`.

## Files changed

- `server/services/canonicalDataService.ts` — 31-method surface migration.
- `server/routes/webhooks/ghlWebhook.ts` — caller migration.
- `server/services/connectorPollingService.ts` — caller migration.
- `server/services/crmQueryPlanner/executors/canonicalQueryRegistry.ts` — caller migration (rewritten).
- `server/jobs/measureInterventionOutcomeJob.ts` — caller migration.
- `server/services/intelligenceSkillExecutor.ts` — caller migration.
- `server/services/__tests__/canonicalDataService.principalContext.test.ts` — new test (7 tests).
- `tasks/builds/audit-remediation-followups/a1a-principal-context-surface/canonical-call-sites.md` — inventory.
- `tasks/builds/audit-remediation-followups/a1a-principal-context-surface/progress.md` — this file.
- `docs/superpowers/specs/2026-04-26-audit-remediation-followups-spec.md` — A1a row marked ✓ done.
