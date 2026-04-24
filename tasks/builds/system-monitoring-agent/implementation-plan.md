# System Monitoring Agent — Phase 0 + 0.5 Implementation Plan

**Spec:** `tasks/builds/system-monitoring-agent/phase-0-spec.md` (v4, 2000+ lines, implementation-ready).
**Branch:** `claude/system-monitoring-agent-PXNGy`.
**Target:** single cohesive PR covering Phase 0 ingestion + Phase 0.5 admin UI + in-app notifications.
**Out of scope for this PR:** Phase 0.75 (email/Slack push), Phase 1+.

This plan is a build contract, not a re-review. Where the spec is concrete (schema, fingerprint algorithm, event-type enum, subtitle shape, guardrail thresholds), this plan references the section rather than restating. Where the spec leaves sequencing, file-level scope, or rollout ordering as architect decisions, this plan makes the call.

---

## Table of contents

0. Concerns for user decision (read first)
1. Build order (commits, ordering, parallelisation)
2. File-by-file specification
3. Integration-point sequencing (the 7 ingest surfaces)
4. Bug-risk heatmap
5. Test sequencing
6. Prerequisite migrations
7. Open structural concerns
8. What NOT to build on first pass (stub + TODO)
9. Ready to build when

---

<!-- Sections appended via Edit in chunked workflow. -->

## 0. Concerns for user decision (read first)

None of these are blocking. They are places where the spec's v4 decisions are defensible but a small upstream choice would simplify the build. Flag them; proceed with spec defaults if no change requested.

1. **Pulse `distinct_org_count` aggregation with system-level incidents.** Spec §10.1 treats `organisation_id IS NULL` as a single "system" bucket in `COUNT(DISTINCT organisation_id)`. Postgres `COUNT(DISTINCT col)` ignores NULLs — so system-level incidents count as 0 toward `distinctOrgCount`, not 1. Implementation either needs `COUNT(DISTINCT COALESCE(organisation_id::text, 'system'))` or an explicit `+1` when the group includes at least one NULL row. Call-out: confirm the spec's intended behaviour matches the `COALESCE` path.

2. **Global error handler + `asyncHandler` double-capture.** §6.1 adds `recordIncident` to `server/index.ts:343–385`, and §6.2 adds `recordIncident` to `asyncHandler`'s `unhandled_route_error` path. In the current code, most route errors flow through asyncHandler before reaching the global handler. Without a de-duplication marker on the error object, a single route error risks writing two `occurrence` events (same fingerprint → dedupes to 1 incident row but 2 event rows, and the `occurrence_count` increments twice). Recommendation: attach `err.__incidentRecorded = true` in the first ingest site and short-circuit in the second. Confirm this is acceptable as a surgical addition.

3. **`previous_task_ids[]` array unbounded growth.** §10.2.5 caps `escalation_count` at 3, which implicitly caps `previous_task_ids[]` at 3 entries within the current incident lifecycle. But the partial unique index on `fingerprint` means a resolved incident allows a new incident row on recurrence — the new row starts with `previous_task_ids = '{}'`. So the array cannot grow past 3 per row. No action needed; called out here to close the loop on the prompt's concern.

4. **`SYSTEM_INCIDENT_INGEST_MODE=async` at ship time.** Spec defaults to `sync`. The toggle is pre-wired, but the async worker path (`system-monitor-ingest` queue) ships cold — it is registered, the handler exists, but it is not exercised by traffic unless someone flips the env var. Recommendation: in staging, flip it on for 24 hours as part of §13.3 rollout so the async path is not dormant code discovered first during a real latency incident. Confirm.

5. **System Operations org seeding timing.** §10.3 seeds `System Operations` org + sentinel subaccount via migration. If the migration runs on a database where an org-listing query returns it before the `is_system_org = false` filter lands (ordering bug during rollout), non-sysadmin users see a mystery org in their dropdown for the interval between the two migrations. Mitigation: combine the column-add + the filter-service patch + the seed-row into **one** migration + service change landing in the same commit. Spec §11.2 already lists the filter change; this plan enforces the combined-commit ordering (see §1).

