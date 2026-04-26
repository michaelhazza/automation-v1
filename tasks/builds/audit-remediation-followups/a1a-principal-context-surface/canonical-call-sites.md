# A1a — canonicalDataService call-site inventory

Generated 2026-04-26 from `grep -rn "canonicalDataService\." server/`.

## Service surface (31 methods)

`server/services/canonicalDataService.ts` exports a single `canonicalDataService` object containing 31 methods, grouped:

### Read methods — positional (legacy: `(accountId, …, organisationId?)`)
- `getAccountsByOrg(organisationId)`
- `findAccountBySubaccountId(orgId, subaccountId)`
- `getAccountById(accountId, organisationId)`
- `getContactMetrics(accountId, dateRange?, organisationId?)`
- `getOpportunityMetrics(accountId, organisationId?)`
- `getConversationMetrics(accountId, organisationId?)`
- `getRevenueMetrics(accountId, dateRange?, organisationId?)`
- `getLatestHealthSnapshot(accountId, organisationId?)`
- `getHealthHistory(accountId, limit?, organisationId?)`
- `getRecentAnomalies(organisationId, limit?)`
- `getMetricValue(accountId, metricSlug, periodType, organisationId?)`
- `getMetricsByAccount(accountId, organisationId?)`
- `getMetricHistoryBySlug(accountId, metricSlug, periodType, limit?, excludeBackfill?)`
- `getMetricHistoryCount(accountId, metricSlug, periodType, excludeBackfill?)`

### Write methods — positional or args-object (legacy)
- `writeHealthSnapshot(data)` — args-object, `data.organisationId`
- `writeAnomalyEvent(data)` — args-object, `data.organisationId`
- `acknowledgeAnomaly(anomalyId, organisationId)`
- `upsertAccount(organisationId, connectorConfigId, data)`
- `upsertContact(organisationId, accountId, data)`
- `upsertOpportunity(organisationId, accountId, data)`
- `upsertConversation(organisationId, accountId, data)`
- `upsertRevenue(organisationId, accountId, data)`
- `upsertMetric(data)` — args-object, `data.organisationId`
- `appendMetricHistory(data)` — args-object, `data.organisationId`

### CRM Query Planner — args-object methods (already use `args.orgId`)
- `listInactiveContacts(args)` — `args.orgId`, `args.subaccountId`, …
- `listStaleOpportunities(args)`
- `listUpcomingAppointments(args)`
- `countContactsByTag(args)`
- `countOpportunitiesByStage(args)`
- `getRevenueTrend(args)`
- `getAccountsAtRiskBand(args)`
- `getPipelineVelocity(args)`

## Caller inventory

### In scope (4 callers — must migrate in A1a)

#### 1. `server/routes/webhooks/ghlWebhook.ts`
- L115: `canonicalDataService.upsertContact(orgId, dbAccount.id, …)`
- L126: `canonicalDataService.upsertOpportunity(orgId, dbAccount.id, …)`
- L136: `canonicalDataService.upsertConversation(orgId, dbAccount.id, …)`
- L145: `canonicalDataService.upsertRevenue(orgId, dbAccount.id, …)`

#### 2. `server/services/connectorPollingService.ts`
- L126: `canonicalDataService.upsertAccount(config.organisationId, config.id, …)`
- L150: `canonicalDataService.upsertContact(config.organisationId, dbAccount.id, c)`
- L156: `canonicalDataService.upsertOpportunity(config.organisationId, dbAccount.id, o)`
- L162: `canonicalDataService.upsertConversation(config.organisationId, dbAccount.id, c)`
- L168: `canonicalDataService.upsertRevenue(config.organisationId, dbAccount.id, …)`
- L202: `canonicalDataService.upsertMetric({ organisationId, … })`
- L220: `canonicalDataService.appendMetricHistory({ organisationId, … })`

#### 3. `server/services/crmQueryPlanner/executors/canonicalQueryRegistry.ts`
- L43: `canonicalDataService.listInactiveContacts({ orgId, subaccountId, … })`
- L61: `canonicalDataService.getAccountsAtRiskBand({ orgId, subaccountId, … })`
- L75: `canonicalDataService.getPipelineVelocity({ orgId, subaccountId, … })`
- L89: `canonicalDataService.listStaleOpportunities({ orgId, subaccountId, … })`
- L104: `canonicalDataService.listUpcomingAppointments({ orgId, subaccountId, … })`
- L117: `canonicalDataService.countContactsByTag({ orgId, subaccountId })`
- L127: `canonicalDataService.countOpportunitiesByStage({ orgId, subaccountId })`
- L139: `canonicalDataService.getRevenueTrend({ orgId, subaccountId, … })`

