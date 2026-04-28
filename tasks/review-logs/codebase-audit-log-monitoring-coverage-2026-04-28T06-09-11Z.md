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

---

## 2. System Monitor agent — inventory of what it has today

This section is the "definition of done" baseline. Anything not in this list is either missing (G-numbered above) or out of scope for Phase 0–2.5.

### 2.1 Schema (3 tables, all bypass RLS, sysadmin-gated at route layer)

| Table | Rows | Purpose |
|---|---|---|
| `system_incidents` | one per active fingerprint (partial unique index on `fingerprint WHERE status IN ('open','investigating','remediating','escalated')`) | The flagged-for-review surface. Carries severity, status, source, `agent_diagnosis`, `investigate_prompt`, `triage_status`, `triage_attempt_count`, `last_triage_job_id`. |
| `system_incident_events` | append-only audit log | 14+ event types: `occurrence`, `acknowledged`, `resolved`, `escalated`, `escalation_blocked`, `agent_diagnosis_added`, `agent_triage_timed_out`, etc. |
| `system_incident_suppressions` | named mute rules | Carries `suppressedCount`/`lastSuppressedAt` feedback counters so suppressed traffic is still measurable. |
| `system_monitor_baselines` | one per `(entity_kind, entity_id, metric_name)` | Rolling-window p50/p95/p99/mean/stddev/min/max. Refreshed every 15 min. Read via `BaselineReader`. |
| `system_monitor_heuristic_fires` | append-only | Every heuristic fire (clustered later for triage). |

Migration sequence visible in the repo: `0233_phase_a_foundations.sql`, `0239_system_incidents_last_triage_job_id.sql`, `0216_agent_runs_delegation_telemetry.sql`. All schema decisions match the spec.

### 2.2 Source enum (what kinds of failures the agent expects)

`SystemIncidentSource = 'route' | 'job' | 'agent' | 'connector' | 'skill' | 'llm' | 'synthetic' | 'self'` (`server/db/schema/systemIncidents.ts:10`).

Each value has a default severity inference path in `inferDefaultSeverity` (`incidentIngestorPure.ts:66-86`). Notable: `route` 4xx defaults to `low`, 5xx to `medium`; `job` defaults to `high`; `self` defaults to `high`; `connector` defaults to `low`. (Severity escalates monotonically per fingerprint lifecycle via `maxSeverity`.)

### 2.3 Heuristic registry (23 heuristics, code-as-config)

Registered in `server/services/systemMonitor/heuristics/index.ts`. Phase-gated via `SYSTEM_MONITOR_HEURISTIC_PHASES` env var; default both 2.0 and 2.5 active.

| Category | Phase 2.0 (day-one) | Phase 2.5 |
|---|---|---|
| **Agent quality (9)** | `emptyOutputBaselineAware`, `maxTurnsHit`, `toolSuccessButFailureLanguage`, `runtimeAnomaly`, `tokenAnomaly`, `repeatedSkillInvocation`, `finalMessageNotAssistant`, `outputTruncation`, `identicalOutputDifferentInputs` | — |
| **Skill execution (3)** | `toolOutputSchemaMismatch`, `skillLatencyAnomaly`, `toolFailedButAgentClaimedSuccess` | — |
| **Infrastructure (7)** | `jobCompletedNoSideEffect`, `connectorEmptyResponseRepeated` | `cacheHitRateDegradation`, `latencyCreep`, `retryRateIncrease`, `authRefreshSpike`, `llmFallbackUnexpected` |
| **Systemic (4)** | — | `successRateDegradationTrend`, `outputEntropyCollapse`, `toolSelectionDrift`, `costPerOutcomeIncreasing` |

Each heuristic carries `{id, severity, confidence, expectedFpRate, suppressionRules, baselineRequirements}`.

### 2.4 Synthetic checks (10 checks; presence-of-event ≠ heuristics, which check absence of expected events)

Listed in `server/services/systemMonitor/synthetic/index.ts`:

`agentRunSuccessRateLow`, `connectorErrorRateElevated`, `connectorPollStale`, `dlqNotDrained`, `heartbeatSelf`, `incidentSilence`, `noAgentRunsInWindow`, `pgBossQueueStalled`, `silentAgentSuccess`, `sweepCoverageDegraded`.

Run on a 60s tick via `syntheticChecksTickHandler.ts` (queue: `system-monitor-synthetic-checks`). Failures inside one check are isolated — the tick continues even if one check throws.

### 2.5 Triage agent — read skills (9)

In `server/services/systemMonitor/skills/`:

| Skill | What it reads |
|---|---|
| `read_incident` | One incident row + recent events |
| `read_agent_run` | One `agent_runs` row + messages + skill executions |
| `read_recent_runs_for_agent` | Last N runs for an agent (cohort comparison) |
| `read_skill_execution` | One `skill_executions` row |
| `read_baseline` | Rolling window p50/p95 etc. for an `(entity_kind, entity_id, metric)` |
| `read_heuristic_fires` | Recent fires by `(entity_kind, entity_id)` |
| `read_connector_state` | Last poll, lease, error count for a connector |
| `read_dlq_recent` | Recent DLQ entries for a queue |
| `read_logs_for_correlation_id` | **NON-FUNCTIONAL — see G2.** Process-local rolling buffer; reads from `logBuffer.ts` which has no producer. |

