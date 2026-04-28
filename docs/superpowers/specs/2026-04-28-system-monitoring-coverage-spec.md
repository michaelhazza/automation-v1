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
| `server/services/__tests__/dlqMonitorServicePure.test.ts` | 1 | Pure-helper test — covers (a) all entries have `deadLetter`, (b) some entries lack `deadLetter`, (c) duplicate `deadLetter` values are deduplicated, (d) an entry with `deadLetter !== '<queueName>__dlq'` causes `deriveDlqQueueNames` to throw with the queue name + expected DLQ name in the error message. |
| `server/config/__tests__/jobConfigInvariant.test.ts` | 1 | Invariant test — asserts every `JOB_CONFIG` entry has a non-empty `deadLetter: string` matching `/^[a-z0-9:_-]+__dlq$/`. CI gate. |
| `server/services/__tests__/dlqMonitorRoundTrip.integration.test.ts` | 1 | Integration test — picks one queue (`workflow-run-tick`), enqueues a poison-pill job with `retryLimit=0`, asserts within 30s that a `system_incidents` row exists with `fingerprint` matching `hashFingerprint('job:workflow-run-tick:dlq')`. |
| `server/services/__tests__/dlqMonitorServiceForceSyncInvariant.test.ts` | 1 | Invariant test — mocks `recordIncident` and runs `dlqMonitorService.startDlqMonitor` against a fixture queue with `SYSTEM_INCIDENT_INGEST_MODE=async`. Asserts every captured `recordIncident` call receives `{ forceSync: true }` in the second argument. Pure unit test (no pg-boss, no DB) — the loop-hazard invariant from §3.4 is machine-verifiable. |
| `server/jobs/__tests__/skillAnalyzerJobIncidentEmission.integration.test.ts` | 3 | Integration test — invokes the wrapper from §6.2 with a forced throw, asserts (a) one `system_incidents` row with `fingerprintOverride: 'skill_analyzer:terminal_failure'`, (b) error is propagated to caller. |

### §2.2 Modified files

