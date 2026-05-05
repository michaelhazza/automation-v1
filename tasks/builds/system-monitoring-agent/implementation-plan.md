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

---

## 3. Integration-point sequencing

Seven ingestor integration points (§6). Order matters because each one widens the blast radius of an ingestor bug. The order below is "low-volume, easy-to-verify first; high-volume, harder-to-rollback last."

| Order | Integration | Volume | Why here | Verification before moving on |
|---|---|---|---|---|
| 7a | Global Express error handler + `asyncHandler` | Low–medium | A failed route is a well-understood test target. Firing a contrived 500 + watching the DB gives fast confidence. Also validates the `err.__incidentRecorded` de-dup marker (see §0 concern 2). | `curl` a failing test endpoint → confirm one incident row, one event row, correlation ID populated. |
| 7b | DLQ monitor (`dlqMonitorService.ts`) | Low | DLQ is rare in normal traffic; easy to reproduce by poisoning a test job. Independent code path from routes. | Enqueue a failing test job → wait for DLQ → confirm incident row with `source='job'`, correct queue name in `affectedResource`. |
| 7c | Agent run terminal-failed | **High** | This is the dominant volume. Landing it after 7a + 7b lets ingestor performance be validated on lower-volume paths first. If ingest p95 > 100ms, async mode can be flipped before 7c ships. | Run a deliberately failing agent. Confirm: (i) `source='agent'`, (ii) `severity='high'` for system-managed agents, `'medium'` for org-created agents, (iii) agent run completes normally regardless of ingest outcome. |
| 7d | Connector polling failures | Low | Per-connection failure rate is low, and the call site is linear. | Break a test connection → wait for poll → confirm incident. |
| 7e | Skill executor retry exhaustion | Medium | `skillExecutor.ts` is the largest service in the codebase — highest risk of misreading the control flow. Easier after 7c has validated the high-volume pattern works. | Force a skill to fail all retries in a test → confirm `source='skill'`. |
| 7f | LLM router parse-failure + reconciliation-required | Low–medium (but expensive) | Narrow surface — specific error shapes. Landing last puts the most-specialised integration on top of the most-tested base. | Force a mock provider to return unparseable output → confirm `source='llm'` + correct `errorCode`. |

### 3.1 Blast-radius rationale for ordering

The gradient "low-volume, easy-rollback → high-volume, hard-rollback" applies because:

- If 7a breaks, the scope of impact is "route 500s don't write incidents." This is recoverable by reverting the single commit — no data loss, no cascading failures.
- If 7c breaks first (before 7a is validated), the scope is "every failing agent run may lose its terminal-failure path on the ingest catch-handler bug." Even with the outer `.catch(…)` swallow, a bug in `recordIncident` itself that somehow throws before the catch fires would block agent-run finalisation. Ship the smaller surfaces first.

### 3.2 What can land in parallel vs strictly sequential

- **Strictly sequential:** 7a → 7b → 7c. Each needs its predecessor's staging validation to pass.
- **Can parallelise after 7c:** 7d + 7e + 7f can be authored concurrently and landed in any order once 7c is green in staging.

---

## 4. Bug-risk heatmap

High-risk surfaces and the test shapes that catch them.

### 4.1 Upsert with partial unique index, concurrent writers (commits 2 + 4)

**Risk:** The partial unique index on `fingerprint WHERE status IN ('open', 'investigating', 'remediating', 'escalated')` allows multiple rows with the same fingerprint in different statuses. Concurrent ingests of the same fingerprint can race — two INSERT attempts, one wins, the other has to recover via ON CONFLICT ... DO UPDATE. Postgres semantics are correct here, but the `xmax = 0` trick for "was_inserted" in §5.6 fails under specific edge cases (heap-only updates can leave xmax at 0 even on the updating branch under certain conditions). If the ingestor uses `xmax = 0` as the sole "new incident" signal for enqueueing the `notify` job, a misread causes missed notifications on genuinely-new incidents.

