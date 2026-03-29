# Phase I: Autonomous Foundations — Development Plan

**Scope:** Recommendations 1, 2, 4, 5 from the Strategic Recommendations spec
**Target:** 4-6 weeks
**Branch:** `claude/plan-phase-one-scuWq`

---

## Design Decisions (Confirmed)

- Memory summarisation triggers per-workspace (any agent's run counts toward the threshold)
- Handoffs are strictly within the same subaccount
- Handoffs fire on both `create_task` (with assigned agent) and task reassignment
- Tool restrictions are per-subaccount-agent link (most flexible)
- Workspace memory gets a UI for debugging/monitoring
- Budget exceeded uses soft stop (graceful wrap-up, not hard kill)
- New run statuses (`loop_detected`, `budget_exceeded`) apply to new runs only
- Workspace memory and board summary are two separate prompt sections

---

## Build Order

```
Week 1-2:  #1 Shared Memory + #4 Context Offloading (shared summarisation)
Week 2-3:  #5 Middleware Pipeline (refactor loop before adding handoffs)
Week 3-4:  #2 Agent-to-Agent Handoffs (depends on middleware for safety)
```

---

## 1. Shared Memory (Workspace Intelligence)

### 1.1 Database Schema

**New table: `workspace_memories`**
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| organisationId | UUID FK → organisations | |
| subaccountId | UUID FK → subaccounts | Unique per workspace |
| summary | text | Current compiled memory |
| boardSummary | text | Compressed board state (for Context Offloading) |
| runsSinceSummary | integer (default 0) | Counter to trigger re-summarisation |
| summaryThreshold | integer (default 5) | Configurable runs-before-resummarise |
| version | integer (default 0) | Increments on each re-generation |
| summaryGeneratedAt | timestamp | |
| createdAt, updatedAt | timestamp | |

**New table: `workspace_memory_entries`**
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| organisationId | UUID FK → organisations | |
| subaccountId | UUID FK → subaccounts | |
| agentRunId | UUID FK → agent_runs | Which run produced this |
| agentId | UUID FK → agents | Which agent produced this |
| content | text | Key observations from one run |
| entryType | text enum | `observation`, `decision`, `preference`, `issue`, `pattern` |
| includedInSummary | boolean (default false) | Whether this entry has been rolled into a summary |
| createdAt | timestamp | |

**Indexes:**
- `workspace_memories`: unique on (organisationId, subaccountId)
- `workspace_memory_entries`: on (subaccountId, includedInSummary), on (agentRunId)

### 1.2 Implementation

**Files to create:**
- `server/db/schema/workspaceMemories.ts` — Both tables
- `server/services/workspaceMemoryService.ts` — Memory CRUD, extraction, summarisation
- `server/routes/workspaceMemory.ts` — API endpoints

**Files to modify:**
- `server/db/schema/index.ts` — Export new tables
- `server/services/agentExecutionService.ts` — Inject memory into prompt, trigger extraction post-run
- `server/index.ts` — Register new routes

**Service methods (`workspaceMemoryService`):**
```
getMemory(orgId, subaccountId) → WorkspaceMemory | null
getOrCreateMemory(orgId, subaccountId) → WorkspaceMemory
extractRunInsights(runId, agentId, orgId, subaccountId, runSummary) → void
  // Makes one LLM call to extract structured observations from the run summary
  // Stores as workspace_memory_entries
  // Increments runsSinceSummary
  // If runsSinceSummary >= summaryThreshold → triggers regenerateSummary()
regenerateSummary(orgId, subaccountId) → void
  // Loads existing summary + all entries where includedInSummary=false
  // Makes one LLM call to compress into updated summary
  // Also regenerates boardSummary from current task state
  // Updates workspace_memories, marks entries as included, resets counter
getMemoryForPrompt(orgId, subaccountId) → string
  // Returns formatted memory text ready for system prompt injection
```

**Extraction prompt (structured):**
```
Given this agent run summary, extract key insights as JSON:
{
  "entries": [
    { "content": "...", "entryType": "observation|decision|preference|issue|pattern" }
  ]
}
Focus on: client preferences, recurring patterns, important decisions,
issues discovered, and anything the next agent should know.
```

**Memory injection point in agentExecutionService.ts:**
Between skill instructions and task context (line ~167-173), add:
```typescript
// Add workspace memory
const memory = await workspaceMemoryService.getMemoryForPrompt(
  request.organisationId, request.subaccountId
);
if (memory) {
  systemPromptParts.push(`\n\n---\n## Workspace Memory\n${memory}`);
}
```

**Post-run extraction in agentExecutionService.ts:**
After the run completes successfully (line ~217), add:
```typescript
// Extract insights for workspace memory (fire-and-forget, don't block return)
workspaceMemoryService.extractRunInsights(
  run.id, request.agentId, request.organisationId,
  request.subaccountId, loopResult.summary ?? ''
).catch(err => console.error('Memory extraction failed:', err));
```

### 1.3 API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/subaccounts/:subaccountId/memory` | View current memory + recent entries |
| PUT | `/api/subaccounts/:subaccountId/memory` | Manually edit memory summary |
| POST | `/api/subaccounts/:subaccountId/memory/regenerate` | Force re-summarisation |
| GET | `/api/subaccounts/:subaccountId/memory/entries` | List raw memory entries (paginated) |
| DELETE | `/api/subaccounts/:subaccountId/memory/entries/:entryId` | Remove bad entry |

