# WebSocket Integration Audit Brief

**Date:** 2026-03-31  
**Status:** Awaiting review & approval

---

## Executive Summary

The platform currently uses **HTTP polling** for all real-time updates. There are no WebSocket, SSE, or push-based communication patterns anywhere in the codebase. Paperclip (referenced as inspiration) also does not have WebSocket support — they use the same polling/heartbeat model.

This brief proposes adding WebSocket support via **Socket.IO** to replace polling and enable true live updates, particularly for LLM-powered operations (agent runs, conversations, executions).

---

## Current State: Polling Inventory

| What's polled | Interval | File | Lines |
|---|---|---|---|
| Execution status | 2s | `client/src/pages/TaskExecutionPage.tsx` | 117-131 |
| Execution status (portal) | 2s | `client/src/pages/PortalExecutionPage.tsx` | 91-101 |
| Live agent count | 15s | `client/src/components/Layout.tsx` | 261-268 |
| Review queue count | 30s | `client/src/components/Layout.tsx` | 252-259 |
| Running agent count (admin) | 15s | `client/src/pages/AdminAgentsPage.tsx` | 143-151 |
| Budget alert check | 120s | `client/src/components/Layout.tsx` | 281-296 |

**Problems with polling:**
- Wasted requests when nothing has changed
- 2s execution polling is aggressive but still feels laggy (up to 2s delay)
- No intermediate progress — user only sees status transitions, not what's happening
- Dashboard and history pages are completely static after initial load
- No cross-tab/cross-user updates (e.g. one user triggers a run, another user doesn't see it)

---

## Proposed WebSocket Channels

### Tier 1 — Critical (Replace Polling, Enable Streaming)

#### 1. `execution:status`
**Replaces:** 2s polling in TaskExecutionPage & PortalExecutionPage  
**Events:**
- `execution:started` — execution begins processing
- `execution:progress` — intermediate progress updates (new)
- `execution:completed` — final result with output data
- `execution:failed` — error details
- `execution:files_ready` — output files available for download

**Scope:** Per-execution (join room `execution:<id>`)  
**Server emit points:**
- `server/services/queueService.ts` — during `processExecution()` (lines 93-301)
- `server/routes/webhooks.ts` — when external engine posts callback

**Impact:** Instant status updates, no polling. Users see results the moment they're ready.

---

#### 2. `agent:run`
**Replaces:** No current polling (runs are fire-and-forget with no live feedback)  
**Events:**
- `agent:run:started` — run begins
- `agent:run:tool_call` — agent is calling a tool (live progress)
- `agent:run:llm_response` — LLM responded (show thinking indicator)
- `agent:run:iteration` — loop iteration with summary
- `agent:run:completed` — final result with summary, tasks created, etc.
- `agent:run:failed` — error or budget exceeded
- `agent:run:sub_agent_spawned` — sub-agent started (show in trace)

**Scope:** Per-run (join room `agent-run:<id>`)  
**Server emit points:**
- `server/services/agentExecutionService.ts` — throughout the agentic loop (lines 342-500+)
- `server/services/llmRouter.ts` — after `routeCall()` completes

**Impact:** This is the biggest UX win. Users currently submit an agent run and have zero visibility into what's happening. With WebSocket events at each iteration, the UI can show a live trace of the agent thinking, calling tools, and producing results. This makes the whole platform feel "alive".

---

#### 3. `conversation:message`
**Replaces:** Synchronous POST that blocks until full LLM response  
**Events:**
- `conversation:typing` — LLM is generating (show typing indicator)
- `conversation:chunk` — streamed token chunk (if streaming enabled)
- `conversation:message` — complete assistant message
- `conversation:tool_use` — agent is using a tool mid-conversation
- `conversation:tool_result` — tool result received

**Scope:** Per-conversation (join room `conversation:<id>`)  
**Server emit points:**
- `server/services/conversationService.ts` — during `sendMessage()` (lines 237-390)
- Would require switching Anthropic adapter to streaming mode

**Impact:** Chat feels instant. Tokens appear as they're generated instead of waiting for the full response. Tool use is visible in real-time.

---

### Tier 2 — High Value (Replace Remaining Polling)

#### 4. `subaccount:live`
**Replaces:** 15s live agent count + 30s review queue count + 120s budget polling in Layout.tsx  
**Events:**
- `live:agent_count` — running agent count changed
- `live:review_count` — review queue count changed
- `live:budget_update` — cost threshold crossed

**Scope:** Per-subaccount (join room `subaccount:<id>`)  
**Server emit points:**
- `server/services/queueService.ts` — when execution starts/completes
- `server/services/agentExecutionService.ts` — when agent run starts/completes
- `server/routes/reviewItems.ts` — when review item created
- `server/services/costAggregateService.ts` — when cost aggregate updated

**Impact:** Eliminates 3 polling intervals from Layout. Sidebar badges update instantly.

---

#### 5. `execution:history`
**Replaces:** Static load on ExecutionHistoryPage, DashboardPage  
**Events:**
- `execution:new` — new execution created (add to list)
- `execution:status_changed` — execution status transition

**Scope:** Per-subaccount (join room `subaccount:<id>:executions`)  
**Server emit points:**
- `server/services/executionService.ts` — on create and status update

**Impact:** Dashboard and history pages update in real-time. New executions appear without refresh.

---

### Tier 3 — Nice to Have (Cross-User Collaboration)

#### 6. `review:update`
**Events:**
- `review:item_created` — new review item from agent run
- `review:item_approved` — item approved by reviewer
- `review:item_rejected` — item rejected

**Scope:** Per-subaccount  
**Impact:** Review queue page updates live. Multiple reviewers see each other's actions.

#### 7. `task:update`
**Events:**
- `task:created` — new task on board
- `task:status_changed` — task moved between columns
- `task:assigned` — task assigned to agent/user

**Scope:** Per-subaccount  
**Impact:** Board view updates in real-time across users.

#### 8. `schedule:update`
**Events:**
- `schedule:triggered` — scheduled task fired
- `schedule:completed` — scheduled run finished
- `schedule:next_run` — next run time updated

**Scope:** Per-subaccount  
**Impact:** Scheduled tasks page shows live execution status.

---

## Technical Architecture

### Server-Side Setup

```
server/
├── websocket/
│   ├── index.ts          # Socket.IO server init, attach to HTTP server
│   ├── auth.ts           # JWT authentication middleware for WS connections
│   ├── rooms.ts          # Room management (join/leave based on permissions)
│   └── emitters.ts       # Helper functions to emit events from services
```

**Key decisions:**
- **Library:** Socket.IO (handles reconnection, rooms, namespaces, fallback to long-polling)
- **Auth:** Validate JWT on connection handshake via middleware
- **Rooms:** Users auto-join rooms based on their org + subaccount permissions
- **Scaling:** Socket.IO with Redis adapter if horizontal scaling needed (already have Redis for BullMQ)

### Client-Side Setup

```
client/src/
├── lib/
│   └── socket.ts         # Socket.IO client singleton + React context
├── hooks/
│   └── useSocket.ts      # React hook for subscribing to events
```

**Key decisions:**
- Single persistent connection per authenticated session
- React context provider wraps the app
- `useSocket(event, callback)` hook for components to subscribe
- Auto-reconnect with exponential backoff
- Graceful degradation: fall back to existing polling if WS connection fails

### Integration Pattern

Services emit events through a thin `emitter` layer:

```typescript
// server/websocket/emitters.ts
import { io } from './index';

export function emitExecutionUpdate(executionId: string, event: string, data: any) {
  io.to(`execution:${executionId}`).emit(event, data);
}

export function emitSubaccountUpdate(subaccountId: string, event: string, data: any) {
  io.to(`subaccount:${subaccountId}`).emit(event, data);
}
```

Services call emitters alongside existing DB writes — no architectural change to the service layer.

---

## Implementation Phases

### Phase 1: Foundation + Execution Status (Tier 1, items 1 & 4)
- Set up Socket.IO server + client
- Auth middleware for WebSocket connections
- Room management
- Replace execution polling with WebSocket events
- Replace Layout polling (live count, review count, budget)
- **Estimated scope:** ~15 files touched

### Phase 2: Agent Run Live Trace (Tier 1, item 2)
- Emit events at each agent loop iteration
- Build live trace UI component (show tool calls, LLM responses in real-time)
- Sub-agent spawn visibility
- **Estimated scope:** ~8 files touched

### Phase 3: Conversation Streaming (Tier 1, item 3)
- Switch Anthropic adapter to streaming mode
- Emit token chunks via WebSocket
- Update AgentChatPage to render streaming tokens
- **Estimated scope:** ~6 files touched, Anthropic adapter rewrite

### Phase 4: Cross-User Updates (Tiers 2 & 3)
- Execution history live updates
- Review queue real-time
- Board task updates
- Schedule status
- **Estimated scope:** ~12 files touched

---

## What Changes, What Doesn't

| Layer | Changes? | Details |
|---|---|---|
| Database schema | No | No schema changes needed |
| REST API routes | No | All existing endpoints remain (WebSocket supplements, not replaces) |
| Service layer | Minimal | Add emitter calls at key state transitions |
| Queue service | Minimal | Add emits during execution processing |
| Client API layer | No | `api.ts` unchanged; socket is a separate transport |
| Client pages | Yes | Remove polling, add socket event handlers |
| Dependencies | Yes | Add `socket.io` (server) + `socket.io-client` (client) |
| Infrastructure | Maybe | Redis adapter if multi-instance deployment |

---

## Risk & Considerations

1. **Graceful degradation** — WebSocket should enhance, not replace. If WS disconnects, fall back to polling. Never break core functionality.
2. **Permission scoping** — WebSocket rooms must respect org/subaccount permissions. Users must not receive events from resources they can't access.
3. **Memory/connection limits** — Socket.IO connections are persistent. Need connection limits per user and cleanup on disconnect.
4. **Portal users** — Portal (client_user) WebSocket connections need separate auth path and restricted room access.
5. **Deployment** — Sticky sessions or Redis adapter required if running multiple server instances behind a load balancer.

---

## Recommendation

Start with **Phase 1** (foundation + execution status + layout badges). This gives the highest ROI:
- Eliminates all current polling
- Proves the architecture works end-to-end
- Low risk — supplements existing REST, doesn't replace it

Then move to **Phase 2** (agent run live trace) which is the biggest UX differentiator — making agent execution feel truly live and transparent.

Phase 3 (streaming conversations) is high-impact but requires an Anthropic adapter rewrite to support streaming, so it's best tackled separately.
