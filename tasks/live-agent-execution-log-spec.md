# Live Agent Execution Log — Spec

**Status:** Draft — awaiting human review. Major task per CLAUDE.md §"Task Classification" (new subsystem, new tables, new permission keys, new WebSocket contract, new client surface).
**Author:** Main session.
**Date:** 2026-04-21.
**Last revised:** 2026-04-21 — external-review **pass 3** applied (merge-ready cleanup). Changes: `agent_run_prompts` gains surrogate `id uuid PK` so `linked_entity_id uuid` on events can reference prompts like every other entity (composite `(run_id, assembly_number)` stays as UNIQUE for the drilldown endpoint); `run.event_limit_reached` gets an exactly-once atomic-claim mechanism via new `agent_runs.event_limit_reached_emitted` column (closes the race where multiple non-critical events arrive at the cap boundary concurrently); `resolveAgentRunVisibility` returns `canViewPayload` (singular) to align with `PermissionMask.canViewPayload`; P3.1 restore contract split explicitly into P3-ships (schema support: `archive_restored_at` column + grace-window logic) vs P3.1-ships (trigger endpoint + worker, deferred until real request); duplicated test block in §10.1 removed. No architectural changes — all four items were tightenings on the pass-2 revision. **Pass 2 summary:** external-review pass 2 applied on top of the main-merge refresh. Changes: sequence allocation moved to `agent_runs.next_event_seq` (kills the `MAX + 1` scan + lock); graded failure handling (critical events retry once inline + emit drop metric; non-critical stay fire-and-forget); hard per-run event cap + `run.event_limit_reached` signal event; per-row payload size cap + truncation metadata; `permissionMask` moved to read-time computation (closes a privilege-drift security bug — stored events no longer carry stale authorisation state); payload-table gains `modifications` column separating truncation from redaction; tool-level `payloadPersistencePolicy` for secret-handling skills; batched linked-entity label resolution on snapshot read; minimum restore-contract sketch for cold archive; emission-ordering semantics clarified; every event now carries `sourceService` + `durationSinceRunStartMs`. Prior revision note: main merge; migration numbers bumped to 0192/0193/0194 (0190/0191 taken by provisional-row + in-flight history landing on main); `AGENT_EXECUTION_LOG_ENABLED` kill-switch removed per `feature_flags: only_for_behaviour_modes` convention; primitives-search updated to reference `softBreakerPure` + `runCostBreaker` + `llm_inflight_history` from the in-flight-tracker deferred-items merge; payload-write timing clarified to acknowledge migration 0190's `'started'` provisional ledger status.
**Branch when built:** `claude/agent-task-live-logs-MbN8R` (already cut).
**Predecessor / sibling:** `tasks/llm-inflight-realtime-tracker-spec.md` — the system-admin in-flight LLM tracker at `/system/llm-pnl` In-Flight tab — plus `tasks/llm-inflight-deferred-items-brief.md`, which added the provisional-row partial-external-success protection (migration 0190) + `llm_inflight_history` durable forensic log (migration 0191) + `softBreakerPure` for fire-and-forget persistence paths. This spec is the **per-run** companion surface: it attaches a live execution log to every agent run, not every LLM call in the system. The two surfaces share the LLM ledger as a data source but never render in the same page.

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

