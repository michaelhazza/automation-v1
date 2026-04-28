# System Monitoring Coverage — Spec

**Created:** 2026-04-28
**Status:** draft (ready for spec-reviewer)
**Build slug:** `system-monitoring-coverage`
**Branch:** `claude/add-monitoring-logging-3xMKQ`
**Source:** `tasks/review-logs/codebase-audit-log-monitoring-coverage-2026-04-28T06-09-11Z.md` (audit identifying 15 gaps; this spec lands the Tier 1 set + a contained Tier 2 subset).
**Predecessors:**
- `tasks/builds/system-monitoring-agent/phase-A-1-2-spec.md` (Phase 0/0.5/A/1/2/2.5 — shipped via PRs #188, #215)
- `tasks/builds/system-monitoring-agent-fixes/spec.md` (Tier 1 hardening — shipped)

---

## Contents

- [§0 Why this spec exists](#0-why-this-spec-exists)
  - [§0.1 Framing assumptions](#01-framing-assumptions)
  - [§0.2 Testing posture](#02-testing-posture)
  - [§0.3 No new primitives unless named](#03-no-new-primitives-unless-named)
  - [§0.4 Concurrency and file-disjoint contract](#04-concurrency-and-file-disjoint-contract)
  - [§0.5 Verified-open status of audit findings](#05-verified-open-status-of-audit-findings)
- [§1 Goals + non-goals + success criteria](#1-goals--non-goals--success-criteria)
- [§2 File inventory lock](#2-file-inventory-lock)
- [§3 Contracts](#3-contracts)
- [§4 Phase 1 — Log buffer + DLQ subscription + async-ingest worker](#4-phase-1--log-buffer--dlq-subscription--async-ingest-worker)
- [§5 Phase 2 — `createWorker` conversion (workflow + IEE)](#5-phase-2--createworker-conversion-workflow--iee)
- [§6 Phase 3 — Webhook 5xx + skill-analyzer terminal failure](#6-phase-3--webhook-5xx--skill-analyzer-terminal-failure)
- [§7 Testing strategy](#7-testing-strategy)
- [§8 Execution-safety contracts](#8-execution-safety-contracts)
- [§9 Rollout, verification, and risk register](#9-rollout-verification-and-risk-register)
- [§10 Deferred items + open questions](#10-deferred-items--open-questions)

---

## §0 Why this spec exists

The product is pre-production and about to enter its first structured testing pass. A 2026-04-28 audit (`tasks/review-logs/codebase-audit-log-monitoring-coverage-2026-04-28T06-09-11Z.md`) traced the System Monitor pipeline end-to-end and identified 15 producer-side gaps that prevent the agent from seeing failures it was designed to triage.

Two findings are CRITICAL on their own:
- **G2** — The triage agent's `read_logs_for_correlation_id` skill returns empty results because nothing populates the rolling log buffer. Every diagnosis silently omits log evidence.
- **G1** — `dlqMonitorService` subscribes to 8 of 31 declared dead-letter queues. Failures across the workflow engine, IEE, skill-analyzer, every `maintenance:*` job, payment reconciliation, regression replay, and connector polling sync land in DLQs that no listener consumes, so the agent never sees them.

A third finding is a latent bug:
- **G3** — `incidentIngestorAsyncWorker.handleSystemMonitorIngest` is defined but never registered. Flipping `SYSTEM_INCIDENT_INGEST_MODE=async` silently loses every incident.

This spec consolidates the Tier 1 fixes plus a contained Tier 2 subset. The Tier 1 set is the **gate** for testing — without it, real test failures will not produce incidents the agent can triage. The contained Tier 2 subset is included only because it shares the same files / boot wiring as Tier 1, so landing both in one branch reduces churn.

### §0.1 Framing assumptions

Imported from `docs/spec-context.md`:

- **Pre-production.** No backwards-compatibility shims, no feature flags, no migration windows. Drop deprecated patterns directly.
- **Rapid evolution.** Prefer simple, deterministic implementations over speculative abstractions.
- **No feature flags.** Conditional behaviour goes via env vars only when the env-var requirement is itself the spec.
- **Prefer existing primitives.** This spec uses `createWorker` (`server/lib/createWorker.ts`), `JOB_CONFIG` (`server/config/jobConfig.ts`), `recordIncident` (`server/services/incidentIngestor.ts`), `appendLogLine` (`server/services/systemMonitor/logBuffer.ts`), `withAdminConnection` (`server/lib/adminDbConnection.ts`), and `withOrgTx` (`server/instrumentation.ts`). It introduces zero new abstractions.

### §0.2 Testing posture

Per `docs/spec-context.md`:

- **Pure-function unit tests** (`*Pure.ts` + `*.test.ts`) are the default. The DLQ derivation, the log-buffer wiring filter, and the worker-registration condition all have pure helpers with isolated tests.
- **Targeted integration tests** are permitted only inside the existing carve-out for hot-path concerns: RLS, idempotency / concurrency control, crash-resume parity. Phase 1's DLQ round-trip test (one queue) and Phase 2's `createWorker`-conversion smoke (workflow tick) sit inside that carve-out.
- **No new test harnesses.** Use `node:test` + `node:assert` plus `mock.method` for spies — matches existing convention (`server/lib/__tests__/derivedDataMissingLog.test.ts`, `server/services/__tests__/incidentIngestorThrottle.integration.test.ts`).
- **No frontend, API-contract, or E2E tests** for this spec. Verification §9 includes a manual smoke checklist instead.

### §0.3 No new primitives unless named

This spec introduces **zero** new abstractions. Each item listed below uses primitives that already exist:

- **G2** — calls existing `appendLogLine` from existing `server/lib/logger.ts:emit`. No new module.
- **G1** — replaces a hard-coded array with a `.filter(...)` over an existing `JOB_CONFIG`. No new module.
- **G3** — registers an existing exported function (`handleSystemMonitorIngest`) as a pg-boss worker on boot. No new module.
- **G5** — adds `deadLetter:` keys to existing `JOB_CONFIG` entries. No new module.
- **G4 (subset)** — converts existing raw `boss.work(...)` registrations to existing `createWorker(...)`. No new module.
- **G7** — calls existing `recordIncident` from existing webhook catch blocks. No new module.
- **G11** — wraps existing `processSkillAnalyzerJob` invocation with existing `recordIncident`. No new module.

If implementation surfaces a need for a primitive not named in the item's Files list, **stop, log to `tasks/todo.md`, and ship the item against its stated scope only**.

### §0.4 Concurrency and file-disjoint contract

This spec does NOT designate a pair spec. It runs solo on `claude/add-monitoring-logging-3xMKQ`. Files touched are listed exhaustively in §2; if a future concurrent spec wants to touch any of them, it must coordinate via a §0.4 file matrix in that spec.

**Migration coordination.** This spec introduces zero migrations. Phase 1 is config-only + boot-time worker registration; Phase 2 is a refactor; Phase 3 is wrap-and-emit edits. If implementation surfaces a need for a migration (e.g. expanding `SystemIncidentSource` enum), it MUST be claimed as the next available migration slot and added to a new `§2` row before allocation. As of authoring, the next free slot is `0240` (PR #223 reserved 0239; pre-test-backend-hardening reserved 0240 — verify at implementation time and bump if needed).

**`tasks/todo.md` coordination.** Phase 1–3 implementation will tick off entries in `tasks/post-merge-system-monitor.md` and the audit log. Merge-time conflicts are expected; resolve by retaining both sets of completion marks.

### §0.5 Verified-open status of audit findings

Per `docs/spec-authoring-checklist.md` Section 0, every cited finding has been verified open against `claude/add-monitoring-logging-3xMKQ` HEAD `8fc487c` (the audit log push commit, 2026-04-28). Evidence is in the audit log §5; key cross-references:

| Finding | File:line evidence | Status |
|---|---|---|
| G1 | `server/services/dlqMonitorService.ts:14-23` (8-entry hard-coded array) vs `server/config/jobConfig.ts` (31 `deadLetter:` declarations) | verified open |
| G2 | `server/lib/logger.ts:34-43` (no `appendLogLine` call) vs `server/services/systemMonitor/logBuffer.ts:19` (function exists) | verified open |
| G3 | `server/services/incidentIngestor.ts:117` (`boss.send('system-monitor-ingest', ...)`) vs `grep -rn "'system-monitor-ingest'" server` (no `boss.work` registration) | verified open |
| G4 | `server/services/queueService.ts:548-1142` (raw `boss.work` for ~22 queues) vs `server/lib/createWorker.ts` (the canonical wrapper) | verified open |
| G5 | `server/config/jobConfig.ts` — entries for `slack-inbound`, `agent-briefing-update`, `memory-context-enrichment`, `page-integration`, `iee-cost-rollup-daily`, `connector-polling-tick` lack `deadLetter:` | verified open |
| G7 | `server/routes/webhooks/ghlWebhook.ts:64-67` (manual 500 without throw); `server/routes/githubWebhook.ts:122-124` (`logger.error` only) | verified open |
| G11 | `server/jobs/skillAnalyzerJob.ts` (no `recordIncident` import or call); `server/index.ts:476` (raw `boss.work('skill-analyzer', ...)` without DLQ subscription) | verified open |

No finding has been silently closed by surrounding work since the audit log was written.

---

## §1 Goals + non-goals + success criteria

Every goal is a verifiable assertion. Subjective evaluations have been rewritten as checks an implementer or reviewer can run against the implementation.

### §1.1 Goals (in scope)

**G1-A — Derived DLQ subscription coverage.**
`server/services/dlqMonitorService.ts` registers one pg-boss worker per queue listed in `JOB_CONFIG[*].deadLetter`. Verifiable: a unit test that mocks `JOB_CONFIG` with three queues — two with `deadLetter:` and one without — asserts the derivation function returns exactly the two `__dlq` queue names. A second test asserts that `Object.values(JOB_CONFIG).filter(c => c.deadLetter).length` matches the number of `boss.work` calls inside `startDlqMonitor` (call-counting via mock).

**G1-B — Every JOB_CONFIG queue has a `deadLetter:` entry.**
Every entry in `server/config/jobConfig.ts` declares a `deadLetter` value matching `<queue>__dlq`. Verifiable: a startup-time invariant test (`__tests__/jobConfigInvariant.test.ts`) iterates `JOB_CONFIG` and asserts every entry has `deadLetter: typeof === 'string'`. CI fails if any entry is missing one.

**G2 — Log buffer is populated by every logger emission carrying a `correlationId`.**
After `logger.info('event', { correlationId: 'abc' })` is called, `readLinesForCorrelationId('abc', 100)` returns at least one line whose `event` field equals `'event'`. Verifiable: a pure-helper test that calls a new `buildLogLineForBuffer(entry)` function and asserts the output is shaped correctly when `correlationId` is present. An integration test in `server/lib/__tests__/logger.integration.test.ts` calls `logger.info` and reads back via `readLinesForCorrelationId`.

**G3 — Async ingest worker drains the queue when async mode is enabled.**
On boot, when `SYSTEM_INCIDENT_INGEST_MODE=async`, the server registers a `boss.work('system-monitor-ingest', ...)` consumer that calls `handleSystemMonitorIngest`. Verifiable: a boot-path test that mocks pg-boss and asserts `boss.work` is called with `'system-monitor-ingest'` exactly once when `SYSTEM_INCIDENT_INGEST_MODE=async`, and not called when the env var is unset or `'sync'`.

**G4-A — Workflow engine workers run through `createWorker`.**
`workflow-run-tick`, `workflow-watchdog`, `workflow-agent-step`, and `workflow-bulk-parent-check` are registered via `createWorker(...)`. Verifiable: `grep -E "createWorker.*workflow-(run-tick|watchdog|agent-step|bulk-parent-check)" server/services/workflowEngineService.ts` returns 4 matches, AND `grep -E "(boss|pgboss)\.work\(.*'workflow-" server/services/workflowEngineService.ts` returns 0 matches.

**G4-B — IEE workers verified `createWorker`-routed.**
`iee-browser-task`, `iee-dev-task`, `iee-cleanup-orphans`, `iee-run-completed` either run through `createWorker` already, or are converted in this spec. Verifiable: same grep convention as G4-A applied to `server/jobs/ieeRunCompletedHandler.ts` and `server/services/ieeExecutionService.ts`.

**G5 — Six previously DLQ-less queues now have `deadLetter:` declarations.**
`slack-inbound`, `agent-briefing-update`, `memory-context-enrichment`, `page-integration`, `iee-cost-rollup-daily`, `connector-polling-tick` all carry `deadLetter: '<queue>__dlq'` in `JOB_CONFIG`. Verifiable: covered by G1-B's invariant test (which iterates ALL entries).

**G7 — Webhook handler 5xx paths emit `recordIncident`.**
`server/routes/webhooks/ghlWebhook.ts` and `server/routes/githubWebhook.ts` 5xx branches call `recordIncident({source: 'route', ...})` before returning. Verifiable: `grep -A 5 "res.status(500)" server/routes/webhooks/ghlWebhook.ts server/routes/githubWebhook.ts` shows a `recordIncident` call within the same `catch` block.

**G11 — Skill-analyzer terminal failures emit `recordIncident`.**
`server/index.ts:476` (or the dedicated registration site after Phase 2 conversion) wraps `processSkillAnalyzerJob` invocation in a try/catch that calls `recordIncident({source: 'job', errorCode: 'skill_analyzer_failed', fingerprintOverride: 'skill_analyzer:terminal_failure'})` on any throw, then re-throws so pg-boss retry semantics are preserved. Verifiable: integration test that injects a thrown error in the handler and asserts both (a) one `system_incidents` row written with the named fingerprint, and (b) the original error is propagated to pg-boss (asserted via spy on `boss.fail`).

### §1.2 Success criteria (end-state, post-Phase 1+2+3)

When all phases are merged:

- The audit log's coverage matrix (§4 in the audit log) flips every "✗" item gated by G1, G2, G3, G4 (workflow + IEE), G5, G7, G11 to "✓".
- The verification checklist in §9 (V1–V7) passes against staging.
- `npm run lint` and `npx tsc --noEmit` pass.
- `bash scripts/run-all-unit-tests.sh` passes.
- The branch is mergeable into `main` after `pr-reviewer` review (and optional `dual-reviewer` per CLAUDE.md).

### §1.3 Non-goals (explicit)

- **G4 — full conversion of all ~22 raw `boss.work` registrations.** This spec converts the workflow engine subset (4 queues) and verifies the IEE subset. The remaining ~18 `maintenance:*` queues are deferred to a follow-up spec (see §10) because they touch a single large file (`queueService.ts`) and would dwarf the rest of this spec.
- **G6 — `skillExecutor` retry-exhaustion incident path.** Touches retry-count plumbing in `skillExecutor.ts`; bigger surface than the rest of this spec; deferred.
- **G9 — adding `'webhook'` to `SystemIncidentSource` enum.** Webhook 5xx incidents land as `source: 'route'` in this spec. Adding the dedicated source value requires a migration; deferred.
- **G10 — new agent read skills.** Out of scope — the agent's existing skills are sufficient for the Tier 1 unblock; new skills are post-launch polish.
- **G12 — new synthetic checks (HITL timeout, workflow stuck, etc.).** Each adds 30–50 LOC and a tuning surface; out of scope.
- **G13 — adapter-level `recordIncident` calls** in `server/adapters/{ghl,slack,stripe,teamwork}.ts`. Deferred — needs a per-adapter audit pass.
- **G14 — Redis-backed `processLocalFailureCounter`.** Multi-instance concern; not relevant pre-production.
- **G15 — sysadmin-op partial-failure incident emission** for `orgSubaccountMigrationJob`, `configBackupService`, `dataRetentionService`, `scheduledTaskService`. Deferred — point audit needed.
- **No new tables, columns, migrations, or RLS policies.** Pure config + boot-wiring + incident-emission edits.
- **No agent prompt changes.** The triage agent's prompt + Investigate-Fix Protocol stay as-is.
- **No new heuristics or synthetic checks.** Producer-side fixes only.

### §1.4 Dependencies on prior work (none blocking)

This spec assumes:
- Phase 0/0.5 incident sink is live (`PR #188`, merged).
- Phase A foundations (system principal, baselining, heuristic registry) are live (`PR #215`, merged).
- Tier 1 hardening (`system-monitoring-agent-fixes`) is live (rate-limit retry idempotency, staleness sweep, silent-success synthetic, incident-silence synthetic, failed-triage filter).

All three are confirmed merged on `main` per `tasks/current-focus.md`. No predecessor work needs to land first.

---

## §2 File inventory lock

This table is the **single source of truth** for what the spec touches. Any prose reference to a file, column, migration, or function must appear here. Drift between prose and inventory is a `file-inventory-drift` finding.

### §2.1 New files

| File | Phase | Purpose |
|---|---|---|
| `server/lib/loggerBufferAdapterPure.ts` | 1 | Pure helper. Exports `buildLogLineForBuffer(entry: LogEntry): LogLine \| null` — returns the `LogLine` shape the buffer expects when `entry.correlationId` is a non-empty string, else `null`. No DB, no async, no logger import. |
| `server/lib/__tests__/loggerBufferAdapterPure.test.ts` | 1 | Pure-helper test — covers (a) entries with valid correlationId, (b) entries with empty/missing correlationId, (c) meta-stripping of timestamp/level/event/correlationId from the meta object. |
| `server/lib/__tests__/logger.integration.test.ts` | 1 | Integration test — calls `logger.info('test_event', { correlationId: 'cid-1', foo: 'bar' })` then asserts `readLinesForCorrelationId('cid-1', 100)` returns at least one line with `event === 'test_event'` and `meta.foo === 'bar'`. |
| `server/services/dlqMonitorServicePure.ts` | 1 | Pure helper. Exports `deriveDlqQueueNames(config: typeof JOB_CONFIG): string[]` — iterates entries, returns the deduplicated `deadLetter` values. |
| `server/services/__tests__/dlqMonitorServicePure.test.ts` | 1 | Pure-helper test — covers (a) all entries have `deadLetter`, (b) some entries lack `deadLetter`, (c) duplicate `deadLetter` values are deduplicated. |
| `server/config/__tests__/jobConfigInvariant.test.ts` | 1 | Invariant test — asserts every `JOB_CONFIG` entry has a non-empty `deadLetter: string` matching `/^[a-z0-9:_-]+__dlq$/`. CI gate. |
| `server/services/__tests__/dlqMonitorRoundTrip.integration.test.ts` | 1 | Integration test — picks one queue (`workflow-run-tick`), enqueues a poison-pill job with `retryLimit=0`, asserts within 30s that a `system_incidents` row exists with `fingerprint` matching `hashFingerprint('job:workflow-run-tick:dlq')`. |
| `server/jobs/__tests__/skillAnalyzerJobIncidentEmission.integration.test.ts` | 3 | Integration test — invokes the wrapper from §6.2 with a forced throw, asserts (a) one `system_incidents` row with `fingerprintOverride: 'skill_analyzer:terminal_failure'`, (b) error is propagated to caller. |

### §2.2 Modified files

| File | Phase | Change |
|---|---|---|
| [`server/lib/logger.ts`](../../server/lib/logger.ts) | 1 | Add a single call inside `emit(entry)` (line 34): `void appendLogLineSafe(entry)` where `appendLogLineSafe` lives in the same file and (a) calls `buildLogLineForBuffer(entry)` from `loggerBufferAdapterPure.ts`, (b) lazy-imports `appendLogLine` from `server/services/systemMonitor/logBuffer.ts`, (c) catches and swallows any error. |
| [`server/services/dlqMonitorService.ts`](../../server/services/dlqMonitorService.ts) | 1 | Replace the hard-coded `DLQ_QUEUES` array (lines 14-23) with `import { deriveDlqQueueNames } from './dlqMonitorServicePure.js'; import { JOB_CONFIG } from '../config/jobConfig.js'; const DLQ_QUEUES = deriveDlqQueueNames(JOB_CONFIG);`. No other change to the file. |
| [`server/config/jobConfig.ts`](../../server/config/jobConfig.ts) | 1 | Add `deadLetter:` to the 6 entries listed in G5: `slack-inbound`, `agent-briefing-update`, `memory-context-enrichment`, `page-integration`, `iee-cost-rollup-daily`, `connector-polling-tick`. Each gets `deadLetter: '<queue-name>__dlq'`. |
| [`server/index.ts`](../../server/index.ts) | 1 | Add an async-mode worker registration after the existing `await registerSystemIncidentNotifyWorker(boss);` line (~455). Conditional on `process.env.SYSTEM_INCIDENT_INGEST_MODE === 'async'`. Also add the `system-monitor-ingest` JOB_CONFIG entry — see contracts §3.3. |
| [`server/index.ts`](../../server/index.ts) | 3 | Wrap the existing `processSkillAnalyzerJob(jobId)` call (line 478) with a try/catch that calls `recordIncident({source: 'job', errorCode: 'skill_analyzer_failed', fingerprintOverride: 'skill_analyzer:terminal_failure', summary, stack})` and re-throws. |
| [`server/config/jobConfig.ts`](../../server/config/jobConfig.ts) | 1 | Add a NEW entry for `system-monitor-ingest` with `retryLimit: 3, retryDelay: 10, retryBackoff: true, expireInSeconds: 60, deadLetter: 'system-monitor-ingest__dlq', idempotencyStrategy: 'fifo' as const`. |
| [`server/services/incidentIngestorAsyncWorker.ts`](../../server/services/incidentIngestorAsyncWorker.ts) | 1 | No code change beyond export shape. The existing `handleSystemMonitorIngest` is consumed unchanged. |
| [`server/services/workflowEngineService.ts`](../../server/services/workflowEngineService.ts) | 2 | Convert the 3 raw `pgboss.work(...)` registrations at lines 3483, 3492, 3503 (TICK_QUEUE, WATCHDOG_QUEUE, AGENT_STEP_QUEUE) to `createWorker(...)` calls. Also convert the `'workflow-bulk-parent-check'` registration if it exists in this file (verify at implementation time). The watchdog and tick queues use admin connections — pass `resolveOrgContext: () => null` to opt out of the per-job org tx. |
| [`server/services/queueService.ts`](../../server/services/queueService.ts) | 2 | Verify-only — no code change in this phase. Note: the broader `queueService.ts` `boss.work` migration is deferred to a follow-up spec (see §10). The agent-step queue conversion is done inside `workflowEngineService.ts`. |
| [`server/jobs/ieeRunCompletedHandler.ts`](../../server/jobs/ieeRunCompletedHandler.ts) | 2 | Verify the existing registration uses `createWorker`. If it does (audit suggests it does — line 80 uses `.work(...)` but may already be `createWorker`-wrapped), no change. If not, convert. |
| [`server/services/ieeExecutionService.ts`](../../server/services/ieeExecutionService.ts) | 2 | Verify the IEE worker registrations route through `createWorker`. Adjust if not. |
| [`server/routes/webhooks/ghlWebhook.ts`](../../server/routes/webhooks/ghlWebhook.ts) | 3 | Inside the catch block at lines 63-66 (DB lookup failure), call `recordIncident({source: 'route', errorCode: 'webhook_handler_failed', fingerprintOverride: 'webhook:ghl:db_lookup_failed', stack, summary, errorDetail: { locationId }})` before `res.status(500).json(...)`. |
| [`server/routes/githubWebhook.ts`](../../server/routes/githubWebhook.ts) | 3 | Inside the catch block at lines 122-124, call `recordIncident({source: 'route', errorCode: 'webhook_handler_failed', fingerprintOverride: 'webhook:github:handler_failed', stack, summary, errorDetail: { event, delivery }})` after the `logger.error` call. Note: the response was already sent at line 112 (early-ack pattern); this incident emission happens post-ack and never affects the response. |

### §2.3 Out-of-inventory (intentional)

The following items appear in supporting prose (audit log, this spec's §10) but are NOT touched by this spec. Any pull request that violates this list is a `file-inventory-drift` finding.

- `server/services/skillExecutor.ts` — G6 deferred
- `server/db/schema/systemIncidents.ts` — G9 deferred (no `'webhook'` source value)
- `server/services/systemMonitor/skills/*` — G10 deferred (no new read skills)
- `server/services/systemMonitor/synthetic/*` — G12 deferred (no new synthetic checks)
- `server/adapters/{ghl,slack,stripe,teamwork}.ts` — G13 deferred
- `server/jobs/orgSubaccountMigrationJob.ts`, `server/services/configBackupService.ts`, `server/services/dataRetentionService.ts`, `server/services/scheduledTaskService.ts` — G15 deferred
- `server/services/queueService.ts` raw `boss.work` registrations beyond what this spec touches in workflow / IEE — deferred to follow-up
- All `server/services/systemMonitor/*` agent-side code — unchanged

### §2.4 Migrations

**Zero migrations.** This spec is config + boot-wiring + incident-emission edits only. If a migration is later required (e.g. to add `'webhook'` to `SystemIncidentSource`), claim the next free slot, add the migration to §2.1, and add a §2.4 row noting the down-migration filename. Today: nothing to claim.

### §2.5 Environment variables

| Var | Default | Phase | Purpose |
|---|---|---|---|
| `SYSTEM_INCIDENT_INGEST_MODE` | `'sync'` (existing) | 1 | Existing — gates whether the async worker registers on boot. No change to the variable's defaults; this spec just makes the async path actually consume the queue. |

No new environment variables introduced.

---

## §3 Contracts

Every data shape that crosses a service boundary or is consumed by a parser is pinned here with a worked example. No prose-only descriptions of payload shapes.

### §3.1 `LogLine` (consumed by `appendLogLine`, produced by the new logger adapter)

**Type:** TypeScript interface, defined at `server/services/systemMonitor/logBuffer.ts:8-14`. **Not changed by this spec.**

```ts
interface LogLine {
  ts: Date;
  level: string;       // 'debug' | 'info' | 'warn' | 'error'
  event: string;
  correlationId: string;
  meta: Record<string, unknown>;
}
```

**Example instance** (produced by the new logger adapter for `logger.info('agent_run_started', { correlationId: 'cid-7a8b', runId: 'run-42', orgId: 'org-1' })`):

```ts
{
  ts: new Date('2026-04-28T12:34:56.789Z'),
  level: 'info',
  event: 'agent_run_started',
  correlationId: 'cid-7a8b',
  meta: { runId: 'run-42', orgId: 'org-1' },
}
```

**Nullability rules:**
- `correlationId` is non-empty string. If `entry.correlationId` is missing, empty, or non-string, the adapter returns `null` and no buffer push happens.
- `meta` excludes the four top-level fields the entry already promotes (`timestamp`, `level`, `event`, `correlationId`). All other keys flow into `meta`.
- `ts` is constructed from `new Date(entry.timestamp)`. If `entry.timestamp` is absent, the adapter falls back to `new Date()` at call time.

**Producer:** new `buildLogLineForBuffer` in `server/lib/loggerBufferAdapterPure.ts`.
**Consumer:** existing `appendLogLine` in `server/services/systemMonitor/logBuffer.ts`.
**Eviction policy** (unchanged): `MAX_LINES = 1000`, `MAX_BYTES = 500_000`. Oldest evicted on overflow.

**Source-of-truth precedence:** the buffer is process-local and ephemeral. It is NOT a system of record. If the logger emits a line and the buffer is at capacity, the oldest line is evicted silently — **this is intended behaviour** and the agent's diagnosis must tolerate truncation. The triage agent's prompt already handles this ("Surface what you cannot see").

### §3.2 `DLQ_QUEUES` derivation

**Type:** `string[]` (deduplicated, non-empty values only).

**Producer:** new `deriveDlqQueueNames(config: typeof JOB_CONFIG): string[]` in `server/services/dlqMonitorServicePure.ts`.

**Implementation contract** (pseudocode — actual implementation is one expression):

```ts
export function deriveDlqQueueNames(config: typeof JOB_CONFIG): string[] {
  const dlqs = new Set<string>();
  for (const entry of Object.values(config)) {
    const dlq = (entry as { deadLetter?: string }).deadLetter;
    if (typeof dlq === 'string' && dlq.length > 0) {
      dlqs.add(dlq);
    }
  }
  return Array.from(dlqs).sort();  // deterministic ordering for stable test snapshots
}
```

**Consumer:** existing `startDlqMonitor` in `server/services/dlqMonitorService.ts`. It iterates `DLQ_QUEUES` and registers one `boss.work(...)` per entry.

**Example output** (after Phase 1 lands, with G5's `deadLetter:` additions):

```js
[
  'agent-briefing-update__dlq',
  'agent-handoff-run__dlq',
  'agent-org-scheduled-run__dlq',
  'agent-run-cleanup__dlq',
  'agent-scheduled-run__dlq',
  'agent-triggered-run__dlq',
  'clientpulse:measure-outcomes__dlq',
  'clientpulse:propose-interventions__dlq',
  'connector-polling-sync__dlq',
  'connector-polling-tick__dlq',          // added by G5
  'execution-run__dlq',
  'iee-browser-task__dlq',
  'iee-cleanup-orphans__dlq',
  'iee-cost-rollup-daily__dlq',          // added by G5
  'iee-dev-task__dlq',
  'iee-run-completed__dlq',
  'llm-aggregate-update__dlq',
  'llm-clean-old-aggregates__dlq',
  'llm-monthly-invoices__dlq',
  'llm-reconcile-reservations__dlq',
  'maintenance:cleanup-budget-reservations__dlq',
  'maintenance:cleanup-execution-files__dlq',
  'maintenance:memory-decay__dlq',
  'maintenance:memory-dedup__dlq',
  'maintenance:security-events-cleanup__dlq',
  'memory-context-enrichment__dlq',      // added by G5
  'page-integration__dlq',                // added by G5
  'payment-reconciliation__dlq',
  'priority-feed-cleanup__dlq',
  'regression-capture__dlq',
  'regression-replay-tick__dlq',
  'skill-analyzer__dlq',
  'slack-inbound__dlq',                   // added by G5
  'stale-run-cleanup__dlq',
  'system-monitor-ingest__dlq',           // new in G3
  'workflow-agent-step__dlq',
  'workflow-bulk-parent-check__dlq',
  'workflow-resume__dlq',
  'workflow-run-tick__dlq',
  'workflow-watchdog__dlq',
]
```

That's 40 DLQ subscriptions — up from 8 today.

### §3.3 `system-monitor-ingest` JOB_CONFIG entry (new in G3)

**Type:** entry inside `JOB_CONFIG` const, matches the existing entry shape.

```ts
'system-monitor-ingest': {
  retryLimit: 3,
  retryDelay: 10,
  retryBackoff: true,
  expireInSeconds: 60,
  deadLetter: 'system-monitor-ingest__dlq',
  idempotencyStrategy: 'fifo' as const,  // each ingest is an independent unit
},
```

**Rationale for each value:**
- `retryLimit: 3` — async-mode ingest is at-least-once; a transient DB blip should not lose the incident. Higher than the default to match the criticality of the data.
- `retryDelay: 10` — `system_incidents` upsert + occurrence-event insert is a single tx; a 10s backoff handles brief contention.
- `retryBackoff: true` — exponential up to a few minutes. Matches `agent-scheduled-run`.
- `expireInSeconds: 60` — the inline ingest path completes in <1s under normal load. A 60s cap is conservative.
- `deadLetter: 'system-monitor-ingest__dlq'` — covered by G1's derivation.
- `idempotencyStrategy: 'fifo'` — each `boss.send('system-monitor-ingest', { input })` is a distinct write. The handler's `ingestInline` is idempotent by virtue of the partial unique index on `system_incidents.fingerprint` (existing — see audit log §2.1) — duplicate deliveries safely upsert into the same row.

**Producer:** new entry in `server/config/jobConfig.ts`.
**Consumer:** the conditional `boss.work('system-monitor-ingest', ...)` registration in `server/index.ts` (Phase 1).

### §3.4 Async-ingest worker registration contract

**Wiring:**

```ts
if (process.env.SYSTEM_INCIDENT_INGEST_MODE === 'async') {
  await boss.work(
    'system-monitor-ingest',
    { teamSize: 4, teamConcurrency: 1 },
    async (job: { id: string; data: SystemMonitorIngestPayload }) => {
      const { handleSystemMonitorIngest } = await import('./services/incidentIngestorAsyncWorker.js');
      await handleSystemMonitorIngest(job.data);
    }
  );
}
```

**Why not `createWorker`?** The handler must NOT open an org-scoped tx — `ingestInline` writes to `system_incidents`, which BYPASSES RLS by design (see `server/db/schema/systemIncidents.ts:1` "BYPASSES RLS — every reader MUST be sysadmin-gated at the route/service layer"). Using `createWorker` with default org-resolver would either (a) require an org context in every payload (incidents can be system-scoped with no org) or (b) need the explicit `resolveOrgContext: () => null` opt-out. Either way, `boss.work` directly is simpler and matches the existing pattern in `dlqMonitorService.ts`.

**Failure semantics:**
- Handler throws → pg-boss retries per JOB_CONFIG (3× with backoff).
- Retry exhaustion → job lands in `system-monitor-ingest__dlq`.
- DLQ subscription (covered by G1) → records a `system_incidents` row with `source: 'job'` and `fingerprintOverride: 'job:system-monitor-ingest:dlq'`.

**Loop hazard:** if the DLQ-emitted incident itself fails to ingest, would it loop? **No.** The DLQ subscription writes via the `dlqMonitorService` path, which calls `recordIncident` directly. In sync mode (default), this is a synchronous DB write. In async mode, this enqueues to `system-monitor-ingest`, which would loop — **but** the dedup partial unique index collapses identical fingerprints into occurrence-count increments, not new rows. So the worst case is a counter that ticks up, which is observable and not a runaway. To be belt-and-braces: the dlqMonitorService specifically uses the **sync** ingest path even when the rest of the app is in async mode (this is implicit today — `recordIncident` checks `SYSTEM_INCIDENT_INGEST_MODE` per-call, but the dlqMonitorService runs in the same process). **No code change needed**, but document this in code comment alongside the new `system-monitor-ingest` entry.

### §3.5 Webhook-handler incident contract (G7)

**Shape:** existing `IncidentInput` type (`server/services/incidentIngestorPure.ts:11-34`). No new fields.

**Example call** (from inside `ghlWebhook.ts` catch block):

```ts
recordIncident({
  source: 'route',
  summary: `GHL webhook DB lookup failed: ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`,
  errorCode: 'webhook_handler_failed',
  stack: err instanceof Error ? err.stack : undefined,
  fingerprintOverride: 'webhook:ghl:db_lookup_failed',
  errorDetail: { locationId },
});
```

**Why `fingerprintOverride`?** Webhook handlers are called by external services with payloads we don't control. The stack trace's "meaningful frame" varies by Node version + minor refactors. An override pins the fingerprint to a stable identifier (`webhook:ghl:db_lookup_failed`) so all GHL DB-lookup failures dedup into one incident regardless of stack churn.

**Why `source: 'route'` and not `'webhook'`?** G9 (adding `'webhook'` to the source enum) is deferred. For now, `'route'` is the closest existing value. The fingerprint prefix `webhook:*` makes the source disambiguable at query time even without the dedicated enum.

### §3.6 Skill-analyzer terminal-failure incident contract (G11)

**Shape:** existing `IncidentInput`. No new fields.

**Example call** (from `server/index.ts` skill-analyzer wrapper):

```ts
recordIncident({
  source: 'job',
  severity: 'high',
  summary: `Skill analyzer terminal failure: ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`,
  errorCode: 'skill_analyzer_failed',
  stack: err instanceof Error ? err.stack : undefined,
  fingerprintOverride: 'skill_analyzer:terminal_failure',
  errorDetail: { jobId },
});
```

**Severity rationale:** skill-analyzer runs are sysadmin-triggered, multi-hour, and expensive. A terminal failure represents a wasted multi-thousand-token LLM run for the operator. `'high'` matches `inferDefaultSeverity({ source: 'job' })` so this is just being explicit, not over-promoting.

**Dedup behaviour:** the override collapses every skill-analyzer terminal failure into one incident regardless of which job ID failed. The `errorDetail.jobId` field captures the specific job for the operator. If multiple distinct failure modes need separate incidents, the override can be extended later (e.g. `skill_analyzer:llm_provider_unavailable`) — out of scope for this spec.

### §3.7 Source-of-truth precedence (cross-cutting)

For the System Monitor pipeline, the source-of-truth ordering is unchanged by this spec:

1. **`system_incidents` row** — system of record for "is there an open issue with this fingerprint right now?"
2. **`system_incident_events`** — append-only audit log; reconstructs the lifecycle.
3. **`logBuffer` (process-local)** — ephemeral evidence for triage; never authoritative.
4. **pg-boss `failed` / `*__dlq` queues** — operational artefacts; should always have a corresponding incident row (post G1).

If the four diverge, `system_incidents` wins as the operator-visible truth. The triage agent always reads `system_incidents` first.

---

## §4 Phase 1 — Log buffer + DLQ subscription + async-ingest worker

**Goal:** close G2, G1, G5, G3 in one commit group. After Phase 1, every queue with a declared `deadLetter:` has a DLQ subscriber, every logger emission with a correlation ID is buffered for the agent, and async ingest mode is functional.

### §4.1 Order of operations (within Phase 1)

The four items are dependency-ordered:

1. **G2 (log buffer)** — independent. Lands first; no other change depends on it.
2. **G5 (`deadLetter:` additions to JOB_CONFIG)** — must land before G1 because G1's derivation reads from `JOB_CONFIG`. Landing G1 first means the derived list omits the 6 newly-added queues until G5 lands.
3. **G3 — `system-monitor-ingest` config entry** — must land in the same JOB_CONFIG edit as G5 because they touch the same file and are reviewed together.
4. **G1 (derive DLQ_QUEUES from JOB_CONFIG)** — depends on G5+G3.
5. **G3 — boot-time worker registration** — depends on G1 (to ensure the new `system-monitor-ingest__dlq` is also subscribed).

**Recommended commit ordering:**

```
commit 1: feat(monitor): add buildLogLineForBuffer pure helper + tests (G2)
commit 2: feat(monitor): wire appendLogLine from logger.emit (G2)
commit 3: feat(jobs): add deadLetter to 6 missing JOB_CONFIG entries (G5)
commit 4: feat(jobs): add system-monitor-ingest entry to JOB_CONFIG (G3)
commit 5: feat(monitor): derive DLQ_QUEUES from JOB_CONFIG (G1)
commit 6: feat(monitor): register system-monitor-ingest async worker on boot (G3)
commit 7: test: jobConfigInvariant (G1+G5)
commit 8: test: dlqMonitorRoundTrip integration (G1)
```

### §4.2 G2 — Log buffer producer wiring

#### §4.2.1 New pure helper

Create `server/lib/loggerBufferAdapterPure.ts`:

```ts
import type { LogLine } from '../services/systemMonitor/logBuffer.js';

interface LogEntryShape {
  timestamp?: string;
  level?: string;
  event?: string;
  correlationId?: string;
  [key: string]: unknown;
}

/**
 * Returns a LogLine ready for appendLogLine, or null if the entry has no
 * usable correlationId. Pure — no DB, no async, no logger import.
 */
export function buildLogLineForBuffer(entry: LogEntryShape): LogLine | null {
  const cid = entry.correlationId;
  if (typeof cid !== 'string' || cid.length === 0) return null;

  const meta: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(entry)) {
    if (key === 'timestamp' || key === 'level' || key === 'event' || key === 'correlationId') {
      continue;
    }
    meta[key] = value;
  }

  let ts: Date;
  try {
    ts = entry.timestamp ? new Date(entry.timestamp) : new Date();
    if (isNaN(ts.getTime())) ts = new Date();
  } catch {
    ts = new Date();
  }

  return {
    ts,
    level: typeof entry.level === 'string' ? entry.level : 'info',
    event: typeof entry.event === 'string' ? entry.event : 'unknown_event',
    correlationId: cid,
    meta,
  };
}
```

#### §4.2.2 Logger integration

Modify `server/lib/logger.ts` (existing `emit` function):

```ts
function emit(entry: LogEntry): void {
  const output = JSON.stringify(entry);
  if (entry.level === 'error') {
    console.error(output);
  } else if (entry.level === 'warn') {
    console.warn(output);
  } else {
    console.log(output);
  }

  // Feed the System Monitor's log buffer for correlation-ID-scoped retrieval.
  // Lazy import keeps the logger module free of systemMonitor deps.
  // Errors are swallowed — the buffer is a best-effort observability surface.
  appendLogLineSafe(entry);
}

let _appendLogLineCache: ((line: import('../services/systemMonitor/logBuffer.js').LogLine) => void) | null = null;
async function loadAppendLogLine() {
  if (_appendLogLineCache) return _appendLogLineCache;
  const m = await import('../services/systemMonitor/logBuffer.js');
  _appendLogLineCache = m.appendLogLine;
  return _appendLogLineCache;
}

function appendLogLineSafe(entry: LogEntry): void {
  void (async () => {
    try {
      const { buildLogLineForBuffer } = await import('./loggerBufferAdapterPure.js');
      const line = buildLogLineForBuffer(entry);
      if (line === null) return;
      const fn = await loadAppendLogLine();
      fn(line);
    } catch {
      // Never let buffer-write failures surface to the logger caller.
    }
  })();
}
```

**Why lazy import?** Avoids a static dep cycle: `logger` is imported by hundreds of files; `logBuffer.ts` is imported by the systemMonitor skill module which (transitively) may someday import logger. Lazy + cached resolves both the eager-init cost and the cycle risk.

**Why swallow errors?** The logger is called from every layer including hot paths. A failure to write to the buffer must NEVER propagate (would either crash the caller or alter control flow). The buffer is designed to be best-effort.

**Why `void (async () => …)()`?** The caller (`logger.info` etc.) is synchronous. We don't want to make every log call await a promise, so we kick off the buffer write fire-and-forget. The `_appendLogLineCache` ensures we only resolve the import once.

#### §4.2.3 Tests for G2

**Pure-helper tests** (`server/lib/__tests__/loggerBufferAdapterPure.test.ts`):

1. Returns `null` when `correlationId` is missing.
2. Returns `null` when `correlationId` is an empty string.
3. Returns `null` when `correlationId` is non-string (number, undefined, object).
4. Returns a valid `LogLine` when `correlationId` is a non-empty string.
5. Strips `timestamp`, `level`, `event`, `correlationId` from `meta`.
6. Preserves all other keys in `meta`.
7. Falls back to `new Date()` when `timestamp` is missing or invalid.

**Integration test** (`server/lib/__tests__/logger.integration.test.ts`):

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { logger } from '../logger.js';
import { readLinesForCorrelationId, _resetBufferForTest } from '../../services/systemMonitor/logBuffer.js';

test('logger.info with correlationId populates the log buffer', async () => {
  _resetBufferForTest();
  logger.info('test_event_42', { correlationId: 'cid-42', foo: 'bar' });
  // Lazy import resolves on next tick
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));

  const lines = readLinesForCorrelationId('cid-42', 100);
  assert.ok(lines.length >= 1, 'expected at least one buffered line');
  const line = lines.find(l => l.event === 'test_event_42');
  assert.ok(line, 'expected line with matching event name');
  assert.equal(line.correlationId, 'cid-42');
  assert.equal((line.meta as { foo?: string }).foo, 'bar');
});

test('logger.info without correlationId does NOT populate the buffer', async () => {
  _resetBufferForTest();
  logger.info('test_event_no_cid', { foo: 'baz' });
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));

  // Look across all correlation IDs we've seen — none should match
  const allKeys = ['', 'undefined', 'null'];
  for (const k of allKeys) {
    const lines = readLinesForCorrelationId(k, 100);
    assert.equal(lines.length, 0, `expected no lines for key '${k}'`);
  }
});
```

The `setImmediate × 2` is required because the lazy import is two microtasks deep (import → call). If this proves flaky, fall back to `await new Promise(r => setTimeout(r, 50))`.

### §4.3 G5 — Add `deadLetter:` to 6 JOB_CONFIG entries

Edit `server/config/jobConfig.ts`. For each entry below, add `deadLetter: '<queue>__dlq'` as the last property before the closing brace.

| Queue | Current entry line | Add |
|---|---|---|
| `slack-inbound` | ~211 | `deadLetter: 'slack-inbound__dlq',` |
| `agent-briefing-update` | ~258 | `deadLetter: 'agent-briefing-update__dlq',` |
| `memory-context-enrichment` | ~267 | `deadLetter: 'memory-context-enrichment__dlq',` |
| `page-integration` | ~276 | `deadLetter: 'page-integration__dlq',` |
| `iee-cost-rollup-daily` | ~315 | `deadLetter: 'iee-cost-rollup-daily__dlq',` |
| `connector-polling-tick` | ~415 | `deadLetter: 'connector-polling-tick__dlq',` |

**Risk:** None. pg-boss creates the DLQ on first failure. No existing job lifecycle is affected.

**Verification:** `npx tsc --noEmit` passes (the type system already permits `deadLetter` on every entry — it's a `Partial<{ deadLetter: string }>` extension).

### §4.4 G3 — Add `system-monitor-ingest` to JOB_CONFIG

Add the entry inside §3.3's contract verbatim. Place it next to `system-monitor-notify` if that has a JOB_CONFIG entry; otherwise after `system-monitor-self-check`. (Verify at implementation time.)

### §4.5 G1 — Derive `DLQ_QUEUES` from `JOB_CONFIG`

Create `server/services/dlqMonitorServicePure.ts` per §3.2's contract.

Modify `server/services/dlqMonitorService.ts`:

**Before:**
```ts
const DLQ_QUEUES = [
  'agent-scheduled-run__dlq',
  'agent-org-scheduled-run__dlq',
  // ... 6 more
];
```

**After:**
```ts
import { JOB_CONFIG } from '../config/jobConfig.js';
import { deriveDlqQueueNames } from './dlqMonitorServicePure.js';

const DLQ_QUEUES = deriveDlqQueueNames(JOB_CONFIG);
```

The rest of `startDlqMonitor` is unchanged — it iterates `DLQ_QUEUES` and registers `boss.work` for each.

### §4.6 G3 — Boot-time async-ingest worker registration

In `server/index.ts`, immediately after `await registerSystemIncidentNotifyWorker(boss);` (line ~455):

```ts
// Async-ingest worker — only registers when SYSTEM_INCIDENT_INGEST_MODE=async.
// Sync mode (the default) writes incidents inline in the calling process and
// has no consumer for this queue. Registering the worker unconditionally would
// cause the queue to drain even in sync mode, which is harmless but confusing.
if (process.env.SYSTEM_INCIDENT_INGEST_MODE === 'async') {
  const { handleSystemMonitorIngest } = await import('./services/incidentIngestorAsyncWorker.js');
  await boss.work(
    'system-monitor-ingest',
    { teamSize: 4, teamConcurrency: 1 },
    async (job: { id: string; data: unknown }) => {
      await handleSystemMonitorIngest(job.data as Parameters<typeof handleSystemMonitorIngest>[0]);
    }
  );
  logger.info('async_incident_ingest_worker_registered');
}
```

The eager import (no lazy) is fine here because the boot path is only run once and the import cost is amortised across the server lifetime.

### §4.7 G1+G5 — Invariant test

Create `server/config/__tests__/jobConfigInvariant.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { JOB_CONFIG } from '../jobConfig.js';

test('every JOB_CONFIG entry declares a deadLetter queue', () => {
  const missing: string[] = [];
  for (const [name, entry] of Object.entries(JOB_CONFIG)) {
    const dlq = (entry as { deadLetter?: string }).deadLetter;
    if (typeof dlq !== 'string' || dlq.length === 0) {
      missing.push(name);
    }
  }
  assert.deepEqual(missing, [],
    `Queues without deadLetter — every entry MUST declare one to be visible to dlqMonitorService:\n${missing.join('\n')}`);
});

test('every deadLetter follows the <queue>__dlq convention', () => {
  const violations: Array<{ queue: string; deadLetter: string }> = [];
  for (const [name, entry] of Object.entries(JOB_CONFIG)) {
    const dlq = (entry as { deadLetter?: string }).deadLetter;
    if (typeof dlq !== 'string') continue;
    const expected = `${name}__dlq`;
    if (dlq !== expected) {
      violations.push({ queue: name, deadLetter: dlq });
    }
  }
  assert.deepEqual(violations, [],
    `Queues with deadLetter that doesn't match <queue>__dlq:\n${violations.map(v => `${v.queue} → ${v.deadLetter}`).join('\n')}`);
});
```

This is the CI-gating invariant that prevents future regressions of G5.

### §4.8 G1 — DLQ round-trip integration test

Create `server/services/__tests__/dlqMonitorRoundTrip.integration.test.ts`. The shape mirrors the existing `incidentIngestorThrottle.integration.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../../db/index.js';
import { systemIncidents } from '../../db/schema/index.js';
import { eq, sql } from 'drizzle-orm';
import { hashFingerprint } from '../incidentIngestorPure.js';

// This test depends on a live DB + pg-boss. Skip in CI without those.
const SKIP = process.env.NODE_ENV !== 'integration';

test('DLQ round-trip: poison job → __dlq → system_incidents row', { skip: SKIP }, async () => {
  // Setup: pick a queue we expect to have a subscriber post-G1.
  const queue = 'workflow-run-tick';
  const dlq = `${queue}__dlq`;
  const fingerprint = hashFingerprint(`job:${queue}:dlq`);

  // Cleanup any existing rows for this fingerprint.
  await db.delete(systemIncidents).where(eq(systemIncidents.fingerprint, fingerprint));

  // ... enqueue a poison job, force it to DLQ ...
  // (full implementation requires pg-boss test seam; document here for the implementer)

  // Assertion: within 30s, exactly one system_incidents row exists with our fingerprint.
  let row;
  for (let i = 0; i < 30; i++) {
    [row] = await db.select().from(systemIncidents).where(eq(systemIncidents.fingerprint, fingerprint));
    if (row) break;
    await new Promise(r => setTimeout(r, 1000));
  }

  assert.ok(row, 'expected a system_incidents row within 30s');
  assert.equal(row.source, 'job');
  assert.equal(row.severity, 'high');
  assert.equal(row.errorCode, 'job_dlq');
  assert.equal(row.occurrenceCount, 1);
});
```

**Why one queue, not all 40?** Confidence: if one round-trip works, all do (the DLQ subscriber is a single function `dlqMonitorService.startDlqMonitor` iterating an array). Cost: each round-trip needs a pg-boss seam and ~30s wall clock. One representative test catches regressions of the wiring without inflating CI time.

### §4.9 Phase 1 acceptance

Phase 1 lands successfully when:

- All four G items (G2, G5, G3, G1) ship in commits 1–8 of §4.1.
- `npm run lint` passes.
- `npx tsc --noEmit` passes.
- `bash scripts/run-all-unit-tests.sh` passes (includes the new pure-helper + invariant tests).
- The integration tests in §4.2.3 and §4.8 run green when invoked with a live DB.
- `pr-reviewer` returns PASS or has its findings addressed.

---

## §5 Phase 2 — `createWorker` conversion (workflow + IEE)

**Goal:** close G4 for the workflow engine and verify (and fix if needed) the IEE workers route through `createWorker`. After Phase 2, every workflow / IEE job that fails goes through the standard retry → DLQ → incident pipeline established in Phase 1.

### §5.1 Why workflow + IEE only, not the full G4 set

The audit identified ~22 raw `boss.work(...)` registrations that bypass `createWorker`. Most live in `server/services/queueService.ts` — a single ~1100-line file. Converting all of them in this spec would:

1. Inflate the change surface beyond what one PR can be reviewed against.
2. Create merge conflicts with any other in-flight work touching `queueService.ts`.
3. Mix critical-path infrastructure (workflow engine, IEE) with low-frequency maintenance jobs (memory dedup, ledger archive, etc.).

This spec therefore takes a focused subset: the workflow engine (4 queues) and IEE (4 queues). These are the high-impact paths. The remaining ~14 `maintenance:*` queues are deferred to a follow-up spec — see §10.

### §5.2 Workflow engine conversion

**Files touched:** `server/services/workflowEngineService.ts` only.

**Current state** (per audit log §5 G4):

| Line | Queue | Registration shape |
|---|---|---|
| 3483 | `workflow-run-tick` | `await pgboss.work(TICK_QUEUE, { teamSize: 4, teamConcurrency: 1 }, …)` |
| 3492 | `workflow-watchdog` | `await pgboss.work(WATCHDOG_QUEUE, { teamSize: 1, teamConcurrency: 1 }, …)` |
| 3503 | `workflow-agent-step` | `await pgboss.work(AGENT_STEP_QUEUE, { teamSize: 4, teamConcurrency: 1 }, …)` |

**Verify at implementation time:** `workflow-bulk-parent-check` — the audit log lists this as a queue with `deadLetter:` declared. Search `workflowEngineService.ts` for its registration and convert if present.

#### §5.2.1 Conversion pattern for `workflow-run-tick` and `workflow-bulk-parent-check`

These tick queues carry `runId` in their payload. Each run belongs to an organisation, but the tick handler reads the `workflow_runs` row (which has `organisationId`) inside the handler. The org context is therefore not in the payload's top-level `organisationId` field.

**Approach:** opt out of the default org-tx prelude by passing `resolveOrgContext: () => null`, and rely on the existing handler to do its own org-scoped DB access.

```ts
import { createWorker } from '../lib/createWorker.js';

// Replace `await pgboss.work(TICK_QUEUE, { teamSize: 4, teamConcurrency: 1 }, async (job) => { ... })` with:
await createWorker({
  queue: TICK_QUEUE as any,  // 'workflow-run-tick'
  boss: pgboss as any,
  concurrency: 4,
  resolveOrgContext: () => null,  // tick reads org from workflow_runs row
  handler: async (job) => {
    const data = job.data as { runId: string };
    await this.tick(data.runId);
  },
});
```

**Why `resolveOrgContext: () => null`?** The default resolver in `createWorker` reads `organisationId` from `job.data` and throws `missing_org_context` if absent. The tick queue's payload is `{ runId }` — the org is looked up inside `tick(runId)`. The opt-out preserves the existing handler logic.

**Caveat:** the handler is now responsible for its own DB connection scoping. The existing `tick(runId)` already does `withAdminConnection(...)` or equivalent (verify at implementation). If it does NOT, that's a P0 bug independent of this spec — flag separately.

#### §5.2.2 Conversion pattern for `workflow-watchdog`

Watchdog is a cross-org sweep — opt out of org-tx prelude.

```ts
await createWorker({
  queue: WATCHDOG_QUEUE as any,  // 'workflow-watchdog'
  boss: pgboss as any,
  concurrency: 1,
  resolveOrgContext: () => null,
  handler: async () => {
    await this.watchdogSweep();
  },
});
```

#### §5.2.3 Conversion pattern for `workflow-agent-step`

Agent-step queue carries `organisationId` directly in the payload (audit log shows `data.organisationId` referenced in the handler). Use the default org-resolver.

```ts
await createWorker({
  queue: AGENT_STEP_QUEUE as any,  // 'workflow-agent-step'
  boss: pgboss as any,
  concurrency: 4,
  // Default resolveOrgContext reads { organisationId, subaccountId? } from job.data.
  handler: async (job) => {
    const data = job.data as {
      WorkflowStepRunId: string;
      WorkflowRunId: string;
      organisationId: string;
      // ... existing fields
    };
    // existing handler body
  },
});
```

**Subtle change:** the default resolver opens a Drizzle transaction with `app.organisation_id` set. The existing handler may have its own org-scoped tx logic — verify at implementation that nesting doesn't conflict. If it does, opt out via `resolveOrgContext: () => null` and keep the handler's existing tx wiring.

#### §5.2.4 What `createWorker` adds that raw `boss.work` lacks

Per `server/lib/createWorker.ts:86-156`:

1. **Centralised retry/timeout config** — reads `retryLimit`, `retryDelay`, `expireInSeconds` from `JOB_CONFIG`. Raw `boss.work` falls back to pg-boss defaults.
2. **Timeout wrapping** — `withTimeout(runHandler(), timeoutMs)` enforces the handler completes within the configured window. Critical for the watchdog (long-running sweeps can hang).
3. **Non-retryable error classification** — `isNonRetryable(err)` check + `boss.fail(job.id)` short-circuits hopeless retries, getting failures to the DLQ faster.
4. **Org-tx prelude** — handler runs inside a `db.transaction` with `app.organisation_id` set (or opt-out via resolver).
5. **Retry observability** — logs `[Worker:${queue}] Retry #${retryCount} for job ${job.id}` on every retry attempt.

**Indirect benefit:** Phase 1's `system_incidents` pipeline expects these queues to flow through DLQs on retry exhaustion. Without `createWorker`'s retry config, the watchdog's missing `retryLimit` means pg-boss applies its default (which is queue-implementation-specific) — under load this can mean retries don't drain to the DLQ as expected.

### §5.3 IEE worker verification

**Goal:** verify each IEE queue's registration uses `createWorker`, or convert it if not.

| Queue | Likely registration site |
|---|---|
| `iee-browser-task` | `server/services/ieeExecutionService.ts` |
| `iee-dev-task` | `server/services/ieeExecutionService.ts` |
| `iee-cleanup-orphans` | `server/services/ieeExecutionService.ts` (or an `iee-cleanup-orphans-job.ts`) |
| `iee-run-completed` | `server/jobs/ieeRunCompletedHandler.ts` line 80 |

**Audit-time evidence:** `server/jobs/ieeRunCompletedHandler.ts:80` shows `.work(QUEUE, { teamSize: 4, teamConcurrency: 1 }, async (job) => {...})`. This may or may not be inside a `createWorker` wrapper — read at implementation time.

**Implementation pass:**

1. `grep -nE "(boss|pgboss)\.work\(\\s*['\"](iee-)" server` — list raw registrations.
2. For each, decide: convert to `createWorker` (preferred), or document why not.
3. If converting `iee-run-completed`: payload is `{ ieeRunId, parentAgentRunId, organisationId? }`. Use default resolver if `organisationId` is always present; otherwise opt out.
4. If converting `iee-cleanup-orphans`: cross-org sweep, opt out.

**Risk:** Medium. IEE handlers have bespoke timeout logic (long browser sessions). Verify the timeout-wrapping in `createWorker` doesn't preempt the handler's own deadline. The current `JOB_CONFIG` has `expireInSeconds: 600` for `iee-browser-task` and `iee-dev-task`, which `createWorker` translates to a `900ms × 600 = 540_000ms` (9 min) timeout — comfortably above the handler's MAX_EXECUTION_TIME_MS per `jobConfig.ts:289-296` comment.

### §5.4 Phase 2 commit ordering

```
commit 9:  refactor(workflows): convert workflow-run-tick to createWorker (G4-A)
commit 10: refactor(workflows): convert workflow-watchdog to createWorker (G4-A)
commit 11: refactor(workflows): convert workflow-agent-step to createWorker (G4-A)
commit 12: refactor(workflows): convert workflow-bulk-parent-check to createWorker (G4-A) [if found]
commit 13: refactor(iee): verify/convert IEE workers to createWorker (G4-B)
```

Each commit is self-contained — one queue per commit so a regression bisect maps directly to a single conversion.

### §5.5 Phase 2 verification

After Phase 2 lands:

- `grep -E "(boss|pgboss)\.work\(.*'workflow-" server/services/workflowEngineService.ts` returns 0 matches.
- `grep -nE "createWorker.*workflow-" server/services/workflowEngineService.ts` returns 4 matches (one per converted queue).
- A workflow run that intentionally throws on first invocation lands in `workflow-run-tick__dlq`, and within 30s a `system_incidents` row exists with the matching `job:workflow-run-tick:dlq` fingerprint. (Same pattern as §4.8 round-trip.)
- IEE smoke: kick off an IEE run that fails, verify failure surfaces as a `system_incidents` row.
- `npm run lint` + `npx tsc --noEmit` pass.

**Manual smoke if test infra not available:** run an end-to-end workflow with a step that calls a skill known to fail (e.g. a tool with a malformed schema). Assert via `psql` that a row appears in `system_incidents` within 30s of pg-boss giving up.

### §5.6 Phase 2 acceptance

- Each queue listed in §5.2 is registered via `createWorker`.
- IEE queues are verified `createWorker`-routed (or converted in this phase).
- §5.5 verification commands return the expected results.
- `pr-reviewer` returns PASS or has its findings addressed.
- `dual-reviewer` recommended on this phase since boot-time wiring is harder to spot-check (per audit log §6 single-pass branch outline).

---

## §6 Phase 3 — Webhook 5xx + skill-analyzer terminal failure

**Goal:** close G7 and G11. After Phase 3, every webhook handler 5xx and every skill-analyzer terminal failure produces a `system_incidents` row.

### §6.1 G7 — Webhook 5xx incident emission

Two webhook handlers explicitly bypass `asyncHandler` and return `res.status(500)` from inline `try/catch` blocks. Each must call `recordIncident` before returning.

#### §6.1.1 GHL webhook (`server/routes/webhooks/ghlWebhook.ts`)

**Current code** (lines 63-67):

```ts
} catch (err) {
  console.error('[GHL Webhook] DB lookup failed:', err instanceof Error ? err.message : err);
  res.status(500).json({ error: 'Internal error' });
  return;
}
```

**Replace with:**

```ts
} catch (err) {
  console.error('[GHL Webhook] DB lookup failed:', err instanceof Error ? err.message : err);

  // Surface to the System Monitor so the agent can triage repeated failures.
  // fingerprintOverride pins the dedup key; stack-derived fingerprinting is
  // unreliable inside webhook handlers because the failure surface depends on
  // adapter internals we don't control.
  recordIncident({
    source: 'route',
    summary: `GHL webhook DB lookup failed: ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`,
    errorCode: 'webhook_handler_failed',
    stack: err instanceof Error ? err.stack : undefined,
    fingerprintOverride: 'webhook:ghl:db_lookup_failed',
    errorDetail: { locationId },
  });

  res.status(500).json({ error: 'Internal error' });
  return;
}
```

**Required imports** to add at the top of `ghlWebhook.ts`:

```ts
import { recordIncident } from '../../services/incidentIngestor.js';
```

**Other catch blocks in this file:** read the full handler and apply the same pattern to any other internal `try/catch` that ends in `res.status(500)` without throwing. The audit identified one; verify exhaustively at implementation.

#### §6.1.2 GitHub webhook (`server/routes/githubWebhook.ts`)

**Current code** (lines 122-124):

```ts
} catch (err) {
  logger.error('github_webhook.handler_error', { event, delivery, error: err instanceof Error ? err.message : String(err) });
}
```

**Replace with:**

```ts
} catch (err) {
  logger.error('github_webhook.handler_error', { event, delivery, error: err instanceof Error ? err.message : String(err) });

  // The response was already sent at line 112 (early-ack pattern). This
  // emission is purely for observability — it never affects the response.
  recordIncident({
    source: 'route',
    summary: `GitHub webhook handler failed for event ${event}: ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`,
    errorCode: 'webhook_handler_failed',
    stack: err instanceof Error ? err.stack : undefined,
    fingerprintOverride: 'webhook:github:handler_failed',
    errorDetail: { event, delivery },
  });
}
```

**Required imports:**

```ts
import { recordIncident } from '../services/incidentIngestor.js';
```

#### §6.1.3 Other webhook routes — verify

The audit identified GHL and GitHub as the verified-open cases. Three other webhook routes were checked:

- `server/routes/webhooks/slackWebhook.ts` — uses `asyncHandler`. 5xx covered by global error handler. **No change needed.**
- `server/routes/webhooks/teamworkWebhook.ts` — uses `asyncHandler`. **No change needed.**
- `server/routes/webhooks.ts` (`/api/webhooks/callback/:executionId`) — uses `asyncHandler`. **No change needed.**

At implementation time, re-verify these three by `grep -nE "res\\.status\\(5[0-9]+\\)" server/routes/webhooks*` to catch any inline 500 paths added since the audit.

### §6.2 G11 — Skill-analyzer terminal failure

**Goal:** wrap the `processSkillAnalyzerJob` invocation so terminal failures emit a `system_incidents` row.

**Current code** (`server/index.ts:476-479`):

```ts
const { processSkillAnalyzerJob } = await import('./jobs/skillAnalyzerJob.js');
await boss.work('skill-analyzer', async (job) => {
  const { jobId } = job.data as { jobId: string };
  await processSkillAnalyzerJob(jobId);
});
```

**Replace with:**

```ts
const { processSkillAnalyzerJob } = await import('./jobs/skillAnalyzerJob.js');
await boss.work('skill-analyzer', async (job) => {
  const { jobId } = job.data as { jobId: string };
  try {
    await processSkillAnalyzerJob(jobId);
  } catch (err) {
    // Surface terminal failures to the System Monitor. pg-boss retry exhaustion
    // also lands in skill-analyzer__dlq (covered by Phase 1's DLQ derivation),
    // but emitting here too gives faster visibility for failures that happen
    // on the FINAL retry attempt — without this wrap, the operator sees no
    // signal until the DLQ row lands.
    recordIncident({
      source: 'job',
      severity: 'high',
      summary: `Skill analyzer terminal failure for job ${jobId}: ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`,
      errorCode: 'skill_analyzer_failed',
      stack: err instanceof Error ? err.stack : undefined,
      fingerprintOverride: 'skill_analyzer:terminal_failure',
      errorDetail: { jobId },
    });
    throw err; // preserve pg-boss retry semantics
  }
});
```

**Required import** in `server/index.ts`: `recordIncident` is already imported (line 161).

**Why both the wrap AND the DLQ subscription?** The wrap fires on EVERY throw, including pg-boss retries. The DLQ subscription only fires on retry exhaustion. With dedup via `fingerprintOverride: 'skill_analyzer:terminal_failure'`, repeated retries collapse into one `system_incidents` row with `occurrenceCount` ticking up. Operators get faster signal (within seconds of first failure) instead of having to wait for retries to exhaust.

**Why preserve pg-boss retry by re-throwing?** `processSkillAnalyzerJob` is designed to be crash-resumable (per `JOB_CONFIG['skill-analyzer']` comment about `Stage 5 reads existing skill_analyzer_results rows and skips already-paid LLM calls`). Swallowing the error would mark the pg-boss job as completed even though it failed, breaking that crash-resume contract.

#### §6.2.1 Phase 2 dependency note

After Phase 2 (G4-B), the skill-analyzer registration may move to `createWorker`. If so, the wrap in §6.2 lives inside the `handler:` callback of the `createWorker` call. The semantics are identical.

If Phase 2's IEE work also moves the skill-analyzer registration (audit log shows it at `server/index.ts:476`, not inside any IEE module — so probably no overlap), confirm at implementation time.

### §6.3 Tests for Phase 3

#### §6.3.1 G11 integration test

`server/jobs/__tests__/skillAnalyzerJobIncidentEmission.integration.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../../db/index.js';
import { systemIncidents } from '../../db/schema/index.js';
import { eq } from 'drizzle-orm';
import { hashFingerprint } from '../../services/incidentIngestorPure.js';

const SKIP = process.env.NODE_ENV !== 'integration';

test('skill-analyzer terminal failure produces a system_incidents row', { skip: SKIP }, async () => {
  const fingerprint = hashFingerprint('skill_analyzer:terminal_failure');
  await db.delete(systemIncidents).where(eq(systemIncidents.fingerprint, fingerprint));

  // Simulate the wrap: invoke the wrapper with a forced throw.
  const originalJobId = 'test-job-' + Date.now();
  let propagatedError: unknown = null;

  try {
    // The wrap is in server/index.ts; for the test, exercise the same logic
    // by importing recordIncident directly and asserting the wrap shape.
    const { recordIncident } = await import('../../services/incidentIngestor.js');

    try {
      throw new Error('simulated handler failure');
    } catch (err) {
      recordIncident({
        source: 'job',
        severity: 'high',
        summary: `Skill analyzer terminal failure for job ${originalJobId}: simulated handler failure`,
        errorCode: 'skill_analyzer_failed',
        stack: err instanceof Error ? err.stack : undefined,
        fingerprintOverride: 'skill_analyzer:terminal_failure',
        errorDetail: { jobId: originalJobId },
      });
      throw err;
    }
  } catch (err) {
    propagatedError = err;
  }

  // Wait for the incident write to commit (sync mode).
  await new Promise(r => setTimeout(r, 100));

  const [row] = await db.select().from(systemIncidents).where(eq(systemIncidents.fingerprint, fingerprint));
  assert.ok(row, 'expected a system_incidents row');
  assert.equal(row.source, 'job');
  assert.equal(row.severity, 'high');
  assert.equal(row.errorCode, 'skill_analyzer_failed');
  assert.ok((row.latestErrorDetail as { jobId?: string }).jobId === originalJobId, 'expected jobId in errorDetail');
  assert.ok(propagatedError instanceof Error, 'expected error to be re-thrown');
  assert.equal((propagatedError as Error).message, 'simulated handler failure');
});

test('skill-analyzer dedup: 5 failures collapse to one row with occurrenceCount=5', { skip: SKIP }, async () => {
  const fingerprint = hashFingerprint('skill_analyzer:terminal_failure');
  await db.delete(systemIncidents).where(eq(systemIncidents.fingerprint, fingerprint));

  const { recordIncident } = await import('../../services/incidentIngestor.js');

  for (let i = 0; i < 5; i++) {
    recordIncident({
      source: 'job',
      severity: 'high',
      summary: `Skill analyzer terminal failure for job test-${i}: bang`,
      errorCode: 'skill_analyzer_failed',
      fingerprintOverride: 'skill_analyzer:terminal_failure',
      errorDetail: { jobId: `test-${i}` },
    });
    await new Promise(r => setTimeout(r, 50));
  }

  const [row] = await db.select().from(systemIncidents).where(eq(systemIncidents.fingerprint, fingerprint));
  assert.ok(row, 'expected exactly one row from 5 failures');
  assert.equal(row.occurrenceCount, 5);
});
```

#### §6.3.2 G7 — testing posture

Webhook 5xx paths are covered by the global incident emission contract. A pure-helper test of the catch-block emit is overkill (it's three lines of mechanical glue per handler). Manual smoke is sufficient: trigger a webhook, force a DB error, observe the `system_incidents` row.

If the implementer wants a unit test, they may extract the emit call into a small `emitWebhookIncident(name: 'ghl' | 'github', err: unknown, detail: Record<string, unknown>)` helper and test that — but **no new helper is in scope** per §0.3. Extraction would require a separate spec.

### §6.4 Phase 3 commit ordering

```
commit 14: feat(webhooks): emit recordIncident on GHL handler 5xx (G7)
commit 15: feat(webhooks): emit recordIncident on GitHub handler error (G7)
commit 16: feat(jobs): wrap skill-analyzer handler with recordIncident (G11)
commit 17: test: skill-analyzer incident emission integration tests (G11)
```

### §6.5 Phase 3 verification

- **G7 GHL:** trigger a GHL webhook with a `locationId` whose `connector_configs` row has been deleted (or simulate the DB error via fault injection). Observe a `system_incidents` row with `fingerprint = hashFingerprint('webhook:ghl:db_lookup_failed')`.
- **G7 GitHub:** trigger a GitHub webhook event whose handler throws (e.g. malformed payload). Observe a `system_incidents` row with `fingerprint = hashFingerprint('webhook:github:handler_failed')`.
- **G11:** run the integration tests in §6.3.1.
- **End-to-end:** trigger the skill analyzer with a payload that forces a terminal throw. Within seconds, observe the row in `system_incidents`.

### §6.6 Phase 3 acceptance

- `grep -A 10 "res.status(500)" server/routes/webhooks/ghlWebhook.ts server/routes/githubWebhook.ts` shows a `recordIncident` call in every 500-returning catch block.
- The skill-analyzer wrapper in `server/index.ts` calls `recordIncident` before re-throwing.
- §6.5 verification commands return the expected results.
- `npm run lint` + `npx tsc --noEmit` pass.
- `pr-reviewer` returns PASS.

---

## §7 Testing strategy

This section consolidates the testing posture across all three phases and aligns with `docs/spec-context.md` (`runtime_tests: pure_function_only`, `frontend_tests: none_for_now`, `e2e_tests_of_own_app: none_for_now`).

### §7.1 Test types and where each lives

| Test type | Convention | Where in this spec |
|---|---|---|
| **Pure-helper test** | `*Pure.ts` + `*.test.ts` sibling, runnable via `npx tsx` | §4.2.3 (logger adapter), §4.5 (DLQ derivation) |
| **Invariant test** | Iterates a known data structure, asserts a global property | §4.7 (every JOB_CONFIG entry has `deadLetter:`) |
| **Integration test** | Uses real DB + pg-boss; gated by `NODE_ENV=integration`; lives in `__tests__/*.integration.test.ts` | §4.2.3 (logger end-to-end), §4.8 (DLQ round-trip), §6.3.1 (skill-analyzer dedup + emission) |
| **Manual smoke** | Operator-driven; documented in §9 (V1–V7) | All phases |

### §7.2 What is intentionally NOT tested

Per `docs/spec-context.md`:

- **Frontend tests** — none. `client/` is not touched by this spec.
- **API contract tests** — none. The new behaviour is server-internal (worker registration, log buffering, DLQ subscription). No HTTP shape changes.
- **E2E tests of own app** — none. The verification in §9 is manual smoke.
- **Performance baselines** — deferred. Log-buffer write cost should be measured post-launch if it becomes a concern.
- **Migration safety tests** — N/A. This spec introduces no migrations.

If `pr-reviewer` flags any of the above as missing, treat as a `convention_rejection` per `docs/spec-context.md` line 71-77 (e.g. "do not add vitest / jest / playwright for own app").

### §7.3 Pure-helper invariants this spec depends on

The implementation passes if these invariants hold. Each is a one-line check:

1. `buildLogLineForBuffer({ correlationId: 'x', timestamp: '2026-01-01T00:00:00Z', level: 'info', event: 'e', foo: 'bar' }).meta` equals `{ foo: 'bar' }`.
2. `buildLogLineForBuffer({ correlationId: '' })` returns `null`.
3. `deriveDlqQueueNames({ a: { deadLetter: 'a__dlq' }, b: {} })` returns `['a__dlq']`.
4. `deriveDlqQueueNames({ a: { deadLetter: 'x' }, b: { deadLetter: 'x' } })` returns `['x']` (deduplicated).
5. After `logger.info('test_event', { correlationId: 'cid' })` and one event-loop tick, `readLinesForCorrelationId('cid', 100).length >= 1`.
6. After `logger.info('test_event', {})`, no buffer push happens.

Each invariant is a single test case. Total: ~10 test cases for ~50 LOC of helper code.

### §7.4 Integration test gating

The integration tests in §4.8 (DLQ round-trip) and §6.3.1 (skill-analyzer) require:

- Live PostgreSQL with `system_incidents` table created.
- Live pg-boss instance.
- `NODE_ENV=integration` env var set (or test runner gating).

These are NOT run on every commit. They run:

1. Once before the PR opens, on the implementer's local environment.
2. As part of staging smoke (§9, V1–V7).
3. Optionally in CI via `npm run test:integration` if such a target is added (currently absent — out of scope to add).

Pure-helper tests + invariant tests run on every commit via `bash scripts/run-all-unit-tests.sh`.

### §7.5 No `npm run test:gates` mid-iteration

Per CLAUDE.md gate-cadence rule: `npm run test:gates` is ONLY run pre-merge ("we're done, prepare for merge"). Mid-iteration verification uses:

- `npx tsc --noEmit` for typecheck
- `bash scripts/run-all-unit-tests.sh` (or single-file `npx tsx`) for unit tests
- Targeted integration test invocation only if the implementer wants belt-and-braces

---