Proceed with spec defaults on all five unless you override.

---

## 1. Build order

Spec §13.2 lists 13 commits. The ordering below refines §13.2 by (a) co-locating commits that share risk, (b) calling out parallelisation opportunities, and (c) surfacing rollback-risk hotspots.

### 1.1 Refined commit order

| # | Commit | Lands in | Prerequisite | Parallelisable with |
|---|---|---|---|---|
| 1 | Prereq mini-migrations (P1 `agent_runs.correlation_id`, P4 `tasks.linked_entity_kind/id`, §10.3 `organisations.is_system_org` + partial unique index) | — | none | — |
| 2 | Core schema + indexes + RLS manifest entry documenting Option A | commit 1 | commit 1 | — |
| 3 | System Operations org + sentinel subaccount **seed migration** AND the `is_system_org` visibility filter on every org-listing service (spec §10.3, §11.2 row 9) AND the non-sysadmin regression test | commit 2 | commit 1 | — |
| 4 | `incidentIngestor` + `incidentIngestorPure` + unit tests + sync/async toggle + self-source bypass helper | commit 2 | — | 5, 6 (different files) |
| 5 | `systemIncidentService` + `systemIncidents.ts` route file + permissions constants + audit-event hooks | commit 2 | — | 4, 6 |
| 6 | `AlertFatigueGuardBase` extraction + Portfolio Health regression test (behaviour-preserving) | none | — | 4, 5 |
| 7 | Ingestion **integration points** — landed as individual commits, ordering matters (§3 below) | 4, 6 | 4, 6 | within-group but order-sensitive |
| 8 | `systemIncidentNotifyJob` + WebSocket `system_incident:updated` emitter + client `useSocket` subscribe | 4, 5 | commit 4 | 9 |
| 9 | `systemMonitorSelfCheckJob` — 5-minute cron, threshold + cooldown | 4 | commit 4 | 8 |
| 10 | Admin page + drawer + modals + test-incident trigger route | 5, 8 | commits 5, 8 | 11 |
| 11 | Pulse `system_incident` kind + getter + Layout nav badge | 5, 8 | commits 5, 8 | 10 |
| 12 | Manual-escalate-to-agent service method + route wiring + task creation shape | 3, 5, 10 | commits 3, 5, 10 | — |
| 13 | `architecture.md` + `docs/capabilities.md` updates (CLAUDE.md §11) | all | — | — |

### 1.2 Why commit 3 is merged from spec §13.2's commits 1 + 12

Spec §13.2 lists the System Operations seed as part of commit 1 (prereq) and the org-listing filter as commit 12. This plan **collapses the seed + filter into a single commit** landing immediately after the schema commit. Reason: the visibility leak window (org row seeded but filter not yet deployed) is a correctness hazard. Two-commit split gives an interval where any deploy of the midpoint silently exposes the system org to every non-sysadmin user. One-commit atomic landing eliminates the window at zero cost to reviewability.

### 1.3 Highest rollback risk

Ranked by blast radius of a subtle regression slipping through:

1. **Commit 6 — `AlertFatigueGuardBase` refactor.** Risk: byte-for-byte behaviour change silently regresses Portfolio Health Agent's alert fatigue logic. Mitigation: regression test in same commit that reuses existing AlertFatigueGuard tests against the refactored base. Do not merge without the test.
2. **Commit 7c — agent run terminal-failed integration point** (§6.4). Risk: this is the highest-volume ingest path; a bug here fires into every failed agent run. Mitigation: canary behind `SYSTEM_INCIDENT_INGEST_ENABLED=false` in the first staging deploy; flip on after 24h of other integration points running cleanly.
3. **Commit 12 — manual escalate + System Operations wiring.** Risk: task-creation path is load-bearing; an incorrect task shape breaks escalate-to-agent silently. Mitigation: route integration test that actually invokes `taskService.createTask` against a test DB and asserts shape, per §7.2 contract.