**What could go wrong:** notify job never fires because `was_inserted` reports `false` incorrectly; admin page silently missing new incidents.

**Test shape:**
- Integration test: two concurrent ingests from separate DB transactions of the same fingerprint, assert exactly one row in `system_incidents` with `occurrence_count = 2` AND exactly one `notify` job enqueued (not zero, not two).
- Add assertion on the `xmax = 0` decision path with isolation level set via `SET TRANSACTION ISOLATION LEVEL REPEATABLE READ` to probe the edge case.

**Mitigation:** if the `xmax = 0` trick proves unreliable, use the RETURNING clause to compare `created_at` to now-within-100ms, or add a dedicated `returning ... xmax` + `occurrence_count` and decide based on `occurrence_count = 1`.

### 4.2 Fingerprint stability under real stacks (commits 4 + 7a–7f)

**Risk:** `topFrameSignature` normalises `:line:col` but real stacks can contain minified names, anonymous functions (`at <anonymous>`), or dynamic-import frames that differ across deploys even when `:line:col` is stripped. One deploy produces fingerprints in frame `at foo (/app/server.js)`, next deploy produces `at foo (/app/server-abc123.js)` due to hash-in-filename build output — fingerprint explodes.

**What could go wrong:** Each deploy produces a new set of fingerprints for the same underlying errors. Admin page floods with "new" incidents on every deploy.

**Test shape:**
- Pure test: feed `topFrameSignature` 10 real production stacks (collected from actual failing runs post-merge of commit 7a), confirm stability across line-number perturbation.
- Canary monitoring post-deploy (spec §13.5): watch `SELECT COUNT(DISTINCT fingerprint)` vs `SELECT COUNT(*) FROM system_incidents WHERE created_at > now() - interval '1 hour'`. Divergence signals explosion.

**Mitigation:** integrations with a stable domain identifier use `fingerprintOverride` per §5.2 table. For route/self sources, if explosion occurs, add stripping rules (e.g. strip hash from bundle filenames: `server-[a-f0-9]+\.js` → `server.js`).

### 4.3 Async-mode transaction boundaries (commits 4 + 8)

**Risk:** §5.8.2 says upsert + event-append + notify-enqueue happen inside ONE transaction. A naive implementation enqueues the pg-boss job via `pgboss.send` which — depending on pg-boss config — may use its own connection, not the outer Drizzle tx. Result: tx rolls back due to a DB error, but the pg-boss `send` already committed on a separate connection → phantom notify job firing against a non-existent incident.

**What could go wrong:** Notify job runs, queries `system_incidents` by ID, finds nothing, logs an error, WebSocket event never fires. Intermittent — only under tx-rollback conditions.

**Test shape:**
- Integration test: force the event-append INSERT to fail (e.g. truncate `system_incident_events` to invalidate FK), run ingest, assert no pg-boss job was enqueued (requires inspecting `pgboss.job` table) and no stdout log for notify-job dispatch.

**Mitigation:** use pg-boss's transactional send API (if available in the version this repo uses) OR use the outbox pattern: write a row to a `notify_outbox` table inside the tx, let a 1-second poller ship it to pg-boss. Simpler: use `pg-boss.send(...)` inside the same connection pool Drizzle is using — verify the pg-boss client is constructed from the same pool. If it isn't, architecturally the async path in §5.8.1 needs a small outbox table. Not a large change; flag during implementation.

### 4.4 Escalation guardrails race conditions (commit 12)

**Risk:** §10.2.5 guardrails check `escalationCount`, `escalatedAt`, and previous task status on the incident row. Two sysadmins clicking Escalate within 60 seconds of each other both read `escalationCount = 1` before either writes — both proceed, both create tasks, `escalationCount` ends at 2 or 3 depending on write order but the rate-limit intent is violated.

**What could go wrong:** Two parallel Orchestrator tasks fired for the same incident, Orchestrator budget burn doubles, duplicate sub-account noise.