- Exactly one event per decision, ordered deterministically per run (`sequenceNumber` allocated atomically per run via `agent_runs.next_event_seq`, unique per `runId`).
- No dropped events on WebSocket dropout (client resumes via `GET /api/agent-runs/:id/events?fromSeq=N` after the existing `useSocketRoom` reconnect hook fires — same pattern as `agentRunMessageService.streamMessages`).
- No double-rendered events on reconnect (client LRU of 500 `eventId`s — same pattern as the in-flight tracker and existing `useSocket` dedup).
- No cross-tenant leakage — all three new tables are in `RLS_PROTECTED_TABLES`, all reads go through `withOrgTx` / `getOrgScopedDb`, and the WebSocket room join handler validates tier access before admitting the socket.
- No mid-run edit hot-swap — the edit-link surface writes to the same service the non-log edit pages already use; the in-flight run continues with the state it already loaded.
- No unbounded storage growth — retention job at 03:30 UTC (offset from the LLM ledger archive's 03:45 UTC slot) moves events to warm + cold tiers, configurable via env vars matching the ledger's existing pattern.
- **No unbounded per-run event volume.** Hard cap via `AGENT_EXECUTION_LOG_MAX_EVENTS_PER_RUN` (default 10 000); above cap, non-critical events drop + one `run.event_limit_reached` event emitted. Critical events still emit (§4.1). Protects against runaway-loop + recursive-agent failure modes.
- **No unbounded per-row payload size.** Hard cap via `AGENT_EXECUTION_LOG_MAX_PAYLOAD_BYTES` (default 1 MB) enforced by the `agent_run_llm_payloads` writer; oversized fields truncated with structured `modifications` record. TOAST compression handles the rest transparently.
- **No stale authorisation on historical events.** `permissionMask` is computed at **read time** (both live socket emit + snapshot endpoint), never persisted. Closes the privilege-drift class where a revoked user would still see `canEdit: true` on events they accessed before revocation.
- **No dropped critical events on transient DB failure.** Critical events (`run.started` / `run.completed` / `llm.requested` / `llm.completed` / `handoff.decided`) retry once inline with 50 ms backoff. Persistent failure degrades to structured error log + `agent_exec_log.critical_drops_total` counter metric — the agent run itself never fails on log-table liveness.

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
- `runCostBreaker` (`server/lib/runCostBreaker.ts`) — already wired into `llmRouter`. Events from the router (`llm.requested`, `llm.completed`) inherit the breaker's cost-ceiling behaviour automatically; no new integration.

### Adjacent primitives that landed on main after initial draft

The following primitives shipped with the in-flight tracker deferred-items merge (`tasks/llm-inflight-deferred-items-brief.md`) and are available, but **not used** in this spec. Documented here so a reader doesn't mistake absence for oversight:

- **`softBreakerPure.ts`** (`server/lib/softBreakerPure.ts`) — sliding-window breaker for fire-and-forget persistence paths. Considered for `agent_run_llm_payloads` writes; rejected because §4.5 keeps the payload write **inside the same transaction as the ledger insert** — there is no fire-and-forget seam to guard. If a future revision splits the payload write out of the ledger transaction for performance reasons, `softBreakerPure` is the correct primitive to wrap the split path (same pattern as `persistHistoryEvent` in `llmInflightRegistry.ts`).
- **`llm_inflight_history`** (migration `0191_llm_inflight_history.sql`) — durable forensic log of in-flight registry events for system-admin cross-fleet queries. Different surface from this spec: `llm_inflight_history` answers "what LLM calls were running at 3:17am last Tuesday across the fleet"; this spec's `agent_execution_events` answers "what did my agent do on this specific run". No overlap, no dependency.
- **LLM `'started'` provisional status** (migration `0190_llm_requests_started_status.sql`) — relevant context for §4.5 payload-write timing; see that section for the interaction.

---

## 4. Execution model

**Inline emission, synchronous persistence, WebSocket push after commit.** Retention archival is queued via pg-boss.

### 4.1 Emission model — persist-then-emit, inline, with graded failure

Every event is written through a single service: `server/services/agentExecutionEventService.ts → appendEvent()`. The caller passes the run, event type, payload, optional linked entity, and always an auto-filled `sourceService` tag (e.g. `'agentExecutionService'`, `'workspaceMemoryService'`) derived at compile time via a typed helper so debugging can trace an event back to the emission site without stack reconstruction. The service does four things in order:

1. **Allocates a sequence number via `agent_runs.next_event_seq`.** Pattern inside `withOrgTx`:
   ```sql
   UPDATE agent_runs
      SET next_event_seq = next_event_seq + 1,
          last_activity_at = now()
    WHERE id = $runId
      AND next_event_seq < $maxEventsPerRun
   RETURNING next_event_seq
   ```
   If the `RETURNING` clause is empty, the run has hit `AGENT_EXECUTION_LOG_MAX_EVENTS_PER_RUN` (default 10 000). Non-critical events short-circuit silently (increment `agent_exec_log.cap_drops_total{event_type}`); critical events go through a separate path that bypasses the `< $maxEventsPerRun` guard and allocates anyway (we never drop `run.completed` on cap — see critical-tier handling below).

   **Exactly-once `run.event_limit_reached` emission.** The companion column `agent_runs.event_limit_reached_emitted boolean NOT NULL DEFAULT false` gates the signal event. On any cap-hit path, the service runs an atomic claim:
   ```sql
   UPDATE agent_runs
      SET event_limit_reached_emitted = true,
          next_event_seq = next_event_seq + 1
    WHERE id = $runId
      AND event_limit_reached_emitted = false
   RETURNING next_event_seq
   ```
   Exactly one caller sees a non-empty `RETURNING`; that caller allocates the sequence number and emits the critical `run.event_limit_reached` event with `{ eventCountAtLimit, cap }`. Every other caller (concurrent non-critical attempts that raced into the cap boundary, or a critical-retry path re-entering the flow) sees empty and proceeds silently. This is the same pattern used elsewhere in the codebase for one-shot signals and guarantees exactly-once even under Node event-loop interleaving and the critical-event one-retry path. Allocation for this specific event is not gated by the `< $cap` guard — it's a cap-boundary signal, not subject to the cap it signals.
2. **Computes `durationSinceRunStartMs`** using the run's `started_at` timestamp + wall-clock now. Baked into the event payload so the client never recomputes.
3. **Persists the row to `agent_execution_events`** in the same transaction as the sequence allocation. Persisted row carries `source_service` + `duration_since_run_start_ms` as columns and event-specific fields in the `payload` JSONB. **`permissionMask` is NOT persisted** (see §4.1a below).
4. **Emits a WebSocket event** to the `agent-run:${runId}` room *after* commit. The socket envelope's `payload.permissionMask` is **computed from the socket user's context at emit time**, not stored anywhere. If the emit fails, the event is still durable — clients resync via the paginated read endpoint on reconnect and the endpoint re-computes the mask for the requesting user.

**Why persist-then-emit and not emit-then-persist.** Losing an event on a crash between emit and persist would leave the client seeing an event that doesn't exist in the durable log — a forensic black hole. The other way around (persist then emit) can drop the socket event on a race, but the client recovery path already handles that (see §4.3 resync protocol). We always choose the failure mode where the durable log is authoritative.

**Why inline and not queued.** A pg-boss job between the agent loop and the event write introduces end-to-end latency that the feature's "live" requirement can't tolerate (the user explicitly rejected polling-style latency). Inline writes are ~2–5 ms on the happy path and fire on top of transactions the loop already runs. The retention archive is queued (§4.6) because that work is genuinely decoupled; emission is not.

**Graded failure handling — critical vs non-critical.** Every event type in §5.3 carries a `critical: boolean` bit in the typed union. Behaviour diverges at the service layer on `appendEvent` failure:

| Tier | Event types | Retry posture | On persistent failure |
|---|---|---|---|
| **Critical** | `run.started`, `run.completed`, `llm.requested`, `llm.completed`, `handoff.decided`, `run.event_limit_reached` | **One inline retry with 50 ms backoff.** Retries the full persist-then-emit sequence. Total worst-case latency on the hot path: ~100 ms. | `logger.error('agentExecutionEventService.critical_event_dropped', { runId, eventType, err })` + increment `agent_exec_log.critical_drops_total{event_type}`. Agent run continues. Metric + log are the operational signal. |
| **Non-critical** | everything else (`prompt.assembled`, `memory.retrieved`, `rule.evaluated`, `skill.invoked`, `skill.completed`, `context.source_loaded`, `clarification.requested`, `orchestrator.routing_decided`) | No retry. Log-and-continue. | `logger.warn('agentExecutionEventService.append_failed', { ... })` + increment `agent_exec_log.noncritical_drops_total{event_type}`. |

The log table is observability; it must never block execution. A total log-table outage produces a steady metric signal and a complete log of drops — operators can reconstruct the timeline from the message-stream + ledger joins until the outage clears. This is a deliberate trade-off: we accept lossy observability under degraded conditions rather than brittle execution under the same conditions.

**Why not more retry / outbox / async queue.** Considered and rejected. More inline retries push hot-path latency into the tens of milliseconds per event and compound across a 30-event run. A durable outbox-pattern (write locally first, drain to the real table via a worker) adds a new table + worker for a failure class that happens rarely on a well-operated Postgres. The one-retry + metric posture catches transient blips (the 99%+ of real-world DB errors) without new infrastructure.

### 4.1a permissionMask is wire-only — never persisted

Reviewer-caught bug in the initial draft: the original design baked `permissionMask` into the stored event row, which creates a **privilege-drift hazard**. If a user had `WORKSPACE_MANAGE` when an event was written but loses it tomorrow, a stored mask would still say `canEdit: true` — bypassing the revocation for historical views.

Resolved:

- The `agent_execution_events.payload` column stores **only** event-specific data + `linkedEntity`. No mask bits.
- `permissionMask` is a **wire-only** field on `AgentExecutionEvent`, computed at read time by `agentRunEditPermissionMask.buildPermissionMask({ entity, user, run })` for:
  - the live socket emit (against the socket-user's context at that moment), and
  - every snapshot-endpoint response (against the HTTP-caller's current permissions).
- Read-path cost is negligible: `buildPermissionMask` is O(1) per linked entity (a single dictionary lookup in the caller's permission snapshot already loaded by `authenticate`). Batched label resolution (§5.9) composes with it cleanly — per-entity permission bit is a constant-time merge on the batched rows.

Net: permissions stay correct over time without operator intervention. Revocations take effect immediately on the next read, not after a cache-invalidation dance.

### 4.2 Sequence-number guarantees

- **Monotonic per run.** `(run_id, sequence_number)` is UNIQUE. The first event for a run is `sequenceNumber = 1`. Allocation is atomic via the `UPDATE agent_runs ... RETURNING next_event_seq` pattern in §4.1 — no MAX scan, no `FOR UPDATE` on the event table.
- **No gaps assumed.** The client must tolerate gaps (a persist that fails after the sequence was allocated but before the insert committed would leave a gap; the next allocation still advances `next_event_seq`, so the run skips a number). Gaps are rare and benign — the client's "events I've seen" set is keyed on `eventId`, not on continuity.
- **No cross-run ordering.** Sequences do not carry time-ordering guarantees across runs; use `eventTimestamp` for that.
- **Within-run ordering reflects emission-site call order, not wall-clock.** The agent loop is single-threaded per run today (Node event loop, `await`-ed emissions), so the `UPDATE agent_runs` sequence allocation order is the call order. No interleaving across subsystems. If a future change introduces a parallel writer for the same run (currently deferred — see §9), the `next_event_seq` column still guarantees unique + monotonic numbers, but the observed order becomes "whichever allocation committed first" — defined but not causally meaningful. Document this explicitly in operator-facing UI copy if the parallel-writer path ever lands.
- **Per-run event cap is a sequence-allocation boundary.** When `next_event_seq` hits `AGENT_EXECUTION_LOG_MAX_EVENTS_PER_RUN`, the `UPDATE agent_runs ... WHERE next_event_seq < $cap` clause returns an empty set. The allocation fails fast — no wasted sequence numbers. Critical events have a separate allocation path that bypasses the cap (see §4.1), so `run.completed` always gets a number even on a pathological run.

### 4.3 Live streaming + reconnect resync protocol

The client follows the same pattern `useSocketRoom` already implements for other run-scoped surfaces:

1. **Initial paint.** On page load, fetch `GET /api/agent-runs/:runId/events?limit=1000` for the initial snapshot, then subscribe to the `agent-run:${runId}` room. Buffer incoming socket events for 100 ms before merge — closes the snapshot-vs-live race the in-flight tracker spec §5 identified and resolved the same way.
2. **Steady state.** Live events update the timeline in place, deduped by `eventId` via the existing 500-entry LRU in `useSocket.ts`.
3. **Reconnect.** On socket reconnect, the client tracks the highest `sequenceNumber` it has rendered (`lastSeenSeq`) and issues `GET /api/agent-runs/:runId/events?fromSeq=${lastSeenSeq + 1}&limit=1000` to backfill anything missed while offline. The endpoint is page-of-one-thousand; if the run generated > 1000 events during the outage (rare — the Deferred Items covers the extreme case in §9), the client repeats the fetch until `hasMore = false`, then resumes live.
4. **Run completion.** When the server emits `run.completed`, the client continues to consume buffered events but does not need to resubscribe. Historical replay (tab reload after the run ended) uses the same snapshot endpoint — live and historical share one read path.

### 4.4 Prompt persistence — one row per assembly

`agent_run_prompts` is keyed by `(run_id, assembly_number)`. Every time `buildSystemPrompt` runs as part of a run (typically once at run start, plus once per handoff target, plus once per execution phase that re-assembles with new context), one row is written. The row holds the fully-assembled system prompt, the user prompt / task context, the serialised tool definitions passed to the LLM, and a `layerAttributions` JSONB describing how the prompt was composed (which layer contributed which substring — for the "what layer did this come from" click-through in the UI). The `prompt.assembled` event carries `{ assemblyNumber, promptRowId, totalTokens }` — the client fetches the full row on drill-down via `GET /api/agent-runs/:runId/prompts/:assemblyNumber`.

### 4.5 LLM payload persistence — one row per ledger row, size-capped, policy-aware

`agent_run_llm_payloads` is keyed by `llm_request_id` (PK, FK to `llm_requests.id`). Written inside the existing `llmRouter` ledger-insert transaction so the payload row and the ledger row commit together. Rows hold `systemPrompt text`, `messages jsonb`, `toolDefinitions jsonb`, `response jsonb`, `redactedFields jsonb` (records of redaction — see §7.4), and `modifications jsonb` (records of non-redaction modifications: truncation, tool-policy suppression — see below).

**Why keyed by `llm_request_id` not `run_id`.** One run has many LLM calls; the ledger already has the attribution (run, execution, iee, etc.). Keying the payload table by ledger ID keeps the join cheap and preserves the ledger's source-of-truth role. Non-agent LLM callers (skill-analyzer, config assistant) also produce payloads that this table can hold — but the client UI only joins from `agent_execution_events.linkedEntity` of type `llm_request`, so non-agent rows are dormant until a caller links to them.

**Hard size cap per row.** `AGENT_EXECUTION_LOG_MAX_PAYLOAD_BYTES` (default **1 048 576** = 1 MB) is enforced at write time. The writer sums `len(systemPrompt) + byteLength(messages JSON) + byteLength(response JSON) + byteLength(toolDefinitions JSON)`; if total exceeds cap, fields are truncated greatest-first (usually `messages` or `response` is the offender) to fit the cap with a 128-byte headroom, and each truncation is recorded in `modifications` as:

```json
{ "kind": "truncated", "field": "messages.3.content", "originalSizeBytes": 2457123, "truncatedToBytes": 524288 }
```

The client renders truncated fields with a visible badge + the original size, so operators know the payload was clipped. 1 MB covers >95% of observed payloads; heavier runs lose fidelity on the tail, but the loss is visible.

**No app-level gzip.** Postgres TOAST already applies `pglz` compression transparently on oversized JSONB columns. Layering gzip on top fights TOAST (TOAST can't stream-decompress gzip per-field), breaks selective column reads in psql, and makes debugging painful. Cap + TOAST is the correct composition.

**Tool-level payload-persistence policy.** Tool definitions (`server/skills/*.md` front matter + `server/config/actionRegistry.ts`) get an optional field:

```ts
payloadPersistencePolicy: 'full' | 'args-redacted' | 'args-never-persisted'
// default: 'full'
```

When a `messages` entry contains a tool-call to a tool whose definition declares `args-redacted` or `args-never-persisted`, the writer replaces the arguments in the persisted row with `[POLICY:args-redacted]` or `[POLICY:args-never-persisted]` respectively and records the substitution in `modifications`:

```json
{ "kind": "tool_policy", "field": "messages.2.content.0.input", "policy": "args-never-persisted", "toolSlug": "oauth-exchange" }
```

Most tools stay on `full`. Tools that always handle secrets (credential-fetchers, OAuth exchange, vault accessors) opt in to a stricter mode. Defence-in-depth alongside pattern-based redaction (§7.4) — policy is the explicit declaration; redaction is the best-effort catch-all.

**Storage trade-off, explicit.** A typical run produces 5–10 LLM calls averaging 50–500 KB of payload each (full system prompt + messages + response + tool defs). Budget: ~1 MB/run on average, up to 5 MB for heavy runs (absent truncation). With the 1 MB per-row cap, worst-case per run is ~10 MB (10 calls × 1 MB). At 100K runs/month that's 100 GB hot + 100 GB warm on rotation. Postgres TOAST compresses this ~3–4× in practice. Cold archive drops to S3 at month 18.

**Interaction with migration 0190 (`llm_requests.status = 'started'`).** The in-flight-tracker deferred-items merge added a provisional-row write path: `llmRouter` now writes a `status='started'` ledger row **before** `providerAdapter.call()`, then upserts the terminal row (`success` / `error` / `timeout` / …) in a second transaction after the provider returns. The payload write for this spec sits on the **terminal** write — the same transaction that resolves `status` to its final value. This means:

- If the provider call + ledger terminal-write completes, a matching `agent_run_llm_payloads` row is written in the same transaction. Invariant: `agent_run_llm_payloads.llm_request_id` always points at a terminal ledger row, never a provisional `'started'` row.
- If the provider call succeeds but the terminal-write fails, the existing reconciliation path (provisional row aged out by the `maintenance:llm-started-row-sweep` job) means no payload row is written — consistent with "payload exists iff terminal row exists". The caller sees `ReconciliationRequiredError`; retry under the same idempotency key hits the existing dedup machinery, not this spec.
- No payload written for pre-dispatch terminal states (`budget_blocked`, `rate_limited`, `provider_not_configured`) — the adapter was never called, there is no request body to persist. The `llm.requested` event also never fires for these states (matches the in-flight tracker's §4.1 invariant).

No changes needed to migration 0190 or the router's provisional-row contract. The payload write is a strict add-on to the terminal-write transaction, not a modification of it.

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
| `appendEvent` DB write fails (critical event) | One inline retry, 50 ms backoff. On persistent failure: `logger.error` + `agent_exec_log.critical_drops_total{event_type}` metric. Agent run continues. |
| `appendEvent` DB write fails (non-critical event) | `logger.warn` + `agent_exec_log.noncritical_drops_total{event_type}` metric. No retry. Agent run continues. |
| WebSocket emission fails | Event is persisted; client picks it up on next snapshot/backfill fetch. No retry on the emit side. |
| Socket disconnect mid-run | Client reconnects via existing `useSocketRoom` hook, backfills via snapshot endpoint from `lastSeenSeq + 1`. |
| Agent run crashes mid-loop | Events already written are durable. No `run.completed` event; client renders the last known event and falls back on `agent_runs.status` after the run's crash-resume path fires. |
| Run hits `AGENT_EXECUTION_LOG_MAX_EVENTS_PER_RUN` | `run.event_limit_reached` event emitted once (critical tier, bypasses cap). Subsequent non-critical events drop with `agent_exec_log.cap_drops_total{event_type}` metric. Critical events continue to emit via the bypass allocation path (§4.1). |
| Payload row exceeds `AGENT_EXECUTION_LOG_MAX_PAYLOAD_BYTES` | Fields truncated greatest-first to fit; truncations recorded in `modifications`. No row is ever rejected. |
| Retention job misses a window | Next tick catches up — same guarantee as the ledger archive job. |
| Payload redaction mis-fires (leaves a secret in) | Operational risk, not correctness. Mitigation: defence-in-depth via `AGENTS_EDIT` payload-read gate (§7.3) + tool-level `payloadPersistencePolicy` (§4.5) + pattern library in `server/lib/redaction.ts`. See §7. |
| User loses `AGENTS_VIEW` / `WORKSPACE_MANAGE` mid-session | Next read recomputes `permissionMask` — revocation is immediate. No stale authorisation carried on persisted rows. |

---

## 5. Contracts

### 5.1 `agent_execution_events` — durable event log (new table)

```sql
CREATE TABLE agent_execution_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id          uuid NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  subaccount_id   uuid     REFERENCES subaccounts(id),  -- nullable for org- and system-tier runs
  sequence_number integer NOT NULL,            -- allocated from agent_runs.next_event_seq — see §4.1
  event_type      text NOT NULL,               -- enum-like, see §5.3
  event_timestamp timestamptz NOT NULL DEFAULT now(),
  duration_since_run_start_ms integer NOT NULL, -- computed at emission from agent_runs.started_at
  source_service  text NOT NULL,               -- debug tag for emission origin (e.g. 'agentExecutionService', 'workspaceMemoryService')
  payload         jsonb NOT NULL,              -- event-type-specific shape, see §5.4. Does NOT contain permissionMask — see §4.1a
  linked_entity_type text,                     -- 'memory_entry' | 'memory_block' | 'policy_rule' | 'skill' | 'data_source' | 'prompt' | 'agent' | 'llm_request' | 'action' | null
  linked_entity_id   uuid,                     -- FK-like reference, validated at write time by the service
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, sequence_number)
);
CREATE INDEX agent_execution_events_run_seq_idx ON agent_execution_events (run_id, sequence_number);
CREATE INDEX agent_execution_events_org_created_idx ON agent_execution_events (organisation_id, created_at DESC);
CREATE INDEX agent_execution_events_linked_entity_idx ON agent_execution_events (linked_entity_type, linked_entity_id) WHERE linked_entity_type IS NOT NULL;

ALTER TABLE agent_execution_events ENABLE ROW LEVEL SECURITY;
-- RLS policy: organisation_id = current_setting('app.organisation_id')::uuid (pattern from architecture.md §1155)

-- Companion columns on agent_runs —
--   next_event_seq: atomic per-run sequence allocation. Doubles as the authoritative
--                   "events emitted for this run" counter (subsumes the polish suggestion
--                   to add event_count). Hits AGENT_EXECUTION_LOG_MAX_EVENTS_PER_RUN = event cap.
--   event_limit_reached_emitted: one-shot flag that gates the single `run.event_limit_reached`
--                                signal event per run. Atomic-claim UPDATE pattern in §4.1.
ALTER TABLE agent_runs
  ADD COLUMN next_event_seq              integer NOT NULL DEFAULT 0,
  ADD COLUMN event_limit_reached_emitted boolean NOT NULL DEFAULT false;
```

Producer: `agentExecutionEventService.appendEvent()` (new service).
Consumer: (a) socket room `agent-run:${runId}` event `agent-run:execution-event` (envelope carries wire-only `permissionMask` computed for the socket user at emit time), (b) `GET /api/agent-runs/:runId/events` paginated read (response rows carry wire-only `permissionMask` computed for the HTTP caller at read time).

### 5.2 Event TypeScript contract (wire + service)

```ts
// shared/types/agentExecutionLog.ts
export interface AgentExecutionEvent {
  id: string;                      // uuid
  runId: string;
  organisationId: string;
  subaccountId: string | null;
  sequenceNumber: number;          // 1-indexed, unique per run — allocated via agent_runs.next_event_seq
  eventType: AgentExecutionEventType;
  eventTimestamp: string;          // ISO 8601 UTC (wall clock)
  durationSinceRunStartMs: number; // computed at emission from agent_runs.started_at — UI uses this directly
  sourceService: AgentExecutionSourceService; // debug tag — emission origin, see §5.3
  payload: AgentExecutionEventPayload;  // discriminated union by eventType — see §5.3
  linkedEntity: LinkedEntity | null;   // id + type persisted; label is attached at read time (batch-resolved per §5.9)
  permissionMask: PermissionMask;      // WIRE-ONLY — computed at read time from the caller's current permissions; NEVER persisted (see §4.1a)
}

export type AgentExecutionSourceService =
  | 'agentExecutionService'
  | 'workspaceMemoryService'
  | 'memoryBlockService'
  | 'decisionTimeGuidanceMiddleware'
  | 'skillExecutor'
  | 'llmRouter'
  | 'runContextLoader'
  | 'orchestratorFromTaskJob'
  | 'requestClarificationMiddleware';

export interface LinkedEntity {
  type: LinkedEntityType;          // see §5.5
  id: string;                      // uuid (persisted on the event row as linked_entity_id)
  label: string;                   // human-readable, e.g. "Memory: pricing tiers" — RESOLVED at read time; not persisted
}

export interface PermissionMask {
  canView: boolean;
  canEdit: boolean;
  canViewPayload: boolean;         // payload-read bit (§7.3) — stricter than canView
  viewHref: string | null;         // null when canView=false
  editHref: string | null;         // null when canEdit=false
}

// Socket envelope reuses the existing pattern from server/websocket/emitters.ts
export interface AgentExecutionEventEnvelope {
  eventId: string;                 // ${runId}:${sequenceNumber}:${eventType} — deduped by client LRU
  type: 'agent-run:execution-event';
  entityId: string;                // runId
  timestamp: string;
  payload: AgentExecutionEvent;    // permissionMask inside this is the emit-time snapshot for the socket user
}
```

### 5.3 Event type taxonomy — v1

Curated, not exhaustive. Each entry: what fires it, what payload shape, what entity gets linked, and whether it's **critical** (one inline retry on append failure — see §4.1).

| `eventType` | Fires when | `critical?` | `payload` shape (discriminated union) | `linkedEntity` |
|---|---|---|---|---|
| `orchestrator.routing_decided` | `orchestratorFromTaskJob` dispatches a run | no | `{ taskId, chosenAgentId, idempotencyKey, routingSource: 'rule' \| 'llm' \| 'fallback' }` | `{ type: 'agent', id: chosenAgentId }` |
| `run.started` | First event of every run | **yes** | `{ agentId, runType, triggeredBy }` | `{ type: 'agent', id: agentId }` |
| `prompt.assembled` | `buildSystemPrompt` completes | no | `{ assemblyNumber, promptRowId, totalTokens, layerTokens: { master, orgAdditional, memoryBlocks, skillInstructions, taskContext } }` | `{ type: 'prompt', id: promptRowId }` |
| `context.source_loaded` | `runContextLoader` finishes a source | no | `{ sourceId, sourceName, scope, contentType, tokenCount, includedInPrompt, exclusionReason? }` | `{ type: 'data_source', id: sourceId }` |
| `memory.retrieved` | `workspaceMemoryService._hybridRetrieve` returns | no | `{ queryText, retrievalMs, topEntries: Array<{ id, score, excerpt }>, totalRetrieved }` | `{ type: 'memory_block' \| 'memory_entry', id: topEntries[0].id }` when non-empty; null otherwise |
| `rule.evaluated` | `decisionTimeGuidanceMiddleware` processes tool-call | no | `{ toolSlug, matchedRuleId?, decision: 'auto' \| 'review' \| 'block', guidanceInjected: boolean }` | `{ type: 'policy_rule', id: matchedRuleId }` when a rule matched; null otherwise |
| `skill.invoked` | Tool call dispatched | no | `{ skillSlug, skillName, input, reviewed: boolean, actionId? }` | `{ type: 'skill', id: skillId }` |
| `skill.completed` | Tool call returns | no | `{ skillSlug, durationMs, status: 'ok' \| 'error', resultSummary, actionId? }` | `{ type: 'skill', id: skillId }` |
| `llm.requested` | `llmRouter.routeCall` dispatches adapter call | **yes** | `{ llmRequestId, provider, model, attempt, featureTag, payloadPreviewTokens }` | `{ type: 'llm_request', id: llmRequestId }` |
| `llm.completed` | `llmRouter` resolves the call | **yes** | `{ llmRequestId, status, tokensIn, tokensOut, costWithMarginCents, durationMs }` | `{ type: 'llm_request', id: llmRequestId }` |
| `handoff.decided` | Agent hands off to another | **yes** | `{ targetAgentId, reasonText, depth, parentRunId }` | `{ type: 'agent', id: targetAgentId }` |
| `clarification.requested` | `requestClarification` middleware fires | no | `{ question, awaitingSince }` | null |
| `run.event_limit_reached` | Run hits `AGENT_EXECUTION_LOG_MAX_EVENTS_PER_RUN` | **yes** | `{ eventCountAtLimit, cap }` | null |
| `run.completed` | Run transitions to terminal | **yes** | `{ finalStatus, totalTokens, totalCostCents, totalDurationMs, eventCount }` | null |

**Critical tier rationale.** These are the events without which the log loses forensic integrity: lifecycle bookends (`run.started` / `run.completed`), cost + provider audit (`llm.requested` / `llm.completed`), control-flow transitions (`handoff.decided`), and the cap-hit signal (`run.event_limit_reached` — if this drops silently, an operator can't distinguish "run ended quietly" from "run hit cap and emitted only 10k of its real events"). Non-critical events are informative but re-derivable — a missing `memory.retrieved` is recoverable from the next `prompt.assembled` event; a missing `run.started` isn't recoverable from anywhere.

**Discriminated union shape** — every payload is typed per eventType. Example:

```ts
export type AgentExecutionEventPayload =
  | { eventType: 'orchestrator.routing_decided'; critical: false; taskId: string; chosenAgentId: string; idempotencyKey: string; routingSource: 'rule' | 'llm' | 'fallback' }
  | { eventType: 'run.started'; critical: true; agentId: string; runType: string; triggeredBy: string }
  | { eventType: 'prompt.assembled'; critical: false; assemblyNumber: number; promptRowId: string; totalTokens: number; layerTokens: { master: number; orgAdditional: number; memoryBlocks: number; skillInstructions: number; taskContext: number } }
  | { eventType: 'run.event_limit_reached'; critical: true; eventCountAtLimit: number; cap: number }
  // ... one variant per eventType row above
  ;
```

`eventType` is a `text` column not a Postgres enum — matches the pattern from `llm_requests.status` (migration `0187_llm_requests_new_status_values.sql`) where adding a new value required a migration vs. a simple text check. Text + a TypeScript union + a service-layer validator is easier to extend. The service validates every event at write-time against the union.

### 5.3a Adding a new event type — checklist

The TS discriminated union in `shared/types/agentExecutionLog.ts` is the central registry. Adding a new event type:

1. Extend `AgentExecutionEventType` (string literal union) and `AgentExecutionEventPayload` (discriminated union member) in `shared/types/agentExecutionLog.ts`. Include the `critical: boolean` bit.
2. Extend the per-eventType validator in `agentExecutionEventServicePure.ts` (one case per type). The validator runs in `appendEvent` before persist.
3. Extend the §5.3 table above (prose + examples). The spec-table is the human-readable registry; the union is the machine-checked registry. Drift between them is a spec-reviewer finding.
4. Add the emission site to §6.2 "Files to change" (prose + the actual code).
5. If the new type links to a new entity kind, extend `LinkedEntityType` (§5.5) AND the permission matrix (§7.2) AND `buildPermissionMask` (`server/lib/agentRunEditPermissionMask.ts`) in the same change — no orphan types.
6. Add a fixture to the pure-test file in `server/services/__tests__/agentExecutionEventServicePure.test.ts` (§10.1). One passing + one failing fixture per new type is the minimum bar.

TS type-checking + the pure validator together catch drift at CI time. No separate lint rule needed.

### 5.4 Example event payload (worked, concrete — not pseudocode)

Wire shape as emitted on the socket room + returned by the snapshot endpoint. `permissionMask` + `linkedEntity.label` are computed fresh on every read against the caller's current permissions — they are NOT what's persisted in the DB row.

```json
{
  "id": "ae4f3c12-9b1f-4c68-8aa7-ef27bd1e5f60",
  "runId": "0f8e2a91-3b4c-4d8d-9e1a-1122334455aa",
  "organisationId": "b1234567-0000-0000-0000-000000000001",
  "subaccountId": "c9876543-0000-0000-0000-000000000002",
  "sequenceNumber": 7,
  "eventType": "memory.retrieved",
  "eventTimestamp": "2026-04-21T14:23:11.482Z",
  "durationSinceRunStartMs": 1847,
  "sourceService": "workspaceMemoryService",
  "payload": {
    "eventType": "memory.retrieved",
    "critical": false,
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
    "canViewPayload": true,
    "viewHref": "/subaccounts/c987.../memory/m-001",
    "editHref": "/subaccounts/c987.../memory/m-001/edit"
  }
}
```

**What's persisted** vs **what's computed on read**:

- **Persisted** (`agent_execution_events` row): `id`, `runId`, `organisationId`, `subaccountId`, `sequenceNumber`, `eventType`, `eventTimestamp`, `durationSinceRunStartMs`, `sourceService`, `payload` (with `critical` bit baked in — that's a type property), `linkedEntity.type` + `linkedEntity.id`.
- **Computed on read** (attached by the service for every socket emit + every endpoint response): `linkedEntity.label` (batch-resolved per §5.9), `permissionMask.{canView,canEdit,canViewPayload,viewHref,editHref}` (per caller's current permissions — never stored; §4.1a).

Nullability rules: `subaccountId` is null for org-tier or system-tier runs. `linkedEntity` is null for events that reference no entity (e.g. `clarification.requested`, `run.completed`, `run.event_limit_reached`). `permissionMask.viewHref` is null when `canView=false`; `permissionMask.editHref` is null when `canEdit=false`. Clients must handle all three nullables.

### 5.5 `LinkedEntityType` enumeration

```ts
export type LinkedEntityType =
  | 'memory_entry'   // workspace_memories.id
  | 'memory_block'   // memory_blocks.id
  | 'policy_rule'    // policy_rules.id
  | 'skill'          // resolved slug -> skills.id OR system_skills.id
  | 'data_source'    // agent_data_sources.id
  | 'prompt'         // agent_run_prompts.id (uuid). The (runId, assemblyNumber) composite remains unique but is not the linked-entity reference.
  | 'agent'          // agents.id OR system_agents.id
  | 'llm_request'    // llm_requests.id
  | 'action';        // actions.id (for reviewed skill invocations)
```

### 5.6 `agent_run_prompts` — assembled prompt persistence (new table)

```sql
CREATE TABLE agent_run_prompts (
  id                uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    -- Surrogate UUID so `linked_entity_id uuid` on agent_execution_events can reference this table like every other entity.
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
  UNIQUE (run_id, assembly_number)              -- natural key stays; just no longer the PK
);
CREATE INDEX agent_run_prompts_run_assembly_idx ON agent_run_prompts (run_id, assembly_number);
CREATE INDEX agent_run_prompts_org_assembled_idx ON agent_run_prompts (organisation_id, assembled_at DESC);

ALTER TABLE agent_run_prompts ENABLE ROW LEVEL SECURITY;
-- RLS same shape as agent_execution_events
```

`layer_attributions` enables the UI's "click this block of the prompt to see which memory/rule/instruction contributed it" feature. Drilldown endpoint `GET /api/agent-runs/:runId/prompts/:assemblyNumber` still uses the composite `(run_id, assembly_number)` key from the URL — the surrogate UUID is the internal foreign-key target for `agent_execution_events.linked_entity_id`, not an external API shape. `prompt.assembled` event payload still carries `promptRowId` which is now this UUID.

### 5.7 `agent_run_llm_payloads` — full LLM payload persistence (new table)

```sql
CREATE TABLE agent_run_llm_payloads (
  llm_request_id    uuid PRIMARY KEY REFERENCES llm_requests(id) ON DELETE CASCADE,
  organisation_id   uuid NOT NULL REFERENCES organisations(id),
  subaccount_id     uuid REFERENCES subaccounts(id),
  system_prompt     text NOT NULL,
  messages          jsonb NOT NULL,             -- provider-neutral message array sent to the adapter, post-redaction + post-policy substitutions
  tool_definitions  jsonb NOT NULL,
  response          jsonb NOT NULL,             -- full response body from adapter, post-redaction
  redacted_fields   jsonb NOT NULL DEFAULT '[]'::jsonb,
    -- pattern-based redaction (§7.4): [{ path: 'messages.0.content', pattern: 'bearer_token', replacedWith: '[REDACTED:bearer]', count: 3 }, ...]
  modifications     jsonb NOT NULL DEFAULT '[]'::jsonb,
    -- non-redaction modifications (§4.5):
    --   truncation:  { kind: 'truncated', field: 'messages.3.content', originalSizeBytes: N, truncatedToBytes: M }
    --   tool policy: { kind: 'tool_policy', field: 'messages.2.content.0.input', policy: 'args-never-persisted', toolSlug: 'oauth-exchange' }
  total_size_bytes  integer NOT NULL,           -- sum of stored field byte-lengths after truncation — sampled by storage-cost dashboards
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agent_run_llm_payloads_org_created_idx ON agent_run_llm_payloads (organisation_id, created_at DESC);

ALTER TABLE agent_run_llm_payloads ENABLE ROW LEVEL SECURITY;
-- RLS same shape as agent_execution_events; additional permission check (§7) for raw-payload read vs. summary read
```

**`redacted_fields` vs `modifications` split.** Redaction catches secrets; modifications records every other write-time change. Keeping them separate means an operator asking "did we scrub anything sensitive?" has one column to check, and "did we truncate or policy-suppress?" has the other — no ambiguous overloading. Both columns are append-only per row (written once at persistence time).

**Tool-policy interaction.** When a `messages` entry contains a tool-call whose tool declares `payloadPersistencePolicy: 'args-redacted' | 'args-never-persisted'` (see §4.5), the writer applies the substitution BEFORE the size-cap check. So `args-never-persisted` tools have near-zero payload footprint regardless of their real argument size — appropriate for credential-handling tools.

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
- Per-event `permissionMask` + `linkedEntity.label` computed server-side at read time (no client-side permission logic; no stale authorisation on historical rows — §4.1a).

**Batch label + permission resolution.** The read path fetches the raw rows once, then runs two batched passes before returning:

1. **Group by `linked_entity_type`, fetch labels in bulk.** One `SELECT id, <label_expr> FROM {entity_table} WHERE id = ANY($1)` per entity type present in the page — at most 9 queries regardless of page size (one per `LinkedEntityType` variant). The label expression is entity-specific (`memory_entries.title`, `policy_rules.name`, `agents.name`, etc.) and lives in `agentRunEditPermissionMask.ts` alongside the permission resolver. Labels are merged back onto the rows in memory.
2. **Permission-mask pass** — single call into `buildPermissionMask` per row against the caller's permission snapshot (already loaded by `authenticate`). O(1) per row; no additional queries.

Avoids the N+1 class the reviewer flagged. A 1000-event page does at most 9 label-resolution queries + 0 extra permission queries.

`GET /api/agent-runs/:runId/prompts/:assemblyNumber` → `AgentRunPrompt` full row. Same permission gate as the events endpoint.

`GET /api/agent-runs/:runId/llm-payloads/:llmRequestId` → `AgentRunLlmPayload` full row — including `redacted_fields` + `modifications` so the client can render truncation + policy badges accurately. **Stricter** permission gate than the events endpoint — see §7 on "payload visibility inherits agent-edit permission."

### 5.10 Socket event envelope — dedup + ordering

Every emitted socket event uses the existing `{ eventId, type, entityId, timestamp, payload }` envelope from `server/websocket/emitters.ts`. `eventId = ${runId}:${sequenceNumber}:${eventType}` — unique across the lifetime of the table and cheap to dedup on. Clients use the existing `useSocket.ts` LRU (500 entries) — no new dedup code.

---

## 6. Files to change

Single source of truth for everything this spec touches. Every prose reference to a new file, column, migration, table, service, endpoint, job, or component appears in this table. If you add a reference elsewhere in the spec, cascade it here in the same edit.

### 6.1 Server — schema + migrations

| File | Change | Phase |
|---|---|---|
| `migrations/0192_agent_execution_log.sql` | **New** — creates `agent_execution_events` + `agent_run_prompts` (with surrogate `id uuid PK` + unique `(run_id, assembly_number)`) + `agent_run_llm_payloads`; **adds two columns to existing `agent_runs` table**: `next_event_seq integer NOT NULL DEFAULT 0` (drives atomic per-run sequence allocation — §4.1) and `event_limit_reached_emitted boolean NOT NULL DEFAULT false` (gates the exactly-once `run.event_limit_reached` signal — §4.1); enables RLS + policies on all three new tables; adds indexes per §5.1, §5.6, §5.7; adds the three tables to the RLS manifest via the separate TS file update below. Backfill for both new `agent_runs` columns is zero-cost because no events exist yet (defaults match the empty-table invariant). Migration numbers 0190 + 0191 already taken on main (LLM `'started'` provisional status + `llm_inflight_history`). | P1 |
| `migrations/0193_agent_execution_log_retention.sql` | **New** — creates `agent_execution_events_warm` + `agent_run_prompts_warm` + `agent_execution_events_archive` (Parquet BYTEA) tables, all with RLS enabled. | P3 |
| `migrations/0194_agent_execution_log_edits.sql` | **New** — creates `agent_execution_log_edits` audit table with RLS. | P2 |
| `server/db/schema/agentExecutionEvents.ts` | **New** — Drizzle schema for `agent_execution_events` + event-type TS union re-exported from `shared/types/agentExecutionLog.ts`. | P1 |
| `server/db/schema/agentRunPrompts.ts` | **New** — Drizzle schema for `agent_run_prompts`. | P1 |
| `server/db/schema/agentRunLlmPayloads.ts` | **New** — Drizzle schema for `agent_run_llm_payloads`. | P1 |
| `server/db/schema/agentExecutionLogEdits.ts` | **New** — Drizzle schema for `agent_execution_log_edits`. | P2 |
| `server/db/schema/index.ts` | **Modify** — re-export the four new schemas. | P1 / P2 |
| `server/config/rlsProtectedTables.ts` | **Modify** — add `agent_execution_events`, `agent_run_prompts`, `agent_run_llm_payloads`, `agent_execution_events_warm`, `agent_run_prompts_warm`, `agent_execution_events_archive`, `agent_execution_log_edits` to the manifest. Missing entries trip `verify-rls-coverage.sh`. | P1 / P2 / P3 |

### 6.2 Server — services + emission

| File | Change | Phase |
|---|---|---|
| `server/services/agentExecutionEventService.ts` | **New** — exports `appendEvent({ runId, eventType, payload, linkedEntity?, sourceService })`, `streamEvents(runId, fromSeq?, limit?, { forUser })`, `getPrompt(runId, assemblyNumber, { forUser })`, `getLlmPayload(llmRequestId, { forUser })`. `appendEvent` runs inside `withOrgTx`, allocates `sequenceNumber` via `UPDATE agent_runs SET next_event_seq = next_event_seq + 1 WHERE id = ? AND next_event_seq < ? RETURNING next_event_seq` (non-critical path) or bypass-cap path (critical path — see §4.1), computes `durationSinceRunStartMs` from `agent_runs.started_at`, writes the row (with `sourceService`, without `permissionMask`), then emits the socket envelope after commit with `permissionMask` computed fresh for the socket user. Validates payload shape against the discriminated union. Critical events retry once inline with 50 ms backoff on failure; non-critical log-and-continue. `streamEvents` + `getPrompt` + `getLlmPayload` take a `forUser` context and attach `permissionMask` + batch-resolved `linkedEntity.label` per §5.9 before returning. | P1 |
| `server/services/agentExecutionEventServicePure.ts` | **New** — pure: event-payload validators (per-eventType — one case per §5.3 type, including `critical: boolean` bit check), truncation helper (cap-aware field-size budgeting for payload writes per §4.5), modification-record builders (truncation + tool-policy shapes per §5.7), sequence-number contract helper, event-cap predicate (`isNonCriticalCapHit(currentSeq, cap)`). | P1 |
| `server/services/agentExecutionService.ts` | **Modify** — emit `run.started` after line 383; `prompt.assembled` after line 699 (and every subsequent re-assembly); `handoff.decided` at the handoff site; `run.completed` on terminal transitions. All emissions wrapped in try/catch-log per §4.1. | P1 |
| `server/services/workspaceMemoryService.ts` | **Modify** — emit `memory.retrieved` at the `_hybridRetrieve()` return boundary (not inside the ranking loop — see §3 reuse note). Payload includes `queryText`, `retrievalMs`, top-N entries with scores, total retrieved. | P1 |
| `server/services/memoryBlockService.ts` | **Modify** — emit `memory.retrieved` at the `getBlocksForInjection()` return boundary for the block-level retrieval (entity type `memory_block`). | P1 |
| `server/services/middleware/decisionTimeGuidanceMiddleware.ts` | **Modify** — emit `rule.evaluated` after rule match evaluation, whether or not a rule matched. Payload carries `{ toolSlug, matchedRuleId?, decision, guidanceInjected }`. | P1 |
| `server/services/skillExecutor.ts` | **Modify** — emit `skill.invoked` at `execute()` top and `skill.completed` at result return (inside the existing try/finally). Carries `actionId` when the invocation produced an action row. | P1 |
| `server/services/llmRouter.ts` | **Modify** — emit `llm.requested` (critical) immediately before `providerAdapter.call()` (same hook point the in-flight tracker uses via `llmInflightRegistry.add`). Emit `llm.completed` (critical) in the same `finally` block that writes the **terminal** ledger row (per §4.5 interaction with migration 0190's provisional `'started'` row — payload writes sit on the terminal transaction, never the provisional one). Also write the `agent_run_llm_payloads` row in the same transaction as the terminal ledger write when `sourceType='agent_run'`: apply redaction (§7.4) + tool-policy substitutions + size-cap truncation in that order, record any modifications in `modifications` column (§5.7), compute `total_size_bytes`, insert. Emissions guarded by `runId != null` since non-agent LLM callers produce ledger rows but not agent-run events. | P1 |
| `server/services/runContextLoader.ts` | **Modify** — emit `context.source_loaded` per source at the loader's return boundary (one event per source). Payload is a slice of the existing `contextSourcesSnapshot` struct — no new capture logic. | P1 |
| `server/services/llmService.ts` | **Modify** — `buildSystemPrompt` returns an additional `layerAttributions` struct alongside the assembled prompt, computed from the same inputs it already uses. The caller persists the assembled prompt + attributions via `agentRunPromptService.persistAssembly()`. | P1 |
| `server/services/agentRunPromptService.ts` | **New** — thin service wrapping inserts into `agent_run_prompts`. Exposes `persistAssembly({ runId, systemPrompt, userPrompt, toolDefinitions, layerAttributions })` which returns the assigned `assemblyNumber` + row ID. Inserts inside `withOrgTx`. | P1 |
| `server/jobs/orchestratorFromTaskJob.ts` | **Modify** — emit `orchestrator.routing_decided` at the dispatch point (line ~233 where `logger.info('orchestratorFromTask.dispatched')` fires today). Payload carries `{ taskId, chosenAgentId, idempotencyKey, routingSource }` — `routingSource` in v1 is always `'rule'` or `'fallback'` per the current Orchestrator logic; `'llm'` lands when structured reasoning extraction ships (§9 deferred). | P1 |
| `server/services/middleware/requestClarification.ts` | **Modify** — emit `clarification.requested` alongside the existing `emitAwaitingClarification` call. | P1 |
| `server/lib/redaction.ts` | **New** — shared redaction patterns (Bearer tokens, API keys, common secret shapes). Used by `agent_run_llm_payloads` writer to redact fields in `messages` and `response` before persistence. Records redactions in the `redacted_fields` column (separate from `modifications` — §5.7). Extensible — callers pass a pattern bundle; a default bundle ships with this spec. | P1 |
| `server/config/actionRegistry.ts` + `server/skills/**/*.md` front matter | **Modify** — add optional `payloadPersistencePolicy: 'full' \| 'args-redacted' \| 'args-never-persisted'` field on tool/skill definitions (default `'full'`). Read by `llmRouter` payload writer at persistence time — tool-calls to declared stricter-mode tools have their arguments substituted before write. Audit P1 skill catalogue for credential-handling skills that should opt in (`oauth-*`, anything calling vault/secrets APIs) in the same change. | P1 |
| `server/services/agentRunPayloadWriter.ts` | **New** — pure-ish writer extracted from `llmRouter` so the redaction → tool-policy → truncation → size-cap pipeline is one unit-testable function. Exports `buildPayloadRow({ runId, llmRequestId, systemPrompt, messages, toolDefinitions, response, toolDefs, maxBytes })` returning `{ row, modifications, redactedFields, totalSizeBytes }`. Router inserts the result in the terminal-ledger transaction. | P1 |
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
| `server/lib/agentRunVisibility.ts` | **New** — exports `resolveAgentRunVisibility({ run, user })` returning `{ canView, canViewPayload }` based on the run's tier (subaccount / org / system) and the user's permissions. Same bit name as `PermissionMask.canViewPayload` (§5.2) — run-level visibility and per-event mask share the underlying permission check; naming stays singular across both for reader clarity. Single source of truth for both the route guard and the WebSocket room join handler. | P1 |
| `server/lib/agentRunEditPermissionMask.ts` | **New** — exports `buildPermissionMask({ entityType, entityId, user, run })` returning `{ canView, canEdit, canViewPayload, viewHref, editHref }` for every `LinkedEntityType`. One switch over entity type; each branch calls the existing per-entity permission check. Called at **read time** — once per socket emit for the socket user, once per row per snapshot-endpoint response for the HTTP caller. Never baked into persisted event rows (see §4.1a). Also exports `resolveLinkedEntityLabels(entityType, ids)` used by the snapshot endpoint for the batched label-resolution pass (§5.9) — groups by type + issues one `SELECT id, label-expr FROM {table} WHERE id = ANY($1)` per type. | P1 |

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

Operational tunables only — retention, cost-control, and per-run safety caps. No feature-flag env var — per `docs/spec-context.md` `feature_flags: only_for_behaviour_modes` + `rollout_model: commit_and_revert`, an emergency disable uses `git revert`, not a toggle.

| Variable | Default | Purpose |
|---|---|---|
| `AGENT_EXECUTION_LOG_HOT_MONTHS` | `6` | Hot tier retention. Below this age: full-fidelity read. |
| `AGENT_EXECUTION_LOG_WARM_MONTHS` | `12` | Warm tier retention. Payload bodies stripped; events + prompt metadata retained. |
| `AGENT_EXECUTION_LOG_COLD_YEARS` | `7` | Cold archive retention. Parquet blobs in `agent_execution_events_archive`. |
| `AGENT_EXECUTION_LOG_ARCHIVE_BATCH_SIZE` | `500` | Rotation job batch size per tick. |
| `AGENT_EXECUTION_LOG_MAX_PAYLOAD_BYTES` | `1048576` (1 MB) | Hard per-row cap on `agent_run_llm_payloads`. Fields truncated greatest-first with `modifications` record when exceeded. TOAST compresses in-place below this ceiling. |
| `AGENT_EXECUTION_LOG_MAX_EVENTS_PER_RUN` | `10000` | Per-run event cap. Above cap: non-critical events drop with metric; critical events bypass; `run.event_limit_reached` emitted once at the boundary. Guards against runaway loops. |

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

The resolver for all of the above: `server/lib/agentRunEditPermissionMask.ts → buildPermissionMask()`. Called at **read time** — once per event on each socket emit (against the socket user's current permissions) and once per row on each snapshot-endpoint response (against the HTTP caller's current permissions). **Never persisted.** Revocations take effect on the next read. See §4.1a for why this matters — the original draft baked the mask into the stored row and was corrected during review to close the privilege-drift hazard.

The client does no permission logic: it consumes `permissionMask` from the wire and renders accordingly. Trade-off accepted: every read recomputes masks for every row on the page. At O(1) per row + 1000-row page ceiling, this is ~sub-millisecond overhead per snapshot response — well inside budget.

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

**Schema changes introduced:** migration `0192_agent_execution_log.sql` creates `agent_execution_events`, `agent_run_prompts` (with surrogate UUID PK), `agent_run_llm_payloads` with RLS policies; **also adds two columns to the existing `agent_runs` table**: `next_event_seq integer NOT NULL DEFAULT 0` (atomic per-run sequence allocation — §4.1) and `event_limit_reached_emitted boolean NOT NULL DEFAULT false` (exactly-once `run.event_limit_reached` gate — §4.1). Adds all three new tables to `rlsProtectedTables.ts` in the same migration.

**Services introduced:** `agentExecutionEventService`, `agentExecutionEventServicePure`, `agentRunPromptService`, `agentRunVisibility`, `agentRunEditPermissionMask`, `redaction` (in `server/lib/`).

**Services modified:** `agentExecutionService`, `workspaceMemoryService`, `memoryBlockService`, `decisionTimeGuidanceMiddleware`, `skillExecutor`, `llmRouter`, `runContextLoader`, `llmService`, `requestClarification`, `orchestratorFromTaskJob`.

**Routes introduced:** `server/routes/agentExecutionLog.ts` mounting the three read endpoints.

**WebSocket surface:** new emitter `emitAgentExecutionEvent` + tightened `join:agent-run` handler.

**Client surface:** `AgentRunLivePage` + `Timeline` + `EventRow` + `EventDetailDrawer` + `LayeredPromptViewer`. Route registered in `App.tsx`. Detail-page tab added.

**Jobs introduced:** none.

**Columns referenced by code:** only columns defined in migration 0192 — no forward references.

**Ship criterion:** an operator navigating to `/runs/:id/live` for an active agent run sees events stream in within 100 ms of dispatch; after the run ends, the same page renders the durable history from the snapshot endpoint; permission gates reject users who lack agent-view on the run's tier. Full LLM payloads accessible to agent-editors via the drawer CTA.

**Not in P1:** edit-link audit trail, retention archival, cold restore. See below.

### Phase 2 — Inline edit audit trail + entity-edited banner

**Schema changes introduced:** migration `0194_agent_execution_log_edits.sql` creates `agent_execution_log_edits` with RLS + manifest entry.

**Services introduced:** none new — the existing edit services (memory edit, rule edit, skill edit) gain an optional `triggeringRunId` write path that appends an audit row.

**Services modified:** memory edit, rule edit, skill edit, data-source edit — each accepts an optional `triggeringRunId` and writes `agent_execution_log_edits` on save.

**Client surface:** `EditedAfterBanner` component on `AgentRunLivePage` (shown for past runs only); all linked-entity Edit CTAs pass `?triggeringRunId=` to the edit surface.

**Jobs introduced:** none.

**Columns referenced by code:** `agent_execution_log_edits.*` — created in migration 0194. No forward reference.

**Ship criterion:** edits made via a log-link are auditable; viewing a past run shows a banner on events whose linked entity has been edited since.

### Phase 3 — Retention tiering + cold archive

**Schema changes introduced:** migration `0193_agent_execution_log_retention.sql` creates `agent_execution_events_warm`, `agent_run_prompts_warm`, `agent_execution_events_archive`, all with RLS + manifest entries.

**Services introduced:** none.

**Services modified:** `queueService` (registers the new cron).

**Jobs introduced:** `agentExecutionLogArchiveJob` + `agentExecutionLogArchiveJobPure` — scheduled at 03:30 UTC via `maintenance:agent-execution-log-archive`.

**Env vars introduced:** `AGENT_EXECUTION_LOG_HOT_MONTHS`, `AGENT_EXECUTION_LOG_WARM_MONTHS`, `AGENT_EXECUTION_LOG_COLD_YEARS`, `AGENT_EXECUTION_LOG_ARCHIVE_BATCH_SIZE`.

**Columns referenced by code:** `*_warm` and `_archive` tables — created in migration 0193. No forward reference.

**Ship criterion:** job runs nightly and moves rows between tiers; read endpoints transparently fall through hot → warm → cold on lookup (cold returns a job handle + retrieval ETA rather than the row directly, matching the ledger archive pattern).

### Phase 3.1 — Cold-archive restore (specified in P3, implementation deferred)

This section pins the restore contract so cold archives are not an implicitly-sealed format. The **schema support** ships in Phase 3 (as part of migration 0193); the **trigger endpoint + worker handler are deferred to P3.1** and land when the first real operator request for a cold-archived run arrives.

**Ships in P3 (alongside the archive write path):**

- Migration 0193 adds `archive_restored_at timestamptz` column on `agent_runs` (nullable). Used by the rotation job to skip restored rows for a configurable grace window (`AGENT_EXECUTION_LOG_RESTORE_GRACE_DAYS`, default 30) so an operator debugging an old run isn't ambushed by an overnight re-rotation. This column lands in P3 so the rotation-job logic can be written correctly on day one — even though nothing writes to the column until P3.1.
- Archive rows in `agent_execution_events_archive` carry enough metadata (original run_id, full blob) that restoration is mechanically possible without a schema change later.

**Deferred to P3.1 (lands when the first operator request arrives):**

- **Trigger endpoint:** `POST /api/admin/agent-runs/:runId/restore-archive` (system admin only). Returns `{ jobId: string, estimatedAvailableAtMs: number }`.
- **Worker:** new pg-boss handler `maintenance:agent-execution-log-restore` reads the Parquet blob from `agent_execution_events_archive`, unpacks into the hot tables (`agent_execution_events` + `agent_run_prompts` + `agent_run_llm_payloads`), stamps `agent_runs.archive_restored_at = now()`. Insertion uses `ON CONFLICT DO NOTHING` so a repeat-restore is a no-op. Rehydrated rows retain original sequence numbers.
- **SLA target:** best-effort <60 s per run. No hard guarantee — runs on the existing pg-boss worker pool.

Why this split: the schema-support side of the restore contract is cheap and prevents forward-compat bugs; the active implementation has no known requester and may benefit from waiting until a concrete use case shapes the UX. Tracked here so the contract is not a blank check when the trigger arrives.

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

- **Parallel writers for the same run.** With the `agent_runs.next_event_seq` column (§4.1), sequence-number uniqueness + monotonicity under parallel writers is already guaranteed — the `UPDATE ... RETURNING` is atomic per row at the Postgres level, so the old `MAX + 1` contention class is gone. What remains is the **semantic** question: if a future change introduces multiple writers per run (shadow evaluator, parallel tool execution), within-run event ordering reflects allocation-commit order rather than causal program order. Operator-facing UI would need to indicate that interleaved events from different subsystems are not causally ordered. Deferred — revisit when a parallel-writer feature is actually proposed, so the UI language can be written against a concrete use case.

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

- **Event payload validators per event type.** Every valid variant validates; every invalid variant (missing required field, wrong type, unknown event type, missing `critical` bit) rejects. At least one passing + one failing fixture per event type in §5.3 — including `run.event_limit_reached`.
- **Critical-bit enforcement.** Each event type's `critical` value matches the §5.3 table exactly. Test iterates over every `eventType` string literal in the union and asserts `critical` equals the expected value. Prevents silent drift between the TS union + the §5.3 registry table.
- **Event-cap predicate.** `isNonCriticalCapHit(currentSeq, cap)` returns `true` iff `currentSeq >= cap`. Boundary cases: `cap - 1` → false, `cap` → true, `cap + 1` → true.
- **Sequence-number contract.** `sequenceNumber` is 1-indexed, monotonic. Gaps tolerated (client-side rendering unaffected). The DB-side atomicity of `UPDATE agent_runs ... RETURNING next_event_seq` isn't unit-testable here but asserted by the pattern shape.
- **Event envelope builder.** `eventId = ${runId}:${sequenceNumber}:${eventType}` shape is unique across the cartesian product of the three components.
- **Duration-since-run-start math.** Given `startedAt + now`, produces non-negative integer milliseconds; clock-skew case (now < startedAt) returns `0`, not a negative value.

`server/services/__tests__/agentRunPayloadWriterPure.test.ts` (the redaction → tool-policy → truncation pipeline from §6.2):

- **Pipeline order.** Input containing a redaction-pattern hit AND a tool-policy-gated tool call AND an oversized message is processed in the documented order (redact → policy → truncate); the resulting row is below the cap, `redacted_fields` has the redaction entry, `modifications` has both the `tool_policy` and `truncated` entries with correct paths.
- **Truncation greatest-first.** Given a 2 MB payload with 1.5 MB in `messages[3].content` and 500 KB in `response.content`, the writer truncates `messages[3].content` first; if still over cap, truncates `response.content`. Never truncates `toolDefinitions` (small + structurally significant).
- **Tool-policy `args-never-persisted`.** Tool-call arguments replaced with `[POLICY:args-never-persisted]` regardless of size; modification record includes the tool slug.
- **Under-cap no-op.** Input well under the cap produces `modifications = []` and `totalSizeBytes` matches the actual written size.
- **Redaction vs truncation separation.** A message containing both a Bearer token and oversized length gets the Bearer redaction in `redacted_fields`, and the remaining truncation (if any) in `modifications`. No overlap or double-counting.

`server/lib/__tests__/agentRunEditPermissionMaskPure.test.ts` (the resolver from §6.4):

- **One fixture per `LinkedEntityType` × tier × (has-permission, lacks-permission)** — confirms the mask's `canView` / `canEdit` / `canViewPayload` / `viewHref` / `editHref` match the expected matrix from §7.2.
- **System-managed agent masterPrompt** → `canEdit: false` regardless of caller permission (enforced by the `isSystemManaged` guard).
- **Immutable entity types** (`prompt`, `llm_request`, `action`) → `canEdit: false` under every caller.
- **Read-time recomputation.** Same input row evaluated against two different user contexts (caller-A with edit, caller-B without) produces different masks. Pinning test — the mask function is pure of user context; persisted state never affects output.
- **`canViewPayload` is strictly tighter than `canView`.** Every fixture where `canViewPayload=true` also has `canView=true`; the reverse is not required.

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
| Exactly one event per decision, deterministic per-run ordering | `agent_execution_events UNIQUE (run_id, sequence_number)` + atomic allocation via `agent_runs.next_event_seq` `UPDATE ... RETURNING` (§4.1, §4.2) |
| No dropped events on WebSocket dropout | Durable write before emit + `GET /api/agent-runs/:runId/events?fromSeq=N` backfill on reconnect (§4.3) |
| No double-rendered events on reconnect | `eventId` LRU in `useSocket.ts` (existing 500-entry cache) — §5.10 |
| No cross-tenant leakage | RLS policy on all four new tables + `RLS_PROTECTED_TABLES` manifest + `verify-rls-coverage.sh` gate + route guards + socket handler mirroring route permissions (§7.1, §7.5) |
| No mid-run edit hot-swap | Edit link writes through existing entity edit services; run keeps loaded state; audit row in `agent_execution_log_edits` (§4.8, §7.2) |
| No unbounded storage growth | Retention job at 03:30 UTC + tier cutoffs + env var configuration (§4.6) |
| No unbounded per-run event volume | `AGENT_EXECUTION_LOG_MAX_EVENTS_PER_RUN` enforced in the `UPDATE ... WHERE next_event_seq < $cap` clause; non-critical drop + critical bypass + `run.event_limit_reached` signal (§4.1, §4.9) |
| No unbounded per-row payload size | `AGENT_EXECUTION_LOG_MAX_PAYLOAD_BYTES` enforced by `agentRunPayloadWriter`; greatest-first truncation recorded in `modifications` (§4.5, §5.7) |
| No stale authorisation on historical events | `permissionMask` computed at read time only — never persisted (§4.1a, §7.2); pinning test at §10.1 guards the invariant |
| No dropped critical events on transient DB failure | One inline retry with 50 ms backoff; persistent failure → `agent_exec_log.critical_drops_total` metric + structured log; agent run never fails (§4.1, §4.9) |
| Persisted full assembled prompt | `agent_run_prompts` with `(run_id, assembly_number)` PK (§5.6) + `agentRunPromptService.persistAssembly()` (§6.2) |
| Persisted full LLM payload | `agent_run_llm_payloads` keyed by `llm_request_id`, written inside the ledger insert transaction, post-redaction + post-policy + post-truncation (§4.5, §5.7) |
| Permission-gated entity links at read time | Per-entity `permissionMask` computed by `agentRunEditPermissionMask` at every socket emit + snapshot response (§6.4, §7.2) |
| Tiered retention hot / warm / cold | Three-table pair + rotation job + minimal restore contract (§4.6, §8 P3, §8 P3.1) |
| N+1 free label resolution on snapshot read | Batched `SELECT id, label FROM {table} WHERE id = ANY($1)` per entity type — at most 9 queries per page regardless of size (§5.9) |

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
| `feature_flags: only_for_behaviour_modes` | **Resolved.** `AGENT_EXECUTION_LOG_ENABLED` kill-switch env var was dropped from §6.7 in the 2026-04-21 revision after raising this exact issue with the author. Posture is now `rollout_model: commit_and_revert` — emergency disable uses `git revert`, not a toggle. Retention env vars (`*_HOT_MONTHS`, `*_WARM_MONTHS`, `*_COLD_YEARS`, `*_ARCHIVE_BATCH_SIZE`) stay — they are operational tunables like `LLM_LEDGER_RETENTION_MONTHS`, not feature flags. |
| `prefer_existing_primitives_over_new_ones: yes` | §3 — every primitive extends an existing one; the one genuinely new primitive (`agent_execution_events`) has a dedicated justification paragraph. |
| `accepted_primitives` | Reuse confirmed for: `withOrgTx`, `getOrgScopedDb`, `RLS_PROTECTED_TABLES`, `verify-rls-*.sh`, `createWorker()`, `shared/runStatus.ts`. New additions to the list are post-merge (§6.6). |
| `convention_rejections: "do not add feature flags for new migrations"` | §8 migrations are not behind feature flags. Resolved by the compliance fix above. |
| `convention_rejections: "do not introduce new service layers when existing primitives fit"` | §3 rigorous on reuse; new services (`agentExecutionEventService`, `agentRunPromptService`) are thin, single-responsibility, and slot into the existing route→service→db convention. No new layer invented. |

**Compliance gap resolved** (2026-04-21 revision): `AGENT_EXECUTION_LOG_ENABLED` removed from §6.7. No remaining framing deviations.

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
- **Parallel writers for the same run — ordering semantics, not correctness.** With `agent_runs.next_event_seq` the correctness question (uniqueness + monotonicity) is settled. What remains is UI clarity: if two subsystems write to the same run concurrently, interleaved sequence numbers don't reflect causal ordering. Not an issue today — agent loop is single-threaded per run. Revisit the UI copy when parallel-writer lands. Deferred in §9.
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
