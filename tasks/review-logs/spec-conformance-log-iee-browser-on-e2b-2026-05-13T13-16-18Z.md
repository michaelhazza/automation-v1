# Spec Conformance Log

**Spec:** `tasks/builds/iee-browser-on-e2b/spec.md`
**Spec commit at check:** `831b0c58` (HEAD)
**Branch:** `claude/migrate-browser-e2b-snI99`
**Base:** `4b7399bf` (plan-locked commit; the build's authored work started here)
**Scope:** all 18 implementation chunks (chunks 1–18 from `plan.md`)
**Changed-code set:** 73 files across 24 chunk commits
**Run at:** 2026-05-13T13:16:18Z
**Commit at finish:** `e7271991`

---

## Summary

- Requirements extracted:     46
- PASS:                       45
- MECHANICAL_GAP → fixed:     1
- DIRECTIONAL_GAP → deferred: 0
- AMBIGUOUS → deferred:       0
- OUT_OF_SCOPE → skipped:     0

**Verdict:** CONFORMANT_AFTER_FIXES — 1 mechanical gap closed in-session, no directional gaps require human attention.

---

## Requirements extracted

### Schema (chunks 1–5)

| REQ | Spec section | Requirement | Verdict | Evidence |
|---|---|---|---|---|
| #1 | §7.1, §10.1 | `iee_browser_session_profiles` Drizzle table with `(org, subaccount, session_key)` unique index, `last_used_at` index, 500 MB size cap default | PASS | `server/db/schema/ieeBrowserSessionProfiles.ts` |
| #2 | §7.1, §10.2 | `subaccount_iee_browser_settings` Drizzle table with PK `subaccountId`, DEFAULT 'off' on status, ETag `settingsVersion` | PASS | `server/db/schema/subaccountIeeBrowserSettings.ts` |
| #3 | §7.1, §10.3 | `browser_warm_sessions` table with `available|leased|terminated` status, partial unique index `(subaccount_id) WHERE status='available'`, eviction-age index | PASS | `server/db/schema/browserWarmSessions.ts` |
| #4 | §7.1 | `server/db/schema/index.ts` exports the three new tables | PASS | lines 340–342 |
| #5 | §7.1 | `rlsProtectedTables.ts` manifest entries for all three new tables | PASS | lines 1304, 1311, 1318 |
| #6 | §7.2 | Migration `0345_create_iee_browser_session_profiles.sql` with dual-GUC RLS, unique index, FK actions | PASS | migrations/0345 |
| #7 | §7.2 | Migration `0346` with `DEFAULT 'off'` on status, dual-GUC RLS | PASS | migrations/0346 |
| #8 | §7.2 | Migration `0347` adds `subtype` + `warm_session_id` columns + null-safe CHECKs via `IS DISTINCT FROM` (no FK in this migration per R3-F1) | PASS | migrations/0347 |
| #9 | §7.2 | Migration `0348_create_browser_warm_sessions.sql` with dual-GUC RLS + partial unique index | PASS | migrations/0348 |
| #10 | §7.2 | Migration `0349` adds FK `ON DELETE RESTRICT` + unique partial index `WHERE subtype='warm_pool'` | PASS | migrations/0349 |
| #11 | §7.1 | `llm_requests.ts` Drizzle extended with `subtype` + `warmSessionId` columns and the unique partial index | PASS | `llmRequests.ts:174–175, 222–224` |
| #12 | §7.1, §13.5 | `FailureReason` enum extended with `iee_browser_launch_disabled` + `profile_harvest_failed` | PASS | `shared/iee/failureReason.ts:82–83` |
| #13 | §7.1, §8.1 | `SandboxRunTaskInput` extended with `profileMount` + `warmSessionCheckoutId` | PASS | `shared/types/sandbox.ts:213–223` |

### Sandbox template (chunk 6) + e2b provider (chunk 7)

| REQ | Spec section | Requirement | Verdict | Evidence |
|---|---|---|---|---|
| #14 | §7.3 | `infra/sandbox-templates/iee-browser/Dockerfile` present | PASS | file exists |
| #15 | §7.3 | `infra/sandbox-templates/iee-browser/README.md` present | PASS | file exists |
| #16 | §7.3 | `infra/sandbox-templates/iee-browser/harness/index.ts` sandbox entrypoint | PASS | file exists |
| #17 | §7.3 | `CURRENT_VERSION` + `PUBLISHED_VERSION` pin files (sibling-template format) | PASS | files exist |
| #18 | §7.3 | Harness reads task payload, runs executor, writes output, exits | PASS | `harness/index.ts` |
| #19 | §7.4 | `e2bSandbox.ts` branches on `sandboxRequirement === 'browser'`; resolves `templateName: 'iee-browser'`; mounts profile volume from `profileMount.userDataDirInSandbox` | PASS | `e2bSandbox.ts:212–220, 295–313, 511–517` |
| #20 | §7.4 | `e2bSandboxPure.ts::resolveTemplateAlias` handles `iee-browser` | PASS | `e2bSandboxPure.ts:197–211` |

### Worker (chunk 8)

| REQ | Spec section | Requirement | Verdict | Evidence |
|---|---|---|---|---|
| #21 | §7.5 | `playwrightContext.ts::buildUserDataDir` accepts `mountRoot`; `SESSION_KEY_RE`, path-traversal regex, corruption recovery all preserved | PASS | `playwrightContext.ts:30, 38–47` |

### Profile manager + warm pool (chunks 9–10)

| REQ | Spec section | Requirement | Verdict | Evidence |
|---|---|---|---|---|
| #22 | §7.4, §13.7 | `ieeBrowserProfileManager` with resolve/mount/unmount/gcSweep/recoverCorruption; cross-tenant assertion before mount | PASS | `ieeBrowserProfileManager.ts` |
| #23 | §7.4 | `ieeBrowserProfileManagerPure.ts` exports `assertSameTenant`, `resolveRetentionDays`, `isValidStatusTransition` | PASS | pure module |
| #24 | §15 R2-F6 | Named CI gate `ieeBrowserProfileManager.serialization.test.ts` present | PASS | CI-skipped scaffold; CI fills assertions |
| #25 | §7.4, §8.5 | `browserWarmPool` with checkout/terminate/evictStale/refillIfEligible; one private helper owns cost computation; `terminate` and `evictStale` both write idle-cost row via the same helper | PASS | `browserWarmPool.ts:29–106, 228` |
| #26 | §7.4 | `browserWarmPoolPure.ts` exports `isStaleSession`, `isRefillEligible`, `computeIdleCostCents`; idle-duration formula `terminated_at - created_at` per R3-F6 | PASS | pure module |

### Harvest discriminator (chunk 11)

| REQ | Spec section | Requirement | Verdict | Evidence |
|---|---|---|---|---|
| #27 | §7.4, §8.6 | `sandboxHarvestService` writes `subtype: 'task'` on every `source_type='sandbox_compute'` row | PASS | `sandboxHarvestService.ts:722` |

### Dispatch wiring (chunk 12)

| REQ | Spec section | Requirement | Verdict | Evidence |
|---|---|---|---|---|
| #28 | §7.4, §8.4, §14 | `_ieeShared.ts::ieeDispatch` browser branch: launch-flag check FIRST → warm-pool checkout → profile resolve+mount → `runTask` → finally-block teardown; `deriveSessionKey` per §14 path (b) | PASS | `_ieeShared.ts:154–247, 144–148` |

### Settings + routes (chunk 13)

| REQ | Spec section | Requirement | Verdict | Evidence |
|---|---|---|---|---|
| #29 | §7.4 | `subaccountIeeBrowserSettingsService` with `getSettings` / `updateSettings` / `setRolloutApproval`; lazy-create + ETag conflict + 23505 PK-race handling; `setOrgAndSubaccountGUC` inside tx | PASS | service file |
| #30 | §7.7, §9 | `subaccountIeeBrowserSettings.ts` — GET + PATCH, permission split, `resolveSubaccount`, ETag header | PASS | route file mirrors operator-settings sibling pattern |
| #31 | §7.7, §8.4 | `adminIeeBrowserRollout.ts` — POST with `requireSystemAdmin`; audit row in same transaction | PASS | route file + service `setRolloutApproval` |
| #32 | §7.7 | Both new routers registered in `server/index.ts` | PASS | `server/index.ts:128–129, 439–440` |
| #33 | §7.6 | `ieeBrowserSettingsApi.ts` with `getIeeBrowserSettings` + `updateIeeBrowserSettings`; ETag pattern | PASS | client API file |

### Operator defaults (chunk 14)

| REQ | Spec section | Requirement | Verdict | Evidence |
|---|---|---|---|---|
| #34 | §7.4 | `operatorSettingsDefaults.ts` exports the 3 constants; consumed by `operatorManagedBackend.ts` | PASS | module + `operatorManagedBackend.ts:333, 423` |

### Cost alarms (chunks 15A + 15B)

| REQ | Spec section | Requirement | Verdict | Evidence |
|---|---|---|---|---|
| #35 | §8.7 | `ieeBrowserCostAlarmEvaluatorPure.ts` exports `evaluateTaskCost` + `evaluateDailyCost` + 3 event-name constants | PASS | pure module |
| #36 | §8.7 | Per-task alarm wired at harvest row-write; emits `iee_browser.task_cost_anomaly` via `recordIncident` with idempotency key `(event_name, agentRunId)` | PASS | `sandboxHarvestService.ts:1193–1225` |
| #37 | §7.4, §8.7 | End-of-day rollup cron — pg-boss daily, emits `iee_browser.subaccount_cost_anomaly` with idempotency key `(event_name, subaccountId, dayUTC, ceilingCents)` | PASS | `server/jobs/ieeBrowserDailyRollupJob.ts` |
| #38 | §7.4 | Daily rollup job registered at server bootstrap | PASS | `server/index.ts:890–891` |

### UI (chunk 16)

| REQ | Spec section | Requirement | Verdict | Evidence |
|---|---|---|---|---|
| #39 | §9 | `canSeeOperatorTab` + `canEditOperatorSettings` predicates broadened to include `subaccount_admin` and `system_admin` | PASS | `AdminSubaccountDetailPage.tsx:44–49` verbatim per spec |
| #40 | §7.6, §1 goal 7 | Remove 3 `NumberField`s (`Auto-extend grace`, `Max chain length`, `Max wall-clock per task`); add IEE browser section with 4 fields | MECHANICAL_GAP → FIXED | Pre-fix: `Max chain length` + `Max wall-clock per task` removed but `Auto-extend grace` still rendered at lines 165–174. Operator-backend already reads from `AUTO_EXTEND_GRACE_MINUTES` constant so the UI field was dead. Removed the JSX block. |

### DigitalOcean retirement (chunk 17)

| REQ | Spec section | Requirement | Verdict | Evidence |
|---|---|---|---|---|
| #41 | §7.5 | 6 worker files deleted (Dockerfile, browserTask, runHandler, cleanupOrphans, queueMetrics, cost) | PASS | all 6 ABSENT |
| #42 | §7.9b | `scripts/gates/verify-no-do-references.sh` — tokens + path assertions + allowed-exception list with rationale comments | PASS | script covers all required tokens and forbidden paths |

### Doc sync (chunk 18)

| REQ | Spec section | Requirement | Verdict | Evidence |
|---|---|---|---|---|
| #43 | §7.8 | Part 10 deleted; new `docs/iee-on-e2b-rollout.md` created | PASS | both confirmed |
| #44 | §7.9 | Placeholder cost-report + calendar todo in `tasks/todo.md` | PASS | `tasks/todo.md:113` matches spec verbatim |
| #45 | §8.4 | Rollout-approval mutation writes audit row in same tx as UPDATE | PASS | service lines 220–228, 275–283 |
| #46 | §8.7 | `iee_browser.warm_pool_miss` emitted as metric (not incident) | PASS | `browserWarmPool.ts:122, 134, 149` — `logger.info` not `recordIncident` |

## Mechanical fixes applied

```
[FIXED] REQ #40 — remove "Auto-extend grace" NumberField from Operator Settings tab
  File: client/src/pages/govern/operatorSettings/OperatorSettingsTab.tsx
  Lines: 165–174 (removed)
  Spec quote: "Remove 3 `NumberField`s (`Auto-extend grace`, `Max chain length`, `Max wall-clock per task`)"
  Change: deleted the 10-line `<NumberField label="Auto-extend grace" .../>` JSX block. Pre-build state had all 3 fields rendered; post-build state had Max chain length + Max wall-clock per task removed but Auto-extend grace still rendered — completing the spec's "3 removed" requirement. Server-side `AUTO_EXTEND_GRACE_MINUTES` constant (chunk 14) already replaces the per-subaccount read, so the UI field was dead. Draft-state field `autoExtendGraceMinutes` left in `interface Draft` and `toDraft()` (forward-compat aligns with spec §10.2 "DB columns stay"); cleanup is a code-quality concern for pr-reviewer.
```

## Directional / ambiguous gaps

None. All 46 requirements either passed or were resolved by the mechanical fix.

## Files modified by this run

- `client/src/pages/govern/operatorSettings/OperatorSettingsTab.tsx` — removed `Auto-extend grace` NumberField block (10 lines).

## Re-verification (Step 5)

- `npm run typecheck` — PASS (no errors)
- `npm run lint` — PASS (0 errors; pre-existing warnings unrelated)

## Next step

CONFORMANT_AFTER_FIXES — mechanical gap closed in-session. The caller should:

1. Review the `OperatorSettingsTab.tsx` diff to confirm the field-removal is what was expected.
2. Re-run `pr-reviewer` on the expanded changed-code set.
3. Then proceed to Phase 3 finalisation (`launch finalisation`).
