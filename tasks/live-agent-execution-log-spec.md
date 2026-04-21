# Live Agent Execution Log — Spec

**Status:** Draft — awaiting human review. Major task per CLAUDE.md §"Task Classification" (new subsystem, new tables, new permission keys, new WebSocket contract, new client surface).
**Author:** Main session.
**Date:** 2026-04-21.
**Branch when built:** `claude/agent-task-live-logs-MbN8R` (already cut).
**Predecessor / sibling:** `tasks/llm-inflight-realtime-tracker-spec.md` — the system-admin in-flight LLM tracker at `/system/llm-pnl` In-Flight tab. This spec is the **per-run** companion surface: it attaches a live execution log to every agent run, not every LLM call in the system. The two surfaces share the LLM ledger as a data source but never render in the same page.

---

## Table of contents

1. Problem statement
2. Goal
3. Primitives search (existing reuse)
4. Execution model
5. Contracts
6. Files to change
7. Permissions / RLS
8. Phase sequencing
9. Deferred Items
10. Testing posture
11. Self-consistency check

---

## 1. Problem statement

When an agent runs a task today, the operator sees one of three surfaces:

- **Run list** — outcome, duration, cost after the fact.
- **Agent run messages** (`agent_run_messages`) — provider-neutral message stream the LLM saw + produced, exposed indirectly via run detail pages.
- **System LLM In-Flight tab** (system admins only) — live LLM call dispatch at the fleet level, not per-run.

None of them answer the questions an operator actually asks mid-run: *which specific memories did the agent pull for this task, which business rules fired, which files were loaded into the prompt, which skills were discovered, and which of them are still relevant?* The information exists — scattered across `agent_runs`, `agent_run_messages`, `llm_requests`, `actions`, `agentRuns.contextSourcesSnapshot`, and structured-logger lines — but is not assembled into a single per-run timeline, is not streamed in real time, is not linked to the source entity the operator would want to edit, and is not durably replayable months later when a client asks "why did the agent do that on April 3?".

**Three concrete failures today:**

1. **Live demo gap.** During a sales demo or a support-engineer call, there is nowhere to show "here's exactly what my agent is doing right now — prompt just assembled, memory just retrieved, rule X matched, skill Y invoked." The operator defaults to refreshing the run page.
2. **Live debugging gap.** When an agent pulls a stale memory or fires a wrong business rule, the operator can't see the decision at the moment it happens, and can't edit the offending entity in place so the next run does it right. The edit flow exists, but finding the entity requires hunting across the memory page, rules page, and skills page.
3. **Forensic replay gap.** Months after a run, the only persisted artefacts are the message stream (good) + the ledger rows (hashed payloads, not bodies) + the actions table (reviewed tool calls only). The full assembled prompt is not stored. The memories that were retrieved are only partially recorded via `citedEntryIds` (post-hoc, drops the query + ranking). Which policy rules matched is only in logger output. Orchestrator routing reasoning lives in the Orchestrator's LLM output and is not structured.

**Non-goals.**

- **Not** a system-wide LLM observability surface. That is the in-flight tracker's job (`tasks/llm-inflight-realtime-tracker-spec.md`); do not unify.
- **Not** a replay-and-restart facility. Re-running a run with edited inputs is a separate feature with non-determinism tradeoffs; this spec is strictly a read surface + a link-out to existing edit surfaces.
- **Not** a new observability layer for non-agent LLM callers (skill-analyzer, configuration assistant, system jobs). Those remain in the in-flight tracker + ledger. When an agent run *invokes* one of those paths as part of its work, the resulting LLM call is nested under the agent run's log because the router already tags those calls with `sourceType='agent_run'` + `runId`; no new plumbing is needed on the non-agent side.
- **Not** token-level streaming of LLM output. Deferred — see §9.
- **Not** a cross-run analytics surface (search runs by memory used, find anomalies, etc.). Deferred — see §9.

---

## 2. Goal

A per-run live execution log surface that:

1. Streams every material decision in an agent run to the operator in real time, scoped to that run (`agent-run:${runId}` socket room).
2. Durably persists every event to a new `agent_execution_events` table so the same timeline is replayable indefinitely after the run ends.
3. Persists the fully-assembled system + user prompt for each run to a new `agent_run_prompts` table — the biggest gap identified in the audit.
4. Persists the full LLM request + response payload per ledger row to a new `agent_run_llm_payloads` table, giving the operator "see exactly what was sent" fidelity without stretching the append-only `llm_requests` ledger.
5. Links every event's referenced entity (memory, memory block, policy rule, skill, data source, prompt layer, handoff target) to a permission-gated View and/or Edit surface the operator can use in place. Edits affect **future** runs only, never the in-flight one.
6. Respects the three-tier permission model (system → org → subaccount) on every read and every link: an operator sees only events + payloads + entities they already have visibility to, and only sees Edit links for entities they already have edit permission on.
7. Tiers storage — hot (6mo, full fidelity) → warm (12mo, summary only) → cold archive (7yr, restore-on-demand) — matching the existing `llm_requests_archive` pattern (migration `0188_llm_requests_archive.sql`).

**Load-bearing guarantees** (every one of these has a named mechanism in §4–§7):