| File | Phase | Change |
|---|---|---|
| [`server/lib/logger.ts`](../../server/lib/logger.ts) | 1 | Add a single call inside `emit(entry)` (line 34): `void appendLogLineSafe(entry)` where `appendLogLineSafe` lives in the same file and (a) calls `buildLogLineForBuffer(entry)` from `loggerBufferAdapterPure.ts`, (b) lazy-imports `appendLogLine` from `server/services/systemMonitor/logBuffer.ts`, (c) catches and swallows any error. |
| [`server/services/dlqMonitorService.ts`](../../server/services/dlqMonitorService.ts) | 1 | Two changes: (a) Replace the hard-coded `DLQ_QUEUES` array (lines 14-23) with `import { deriveDlqQueueNames } from './dlqMonitorServicePure.js'; import { JOB_CONFIG } from '../config/jobConfig.js'; const DLQ_QUEUES = deriveDlqQueueNames(JOB_CONFIG);`. (b) Every `recordIncident(...)` call in this file MUST pass `{ forceSync: true }` as the second argument — see §3.4 loop-hazard invariant. |
| [`server/services/incidentIngestor.ts`](../../server/services/incidentIngestor.ts) | 1 | Add a second parameter to `recordIncident`: `opts?: { forceSync?: boolean }`. When `opts.forceSync === true`, bypass the `SYSTEM_INCIDENT_INGEST_MODE` check and always take the inline (sync) path. When omitted or `false`, behaviour is unchanged. See §3.4 for the contract and rationale. |
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
  for (const [queueName, entry] of Object.entries(config)) {
    const dlq = (entry as { deadLetter?: string }).deadLetter;
    if (typeof dlq !== 'string' || dlq.length === 0) continue;

    // Belt-and-braces runtime guard against silent misconfiguration. The
    // jobConfigInvariant test (§4.7) catches this at CI time, but a future
    // edit that bypasses CI (hotfix, branch-skipped suite, etc.) would
    // otherwise see dlqMonitorService subscribe to an arbitrarily-named DLQ
    // while pg-boss writes to `<queueName>__dlq` — silent coverage gap.
    // Throwing at boot makes the misconfig fail-fast and visible.
    const expected = `${queueName}__dlq`;
    if (dlq !== expected) {
      throw new Error(
        `[deriveDlqQueueNames] JOB_CONFIG['${queueName}'].deadLetter must equal '${expected}', got '${dlq}'`,
      );
    }

    dlqs.add(dlq);
  }
  return Array.from(dlqs).sort();  // deterministic ordering for stable test snapshots
}
```

**Pure-helper test addendum:** the `dlqMonitorServicePure.test.ts` cases listed in §2.1 must include a case where an entry has `deadLetter: 'wrong-name'` and assert that `deriveDlqQueueNames` throws with a message containing the queue name and `__dlq`. Without this case, the runtime guard is unverified.

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

**Loop hazard — explicit invariant (enforced in code, not implied):**

```ts
// INVARIANT: DLQ-originated incidents MUST call recordIncident with forceSync: true.
// They must never enqueue into system-monitor-ingest.
```

The hazard exists because, in async mode, a `recordIncident` call from inside the `system-monitor-ingest__dlq` handler that re-enqueues to `system-monitor-ingest` is a self-sustaining loop. The dedup partial unique index would collapse identical fingerprints into occurrence-count increments rather than producing new rows, so the worst case is an ever-ticking counter — observable, not a runaway — but still latent garbage we want closed off.

**Enforcement (code-level, not just doc):** `recordIncident` MUST accept a second-argument options bag:

```ts
recordIncident(input: IncidentInput, opts?: { forceSync?: boolean }): void
```

When `opts.forceSync === true`, `recordIncident` bypasses the `SYSTEM_INCIDENT_INGEST_MODE` check and always takes the inline (sync) path — equivalent to calling the `ingestInline` primitive directly. When the option is omitted or `false`, behaviour is unchanged: the function honours `SYSTEM_INCIDENT_INGEST_MODE`.

**Required call-site:** `dlqMonitorService` MUST pass `{ forceSync: true }` on every `recordIncident` call it issues, regardless of `SYSTEM_INCIDENT_INGEST_MODE`. This guarantees DLQ-derived incidents never re-enter the async queue and closes the loop class entirely.

**Verification:**
- `grep -nE "recordIncident\\(" server/services/dlqMonitorService.ts` — every match must include `forceSync: true` in the options bag (visible on the same line or the next).
- Unit test in `dlqMonitorServiceForceSyncInvariant.test.ts` (§2.1) asserts that the dlqMonitorService's `recordIncident` invocation receives `{ forceSync: true }` when the env var is `'async'` — the invariant must be machine-checked, not a comment.

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

type AppendLogLineFn = (line: import('../services/systemMonitor/logBuffer.js').LogLine) => void;
let _appendLogLineCache: AppendLogLineFn | null = null;
let _appendLogLineLoading: Promise<AppendLogLineFn> | null = null;

async function loadAppendLogLine(): Promise<AppendLogLineFn> {
  if (_appendLogLineCache) return _appendLogLineCache;
  // Burst-race guard: if a load is already in flight, every concurrent caller
  // awaits the same promise instead of triggering N parallel dynamic imports.
  // Without this, the first burst of log calls during boot can each kick off
  // their own `import(...)`, which is wasted work + nondeterministic ordering.
  if (_appendLogLineLoading) return _appendLogLineLoading;

  _appendLogLineLoading = import('../services/systemMonitor/logBuffer.js').then((m) => {
    _appendLogLineCache = m.appendLogLine;
    _appendLogLineLoading = null;
    return _appendLogLineCache;
  }).catch((err) => {
    _appendLogLineLoading = null;
    throw err;
  });

  return _appendLogLineLoading;
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

**Why `void (async () => …)()`?** The caller (`logger.info` etc.) is synchronous. We don't want to make every log call await a promise, so we kick off the buffer write fire-and-forget. The `_appendLogLineCache` + `_appendLogLineLoading` pair ensures the import resolves exactly once even when N concurrent first calls race during boot.

**Ordering caveat (intentional):** because the buffer writes are fire-and-forget through a microtask queue, log lines may appear in the buffer in a slightly different order than the synchronous `console.{log,error,warn}` outputs. Ordering is best-effort and not guaranteed under async buffer writes. Triage callers (the agent's `read_logs_for_correlation_id` skill) treat the buffer as a per-correlation-ID set of evidence, not a strictly ordered timeline. Do not "fix" this with a blocking `await` in `emit` — the cost would land on every log call across the codebase.

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

**INVARIANT — handler transaction ownership (applies to every conversion in §5.2 and §5.3):**

A handler passed to `createWorker` MUST NOT open its own org-scoped transaction.

`createWorker`'s default org-resolver opens a Drizzle transaction with `app.organisation_id` set before invoking the handler. A handler that ALSO calls `withOrgTx` (or any equivalent org-scoped tx primitive) inside its body would nest two transactions for the same org context — at best wasted overhead, at worst silent partial writes if one tx commits and the other rolls back, or wrong-org scoping if the inner tx resolves the org from a different source than the outer.

**Per-handler verification step (perform before converting each queue):**

```bash
grep -n "withOrgTx" server/services/workflowEngineService.ts
grep -n "withOrgTx" server/services/ieeExecutionService.ts
grep -n "withOrgTx" server/jobs/ieeRunCompletedHandler.ts
```

For each handler being converted, locate its body and check whether `withOrgTx` is present:

| Handler contains `withOrgTx`? | Required action |
|---|---|
| No | Convert as documented in §5.2.1 / §5.2.2 / §5.2.3. Default resolver is safe. |
| Yes — and the org context comes from `job.data.organisationId` | Remove the inner `withOrgTx` call and let `createWorker`'s default resolver own the transaction. |
| Yes — and the inner `withOrgTx` resolves org from a different source (e.g. a DB row lookup) | Set `resolveOrgContext: () => null` on the `createWorker` config and keep the handler's existing `withOrgTx` wrapping. Do NOT use the default resolver — it would open an unnecessary outer tx. |

This rule is the verification gate for every conversion sub-section below. If a conversion sub-section's pattern conflicts with what this grep reveals at implementation time, the grep result wins — adjust the conversion to match the table above and document the deviation in the commit message.

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

**Two distinct fingerprints — intentional, not duplication.** The wrap emits `skill_analyzer:terminal_failure` (early failure signal); the DLQ subscriber emits `job:skill-analyzer:dlq` (terminal exhaustion signal). These represent fundamentally different operator events — "skill analyzer is starting to fail" vs "skill analyzer has given up after exhausting retries" — and are intentionally separate fingerprints. Future cleanup passes that propose collapsing them into a single fingerprint should be rejected: doing so erases the distinction between transient and terminal modes that the agent uses to triage. The same intentional-duplication note also applies in §3.6 and §8.6 — see those sections for the dedup-interaction breakdown.

**Why preserve pg-boss retry by re-throwing?** `processSkillAnalyzerJob` is designed to be crash-resumable (per `JOB_CONFIG['skill-analyzer']` comment about `Stage 5 reads existing skill_analyzer_results rows and skips already-paid LLM calls`). Swallowing the error would mark the pg-boss job as completed even though it failed, breaking that crash-resume contract.

#### §6.2.1 Phase 2 dependency note

After Phase 2 (G4-B), the skill-analyzer registration may move to `createWorker`. If so, the wrap in §6.2 lives inside the `handler:` callback of the `createWorker` call. The semantics are identical.

If Phase 2's IEE work also moves the skill-analyzer registration (audit log shows it at `server/index.ts:476`, not inside any IEE module — so probably no overlap), confirm at implementation time.

### §6.3 Tests for Phase 3

#### §6.3.1 G11 integration test

`server/jobs/__tests__/skillAnalyzerJobIncidentEmission.integration.test.ts`:

**Test scope (be honest about what this validates).** This test exercises the *emission semantics* of the wrap — fingerprint shape, dedup behaviour, error re-throw — by calling `recordIncident` directly inside a try/catch that mirrors the wrapper's body. It does NOT exercise pg-boss delivery, retry exhaustion, or the wrapper's literal placement inside `boss.work(...)` in `server/index.ts`. Wrapper-location regressions (e.g. someone moves the try/catch outside the handler) are caught by the §6.6 grep verification, not by this test. End-to-end pg-boss → DLQ flow is covered manually by V6 in §9.2.

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

## §8 Execution-safety contracts

Per `docs/spec-authoring-checklist.md` Section 10, every new write path or externally-triggered operation must declare its idempotency posture, retry classification, and concurrency guard. This section pins those contracts for every write introduced by this spec.

### §8.1 Logger → log buffer write (G2)

| Property | Value |
|---|---|
| **Write path** | `logger.{info,warn,error,debug}(event, data)` → fire-and-forget → `appendLogLine(line)` |
| **Idempotency posture** | `non-idempotent (intentional)` — every log emission is a distinct event. Duplicate calls produce duplicate buffer entries; that is correct (a single log call could be made twice if the caller retries). |
| **Retry classification** | `safe` — the buffer is in-memory + LRU-evicted. Repeated writes only push out older entries. |
| **Concurrency guard** | Process-local; no inter-process race. Single-threaded V8 means concurrent calls serialise at the JS layer. |
| **Failure mode** | The lazy import or the `appendLogLine` call may throw. Errors are swallowed by `appendLogLineSafe`. The log entry still goes to console (the primary log surface). The buffer is best-effort. |
| **Ordering guarantee** | None. Buffer pushes happen on the microtask queue while console writes happen synchronously, so per-correlation-ID line order in the buffer may differ slightly from console order. Triage callers treat the buffer as a set of evidence for a correlation ID, not a strictly-ordered timeline. Do not "fix" with a blocking await — see §4.2.2 ordering caveat. |
| **Loop hazard** | None. The buffer never calls back into the logger. |

### §8.2 `JOB_CONFIG` lookup (G1)

Not a write path — pure read. No execution-safety contract needed. The `deriveDlqQueueNames` function is pure, deterministic, and returns the same output for the same input.

### §8.3 DLQ → `system_incidents` row (G1, G5, G11 — DLQ branch)

| Property | Value |
|---|---|
| **Write path** | `dlqMonitorService.startDlqMonitor` → `boss.work('<queue>__dlq', handler)` → handler calls `recordIncident({source: 'job', fingerprintOverride: 'job:<queue>:dlq', ...})` |
| **Idempotency posture** | `key-based` — partial unique index on `system_incidents.fingerprint WHERE status IN ('open','investigating','remediating','escalated')` (existing — see `server/db/schema/systemIncidents.ts:73-75`). Repeated DLQ events for the same queue collapse into one row with `occurrenceCount` ticking up. |
| **Retry classification** | `safe` — `recordIncident` is fire-and-forget and never throws. Even if the upsert fails, `recordFailure()` increments the process-local counter, the self-check job picks it up, and a `self:ingestor:ingest_pipeline_degraded` row is created. |
| **Concurrency guard** | DB upsert with `ON CONFLICT (fingerprint) WHERE status IN ('open',...) DO UPDATE SET occurrence_count = occurrence_count + 1`. First-write-wins on the insert path; subsequent concurrent writes hit the update branch and increment atomically. |
| **Terminal event** | `occurrence` event appended to `system_incident_events` inside the same DB transaction as the upsert. Existing behaviour, unchanged. |

### §8.4 Async-ingest queue → `system_incidents` row (G3)

| Property | Value |
|---|---|
| **Write path** | `recordIncident` (async mode) → `boss.send('system-monitor-ingest', { input, correlationId })` → worker → `handleSystemMonitorIngest` → `ingestInline` → upsert |
| **Idempotency posture** | `key-based` — same partial unique index as §8.3. pg-boss may deliver the same job twice (at-least-once). Duplicate deliveries collapse via the upsert. |
| **Retry classification** | `guarded` — the worker re-throws on inner failure (`throw err` in `incidentIngestorAsyncWorker.ts:21`). pg-boss retries per `JOB_CONFIG.system-monitor-ingest.retryLimit` (3, with backoff). Retry exhaustion → `system-monitor-ingest__dlq`, which is subscribed (post G1) and will record a meta-incident with `fingerprintOverride: 'job:system-monitor-ingest:dlq'`. |
| **Concurrency guard** | Same as §8.3 (partial unique index + upsert). |
| **Loop hazard** | If the meta-incident from a `system-monitor-ingest__dlq` event itself fails to ingest in async mode, would it loop? The DLQ subscriber (`dlqMonitorService`) calls `recordIncident` synchronously (sync mode within its own scope — `recordIncident` checks the env var per call). So the DLQ-emitted incident bypasses the async queue entirely. No loop. **This is a correctness invariant — verify at implementation that `dlqMonitorService` does not somehow invoke the async path.** Documented in §3.4. |
| **Terminal event** | Same as §8.3. |

### §8.5 Webhook 5xx incident emission (G7)

| Property | Value |
|---|---|
| **Write path** | webhook handler catch block → `recordIncident({source: 'route', fingerprintOverride: 'webhook:<provider>:<failure_class>'})` |
| **Idempotency posture** | `key-based` via `fingerprintOverride`. Repeated handler failures with the same override collapse into one `system_incidents` row. |
| **Retry classification** | `safe` — `recordIncident` is fire-and-forget. Webhook handler returns a 500 to the caller after the emit (or in the GitHub case, the caller already received a 200 ack at line 112 — emit is post-ack). |
| **Concurrency guard** | DB upsert. |
| **Failure mode in incident emission** | If `recordIncident` itself throws (impossible per its contract, but defensive), the handler still returns the 500 response. The catch is inside the handler's own try/catch. |
| **Caller retry** | Webhook providers (GHL, GitHub) retry on 5xx. Each retry produces another incident (deduplicated to one row, `occurrenceCount` ticks up). This is the desired signal — repeated webhook failures mean the agent should triage. |

### §8.6 Skill-analyzer terminal-failure incident emission (G11)

| Property | Value |
|---|---|
| **Write path** | pg-boss handler catch block → `recordIncident({source: 'job', fingerprintOverride: 'skill_analyzer:terminal_failure', ...})` → re-throw → pg-boss retry/DLQ |
| **Idempotency posture** | `key-based` via `fingerprintOverride`. All skill-analyzer terminal failures across all jobs collapse into one row. |
| **Retry classification** | `guarded` — handler re-throws after emitting the incident. pg-boss retries per `JOB_CONFIG.skill-analyzer.retryLimit` (1, with 5-min delay). Retry exhaustion → `skill-analyzer__dlq`, subscribed (post G1) — emits another DLQ-sourced incident with `fingerprintOverride: 'job:skill-analyzer:dlq'`. |
| **Concurrency guard** | DB upsert. |
| **Dedup interaction** | The `skill_analyzer:terminal_failure` and `job:skill-analyzer:dlq` fingerprints are DIFFERENT. The first counts every retry attempt; the second only fires on retry exhaustion. Operators see both — first as "skill analyzer is failing" (high-cardinality, fast signal), second as "skill analyzer has given up" (lower-cardinality, terminal). Two related but distinct incidents is the intended design. |
| **Re-throw rationale** | `processSkillAnalyzerJob` is crash-resumable per `JOB_CONFIG['skill-analyzer']` comment. Swallowing the error would mark the pg-boss job as `completed`, breaking crash-resume. |

### §8.7 No state-machine modifications

This spec does NOT introduce or modify any state machine. The triage agent's `triage_status` lifecycle, the incident `status` enum, the agent run statuses, and the workflow run status are all unchanged.

### §8.8 No new DB unique constraints

This spec does NOT introduce any new DB unique constraint. The existing partial unique index on `system_incidents.fingerprint` (created in Phase 0/0.5) is what guarantees dedup. No new HTTP-mapping concerns.

### §8.9 Terminal event guarantee

Every fail path defined by this spec produces exactly one `system_incidents` row (via dedup) with associated `system_incident_events` entries:

- DLQ failure → `occurrence` event with `actor_kind: 'system'`.
- Webhook failure → same.
- Skill-analyzer terminal failure → same.
- Async-ingest worker failure → same.

The `occurrence` event is appended atomically with the row upsert (`incidentIngestor.ts:261-279`, in the same `db.transaction`). Post-terminal events (acknowledge, resolve, etc.) are unchanged from the existing pipeline.

---

## §9 Rollout, verification, and risk register

### §9.1 Rollout plan

This is a single-branch, single-PR rollout. No staged release, no feature flags, no env-var rollout gate.

```
Branch: claude/add-monitoring-logging-3xMKQ (already created)

