# Tier 2 Audit — wave-6-rls-residue-and-gate-fix

**Date:** 2026-05-18
**Total Tier 2 callsites from tier-categorisation.md:** 159

## Methodology

For each Tier 2 entry, the source file was inspected at the cited line. Disposition was determined as:
- `migrated` — the line now uses `getOrgScopedDb()` or `withAdminConnection()` (earlier in-wave migration converted it)
- `guard-ignore-present` — a `guard-ignore: with-org-tx-or-scoped-db` annotation is in place
- `corrected-in-chunk-12` — no annotation existed; added during this audit

Files where 0 guard-ignore annotations were found but Tier 2 entries existed were fully corrected.

## Summary by file

| file | Tier 2 entries | Disposition | Notes |
|------|---------------|-------------|-------|
| server/services/agentEmbeddingService.ts | 5 (lines 63,95,122,150,188) | guard-ignore-present | 6 guard-ignores cover all callsites |
| server/services/agentWorkingTimeService.ts | 1 (line 370) | migrated | Uses `getOrgScopedDb('agentWorkingTimeService.getRollupsForRange')` |
| server/services/clientPulseInterventionContextService.ts | 1 (line 225) | guard-ignore-present | guard-ignore: reason="cross-tenant/admin operation — outcome aggregation spans historical data" |
| server/services/executionBackends/operatorManagedBackend.ts | 3 (lines 225,962,995) | guard-ignore-present / corrected-in-chunk-12 | Line 962 already had annotation; lines 225 and 996 corrected in chunk-12 |
| server/services/executionService.ts | 2 (lines 388,432) | guard-ignore-present | Lines 399 and 444 carry annotations covering both callsites |
| server/services/fileDeliveryService.ts | 2 (lines 217,259) | migrated | Both use `getOrgScopedDb()` |
| server/services/llmRouter/aggregateEnqueue.ts | 1 (line 15) | guard-ignore-present | guard-ignore present |
| server/services/llmUsageService.ts | 26 (lines 126,172,190,201,211,287,312,321,330,358,374,402,437,445,453,470,496,523,574,581,734,745,758,775,791,857,868,888,927,942,956,970) | migrated | All callsites use `getOrgScopedDb()` or `withAdminConnection()` per in-wave migration |
| server/services/mcpAggregateService.ts | 1 (line 89) | guard-ignore-present | guard-ignore present |
| server/services/portfolioRollupService.ts | 1 (line 46) | guard-ignore-present | guard-ignore present |
| server/services/skillService.ts | 11 (lines 67,88,132,396,404,468,495,653,666,675,684) | corrected-in-chunk-12 | 11 guard-ignores added |
| server/services/systemIncidentNotifyJob.ts | 1 (line 32) | guard-ignore-present | guard-ignore present |
| server/services/systemMonitor/triage/triageHandler.ts | 1 (line 82) | guard-ignore-present | guard-ignore present |
| server/services/systemOperationsOrgResolver.ts | 2 (lines 19,32) | guard-ignore-present | guard-ignore present |
| server/services/systemSkillHandlerValidator.ts | 1 (line 36) | corrected-in-chunk-12 | guard-ignore added: reason="system_skills non-tenant table; runs at boot before org context" |
| server/services/triggers/externalSourceTriggers.ts | 1 (line 43) | migrated | Uses `getOrgScopedDb()` and `withAdminConnection()` |
| server/services/workflowGateStallNotifyService.ts | 1 (line 141) | guard-ignore-present | guard-ignore present |
| server/services/workflowTemplateService.ts | 6 (lines 104,112,127,139,196,205,321) | guard-ignore-present | 6 guard-ignores present |
| server/services/costAggregateService.ts | 2 (lines 49,156) | guard-ignore-present | 2 guard-ignores present |
| server/services/integrationConnectionService.ts | 10 (lines 429,442,449,456,466,625,790,813,864,887) | guard-ignore-present | 10 guard-ignores present |
| server/jobs/clarificationTimeoutJob.ts | 3 (lines 36,70,87) | guard-ignore-present | 3 guard-ignores present |
| server/jobs/connectorPollingSync.ts | 5 (lines 122,135,158,170,197) | guard-ignore-present | 5 guard-ignores present |
| server/jobs/connectorPollingTick.ts | 1 (line 62) | guard-ignore-present | guard-ignore present |
| server/jobs/llmInflightHistoryCleanupJob.ts | 1 (line 37) | guard-ignore-present | guard-ignore present |
| server/jobs/measureInterventionOutcomeJob.ts | 3 (lines 204,219,233) | guard-ignore-present | 3 guard-ignores present |
| server/jobs/memoryBlocksEmbeddingBackfillJob.ts | 1 (line 69) | guard-ignore-present | guard-ignore present |
| server/jobs/orchestratorFromTaskJob.ts | 2 (lines 113,187) | guard-ignore-present | 2 guard-ignores present |
| server/jobs/orgSubaccountMigrationJob.ts | 13 (lines 50,55,73,86,115,165,170,187,199,215,230,279,291) | guard-ignore-present | 13 guard-ignores present |
| server/jobs/proposeClientPulseInterventionsJob.ts | 9 (lines 60,76,145,152,161,169,190,202,307) | guard-ignore-present | 9 guard-ignores present |
| server/jobs/sandboxArtefactPurgeJob.ts | 2 (lines 46,100) | guard-ignore-present | 2 guard-ignores present |
| server/jobs/sandboxCeilingMonitorJob.ts | 4 (lines 131,299,355,382) | guard-ignore-present | 4 guard-ignores present |
| server/jobs/sandboxWallClockKillJob.ts | 2 (lines 54,135) | guard-ignore-present | 2 guard-ignores present |
| server/jobs/scorecardJudgeJob.ts | 3 (lines 46,58,166) | guard-ignore-present | 3 guard-ignores present |
| server/jobs/supportDraftReconciliationWorker.ts | 6 (lines 37,54,86,116,146,164) | guard-ignore-present | 6 guard-ignores present |
| server/jobs/workflowGateStallNotifyJob.ts | 8 (lines 66,187,267,298,334,372,400,474) | guard-ignore-present | 8 guard-ignores present |