**Test shape:**
- Integration test: spawn two concurrent escalate requests, assert exactly one task created AND exactly one incident.escalationCount increment AND the other request returns 409 or 429.
- Implementation must use `SELECT ... FOR UPDATE` on the incident row or an advisory lock keyed on `(incidentId)` to serialise.

**Mitigation:** wrap the guardrail check + task create + incident update in a single transaction that takes a row-level lock on the incident first.

### 4.5 RLS Option A unintended visibility leak (commits 2 + 3)

**Risk:** §7.4 Option A bypasses RLS for the three incident tables. System_admin UI is gated at the route layer. But if any future code (a dashboard widget, a Pulse getter) queries `system_incidents` on behalf of a non-sysadmin user without a route-layer gate, every incident ever captured — including cross-org — is readable.

**What could go wrong:** A well-meaning future Pulse extension exposes System Operations incidents to every signed-in user. Data leak, not just annoyance.

**Test shape:**
- Integration test: attempt to read `system_incidents` via each non-sysadmin-visible service (pulseService.getAttention, any dashboard aggregator, etc.) using a non-sysadmin JWT → assert 0 rows returned OR 403.
- Add a commit-13 note to `architecture.md` explicitly stating "system_incidents tables bypass RLS; all readers MUST be sysadmin-gated or return only the caller's own incidents after explicit service-layer filtering."

**Mitigation:** Add a CI gate or comment block at the top of each schema file reading "BYPASSES RLS — reader MUST be sysadmin-gated."

### 4.6 WebSocket room membership for sysadmins (commit 8)

