# Development Brief: Workflow Engines (Replacing/Augmenting pg-boss)

**Date:** 2026-04-05
**Status:** Research Complete -- Awaiting Decision

---

## Executive Summary

Our system uses pg-boss for job orchestration across 14+ queue types, handling agent scheduling, handoff chains, HITL workflow checkpointing, billing aggregation, and maintenance jobs. The question is whether Temporal or Inngest could replace or augment this, given our complex orchestration patterns (heartbeats with offset, subtask wakeups, handoff chains with depth limits, workflow pause/resume).

**Recommendation: Do not migrate.** pg-boss is well-suited to our current needs. The orchestration complexity lives in our application logic, not in queue limitations. Neither Temporal nor Inngest solves problems we actually have -- they solve problems we don't have yet, at significant infrastructure and migration cost.

---

## Current State Assessment

### What We Have

Our pg-boss setup is sophisticated and well-structured:

| Category | Queues | Retry Policy | Notes |
|----------|--------|-------------|-------|
| Agent execution (Tier 1) | 6 queues (scheduled, org-scheduled, handoff, triggered, execution, workflow-resume) | 1-2 retries, exponential backoff | 150-600s timeouts |
| Financial/billing (Tier 2) | 4 queues (aggregate, reconcile, invoices, payment) | 0-3 retries | Data integrity critical |
| Maintenance (Tier 3) | 4 queues (stale cleanup, file cleanup, budget cleanup, memory decay) | 0 retries | Self-healing on next tick |
| DLQ monitoring | 8 DLQ workers | N/A | Full payload logging |

**Key orchestration patterns already working:**

1. **Heartbeat scheduling** -- Cron-based with `heartbeatIntervalHours` + `heartbeatOffsetHours` + `heartbeatOffsetMinutes` for staggered execution across three tiers (System/Org/Subaccount)
2. **Handoff chains** -- Depth-limited to 5 hops with dual validation (at creation + enqueue), duplicate prevention, and DLQ fallback
3. **Subtask wakeups** -- Event-driven reactive orchestrator triggering on task status changes (not polling)
4. **HITL workflow checkpointing** -- LangGraph-style pause/resume with `workflow-resume` queue, input hash validation, 24h timeout
5. **Stale run detection** -- 5-minute scans with grace periods for active tool execution (10min standard, 20min tool grace, 1hr legacy)
6. **Three-tier queue isolation** -- System/Org/Subaccount agents execute in separate queues to prevent cross-boundary leakage
7. **Graceful degradation** -- Every pg-boss feature has an in-process fallback (advisory locks for dedup in memory-queue mode)
8. **Non-retryable error classification** -- 400/401/403/404/409/422 status codes route directly to DLQ

### What's Working Well

- Zero additional infrastructure (uses existing Postgres)
- Job state is queryable via SQL (useful for debugging, monitoring, billing reconciliation)
- Cron scheduling with offset precision handles staggered agent heartbeats
- DLQ monitoring with full payload context for failure investigation
- In-process fallback mode enables development without pg-boss
- Structured logging with correlation IDs, retry counts, timeout categorization

### What Could Be Better

- Custom retry/timeout/backoff logic per queue (could be more declarative)
- Workflow checkpointing is hand-rolled (workflowExecutorService.ts)
- No built-in workflow visualisation or trace UI
- Multi-step workflows require manual state management
- No durable sleep (step.sleep equivalent) -- timers are cron-based

---

## Temporal Assessment

### What It Offers

Temporal is a durable execution platform with automatic workflow state persistence, deterministic replay, and rich orchestration primitives (child workflows, signals, queries, long sleeps).

| Capability | Relevance to Us |
|-----------|----------------|
| Durable execution (workflow-as-code) | Medium -- our workflows are relatively short-lived (agent runs < 10min) |
| Built-in retries with policies | Low -- we already have tiered retry policies that work |
| Activity heartbeats | Low -- we have our own heartbeat system with offset precision |
| Cron/scheduling | Low -- pg-boss cron with timezone support covers our needs |
| Child workflows | Medium -- could simplify handoff chains, but MAX_HANDOFF_DEPTH=5 is manageable |
| Signals/queries | Medium -- could replace subtask wakeup service, but our event-driven approach works |
| Workflow history/UI | High -- this is genuinely missing from our stack |
| Long durable sleeps | Low -- we don't have workflows that sleep for days/weeks |

### Infrastructure Cost

**Self-hosted:** Postgres cluster + 4 Temporal services + Elasticsearch. Helm chart deployment. Requires distributed systems ops expertise. Multiple teams report this is prohibitive for small teams.

**Temporal Cloud:** $50/million Actions. Workers still run on our infra. Reduces ops burden but introduces SaaS dependency.

### Migration Effort: HIGH

- Every job handler must be split into deterministic workflow code + activity functions
- The deterministic sandbox is a significant conceptual shift (no Date.now(), no Math.random(), no Node.js APIs in workflow code)
- Workflow versioning for in-flight executions requires careful use of `patched()` API
- 14+ queue types to migrate, each with specific retry/timeout/DLQ behavior
- Three-tier agent isolation must be preserved in task queue design

### Nango Cautionary Tale

Nango migrated FROM Temporal TO a Postgres-based orchestrator, citing:
- Temporal was a barrier to enterprise self-hosting (customers unfamiliar with it pushed back)
- Overkill for their job patterns
- Operational overhead didn't justify the benefits

This mirrors our situation closely.

---

## Inngest Assessment

### What It Offers

Inngest is event-driven with durable step functions. Key difference from Temporal: it calls your code via HTTP (push model) rather than you polling a queue (pull model). Simpler developer experience, no deterministic sandbox constraints.