Phase 1 (commits 1–8):  log buffer + DLQ derivation + JOB_CONFIG additions + async worker
Phase 2 (commits 9–13): createWorker conversion (workflow + IEE)
Phase 3 (commits 14–17): webhook 5xx + skill-analyzer terminal failure

PR: open after commit 17.
Reviewers:
  - pr-reviewer (mandatory, per CLAUDE.md)
  - dual-reviewer (recommended for Phase 2 boot-time wiring; user-triggered)
  - chatgpt-pr-review (optional, after pr-reviewer if user wants the second-phase review pass)

Pre-merge gate: npm run test:gates (per CLAUDE.md gate-cadence rule).
```

### §9.2 Verification checklist (V1–V7)

After the PR merges to `main` (or against staging if available before merge), execute these manual smoke tests:

#### V1 — Log buffer round trip (G2)

```
1. Hit any authenticated route. Note the response's correlationId from the JSON body.
2. Wait 1-2 seconds for log emission to flush.
3. Run a sysadmin query (psql or admin tool) that reads from logBuffer via
   readLinesForCorrelationId('<id>', 100) — equivalent to invoking the
   read_logs_for_correlation_id skill with that correlation ID.
4. Assert lineCount > 0 and lines contain the route handler's events.
```

**Pass criterion:** at least one line returned. If zero, the lazy-import path failed silently.

#### V2 — DLQ subscription coverage (G1, G5)

For 3 representative queues from different categories — `workflow-run-tick`, `skill-analyzer`, `connector-polling-sync`:

```
1. Enqueue a poison-pill job with retryLimit=0 (or wait for natural retry exhaustion).
2. Confirm pg-boss moves it to <queue>__dlq within seconds.
3. Within 30s, query system_incidents:
     SELECT * FROM system_incidents WHERE fingerprint = encode(sha256(:fp::text), 'hex')::text;
   where :fp = 'job:<queue>:dlq'. (Or use hashFingerprint(:fp).slice(0, 16).)