### 1.4 Parallelisation plan

Optimal ordering if two developers are available:

- **Dev A** (critical path): commits 1 → 2 → 3 → 4 → 7a → 7b → 7c → 7d → 7e → 7f.
- **Dev B** (parallel from commit 4 ready): commits 5 → 6 → 8 → 9 → 10 → 11 → 12 → 13.

Single-developer ordering: strictly 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13.

### 1.5 Splits and combines vs spec §13.2

- **Merged:** spec commits 1 + 12 → plan commits 1, 3 (see §1.2).
- **Split:** spec commit 4 ("integration points") → plan commit 7a–7f per §3.
- **Unchanged:** everything else.

---

## 2. File-by-file specification

Every file touched by this PR, with commit assignment, purpose, size estimate, and what to stub vs fully implement on first pass.

### 2.1 Migrations (commit 1, 2, 3)

| File | Purpose | Commit | Size | First-pass scope |
|---|---|---|---|---|
| `migrations/NNNN_prereq_correlation_linked_entity_system_org.sql` | P1: `agent_runs.correlation_id text`. P4: `tasks.linked_entity_kind text`, `tasks.linked_entity_id uuid`. §10.3: `organisations.is_system_org boolean NOT NULL DEFAULT false` + partial unique index `UNIQUE(is_system_org) WHERE is_system_org = true`. | 1 | small | Full |
| `migrations/NNNN_system_incidents.sql` | Three tables per §4.1–§4.3 with full column set, including `is_test_incident`, `escalation_count`, `previous_task_ids[]`, `suppressed_count`, `last_suppressed_at`. All indexes from §4. No RLS policies (Option A per §7.4). | 2 | medium | Full |
| `migrations/NNNN_seed_system_operations_org.sql` | Idempotent `INSERT ... ON CONFLICT DO NOTHING` that seeds one `organisations` row with `is_system_org = true`, slug `system-ops`, plus one sentinel `subaccounts` row. Derives IDs deterministically or reads back post-insert. | 3 | small | Full |
| `migrations/NNNN_*.down.sql` files for each of the above | Forward-only runner per architecture.md §Migrations, but each migration ships a `*.down.sql` for local revert. | 1, 2, 3 | small | Full |

Migration numbers: confirm at write time via `ls migrations/ | sort -n | tail -5` — next free slot at time of spec was 0223+. If a later branch has landed, this plan stays correct with the newer number.

### 2.2 Schema re-exports (commit 2)

| File | Change | Commit | Size |
|---|---|---|---|
| `server/db/schema/systemIncidents.ts` | New — full Drizzle table definition per §4.1 | 2 | medium |
| `server/db/schema/systemIncidentEvents.ts` | New — §4.2 | 2 | small |
| `server/db/schema/systemIncidentSuppressions.ts` | New — §4.3 | 2 | small |
| `server/db/schema/index.ts` | Re-export the three new files | 2 | 1-line edit |
| `server/db/schema/agentRuns.ts` | Add `correlationId text` nullable column | 1 | 1-line edit |
| `server/db/schema/tasks.ts` | Add `linkedEntityKind text`, `linkedEntityId uuid` nullable columns | 1 | 2-line edit |
| `server/db/schema/organisations.ts` | Add `isSystemOrg boolean` + partial unique index | 1 | 2-line edit |
| `server/config/rlsProtectedTables.ts` | Documentation comment — NOT adding the three new tables (explicit Option A per §7.4). Add a comment block stating the decision + link back to spec §7.4. | 2 | 3-line comment |

### 2.3 Ingestor + pure helpers (commit 4)