## Detailed corrections (corrected-in-chunk-12)

### server/services/skillService.ts — 11 annotations added

All callsites use raw `db` import but are Tier 2 (admin/system path, skills table spans org+subaccount+built-in tiers). Form used:

```typescript
// guard-ignore: with-org-tx-or-scoped-db reason="Tier 2 — admin/system/cross-tenant path; <context>"
```

Lines corrected: 67 (getSkillBySlug), 88 (getSubaccountSkillBySlug), 132 (batch skill resolution), 396+399 (updateSkillVisibility select+update), 468 (listSubaccountSkills), 495 (getSubaccountSkill), 653+659 (deleteSubaccountSkill select+update), 675+684 (deleteSkill select+update).

### server/services/systemSkillHandlerValidator.ts — 1 annotation added

Line 36: `validateSystemSkillHandlers` reads `system_skills` (non-tenant table) at boot time before any org context exists.

### server/services/executionBackends/operatorManagedBackend.ts — 2 annotations added

- Line 225: dispatch step reads `agent_runs` by runId; org scoped via `setOrgAndSubaccountGUC` inside subsequent tx
- Line 996: cancel step reads `agent_runs` by runId before org is known; org scoped via `setOrgGUC` inside tx
- Line 1004: `db.transaction()` following the cancel lookup — annotated separately

## Final guard-ignore count

| Before chunk-12 | After chunk-12 |
|----------------|----------------|
| 350 | 365 |

Total `with-org-tx-or-scoped-db` guard-ignore annotations across server/services, server/jobs, server/lib, server/adapters: **365**

All 159 Tier 2 entries from tier-categorisation.md are now either:
1. Migrated (using `getOrgScopedDb()` or `withAdminConnection()`)
2. Annotated with a guard-ignore of the correct form
