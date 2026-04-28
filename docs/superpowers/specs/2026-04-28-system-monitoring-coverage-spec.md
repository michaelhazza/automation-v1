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