### 2.6 Triage agent — write skills (2, narrowly scoped)

| Skill | Effect |
|---|---|
| `write_diagnosis` | Updates the incident row's `agent_diagnosis` JSON + `investigate_prompt` text. Predicated on `triage_status='running'` (post-fix) so terminal-transition races are detected. |
| `write_event` | Appends an `agent_diagnosis_added` row to `system_incident_events`. |

The agent has **no other write access**. Auto-remediation is explicitly out of scope (Phase 3 deferred — see `phase-A-1-2-spec.md` Q12).

### 2.7 Triage agent — system prompt + Investigate-Fix Protocol

`server/services/systemMonitor/triage/agentSystemPrompt.ts` is the single source of truth for the prompt. Seeded into `system_agents.master_prompt` for the `system_monitor` row. Imports same module at runtime (no drift between seeded value and live prompt).

The prompt enforces:
- Diagnose only — no remediation
- Honest uncertainty (low/medium/high confidence + alternative hypothesis)
- Cite evidence (row id, file:line, baseline reading, heuristic fire id)
- Surface what cannot be seen (thin evidence is a valid output)
- Two artefacts per triage: structured diagnosis JSON + paste-ready Investigate-Fix prompt
- Token budget: 400–800 target, 1,500 hard cap

The prompt embeds the full Investigate-Fix Protocol structure (Protocol, Incident, Problem statement, Evidence, Hypothesis, Investigation steps, Scope, Expected output, Approval gate). All required sections are listed. Forbidden constructs are explicit (no auto-fix instructions, no commit/push/deploy without approval).

### 2.8 Job queues the agent owns

| Queue | Purpose | Cadence |
|---|---|---|
| `system-monitor-ingest` | Async-mode incident ingest (consumed by `incidentIngestorAsyncWorker` — **see G3, worker not registered**) | Per-incident enqueue |
| `system-monitor-notify` | WebSocket broadcast on incident open/update | Per-incident enqueue |
| `system-monitor-triage` | Run the agent against one incident | Per-incident, severity ≥ medium, after dedup |
| `system-monitor-sweep` | Run heuristic registry over last 15 min of activity | Every 5 min |
| `system-monitor-synthetic-checks` | Run all synthetic checks | Every 60 s |
| `system-monitor-baseline-refresh` | Refresh baseline materialisation | Every 15 min |
| `system-monitor-self-check` | Detect ingest-pipeline degradation (process-local) | Every 5 min |

### 2.9 Admin UI

`/system/incidents` (`SystemIncidentsPage.tsx`):
- Sortable/filterable incident table
- Inline detail drawer with ack / resolve / suppress / escalate
- WebSocket-updated nav badge (`system_incident:updated` event)
- Diagnosis filter pill: `all / diagnosed / awaiting / not-triaged / failed-triage` (post Tier-1 fix)
- Test-incident flag hides synthetic / dev incidents from default list

This is the surface the operator copies the Investigate-Fix prompt from when invoking the protocol.

### 2.10 What this all adds up to

The agent has the full pipeline from "fingerprint dedup → heuristic fire / synthetic fire / direct ingest → triage → diagnosis → paste-ready prompt → operator". The structural surface is complete. **The only structural item missing is the log buffer producer (G2).** Everything else flagged in this audit is producer-side: code paths that should emit `recordIncident(...)` but don't.

---

## 3. System Monitor agent — gaps that limit its diagnostic ability

