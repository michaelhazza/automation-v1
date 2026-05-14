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

---

## 4. Action surface coverage matrix

This section enumerates every action class the user mentioned ("anything that can execute, anything that can run, anything that is actioned") and grades whether its failure paths reach the System Monitor agent.

Legend:
- **✓** — covered: failure produces a `system_incidents` row (directly or through DLQ + DLQ subscription).
- **partial** — some failure modes covered, others slip through.
- **✗** — not covered: failures are `logger.error`-only, or land in pg-boss `failed`/DLQ with no DLQ subscription, or surface only as exceptions to the user.

### 4.1 HTTP routes (all subdomains: org user, sub-account user, sysadmin)

| Surface | Coverage | Mechanism | Notes |
|---|---|---|---|
| Routes wrapped in `asyncHandler` (5xx) | ✓ | `server/lib/asyncHandler.ts:43-62` calls `recordIncident({source: 'route'})` on every 5xx | Most routes use this |
| Global error handler (5xx) | ✓ | `server/index.ts:411-432` calls `recordIncident({source: 'route'})` for any 5xx that escapes asyncHandler | Catch-all safety net; uses `__incidentRecorded` dedup flag |
| Routes that bypass `asyncHandler` and write `res.status(500)` directly | partial | Logged via `logger.error`/`console.error` but no `recordIncident` unless they then `throw` (the global handler then catches it) | Audit each manual `res.status(500)` site |
| **GHL webhook** (`server/routes/webhooks/ghlWebhook.ts:64-67`) | ✗ | DB lookup failure path returns `res.status(500)` directly without throwing — no incident emitted | **G7 — fix** |
| **Slack webhook** (`server/routes/webhooks/slackWebhook.ts`) | partial | Wraps in `asyncHandler`; covered for 5xx but the explicit `res.status(401/400)` paths log and return — fine for user_fault | OK |
| **Teamwork webhook** (`server/routes/webhooks/teamworkWebhook.ts`) | partial | Same as Slack — wrapped, but inspect for explicit non-throw 5xx paths | Audit |
| **GitHub webhook** (`server/routes/githubWebhook.ts:80-125`) | ✗ | `try/catch` around handler with `logger.error('github_webhook.handler_error', …)` and **no `recordIncident`** — 401/400 paths exit before async work | **G7 — fix** |
| **GHL OAuth callback** (`server/routes/ghl.ts:43`) | ✓ | Wrapped in `asyncHandler` — covered for 5xx | OK |
| 4xx user_fault classification | ✓ | `classify(input)` in `incidentIngestorPure.ts:55-60` flips 4xx + validation/auth categories to `user_fault` so they don't pollute the system_fault stream | OK |
| Routes producing 5xx but excluded from incident emission (any?) | TBD | None found in code search; if any exist they'd need to use a `silentFailure` flag (not currently a thing) | Confirmed none |

**Verdict:** Routes are **mostly covered**. Action: fix G7 — non-asyncHandler-wrapped 5xx paths in webhook routes.

### 4.2 Pg-boss jobs

This is where the biggest gaps are. Three classes:

#### 4.2.1 Class A — `JOB_CONFIG` queues with `deadLetter:` declared

31 queues. `dlqMonitorService.ts:14-23` subscribes to **8** of them. The other **23 are unsubscribed**: jobs reach the DLQ but no incident is created.

Subscribed (✓):
```
agent-scheduled-run, agent-org-scheduled-run, agent-handoff-run, agent-triggered-run,
execution-run, workflow-resume, llm-aggregate-update, llm-monthly-invoices
```

NOT subscribed (✗):
```
llm-reconcile-reservations, payment-reconciliation, stale-run-cleanup,
maintenance:cleanup-execution-files, maintenance:cleanup-budget-reservations,
maintenance:memory-decay, maintenance:security-events-cleanup, maintenance:memory-dedup,
clientpulse:propose-interventions, clientpulse:measure-outcomes,
agent-run-cleanup, priority-feed-cleanup, regression-capture, regression-replay-tick,
llm-clean-old-aggregates,
iee-browser-task, iee-dev-task, iee-cleanup-orphans, iee-run-completed,
skill-analyzer,
workflow-run-tick, workflow-watchdog, workflow-agent-step, workflow-bulk-parent-check,
connector-polling-sync
```

This is **G1** in the executive summary.

#### 4.2.2 Class B — `JOB_CONFIG` queues with NO `deadLetter:` at all

Failures stay in pg-boss `failed` state forever, invisible to `dlqMonitorService` even after fix:

```
slack-inbound, agent-briefing-update, memory-context-enrichment,
page-integration, iee-cost-rollup-daily, connector-polling-tick
```

This is **G5** in the executive summary.

#### 4.2.3 Class C — queues registered with raw `boss.work(...)` outside `JOB_CONFIG`

These bypass `createWorker` (no centralised retry/timeout/error classification) and have neither retry config nor DLQ:

```
maintenance:fast-path-decisions-prune
maintenance:rule-auto-deprecate
maintenance:fast-path-recalibrate
maintenance:llm-ledger-archive
maintenance:llm-started-row-sweep
maintenance:stale-analyzer-job-sweep
maintenance:llm-inflight-history-cleanup
maintenance:memory-entry-decay
memory-hnsw-reindex
memory-blocks-embedding-backfill
maintenance:clarification-timeout-sweep
maintenance:iee-main-app-reconciliation
maintenance:memory-entry-quality-adjust
maintenance:memory-block-synthesis
maintenance:bundle-utilization
maintenance:portfolio-briefing
maintenance:portfolio-digest
maintenance:protected-block-divergence
system-monitor-self-check
subscription-trial-check
orchestrator-from-task
```