### 1.4 Frontend (Monitoring UI)

- New tab/section in subaccount view: "Memory"
- Shows current summary text (editable textarea)
- Shows boardSummary (read-only)
- Shows recent entries as a timeline (with entry type badges)
- "Regenerate" button triggers POST regenerate
- Shows metadata: version, last generated, runs since last summary

---

## 2. Agent-to-Agent Handoffs via the Board

### 2.1 Database Schema

**Modify `tasks` table — add columns:**
| Column | Type | Notes |
|--------|------|-------|
| handoffSourceRunId | UUID FK → agent_runs, nullable | Which run created this handoff |
| handoffContext | JSONB, nullable | Context passed from originating agent |
| handoffDepth | integer (default 0) | How deep in the handoff chain |

**Modify `agent_runs` table — add column:**
| Column | Type | Notes |
|--------|------|-------|
| handoffDepth | integer (default 0) | Depth of this run in a handoff chain |
| parentRunId | UUID FK → agent_runs, nullable | The run that triggered this one |

### 2.2 Implementation

**Files to modify:**
- `server/db/schema/tasks.ts` — Add handoff columns
- `server/db/schema/agentRuns.ts` — Add handoff tracking
- `server/services/skillExecutor.ts` — Trigger handoff jobs from create_task and write_workspace
- `server/services/agentScheduleService.ts` — Register handler for `agent-handoff-run` queue
- `server/services/agentExecutionService.ts` — Accept and propagate handoff depth, inject handoff context

**Handoff flow:**

1. Agent A calls `create_task` with `assigned_agent_id` = Agent B
2. `executeCreateTask()` in skillExecutor:
   - Creates the task (existing logic)
   - Looks up `subaccount_agents` for Agent B in the same subaccount
   - If found and active: enqueue pg-boss job `agent-handoff-run`
   - Job payload: `{ taskId, agentId, subaccountId, subaccountAgentId, organisationId, sourceRunId, handoffDepth: currentDepth + 1, handoffContext }`
3. Same logic for task reassignment via `write_workspace` when `assignedAgentId` changes

**Handoff job handler (in agentScheduleService):**
```typescript
await pgBoss.work('agent-handoff-run', async (job) => {
  const { taskId, agentId, subaccountAgentId, subaccountId,
          organisationId, sourceRunId, handoffDepth } = job.data;

  // Enforce max depth
  if (handoffDepth > MAX_HANDOFF_DEPTH) {
    console.warn(`Handoff depth ${handoffDepth} exceeds max ${MAX_HANDOFF_DEPTH}, skipping`);
    return;
  }

  await agentExecutionService.executeRun({
    agentId, subaccountId, subaccountAgentId, organisationId,
    runType: 'triggered',
    taskId,
    triggerContext: { type: 'handoff', sourceRunId, handoffDepth },
  });
});
```