#### 4. `server/jobs/measureInterventionOutcomeJob.ts`
- L214: `canonicalDataService.findAccountBySubaccountId(organisationId, subaccountId)`

### Out of scope for A1a (uses `fromOrgId` shim — A1b cleanup)

#### `server/services/intelligenceSkillExecutor.ts`
- L84: `canonicalDataService.getMetricHistoryBySlug(...)`
- L102: `canonicalDataService.getMetricValue(accountId, signal.metricSlug, 'rolling_30d', organisationId)`
- L114: `canonicalDataService.getAccountById(accountId, organisationId)`
- L121: `canonicalDataService.getRecentAnomalies(organisationId, 100)`
- L126: `canonicalDataService.getLatestHealthSnapshot(accountId, organisationId)`
- L163: `canonicalDataService.getAccountsByOrg(context.organisationId)`
- L168: `canonicalDataService.getLatestHealthSnapshot(account.id, context.organisationId)`
- L169: `canonicalDataService.getMetricsByAccount(account.id, context.organisationId)`
- L270: `canonicalDataService.getAccountById(accountId, context.organisationId)`
- L281: `canonicalDataService.getMetricHistoryCount(...)`
- L302: `canonicalDataService.getMetricValue(...)`
- L335: `canonicalDataService.getHealthHistory(accountId, 5, context.organisationId)`
- L349: `canonicalDataService.writeHealthSnapshot({...})`
- L429: `canonicalDataService.getMetricValue(...)`
- L436: `canonicalDataService.getMetricHistoryBySlug(...)`
- L473: `canonicalDataService.getRecentAnomalies(context.organisationId, 100)`
- L492: `canonicalDataService.writeAnomalyEvent({...})`
- L569: `canonicalDataService.getLatestHealthSnapshot(accountId, context.organisationId)`
- L574: `canonicalDataService.getAccountById(accountId, context.organisationId)`
- L643: `canonicalDataService.getAccountsByOrg(context.organisationId)`
- L644: `canonicalDataService.getRecentAnomalies(context.organisationId, 50)`
- L649: `canonicalDataService.getLatestHealthSnapshot(account.id, context.organisationId)`

This file uses `fromOrgId(organisationId)` to bridge — within scope of A1b.

#### `server/config/actionRegistry.ts`
- No actual call sites; only an import to satisfy the verify gate. Comment-only mention.

## Migration shape (per spec §A1a, with A1a-specific implementer guidance)

**Split-positional: `(principal: PrincipalContext, …existing args)`.**

For each method:
- Read methods accepting `accountId, …, organisationId?` → become `(principal, accountId, …)` and use `principal.organisationId`.
- Read methods like `getAccountsByOrg(organisationId)` → become `(principal)` (orgId comes from principal).
- Read methods like `findAccountBySubaccountId(orgId, subaccountId)` → become `(principal, subaccountId)`; `subaccountId` stays positional because it's the lookup key, not the requesting principal's subaccount.
- Read methods like `getRecentAnomalies(organisationId, limit?)` → become `(principal, limit?)`.
- Read methods like `acknowledgeAnomaly(anomalyId, organisationId)` → become `(principal, anomalyId)`.
- Write methods with positional `(organisationId, accountId, data)` → become `(principal, accountId, data)`; `organisationId` removed as positional.
- Write methods with args-object containing `organisationId` (`writeHealthSnapshot`, `writeAnomalyEvent`, `upsertMetric`, `appendMetricHistory`) → become `(principal, args)`; `organisationId` removed from `args` (passed via `principal`).
- CRM Query Planner methods with args containing `orgId, subaccountId` → become `(principal, args)`; `args.orgId` and `args.subaccountId` are removed (use `principal.organisationId`/`principal.subaccountId`).

**Body change in A1a:**
- Replace `organisationId` references with `principal.organisationId`.
- Continue using module-top `db` (no `withPrincipalContext` wrap yet — that's A1b, when the gate hardens and all callers run inside `withOrgTx`).
- Add `if (!principal) throw new Error('canonicalDataService.<method>: principal is required')` at the top of each method to satisfy "throws before any DB work" test invariant.

**Caller migration (4 files):**
- `ghlWebhook.ts`: `fromOrgId(orgId)` (no subaccountId in scope when `dbAccount.subaccountId` is null).
- `connectorPollingService.ts`: `fromOrgId(config.organisationId)` (org-level connector — no subaccount).
- `canonicalQueryRegistry.ts`: `fromOrgId(args.orgId, args.subaccountId)`.
- `measureInterventionOutcomeJob.ts`: `fromOrgId(organisationId, subaccountId)` (subaccountId in scope).

**Out of scope:**
- `intelligenceSkillExecutor.ts` — uses `fromOrgId` shim; will be cleaned up in A1b.
- `actionRegistry.ts` — no actual call sites; import-only.