Plus three workflow engine queues that bypass `createWorker`:
```
workflow-run-tick, workflow-watchdog, workflow-agent-step
```
(though these *do* have entries in `JOB_CONFIG` — they're double-counted in Class A as well, since they have `deadLetter:` declared but the `boss.work` registration doesn't go through `createWorker`).

This is **G4** in the executive summary.

#### 4.2.4 Job summary

The agent today sees: failures of 8 queues out of ~50+ active queues. ~25% coverage.

### 4.3 Agent runs

| Failure mode | Coverage | Mechanism |
|---|---|---|
| Terminal `failed` / `timeout` / `loop_detected` | ✓ | `agentExecutionService.ts:1528-1538` calls `recordIncident({source: 'agent'})` |
| Run completed=true but no side effects | ✓ | `silentAgentSuccess` synthetic check + `silentAgentSuccessPure` |
| Run completed but ≥2 heuristic fires | ✓ | sweep handler clusters fires, opens incident, schedules triage |
| Run never started (scheduled but no row) | partial | `noAgentRunsInWindow` synthetic check covers global silence; per-schedule silence not covered |
| HITL approval timeout | ✗ | No synthetic check; rows sit `pending_review` indefinitely |

### 4.4 Skill executions

| Failure mode | Coverage | Mechanism |
|---|---|---|
| `onFailure: 'fail_run'` and skill throws | ✓ | `skillExecutor.ts:347-359` calls `recordIncident({source: 'skill'})` |
| `onFailure: 'retry'` and skill exhausts retries | ✗ | Only logs; no incident even after all retries fail |
| `onFailure: 'skip'` / `'fallback'` and skill failed | ✗ | Result returned but no incident; persistent failure invisible |
| Tool output schema mismatch | ✓ | `toolOutputSchemaMismatch` heuristic |
| Tool succeeded but agent claimed failure | ✓ | `toolFailedButAgentClaimedSuccess`, `toolSuccessButFailureLanguage` heuristics |
| Skill latency anomaly | ✓ | `skillLatencyAnomaly` heuristic (Phase 2.5) |

This is **G6** in the executive summary.

### 4.5 LLM router

| Failure mode | Coverage | Mechanism |
|---|---|---|
| All providers exhausted | ✓ | `llmRouter.ts:1096-1105` |
| Single provider failure with successful fallback | partial | Logged, no incident (correct — fallback worked) |
| Unexpected fallback chain length | ✓ | `llmFallbackUnexpected` heuristic (Phase 2.5) |
| Cost-per-outcome regression | ✓ | `costPerOutcomeIncreasing` heuristic (Phase 2.5) |
| `CLASSIFICATION_PARSE_FAILURE` / `RECONCILIATION_REQUIRED` | ✓ | High-severity inference path in `inferDefaultSeverity` |

### 4.6 Connectors / integration adapters

| Failure mode | Coverage | Mechanism |
|---|---|---|
| Connector polling sync failure | ✓ | `connectorPollingService.ts:82, 298` calls `recordIncident({source: 'connector'})` with `connector:<type>:sync_failed` fingerprint |
| Connector connection error | ✓ | Same module |
| Connector empty response repeated | ✓ | `connectorEmptyResponseRepeated` heuristic |
| Connector poll stale | ✓ | `connectorPollStale` synthetic check |
| Connector error rate elevated | ✓ | `connectorErrorRateElevated` synthetic check |
| **Adapter direct calls** (`server/adapters/{ghl,slack,stripe,teamwork}.ts`) | ✗ | Zero `recordIncident` calls in `server/adapters/`. Out-of-band token refresh, send-message, push-notification calls fail silently |
| Webhook signature failure | partial | `logger.warn`; correctly *not* an incident (4xx, user_fault) |

This is **G13** in the executive summary.

### 4.7 IEE (Integrated Execution Environment)

| Failure mode | Coverage | Mechanism |
|---|---|---|
| `iee-browser-task` / `iee-dev-task` exhausts retries | ✗ | DLQ defined but not subscribed — see G1 |
| `iee-cleanup-orphans` failure | ✗ | Same |
| `iee-run-completed` reconnect failure | ✗ | Same |
| `iee_runs` row stuck in non-terminal state | ✗ | No synthetic check (the `cleanup-orphans` job is the only safety net; if it fails, no signal) |
| `iee-cost-rollup-daily` failure | ✗ | No DLQ; sits `failed` in pg-boss — see G5 |

### 4.8 Workflows engine

| Failure mode | Coverage | Mechanism |
|---|---|---|
| `workflow-run-tick` exhausts retries | ✗ | DLQ defined but not subscribed — see G1; also bypasses `createWorker` — see G4 |
| `workflow-watchdog` failure | ✗ | Same |
| `workflow-agent-step` exhausts retries | ✗ | Same |
| `workflow-bulk-parent-check` failure | ✗ | Same |
| Workflow run stuck in non-terminal state past expected runtime | partial | Watchdog handles missed ticks; no synthetic check on "watchdog itself silent for >N min" |

### 4.9 Skill analyzer (sysadmin-triggered, ~hours-long, expensive)

| Failure mode | Coverage | Mechanism |
|---|---|---|
| Job throws inside handler | ✗ | Logs `logger.error('[skillAnalyzer] …')` but no `recordIncident` |
| Stale execution lock cleared | partial | `logger.warn` only |
| Proposed agent soft-create fails | partial | `logger.warn` only |
| Job exhausts retries → DLQ | ✗ | DLQ defined (`skill-analyzer__dlq`) but not subscribed — see G1 |
| Job timed out at 4-hour cap | ✗ | Same |
| Phantom backup cleanup fails | partial | `logger.warn` only |