- Exactly one event per decision, ordered deterministically per run (`sequenceNumber` unique per `runId`).
- No dropped events on WebSocket dropout (client resumes via `GET /api/agent-runs/:id/events?fromSeq=N` after the existing `useSocketRoom` reconnect hook fires — same pattern as `agentRunMessageService.streamMessages`).
- No double-rendered events on reconnect (client LRU of 500 `eventId`s — same pattern as the in-flight tracker and existing `useSocket` dedup).
- No cross-tenant leakage — all three new tables are in `RLS_PROTECTED_TABLES`, all reads go through `withOrgTx` / `getOrgScopedDb`, and the WebSocket room join handler validates tier access before admitting the socket.
- No mid-run edit hot-swap — the edit-link surface writes to the same service the non-log edit pages already use; the in-flight run continues with the state it already loaded.
- No unbounded storage growth — retention job at 03:30 UTC (offset from the LLM ledger archive's 03:45 UTC slot) moves events to warm + cold tiers, configurable via env vars matching the ledger's existing pattern.

---

## 3. Primitives search (existing reuse)

Every piece of this surface extends something that already exists. The one genuinely new primitive is the typed event table — justified at the end of this section.

| Proposing | Reuse target | Why not invent |
|---|---|---|
| Real-time push to client | Socket.IO rooms via `server/websocket/` + `server/websocket/emitters.ts` + `client/src/hooks/useSocket.ts` | Existing `agent-run:${runId}` room is already used by `emitAgentRunUpdate`, `emitAgentRunPlan`, and `emitAwaitingClarification`. Add new event types to the same room — no new room needed. |
| Per-run durable ordering | `agent_run_messages` has `(runId, sequenceNumber)` unique + `agentRunMessageService.streamMessages(runId, fromSeq?, toSeq?)` | Same sequence-number shape. The audit flagged this primitive as the "hidden hero" — the new event table mirrors its ordering invariants (`UNIQUE (run_id, sequence_number)` + monotonic per-run sequence). Do not add events to `agent_run_messages` — that table is the provider-neutral LLM conversation and must stay semantically clean. |
| Client-side event dedup on reconnect | `eventId` + LRU of 500 in `useSocket.ts` | Already shipped. Reuse verbatim — same envelope, same LRU bucket. Emit new events with `eventId = ${runId}:${sequenceNumber}:${eventType}`. |
| Per-LLM-call attribution | `llm_requests` ledger row (`runId`, `sourceType`, `sourceId`, `featureTag`, `attemptNumber`, `requestPayloadHash`, `responsePayloadHash`) | Ledger already carries everything except the payload bodies. Add a sibling `agent_run_llm_payloads` table keyed by `llmRequestId` — append-only invariant on `llm_requests` preserved (the ledger itself is not mutated). |
| Three-layer fail-closed isolation on new tables | `withOrgTx`, `getOrgScopedDb`, `withAdminConnection` (`server/middleware/orgScoping.ts`, `server/instrumentation.ts`) + `RLS_PROTECTED_TABLES` manifest (`server/config/rlsProtectedTables.ts`) + `verify-rls-coverage.sh` gate | Every new tenant-scoped table goes into the manifest in the same migration. Non-negotiable per `architecture.md §1155`. |
| Principal-scoped RLS context on agent execution path | `withPrincipalContext` (`server/db/withPrincipalContext.ts`) | All reads by the execution loop already flow through this. The emission service uses the same primitive — no new RLS surface. |
| Stale-entry hygiene (orphaned events from crashed runs) | `agent_runs.lastActivityAt` + existing run-status transitions (`TERMINAL_RUN_STATUSES` in `shared/runStatus.ts`) | Events for terminal runs are not swept — they are the durable record. Only the WebSocket room is torn down on `run.completed`. No new sweep job. |
| Retention tiering | `migrations/0188_llm_requests_archive.sql` + `server/jobs/llmLedgerArchiveJob.ts` + `llmLedgerArchiveJobPure.ts` + env var `LLM_LEDGER_RETENTION_MONTHS` | Same archive pattern: `agent_execution_events_archive` table + `agentExecutionLogArchiveJob.ts` + pure cutoff math. Env vars match the ledger's naming shape: `AGENT_EXECUTION_LOG_HOT_MONTHS` (default 6) / `AGENT_EXECUTION_LOG_WARM_MONTHS` (default 12) / `AGENT_EXECUTION_LOG_COLD_YEARS` (default 7). |
| Permission key + guard composition | `server/lib/permissions.ts` (`ORG_PERMISSIONS`, `SUBACCOUNT_PERMISSIONS`) + `requireSubaccountPermission`, `requireOrgPermission`, `resolveSubaccount` + `isSystemAdmin` on users table | **No new permission key.** View inherits from the existing `AGENTS_VIEW` for the relevant tier. Edit links inherit from the entity's existing edit permission (e.g. memory edit uses the same permission the memory management page uses today). See §7 for the matrix. |
| Policy rule evaluation record | `policyRules` table (`server/db/schema/policyRules.ts`) + `decisionTimeGuidanceMiddleware` (`server/services/middleware/decisionTimeGuidanceMiddleware.ts`) | Rules exist + middleware evaluates them. Missing: a record of *which rule matched + decision + guidance injected*. That record becomes a `rule.evaluated` event, not a new audit table. Rule-evaluation audit-table (as opposed to event) is deferred (§9). |
| Memory retrieval record | `workspaceMemoryService._hybridRetrieve()` (`server/services/workspaceMemoryService.ts`) + `memoryBlockService.getBlocksForInjection()` (`server/services/memoryBlockService.ts`) + existing `agentRuns.citedEntryIds` | Retrieval already returns ranked results; the emission hook fires once at the end of each retrieval phase with `{ queryText, topN entries with score, retrievalMs }`. Do NOT thread an event emitter through the inner ranking loop — emission stays at the retrieve-call boundary. |
| Prompt assembly record | `buildSystemPrompt` (`server/services/llmService.ts`) + assembly site in `agentExecutionService.ts` ≈ lines 662–699 | Prompt is rebuilt from component parts today; assembly output is thrown away once the LLM call returns. The only persisted trace is `agentRuns.systemPromptTokens` (count, not content). Save the full assembled prompt to `agent_run_prompts` once per assembly, keyed by `(runId, assemblyNumber)` to accommodate multi-turn runs that re-assemble with updated context. |
| Orchestrator routing record | `orchestratorFromTaskJob.ts` lines ~130–233 | Already logs the dispatch via `logger.info('orchestratorFromTask.dispatched', ...)`. Emit a typed `orchestrator.routing_decided` event at the same site carrying `{ taskId, chosenAgentId, routingReasonText?, idempotencyKey }`. Structured *reasoning* extraction from the Orchestrator's LLM output is deferred (§9). |
| Context source loading record | `runContextLoader` (`server/services/runContextLoader.ts`) + `agentRuns.contextSourcesSnapshot` column | Snapshot already captures everything: source ID, scope, inclusion status, exclusion reason. Emit one `context.source_loaded` event per source at the loader's return boundary — the payload is literally a slice of the existing snapshot struct, no new capture logic. |
| Skill invocation record | `server/services/skillExecutor.ts` + `actions` table (for review-gated skills only) | Actions table already records reviewed tool calls. Non-reviewed tool calls (majority) are in `agent_run_messages` as tool-result entries. The `skill.invoked` + `skill.completed` events record every invocation (reviewed or not), linking to either the `actions.id` or the underlying `agent_run_messages.sequenceNumber`. No new action record. |
| Handoff decision record | handoff path in `agentExecutionService.ts` + `MAX_HANDOFF_DEPTH` (`server/config/limits.ts`) | Handoffs already emit structured logs + update `agent_runs.handoffFromRunId`. Emit a typed `handoff.decided` event at the handoff site carrying `{ targetAgentId, reasonText, depth }`. |

### The one new primitive — justified

`agent_execution_events` is the only genuinely new concept. Why not extend something existing:

- **`agent_run_messages`**: is the provider-neutral LLM conversation stream. Overloading it with non-message events (memory retrieval, rule evaluation, context source loading) pollutes its semantic contract — the message-stream-to-LLM replay used by `toolCallsLogProjectionService.ts` and future "resume from checkpoint" features would need to filter out non-message entries on every read. Net: cheaper to keep the streams separate and join on `runId` + `sequenceNumber` where needed.
- **`llm_requests`**: append-only ledger for LLM calls. Events are not LLM calls — conflating them breaks the ledger's semantic purity and the aggregation math in `systemPnlService.ts`.
- **`actions`**: review-gated tool call record. Out of scope semantically; most events are not tool calls.
- **`agentRunSnapshots`**: has a `systemPromptSnapshot` column the audit flagged as deprecated. Revival would re-introduce a table that `toolCallsLogProjectionService` already replaced. Use the focused new `agent_run_prompts` table for prompt persistence instead — single responsibility, no legacy baggage.

A dedicated typed event table is the correct shape: it preserves every other table's invariants and gives the new surface a single queryable source of truth.

### Reference to accepted primitives (`docs/spec-context.md`)

- `withOrgTx / getOrgScopedDb / withAdminConnection` — used throughout for three-layer fail-closed isolation.
- `RLS_PROTECTED_TABLES` manifest — all three new tables added in the creating migration.
- `verify-rls-coverage.sh + verify-rls-contract-compliance.sh` — enforce coverage automatically; no new gate needed.
- `createWorker()` (`server/lib/createWorker.ts`) — retention archive job uses this primitive, matching the existing `llmLedgerArchiveJob`.
- `shared/runStatus.ts` — used to decide when to tear down the WebSocket room (terminal statuses) and when to allow events to keep flowing (in-flight / awaiting statuses).

---

## 4. Execution model

**Inline emission, synchronous persistence, WebSocket push after commit.** Retention archival is queued via pg-boss.

### 4.1 Emission model — persist-then-emit, inline

Every event is written through a single service: `server/services/agentExecutionEventService.ts → appendEvent()`. The caller passes the run, event type, payload, and optional linked entity. The service does three things in order:

1. **Assigns a sequence number** using a per-run atomic increment backed by the DB. Pattern: `INSERT ... RETURNING sequence_number` with a trigger OR a Drizzle-side `SELECT COALESCE(MAX(sequence_number), 0) + 1 ... FOR UPDATE` inside `withOrgTx`. The in-flight tracker used an in-memory map for sequencing — that's wrong here because events must survive process crashes with stable ordering. DB-side sequencing is the right primitive.
2. **Persists the row to `agent_execution_events`** in the same transaction as the sequence allocation.
3. **Emits a WebSocket event** to the `agent-run:${runId}` room *after* commit. The socket event mirrors the row exactly — same `sequenceNumber`, same `payload`, same `linkedEntity`. If the emit fails (socket server disconnected, etc.), the event is still durable — clients resync via the paginated read endpoint on reconnect.

**Why persist-then-emit and not emit-then-persist.** Losing an event on a crash between emit and persist would leave the client seeing an event that doesn't exist in the durable log — a forensic black hole. The other way around (persist then emit) can drop the socket event on a race, but the client recovery path already handles that (see §4.3 resync protocol). We always choose the failure mode where the durable log is authoritative.

**Why inline and not queued.** A pg-boss job between the agent loop and the event write introduces end-to-end latency that the feature's "live" requirement can't tolerate (the user explicitly rejected polling-style latency). Inline writes are ~2–5 ms on the happy path and fire on top of transactions the loop already runs. The retention archive is queued (§4.6) because that work is genuinely decoupled; emission is not.

**Hot-path cost control.** Every emission site in `agentExecutionService.ts`, `workspaceMemoryService.ts`, `memoryBlockService.ts`, `skillExecutor.ts`, `llmRouter.ts`, `runContextLoader.ts`, `decisionTimeGuidanceMiddleware.ts`, and `orchestratorFromTaskJob.ts` is an `await appendEvent(...)` call that the caller awaits. Errors from `appendEvent` are caught at the call site and logged at `error` level via `logger.error('agentExecutionEventService.append_failed', { runId, eventType, err })` — **they never fail the agent run**. The log is observability, not load-bearing for execution. A downed event table must not take down the agent.

### 4.2 Sequence-number guarantees

- **Monotonic per run.** `(run_id, sequence_number)` is UNIQUE. The first event for a run is `sequenceNumber = 1`.
- **No gaps assumed.** The client must tolerate gaps (a persist that fails mid-flight leaves no row; the next event gets the next number via `MAX + 1`, not via a reserved-then-rolled-back slot). Gaps are rare and benign — the client's "events I've seen" set is keyed on `eventId`, not on continuity.
- **No cross-run ordering.** Sequences do not carry time-ordering guarantees across runs; use `eventTimestamp` for that.

### 4.3 Live streaming + reconnect resync protocol

The client follows the same pattern `useSocketRoom` already implements for other run-scoped surfaces:

1. **Initial paint.** On page load, fetch `GET /api/agent-runs/:runId/events?limit=1000` for the initial snapshot, then subscribe to the `agent-run:${runId}` room. Buffer incoming socket events for 100 ms before merge — closes the snapshot-vs-live race the in-flight tracker spec §5 identified and resolved the same way.
2. **Steady state.** Live events update the timeline in place, deduped by `eventId` via the existing 500-entry LRU in `useSocket.ts`.
3. **Reconnect.** On socket reconnect, the client tracks the highest `sequenceNumber` it has rendered (`lastSeenSeq`) and issues `GET /api/agent-runs/:runId/events?fromSeq=${lastSeenSeq + 1}&limit=1000` to backfill anything missed while offline. The endpoint is page-of-one-thousand; if the run generated > 1000 events during the outage (rare — the Deferred Items covers the extreme case in §9), the client repeats the fetch until `hasMore = false`, then resumes live.
4. **Run completion.** When the server emits `run.completed`, the client continues to consume buffered events but does not need to resubscribe. Historical replay (tab reload after the run ended) uses the same snapshot endpoint — live and historical share one read path.

### 4.4 Prompt persistence — one row per assembly

`agent_run_prompts` is keyed by `(run_id, assembly_number)`. Every time `buildSystemPrompt` runs as part of a run (typically once at run start, plus once per handoff target, plus once per execution phase that re-assembles with new context), one row is written. The row holds the fully-assembled system prompt, the user prompt / task context, the serialised tool definitions passed to the LLM, and a `layerAttributions` JSONB describing how the prompt was composed (which layer contributed which substring — for the "what layer did this come from" click-through in the UI). The `prompt.assembled` event carries `{ assemblyNumber, promptRowId, totalTokens }` — the client fetches the full row on drill-down via `GET /api/agent-runs/:runId/prompts/:assemblyNumber`.

### 4.5 LLM payload persistence — one row per ledger row

`agent_run_llm_payloads` is keyed by `llm_request_id` (PK, FK to `llm_requests.id`). Written inside the existing `llmRouter` ledger-insert transaction so the payload row and the ledger row commit together. Rows hold `systemPrompt text`, `messages jsonb`, `toolDefinitions jsonb`, `response jsonb`, `redactedFields jsonb` (structured record of which fields were redacted — see §7 on redaction).

**Why keyed by `llm_request_id` not `run_id`.** One run has many LLM calls; the ledger already has the attribution (run, execution, iee, etc.). Keying the payload table by ledger ID keeps the join cheap and preserves the ledger's source-of-truth role. Non-agent LLM callers (skill-analyzer, config assistant) also produce payloads that this table can hold — but the client UI only joins from `agent_execution_events.linkedEntity` of type `llm_request`, so non-agent rows are dormant until a caller links to them.

**Storage trade-off, explicit.** A typical run produces 5–10 LLM calls averaging 50–500 KB of payload each (full system prompt + messages + response + tool defs). Budget: ~1 MB/run on average, up to 5 MB for heavy runs. At 100K runs/month that's 100 GB hot + 100 GB warm on rotation. Postgres TOAST compresses this ~3–4× in practice. Cold archive drops to S3 at month 18.

### 4.6 Retention tiering — hot / warm / cold

Three retention tiers, mirroring the ledger's archive pattern (`migrations/0188_llm_requests_archive.sql`). All env-var configurable.

| Tier | Scope | Retention | Where | Rotation |
|---|---|---|---|---|
| **Hot** | `agent_execution_events` + `agent_run_prompts` + `agent_run_llm_payloads`, full fidelity | `AGENT_EXECUTION_LOG_HOT_MONTHS` (default **6**) | Primary Postgres | Read-write |
| **Warm** | Event rows only (no payload bodies; prompts summarised to metadata only) | `AGENT_EXECUTION_LOG_WARM_MONTHS` (default **12**) | Primary Postgres, separate `agent_execution_events_warm` + `agent_run_prompts_warm` tables | Read-only after rotation |
| **Cold** | Full-fidelity archive | `AGENT_EXECUTION_LOG_COLD_YEARS` (default **7**) | Parquet blobs in `agent_execution_events_archive` table (BYTEA column, same shape as `llm_requests_archive` from `0188_llm_requests_archive.sql`) | Restore-on-demand via admin endpoint (deferred to Phase 3 — see §8) |

Rotation worker: `server/jobs/agentExecutionLogArchiveJob.ts` + `agentExecutionLogArchiveJobPure.ts` (pure cutoff math, same pattern as `llmLedgerArchiveJobPure.ts`). Registered in `server/services/queueService.ts` as `maintenance:agent-execution-log-archive`, runs at **03:30 UTC** (offset from the ledger archive's 03:45 UTC slot to avoid write contention).

Rotation per run: a run is eligible for rotation only when (a) its `agent_runs.status` is terminal per `TERMINAL_RUN_STATUSES`, and (b) its `completed_at` is older than the tier cutoff. In-flight runs are never touched — eliminates the rotate-during-live-stream race class.

### 4.7 Room lifecycle — live only while the run is active

The `agent-run:${runId}` room accepts new events while the run is in-flight per `IN_FLIGHT_RUN_STATUSES`. Once the `run.completed` / `run.failed` / `run.cancelled` event fires, the server stops emitting to the room but does NOT close the room — late-arriving clients may still join to render the historical view from the snapshot endpoint. Clients observing a terminal event know to stop expecting live events; no explicit teardown signal is needed.

### 4.8 Edit semantics — future runs only

When an operator clicks an Edit link in an event (e.g. "edit memory entry X"), the link opens the existing edit surface for that entity (the memory management page, the rule editor, etc.) — no new edit UI is built. The edit writes through the same service the existing pages use.

**Invariant.** The in-flight run continues with the state it already loaded. The event that triggered the Edit link still shows the pre-edit content for that run's historical view. A new audit row in `agent_execution_log_edits` records `{ edited_by, edited_at, triggering_run_id, entity_type, entity_id, edit_diff_summary }` for forensic trails — who edited what and which run's log triggered the edit. The audit table is not on the agent-run hot path; it's a side write from the edit surface, gated behind a feature flag during Phase 2 build-out.

### 4.9 Failure modes — explicit

| Failure | Behaviour |
|---|---|
| `appendEvent` DB write fails | Error logged; agent run continues. Event is lost for this run. Client reconciliation surfaces this only as a gap, not an error banner. |
| WebSocket emission fails | Event is persisted; client picks it up on next snapshot/backfill fetch. |
| Socket disconnect mid-run | Client reconnects via existing `useSocketRoom` hook, backfills via snapshot endpoint from `lastSeenSeq + 1`. |
| Agent run crashes mid-loop | Events already written are durable. No `run.completed` event; client renders the last known event and falls back on `agent_runs.status` after the run's crash-resume path fires. |
| Retention job misses a window | Next tick catches up — same guarantee as the ledger archive job. |
| Payload redaction mis-fires (leaves a secret in) | Operational risk, not correctness. Mitigation: redaction uses the same patterns library as logger redaction (`server/lib/redaction.ts` if it exists; otherwise build one in this spec and extend the logger to share it). See §7. |

---

## 5. Contracts

### 5.1 `agent_execution_events` — durable event log (new table)

```sql
CREATE TABLE agent_execution_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id          uuid NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  subaccount_id   uuid     REFERENCES subaccounts(id),  -- nullable for org- and system-tier runs
  sequence_number integer NOT NULL,
  event_type      text NOT NULL,              -- enum-like, see §5.3
  event_timestamp timestamptz NOT NULL DEFAULT now(),
  payload         jsonb NOT NULL,             -- event-type-specific shape, see §5.4
  linked_entity_type text,                    -- 'memory_entry' | 'memory_block' | 'policy_rule' | 'skill' | 'data_source' | 'prompt' | 'agent' | 'llm_request' | 'action' | null
  linked_entity_id   uuid,                    -- FK-like reference, validated at write time by the service
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, sequence_number)
);
CREATE INDEX agent_execution_events_run_seq_idx ON agent_execution_events (run_id, sequence_number);
CREATE INDEX agent_execution_events_org_created_idx ON agent_execution_events (organisation_id, created_at DESC);
CREATE INDEX agent_execution_events_linked_entity_idx ON agent_execution_events (linked_entity_type, linked_entity_id) WHERE linked_entity_type IS NOT NULL;

ALTER TABLE agent_execution_events ENABLE ROW LEVEL SECURITY;
-- RLS policy: organisation_id = current_setting('app.organisation_id')::uuid (pattern from architecture.md §1155)
```

Producer: `agentExecutionEventService.appendEvent()` (new service).
Consumer: (a) socket room `agent-run:${runId}` event `agent-run:execution-event`, (b) `GET /api/agent-runs/:runId/events` paginated read.

### 5.2 Event TypeScript contract (wire + service)

```ts
// shared/types/agentExecutionLog.ts
export interface AgentExecutionEvent {
  id: string;                      // uuid
  runId: string;
  organisationId: string;
  subaccountId: string | null;
  sequenceNumber: number;          // 1-indexed, unique per run
  eventType: AgentExecutionEventType;
  eventTimestamp: string;          // ISO 8601 UTC
  payload: AgentExecutionEventPayload;  // discriminated union by eventType — see §5.3
  linkedEntity: LinkedEntity | null;
  permissionMask: PermissionMask;  // server-computed, see §7
}

export interface LinkedEntity {
  type: LinkedEntityType;          // see §5.5
  id: string;                      // uuid
  label: string;                   // human-readable, e.g. "Memory: pricing tiers"
}

export interface PermissionMask {
  canView: boolean;
  canEdit: boolean;
  viewHref: string | null;         // null when canView=false
  editHref: string | null;         // null when canEdit=false
}

// Socket envelope reuses the existing pattern from server/websocket/emitters.ts
export interface AgentExecutionEventEnvelope {
  eventId: string;                 // ${runId}:${sequenceNumber}:${eventType} — deduped by client LRU
  type: 'agent-run:execution-event';
  entityId: string;                // runId
  timestamp: string;
  payload: AgentExecutionEvent;
}
```

### 5.3 Event type taxonomy — v1

Curated, not exhaustive. Each entry: what fires it, what payload shape, what entity gets linked.

| `eventType` | Fires when | `payload` shape (discriminated union) | `linkedEntity` |
|---|---|---|---|
| `orchestrator.routing_decided` | `orchestratorFromTaskJob` dispatches a run | `{ taskId, chosenAgentId, idempotencyKey, routingSource: 'rule' \| 'llm' \| 'fallback' }` | `{ type: 'agent', id: chosenAgentId }` |
| `run.started` | First event of every run | `{ agentId, runType, triggeredBy }` | `{ type: 'agent', id: agentId }` |
| `prompt.assembled` | `buildSystemPrompt` completes | `{ assemblyNumber, promptRowId, totalTokens, layerTokens: { master, orgAdditional, memoryBlocks, skillInstructions, taskContext } }` | `{ type: 'prompt', id: promptRowId }` |
| `context.source_loaded` | `runContextLoader` finishes a source | `{ sourceId, sourceName, scope, contentType, tokenCount, includedInPrompt, exclusionReason? }` | `{ type: 'data_source', id: sourceId }` |
| `memory.retrieved` | `workspaceMemoryService._hybridRetrieve` returns | `{ queryText, retrievalMs, topEntries: Array<{ id, score, excerpt }>, totalRetrieved }` | `{ type: 'memory_block' \| 'memory_entry', id: topEntries[0].id }` when non-empty; null otherwise |
| `rule.evaluated` | `decisionTimeGuidanceMiddleware` processes tool-call | `{ toolSlug, matchedRuleId?, decision: 'auto' \| 'review' \| 'block', guidanceInjected: boolean }` | `{ type: 'policy_rule', id: matchedRuleId }` when a rule matched; null otherwise |
| `skill.invoked` | Tool call dispatched | `{ skillSlug, skillName, input, reviewed: boolean, actionId? }` | `{ type: 'skill', id: skillId }` |
| `skill.completed` | Tool call returns | `{ skillSlug, durationMs, status: 'ok' \| 'error', resultSummary, actionId? }` | `{ type: 'skill', id: skillId }` |
| `llm.requested` | `llmRouter.routeCall` dispatches adapter call | `{ llmRequestId, provider, model, attempt, featureTag, payloadPreviewTokens }` | `{ type: 'llm_request', id: llmRequestId }` |
| `llm.completed` | `llmRouter` resolves the call | `{ llmRequestId, status, tokensIn, tokensOut, costWithMarginCents, durationMs }` | `{ type: 'llm_request', id: llmRequestId }` |
| `handoff.decided` | Agent hands off to another | `{ targetAgentId, reasonText, depth, parentRunId }` | `{ type: 'agent', id: targetAgentId }` |
| `clarification.requested` | `requestClarification` middleware fires | `{ question, awaitingSince }` | null |
| `run.completed` | Run transitions to terminal | `{ finalStatus, totalTokens, totalCostCents, totalDurationMs, eventCount }` | null |

**Discriminated union shape** — every payload is typed per eventType. Example:

```ts
export type AgentExecutionEventPayload =
  | { eventType: 'orchestrator.routing_decided'; taskId: string; chosenAgentId: string; idempotencyKey: string; routingSource: 'rule' | 'llm' | 'fallback' }
  | { eventType: 'run.started'; agentId: string; runType: string; triggeredBy: string }
  | { eventType: 'prompt.assembled'; assemblyNumber: number; promptRowId: string; totalTokens: number; layerTokens: { master: number; orgAdditional: number; memoryBlocks: number; skillInstructions: number; taskContext: number } }
  // ... one variant per eventType row above
  ;
```

`eventType` is a `text` column not a Postgres enum — matches the pattern from `llm_requests.status` (migration `0187_llm_requests_new_status_values.sql`) where adding a new value required a migration vs. a simple text check. Text + a TypeScript union + a service-layer validator is easier to extend. The service validates every event at write-time against the union.

### 5.4 Example event payload (worked, concrete — not pseudocode)

```json
{
  "id": "ae4f3c12-9b1f-4c68-8aa7-ef27bd1e5f60",
  "runId": "0f8e2a91-3b4c-4d8d-9e1a-1122334455aa",
  "organisationId": "b1234567-0000-0000-0000-000000000001",
  "subaccountId": "c9876543-0000-0000-0000-000000000002",
  "sequenceNumber": 7,
  "eventType": "memory.retrieved",
  "eventTimestamp": "2026-04-21T14:23:11.482Z",
  "payload": {
    "eventType": "memory.retrieved",
    "queryText": "what did the client say about pricing last month",
    "retrievalMs": 214,
    "topEntries": [
      { "id": "m-001", "score": 0.91, "excerpt": "Client flagged Q2 price increase in email on 2026-03-15 — wants a heads-up on any..." },
      { "id": "m-014", "score": 0.84, "excerpt": "Previous negotiation notes: willing to commit 18mo in exchange for rate lock..." }
    ],
    "totalRetrieved": 5
  },
  "linkedEntity": {
    "type": "memory_entry",
    "id": "m-001",
    "label": "Memory: pricing tiers"
  },
  "permissionMask": {
    "canView": true,
    "canEdit": true,
    "viewHref": "/subaccounts/c987.../memory/m-001",
    "editHref": "/subaccounts/c987.../memory/m-001/edit"
  }
}
```

Nullability rules: `subaccountId` is null for org-tier or system-tier runs. `linkedEntity` is null for events that reference no entity (e.g. `clarification.requested`, `run.completed`). `permissionMask.viewHref` is null when `canView=false`; `permissionMask.editHref` is null when `canEdit=false`. Clients must handle all three nullables.

### 5.5 `LinkedEntityType` enumeration

```ts
export type LinkedEntityType =
  | 'memory_entry'   // workspace_memories.id
  | 'memory_block'   // memory_blocks.id
  | 'policy_rule'    // policy_rules.id
  | 'skill'          // resolved slug -> skills.id OR system_skills.id
  | 'data_source'    // agent_data_sources.id
  | 'prompt'         // agent_run_prompts: composite (runId, assemblyNumber) encoded as string
  | 'agent'          // agents.id OR system_agents.id
  | 'llm_request'    // llm_requests.id
  | 'action';        // actions.id (for reviewed skill invocations)
```

### 5.6 `agent_run_prompts` — assembled prompt persistence (new table)

```sql
CREATE TABLE agent_run_prompts (
  run_id            uuid NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  assembly_number   integer NOT NULL,           -- 1-indexed per run
  organisation_id   uuid NOT NULL REFERENCES organisations(id),
  subaccount_id     uuid REFERENCES subaccounts(id),
  assembled_at      timestamptz NOT NULL DEFAULT now(),
  system_prompt     text NOT NULL,
  user_prompt       text NOT NULL,
  tool_definitions  jsonb NOT NULL,             -- array of { name, description, input_schema }
  layer_attributions jsonb NOT NULL,            -- { master: { startOffset, length }, orgAdditional: { ... }, memoryBlocks: [ { blockId, startOffset, length } ], skillInstructions: [...], taskContext: {...} }
  total_tokens      integer NOT NULL,
  PRIMARY KEY (run_id, assembly_number)
);
CREATE INDEX agent_run_prompts_org_assembled_idx ON agent_run_prompts (organisation_id, assembled_at DESC);

ALTER TABLE agent_run_prompts ENABLE ROW LEVEL SECURITY;
-- RLS same shape as agent_execution_events
```

`layer_attributions` enables the UI's "click this block of the prompt to see which memory/rule/instruction contributed it" feature.

### 5.7 `agent_run_llm_payloads` — full LLM payload persistence (new table)

```sql
CREATE TABLE agent_run_llm_payloads (
  llm_request_id    uuid PRIMARY KEY REFERENCES llm_requests(id) ON DELETE CASCADE,
  organisation_id   uuid NOT NULL REFERENCES organisations(id),
  subaccount_id     uuid REFERENCES subaccounts(id),
  system_prompt     text NOT NULL,
  messages          jsonb NOT NULL,             -- provider-neutral message array sent to the adapter
  tool_definitions  jsonb NOT NULL,
  response          jsonb NOT NULL,             -- full response body from adapter
  redacted_fields   jsonb NOT NULL DEFAULT '[]'::jsonb,  -- [{ path: 'messages.0.content', pattern: 'bearer_token', replacedWith: '[REDACTED]' }, ...]
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agent_run_llm_payloads_org_created_idx ON agent_run_llm_payloads (organisation_id, created_at DESC);

ALTER TABLE agent_run_llm_payloads ENABLE ROW LEVEL SECURITY;
-- RLS same shape as agent_execution_events; additional permission check (§7) for raw-payload read vs. summary read
```

### 5.8 `agent_execution_log_edits` — edit audit trail (new table, Phase 2)

```sql
CREATE TABLE agent_execution_log_edits (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  triggering_run_id  uuid NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  organisation_id    uuid NOT NULL REFERENCES organisations(id),
  subaccount_id      uuid REFERENCES subaccounts(id),
  edited_by_user_id  uuid NOT NULL REFERENCES users(id),
  edited_at          timestamptz NOT NULL DEFAULT now(),
  entity_type        text NOT NULL,   -- same taxonomy as LinkedEntityType
  entity_id          uuid NOT NULL,
  edit_summary       text NOT NULL,   -- human-readable summary written by the edit surface
  before_snapshot    jsonb,           -- nullable if the edit surface doesn't capture it
  after_snapshot     jsonb
);
CREATE INDEX agent_execution_log_edits_entity_idx ON agent_execution_log_edits (entity_type, entity_id);
CREATE INDEX agent_execution_log_edits_run_idx   ON agent_execution_log_edits (triggering_run_id);

ALTER TABLE agent_execution_log_edits ENABLE ROW LEVEL SECURITY;
```

Producer: the existing edit surfaces (memory page, rule editor, etc.) — they take a new optional `triggeringRunId` query param when the user arrived via a log link, and write the audit row on save.
Consumer: the log page's "this entity was edited after run X" annotation (Phase 2).

### 5.9 Snapshot read endpoint contract

`GET /api/agent-runs/:runId/events?fromSeq={n}&limit={n}` → `{ events: AgentExecutionEvent[], hasMore: boolean, highestSequenceNumber: number }`

- `fromSeq` defaults to `1`; inclusive.
- `limit` defaults to `1000`, capped at `1000`.
- Sort: `sequence_number ASC`.
- Permission: `authenticate` + tier-appropriate `AGENTS_VIEW` against the run's agent + `resolveSubaccount` when the run is subaccount-tier. See §7.
- Per-event `permissionMask` computed server-side before emission (no client-side permission logic).

`GET /api/agent-runs/:runId/prompts/:assemblyNumber` → `AgentRunPrompt` full row. Same permission gate as the events endpoint.

`GET /api/agent-runs/:runId/llm-payloads/:llmRequestId` → `AgentRunLlmPayload` full row. **Stricter** permission gate than the events endpoint — see §7 on "payload visibility inherits agent-edit permission."

### 5.10 Socket event envelope — dedup + ordering

Every emitted socket event uses the existing `{ eventId, type, entityId, timestamp, payload }` envelope from `server/websocket/emitters.ts`. `eventId = ${runId}:${sequenceNumber}:${eventType}` — unique across the lifetime of the table and cheap to dedup on. Clients use the existing `useSocket.ts` LRU (500 entries) — no new dedup code.

---

## 6. Files to change

Single source of truth for everything this spec touches. Every prose reference to a new file, column, migration, table, service, endpoint, job, or component appears in this table. If you add a reference elsewhere in the spec, cascade it here in the same edit.

### 6.1 Server — schema + migrations

| File | Change | Phase |
|---|---|---|
| `migrations/0190_agent_execution_log.sql` | **New** — creates `agent_execution_events` + `agent_run_prompts` + `agent_run_llm_payloads`; enables RLS + policies on all three; adds indexes per §5.1, §5.6, §5.7; adds the three tables to the RLS manifest via the separate TS file update below. | P1 |
| `migrations/0191_agent_execution_log_retention.sql` | **New** — creates `agent_execution_events_warm` + `agent_run_prompts_warm` + `agent_execution_events_archive` (Parquet BYTEA) tables, all with RLS enabled. | P3 |
| `migrations/0192_agent_execution_log_edits.sql` | **New** — creates `agent_execution_log_edits` audit table with RLS. | P2 |
| `server/db/schema/agentExecutionEvents.ts` | **New** — Drizzle schema for `agent_execution_events` + event-type TS union re-exported from `shared/types/agentExecutionLog.ts`. | P1 |
| `server/db/schema/agentRunPrompts.ts` | **New** — Drizzle schema for `agent_run_prompts`. | P1 |
| `server/db/schema/agentRunLlmPayloads.ts` | **New** — Drizzle schema for `agent_run_llm_payloads`. | P1 |
| `server/db/schema/agentExecutionLogEdits.ts` | **New** — Drizzle schema for `agent_execution_log_edits`. | P2 |
| `server/db/schema/index.ts` | **Modify** — re-export the four new schemas. | P1 / P2 |
| `server/config/rlsProtectedTables.ts` | **Modify** — add `agent_execution_events`, `agent_run_prompts`, `agent_run_llm_payloads`, `agent_execution_events_warm`, `agent_run_prompts_warm`, `agent_execution_events_archive`, `agent_execution_log_edits` to the manifest. Missing entries trip `verify-rls-coverage.sh`. | P1 / P2 / P3 |

### 6.2 Server — services + emission

| File | Change | Phase |
|---|---|---|
| `server/services/agentExecutionEventService.ts` | **New** — exports `appendEvent({ runId, eventType, payload, linkedEntity? })`, `streamEvents(runId, fromSeq?, limit?)`, `getPrompt(runId, assemblyNumber)`, `getLlmPayload(llmRequestId)`. `appendEvent` runs inside `withOrgTx`, assigns `sequenceNumber` via `SELECT COALESCE(MAX(sequence_number), 0) + 1 ... FOR UPDATE`, writes the row, then emits the socket envelope after commit. Validates payload shape against the discriminated union. Emission errors never fail the caller. | P1 |
| `server/services/agentExecutionEventServicePure.ts` | **New** — pure: event-payload validators (per-eventType), `buildPermissionMask(entityType, entityId, userContext)`, `buildLinkedEntityLabel(entityType, entityId, row)`, sequence-number contract helper. | P1 |
| `server/services/agentExecutionService.ts` | **Modify** — emit `run.started` after line 383; `prompt.assembled` after line 699 (and every subsequent re-assembly); `handoff.decided` at the handoff site; `run.completed` on terminal transitions. All emissions wrapped in try/catch-log per §4.1. | P1 |
| `server/services/workspaceMemoryService.ts` | **Modify** — emit `memory.retrieved` at the `_hybridRetrieve()` return boundary (not inside the ranking loop — see §3 reuse note). Payload includes `queryText`, `retrievalMs`, top-N entries with scores, total retrieved. | P1 |
| `server/services/memoryBlockService.ts` | **Modify** — emit `memory.retrieved` at the `getBlocksForInjection()` return boundary for the block-level retrieval (entity type `memory_block`). | P1 |
| `server/services/middleware/decisionTimeGuidanceMiddleware.ts` | **Modify** — emit `rule.evaluated` after rule match evaluation, whether or not a rule matched. Payload carries `{ toolSlug, matchedRuleId?, decision, guidanceInjected }`. | P1 |
| `server/services/skillExecutor.ts` | **Modify** — emit `skill.invoked` at `execute()` top and `skill.completed` at result return (inside the existing try/finally). Carries `actionId` when the invocation produced an action row. | P1 |
| `server/services/llmRouter.ts` | **Modify** — emit `llm.requested` immediately before `providerAdapter.call()` (same hook point the in-flight tracker uses via `llmInflightRegistry.add`). Emit `llm.completed` in the same `finally` block that writes the ledger row. Also write the `agent_run_llm_payloads` row in the same transaction as the ledger write when `sourceType='agent_run'` (other source types skip the payload write in P1 — revisit in P3 if needed). Emissions guarded by `runId != null` since non-agent LLM callers produce ledger rows but not agent-run events. | P1 |
| `server/services/runContextLoader.ts` | **Modify** — emit `context.source_loaded` per source at the loader's return boundary (one event per source). Payload is a slice of the existing `contextSourcesSnapshot` struct — no new capture logic. | P1 |
| `server/services/llmService.ts` | **Modify** — `buildSystemPrompt` returns an additional `layerAttributions` struct alongside the assembled prompt, computed from the same inputs it already uses. The caller persists the assembled prompt + attributions via `agentRunPromptService.persistAssembly()`. | P1 |
| `server/services/agentRunPromptService.ts` | **New** — thin service wrapping inserts into `agent_run_prompts`. Exposes `persistAssembly({ runId, systemPrompt, userPrompt, toolDefinitions, layerAttributions })` which returns the assigned `assemblyNumber` + row ID. Inserts inside `withOrgTx`. | P1 |
| `server/jobs/orchestratorFromTaskJob.ts` | **Modify** — emit `orchestrator.routing_decided` at the dispatch point (line ~233 where `logger.info('orchestratorFromTask.dispatched')` fires today). Payload carries `{ taskId, chosenAgentId, idempotencyKey, routingSource }` — `routingSource` in v1 is always `'rule'` or `'fallback'` per the current Orchestrator logic; `'llm'` lands when structured reasoning extraction ships (§9 deferred). | P1 |
| `server/services/middleware/requestClarification.ts` | **Modify** — emit `clarification.requested` alongside the existing `emitAwaitingClarification` call. | P1 |
| `server/lib/redaction.ts` | **New** — shared redaction patterns (Bearer tokens, API keys, common secret shapes). Used by `agent_run_llm_payloads` writer to redact fields in `messages` and `response` before persistence. Records redactions in the `redacted_fields` column. Extensible — callers pass a pattern bundle; a default bundle ships with this spec. | P1 |
| `server/lib/logger.ts` | **Modify** — optional: adopt the same `server/lib/redaction.ts` patterns so logger redaction and payload redaction stay in sync. Opt-in — not a hard dependency of this spec. | P1 |

### 6.3 Server — routes + websocket

| File | Change | Phase |
|---|---|---|
| `server/routes/agentExecutionLog.ts` | **New** — mounts `GET /api/agent-runs/:runId/events?fromSeq=&limit=`, `GET /api/agent-runs/:runId/prompts/:assemblyNumber`, `GET /api/agent-runs/:runId/llm-payloads/:llmRequestId`. Uses `asyncHandler`, `authenticate`, tier-aware `requireAgentRunViewPermission` guard (see §7). | P1 |
| `server/routes/index.ts` | **Modify** — register the new router. | P1 |
| `server/websocket/emitters.ts` | **Modify** — add `emitAgentExecutionEvent(runId, event)` helper. Same envelope shape as `emitAgentRunUpdate`. | P1 |
| `server/websocket/rooms.ts` | **Modify** — tighten `join:agent-run` handler so that the permission check for joining matches the new event permission check exactly (events on the wire carry `permissionMask` but the room join itself must also verify the socket user can view the run). | P1 |
| `server/services/queueService.ts` | **Modify** — register `maintenance:agent-execution-log-archive` cron at 03:30 UTC. | P3 |
| `server/jobs/agentExecutionLogArchiveJob.ts` | **New** — rotation worker: hot → warm (strip payload bodies) → cold (Parquet archive). Uses `createWorker()`. | P3 |
| `server/jobs/agentExecutionLogArchiveJobPure.ts` | **New** — pure cutoff math (hot cutoff, warm cutoff, cold cutoff) mirroring `llmLedgerArchiveJobPure.ts`. | P3 |

### 6.4 Server — permissions

| File | Change | Phase |
|---|---|---|
| `server/lib/permissions.ts` | **Read-only this phase.** No new permission key — view inherits from `AGENTS_VIEW` (tier-appropriate); edit inherits from the entity's existing edit permission. Payload-body read inherits from `AGENTS_EDIT`. | P1 / P2 |
| `server/lib/agentRunVisibility.ts` | **New** — exports `resolveAgentRunVisibility({ run, user })` returning `{ canView, canViewPayloads }` based on the run's tier (subaccount / org / system) and the user's permissions. Single source of truth for both the route guard and the WebSocket room join handler. | P1 |
| `server/lib/agentRunEditPermissionMask.ts` | **New** — exports `buildPermissionMask({ entityType, entityId, user, run })` returning `{ canView, canEdit, viewHref, editHref }` for every `LinkedEntityType`. One switch over entity type; each branch calls the existing per-entity permission check. | P1 |

### 6.5 Client — pages + components

| File | Change | Phase |
|---|---|---|
| `client/src/pages/AgentRunLivePage.tsx` | **New** — route `/runs/:id/live`. Fetches snapshot via `GET /api/agent-runs/:runId/events`, subscribes to `agent-run:${runId}` room, renders timeline. 100 ms event-buffer on mount / reconnect per §4.3. Lazy-loaded via `lazy()` per client architecture rules. | P1 |
| `client/src/components/agentRunLog/Timeline.tsx` | **New** — vertical timeline component; one entry per event, grouped by phase when sensible (prompt-assembly → memory retrieval → rule eval → LLM call → tool use). | P1 |
| `client/src/components/agentRunLog/EventRow.tsx` | **New** — per-event row: type-specific icon, label, time-relative-to-run-start, chevron for detail drawer. Renders `linkedEntity.label` + View/Edit links from `permissionMask`. | P1 |
| `client/src/components/agentRunLog/EventDetailDrawer.tsx` | **New** — drawer showing full payload JSON (pretty-printed), with a "View linked entity" CTA. For `llm.requested` / `llm.completed` events, offers "Fetch full payload" that calls `GET /api/agent-runs/:runId/llm-payloads/:llmRequestId` (subject to the stricter payload permission). For `prompt.assembled` offers "View full prompt" via the prompts endpoint. | P1 |
| `client/src/components/agentRunLog/LayeredPromptViewer.tsx` | **New** — renders the assembled prompt with per-layer colour/highlight using `layerAttributions`; clicking a layer shows which memory/rule/instruction contributed it. | P1 |
| `client/src/components/agentRunLog/EditedAfterBanner.tsx` | **New** — on a past-run view, surfaces a banner when any linked entity has been edited since the run (queries `agent_execution_log_edits` by `(entity_type, entity_id)`). | P2 |
| `client/src/App.tsx` | **Modify** — register the new route with `Suspense` fallback per client rules. | P1 |
| `client/src/pages/agentRuns/AgentRunDetailPage.tsx` (existing) | **Modify** — add a "Live log" tab pointing at the new route. | P1 |

### 6.6 Shared + docs

| File | Change | Phase |
|---|---|---|
| `shared/types/agentExecutionLog.ts` | **New** — exports `AgentExecutionEvent`, `AgentExecutionEventType`, `AgentExecutionEventPayload` (discriminated union), `LinkedEntity`, `LinkedEntityType`, `PermissionMask`, `AgentRunPrompt`, `AgentRunLlmPayload`, socket envelope type. | P1 |
| `architecture.md` | **Modify** — add "Live Agent Execution Log" subsection under the agent execution section. Describe the three-table model, emission pattern, retention tiering, and permission inheritance rule. | P1 |
| `docs/capabilities.md` | **Modify** — add bullet under "Agent Supervision" (customer-facing) describing the live log + replay surface in vendor-neutral language. Per CLAUDE.md editorial rules for `docs/capabilities.md`: no LLM-provider names, marketing/sales-ready terminology. | P1 |
| `CLAUDE.md` | **Modify** — add entry to the "Key files per domain" table: "Add a new agent execution event type" → `server/services/agentExecutionEventService.ts` + `shared/types/agentExecutionLog.ts` + `docs/spec-context.md accepted_primitives`. Update the "In-flight spec" pointer to point at this spec while it's being built. | P1 |
| `docs/spec-context.md` | **Modify** — add `agentExecutionEventService` + `agentRunPromptService` + `server/lib/redaction.ts` to the `accepted_primitives` list once Phase 1 lands. Do NOT add pre-merge. | P1 (post-merge) |

### 6.7 Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `AGENT_EXECUTION_LOG_HOT_MONTHS` | `6` | Hot tier retention. Below this age: full-fidelity read. |
| `AGENT_EXECUTION_LOG_WARM_MONTHS` | `12` | Warm tier retention. Payload bodies stripped; events + prompt metadata retained. |
| `AGENT_EXECUTION_LOG_COLD_YEARS` | `7` | Cold archive retention. Parquet blobs in `agent_execution_events_archive`. |
| `AGENT_EXECUTION_LOG_ARCHIVE_BATCH_SIZE` | `500` | Rotation job batch size per tick. |
| `AGENT_EXECUTION_LOG_ENABLED` | `true` | Master switch. When `false`, `appendEvent` is a silent no-op — safe rollback lever. |

---

## 7. Permissions / RLS

Three separate gates, each with a single source of truth.

### 7.1 View the live log — inherits from `AGENTS_VIEW` at the run's tier

Rule: if you can view the agent, you can view its run log. No new permission key.

| Run tier | Gate |
|---|---|
| Subaccount-tier run | `authenticate` + `resolveSubaccount(run.subaccountId, run.organisationId)` + `requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.AGENTS_VIEW)` |
| Org-tier run | `authenticate` + `requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW)` (scoped to the run's organisation) |
| System-tier run | `authenticate` + `requireSystemAdmin` |

Composed in one place: `server/lib/agentRunVisibility.ts → resolveAgentRunVisibility()`. Consumed by:

1. The route guard on `GET /api/agent-runs/:runId/events` (and the prompts + payloads endpoints).
2. The WebSocket `join:agent-run` handler in `server/websocket/rooms.ts` — must reject sockets that would not pass the HTTP route guard for the same run.

**Why single source of truth matters.** A socket that joins successfully but whose HTTP fetch is denied creates a confusing half-gated view. Using the same resolver for both closes that class of bug.

### 7.2 Edit link visibility — inherits from the linked entity's existing edit permission

No new permission key. The per-entity permission check already exists for every `LinkedEntityType` — this spec just routes through it.

| `LinkedEntityType` | Edit permission check (existing) |
|---|---|
| `memory_entry` | Subaccount: `SUBACCOUNT_PERMISSIONS.WORKSPACE_MANAGE` on the subaccount that owns the memory. Org: `ORG_PERMISSIONS.WORKSPACE_MANAGE`. |
| `memory_block` | Same as `memory_entry`. |
| `policy_rule` | Subaccount: `SUBACCOUNT_PERMISSIONS.WORKSPACE_MANAGE`. Org: `ORG_PERMISSIONS.WORKSPACE_MANAGE`. |
| `skill` | Subaccount skill: `SUBACCOUNT_PERMISSIONS.SKILLS_MANAGE`. Org skill: `ORG_PERMISSIONS.SKILLS_MANAGE`. System skill: **no edit link ever shown** (system-managed) — `editHref: null`. |
| `data_source` | Entity-scope-aware: attached-to-agent uses `AGENTS_EDIT`; subaccount-scope uses `WORKSPACE_MANAGE`. |
| `agent` | System agent: `masterPrompt` not editable anywhere (`isSystemManaged=true` — enforced in the agent edit service today). Only `additionalPrompt` editable via `ORG_PERMISSIONS.AGENTS_EDIT`. Org/subaccount agents: tier-appropriate `AGENTS_EDIT`. |
| `prompt` | Not editable — prompts are an artefact of a past run. `canEdit` always false. |
| `llm_request` | Not editable — immutable ledger row. `canEdit` always false. |
| `action` | Already has its own review/approval permission; not re-gated here. `canEdit` always false — review flows go through the existing actions surface. |

The resolver for all of the above: `server/lib/agentRunEditPermissionMask.ts → buildPermissionMask()`. Called once per event at emission time, so the permission mask is baked into the event payload and the client does no permission logic.

**Edits never affect the in-flight run.** The linked edit surface writes through the existing edit service for the entity — which does not mutate any state the in-flight run has already loaded. Runs re-read fresh state on the next handoff or the next run dispatch; nothing reaches back into an executing loop.

### 7.3 Raw LLM payload read — stricter than view-log

Full-fidelity LLM payloads (system prompt, messages, tool definitions, response) often contain:

- Bearer tokens / API keys in tool-call arguments or tool results.
- PII from customer-supplied content flowing through the user prompt.
- Prompt internals (memory block composition, skill instructions) that operational users do not need direct access to.

Rule: payload reads inherit from `AGENTS_EDIT` at the run's tier, not `AGENTS_VIEW`.

| Run tier | Payload read gate |
|---|---|
| Subaccount-tier run | `SUBACCOUNT_PERMISSIONS.AGENTS_EDIT` |
| Org-tier run | `ORG_PERMISSIONS.AGENTS_EDIT` |
| System-tier run | `requireSystemAdmin` |

Consumed by `GET /api/agent-runs/:runId/llm-payloads/:llmRequestId`. The events endpoint and prompts endpoint remain on the looser `AGENTS_VIEW` gate — only the raw LLM payload tightens.

**UI implication.** In the event detail drawer, the "Fetch full payload" CTA for `llm.requested` / `llm.completed` events is gated on `permissionMask.canViewPayload` (a third bit alongside `canView` + `canEdit`, computed by the same resolver). When the user lacks it, the CTA is replaced with a neutral "Payload view requires agent-edit permission" note — no error.

### 7.4 Redaction — layered defence before persistence

Even with the stricter payload-read gate, raw payload persistence is high-risk. Mitigation: `server/lib/redaction.ts` applies pattern-based redaction to `messages` and `response` fields **before** write to `agent_run_llm_payloads`. Default patterns (non-exhaustive):

- `Bearer [A-Za-z0-9._\-]{20,}` → `[REDACTED:bearer]`
- `sk-[A-Za-z0-9]{20,}` / `sk-proj-[A-Za-z0-9]{20,}` → `[REDACTED:openai_key]`
- `ghp_[A-Za-z0-9]{36}` → `[REDACTED:github_token]`
- Common Slack / HMAC / webhook patterns extracted from real incident patterns.

Every redaction records a row in `redacted_fields`: `{ path: 'messages.2.content', pattern: 'bearer_token', replacedWith: '[REDACTED:bearer]', count: 3 }`. This does two jobs: (a) operators know the payload was scrubbed, (b) false positives are auditable and the pattern can be refined.

Redaction is applied once, at persistence time. The in-memory payload the router hands to the adapter is untouched — the adapter still sees the real token. Only the durable record is scrubbed.

**Redaction is not a security boundary — permission gates are.** The pattern library is best-effort defence-in-depth; it catches obvious leaks but a motivated attacker can engineer tokens that slip past patterns. The real protection is still the AGENTS_EDIT gate on the payload read endpoint. Document this explicitly in `architecture.md` to prevent future drift toward "redaction is enough."

### 7.5 RLS policies — three-layer fail-closed isolation

Per `architecture.md §1155 "Row-Level Security — Three-Layer Fail-Closed Data Isolation"`, every new tenant-scoped table ships:

1. **RLS policy in the creating migration.** All four new tables (`agent_execution_events`, `agent_run_prompts`, `agent_run_llm_payloads`, `agent_execution_log_edits`) use the same shape:
   ```sql
   CREATE POLICY "${table}_org_isolation" ON ${table}
     USING (organisation_id = current_setting('app.organisation_id', true)::uuid);
   ```
   System-admin bypass via `SECURITY DEFINER` on the archive job only; no bypass on read paths.

2. **Manifest entry in `server/config/rlsProtectedTables.ts`.** All four tables listed in the same migration they are created. `verify-rls-coverage.sh` fails the build if any is missing — enforced in CI.

3. **Route-level guard.** Every route in `server/routes/agentExecutionLog.ts` uses `authenticate` first, then the tier-appropriate permission guard, then `resolveSubaccount` when applicable. All reads go through `getOrgScopedDb` / `withOrgTx` — direct `db` access forbidden by `verify-rls-contract-compliance.sh`.

4. **Principal-scoped context on writes.** `appendEvent` is called from multiple services, all of which already run inside principal-scoped transactions via `withPrincipalContext`. The event write inherits this context — no new scoping primitive needed.

### 7.6 Events that reference cross-tier entities

One edge case: a system agent run can link to an organisation's memory block it loaded during execution. The event's `linkedEntity` refers to the block; `linkedEntity.label` would otherwise leak the block's name into the system admin's view.

Resolution: the system admin viewing a system-tier run *does* see the linked entity label, because they are system admin and already have read access to every org. No leakage — this is the correct tier rule. The opposite direction (org user viewing a system-tier run that referenced their memory) cannot happen because org users cannot view system-tier runs per §7.1.

No gap.

---

## 8. Phase sequencing

Three phases, each independently shippable and independently reviewable. Dependency graph checked: no backward references, no orphaned deferrals. Each phase lists its schema changes, services introduced, services modified, jobs introduced, and columns referenced by code — the exact bookkeeping the checklist in `docs/spec-authoring-checklist.md §6` asks for.

### Phase 1 — MVP live log (persistence + emission + read paths + basic UI)

**Schema changes introduced:** migration `0190_agent_execution_log.sql` creates `agent_execution_events`, `agent_run_prompts`, `agent_run_llm_payloads` with RLS policies. Adds all three to `rlsProtectedTables.ts` in the same migration.

**Services introduced:** `agentExecutionEventService`, `agentExecutionEventServicePure`, `agentRunPromptService`, `agentRunVisibility`, `agentRunEditPermissionMask`, `redaction` (in `server/lib/`).

**Services modified:** `agentExecutionService`, `workspaceMemoryService`, `memoryBlockService`, `decisionTimeGuidanceMiddleware`, `skillExecutor`, `llmRouter`, `runContextLoader`, `llmService`, `requestClarification`, `orchestratorFromTaskJob`.

**Routes introduced:** `server/routes/agentExecutionLog.ts` mounting the three read endpoints.

**WebSocket surface:** new emitter `emitAgentExecutionEvent` + tightened `join:agent-run` handler.

**Client surface:** `AgentRunLivePage` + `Timeline` + `EventRow` + `EventDetailDrawer` + `LayeredPromptViewer`. Route registered in `App.tsx`. Detail-page tab added.

**Jobs introduced:** none.

**Columns referenced by code:** only columns defined in migration 0190 — no forward references.

**Ship criterion:** an operator navigating to `/runs/:id/live` for an active agent run sees events stream in within 100 ms of dispatch; after the run ends, the same page renders the durable history from the snapshot endpoint; permission gates reject users who lack agent-view on the run's tier. Full LLM payloads accessible to agent-editors via the drawer CTA.

**Not in P1:** edit-link audit trail, retention archival, cold restore. See below.

### Phase 2 — Inline edit audit trail + entity-edited banner

**Schema changes introduced:** migration `0192_agent_execution_log_edits.sql` creates `agent_execution_log_edits` with RLS + manifest entry.

**Services introduced:** none new — the existing edit services (memory edit, rule edit, skill edit) gain an optional `triggeringRunId` write path that appends an audit row.

**Services modified:** memory edit, rule edit, skill edit, data-source edit — each accepts an optional `triggeringRunId` and writes `agent_execution_log_edits` on save.

**Client surface:** `EditedAfterBanner` component on `AgentRunLivePage` (shown for past runs only); all linked-entity Edit CTAs pass `?triggeringRunId=` to the edit surface.

**Jobs introduced:** none.

**Columns referenced by code:** `agent_execution_log_edits.*` — created in migration 0192. No forward reference.

**Ship criterion:** edits made via a log-link are auditable; viewing a past run shows a banner on events whose linked entity has been edited since.

### Phase 3 — Retention tiering + cold archive

**Schema changes introduced:** migration `0191_agent_execution_log_retention.sql` creates `agent_execution_events_warm`, `agent_run_prompts_warm`, `agent_execution_events_archive`, all with RLS + manifest entries.

**Services introduced:** none.

**Services modified:** `queueService` (registers the new cron).

**Jobs introduced:** `agentExecutionLogArchiveJob` + `agentExecutionLogArchiveJobPure` — scheduled at 03:30 UTC via `maintenance:agent-execution-log-archive`.

**Env vars introduced:** `AGENT_EXECUTION_LOG_HOT_MONTHS`, `AGENT_EXECUTION_LOG_WARM_MONTHS`, `AGENT_EXECUTION_LOG_COLD_YEARS`, `AGENT_EXECUTION_LOG_ARCHIVE_BATCH_SIZE`.

**Columns referenced by code:** `*_warm` and `_archive` tables — created in migration 0191. No forward reference.

**Ship criterion:** job runs nightly and moves rows between tiers; read endpoints transparently fall through hot → warm → cold on lookup (cold returns a job handle + retrieval ETA rather than the row directly, matching the ledger archive pattern).

### Dependency verification (phase-boundary contradiction check)

Per `docs/spec-authoring-checklist.md §6`, explicit per-phase ledger:

| Phase | Creates tables | Reads tables created in | No forward deps? |
|---|---|---|---|
| P1 | `agent_execution_events`, `agent_run_prompts`, `agent_run_llm_payloads` | P1 only | Yes |
| P2 | `agent_execution_log_edits` | P1 + P2 | Yes |
| P3 | `*_warm`, `*_archive` | P1 (rotates from) + P3 | Yes |

P2 and P3 are independent — they can ship in either order after P1. P2 is recommended second because the edit surface is high-visibility for demos; P3 is background hygiene that matters only as runs accumulate.

### Each phase is independently mergeable

A partial merge leaves the system functional:

- P1 alone: live log works; edit links point at existing edit pages (without audit trail); retention is "never rotate" (fine for the first 6 months). Hot table grows linearly; monitoring is the operational signal for when P3 needs to land.
- P1 + P2: full interactive surface, still no rotation.
- P1 + P2 + P3: full surface with long-term storage hygiene.

No intermediate state breaks behaviour. Retention-off-by-default in P1/P2 is explicit, not implicit.

---

## 9. Deferred Items

Every item below has been surfaced either in prose in this spec or in the surrounding conversation, and is deliberately out of scope. Per `docs/spec-authoring-checklist.md §7`, the section is the single source of truth — no in-scope surprises.

- **Replay-and-restart.** Re-running an agent run with edited inputs, using the durable event log as a starting checkpoint. Adjacent surface; materially different feature (non-determinism tradeoffs, cost duplication, idempotency-key semantics). Deferred until a real operator ask lands against the live log + audit surface. Requires its own spec — likely sits on top of `agentRunMessages` + a new "runs:replay" action.

- **Token-level LLM streaming.** Per-token progress rendered live inside an `llm.requested` event row (provider SSE mode). Requires the router to opt into streaming and buffer tokens, changing the adapter contract. The primary question the feature answers — "is this call stuck and which context is it seeing?" — is already answered by start time + elapsed + payload drawer. Same rationale as the in-flight tracker's deferral of the same item.

- **Cross-run search / analytics.** "Find runs where memory X was used", "find runs where rule Y matched", "find runs with > $Z LLM spend". Requires indexing on `linked_entity_type` + `linked_entity_id` (already indexed per §5.1) plus a search surface. Valuable but orthogonal to the per-run live log. Deferred — tracked as a follow-up spec.

- **Orchestrator structured decision reasoning.** Today `orchestrator.routing_decided` carries `routingSource: 'rule' | 'llm' | 'fallback'` plus chosen agent. The *why* (which task feature → which agent) is in the Orchestrator's LLM output, not in a typed structure. Extracting a structured reason requires either (a) post-processing the Orchestrator's final message with a parser prompt or (b) restructuring the Orchestrator's prompt to emit a typed decision block. Deferred — its own spec because it changes Orchestrator-side contract.

- **Rule-evaluation audit table.** A typed, queryable record of every policy rule evaluated (not just the one that matched) with confidence scores, override applied, guidance text injected. Today the `rule.evaluated` event captures the outcome — enough for the live log. A separate audit table answers "which rules have fired across all runs in the last 30 days, by subaccount?" — cross-run analytics, not live debugging. Deferred — overlaps with the cross-run search deferral above.

- **Belief extraction / uncertainty flagging / citation scoring.** S12-tier features (memory & briefings workstream). These are observable outputs of a run, not inputs — they fit a different event category (`run.insights_produced` or similar). Deferred to the S12 spec, not this one.

- **Real-time cost rollup in the timeline header.** Live-updating total cost + token count at the top of the page as `llm.completed` events arrive. Straightforward extension; deferred only because it is UI polish and the numbers are already in each event's payload. Add in a Phase 1.5 polish pass if demos ask for it.

- **Mobile / responsive layout for the live log page.** Desktop-first for demo + debugging contexts. Deferred.

- **Non-agent LLM callers linked in-line.** When an agent run invokes `skill-analyzer-classify` (which uses the router), the resulting LLM call already has `sourceType='agent_run'` + `runId` if the router context was propagated, so it appears in-line in v1. **Action item — verify at build time:** confirm every agent-invoked path that calls the router threads the run's context through. If any path loses the context, add a new event `delegated.skill_analyzer_invoked` as a connector. Flag rather than deferred — resolve during P1 build.

- **Historical replay restore-on-demand UX.** Phase 3 writes cold archives; restoring a run's archived events for re-view requires an admin-triggered restore job that materialises rows back into the hot tables (or a streaming read that thaws Parquet blobs on request). Deferred within P3 — v1 of the archive is "archive only, no restore path"; a restore UX ships when the first operator request lands against a cold-archived run. Tracked as P3.1.

- **Cross-instance sequence-number uniqueness under high concurrency.** The `MAX + 1` sequence allocation serialises event writes per run via `FOR UPDATE`. On a single run this is fine — an agent loop is single-threaded per run. If a future change introduces parallel event writers for the same run (e.g. a shadow evaluator running alongside the real loop), sequence-number collisions become possible. Deferred — revisit when a parallel-writer feature is proposed.

- **Payload-diff view between retries.** When a retry re-dispatches the same call with a slightly different prompt (e.g. after tool-result insertion), a diff view on the payload drawer would let operators see exactly what changed. Compelling; non-trivial UI (text-diff + JSON-structural-diff hybrid). Deferred.

- **Real-time permission-mask invalidation.** If an admin revokes a user's `AGENTS_VIEW` while they are watching a live stream, the socket room doesn't boot them — they keep receiving events until they refresh. Matches existing behaviour on every other permission-gated socket surface in the app. Deferred as a global concern, not this spec's problem.

---

## 10. Testing posture

Per `docs/spec-context.md`:

```yaml
testing_posture: static_gates_primary
runtime_tests: pure_function_only
frontend_tests: none_for_now
api_contract_tests: none_for_now
e2e_tests_of_own_app: none_for_now
```

This spec respects every line. No frontend tests, no supertest / API contract tests, no Playwright / E2E against the app itself.

### 10.1 Pure tests (shipping with P1)

`server/services/__tests__/agentExecutionEventServicePure.test.ts`:

- **Event payload validators per event type.** Every valid variant validates; every invalid variant (missing required field, wrong type, unknown event type) rejects. At least one passing + one failing fixture per event type in §5.3.
- **Linked-entity label builder.** Given `(entityType, entityId, row)`, produces the expected human-readable label for each `LinkedEntityType`.
- **Sequence-number contract.** `sequenceNumber` is 1-indexed, monotonic. Gaps tolerated (client-side rendering unaffected). The test asserts the rule; the DB integration side isn't unit-testable.
- **Event envelope builder.** `eventId = ${runId}:${sequenceNumber}:${eventType}` shape is unique across the cartesian product of the three components.

`server/lib/__tests__/agentRunEditPermissionMaskPure.test.ts` (the resolver from §6.4):

- **One fixture per `LinkedEntityType` × tier × (has-permission, lacks-permission)** — confirms the mask's `canView` / `canEdit` / `viewHref` / `editHref` match the expected matrix from §7.2.
- **System-managed agent masterPrompt** → `canEdit: false` regardless of caller permission (enforced by the `isSystemManaged` guard).
- **Immutable entity types** (`prompt`, `llm_request`, `action`) → `canEdit: false` under every caller.

`server/lib/__tests__/agentRunVisibilityPure.test.ts`:

- **Per-tier visibility.** Subaccount user + subaccount run → `canView: true` when `AGENTS_VIEW` granted, false otherwise. Org user + subaccount run → `canView: true` only when the user's org contains the subaccount and they hold `ORG_PERMISSIONS.AGENTS_VIEW`. System admin → always `canView: true`.
- **Payload visibility (`canViewPayload`)** — requires `AGENTS_EDIT` at the appropriate tier; inversely tested against the view-only cases.

`server/lib/__tests__/redactionPure.test.ts`:

- Bearer / OpenAI / GitHub / Slack token patterns each match a positive fixture + reject a near-miss. Redaction output records the path, pattern, and replacement count.
- Nested JSON redaction walks arrays + objects without infinite recursion on self-referential shapes.
- Tuple `(input, expectedRedacted, expectedRecordedFields)` verified exactly — no ambiguous contract.

`server/jobs/__tests__/agentExecutionLogArchiveJobPure.test.ts` (P3):

- Hot → warm cutoff math with `AGENT_EXECUTION_LOG_HOT_MONTHS` boundary cases (exactly at cutoff = keep hot; 1 day past = rotate).
- Warm → cold math with `AGENT_EXECUTION_LOG_WARM_MONTHS`.
- Terminal-status filter — in-flight runs are never selected for rotation.
- Batch-size slicing — when > `AGENT_EXECUTION_LOG_ARCHIVE_BATCH_SIZE` rows eligible, exactly the batch-size window is returned with a deterministic order (oldest first).

### 10.2 Static gates (no new gate needed)

- `verify-rls-coverage.sh` already enforces the four new tables are in the manifest — fails the build if missing.
- `verify-rls-contract-compliance.sh` already enforces that no route accesses `db` directly — keeps the new routes on `getOrgScopedDb` / `withOrgTx`.
- `verify-no-direct-adapter-calls.sh` already guarantees LLM payload writes can only come from the router — `agent_run_llm_payloads` rows can't be bypassed by a rogue caller.

### 10.3 What this spec explicitly does not test

- **No frontend component tests.** `AgentRunLivePage`, `Timeline`, `EventRow`, `EventDetailDrawer`, `LayeredPromptViewer`, `EditedAfterBanner` ship without unit tests — per `frontend_tests: none_for_now`. Smoke verification is manual via the browser against a running dev agent.
- **No API contract tests (supertest).** The three new read endpoints ship without tests — per `api_contract_tests: none_for_now`. Permission gates are covered transitively by the pure permission-resolver tests.
- **No runtime tests of the service integration path.** The service → WebSocket → client loop is verified manually in dev. When `runtime_tests: pure_function_only` relaxes, this is the first candidate to promote.
- **No performance baseline.** Per `performance_baselines: defer_until_production`. Inline emission on every decision event is a known hot-path addition; we monitor aggregate agent-run latency after first merge and regress if needed.

### 10.4 Manual smoke posture (not a CI gate)

Before merge, confirm manually in dev:

1. Start an agent run that uses memory retrieval, fires at least one policy rule, invokes at least one skill, and makes at least 2 LLM calls.
2. Open `/runs/:id/live` in a browser; confirm events arrive within 100 ms of dispatch.
3. Click a `memory.retrieved` event — drawer shows top entries with scores.
4. Click the View link on a memory entry — lands on the existing memory detail page.
5. Click Edit — if the caller has `WORKSPACE_MANAGE`, edit page opens; if not, the link is absent (not shown) rather than showing an error.
6. Click a `llm.completed` event + "Fetch full payload" — with `AGENTS_EDIT` the payload drawer renders; without it, the neutral "requires agent-edit permission" note appears.
7. Kill the socket connection (devtools → offline), wait 5 s, reconnect — the UI backfills the missed events via the snapshot endpoint without re-rendering already-seen events.
8. Refresh the page after the run ends — the full durable timeline reloads from `GET /api/agent-runs/:runId/events`.

Any failure on items 1–8 is a blocker for merge.

---

## 11. Self-consistency check

Per `docs/spec-authoring-checklist.md §8`, this is the directed contradiction scan.

### 11.1 Goals ↔ implementation match

Every load-bearing guarantee from §2 has a named mechanism:

| §2 Guarantee | §4–§7 mechanism |
|---|---|
| Exactly one event per decision, deterministic per-run ordering | `agent_execution_events UNIQUE (run_id, sequence_number)` + `FOR UPDATE` sequence allocation in `appendEvent` (§4.1, §4.2) |
| No dropped events on WebSocket dropout | Durable write before emit + `GET /api/agent-runs/:runId/events?fromSeq=N` backfill on reconnect (§4.3) |
| No double-rendered events on reconnect | `eventId` LRU in `useSocket.ts` (existing 500-entry cache) — §5.10 |
| No cross-tenant leakage | RLS policy on all four new tables + `RLS_PROTECTED_TABLES` manifest + `verify-rls-coverage.sh` gate + route guards + socket handler mirroring route permissions (§7.1, §7.5) |
| No mid-run edit hot-swap | Edit link writes through existing entity edit services; run keeps loaded state; audit row in `agent_execution_log_edits` (§4.8, §7.2) |
| No unbounded storage growth | Retention job at 03:30 UTC + tier cutoffs + env var configuration (§4.6) |
| Persisted full assembled prompt | `agent_run_prompts` with `(run_id, assembly_number)` PK (§5.6) + `agentRunPromptService.persistAssembly()` (§6.2) |
| Persisted full LLM payload | `agent_run_llm_payloads` keyed by `llm_request_id`, written inside the ledger insert transaction (§4.5, §5.7) |
| Permission-gated entity links | Per-entity `permissionMask` baked into event payload at emission; resolver in `agentRunEditPermissionMask` (§6.4, §7.2) |
| Tiered retention hot / warm / cold | Three-table pair + rotation job (§4.6, §8 P3) |

No guarantee is load-bearing without a named mechanism.

### 11.2 Execution model consistency check

- **Inline emission** (§4.1) → no pg-boss job row for the write path → no idempotency table entry needed for emission → consistent.
- **Queued retention archive** (§4.6) → job row in `pg-boss` queue `maintenance:agent-execution-log-archive` → `createWorker()` pattern matches ledger archive → consistent.
- Durable event persistence is **not** framed as cached — no cache-efficiency claims to contradict.
- Socket push is **after** DB commit → no hot-path contention vs. "real-time push" framing — the 100 ms buffer on the client side absorbs the commit latency invisibly (§4.1, §4.3).

No execution-model contradiction.

### 11.3 Phase dependency consistency check

Per §8:

| Phase | Tables created | Tables read | Forward deps? |
|---|---|---|---|
| P1 | `agent_execution_events`, `agent_run_prompts`, `agent_run_llm_payloads` | same | No |
| P2 | `agent_execution_log_edits` | + P1 tables | No |
| P3 | `*_warm`, `*_archive` | + P1 tables (reads for rotation) | No |

No backward references.

### 11.4 Deferred items audit

Every "deferred", "later", "future", "nice to have", "not in this phase" phrase in prose appears in §9. Grep-verified at draft time. Empty would be suspicious — §9 has 12 entries. One flagged item (non-agent LLM callers linked in-line) is **action-at-build-time**, not deferred — explicitly marked as such.

### 11.5 Framing compliance (`docs/spec-context.md`)

Cross-checked against the spec-context framing. Compliance:

| Framing line | Spec posture |
|---|---|
| `testing_posture: static_gates_primary` | §10 — pure tests + static gates only. |
| `runtime_tests: pure_function_only` | §10 — every test listed is a pure `*Pure.test.ts`. |
| `frontend_tests: none_for_now` | §10.3 — explicit. |
| `api_contract_tests: none_for_now` | §10.3 — explicit. |
| `e2e_tests_of_own_app: none_for_now` | §10 — no E2E proposed. |
| `feature_flags: only_for_behaviour_modes` | **Compliance issue to resolve: §6.7 lists `AGENT_EXECUTION_LOG_ENABLED` as a kill-switch env var.** This is close to a behaviour mode (on/off of the feature) but not quite — it's a rollback lever. **Recommended resolution: drop the env var from the spec.** `rollout_model: commit_and_revert` is the agreed-upon posture; if the feature needs to be disabled post-merge, `git revert` is the tool. The retention env vars (`*_HOT_MONTHS`, `*_WARM_MONTHS`, `*_COLD_YEARS`, `*_ARCHIVE_BATCH_SIZE`) are operational tunables like `LLM_LEDGER_RETENTION_MONTHS`, not feature flags — those stay. Build-time, delete `AGENT_EXECUTION_LOG_ENABLED` from §6.7. |
| `prefer_existing_primitives_over_new_ones: yes` | §3 — every primitive extends an existing one; the one genuinely new primitive (`agent_execution_events`) has a dedicated justification paragraph. |
| `accepted_primitives` | Reuse confirmed for: `withOrgTx`, `getOrgScopedDb`, `RLS_PROTECTED_TABLES`, `verify-rls-*.sh`, `createWorker()`, `shared/runStatus.ts`. New additions to the list are post-merge (§6.6). |
| `convention_rejections: "do not add feature flags for new migrations"` | §8 migrations are not behind feature flags. Resolved by the compliance fix above. |
| `convention_rejections: "do not introduce new service layers when existing primitives fit"` | §3 rigorous on reuse; new services (`agentExecutionEventService`, `agentRunPromptService`) are thin, single-responsibility, and slot into the existing route→service→db convention. No new layer invented. |

**One open compliance gap — resolve before implementation:** delete `AGENT_EXECUTION_LOG_ENABLED` from §6.7. Logged here rather than silently edited because the checklist says to flag compliance deviations in the framing section rather than fix them implicitly.

### 11.6 Contract self-checks

- Every contract in §5 has: Name, Type, Example instance, Nullability rules, Producer, Consumer. Verified per-entry.
- Every `LinkedEntityType` in §5.5 has a matching branch in §7.2's permission matrix — no orphaned types.
- Every event type in §5.3 has a matching emission site in §6.2 — no orphaned events.
- Every file in §6.1–§6.6 has a matching reference in an earlier section (primitives search, execution model, contracts, or permissions) — no orphaned files.
- The `agent_execution_events.linked_entity_type` column uses a text-based union that matches the TS `LinkedEntityType` exactly — §5.1 + §5.5 agree.

### 11.7 "Must / guarantees / source of truth" audit

Every load-bearing word in the spec has a named mechanism (listed in §11.1). No load-bearing claims left dangling.

### 11.8 Biggest risks (residual)

- **Storage cost at scale.** 100 GB hot + 100 GB warm per 100K runs/month is a real number. Postgres TOAST compression mitigates ~3–4×. Worst case: payload write becomes the hot-path dominating cost for high-frequency agents. Mitigation if triggered: move `agent_run_llm_payloads` to a separate tablespace or switch to S3-backed blobs for hot tier; documented in §9 "Historical replay restore-on-demand UX" and adjacent. Not solved pre-emptively — measured in P1, mitigated in a follow-up.
- **Redaction false negatives.** Patterns catch obvious tokens; novel secret shapes slip through. Defence-in-depth via the `AGENTS_EDIT` payload gate, documented explicitly in §7.4. Recovery posture: expand patterns + reprocess affected rows.
- **Sequence-number `FOR UPDATE` contention under parallel writers.** Not an issue for single-run emission, becomes one if a future feature introduces parallel writers. Deferred in §9.
- **Orchestrator decision reasoning is a single-line text field.** Structured reasoning extraction is deferred; operators see the Orchestrator's own LLM output via the nested agent-run log (Orchestrator is itself an agent run, generating its own events), which is a partial compensation. Good enough for v1; revisited when the deferred spec lands.

---

## 12. Open decisions the author still wants confirmed

Four items where the spec has picked a default but the human should actively sign off before implementation. These are not ambiguities — they are decisions the author made with reasoning, flagged here so they can be reversed cheaply.

1. **Full LLM payload storage in `agent_run_llm_payloads` (§5.7) — confirmed choice (c) from prior exchange.** Implication: ~100 GB hot / 100 GB warm per 100K runs/month, Postgres TOAST. Override path if cost becomes punitive: shift to S3 in Phase 3 (table schema already leaves room — just swap the write path).

2. **Retention tiers: 6mo hot / 12mo warm / 7yr cold.** Env-configurable. Defaults picked for an agency audit scenario where clients may ask about runs years later. Override path: change the env var defaults pre-merge.

3. **View permission inherits from `AGENTS_VIEW`, no new permission key.** Rationale: minimise rollout friction; the log is observability over data the user already has access to. Override path: add a `AGENT_RUNS_VIEW_LOG` key to `server/lib/permissions.ts` if demos reveal operators shouldn't see the log without an explicit grant.

4. **Payload read tightens to `AGENTS_EDIT` (§7.3).** Rationale: payloads often contain secrets + PII; the view-log audience is broader than the payload-read audience. Override path: relax to `AGENTS_VIEW` if demos show this is operationally too restrictive.

If any of the four are wrong for current intent, raise it before P1 starts — each is a small edit before code lands, an expensive edit after.

---

*End of spec.*
