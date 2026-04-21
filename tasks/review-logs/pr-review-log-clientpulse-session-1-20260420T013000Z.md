# PR-review log — ClientPulse Session 1 (branch `claude/clientpulse-session-1-foundation`)

Review timestamp: 2026-04-20T01:30:00Z
Reviewer: pr-reviewer agent (read-only)
Scope: combined Session 1 diff vs main (8 commits).

```pr-review-log
## Files reviewed
- `server/routes/organisationConfig.ts`
- `server/services/configUpdateOrganisationService.ts`
- `server/services/configUpdateOrganisationConfigPure.ts` (via grep)
- `server/services/orgConfigService.ts`
- `server/services/systemTemplateService.ts`
- `server/services/configHistoryService.ts`
- `server/services/onboardingService.ts`
- `server/services/interventionActionMetadata.ts`
- `server/config/actionRegistry.ts`
- `server/config/sensitiveConfigPathsRegistry.ts`
- `server/modules/clientpulse/registerSensitivePaths.ts`
- `server/routes/clientpulseInterventions.ts`
- `server/routes/actions.ts`
- `server/routes/onboarding.ts`
- `server/routes/configHistory.ts`
- `server/index.ts`
- `server/db/schema/hierarchyTemplates.ts`
- `server/db/schema/organisations.ts`
- `server/jobs/measureInterventionOutcomeJob.ts`
- `server/jobs/proposeClientPulseInterventionsJob.ts` (via grep)
- `migrations/0180_org_operational_config_override.sql`
- `migrations/0181_rename_operator_alert.sql`
- `migrations/0182_organisations_onboarding_completed_at.sql`
- `migrations/_down/0180_org_operational_config_override.sql`
- `migrations/_down/0181_rename_operator_alert.sql`
- `migrations/_down/0182_organisations_onboarding_completed_at.sql`
- `migrations/0184_skill_analyzer_execution_lock_token.sql`
- `client/src/components/config-assistant/ConfigAssistantPopup.tsx`
- `client/src/hooks/useConfigAssistantPopup.tsx`
- `client/src/pages/ConfigAssistantPage.tsx`
- `client/src/pages/ClientPulseSettingsPage.tsx`
- `client/src/pages/OnboardingWizardPage.tsx`
- `client/src/App.tsx`
- `server/config/__tests__/actionSlugAliasesPure.test.ts`
- `server/config/__tests__/sensitiveConfigPathsRegistryPure.test.ts`
- `server/services/__tests__/orgOperationalConfigMigrationPure.test.ts`

**Review timestamp:** 2026-04-20T00:00:00Z

---

## Summary verdict: FAIL

Two blocking correctness bugs — the runtime read path for operational config was never retargeted to the new column (contract (h) violated at the service layer), and `systemTemplateService.ts` writes to a renamed column using the stale field name (Drizzle will generate invalid SQL at runtime). One blocking convention violation in the new GET route. Fix these three before merge; everything else is ship-follow.

---

## Findings by severity

### Blocking (must fix before merge)

**B1 — Contract (h) violation: `orgConfigService.getOperationalConfig` still reads from `hierarchy_templates.operational_config_seed`, not `organisations.operational_config_override`.**

`server/services/orgConfigService.ts` line 337:
```typescript
const orgOverrides = (orgTemplate.operationalConfigSeed as Record<string, unknown>) ?? {};
return deepMerge(systemDefaults, orgOverrides) as OperationalConfig;
```

This is the central read path used by every runtime caller (health scoring, churn risk, intervention defaults, alert limits, scenario detector, outcome measurement job, Configuration Assistant). The migration (0180) and the write path (`configUpdateOrganisationService`) correctly write to `organisations.operational_config_override`, but this reader never was retargeted. The file's own header comment (lines 15-16) acknowledges the retarget was supposed to happen in Chunk A.2 but it was not executed.

The service also doesn't import `organisations` from `server/db/schema/index.js` — the import at line 7 only pulls `hierarchyTemplates, systemHierarchyTemplates, orgAgentConfigs`. Any config-agent write and any Settings page save silently diverges from what every runtime reader sees.

**Fix:** Retarget `getOperationalConfig` to:
1. Query `organisations` for `operational_config_override` and `applied_system_template_id`.
2. If `appliedSystemTemplateId` is set, query `system_hierarchy_templates` for `operational_defaults`.
3. Call `resolveEffectiveOperationalConfig(systemDefaults, overrides)` and return.

The `hierarchyTemplates` join for org-config reads is no longer needed (it remains relevant for blueprint-editor reads of `operational_config_seed`, which is a different surface).

**B2 — Runtime crash risk: `systemTemplateService.ts` writes to renamed column using stale Drizzle field name.**

`server/services/systemTemplateService.ts` lines 775 and 790:
```typescript
operationalConfig: operationalDefaults ?? null,
```

The Drizzle schema (`server/db/schema/hierarchyTemplates.ts`) renamed the field from `operationalConfig` to `operationalConfigSeed` (which maps to SQL column `operational_config_seed`, renamed by migration 0180). The `.set({ operationalConfig: ... } as Record<string, unknown>)` cast at line 779 and `.values({ ... operationalConfig: ... } as typeof hierarchyTemplates.$inferInsert)` at line 792 bypass TypeScript's ORM type checking via the `as` cast, but the generated SQL will reference the old column name `operational_config` which no longer exists post-migration. This will throw a Postgres column-not-found error any time `applySystemTemplate` is called on an org.

**Fix:** Replace both occurrences with `operationalConfigSeed: operationalDefaults ?? null`.

**B3 — Convention violation: `GET /api/organisation/config` accesses `db` directly inside a route handler.**

`server/routes/organisationConfig.ts` lines 77-103 execute two raw Drizzle queries (`db.select().from(organisations)` and `db.select().from(systemHierarchyTemplates)`) inline in the route handler. Per the architecture convention: "Routes call services only — never access `db` directly in a route."

The POST handler in the same file correctly delegates to `applyOrganisationConfigUpdate` (a service function). The GET handler should follow the same pattern.

**Fix:** Extract the GET logic into a service method — either `orgConfigService.getEffectiveConfig(orgId)` returning the full `{ effective, overrides, systemDefaults, appliedSystemTemplateId, appliedSystemTemplateName }` shape, or add a new `organisationConfigService.getConfig(orgId)`. The route handler then becomes a one-liner. Given B1 is also in `orgConfigService`, this fix can be done alongside the B1 retarget in the same service file.

---

### Non-blocking (ship follow-up ticket)

**N1 — Contract (k) partial implementation: the 15-minute resume window is not enforced.**

`client/src/components/config-assistant/ConfigAssistantPopup.tsx` renders the Config Assistant page inside an iframe. The `ConfigAssistantPage.tsx` initialisation at line 261-268 always loads all conversations (`GET /api/agents/:agentId/conversations` with no `updatedAfter` param) and resumes `convs[0]`. The 15-minute guard described in contract (k) and the `CONFIG_ASSISTANT_RESUME_WINDOW_MIN` constant defined in `useConfigAssistantPopup.tsx` line 29 is documented but never applied — no code path checks the elapsed time against 15 minutes before resuming.

The server-side `updatedAfter` extension exists and is tested, but no client code calls it with a 15-minute window. An operator who closes the popup and reopens it 2 hours later will silently resume a stale session rather than starting fresh.

**N2 — Missing permission guard on `POST /api/onboarding/complete`.**

`server/routes/onboarding.ts` line 23: the route is `authenticate`-only with no `requireOrgPermission` guard. Any authenticated org member (including read-only users) can call `POST /api/onboarding/complete` and permanently mark the org's onboarding as complete, suppressing the wizard for all org members.

**N3 — Missing test coverage for ship gate S1-A1 (read-path retarget).**

**N4 — `commitOverrideAndRecordHistory` version read-back is redundant.**

### Nits / polish

- `server/services/orgConfigService.ts` line 3: `orgAgentConfigs` pre-existing dead import.
- Raw emoji in ConfigAssistantPopup.
- `tx as unknown as Parameters<...>` double cast.
- Migration partial index rebuild without CONCURRENTLY (pre-existing pattern).

---

## Coverage check

- **Contract (h)** — FAIL (B1, B2).
- **Contract (i)** — PASS.
- **Contract (j)** — PASS conditional on B1/B3 fix.
- **Contract (k)** — PARTIAL (N1).
- **Contract (l)** — PASS.
- **Contract (n)** — PASS.
- **Contract (t)** — PASS.

Scope fence: no Session 2 creep.

## Top risks

1. Silent data split at runtime (B1 + B2) — writes land in new column, reads return old column. Entire Session 1 contract (h) is a runtime no-op.
2. No read-path test means B1 could survive future refactors.
3. `POST /api/onboarding/complete` ungated (N2).
```