4. Assert one row with source='job', severity='high', errorCode='job_dlq'.
```

**Pass criterion:** all 3 queues produce incident rows.

#### V3 — Async-ingest worker drains (G3)

```
1. Set SYSTEM_INCIDENT_INGEST_MODE=async in env. Restart the server.
2. Trigger any 5xx route (force a DB error, cause an unhandled exception).
3. Confirm via pg-boss SQL:
     SELECT name, COUNT(*) FROM pgboss.job
       WHERE name = 'system-monitor-ingest' GROUP BY name, state;
   The count should briefly tick up from 0 then back to 0 within seconds.
4. Confirm a system_incidents row was written.
```

**Pass criterion:** queue empties; row exists. If the queue stays at 1, the worker isn't registered.

#### V4 — Workflow engine failures surface (G4-A)

```
1. Submit a workflow run with a step that intentionally throws on first invocation.
   (Easiest: add a workflow with a prompt step pointing at a non-existent agent ID.)
2. Confirm pg-boss retries the job per JOB_CONFIG.workflow-run-tick.retryLimit (3).
3. Confirm the failed job ends up in workflow-run-tick__dlq (or workflow-agent-step__dlq depending on which queue actually surfaces).
4. Confirm a system_incidents row appears within 30s of the DLQ landing.
```

**Pass criterion:** incident row exists with the matching `job:<queue>:dlq` fingerprint.

#### V5 — Webhook 5xx emits incident (G7)

```
1. Send a GHL webhook for a locationId that does NOT exist in canonical_accounts
   (or simulate the DB error via fault-injection wrapper).
