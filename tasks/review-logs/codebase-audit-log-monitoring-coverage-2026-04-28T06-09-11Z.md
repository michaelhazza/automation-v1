# Codebase Audit — System Monitoring Coverage

**Scope:** Targeted audit (two passes)
1. **Audit A** — does the System Monitor agent have everything it needs to read evidence, form diagnoses, and emit Investigate-Fix prompts?
2. **Audit B** — is every action surface in the codebase (skills, agents, automations, jobs, webhooks, sysadmin/org-user/sub-account operations) instrumented so that failures or potential issues become visible to the System Monitor agent?

**Mode:** Audit only (per `docs/codebase-audit-framework.md` three-pass model). No code changes in this log. Findings + recommendations only — implementation routed to `tasks/todo.md` once the user signs off.

**Date:** 2026-04-28
**Branch:** `claude/add-monitoring-logging-3xMKQ`
**Source documents consulted:**
- `tasks/builds/system-monitoring-agent/phase-0-spec.md`
- `tasks/builds/system-monitoring-agent/phase-A-1-2-spec.md`
- `tasks/builds/system-monitoring-agent-fixes/spec.md`
- `tasks/post-merge-system-monitor.md`
- `architecture.md` § System Monitor (Phase 0 + 0.5)
- All `recordIncident` call sites + all pg-boss queue registrations across `server/`

---

## Table of contents