This is **G11**. A multi-hour expensive sysadmin job can fail silently. Critical for the operator workflow.

### 4.10 Sysadmin admin operations

| Surface | Coverage | Notes |
|---|---|---|
| `adminOpsService.ts` operations (route-mediated) | ✓ | Wrapped in `asyncHandler`; 5xx → incident |
| `configBackupService.ts` (config backup/restore) | partial | 5xx covered by route wrapper; mid-operation partial failures not flagged |
| `dataRetentionService.ts` | partial | Logger-only on partial failures |
| `orgSubaccountMigrationJob.ts` | ✗ | Bypasses `recordIncident`; failure mode = log-only |
| `regressionCaptureService.ts` failure | ✗ | DLQ defined but not subscribed — see G1 |
| `subscriptionTrialCheck` cron | ✗ | Raw `boss.work` registration; no DLQ — see G4 |
| OAuth integration token refresh | ✗ | Adapter-level — see G13 |
| Bundle resolution failures | partial | Surface as `cached_context_budget_breach` HITL action when applicable; outright failures may slip |
| Schedule dispatch failure (a schedule didn't fire) | ✗ | No synthetic check |
| Memory decay / dedup / synthesis failures | ✗ | All bypass `JOB_CONFIG` — see G4 |

This is **G15** in the executive summary.

### 4.11 Brief / artefact / conversation operations

| Failure mode | Coverage | Mechanism |
|---|---|---|
| Brief lifecycle conflict | partial | `briefConversationWriter` logs + counters; no incident even on persistent rate elevation |
| Artefact validation rejection | partial | Counter only (`artefactsValidationRejectedTotal`); no incident threshold |
| Brief artefact over-limit | partial | Counter only |
| Brief fast-path classification failure | ✗ | Logger only |

### 4.12 WebSocket / push channels

| Failure mode | Coverage |
|---|---|
| `system_incident:updated` broadcast failure | partial — caught in `systemIncidentNotifyJob.ts`; logs warning. Spec accepts this as best-effort |
| WebSocket auth failure | ✗ — not in scope of incident sink |
| Push channel delivery (Phase 0.75 deferred) | n/a |

### 4.13 Cumulative coverage

| Layer | Coverage |
|---|---|
| HTTP routes (asyncHandler-wrapped) | ✓ |
| HTTP routes (manual `res.status(500)`, esp. webhooks) | ✗ G7 |
| pg-boss DLQ — JOB_CONFIG subset (8/31) | partial G1 |
| pg-boss DLQ — JOB_CONFIG no-deadLetter (6 queues) | ✗ G5 |
| pg-boss raw `boss.work` (no JOB_CONFIG, ~20 queues) | ✗ G4 |
| Agent runs (terminal failure) | ✓ |
| Agent runs (HITL timeout, schedule silence) | ✗ |
| Skill executions (`fail_run` only) | partial G6 |
| LLM router | ✓ |
| Connector polling | ✓ |
| Connector adapter direct calls | ✗ G13 |
| IEE | ✗ — collapses into G1+G5+G4 |
| Workflows engine | ✗ — collapses into G1+G4 |
| Skill analyzer | ✗ G11 |
| Sysadmin operations (most) | partial G15 |
| Async incident ingestor (when enabled) | ✗ G3 |
| Triage agent log evidence (`read_logs_for_correlation_id`) | ✗ G2 |

---

## 5. Critical incident-emission gaps with file:line evidence

This section catalogues each gap with the exact file:line so the implementer can edit directly. Same numbering as §1.

### G1 — DLQ subscription coverage ~25%

**Evidence:**
- `server/services/dlqMonitorService.ts:14-23` — hard-coded `DLQ_QUEUES` array with 8 entries.
- `server/config/jobConfig.ts:36-432` — 31 entries with `deadLetter:` declared.

**Effect:** When jobs in unsubscribed DLQs exhaust retries, they sit in `<queue>__dlq` indefinitely. No `recordIncident`, no operator notification, no agent triage.

**Fix shape:** Replace the hard-coded array with a derivation from `JOB_CONFIG`:

```ts
import { JOB_CONFIG } from '../config/jobConfig.js';

const DLQ_QUEUES = Object.values(JOB_CONFIG)
  .map(c => (c as { deadLetter?: string }).deadLetter)
  .filter((d): d is string => !!d);
```

This auto-includes any new queue with `deadLetter:` declared. ~5 LOC change.

**Risk:** None. The DLQ subscriptions are pure listeners that emit `recordIncident` on enqueue. Adding listeners can't double-count (each DLQ has at most one listener).

### G2 — `logBuffer` never populated; `read_logs_for_correlation_id` always empty

**Evidence:**
- `server/services/systemMonitor/logBuffer.ts:19` — `appendLogLine(line)` exported.
- `server/services/systemMonitor/skills/readLogsForCorrelationId.ts:14-15` — reads from buffer.
- `server/lib/logger.ts:34-43` — `emit(entry)` only writes to console; never calls `appendLogLine`.
- `grep -rn "appendLogLine" server` — only the definition + the skill's import.

**Fix shape:** in `server/lib/logger.ts:34`, after `emit(entry)`:

```ts
function emit(entry: LogEntry): void {
  // ...existing console writes...

  // Feed the System Monitor's log buffer for correlation-ID-scoped retrieval.
  if (typeof entry.correlationId === 'string' && entry.correlationId.length > 0) {
    // Lazy import to avoid pulling systemMonitor into the logger's hot path graph.
    void import('../services/systemMonitor/logBuffer.js').then(m => m.appendLogLine({
      ts: new Date(entry.timestamp),
      level: entry.level,
      event: entry.event,
      correlationId: entry.correlationId as string,
      meta: { ...entry, timestamp: undefined, level: undefined, event: undefined, correlationId: undefined },
    })).catch(() => { /* never let logger crash on buffer write */ });
  }
}
```

(Or eager import if the dependency direction is acceptable — `lib/logger.ts` → `services/systemMonitor/logBuffer.ts`. The buffer module has zero deps so this is safe.)

**Risk:** Low. The buffer has its own LRU eviction (1000 lines / 500 KB). Per-log cost is one push + one optional shift.

### G3 — `incidentIngestorAsyncWorker.handleSystemMonitorIngest` never registered

**Evidence:**
- `server/services/incidentIngestorAsyncWorker.ts:11` — `handleSystemMonitorIngest` exported.
- `server/services/incidentIngestor.ts:117` — `boss.send('system-monitor-ingest', ...)` enqueues to this queue.
- `grep -rn "handleSystemMonitorIngest\|'system-monitor-ingest'" server` — function is never registered as a `boss.work(...)` consumer.

**Effect:** Currently dormant — default is `SYSTEM_INCIDENT_INGEST_MODE=sync`. The moment the env var flips to `async` (or someone tests async mode), every incident is enqueued and never consumed.

**Fix shape:** Register on boot in `server/index.ts` near `await registerSystemIncidentNotifyWorker(boss);` (line ~455):

```ts
if (process.env.SYSTEM_INCIDENT_INGEST_MODE === 'async') {
  await boss.work('system-monitor-ingest', { teamSize: 4, teamConcurrency: 1 }, async (job) => {
    const { handleSystemMonitorIngest } = await import('./services/incidentIngestorAsyncWorker.js');
    await handleSystemMonitorIngest(job.data as SystemMonitorIngestPayload);
  });
}
```

Add `system-monitor-ingest` to `JOB_CONFIG` with a `deadLetter` so failures land in a DLQ that G1's fix subscribes to.

**Risk:** None. Currently inert path becomes functional when toggled. Existing inline-mode tests in `__tests__/incidentIngestorPure.test.ts` already cover the shared `ingestInline` code path.

### G4 — ~20 queues bypass `JOB_CONFIG` (no retry/timeout/DLQ)

**Evidence:**
- `server/services/queueService.ts:548-1142` — multiple `(boss as any).work(...)` calls for queues not in `JOB_CONFIG`.
- `server/services/workflowEngineService.ts:3483-3503` — three workflow workers using raw `pgboss.work`.
- `server/index.ts:476` — `boss.work('skill-analyzer', ...)` with no config bag.

**Effect:** No retry policy (pg-boss defaults apply: usually retryLimit=0 or 2), no DLQ, no `recordIncident` on failure. The agent never sees these failures.

**Fix shape:** For each queue, either:
1. Add a `JOB_CONFIG` entry (with `deadLetter:`) and convert to `createWorker()`. This gets retry, timeout, AND DLQ subscription (post G1) for free.
2. If the worker has bespoke needs that `createWorker` can't accommodate, wrap the handler in a try/catch that calls `recordIncident({source: 'job', ...})` directly, and add the `__dlq` queue to the explicit DLQ list.

Option 1 is preferred — it's the convention.

**Per-queue checklist** (worker registration → file:line → action):
- `maintenance:cleanup-execution-files` — `queueService.ts:548` — has `JOB_CONFIG` entry; just convert to `createWorker`
- `maintenance:cleanup-budget-reservations` — `queueService.ts:561` — same
- `maintenance:memory-decay` — `queueService.ts:574` — same
- `maintenance:security-events-cleanup` — `queueService.ts:587` — same
- `maintenance:fast-path-decisions-prune` — `queueService.ts:599` — **no `JOB_CONFIG` entry** — add one
- `maintenance:rule-auto-deprecate` — `queueService.ts:611` — add config + convert
- `maintenance:fast-path-recalibrate` — `queueService.ts:623` — same
- `maintenance:llm-ledger-archive` — `queueService.ts:638` — same
- `maintenance:llm-started-row-sweep` — `queueService.ts:655` — same
- `maintenance:stale-analyzer-job-sweep` — `queueService.ts:675` — same
- `maintenance:llm-inflight-history-cleanup` — `queueService.ts:689` — same
- `agent-run-cleanup` — `queueService.ts:704` — has config; just convert
- `priority-feed-cleanup` — `queueService.ts:716` — has config; convert
- `maintenance:memory-dedup` — `queueService.ts:729` — has config; convert
- `maintenance:memory-entry-decay` — `queueService.ts:742` — add config + convert
- `memory-hnsw-reindex` — `queueService.ts:756` — same
- `memory-blocks-embedding-backfill` — `queueService.ts:769` — same
- `maintenance:clarification-timeout-sweep` — `queueService.ts:789` — same
- `maintenance:iee-main-app-reconciliation` — `queueService.ts:808` — same
- `maintenance:memory-entry-quality-adjust` — `queueService.ts:821` — same
- `maintenance:memory-block-synthesis` — `queueService.ts:834` — same
- `maintenance:bundle-utilization` — `queueService.ts:849` — same
- `maintenance:portfolio-briefing` — `queueService.ts:862` — same
- `maintenance:portfolio-digest` — `queueService.ts:874` — same
- `maintenance:protected-block-divergence` — `queueService.ts:887` — same
- `agent-briefing-update` — `queueService.ts:900` — has config (but no `deadLetter`); add deadLetter + convert
- `clientpulse:propose-interventions` — `queueService.ts:914` — has config; convert
- `clientpulse:measure-outcomes` — `queueService.ts:930` — has config; convert
- `workflow-resume` — `queueService.ts:992` — has config; convert
- `memory-context-enrichment` — `queueService.ts:1027` — has config (no deadLetter); add + convert
- `system-monitor-self-check` — `queueService.ts:1099` — add config (with deadLetter) + convert
- `subscription-trial-check` — `queueService.ts:1110` — same
- `slack-inbound` — `queueService.ts:1125` — has config (no deadLetter); add + convert
- `orchestrator-from-task` — `queueService.ts:1142` — add config + convert
- `skill-analyzer` — `index.ts:476` — has config; convert
- `workflow-run-tick` — `workflowEngineService.ts:3483` — has config; convert
- `workflow-watchdog` — `workflowEngineService.ts:3492` — has config; convert
- `workflow-agent-step` — `workflowEngineService.ts:3503` — has config; convert

**Risk:** Medium. `createWorker` opens an org-scoped Drizzle tx by default — handlers that intentionally span orgs (sweeps) need `resolveOrgContext: () => null` to opt out. The `withAdminConnection` pattern is already in use; just needs to be threaded through.

### G5 — 6 queues in `JOB_CONFIG` with no `deadLetter:`

**Evidence:** `server/config/jobConfig.ts` — search for entries that have `retryLimit` but no `deadLetter` key:
- `slack-inbound` (line ~211)
- `agent-briefing-update` (line ~258)
- `memory-context-enrichment` (line ~267)
- `page-integration` (line ~276)
- `iee-cost-rollup-daily` (line ~315)
- `connector-polling-tick` (line ~415)

**Fix shape:** Add `deadLetter: '<queue>__dlq'` to each. Once G1 derives DLQ subscriptions from config, these auto-cover.

**Risk:** None. Adds a DLQ where none existed; pg-boss creates the queue automatically.

### G6 — `skillExecutor` only emits incidents on `onFailure='fail_run'`

**Evidence:** `server/services/skillExecutor.ts:347-359` — `recordIncident` only called when `(actionDef?.onFailure ?? 'retry') === 'fail_run'`. Other failure dispositions (`retry`, `skip`, `fallback`) silently degrade.

**Effect:** A skill configured with `onFailure: 'retry'` that fails on every retry attempt produces zero incidents. The agent run continues, eventually fails for a different reason, and the original skill's persistent failure is invisible.

**Fix shape:** Two options:

1. **Emit on every non-`success` skill execution** when `actionDef.failureSurfaceAsIncident !== false` — adds a per-skill kill switch.
2. **Emit on `retry` exhaustion only** — keep transient failures quiet; surface persistent ones. Needs retry-count threading through `skillExecutor`.

Option 2 is closer to the current design intent (transient retries are normal noise). Implementation: when retry-count == retry-cap and the call still fails, emit an incident with `fingerprintOverride: 'skill:<slug>:retry_exhausted'`.

**Risk:** Medium. Requires retry-count plumbing in `skillExecutor`. Could produce incident churn during legitimate intermittent failures — should land *with* a per-skill suppression rule.

### G7 — Webhook routes bypass `asyncHandler` in 5xx paths

**Evidence:**
- `server/routes/webhooks/ghlWebhook.ts:64-67` — DB lookup catch returns `res.status(500)` without throw.
- `server/routes/githubWebhook.ts:122-124` — `try/catch` with `logger.error` only; no `recordIncident`.

**Fix shape:** Two options:

1. Wrap each handler in `asyncHandler` and let the global 5xx path handle it.
2. Inside the existing catch blocks, call:
   ```ts
   recordIncident({
     source: 'route',
     summary: 'GHL webhook handler failure',
     errorCode: 'webhook_handler_failed',
     stack: err instanceof Error ? err.stack : undefined,
     fingerprintOverride: 'webhook:ghl:handler_failed',
     errorDetail: { delivery, event },
   });
   ```

Option 2 keeps the early-ack response pattern (which webhook providers expect).

**Risk:** Low. `recordIncident` is fire-and-forget; cannot fail the response.

### G8 — Raw `boss.work` handlers don't call `recordIncident`

This collapses into G1 + G4 once the listed queues all flow through `createWorker`. No separate fix.

### G9 — `webhook` not in `SystemIncidentSource` enum

**Evidence:** `server/db/schema/systemIncidents.ts:10` — `'route' | 'job' | 'agent' | 'connector' | 'skill' | 'llm' | 'synthetic' | 'self'`. No `'webhook'`.

**Fix shape:**
1. Migration: `ALTER TYPE` if implemented as enum, or just expand the union type if it's `text` (the schema uses `text().$type<...>()`, so just expand the TS type).
2. Update `inferDefaultSeverity` in `incidentIngestorPure.ts` with a `webhook` branch.
3. Update G7's emit calls to use `source: 'webhook'` instead of `'route'`.

**Risk:** None. Pure enum expansion.

### G10 — Missing read skills

See §3.2 for the full list. Each is ~50 LOC following the existing pattern.

### G11 — Skill analyzer doesn't emit incidents on terminal failure

**Evidence:** `server/jobs/skillAnalyzerJob.ts` — only `logger.error` + `throw`. The throw exits the pg-boss handler, retries fire (retryLimit=1 with 5-min delay), exhaustion lands in `skill-analyzer__dlq` — which is **not subscribed** (G1).

**Fix shape:** G1 fixes the post-DLQ surface. Additionally, wrap the top-level handler with a `recordIncident` on the catastrophic-failure path:

```ts
try {
  await processSkillAnalyzerJob(jobId);
} catch (err) {
  recordIncident({
    source: 'job',
    summary: `Skill analyzer terminal failure for job ${jobId}: ${err instanceof Error ? err.message : String(err)}`,
    errorCode: 'skill_analyzer_failed',
    stack: err instanceof Error ? err.stack : undefined,
    fingerprintOverride: 'skill_analyzer:terminal_failure',
    severity: 'high',
  });
  throw err; // preserve pg-boss retry semantics
}
```

**Risk:** None. Belt-and-braces — both per-failure and DLQ paths emit; dedup via fingerprint handles the overlap.

### G12 — Missing synthetic checks

See §3.4 for the candidate list. Each is ~30–50 LOC. Suggested priority order:
1. HITL approval timeout (`actions.status='pending_review' AND created_at < now() - X hours`)
2. Workflow run stuck non-terminal past expected runtime
3. Scheduled-task dispatch silence
4. Skill silence per-skill
5. Brief artefact rejection rate elevated

### G13 — Adapters have zero `recordIncident` calls

**Evidence:** `grep -rn "recordIncident" server/adapters` returns nothing.

**Effect:** Out-of-band adapter calls (token refresh, send-message, push, etc.) that fail are logged but not flagged.

**Fix shape:** Each adapter has a small set of well-defined failure points. Audit `server/adapters/{ghl,slack,stripe,teamwork}.ts` for catch blocks; emit `recordIncident({source: 'connector', ...})` on persistent failures (token-refresh exhaustion, send-message after retries).

**Risk:** Low. Need to be careful not to emit on transient single-call failures — emit on retry-exhaustion or rate-elevated only.

### G14 — `processLocalFailureCounter` is process-local

**Evidence:** Documented in `server/services/incidentIngestor.ts:36-37` and `architecture.md:3314`.

**Effect:** Multi-instance deploy under-counts globally. Each process can detect its own degradation but can't see cluster-wide failures.

**Fix:** Out of scope for launch (acknowledged in code). Phase 0.75 hardening item — Redis or DB-backed counter. Not a blocker.

### G15 — Sysadmin operations missing incident emission

**Evidence:** Various — see §4.10 table. Specific files:
- `server/jobs/orgSubaccountMigrationJob.ts` — no `recordIncident` on partial failure
- `server/services/configBackupService.ts` — no `recordIncident` on backup write failure
- `server/services/dataRetentionService.ts` — partial-failure logger-only
- OAuth integration token refresh — adapter-level (G13)
- Scheduled task dispatch — `server/services/scheduledTaskService.ts` partial-failure path

**Fix shape:** Point audit per file. Each is a wrap-and-emit edit, ~5 LOC.

**Risk:** Low. These operations are low-frequency, so incident emission won't churn the agent.

---

## 6. Recommended actions, ranked

This is the implementation plan if all gaps were addressed. Items are grouped by **launch tier** — Tier 1 must land before testing begins; Tier 2 should land before production; Tier 3 is post-launch polish.

### Tier 1 — must land before pre-production testing begins (~1-1.5 days of focused work)

These items either currently lose data, currently produce false negatives, or currently strand the agent without evidence. They are mechanical and low-risk.

| Order | Item | Effort | Risk | Dependencies |
|---|---|---|---|---|
| 1 | **G2** — wire `appendLogLine` from logger | XS (10 LOC) | Low | None |
| 2 | **G1** — derive `DLQ_QUEUES` from `JOB_CONFIG.deadLetter` values | XS (5 LOC) | None | None |
| 3 | **G5** — add `deadLetter:` to the 6 missing `JOB_CONFIG` entries | XS (6 lines) | None | G1 |
| 4 | **G3** — register `system-monitor-ingest` worker on boot when `SYSTEM_INCIDENT_INGEST_MODE=async` + add to `JOB_CONFIG` | S (15 LOC) | None | G1 |
| 5 | **G4 — workflow engine subset** — convert `workflow-run-tick`, `workflow-watchdog`, `workflow-agent-step`, `workflow-bulk-parent-check` to `createWorker` | M (~80 LOC, 4 sites) | Medium | None |
| 6 | **G4 — IEE subset** — confirm `iee-browser-task`, `iee-dev-task`, `iee-cleanup-orphans`, `iee-run-completed` are wired through `createWorker` (verify in `ieeExecutionService.ts` and `jobs/ieeRunCompletedHandler.ts`) | S | Low | None |
| 7 | **G7** — webhook 5xx paths emit `recordIncident` (GHL, GitHub, plus any teamwork manual 500 paths) | S (~30 LOC) | Low | G9 (can land independently as `source: 'route'` for now) |
| 8 | **G11** — wrap skill-analyzer top-level handler with `recordIncident` | XS (15 LOC) | None | None |

**Why these, not the others, for Tier 1:** these eight items together close the largest visibility holes without requiring any agent-side change. After Tier 1, every queue's failures, every webhook's 5xx, every async-mode incident, and every triage's log evidence reach the agent. The action surface goes from ~25% covered to >85% covered.

**Single-branch landing strategy:** all 8 items can land on one branch (`add-monitoring-coverage` or similar). Order in the table is the safe order — earlier items have no deps on later items. Dual-reviewer worth running on the G4 / G5 changes since they touch boot-time wiring.

### Tier 2 — before production rollout (~1 day)

These improve diagnostic depth and close the remaining surface gaps.

| Order | Item | Effort | Risk |
|---|---|---|---|
| 9 | **G4 — full conversion** — convert remaining ~17 `maintenance:*` raw `boss.work` registrations to `createWorker` + add `JOB_CONFIG` entries | L (~250 LOC across queueService.ts) | Medium |
| 10 | **G6** — `skillExecutor` retry-exhaustion incident path | M (~50 LOC + retry-count plumbing) | Medium (potential churn — pair with suppression rules) |
| 11 | **G9** — add `'webhook'` value to `SystemIncidentSource` enum | XS | None |
| 12 | **G13** — adapter-level `recordIncident` calls in `server/adapters/{ghl,slack,stripe,teamwork}.ts` | M (~30 LOC × 4 adapters = ~120 LOC) | Low |
| 13 | **G15** — point audit of remaining sysadmin operations: `orgSubaccountMigrationJob`, `configBackupService`, `dataRetentionService`, `scheduledTaskService` partial-failure paths | M (~5 LOC × ~10 sites) | Low |
| 14 | **G10** — add four read skills: `read_agent_definition`, `read_recent_incidents`, `read_pgboss_queue_state`, `read_org_subaccount_summary` | M (~50 LOC × 4 = ~200 LOC) | Low |

### Tier 3 — post-launch polish

| Item | Effort | Why deferred |
|---|---|---|
| **G12** — five new synthetic checks (HITL timeout, workflow stuck, scheduled-task silence, skill silence, brief artefact rejection) | M (~30-50 LOC × 5) | Tier 1+2 close the error-path gaps; Tier 3 starts adding silent-failure detection. Worth doing once we have production telemetry to tune thresholds. |
| **G14** — Redis-backed `processLocalFailureCounter` | M | Multi-instance deploy item; not relevant pre-production. |
| §3.3 — read skill exposing cross-incident clustering | S | Useful but the agent can already infer some clustering from fingerprint reuse. |
| §3.5 — per-triage byte cap on agent reads | S | Token budgets at the trigger-model layer cover the worst case. |
| §3.6 — `confidence: 'insufficient'` value | XS | Cosmetic — `'low'` + the word "insufficient" in hypothesis text covers it today. |
| Phase 0.75 — push channels (email/Slack on critical incidents) | L | Already deferred per spec Q1. |
| Phase 3 — auto-remediation | XL | Already deferred per spec. |

### Single-pass branch outline

If you want to run this as one branch with one PR (per the user's "all in place before testing" framing):

```
Branch: add-monitoring-coverage

Commits:
  1. feat(monitor): wire appendLogLine from logger to logBuffer (G2)
  2. feat(monitor): derive DLQ_QUEUES from JOB_CONFIG.deadLetter (G1)
  3. feat(monitor): add deadLetter to slack-inbound, agent-briefing-update,
     memory-context-enrichment, page-integration, iee-cost-rollup-daily,
     connector-polling-tick (G5)
  4. feat(monitor): register system-monitor-ingest async worker on boot (G3)
  5. refactor(workflows): route workflow engine workers through createWorker (G4 subset)
  6. fix(routes): emit recordIncident on 5xx webhook paths (G7)
  7. fix(monitor): emit recordIncident on skill-analyzer terminal failure (G11)
  8. test: integration tests for new DLQ subscriptions (one per category)
  9. docs(architecture): update System Monitor section with new coverage list
```

Pre-test verification: `npm run typecheck` + `npm run lint` + a targeted unit-test pass + an e2e smoke that triggers each new incident path manually.

Pre-merge: `npm run test:gates` (per CLAUDE.md gate-cadence rule).

Reviewers: `pr-reviewer` is sufficient for Tier 1. `dual-reviewer` recommended on G4 since boot-time wiring is harder to spot-check.

### Effort summary

| Tier | Items | Effort estimate |
|---|---|---|
| Tier 1 | G2, G1, G5, G3, G4 (subset), G7, G11 | 1–1.5 days |
| Tier 2 | G4 (full), G6, G9, G13, G15, G10 | 1 day |
| Tier 3 | G12, G14, §3.3/§3.5/§3.6 | 1–2 days, post-launch |

**Total to "every action is monitored, ready for testing":** Tier 1 alone — 1–1.5 days.

---

## 7. Pre-test readiness verdict + verification plan

### 7.1 Verdict

**Status: NOT READY** for the workflow described ("every action is tracked, monitored, and flagged for the System Monitor agent"). The agent is well-built; the producer surface has gaps that will cause silent failures during testing — exactly the failure mode the agent is supposed to expose.

After **Tier 1** of §6 lands, status flips to **READY** for pre-production testing.

After Tier 2, status is **READY** for production.

### 7.2 Why "not ready" today (in one paragraph each)

**Silent-failure surface is large.** ~75% of pg-boss queues either don't have a DLQ or have one no listener subscribes to. Job failures across the workflow engine, IEE, skill analyzer, every `maintenance:*` job, payment reconciliation, and connector polling sync land in `failed` / `*__dlq` rows in the pg-boss schema and are never converted into `system_incidents`. During testing this means: a real bug surfaces as "the job didn't run", with no incident, no triage, no Investigate-Fix prompt — the operator has to know to inspect pg-boss directly.

**Triage agent reads stale evidence.** Every triage diagnosis the agent produces today silently omits process-local log lines. The agent's prompt explicitly tells it to cite `file:line` references and surface what it cannot see, but it cannot see what the logger emitted because nothing populates the buffer. The agent will write defensible diagnoses anyway — they'll just be missing the runtime context that would let a human follow up effectively.

**Async ingest is a tripwire.** Setting `SYSTEM_INCIDENT_INGEST_MODE=async` (which someone *will* try in testing to validate the async path) silently loses every incident. No error, no warning — `boss.send` succeeds, the queue fills, no consumer drains. The incident sink looks healthy until you check the queue.

### 7.3 Verification plan (post Tier 1)

After landing the Tier 1 fixes, verify with these tests. Each is small enough to run as a one-shot.

#### V1 — `read_logs_for_correlation_id` returns lines (G2)

```
1. Hit any authenticated route. Note the response's correlationId from the JSON body.
2. Wait 1-2 seconds for log emission.
3. From a Node REPL or a temporary sysadmin tool, call:
     readLinesForCorrelationId('<id>', 100)
   from server/services/systemMonitor/logBuffer.js.
4. Assert lineCount > 0 and the lines contain the route handler's events.
```

#### V2 — DLQ coverage round trip (G1, G5)

For each newly subscribed DLQ:
```
1. Enqueue a poison-pill job (payload that the handler will reject) with retryLimit=0.
2. Confirm pg-boss moves it to <queue>__dlq.
3. Within 30s, query system_incidents for the matching `job:<queue>:dlq` fingerprint.
4. Assert one row exists with source='job', severity='high'.
5. Trigger the same poison-pill 9 more times → assert occurrenceCount=10, no duplicate rows.
```

A scripted version of this: `scripts/verify-dlq-incident-roundtrip.sh` — recommended addition.

#### V3 — Async ingest worker drains (G3)

```
1. Set SYSTEM_INCIDENT_INGEST_MODE=async. Restart the server.
2. Trigger any 5xx route.
3. Confirm the system-monitor-ingest queue size goes 0 → 1 → 0 within a few seconds.
4. Confirm a system_incidents row was written.
```

#### V4 — Workflow engine failures surface (G4 subset)

```
1. Submit a workflow run with a step that intentionally throws on the first invocation.
2. Confirm pg-boss retries the job per JOB_CONFIG.
3. Confirm the failed job ends up in workflow-run-tick__dlq (or workflow-agent-step__dlq).
4. Confirm a system_incidents row is created within 10s of the DLQ landing.
```

#### V5 — Webhook 5xx emits incident (G7)

```
1. Send a GHL webhook for a locationId that exists in canonical_accounts.
2. Inject a DB error in the lookup (or use a fault-injection wrapper).
3. Confirm a system_incidents row with source='route' (or 'webhook' if G9 landed) and a fingerprint covering the GHL handler path.
```

#### V6 — Skill analyzer terminal failure surfaces (G11)

```
1. Submit a skill-analyzer job with an org that has no candidates (forces an early-exit code path that may throw differently).
2. Force the handler to throw via env-flag or test seam.
3. Confirm a system_incidents row with fingerprintOverride='skill_analyzer:terminal_failure'.
```

#### V7 — Triage agent uses log evidence (G2 end-to-end)

```
1. Trigger an incident from a route that emits a few logger.info / logger.error lines with the same correlationId.
2. Wait for the triage worker to pick up the incident (severity ≥ medium, default).
3. Read system_incidents.agent_diagnosis.evidence — assert at least one entry references a log line from V1's buffer.
```

This is the canonical end-to-end test for the system: route fires → log lines accumulate → incident creates → triage reads logs → diagnosis cites evidence → operator pastes Investigate-Fix prompt → Claude Code session investigates.

### 7.4 Smoke before "we're testing"

Add to `tasks/builds/<next-slug>/staging-smoke-checklist.md`:

```
- [ ] V1 (log buffer round trip)
- [ ] V2 (DLQ coverage — pick 3 representative queues)
- [ ] V3 (async ingest, if SYSTEM_INCIDENT_INGEST_MODE will be flipped in test)
- [ ] V4 (workflow engine failure surfaces)
- [ ] V5 (webhook 5xx surfaces)
- [ ] V6 (skill-analyzer terminal failure surfaces)
- [ ] V7 (end-to-end: route → triage → diagnosis with log evidence)
```

### 7.5 What this audit DID NOT cover (intentional)

- **Frontend monitoring/observability.** Client-side errors, Sentry/equivalent telemetry, error boundary coverage — out of scope for this audit. The user's framing was "things that execute on the server".
- **Deployment / infrastructure monitoring.** Process death, OOM, host restart, disk full — these require an external monitoring layer (uptime monitor, health-check aggregator) outside the System Monitor agent. Phase 0/0.5 explicitly defers to such a layer.
- **Security event monitoring.** `tool_call_security_events` table is an existing admin surface; not part of the incident sink. Should it be? Open question — recommend a follow-up audit specifically on whether security events should also flow through `recordIncident` for unified triage.
- **Cost / budget monitoring.** Cost-anomaly heuristics exist (`costPerOutcomeIncreasing`); per-org budget breach is its own surface (`budgetService`). They produce signals but the failure paths there weren't the focus.
- **Test-environment auto-incidents.** Running the test suite with the ingestor enabled creates real incidents. Recommend a `SYSTEM_INCIDENT_INGEST_ENABLED=false` env in `npm test` if not already set (or `is_test_incident` tag — already in schema).

### 7.6 Recommended next step

1. **User confirms** the audit's coverage matches their intent.
2. **Spec the Tier 1 work** as a 1-pager (or extend `tasks/post-merge-system-monitor.md` with the items here marked Tier 1).
3. **Run `architect`** for sequencing if landing on a new branch.
4. **Implement Tier 1** in one branch / one PR.
5. **Run `pr-reviewer` and `dual-reviewer`** before merging.
6. **Run V1–V7** in staging.
7. **Then begin testing** of the broader application.

Tier 2 and Tier 3 can roll in across subsequent sprints without blocking pre-production testing.

---

**End of audit.**
