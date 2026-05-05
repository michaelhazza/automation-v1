# H1 Phase 1 — Derived-Data Null-Safety Call-Site Inventory

**Generated:** 2026-04-26
**Scope:** Four background job output domains per spec §H1 Phase 1 scope lock.

---

## Scan command

```bash
grep -rn "bundleUtilization\|interventionOutcome\|ruleAutoDeprecat\|connectorPollingSync" server/ --include="*.ts" | grep -v __tests__
```

---

## bundleUtilizationJob outputs

Field written: `document_bundles.utilizationByModelFamily` (JSONB, nullable — job hasn't run yet on new bundles)

| File | Line | Classification | Reason |
|------|------|---------------|--------|
| `server/db/schema/documentBundles.ts` | 32 | out-of-scope | Schema definition, not a consumer |
| `server/jobs/bundleUtilizationJob.ts` | 53, 114, 125 | out-of-scope | The job itself — the writer |
| `server/routes/documentBundles.ts` | 142 | in-scope-Phase-1 | Consumer reads `utilizationByModelFamily` — already safe: `result.bundle.utilizationByModelFamily ?? null` |
| `server/services/queueService.ts` | 851 | out-of-scope | Dynamic import of the job — not a field consumer |

**Violations found: 0** — The single consumer already uses `?? null`. No refactor needed.

---

## measureInterventionOutcomeJob outputs

Table written: `intervention_outcomes` (rows may not exist for an account/org before job has run)

| File | Line | Classification | Reason |
|------|------|---------------|--------|
| `server/db/schema/interventionOutcomes.ts` | — | out-of-scope | Schema definition |
| `server/db/schema/index.ts` | 101 | out-of-scope | Re-export |
| `server/jobs/measureInterventionOutcomeJob.ts` | — | out-of-scope | The job itself — the writer |
| `server/services/clientPulseInterventionContextService.ts` | 226–236 | in-scope-Phase-1 | Queries `intervention_outcomes`; aggregates into in-memory Map; empty result = empty array returned — already safe. No null assertions. |
| `server/services/drilldownService.ts` | 271–302 | in-scope-Phase-1 | LEFT JOIN on `intervention_outcomes`; `r.outcome` checked with ternary before access — already safe. No null assertions. |
| `server/services/interventionService.ts` | 26–33 | in-scope-Phase-1 | Queries `intervention_outcomes` for cooldown; `[recent]` may be undefined; wrapped in `if (recent) {...}` — already safe. |
| `server/services/interventionService.ts` | 87–104 | out-of-scope | Inserts into `intervention_outcomes` — the writer path, not a derived-data read |
| `server/services/queueService.ts` | 613 | out-of-scope | Dynamic import of the job — not a field consumer |

**Violations found: 0** — All consumers handle null/missing rows gracefully. No refactor needed.

---

## ruleAutoDeprecateJob outputs

Fields written: `memory_blocks.qualityScore`, `memory_blocks.deprecatedAt` (via `applyBlockQualityDecay`)

| File | Line | Classification | Reason |
|------|------|---------------|--------|
| `server/jobs/ruleAutoDeprecateJob.ts` | — | out-of-scope | The job itself — orchestrator |
| `server/services/memoryEntryQualityService.ts` | 319–381 | out-of-scope | `applyBlockQualityDecay` — the writer function |
| `server/services/queueService.ts` | 613 | out-of-scope | Dynamic import of the job — not a field consumer |

**Note:** No downstream consumer service reads `memory_blocks.qualityScore` or `deprecatedAt` as a derived-data dependency in a way that assumes the job has run. The job writes scores on blocks that pre-exist in the table; the blocks themselves are the primary entity. No in-scope consumers found.

**Violations found: 0**

---

## connectorPollingSync outputs

Fields written: `integration_connections.lastSuccessfulSyncAt`, `lastSyncError`, `lastSyncErrorAt`, `syncLockToken`

| File | Line | Classification | Reason |
|------|------|---------------|--------|
| `server/jobs/connectorPollingSync.ts` | — | out-of-scope | The job itself |
| `server/services/connectorPollingService.ts` | — | out-of-scope | Named export consumed by the job, not a derived-data consumer |
| `server/services/connectorPollingSchedulerPure.ts` | 15–16 | in-scope-Phase-1 | Reads `lastSuccessfulSyncAt`; `if (!c.lastSuccessfulSyncAt) return true;` — already safe. |
| `server/services/workspaceHealth/detectors/staleConnectorDetector.ts` | 42–44, 78–80 | in-scope-Phase-1 | Fetches and passes `lastSuccessfulSyncAt`, `lastSyncError`, `lastSyncErrorAt` to pure function — fields are typed nullable |
| `server/services/workspaceHealth/detectors/staleConnectorDetectorPure.ts` | 38, 46, 49–51 | in-scope-Phase-1 | Pure function; `if (!connection.lastSuccessfulSyncAt)` branch handles null — already safe |
| `server/jobs/connectorPollingTick.ts` | 33 | in-scope-Phase-1 | Reads `lastSuccessfulSyncAt` and passes to scheduler pure function — typed as `Date \| null` |
| `server/services/queueService.ts` | 1179 | out-of-scope | Dynamic import of the job — not a field consumer |

**Violations found: 0** — All consumers handle null correctly. Fields are typed nullable throughout. No refactor needed.

---

## Summary

| Domain | In-scope consumers found | Violations | Refactors needed |
|--------|--------------------------|------------|------------------|
| bundleUtilizationJob | 1 | 0 | 0 |
| measureInterventionOutcomeJob | 3 | 0 | 0 |
| ruleAutoDeprecateJob | 0 | 0 | 0 |
| connectorPollingSync | 3 | 0 | 0 |
| **Total** | **7** | **0** | **0** |

All in-scope read sites already handle null/missing derived data gracefully. No code refactors are required in Phase 1. The `logDataDependencyMissing` helper is authored and the advisory gate ships to enforce the rule for future call sites.

**Pattern B chosen** (≤ 5 in-scope call sites per domain, all low-volume paths): first-occurrence WARN, subsequent DEBUG via in-memory `Set<string>`.

---

## Adjacent sites deliberately not touched (out of Phase 1 scope)

- Pulse-derived metrics (churn assessments, health snapshots) — read sites exist but these are not outputs of the four named jobs
- Agent-run-snapshot enrichment — out of Phase 1 scope per spec §H1 scope-lock
- Generic rollup tables — out of Phase 1 scope