**Constants:**
- `MAX_HANDOFF_DEPTH = 5` (configurable, prevents infinite chains)

**Handoff context injection:**
In `buildAutonomousInstructions()`, when `triggerContext.type === 'handoff'`:
```
You were handed this task by another agent (run: {sourceRunId}).
The previous agent provided this context: {handoffContext}
Continue the work from where they left off.
```

**Extend `create_task` tool schema:**
Add optional `handoff_context` field (string) — free-text context the agent provides for the next agent.

### 2.3 Loop Prevention Mechanisms

1. **Depth cap:** Hard limit at `MAX_HANDOFF_DEPTH` (default 5)
2. **Self-assignment prevention:** Agent cannot create a task assigned to itself (would cause immediate re-trigger)
3. **Duplicate prevention:** Before enqueuing handoff job, check if there's already a `running` or `pending` run for the same agent+task combination
4. **Rate limiting:** Max 3 handoff jobs per workspace per minute (via pg-boss throttle options)

---

## 3. Context Offloading (Smart Token Management) — Recommendation #4

### 3.1 Database Schema

**Modify `agent_runs` table — add column:**
| Column | Type | Notes |
|--------|------|-------|
| systemPromptTokens | integer (default 0) | Approximate token count of system prompt |

### 3.2 Implementation

**Replace `buildTaskOverviewContext()` in agentExecutionService.ts:**

```typescript
async function buildSmartBoardContext(
  orgId: string,
  subaccountId: string,
  agentId: string,
  boardSummary: string | null
): string {
  const parts: string[] = [];

  // 1. Board summary (from workspace memory) — replaces raw task dump
  if (boardSummary) {
    parts.push('### Board Summary\n' + boardSummary);
  }

  // 2. Tasks assigned to THIS agent (always full detail)
  const myTasks = await taskService.listTasks(orgId, subaccountId, { assignedAgentId: agentId });
  if (myTasks.length > 0) {
    parts.push('\n### Your Assigned Tasks');
    for (const task of myTasks) {
      parts.push(`- [${task.id}] **${task.title}** (${task.status}, ${task.priority})`);
      if (task.description) parts.push(`  ${task.description.slice(0, 200)}`);
    }
  }

  // 3. In-progress tasks (cross-agent awareness)
  const inProgress = await taskService.listTasks(orgId, subaccountId, { status: 'in_progress' });
  const othersInProgress = inProgress.filter(t => t.assignedAgentId !== agentId);
  if (othersInProgress.length > 0) {
    parts.push('\n### Other In-Progress Work');
    for (const task of othersInProgress.slice(0, 5)) {
      parts.push(`- [${task.id}] ${task.title} → ${task.assignedAgent?.name ?? 'unassigned'}`);
    }
  }

  // 4. Status counts only for everything else
  const allTasks = await taskService.listTasks(orgId, subaccountId, {});
  const counts: Record<string, number> = {};
  for (const t of allTasks) {
    counts[t.status] = (counts[t.status] ?? 0) + 1;
  }
  parts.push('\n### Board Totals: ' + Object.entries(counts).map(([s, c]) => `${s}: ${c}`).join(' | '));

  return parts.join('\n');
}
```

**Token budget awareness:**
Add a progressive trimming function called after assembling all system prompt parts:
```typescript
function trimSystemPrompt(parts: string[], maxTokens: number): string {
  let prompt = parts.join('');
  let tokens = approxTokens(prompt);

  if (tokens <= maxTokens) return prompt;

  // Trim board context first (keep summary, remove details)
  // Then trim data sources
  // Then trim skill methodology (keep instructions)
  // Never trim: master prompt, autonomous instructions
}
```

**boardSummary generation** (in workspaceMemoryService, piggybacking on memory summarisation):
When `regenerateSummary()` runs, also query current board state and produce a compressed summary:
```
Summarise this board state in 200 words or less. Focus on:
what's in progress, what's blocked, what's been completed recently,
and what needs attention.
```

### 3.3 Metrics