These are gaps **in the agent itself** (its skills, prompt, evidence reach). Producer-side gaps (i.e., code paths that should emit incidents but don't) are catalogued in §4–§5.

### 3.1 G2 — `read_logs_for_correlation_id` is non-functional

**Severity: CRITICAL.**

`server/services/systemMonitor/logBuffer.ts` exports `appendLogLine(line: LogLine): void` and a 1000-line/500 KB rolling buffer keyed by correlation ID. The skill `read_logs_for_correlation_id` (`server/services/systemMonitor/skills/readLogsForCorrelationId.ts:1-50`) reads from this buffer and is the agent's primary mechanism for following a single request/run end-to-end.

`grep -rn "appendLogLine" server` shows the function is **defined and imported by the skill, but never called by anything**. The logger (`server/lib/logger.ts:34-43`) emits to `console.{log,warn,error}` only.

**Effect:** every call to `read_logs_for_correlation_id` returns `{success: true, lineCount: 0, lines: []}`. The agent is told "no log lines" and is forced to diagnose without runtime context. It will silently downgrade confidence on every triage. There is no error to flag the gap — the skill returns success.

**Fix shape:** in `server/lib/logger.ts`, add an `appendLogLine` call inside `emit(entry)` when `entry.correlationId` is present. Keep it import-light (no DB, no async) so the logger stays pure. ~10 LOC. Spec authority: this matches `phase-A-1-2-spec.md § Phase A foundations` intent for the log buffer.

### 3.2 Missing read skills the agent will reach for and cannot find

The current 9 read skills cover runs, skills, baselines, heuristic fires, connectors, DLQ, and (broken) logs. The triage prompt encourages the agent to cite stable resource identifiers and surface what it cannot see — but the following common questions have no skill:

| Question the agent will ask | Today's answer | Fix |
|---|---|---|
| "What does this agent's prompt look like?" | No skill — agent only sees the run, not the agent definition | Add `read_agent_definition(agentId)` |
| "What recent incidents share this fingerprint or this organisation?" | No skill — must infer from events on a single incident | Add `read_recent_incidents(filters)` |
| "What's the queue state right now? Backlog, active, failed counts?" | No skill — only `read_dlq_recent` for one queue | Add `read_pgboss_queue_state(queueName)` |
| "What organisation / subaccount / config governs this run?" | No skill | Add `read_org_subaccount_summary(orgId, subaccountId?)` |
| "What's the recent history of the same incident fingerprint over time?" | Partial — `read_incident` returns events for one row; no cross-fingerprint history | Extend `read_incident` to return prior closed rows for the same fingerprint |
| "Did this run touch any external integration (connector adapter call)?" | No skill — only connector polling state | Add `read_connector_calls_for_run(runId)` once adapter call telemetry exists |

**Severity: MEDIUM.** Each missing skill measurably narrows the diagnosis. The agent's prompt explicitly asks it to "surface what you cannot see" — adding these skills lets it actually see them. None are launch blockers individually, but together they are the difference between "useful diagnosis" and "thin diagnosis".

### 3.3 No skill to clusterise across incidents

`server/services/systemMonitor/triage/clusterFires.ts` clusters heuristic fires for the sweep handler, but there is **no read-skill** that exposes this clustering to the triage agent during diagnosis. So the agent triaging incident A cannot ask "is this part of a cluster of N similar incidents in the last hour?" — it must infer from the single fingerprint.

**Severity: LOW.** Useful but not critical. The fingerprint dedup already collapses identical occurrences, so the temporal clustering primarily matters for "different fingerprints, same root cause" scenarios.

### 3.4 Synthetic checks don't include action-execution-layer absence

The 10 synthetic checks cover: agent run rates, connector poll freshness, DLQ drain, heartbeat, incident silence, queue stalled, silent agent success, sweep coverage. They do **not** cover:

- **HITL approval timeouts** — an action sitting in `pending_review` for X hours with no human action. Should produce a synthetic-check incident the operator can triage.
- **Workflow run stuck in non-terminal state** — beyond the watchdog's tick, an integration-style "no progress in N hours" check.
- **Skill execution silence per skill** — a skill that historically fires N times/day suddenly fires 0 today.
- **Brief artefact rejection rate** — % of artefacts being rejected by users. Quality regression signal.
- **Scheduled task dispatch silence** — a schedule that should have produced a run in the last hour didn't.

**Severity: MEDIUM.** Each is a "silent-failure" class the error sink cannot see. Adds to the agent's evidence base. Each new check is ~30–50 LOC following the existing `SyntheticCheck` interface (`syntheticChecksPure.ts`).

### 3.5 Agent reads are unbounded — risk of token blow-up on busy days

The triage agent reads up to 50 runs / 200 KB per sweep cluster (per spec Q8). But **per-incident** triage reads (`read_recent_runs_for_agent`, `read_heuristic_fires`, etc.) have no global cap on total bytes consumed in one triage. A single triage that bounces through 5–6 reads can blow past 1 MB of evidence input → token cost on the trigger model.

**Severity: LOW.** Token budgets at the trigger-model layer should catch this, but a per-triage byte cap with truncation-and-warn is more defensible. Not a launch blocker.

### 3.6 No "I don't know" fallback emission

The prompt allows the agent to write "Hypothesis: insufficient evidence" — but doesn't write a structured signal anywhere that consumers (e.g., a future "needs human investigation now" filter) can pick up. The diagnosis row carries `confidence: low | medium | high`, but there's no `confidence: insufficient` value.

**Severity: LOW.** Cosmetic — `confidence: 'low'` plus the word "insufficient" in the hypothesis text covers the case. Worth noting only because the human-fallback workflow may eventually want the explicit signal.

### 3.7 Summary of agent-side gaps

| ID | Gap | Severity |
|---|---|---|
| G2 | `logBuffer` has no producer; `read_logs_for_correlation_id` always empty | CRITICAL |
| G10 | Missing read skills: agent definition, cross-incident history, queue state, org/subaccount summary | MEDIUM |
| G12a | Missing synthetic checks: HITL timeout, workflow stuck, scheduled-task silence, skill silence, brief artefact rejection rate | MEDIUM |
| (3.3) | No skill exposes cross-incident clustering | LOW |
| (3.5) | Per-triage byte cap not enforced | LOW |
| (3.6) | No `confidence: 'insufficient'` value | LOW |

The CRITICAL one (G2) is mechanical and ~10 LOC. The MEDIUM ones add visible diagnostic value but are not launch blockers. The LOW ones are post-launch polish.
