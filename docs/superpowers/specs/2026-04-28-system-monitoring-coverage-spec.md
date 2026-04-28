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