| File | Purpose | Commit | Size | Notes |
|---|---|---|---|---|
| `server/services/incidentIngestor.ts` | Public `recordIncident(input)` — async, fire-and-forget, try/catch-wrapped. Contains `ingestInline` (shared sync+async code path), the sync/async mode toggle getter, the top-level kill-switch guard, the fingerprint-override validator (regex `^[a-z_]+:[a-z0-9_.-]+(:[a-z0-9_.-]+)+$`), and the `__resetForTest()` hook per §6.10. | 4 | medium (250–350 lines) | Ship with sync mode default + async path fully implemented. Async worker (see queueService wiring) lives in a separate file (see below). |
| `server/services/incidentIngestorPure.ts` | Pure helpers: `computeFingerprint`, `hashFingerprint`, `normaliseMessage`, `topFrameSignature`, `classify`, `inferDefaultSeverity`, `validateFingerprintOverride`. No DB access, no logger import. | 4 | medium | Full. Every helper gets a pure test. |
| `server/services/__tests__/incidentIngestorPure.test.ts` | Pure tests — fingerprint determinism across UUID/timestamp/number stripping, topFrame selection across ingestor/logger noise, classification matrix, severity default matrix, override-validator pass/reject cases. Target: ~50 test cases. | 4 | large | Full |
| `server/services/__tests__/incidentIngestorIntegration.test.ts` | DB-backed: upsert increments, partial unique index enforcement, resolved→new-row semantics, severity-never-de-escalates, suppression short-circuit, self-source bypass, concurrent-ingests serialise correctly. | 4 | large | Full — critical for correctness. |
| `server/services/incidentIngestorAsyncWorker.ts` | Handler registered on `system-monitor-ingest` queue. Deserialises payload + calls `ingestInline`. Idempotency not required at worker layer — dedupe already happens via fingerprint upsert. | 4 | small | Full. Registered in `server/jobs/index.ts`. |

### 2.4 Routes + service (commit 5)

| File | Purpose | Commit | Size | Notes |
|---|---|---|---|---|
| `server/routes/systemIncidents.ts` | Route file per §7.1 — 8 endpoints. Mirrors `server/routes/jobQueue.ts` pattern. Every route: `authenticate → requireSystemAdmin → asyncHandler(…)`. Body validation via Zod schemas (new `server/schemas/systemIncidents.ts` if none exist — follow `subaccountAgents.ts` precedent). | 5 | medium (~180 lines) | Full, including the test-incident trigger endpoint (landed in commit 5, wired into UI in commit 10). |
| `server/services/systemIncidentService.ts` | Service per §7.2 contract — 8 public methods. Every mutating method writes one `system_incident_events` row inside the same transaction. `escalateIncidentToAgent` is stubbed in this commit (returns `{ statusCode: 501, message: 'not yet implemented' }`) — filled in commit 12. `resolveIncident` includes the `resolution_linked_to_task` event per §7.2 / §4.2 when `escalatedTaskId IS NOT NULL`. | 5 | medium-large (~350 lines) | Full except escalate (stubbed). |
| `server/services/systemIncidentServicePure.ts` | Pure lifecycle state machine + guardrail computations — `canTransition(from, to)`, `computeEscalationVerdict(incident, now)`, `resolutionEventPayload(incident, user, note)`. | 5 | medium | Full |
| `server/services/__tests__/systemIncidentServicePure.test.ts` | Pure tests — valid/invalid lifecycle transitions, guardrail verdict matrix, resolution payload shape. | 5 | medium | Full |
| `server/routes/__tests__/systemIncidents.test.ts` | Integration — auth, filter behaviour, action endpoints, 409/429 guardrails. | 5 | large | Full for non-escalate endpoints; escalate tests added in commit 12. |
| `server/schemas/systemIncidents.ts` | Zod schemas for POST bodies (resolve, suppress, escalate) + query-param schema for list endpoint. | 5 | small | Full |
| `server/lib/permissions.ts` | Add `SYSTEM_PERMISSIONS.INCIDENT_*` group per §7.3. | 5 | 5-line edit | Full |