2. Confirm a system_incidents row with:
     fingerprint = hashFingerprint('webhook:ghl:db_lookup_failed').slice(0, 16)
     source = 'route'
     errorCode = 'webhook_handler_failed'
3. Repeat with a malformed GitHub webhook payload.
4. Confirm a system_incidents row with fingerprint = hashFingerprint('webhook:github:handler_failed').slice(0, 16).
```

**Pass criterion:** both rows exist.

#### V6 — Skill-analyzer terminal failure surfaces (G11)

```
1. Submit a skill-analyzer job with a payload that forces a terminal throw.
   (Easiest: simulate via a test-only env-flag in the analyzer that throws on first call.)
2. Within 1s, confirm a system_incidents row with:
     fingerprintOverride captured as hashFingerprint('skill_analyzer:terminal_failure').slice(0, 16)
     source = 'job'
     severity = 'high'
3. Repeat 5 times with different jobIds.
4. Confirm one row with occurrenceCount=5 (NOT 5 separate rows).
```

**Pass criterion:** dedup works; single row with count=5.

#### V7 — End-to-end: route → triage → diagnosis with log evidence (G2 + Phase 1 cumulative)

This is the canonical end-to-end test for the entire System Monitor pipeline.

```
1. Trigger an incident from a route by causing a 5xx with a few logger.info / logger.error
   calls that include the same correlationId as the request.