**Risk:** Sysadmin status is carried in the JWT. A user whose `system_admin` flag flipped after they connected retains their `sysadmin` room membership until they reconnect. Either they see incidents they shouldn't (revoked sysadmin still in room) OR they don't see incidents they should (newly-granted sysadmin hasn't reconnected).

**What could go wrong:** Stale membership. Low-severity for Phase 0.5 — sysadmin grants rarely change. But the pattern scales poorly.

**Test shape:**
- Integration test: flip a user's sysadmin flag while they have an active socket connection, fire a `system_incident:updated` event, assert they do/do-not receive it per expected state. If the test fails (stale membership), document the limitation in architecture.md rather than fix in Phase 0.5.

**Mitigation:** acceptable limitation for Phase 0.5. Add TODO in architecture.md for Phase 0.75+ to re-evaluate permission checks on room membership.

### 4.7 AlertFatigueGuard refactor breaking Portfolio Health Agent (commit 6)

**Risk:** §11.2 says "behaviour preserved byte-for-byte." The existing `alertFatigueGuard.ts` may have subtle logic (order-dependent side effects, specific Date-handling edge cases) that the extracted base class loses.

**What could go wrong:** Portfolio Health Agent starts firing too many or too few alerts, silently. Tenant impact — agency customers receive wrong alert cadence.

**Test shape:**
- Regression test that runs the full existing AlertFatigueGuard test suite against the refactored subclass and asserts identical outputs. This test MUST be in commit 6 (non-negotiable).
- Additionally: snapshot-test on a 30-day simulated input stream — run it through both old and new implementations, diff the `{deliver, reason}` output per call.

**Mitigation:** the regression test is the mitigation. No merge without green regression.

### 4.8 Additional risks flagged by the prompt

- **`cascade-delete of system_incident_events`:** §4.2 has `onDelete: 'cascade'`. If a future feature adds cross-incident references (e.g. "this incident was resolved by this other incident"), a cascade delete would wipe out the event log of the referenced incident too. Phase 0.5 doesn't expose a delete action, so this is dormant risk. Mitigation: keep cascade for now; if Phase 2 adds cross-references, revisit. Document in architecture.md.
- **`previous_task_ids[]` unbounded growth:** capped at 3 entries per incident row by the hard escalation cap. New row on recurrence starts fresh. Not actually unbounded. (See §0 concern 3.)
- **Test-incident trigger rate-limit bypass:** if the rate-limit is process-local, a multi-instance deploy multiplies the effective limit. For Phase 0.5 (pre-production, single-instance), acceptable. Document in architecture.md.

---

## 5. Test sequencing

Four layers: pure tests, service integration tests, route integration tests, end-to-end smoke (manual). Each layer has gating commits.

### 5.1 Pure tests (run on every commit, CI-enforced)

Per architecture.md Pure helper convention, every `*Pure.ts` file has a `*Pure.test.ts` companion. These run fast and deterministically.

| Test file | Gates commit | Scope |
|---|---|---|
| `incidentIngestorPure.test.ts` | 4 | fingerprint determinism, classify matrix, severity default matrix, override validator, normalise helpers |
| `systemIncidentServicePure.test.ts` | 5 | state machine transitions, guardrail verdict matrix, resolution payload shape |
| `systemIncidentFatigueGuardPure.test.ts` | 6 | subclass-specific per-fingerprint cap + critical bypass |
| `alertFatigueGuard.regression.test.ts` | 6 | refactored guard byte-for-byte parity (**non-negotiable**) |
| `systemMonitorSelfCheckJobPure.test.ts` | 9 | threshold + cooldown matrix |
| `incidentsTablePure.test.ts` | 10 | client-side sort/filter/pagination edge cases |

### 5.2 Integration tests (DB required, gated per commit)

| Test file | Gates commit | Scope |
|---|---|---|
| `incidentIngestorIntegration.test.ts` | 4 | upsert increments, partial unique index, resolved→new row, severity never de-escalates, suppression short-circuit, self-source bypass, concurrent serialisation, tx boundaries on async mode |
| `systemIncidents.test.ts` (route file) | 5 | auth, filter behaviour, action endpoints, 409/429 guardrails — but escalate only stub-tested here |
| `systemIncidentNotifyJob.test.ts` | 8 | threshold triggers, idempotency enforcement, WebSocket emit payload shape |
| `pulseService.systemIncidents.test.ts` | 11 | dedupe, distinct-org subtitle, acked gating |
| `systemIncidents.escalate.test.ts` | 12 | 409/429/rate-limit, task creation shape, event-row writes, re-escalation counter |
| `organisations.visibility.test.ts` | 3 | non-sysadmin list omits System Operations (regression for §10.3) |

### 5.3 Manual smoke (pre-deploy, per §12.3)

10 steps in §12.3. All manual; run them after staging deploy before production cut. Not CI-gating.

### 5.4 Load test (pre-deploy, per §12.4)

10,000 incidents across 100 fingerprints over 60 seconds. Run once against staging. If p95 > 100ms, flip `SYSTEM_INCIDENT_INGEST_MODE=async` and re-run before ship.

### 5.5 Post-merge-safe deferred tests

These can land as a follow-up commit inside the same PR if time is tight:

- Snapshot-test for 30-day AlertFatigueGuard simulation (the spot-check regression test is the floor; the 30-day sim is a nice-to-have).
- Full RLS visibility-leak audit test (§4.5) — if route-layer sysadmin gating is obviously correct on inspection, the automated test can land post-merge. Architectural comment in schema files is the must-have.

Do NOT defer:
- `alertFatigueGuard.regression.test.ts`.
- `incidentIngestorIntegration.test.ts` concurrent-serialisation scenario.
- `systemIncidents.escalate.test.ts`.

---

## 6. Prerequisite migrations

Spec §14.1 lists three prerequisite column additions. This plan's recommendation:

### 6.1 Combine or split?

**Combined into one migration file** (commit 1 of this plan): `agent_runs.correlation_id` + `tasks.linked_entity_kind` + `tasks.linked_entity_id` + `organisations.is_system_org` + partial unique index. Four columns across three tables. All additive, all nullable-with-default, zero behavioural impact at rest.

Why combined: the schema diff is small; splitting into three migrations adds review overhead without reducing risk. The column additions are all independent but land as a single logical "prereq" unit.

### 6.2 Same-PR vs land-and-wait

**Same PR.** There is no reason to land the prereqs ahead of the core schema — they're only useful together. Spec §14.1 explicitly says "None of these are separate PRs; they are included as preparatory commits within the Phase 0 PR." This plan respects that.

### 6.3 Seed-row migration

The System Operations org + sentinel subaccount seed is a **separate migration file** from the column-add migration, landing in commit 3. Why: the seed depends on the `is_system_org` column, and migrations are forward-only (architecture.md §Migrations). Running them in one file would mean the column add and the INSERT are in the same transaction — if the INSERT fails for any reason (unlikely but possible on a corrupt state), the column add rolls back too. Two files, ordered, lets each succeed independently.

Seed migration must be **idempotent** — `INSERT ... ON CONFLICT DO NOTHING` so re-running the migration script (e.g. after a rollback + re-apply) doesn't duplicate.

### 6.4 pg-boss `correlationId` convention

Spec §14.1 says "document in architecture.md that new pg-boss job payloads SHOULD include a correlationId field." This is a docs-only change landing in commit 13. No bulk refactor; new jobs added by this PR (`system-monitor-notify`, `system-monitor-ingest`, `system-monitor-self-check`) include it. Existing jobs are left alone.

---

## 7. Open structural concerns

Places where the spec's architectural choice is defensible but likely to bite during implementation. Flagging now so implementation doesn't re-litigate these mid-build.

### 7.1 Shared `ingestInline` function shape for sync+async parity

Spec §5.8.1 shows `ingestInline` as the shared code path for sync + async mode. In sync mode it's called directly; in async mode the worker calls it after deserialisation. Both paths must produce identical DB state.

**Structural concern:** `ingestInline` needs clean separation between "logic that depends on request context" (correlationId, orgId-from-req) and "logic that operates purely on the payload." Async mode serialises the payload and deserialises on the worker — any request-context reference that slips into `ingestInline` (e.g. an `AsyncLocalStorage` lookup for correlationId) silently returns null on the worker path.

**Mitigation:** `IncidentInput` per §5.4 already makes correlationId an explicit field on the input, not a lookup. Keep it that way. Add a test that exercises async mode with the worker running in a different AsyncLocalStorage scope than the caller, asserting correlationId still flows through.

### 7.2 Partial unique index semantics under high concurrency

See §4.1. Already covered. Flagging here as structural because the `xmax = 0` detection shortcut in §5.6 may prove fragile; the fallback is to use `RETURNING occurrence_count` and compare to `1` as the "was_inserted" signal. Confirm in implementation which path is used.

### 7.3 Dependency ordering: notify job + WebSocket server + admin page

Spec sequences these as commits 7 → 9 → 10 (this plan's 8 → 10). The admin page WebSocket hook must subscribe to a room the server emitter actually creates. Concrete coupling:

- Commit 8 adds `emitSystemIncidentUpdated` + creates the `'sysadmin'` WebSocket room + hook module.
- Commit 10 (admin UI) imports the hook.
- Commit 11 (Layout nav badge) also imports the hook.

**Structural concern:** the room name string must be shared — `shared/types/systemIncidentEvents.ts` or similar — so client and server can't drift. Spec doesn't name this file; plan it as part of commit 8.

### 7.4 Cascade-delete of `system_incident_events` on incident delete

Covered in §4.8. Phase 0.5 never exposes an incident-delete UI, but the FK cascade is in the schema. If a future phase adds cross-incident references in `payload`, the cascade could wipe referenced event logs. Mitigation: leave as-is for Phase 0.5; note in architecture.md commit 13 that adding a delete action requires revisiting the cascade semantics.

### 7.5 `previous_task_ids[]` array growing unbounded

Covered in §0 concern 3. Capped at 3 per lifecycle by the escalation cap. Not actually unbounded.

### 7.6 Test-incident full-pipeline mode + real-WebSocket traffic

§8.9 introduces full-pipeline mode for test incidents — triggering WebSocket + Pulse + nav-badge. Rate-limited to 2/hour/sysadmin. Structural concern: this is the single place in Phase 0.5 where an operator can deliberately generate sysadmin-visible noise. If multiple sysadmins trigger full-pipeline tests simultaneously in staging, the WebSocket room receives real traffic that muddies actual incident signal.

**Mitigation:** the `[TEST]` subject prefix in §8.9 is the primary disambiguation. Additionally, consider adding a Pulse subtitle marker "TEST" that visually distinguishes test Pulse cards from real ones. Not in spec; flag as commit-10 polish if easy. Don't let it expand scope.

### 7.7 Self-check log-scan source

§2.8 above. The spec assumes a durable log scan; this repo has no durable log store. This plan recommends a process-local rolling counter exposed from `incidentIngestor.ts`. Known limitation: multi-instance deploys undercount across instances. Acceptable for Phase 0.5.

---

## 8. What NOT to build on first pass

Reducing first-pass surface area. Landable within the same PR as follow-up commits if they're small.

### 8.1 Candidates the prompt flagged

**Test-incident trigger (§8.9) — BUILD FULL.** The trigger is explicitly spec'd at v4 (Q8 §0.2 + §8.9 full-pipeline flag). It's small (a button, a form, a route, an env-aware fingerprint). Spec §SC0.5.6 gates Phase 0.5 completion on it. Don't stub — it's a one-hour implementation and deferring costs more context-switching than it saves.

**Slack-style quick actions — DEFER.** Spec doesn't specify these for Phase 0.5. The admin page has action buttons on the drawer (§8.3) — that's enough surface for triage. Any "quick-action via keyboard shortcut" or "slash-command" variant is Phase 0.75+.

**Monthly suppression audit (§4.3, §14.2 Q7) — STUB.** Spec §4.3 says "that audit is a Phase 1 follow-up; Phase 0.5 only guarantees the counters are incremented and visible." So already not in scope — counters are built, audit job is explicitly Phase 1. No stub needed; the visibility data is captured from day one.

### 8.2 What this plan additionally recommends to stub

- **Correlation-ID-based detail-drawer log filter deep-link** (spec §8.3 "correlation ID ... clickable to filter logs — deferred to later phase"). Already explicitly deferred in spec. Don't build.
- **Open `subaccount` deep-link from incident scope block** (spec §8.3) — if the target is a real linked page in this app, one-line `href`. If the subaccount detail page doesn't exist or needs auth routing, render as plain text on first pass.
- **`wasSuccessful` UI prompt on resolve** (spec §7.2 / §4.2) — spec explicitly says null in Phase 0.5. Column reserved, no UI.

### 8.3 What this plan recommends FULLY building on first pass

- **Sync/async toggle** — worth it; flipping later under pressure is the bug mode.
- **Escalation guardrails (§10.2.5)** — a soft guard that isn't built in v1 gets bypassed by future UI code that doesn't know about it.
- **Suppression visibility counters** — already in the schema; incrementing them is a one-line edit in the suppression-check branch of the ingestor.
- **System Ops org filter across all listing endpoints (§10.3)** — visibility leak is a correctness issue, not a polish issue. Build immediately.
- **Blast-radius dedupe in Pulse (§10.1 / §4 v4 change)** — requires one `COUNT(DISTINCT organisationId)` aggregate; defer would leave the subtitle showing wrong info once cross-org outages happen.
- **Resolution feedback loop (§4.2, §7.2)** — one event-type addition, one event write in `resolveIncident`. Cheap; Phase 2 design benefits from day-one data.

### 8.4 Follow-up commits within the same PR

If the PR gets long, these can land as commits 14–16 without disrupting Phase 0.5 completion:

- Pulse "TEST" subtitle marker (§7.6).
- Architectural comment blocks at top of each schema file (§4.5 mitigation).
- Additional fingerprint stripping rules for hash-in-filename builds, if observed during staging (§4.2 mitigation).

---

## 9. UX considerations

### 9.1 Admin page primary task

Sysadmin lands on `/system/incidents`. Primary task: "triage what needs attention." Per CLAUDE.md frontend principles, the page starts with a default-filtered list (`status ∈ {open, investigating, escalated}`, `classification = system_fault`, sort by `last_seen_desc`). Everything else is progressive disclosure.

### 9.2 States the implementation must handle

- **Loading:** skeleton rows (spec §8.4).
- **Empty:** celebratory "No active system incidents" with `view resolved` toggle (§8.4).
- **Empty-after-filter:** "No incidents match these filters" + `clear filters` button (§8.4).
- **Error (fetch failed):** inline error + retry button (§8.4).
- **WebSocket disconnected:** backstop polling at 10s (per architecture.md §Event-Driven Architecture "Backstop polling" — 15s when connected, 5s when disconnected, but spec overrides to 10s visible / pause on backgrounded).
- **Pagination beyond limit:** cap at 200 per spec §7.1; show pagination controls.
- **Action in flight:** disabled action button + loading spinner.
- **Action returned 409 (escalation guardrail):** modal with explanation and "Escalate again anyway" (§10.2.5).
- **Action returned 429 (hard cap reached):** disabled button + explainer tooltip (§10.2.5).

### 9.3 Permissions that gate visibility

- Page itself: `requireSystemAdmin`. No org admin access.
- Nav entry in `Layout.tsx`: hidden for non-sysadmins.
- WebSocket room membership: sysadmin-only.
- System Operations org filtered from org-listing endpoints for non-sysadmins (§10.3, commit 3).

### 9.4 Real-time updates

- Primary path: `system_incident:updated` WebSocket event → targeted client-side refresh per §5.8.2 (update in place if already rendered, prepend + refetch badges if new, invalidate Pulse if visible).
- Backstop: 10s polling when tab visible, paused when backgrounded.
- Manual: refresh button in header.
- Toggle: auto-refresh on/off in header.

---

## Ready to build when

Checklist of what must be true before the first `git commit` in this PR lands.

- [ ] **Branch checked out:** `claude/system-monitoring-agent-PXNGy` — confirm locally.
- [ ] **Migration number confirmed:** `ls migrations/ | sort -n | tail -5` and use the next free slot for all three migrations in this PR. If it differs from 0223+, adjust all four migration filenames accordingly.
- [ ] **Spec §5.8.1 async enqueue path verified:** confirm pg-boss's `send` call works cleanly inside a Drizzle `withOrgTx` (or that the outbox-pattern workaround from §4.3 is acceptable). Re-check during commit 4 implementation before writing the async worker.
- [ ] **skillExecutor.ts call site located:** spec §6.6 says "find by searching for non-retryable error emission." Before writing commit 7e, grep `skillExecutor.ts` for the retry-exhaustion emission path and confirm the `IncidentInput` shape — in particular the `errorCode` source.
- [ ] **Existing AlertFatigueGuard tests identified:** before writing commit 6, list the existing tests for `alertFatigueGuard.ts` and plan the regression-test fixture set. (Grep: `grep -R alertFatigueGuard server/services/__tests__/`.)
- [ ] **System Ops seed ID strategy confirmed:** §10.3 says IDs are resolved at boot into runtime config. Decide: (a) seed with a hardcoded UUID (simpler, brittle if seed re-runs) OR (b) let Postgres generate the UUID and read it back at boot (more complex, more robust). Recommend (b); confirm during commit 3 implementation.
- [ ] **All spec §0.2 decisions treated as locked:** no re-litigation during build. If something feels wrong, flag it as a spec amendment, do not change course mid-commit.
- [ ] **Test DB ready:** `npm test` works on the current branch. Migrations run cleanly against a fresh DB.
- [ ] **pr-reviewer access:** confirm `.claude/agents/pr-reviewer.md` is current so it can be invoked on commit 13 before merge.

Once all boxes check, the first commit can land.