### 2.5 Fatigue guard refactor (commit 6)

| File | Change | Commit | Size | Notes |
|---|---|---|---|---|
| `server/services/alertFatigueGuardBase.ts` | New — abstract base class per §9.3. Contains `alertsThisRun`, abstract `queryTodayCount`, abstract `getLimits`, concrete `shouldDeliver(key, severity)`. | 6 | small-medium | Full |
| `server/services/alertFatigueGuard.ts` | Refactored — extends base; moves per-org `queryTodayCount` + limits into subclass. **Behaviour must be byte-for-byte preserved.** | 6 | medium | Full refactor |
| `server/services/systemIncidentFatigueGuard.ts` | New — subclass per §9.3, declared but not invoked in Phase 0.5. Exists so Phase 0.75 notification PR can import it without re-architecting. | 6 | small | Full |
| `server/services/__tests__/alertFatigueGuard.regression.test.ts` | New — asserts refactored guard produces identical output to pre-refactor snapshot for a golden-fixture input set. This is the safety net. | 6 | medium | Full — non-negotiable. |
| `server/services/__tests__/systemIncidentFatigueGuardPure.test.ts` | New — subclass-specific tests per §11.1 (per-fingerprint daily cap, critical bypass). | 6 | medium | Full |

### 2.6 Ingestion integration points (commit 7a–7f)

See §3 below for ordering rationale. Files touched per integration:

| Integration | File | Commit | Size |
|---|---|---|---|
| Global error handler + asyncHandler | `server/index.ts` (lines 343–385) | 7a | 10-line edit |
| Global error handler + asyncHandler | `server/lib/asyncHandler.ts` | 7a | 10-line edit |
| DLQ monitor | `server/services/dlqMonitorService.ts` (lines 24–45) | 7b | 10-line edit |
| Agent run terminal-failed | `server/services/agentExecutionService.ts` (search for `status: 'failed'`/`'timeout'` in finalisation path) | 7c | 15-line edit |
| Agent run terminal-failed | `server/services/agentRunFinalizationService.ts` (IEE path per architecture.md) — **double-check whether the IEE finalisation path needs its own recordIncident call; spec §6.4 only names `agentExecutionService.ts`** | 7c | 0 or 15-line edit depending on code read |
| Connector polling failures | `server/services/connectorPollingService.ts` (lines 43–80) | 7d | 15-line edit |
| Skill executor retry exhaustion | `server/services/skillExecutor.ts` (grep for non-retryable error emission in `executeWithRetry`) | 7e | 15-line edit |
| LLM router parse-failure + reconciliation | `server/services/llmRouter.ts` (parse-failure + reconciliation emission sites) | 7f | 15-line edit |

For each integration the change shape is identical: build an `IncidentInput` with the right `fingerprintOverride` per §5.2 table, call `recordIncident(…).catch(ingestErr => logger.error('incident_ingest_failed', {...}))`. No integration site ever throws or blocks on ingestor failure.

### 2.7 Notify job + WebSocket fan-out (commit 8)