2. Wait for the triage worker to pick up the incident (severity ≥ medium triggers triage).
3. Read system_incidents.agent_diagnosis.evidence.
4. Assert at least one evidence entry references a log line from V1's buffer
   (look for { type: 'log_line', ... } or whatever the evidence shape is).
```

**Pass criterion:** the diagnosis cites log evidence. If it doesn't, the triage agent isn't reading the buffer — investigate `read_logs_for_correlation_id` skill invocation and buffer state.

### §9.3 Failure modes during rollout

| Failure | Symptom | Recovery |
|---|---|---|
| Lazy import fails on first log emission | All log calls succeed; buffer stays empty; tests fail V1 | Check `loggerBufferAdapterPure.ts` import path; check for runtime require errors in server boot logs |
| `JOB_CONFIG` invariant test fails on commit 7 | CI gate red on `npm test` | A commit added a queue without `deadLetter:`; add it before merge |
| DLQ round-trip timeout in V2 | No incident row after 30s | Verify the queue is in `JOB_CONFIG[*].deadLetter`; verify dlqMonitorService.startDlqMonitor was called at boot (`logger.info('dlq_monitor_started', ...)`) |
| Async worker registered in sync mode | `system-monitor-ingest` queue drains even though sync ingest also fires | Bug — the env-var check failed. Verify `process.env.SYSTEM_INCIDENT_INGEST_MODE === 'async'` is the gate |
| `createWorker` opens orphan tx for cross-org sweeps | DB connection pool exhaustion under load | The watchdog/tick handlers must use `resolveOrgContext: () => null` — verify per §5.2 |
| Skill-analyzer wrapper swallows the error instead of re-throwing | pg-boss marks the job `completed`; crash-resume contract broken; user sees no retry | Verify the `throw err` line is present after `recordIncident` |

### §9.4 Risk register

| ID | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | Logger lazy-import cycle bug — production hot path | Low | Critical (every log call could throw) | `appendLogLineSafe` swallows ALL errors; primary log surface (console) is unaffected. Test V1 catches missed wiring. |
| R2 | `JOB_CONFIG` invariant test added but a future spec adds a queue without `deadLetter:` | Medium | Low (CI catches it) | Invariant test is the gate; new queues are forced to declare DLQ. |
| R3 | `createWorker` org-tx prelude conflicts with handler's own tx | Medium | High (handler errors out) | `resolveOrgContext: () => null` opt-out documented in §5.2; verify per-handler at implementation. |
| R4 | DLQ subscription explosion under boot — pg-boss creates 40 listeners | Low | Low (pg-boss handles many listeners; observed in similar projects) | Existing dlqMonitorService already iterates an array; just longer. teamSize is small (2). |
| R5 | Async-ingest worker double-deliver due to pg-boss at-least-once + dedup window | Low | Low (dedup index handles it) | Partial unique index on fingerprint; concurrent upserts collapse to occurrenceCount++. |
| R6 | Skill-analyzer wrapper triggers incident churn during transient retries | Medium | Low (operator UX noise; not a correctness issue) | `fingerprintOverride: 'skill_analyzer:terminal_failure'` collapses all retries into one row. |
| R7 | Phase 2 `createWorker` conversion of workflow-watchdog breaks the watchdog cron behaviour | Low | Medium (workflow runs stuck) | Watchdog is a no-payload sweep; conversion preserves shape. Test V4 catches regression. |
| R8 | Webhook 5xx incident floods if a downstream is down | Low | Low (dedup handles it; rate-limited via fingerprint throttle) | `incidentIngestorThrottle` already in place; `fingerprintOverride` collapses. |
| R9 | Logger buffer write becomes a hot-path cost | Low | Low (LRU eviction is O(1) per push) | Lazy import + cached resolver; per-log overhead is one push + occasional shift. Measure post-launch if concern. |
| R10 | Phase 1 lands without Phase 2/3 → partial coverage | High (it's the order) | Low (each phase is independently safe) | Each phase has standalone acceptance criteria (§4.9, §5.6, §6.6). Partial merge is correct behaviour. |

### §9.5 Estimated effort

| Phase | LOC (rough) | Sessions | Calendar time |
|---|---|---|---|
| Phase 1 | ~150 LOC code + ~120 LOC tests | 1 | 4–6 hours |
| Phase 2 | ~80 LOC code (refactor) + verification | 1 | 3–4 hours |
| Phase 3 | ~60 LOC code + ~80 LOC tests | 1 | 2–3 hours |
| **Total** | ~290 LOC code + ~200 LOC tests | 2–3 sessions | 1–1.5 days |

### §9.6 Pre-merge checklist

- [ ] All 17 commits land on `claude/add-monitoring-logging-3xMKQ`.
- [ ] `npm run lint` passes.
- [ ] `npx tsc --noEmit` passes.
- [ ] `bash scripts/run-all-unit-tests.sh` passes (includes new pure-helper + invariant tests).
- [ ] `npm run test:gates` passes (gate-cadence rule — pre-merge only).
- [ ] V1 (manual log-buffer round trip) executed and passed in staging.
- [ ] V2 (3 DLQ round trips) executed and passed.
- [ ] V3 (async-mode toggle test) executed and passed.
- [ ] V4 (workflow failure surfaces) executed and passed.
- [ ] V5 (webhook 5xx surfaces) executed and passed.
- [ ] V6 (skill-analyzer dedup) executed and passed.
- [ ] V7 (end-to-end with log evidence in diagnosis) executed and passed.
- [ ] `architecture.md § System Monitor` updated to reflect new coverage list.
- [ ] `pr-reviewer` returns PASS or findings addressed.
- [ ] `dual-reviewer` (if user-triggered for Phase 2) returns PASS or findings addressed.

---

## §10 Deferred items + open questions

### §10.1 Deferred items (Tier 2 — before production rollout)

These items are NOT in this spec but should land before production. Each gets its own follow-up spec.

- **G4 — full `createWorker` conversion of remaining `maintenance:*` queues.** ~14 raw `boss.work` registrations in `server/services/queueService.ts` that are out of scope for this spec. Phase 2 of this spec only covers workflow engine + IEE. Reason for deferral: would dwarf this spec's surface; touches a single ~1100-line file. Follow-up: `2026-04-DD-monitoring-coverage-maintenance-queues-spec.md` (post-merge).
- **G6 — `skillExecutor` retry-exhaustion incident path.** Touches retry-count plumbing in `skillExecutor.ts`. Skill executions with `onFailure: 'retry'` / `'skip'` / `'fallback'` currently log but never produce incidents on persistent failure. Reason for deferral: requires retry-count threading; bigger surface than the rest of this spec. Follow-up spec or extend `system-monitoring-agent-fixes` Tier 2.
- **G9 — add `'webhook'` to `SystemIncidentSource` enum.** Requires a migration. Webhook 5xx incidents in this spec land as `source: 'route'` with `fingerprintOverride: 'webhook:*:*'` so they're disambiguable. Reason for deferral: avoids a migration in this spec. Follow-up: combine with G15 in a single migration if both end up needing one.
- **G13 — adapter-level `recordIncident` calls.** Per-adapter audit needed across `server/adapters/{ghl,slack,stripe,teamwork}.ts`. Reason for deferral: needs care to avoid emitting on every transient call failure; should pair with a per-adapter retry contract review.
- **G15 — sysadmin-op partial-failure incident emission.** Point audit needed across `orgSubaccountMigrationJob`, `configBackupService`, `dataRetentionService`, `scheduledTaskService`. Reason for deferral: low-frequency operations; testing-pass priority is lower than the higher-frequency surfaces this spec covers.

### §10.2 Deferred items (Tier 3 — post-launch polish)

These are not blockers for testing or production rollout.

- **G10 — new agent read skills.** Add `read_agent_definition`, `read_recent_incidents`, `read_pgboss_queue_state`, `read_org_subaccount_summary`. Each ~50 LOC following existing pattern. Improves diagnosis depth.
- **G12 — new synthetic checks.** HITL approval timeout, workflow stuck non-terminal, scheduled-task dispatch silence, skill silence, brief artefact rejection rate. Each 30–50 LOC. Adds silent-failure detection.
- **G14 — Redis-backed `processLocalFailureCounter`.** Multi-instance deploy concern. Currently process-local; documented limitation. Phase 0.75 hardening item.
- **Cross-incident clustering exposed to triage agent.** Currently the agent can't ask "is this part of a cluster of N similar incidents in the last hour?". Requires a new read skill.
- **Per-triage byte cap on agent reads.** Token-budget defence in depth. Trigger-model token budget already covers worst case.
- **`confidence: 'insufficient'` value on agent diagnoses.** Cosmetic — `'low'` + the word "insufficient" in hypothesis text covers it today.
- **Phase 0.75 — push channels.** Email/Slack on critical incidents. Already deferred per `phase-A-1-2-spec.md` Q1.
- **Phase 3 — auto-remediation.** Already deferred per spec.

### §10.3 Open questions

#### OQ1 — Should `dlqMonitorService` use `createWorker`?

The current `startDlqMonitor` uses raw `boss.work(...)` (audit log §4.2.4 Class C). It DOES emit `recordIncident`, so it's not a coverage gap — but it bypasses `createWorker`'s retry/timeout/error-classification. Decision pending: convert in this spec, defer to follow-up, or document as intentional?

**Recommendation:** defer. The DLQ subscription handler is a thin function (~10 LOC); the `createWorker` benefits (retry, timeout) are less relevant for a job that just records an incident. Document as intentional in a code comment.

#### OQ2 — Should `JOB_CONFIG[*].deadLetter` follow a typed convention?

Today `deadLetter` is `string | undefined`. Phase 1's invariant test asserts it's always present. Should the type system force this?

**Recommendation:** convert `JOB_CONFIG` entries to a Drizzle-style branded type or a TS satisfies clause that enforces `deadLetter: string`. Out of scope for this spec; routed to a follow-up.

#### OQ3 — When does `system-monitor-ingest` queue's DLQ subscriber fire, and how should the meta-incident be styled?

If async ingest fails 3 times and lands in `system-monitor-ingest__dlq`, the DLQ subscriber records an incident with `fingerprintOverride: 'job:system-monitor-ingest:dlq'`. This is a "the incident pipeline is broken" signal — should it have higher severity than the default `'high'`?

**Recommendation:** keep at `'high'`. Critical-severity is reserved for production-down events, and a degraded-but-functioning ingest pipeline (sync mode is still working in parallel) doesn't qualify. Self-check job (`systemMonitorSelfCheckJob.ts`) already handles the more severe "ingest is fully degraded" case.

#### OQ4 — Should the logger `appendLogLine` lazy-import path be eager once buffer module is verified safe?

The lazy import is a defensive choice. If the buffer module proves stable, an eager import shaves a microtask off every log call.

**Recommendation:** start lazy; convert to eager in a follow-up after Phase 1 lands and the buffer's import safety is verified. Not blocking.

#### OQ5 — Cross-instance log buffer (Redis-backed)?

Multi-instance deploys mean log lines from instance A aren't visible to instance B. The triage agent could be running on B and asking for a correlation ID whose lines are on A.

**Recommendation:** out of scope. Pre-production we run a single instance. Ties to G14 — same multi-instance hardening pass.

### §10.4 Stuff this spec is intentionally silent about

- Frontend changes (none).
- Migration sequencing (none in this spec).
- Cron schedules (no changes).
- pg-boss version pinning (no changes).
- LLM model selection for the triage agent (no changes).
- The triage agent's prompt or Investigate-Fix Protocol (no changes).
- The admin UI surface (no changes).
- Permission system (no changes — all routes touched are sysadmin-gated already).
- `architecture.md` updates beyond the System Monitor section.

### §10.5 Tracking

- **Audit log:** `tasks/review-logs/codebase-audit-log-monitoring-coverage-2026-04-28T06-09-11Z.md`
- **Build slug:** `tasks/builds/system-monitoring-coverage/`
- **Progress doc:** `tasks/builds/system-monitoring-coverage/progress.md`
- **Branch:** `claude/add-monitoring-logging-3xMKQ`
- **Predecessor follow-up backlog:** `tasks/post-merge-system-monitor.md` (entries Tier 2+ remain there)
- **Current focus pointer:** update `tasks/current-focus.md` to point at this spec when implementation begins.

---

**End of spec.**