1. [Executive summary + readiness verdict](#1-executive-summary--readiness-verdict)
2. [System Monitor agent — inventory of what it has today](#2-system-monitor-agent--inventory-of-what-it-has-today)
3. [System Monitor agent — gaps that limit its diagnostic ability](#3-system-monitor-agent--gaps-that-limit-its-diagnostic-ability)
4. [Action surface coverage matrix](#4-action-surface-coverage-matrix)
5. [Critical incident-emission gaps with file:line evidence](#5-critical-incident-emission-gaps-with-fileline-evidence)
6. [Recommended actions, ranked](#6-recommended-actions-ranked)
7. [Pre-test readiness verdict + verification plan](#7-pre-test-readiness-verdict--verification-plan)

---

## 1. Executive summary + readiness verdict

**Headline verdict: NOT READY for the "every action is monitored" workflow you described, but the substrate is solid and the gaps are closeable inside one focused branch.**

The System Monitor agent itself is in good shape — Phase 0/0.5 sink is live (PR #188 merged), Phase A foundations (system principal, baselining, heuristic registry) are merged (PR #215), and the Tier-1 hardening branch (`system-monitoring-agent-fixes`, spec at `tasks/builds/system-monitoring-agent-fixes/spec.md`) closed five known correctness holes. 23 heuristics are registered. 8+ synthetic checks are wired. The triage agent has a stored prompt with a structured Investigate-Fix Protocol (`server/services/systemMonitor/triage/agentSystemPrompt.ts`).

**The blocker for "every action is flagged for review" is on the producer side, not on the agent side.** Two systemic gaps stand out:

1. **DLQ subscription coverage is ~25%.** `dlqMonitorService.ts` watches 8 dead-letter queues. `JOB_CONFIG` declares **31 queues with `deadLetter:` defined**, plus another **~20 queues that bypass `JOB_CONFIG` entirely** (raw `boss.work(...)` registrations in `queueService.ts` and `workflowEngineService.ts`). Failures in any unmonitored DLQ — including all of IEE, all of workflow engine, skill-analyzer, every `maintenance:*` job, payment reconciliation, regression replay, and connector-polling-sync — land in the database as failed pg-boss jobs and **never** become incidents the agent can see.

2. **The `read_logs_for_correlation_id` skill has no producer.** `server/services/systemMonitor/logBuffer.ts` defines `appendLogLine`, and the skill (`server/services/systemMonitor/skills/readLogsForCorrelationId.ts`) reads from it, but `server/lib/logger.ts` never calls `appendLogLine`. The log buffer is permanently empty, so the agent's primary investigative lookup ("show me the log lines for this correlation ID") returns nothing in production. This silently degrades every triage diagnosis.

A third gap — `incidentIngestorAsyncWorker.handleSystemMonitorIngest` is defined but never registered as a pg-boss worker — is dormant under the default sync mode but becomes a data-loss bug the moment anyone sets `SYSTEM_INCIDENT_INGEST_MODE=async`.

Eleven additional gaps are catalogued below (§5). All are mechanically fixable. None require redesigning the agent or the schema.

### Severity-ranked summary

| ID | Gap | Severity | Effort to close |
|---|---|---|---|
| **G1** | DLQ subscription coverage ~25%; ~23 dead-letter queues unsubscribed | **CRITICAL** | Small (extend `DLQ_QUEUES` array; consider deriving from `JOB_CONFIG`) |
| **G2** | `logBuffer` never populated; `read_logs_for_correlation_id` always empty | **CRITICAL** | Small (logger adapter to call `appendLogLine` when `correlationId` present) |
| **G3** | `incidentIngestorAsyncWorker.handleSystemMonitorIngest` defined but never registered | **HIGH** (latent) | Trivial (register on boot when async mode) |
| **G4** | ~20 queues bypass `JOB_CONFIG` (no retry/timeout/DLQ): all `maintenance:*` after the first 4, `orchestrator-from-task`, `system-monitor-self-check`, `subscription-trial-check`, all 3 workflow engine queues | **CRITICAL** | Medium (move to `createWorker` + add `JOB_CONFIG` entries) |
| **G5** | 6 queues in `JOB_CONFIG` with no `deadLetter:` at all (`slack-inbound`, `agent-briefing-update`, `memory-context-enrichment`, `page-integration`, `iee-cost-rollup-daily`, `connector-polling-tick`) — failed jobs sit in `failed` state, invisible to the DLQ monitor | **HIGH** | Small (add deadLetter entries, then close G1 covers them) |
| **G6** | `skillExecutor` only emits incidents on `onFailure='fail_run'` — `retry`/`skip`/`fallback` failures never surface | **HIGH** | Small (emit at last-retry exhaustion + on persistent `skip`/`fallback`) |
| **G7** | Webhook routes (`ghlWebhook.ts`, `slackWebhook.ts`, `teamworkWebhook.ts`) bypass `asyncHandler` in 5xx paths — log only, no `recordIncident` | **HIGH** | Small (wrap the handlers, or call `recordIncident` directly in 5xx branches) |
| **G8** | Worker handlers registered via raw `boss.work(...)` (workflow engine, IEE, slack-inbound, etc.) throw to pg-boss but **never** call `recordIncident` on the failure path. Coverage relies entirely on DLQ monitor — see G1+G4 | **HIGH** | Medium (collapses into G1+G4 once `createWorker` is the only path) |
| **G9** | No `webhook` value in `SystemIncidentSource` enum (`server/db/schema/systemIncidents.ts:10`) — webhook failures collapse into `route` or `self`, can't be filtered as a class | **MEDIUM** | Trivial (add enum value + migration + classify path in `incidentIngestorPure.ts`) |
| **G10** | Agent's read skills don't include: read_agent_definition (prompt, bound skills), read_org_or_subaccount_config, read_recent_incidents_cluster, read_pg_boss_queue_state. Limits diagnosis depth | **MEDIUM** | Small per skill (each is ~50 LOC following the existing pattern) |
| **G11** | Skill-analyzer terminal failures (`skillAnalyzerJob.ts`) emit only `logger.error` — no `recordIncident`. Sysadmin-triggered, multi-hour, expensive — silent failure is high-cost | **MEDIUM** | Small (wrap top-level handler) |
| **G12** | Agent-action heuristics (HITL approval timeouts, action retry exhaustion, brief artefact rejection) — no incident emission. Not in the heuristic set, not in the synthetic set | **MEDIUM** | Medium (add 1-2 synthetic checks) |
| **G13** | Connector adapters (`server/adapters/{ghl,slack,stripe,teamwork}.ts`) have zero `recordIncident` calls. Failures only surface via the connector polling service wrapper, which means out-of-band adapter calls (token refresh, webhook posting, push notifications) silently fail | **MEDIUM** | Small (audit each adapter's catch blocks) |
| **G14** | `processLocalFailureCounter` is process-local — multi-instance deploys under-count globally (already documented in code, but worth flagging as a launch-time consideration) | **LOW** | Out-of-scope for launch |
| **G15** | No incident emission on critical sysadmin operations: subaccount migration, config backup/restore, organisation seeding, bundle resolution failures, scheduled-task dispatch failures, OAuth integration token-refresh failures | **MEDIUM** | Medium (point audit; ~10 wrap-and-emit edits) |

### What's working well (do not touch)

- Fingerprinting + dedup. `incidentIngestorPure.ts` is well-tested and the partial unique index on `system_incidents.fingerprint WHERE status IN ('open',...)` aligns with the upsert WHERE clause.
- The triage agent's prompt (`agentSystemPrompt.ts`) is tight, includes the Investigate-Fix Protocol, and forbids auto-remediation.
- Severity escalation never de-escalates within a lifecycle (`maxSeverity` in `incidentIngestorPure.ts`).
- Suppression rule + `suppressedCount` feedback loop is in place.
- AlertFatigueGuard has been generalised; per-fingerprint scoping is correct.
- The 5 Tier-1 fixes from `system-monitoring-agent-fixes` (retry idempotency, staleness sweep, silent-success synthetic, incident-silence synthetic, failed-triage filter) are merged. Most of the obvious correctness holes are already closed.

### Bottom line

The agent is the right shape. The gap is **producer-side coverage**: too many code paths can fail without producing a row in `system_incidents`. Close G1–G8 and the agent will see every action class. G9–G15 are quality improvements that can land post-launch.