| File | Purpose | Commit | Size |
|---|---|---|---|
| `server/jobs/systemIncidentNotifyJob.ts` | pg-boss handler per §9.2. Reads incident from DB, writes `notification_surfaced` event, emits `system_incident:updated` WebSocket event with payload per §5.8.2 (incidentId, fingerprint, severity, status, occurrenceCount). Idempotency key per §9.2. In Phase 0.5 it does NOT invoke `SystemIncidentFatigueGuard` (guard is for Phase 0.75 push channels). | 8 | small-medium | Full |
| `server/jobs/__tests__/systemIncidentNotifyJob.test.ts` | Threshold triggers, idempotency key enforcement, WebSocket emit verification. No fatigue-guard tests yet (Phase 0.75). | 8 | medium | Full |
| `server/jobs/index.ts` | Register `system-monitor-notify` + `system-monitor-ingest` + `system-monitor-self-check` queues. Per architecture.md §Event-Driven Architecture and `verify-idempotency-strategy-declared.sh`, each job must declare an idempotency strategy. | 8 | 10-line edit | Full |
| `server/websocket/emitters.ts` (or equivalent) | Add `emitSystemIncidentUpdated(payload)` helper. Room: `'sysadmin'` (new). | 8 | small | Full |
| `server/websocket/rooms.ts` (or equivalent) | New room — sysadmin users join on connect (gated by `req.user.isSystemAdmin`). | 8 | small | Full |
| `client/src/hooks/useSocket.ts` (or equivalent) | Add `useSysadminIncidentSocket` hook that subscribes to `system_incident:updated` and invalidates relevant queries. Wired in by commits 10 + 11. | 8 | small | Full |

### 2.8 Self-check job (commit 9)

| File | Purpose | Commit | Size |
|---|---|---|---|
| `server/jobs/systemMonitorSelfCheckJob.ts` | 5-minute cron per §5.7. Scans structured-log source for `incident_ingest_failed` events in the last 5 minutes, checks threshold + cooldown, writes a `source='self'` incident via direct SQL that bypasses `recordIncident`. Registered in `server/jobs/index.ts`. | 9 | medium | Full |
| `server/jobs/systemMonitorSelfCheckJobPure.ts` | Pure helpers: `shouldFireSelfIncident({ failuresInWindow, windowMinutes, minutesSinceLastSelfIncident, thresholdCount, cooldownMinutes })`, `buildSelfIncidentRowSql()`. | 9 | small | Full |
| `server/jobs/__tests__/systemMonitorSelfCheckJobPure.test.ts` | Threshold + cooldown matrix. | 9 | medium | Full |

Open question on log source: spec §5.7 says "scans the last 5 minutes of logs for `incident_ingest_failed` events." The current repo has no durable log store — `server/lib/logger.ts` writes stdout. The self-check job either needs (a) a process-local rolling counter in `incidentIngestor.ts` that the self-check job reads via an exported helper, or (b) an audit-event-style persistent row. Simpler = (a). Recommendation: add `getIncidentIngestFailuresInWindow(windowMinutes)` to `incidentIngestor.ts` backed by a module-scoped `Array<{ at: Date }>` with a 15-minute retention window. Documented as a first-pass constraint: the counter is process-local, so a multi-instance deploy undercounts — acceptable for Phase 0 (the self-check is a safety net, not a precision instrument).

### 2.9 Admin UI (commit 10)

| File | Purpose | Commit | Size |
|---|---|---|---|
| `client/src/pages/SystemIncidentsPage.tsx` | Main page per §8. Lazy-loaded. Polling + Page Visibility API + WebSocket refresh. Uses `ColHeader` pattern per CLAUDE.md table rule. Hosts filter bar, count badges, list table, detail drawer. | 10 | large (~500 lines) | Full, including test-incident trigger UI + confirmation modal for full-pipeline mode |
| `client/src/components/system-incidents/IncidentDetailDrawer.tsx` | Right-side drawer per §8.3. | 10 | medium (~250 lines) | Full |
| `client/src/components/system-incidents/ResolveModal.tsx` | Textarea + linked PR input + submit | 10 | small | Full |
| `client/src/components/system-incidents/SuppressModal.tsx` | Textarea + duration radio + high-volume warning banner | 10 | small-medium | Full |
| `client/src/components/system-incidents/EscalateModal.tsx` | Preview of task that will be created + guardrail state badges (if re-escalating) | 10 | small-medium | Full |
| `client/src/components/system-incidents/incidentsTablePure.ts` | Pure sort/filter/pagination helpers (mirrors `SystemSkillsPage.tsx` pattern) | 10 | small-medium | Full |
| `client/src/components/system-incidents/__tests__/incidentsTablePure.test.ts` | Pure tests for sort/filter/pagination edge cases | 10 | medium | Full |
| `client/src/App.tsx` | Add `/system/incidents` route + lazy import | 10 | 3-line edit | Full |