| Capability | Relevance to Us |
|-----------|----------------|
| Step-level retries + memoization | Medium -- would simplify workflowExecutorService |
| step.sleep / step.waitForEvent | Medium -- useful for HITL workflows, but our checkpoint pattern works |
| Concurrency controls (throttle, debounce, prioritize) | Low-Medium -- we handle this at the application level |
| Trace UI | High -- same gap as Temporal |
| Fan-out parallelism | Low -- our workflows are mostly sequential |
| Event-driven triggers | Medium -- aligns with subtask wakeup pattern |

### Infrastructure Cost

**Self-hosted:** Postgres + Redis + Inngest binary. Simpler than Temporal but still new infra.

**Inngest Cloud:** Free tier 50k executions/month. Scales with usage.

### Key Concerns

- **SSPL license** (not OSI-approved open source) -- cannot offer as hosted service, 3-year delay to Apache 2.0
- **1,000 step limit per function** -- could be hit by complex workflows
- **4MB per step output, 32MB total state** -- limits on data-heavy workflows
- **HTTP push model** requires network connectivity between Inngest server and app
- **SDK lock-in** -- `step.*` primitives are Inngest-specific; migrating away means rewriting all workflow logic
- **Smaller community** (5.2k stars vs Temporal's 19k) and shorter production track record

### Migration Effort: MEDIUM

- Simpler conceptual model than Temporal (no deterministic sandbox)
- Each pg-boss job type becomes an Inngest function triggered by a named event
- `boss.send()` becomes `inngest.send()`
- Cron jobs map directly to cron-triggered functions
- Multi-step jobs decompose into `step.run()` calls

---

## Comparison Matrix

| Factor | pg-boss (Current) | Temporal | Inngest |
|--------|-------------------|----------|---------|
| Infrastructure | Postgres only | Postgres + Temporal cluster + ES | Postgres + Redis + Inngest |
| Ops burden | None (piggybacks Postgres) | High (self-hosted) / Medium (Cloud) | Medium (self-hosted) / Low (Cloud) |
| Migration effort | N/A | High | Medium |
| Durable execution | Manual (workflowExecutorService) | Built-in, battle-tested | Built-in, simpler model |
| Observability/UI | None (SQL queries) | Web UI + full event history | Trace UI + Prometheus metrics |
| Job state queryability | SQL (it's just rows) | API/UI only | API/UI only |
| License | MIT | MIT | SSPL |
| Maturity | Solid, well-known | Battle-tested at massive scale | Younger, growing fast |
| Learning curve | Already learned | Steep (deterministic sandbox) | Moderate |
| Vendor lock-in | None | Medium (architectural coupling) | High (SSPL + SDK-specific APIs) |

---

## Recommendation

### Don't Migrate. Invest in Observability Instead.

**Why not migrate:**

1. **We don't have queue problems.** pg-boss handles our 14+ job types reliably. Our retry policies, DLQ monitoring, and error classification are mature.

2. **Our complexity is application-level, not infrastructure-level.** Handoff chains, heartbeat offsets, three-tier isolation, and HITL checkpointing are domain logic. Moving to Temporal/Inngest doesn't eliminate this complexity -- it just moves where it's expressed.

3. **Migration cost is high for uncertain benefit.** 14+ queues with specific retry/timeout/DLQ behavior, three-tier isolation, in-process fallback mode -- all must be preserved or rebuilt.

4. **"It's just Postgres" is a feature, not a limitation.** Zero additional infra, SQL-queryable job state, existing backups/monitoring/HA. This operational simplicity has real value.

5. **The Nango precedent.** A team with similar patterns migrated away from Temporal back to Postgres. Their reasons match our situation.

### What to Do Instead

**Invest in targeted improvements to the current system:**

1. **Add workflow observability** -- Build a simple workflow trace UI (or add structured logging to a tool like Grafana) to visualise agent run chains, handoff flows, and HITL workflow state. This addresses the biggest actual gap.

2. **Consider pg-workflows** -- A lightweight durable execution layer built on top of pg-boss. Could simplify workflowExecutorService without a full platform migration.

3. **Declarative job configuration** -- jobConfig.ts already centralises config. Consider making retry policies, timeouts, and error classification more declarative to reduce per-queue boilerplate.

### When to Revisit

Revisit this decision if:
- We need workflows that span hours/days with durable state (not just HITL pause/resume)
- pg-boss throughput becomes a bottleneck (thousands of jobs/minute)
- We need cross-service workflow orchestration (beyond the current monolith)
- The team grows enough to absorb the operational overhead of a separate platform

---

## Appendix: Key Files

| File | Purpose |
|------|---------|
| `server/lib/pgBossInstance.ts` | Singleton pg-boss setup, 7-day retention, graceful shutdown |
| `server/config/jobConfig.ts` | Centralized job tier config (retry, backoff, expiration, DLQ) |
| `server/services/agentScheduleService.ts` | Agent scheduling, cron registration, worker setup |
| `server/services/workflowExecutorService.ts` | HITL workflow checkpointing, pause/resume |
| `server/services/subtaskWakeupService.ts` | Reactive orchestrator triggering on task completion |
| `server/services/staleRunCleanupService.ts` | 5-min scan with grace periods |
| `server/services/queueService.ts` | Execution processing, workflow resume worker, maintenance jobs |
| `server/services/dlqMonitorService.ts` | DLQ monitoring with payload logging |
| `server/lib/jobErrors.ts` | Non-retryable classification, timeout handling |
| `server/config/limits.ts` | MAX_HANDOFF_DEPTH=5, timeouts, thresholds |