Log `systemPromptTokens` on every agent run for monitoring. Update in `agentExecutionService.ts` after building the full system prompt:
```typescript
const systemPromptTokens = approxTokens(fullSystemPrompt);
await db.update(agentRuns).set({ systemPromptTokens }).where(eq(agentRuns.id, run.id));
```

---

## 4. Middleware Pipeline (Guardrails & Reliability) — Recommendation #5

### 4.1 Architecture

```
server/services/middleware/
├── types.ts           — Interfaces
├── budgetCheck.ts     — Token + tool call budget
├── loopDetection.ts   — Repeated action detection
├── toolRestriction.ts — Per-subaccount-agent allowlist
├── errorHandling.ts   — Structured error capture
└── index.ts           — Pipeline composition
```

### 4.2 Interface Design

```typescript
// types.ts
interface MiddlewareContext {
  runId: string;
  request: AgentRunRequest;
  agent: { modelId: string; temperature: number; maxTokens: number };
  saLink: SubaccountAgent;
  tokensUsed: number;
  toolCallsCount: number;
  toolCallHistory: Array<{ name: string; inputHash: string; iteration: number }>;
  iteration: number;
  startTime: number;
}

type PreCallResult =
  | { action: 'continue' }
  | { action: 'stop'; reason: string; status: string }; // status = run status to set

type PreToolResult =
  | { action: 'continue' }
  | { action: 'skip'; reason: string }
  | { action: 'stop'; reason: string; status: string };

interface PreCallMiddleware {
  name: string;
  execute(ctx: MiddlewareContext): PreCallResult;
}

interface PreToolMiddleware {
  name: string;
  execute(ctx: MiddlewareContext, toolCall: { name: string; input: Record<string, unknown> }): PreToolResult;
}

interface MiddlewarePipeline {
  preCall: PreCallMiddleware[];
  preTool: PreToolMiddleware[];
}
```

### 4.3 Middleware Implementations

**budgetCheck.ts (PreCall):**
- Check `tokensUsed >= saLink.tokenBudgetPerRun` → stop with `budget_exceeded`
- Check `toolCallsCount >= saLink.maxToolCallsPerRun` → stop with `budget_exceeded`
- Check `Date.now() - startTime > saLink.timeoutSeconds * 1000` → stop with `timeout`
- Extracted from current inline checks in `runAgenticLoop()`

**loopDetection.ts (PreTool):**
- Hash each tool call: `crypto.createHash('md5').update(name + JSON.stringify(input)).digest('hex')`
- Track in `toolCallHistory`
- If same hash appears 3+ times → stop with `loop_detected`
- Configurable threshold (default 3)

**toolRestriction.ts (PreTool):**
- New column on `subaccount_agents`: `allowedSkillSlugs` (JSONB array, nullable)
- If `allowedSkillSlugs` is set and tool name not in list → skip with reason
- If null → allow all (backwards compatible)

**errorHandling.ts (wraps tool execution, not a middleware per se):**
- Catch tool execution errors
- Classify: transient (network timeout, rate limit) vs permanent (bad input, not found)
- Retry transient errors once with 1s delay
- Return structured error to LLM: `{ error: true, type: 'transient|permanent', message, retried: bool }`

### 4.4 Refactor `runAgenticLoop()`

Replace inline budget/timeout checks with pipeline execution:

```typescript
// Before each LLM call
for (const mw of pipeline.preCall) {
  const result = mw.execute(ctx);
  if (result.action === 'stop') {
    // Do graceful wrap-up (existing soft stop logic)
    finalStatus = result.status;
    break;
  }
}

// Before each tool execution
for (const mw of pipeline.preTool) {
  const result = mw.execute(ctx, toolCall);
  if (result.action === 'skip') {
    toolResults.push({ tool_use_id: tc.id, content: `Tool skipped: ${result.reason}` });
    continue;
  }
  if (result.action === 'stop') {
    finalStatus = result.status;
    break outerLoop;
  }
}
```

### 4.5 Database Changes

**Modify `subaccount_agents` — add column:**
| Column | Type | Notes |
|--------|------|-------|
| allowedSkillSlugs | JSONB array, nullable | If set, only these tools allowed. Null = all allowed. |