### 2.10 Pulse + Layout nav badge (commit 11)

| File | Purpose | Commit | Size |
|---|---|---|---|
| `server/services/pulseService.ts` | Add `system_incident` kind + `getSystemIncidents(userId)` getter with blast-radius-aware dedupe per §10.1 | 11 | medium edit | Full |
| `server/services/__tests__/pulseService.systemIncidents.test.ts` | Dedupe behaviour across multiple orgs, severity filter, acked-gating, distinct-org subtitle | 11 | medium | Full |
| `client/src/components/Layout.tsx` | Add "Incidents" nav entry under System Admin section + red-dot badge hooked to open-critical count endpoint + WebSocket-driven invalidation | 11 | medium edit | Full |
| `server/routes/systemIncidents.ts` | Add `GET /api/system/incidents/badge-count` endpoint — cheap count of open critical/high incidents for nav badge. (Could alternatively reuse existing `/api/system/incidents?severity=high,critical&status=open&limit=0` — confirm during implementation which is cleaner.) | 11 | small edit | Full |

### 2.11 Manual escalate-to-agent (commit 12)

| File | Purpose | Commit | Size |
|---|---|---|---|
| `server/services/systemIncidentService.ts` | Fill in `escalateIncidentToAgent` — load incident, validate status + guardrails per §10.2.5, resolve target subaccount per §10.3 (own-org sentinel vs System Ops), render task template per §10.4, call `taskService.createTask` with `linkedEntityKind='system_incident' + linkedEntityId=<incidentId>`, flip incident status, write `escalation` event. Write `escalation_blocked` event on guardrail failures. | 12 | medium edit | Full |
| `server/services/taskService.ts` | Accept `linkedEntityKind` + `linkedEntityId` params in `createTask`. Persist to new columns from commit 1. | 12 | small edit | Full |
| `server/services/systemOperationsOrgResolver.ts` | Boot-time resolver that caches `SYSTEM_OPS_ORG_ID` + `SYSTEM_OPS_SUBACCOUNT_ID` by looking up the seeded row. Exposed as `getSystemOpsTarget()` for the escalation service. Called during app init; throws if the seed row is missing (fail-loud on misconfiguration). | 12 | small | Full |
| `server/routes/__tests__/systemIncidents.escalate.test.ts` | 409/429/rate-limit/success cases, event-row assertions, task-shape assertions, re-escalation counter behaviour | 12 | large | Full |

### 2.12 Docs (commit 13)

| File | Change | Commit | Size |
|---|---|---|---|
| `architecture.md` | New section: "System Incidents + Monitoring Foundation." Cover: schema, ingestor contract, fingerprint override governance, sync/async mode, self-check loop, escalation guardrails, System Operations org. Add pg-boss job payload `correlationId` convention note. Add entry to "Key files per domain" table. | 13 | medium-large addition (~200 lines) | Full |
| `docs/capabilities.md` | New "System Incident Monitoring" entry under Support-facing section. Editorial rules §1 apply (no named LLM providers in customer sections; integrations-reference is support-facing so named queues are acceptable in schema reference but UI-facing copy stays neutral). | 13 | small addition | Full |

### 2.13 Files NOT changed (cross-check against spec §11.3)

- `connector_configs`, `workspace_health_findings` schemas — untouched.
- Existing `agent_runs` columns — untouched beyond the nullable `correlation_id` addition.
- Global error handler response payload shape — untouched.
- `anomaly_events`, Portfolio Health Agent — code untouched; only the refactor target `alertFatigueGuard.ts` is behaviour-preserved via regression test.
- `userSettings` schema — NOT touched in this PR (notification preferences defer to Phase 0.75 per §11.2 deferred list).