**Modify `agent_runs` status enum** (text field, no actual PG enum — just type annotation):
Add `loop_detected` and `budget_exceeded` to the `$type<>()` union.

---

## Verification Plan

### Per-Feature Verification

**Shared Memory:**
- [ ] Create workspace memory via API, verify stored correctly
- [ ] Run an agent, verify memory entry extracted post-run
- [ ] Run 5 agents, verify summary regenerated automatically
- [ ] Run an agent, verify memory summary injected into system prompt
- [ ] Edit memory via API, verify next run uses updated memory
- [ ] Verify memory UI shows summary, entries, and metadata

**Agent-to-Agent Handoffs:**
- [ ] Agent A creates task assigned to Agent B → verify Agent B job enqueued
- [ ] Agent B runs with correct taskId and handoff context
- [ ] Handoff at max depth → verify rejected (not enqueued)
- [ ] Agent tries to self-assign → verify prevented
- [ ] Rapid handoffs in same workspace → verify rate limited
- [ ] Task reassignment via write_workspace → verify handoff triggered

**Context Offloading:**
- [ ] Workspace with 5 tasks → verify full detail in context
- [ ] Workspace with 100 tasks → verify summary used instead of raw dump
- [ ] Agent's own tasks always appear in full detail
- [ ] systemPromptTokens logged on agent_runs
- [ ] Token savings measurable vs. baseline (compare prompt sizes)

**Middleware Pipeline:**
- [ ] Token budget exceeded → verify soft stop with `budget_exceeded` status
- [ ] Tool call limit exceeded → verify soft stop
- [ ] Agent repeats same tool call 3x → verify `loop_detected` status
- [ ] Tool not in allowedSkillSlugs → verify skipped with reason
- [ ] allowedSkillSlugs = null → verify all tools available (backwards compat)
- [ ] Transient tool error → verify retried once
- [ ] Existing agent runs unaffected by refactor (regression test)

---

## Migration Checklist

- [ ] `drizzle-kit generate` for workspace_memories table
- [ ] `drizzle-kit generate` for workspace_memory_entries table
- [ ] `drizzle-kit generate` for tasks handoff columns
- [ ] `drizzle-kit generate` for agent_runs handoff + prompt token columns
- [ ] `drizzle-kit generate` for subaccount_agents allowedSkillSlugs column
- [ ] Run all migrations on dev database
- [ ] Verify zero downtime — all new columns are nullable/have defaults

---

## File Inventory

### New Files
| File | Purpose |
|------|---------|
| `server/db/schema/workspaceMemories.ts` | Schema for workspace_memories + workspace_memory_entries |
| `server/services/workspaceMemoryService.ts` | Memory CRUD, extraction, summarisation |
| `server/routes/workspaceMemory.ts` | API endpoints for memory |
| `server/services/middleware/types.ts` | Middleware interfaces |
| `server/services/middleware/budgetCheck.ts` | Budget/timeout enforcement |
| `server/services/middleware/loopDetection.ts` | Repeated action detection |
| `server/services/middleware/toolRestriction.ts` | Per-link tool allowlist |
| `server/services/middleware/errorHandling.ts` | Error classification + retry |
| `server/services/middleware/index.ts` | Pipeline composition + default pipeline |
| `client/src/pages/subaccount/WorkspaceMemory.tsx` | Memory monitoring UI |

### Modified Files
| File | Changes |
|------|---------|
| `server/db/schema/index.ts` | Export new tables |
| `server/db/schema/tasks.ts` | Add handoff columns |
| `server/db/schema/agentRuns.ts` | Add handoffDepth, parentRunId, systemPromptTokens |
| `server/db/schema/subaccountAgents.ts` | Add allowedSkillSlugs |
| `server/services/agentExecutionService.ts` | Memory injection, context offloading, middleware pipeline, handoff depth |
| `server/services/skillExecutor.ts` | Handoff job enqueuing on create_task + reassignment |
| `server/services/agentScheduleService.ts` | Register agent-handoff-run handler |
| `server/services/llmService.ts` | Token budget helpers |
| `server/index.ts` | Register memory routes |
