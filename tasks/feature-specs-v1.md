# Feature Implementation Specs v1

**Date:** 31 March 2026  
**Status:** Spec for review  
**Source:** PraisonAI architecture analysis + current codebase audit  
**Replit Compatible:** Yes (see notes at bottom)

---

## Feature 1: Workflow Composition Primitives

### Problem
We only support sequential handoffs (Agent A → Agent B via pg-boss). No parallel execution, routing, loops, or evaluator-optimizer patterns. Agencies can't build complex multi-agent workflows.

### Design

#### 1.1 New Concept: `WorkflowPattern`

Add a `workflowPattern` field to `subaccountAgents` that controls how child work is orchestrated:

```typescript
type WorkflowPattern = 
  | { type: 'sequential' }                    // Current behavior (default)
  | { type: 'parallel', awaitAll: boolean }    // Run children concurrently
  | { type: 'route', classifierPrompt: string, routes: Record<string, string> }
  | { type: 'loop', dataSource: 'tasks' | 'csv' | 'list', items?: string[] }
  | { type: 'evaluator', evaluatorAgentId: string, maxIterations: number, qualityThreshold: number }
```

#### 1.2 Database Changes

**Alter `subaccount_agents`:**
```sql
ALTER TABLE subaccount_agents ADD COLUMN workflow_pattern jsonb DEFAULT '{"type":"sequential"}';
ALTER TABLE subaccount_agents ADD COLUMN workflow_config jsonb DEFAULT '{}';
```

**New table `workflow_runs`:**
```sql
CREATE TABLE workflow_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES organisations(id),
  subaccount_id UUID NOT NULL REFERENCES subaccounts(id),
  parent_run_id UUID REFERENCES agent_runs(id),
  pattern_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  child_run_ids JSONB DEFAULT '[]',
  results JSONB DEFAULT '{}',
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### 1.3 Parallel Execution

Extend `spawn_sub_agents` in `skillExecutor.ts`:

```typescript
if (workflowPattern.type === 'parallel' && workflowPattern.awaitAll) {
  const workflowRun = await createWorkflowRun(parentRunId, 'parallel', childRunIds);
  await Promise.all(children.map(child => 
    pgBossSend(AGENT_HANDOFF_QUEUE, { ...child, workflowRunId: workflowRun.id })
  ));
  const results = await pollWorkflowCompletion(workflowRun.id, {
    timeoutMs: context.timeoutMs - elapsed,
    pollIntervalMs: 2000
  });
  return { success: true, pattern: 'parallel', results };
}
```

Budget splitting: total remaining ÷ number of children, floor check at `MIN_SUB_AGENT_TOKEN_BUDGET`.

#### 1.4 Route Pattern

Classification call using cheap model, then handoff to matched agent:

```typescript
async function executeRoutePattern(context, pattern, taskDescription) {
  const classification = await routeCall({
    messages: [{ role: 'user', content: taskDescription }],
    system: pattern.classifierPrompt,
    maxTokens: 50,
    context: { ...context, taskType: 'classification', model: EXTRACTION_MODEL }
  });
  const category = extractCategory(classification.text, Object.keys(pattern.routes));
  const targetAgentSlug = pattern.routes[category] ?? pattern.routes['default'];
  await enqueueHandoff(targetAgentSlug, context);
  return { success: true, classification: category, routedTo: targetAgentSlug };
}
```

#### 1.5 Loop Pattern

```typescript
async function executeLoopPattern(context, pattern) {
  let items = await resolveItems(pattern); // tasks, CSV rows, or literal list
  const budgetPerItem = Math.floor(remainingBudget / items.length);
  if (budgetPerItem < MIN_SUB_AGENT_TOKEN_BUDGET) return { error: 'insufficient budget' };
  
  const results = [];
  for (const item of items) {
    const result = await executeRun({
      ...context,
      triggerContext: { loopItem: item, loopIndex: results.length },
      tokenBudget: budgetPerItem
    });
    results.push(result);
  }
  return { success: true, itemsProcessed: results.length, results };
}
```

#### 1.6 Evaluator-Optimizer Loop

Uses existing review infrastructure:

```typescript
async function executeEvaluatorPattern(generatorContext, pattern) {
  let iteration = 0, lastOutput = '', feedback = '';
  
  while (iteration < pattern.maxIterations) {
    const genResult = await executeRun({
      ...generatorContext,
      triggerContext: { evaluatorFeedback: feedback || undefined, previousOutput: lastOutput || undefined, iteration }
    });
    lastOutput = genResult.summary;
    
    const evalResult = await routeCall({
      messages: [{ role: 'user', content: `Evaluate:\n\n${lastOutput}` }],
      system: `Score 0.0-1.0. If >= ${pattern.qualityThreshold}, "APPROVED: [score]". Otherwise "FEEDBACK: [improvements]".`,
      context: { ...generatorContext, model: EXTRACTION_MODEL, taskType: 'evaluation' }
    });
    
    if (evalResult.text.startsWith('APPROVED')) {
      return { success: true, iterations: iteration + 1, output: lastOutput };
    }
    feedback = evalResult.text.replace('FEEDBACK:', '').trim();
    iteration++;
  }
  return { success: true, output: lastOutput, maxIterationsReached: true };
}
```

#### 1.7 New Limits

```typescript
MAX_PARALLEL_CHILDREN = 5;
MAX_LOOP_ITEMS = 50;
MAX_EVALUATOR_ITERATIONS = 5;
ROUTE_CLASSIFICATION_MAX_TOKENS = 100;
WORKFLOW_POLL_INTERVAL_MS = 2000;
WORKFLOW_POLL_TIMEOUT_MS = 600000;
```

#### 1.8 Files to Modify

| File | Change |
|---|---|
| `server/db/schema/subaccountAgents.ts` | Add `workflowPattern`, `workflowConfig` |
| `server/db/schema/workflowRuns.ts` | **New** |
| `server/services/agentExecutionService.ts` | Pattern detection, call executors |
| `server/services/workflowExecutionService.ts` | **New** — all pattern executors |
| `server/services/skillExecutor.ts` | Parallel await mode |
| `server/config/limits.ts` | Workflow limits |
| `server/routes/subaccountAgents.ts` | Accept workflowPattern |
| `client/src/pages/SubaccountAgentSettings.tsx` | Workflow config UI |

**Effort:** ~2 weeks

---

## Feature 2: Tiered Memory Architecture

### Problem
Flat memory — no quality filtering, no entity tracking, no semantic search, no per-user preferences.

### 2.1 Quality Scoring

Heuristic scoring (no LLM call):

```typescript
async function scoreMemoryEntry(entry) {
  const scores = {
    completeness: Math.min(entry.content.length / 200, 1.0),
    specificity: countSpecificitySignals(entry.content) / 5,
    relevance: TYPE_BOOSTS[entry.entryType] ?? 0.5,
    actionability: /should|must|always|never|prefers?/i.test(entry.content) ? 0.9 : 0.4
  };
  return 0.25 * scores.completeness + 0.25 * scores.relevance 
       + 0.25 * scores.specificity + 0.25 * scores.actionability;
}
```

Default threshold: 0.5. Below → stored but never promoted to summaries.

```sql
ALTER TABLE workspace_memory_entries ADD COLUMN quality_score REAL;
ALTER TABLE workspace_memories ADD COLUMN quality_threshold REAL DEFAULT 0.5;
```

### 2.2 Entity Extraction

```sql
CREATE TABLE workspace_entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL,
  subaccount_id UUID NOT NULL,
  name TEXT NOT NULL,
  entity_type TEXT NOT NULL, -- person | company | product | project | location
  attributes JSONB DEFAULT '{}',
  relationships JSONB DEFAULT '[]',
  mention_count INTEGER DEFAULT 1,
  first_seen_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  source_run_ids JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  UNIQUE(subaccount_id, name, entity_type)
);
```

Extraction via LLM post-run (alongside memory extraction). Upsert on conflict. Top 10 entities by mention_count injected into agent prompts.

### 2.3 Vector Search (pgvector)

```sql
CREATE EXTENSION IF NOT EXISTS vector;
ALTER TABLE workspace_memory_entries ADD COLUMN embedding vector(1536);
CREATE INDEX idx_memory_embedding ON workspace_memory_entries 
  USING hnsw (embedding vector_cosine_ops);
```

Embeddings via OpenAI `text-embedding-3-small`. Semantic retrieval replaces "dump all memories" — query embedding compared to stored embeddings, return top-K relevant entries.

### 2.4 User Memory

```sql
CREATE TABLE user_memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL,
  subaccount_id UUID NOT NULL,
  user_id UUID NOT NULL,
  content TEXT NOT NULL,
  memory_type TEXT DEFAULT 'preference',
  quality_score REAL,
  source_run_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

Injected when agent works on tasks assigned to/by that user.

### Files to Modify

| File | Change |
|---|---|
| `server/db/schema/workspaceMemoryEntries.ts` | Add `qualityScore`, `embedding` |
| `server/db/schema/workspaceMemories.ts` | Add `qualityThreshold` |
| `server/db/schema/workspaceEntities.ts` | **New** |
| `server/db/schema/userMemories.ts` | **New** |
| `server/services/workspaceMemoryService.ts` | Quality scoring, entities, vector search |
| `server/lib/embeddings.ts` | **New** |
| `server/services/agentExecutionService.ts` | Inject entities + relevant memories |
| `server/routes/workspaceMemory.ts` | Entity/user memory APIs |

**Effort:** ~2.5 weeks

---

## Feature 4: MCP Protocol Support

### Problem
Agents can only use built-in skills. No extensibility without new code.

### 4.1 MCP Client

```sql
CREATE TABLE mcp_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL,
  subaccount_id UUID,
  name TEXT NOT NULL,
  server_url TEXT NOT NULL,
  transport TEXT DEFAULT 'streamable_http',
  auth_config JSONB DEFAULT '{}',
  discovered_tools JSONB DEFAULT '[]',
  is_active BOOLEAN DEFAULT true,
  last_connected_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE mcp_connection_agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mcp_connection_id UUID NOT NULL REFERENCES mcp_connections(id),
  subaccount_agent_id UUID NOT NULL REFERENCES subaccount_agents(id),
  gate_level TEXT DEFAULT 'auto',
  UNIQUE(mcp_connection_id, subaccount_agent_id)
);
```

MCP tools resolved alongside built-in skills, namespaced as `mcp_{connectionName}_{toolName}`. Routed through existing action/review gates. Uses `@modelcontextprotocol/sdk`.

**Replit note:** Streamable HTTP transport only. No stdio.

### 4.2 MCP Server (Phase 2)

Expose workspace agents as MCP tools via `server/mcp/server.ts`. External MCP clients can invoke agents.

### Files

| File | Change |
|---|---|
| `server/db/schema/mcpConnections.ts` | **New** |
| `server/db/schema/mcpConnectionAgents.ts` | **New** |
| `server/services/mcpClientService.ts` | **New** |
| `server/mcp/server.ts` | **New** (Phase 2) |
| `server/services/agentExecutionService.ts` | Resolve MCP tools |
| `server/services/skillExecutor.ts` | Route `mcp_*` calls |
| `server/routes/mcpConnections.ts` | **New** |
| `client/src/pages/MCPConnections.tsx` | **New** |

**Effort:** ~2 weeks (client) + ~1.5 weeks (server, Phase 2)

---

## Feature 5: Autonomous Scheduling Improvements

### 5.1 Event-Based Triggers

```sql
CREATE TABLE agent_triggers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL,
  subaccount_id UUID NOT NULL,
  subaccount_agent_id UUID NOT NULL,
  trigger_type TEXT NOT NULL, -- cron | event | webhook
  event_type TEXT, -- task_created | task_moved | agent_completed | email_received
  event_filter JSONB DEFAULT '{}',
  cron_expression TEXT,
  webhook_secret TEXT,
  is_active BOOLEAN DEFAULT true,
  cooldown_seconds INTEGER DEFAULT 60,
  last_triggered_at TIMESTAMPTZ,
  trigger_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
```

`triggerService.checkEventTriggers()` called from taskService (on create/move), agentExecutionService (on complete), emailService (on receive). Cooldown prevents rapid re-triggering.

### 5.2 Session Checkpointing

```sql
ALTER TABLE agent_runs ADD COLUMN checkpoint JSONB;
ALTER TABLE agent_runs ADD COLUMN is_resumable BOOLEAN DEFAULT false;
```

Checkpoint every 3 iterations. On startup, resume interrupted runs with `status='running'` and valid checkpoint.

### 5.3 Chain Scheduling

```sql
CREATE TABLE scheduled_chains (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL,
  subaccount_id UUID NOT NULL,
  name TEXT NOT NULL,
  schedule_cron TEXT NOT NULL,
  schedule_timezone TEXT DEFAULT 'UTC',
  is_active BOOLEAN DEFAULT true,
  steps JSONB NOT NULL, -- [{ type: 'agent'|'process'|'delay'|'condition', ... }]
  on_failure TEXT DEFAULT 'stop',
  last_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
```

pg-boss cron fires chain. `chainExecutionService` runs steps sequentially, respecting failure policy.

### Files

| File | Change |
|---|---|
| `server/db/schema/agentTriggers.ts` | **New** |
| `server/db/schema/scheduledChains.ts` | **New** |
| `server/db/schema/agentRuns.ts` | Add checkpoint columns |
| `server/services/triggerService.ts` | **New** |
| `server/services/chainExecutionService.ts` | **New** |
| `server/services/agentExecutionService.ts` | Checkpointing, resume |
| `server/services/agentScheduleService.ts` | Chains, resume on startup |
| `server/services/taskService.ts` | Emit trigger events |
| `server/routes/agentTriggers.ts` | **New** |
| `server/routes/scheduledChains.ts` | **New** |

**Effort:** ~2 weeks

---

## Feature 6: Observability & Telemetry

### 6.1 OpenTelemetry

```json
"@opentelemetry/api": "^1.9.0",
"@opentelemetry/sdk-node": "^0.56.0",
"@opentelemetry/exporter-trace-otlp-http": "^0.56.0",
"@opentelemetry/instrumentation-http": "^0.56.0",
"@opentelemetry/instrumentation-express": "^0.45.0",
"@opentelemetry/instrumentation-pg": "^0.48.0"
```

`withSpan()` helper wraps: agent runs, LLM calls, skill executions, memory operations. Zero overhead when `OTEL_EXPORTER_OTLP_ENDPOINT` not set.

### 6.2 Run Replay

```sql
ALTER TABLE agent_runs ADD COLUMN message_history JSONB;
ALTER TABLE agent_runs ADD COLUMN trace_events JSONB DEFAULT '[]';
```

Structured trace events collected per iteration: `llm_call`, `tool_call`, `tool_result`, `middleware`. Frontend timeline component for step-by-step replay.

### 6.3 Cost Analytics

New endpoint: `GET /api/subaccounts/:id/analytics/costs` with period/groupBy params. Aggregates from `agent_runs` + `llm_requests`. Anomaly detection (cost > 2x average flagged).

### Files

| File | Change |
|---|---|
| `server/lib/telemetry.ts` | **New** |
| `server/index.ts` | Init telemetry at startup |
| `server/services/agentExecutionService.ts` | Spans, trace events, message history |
| `server/services/llmRouter.ts` | Span |
| `server/services/skillExecutor.ts` | Span |
| `server/db/schema/agentRuns.ts` | Add columns |
| `server/routes/analytics.ts` | **New** |
| `client/src/pages/RunReplay.tsx` | **New** |
| `client/src/pages/CostAnalytics.tsx` | **New** |

**Effort:** ~2 weeks

---

## Feature 7: Auto-Agent Generation

### 7.1 Business Description → Agent Team

System prompt generates JSON team proposal from natural language. API returns proposal for user review. Second endpoint applies approved proposal (batch creates agents, triggers, chains).

### 7.2 Template Library

Pre-built templates: Social Media Monitor, Inbox Processor, Competitor Analyst, Content Creator, Client Reporter, etc. One-click install per workspace.

### Files

| File | Change |
|---|---|
| `server/services/autoAgentService.ts` | **New** |
| `server/routes/autoGenerate.ts` | **New** |
| `server/config/agentTemplates.ts` | **New** |
| `client/src/pages/AutoGenerateAgents.tsx` | **New** |

**Effort:** ~1.5 weeks

---

## Cross-Cutting Additions

### A. Enhanced Doom Loop Detection
Track output hashes (not just input). Detect "no progress" after 3 iterations with no board changes.

### B. Progressive Config API
`memory: true` → defaults. `memory: { qualityThreshold: 0.7, vectorSearch: true }` → full control.

### C. Context Compaction
When messages exceed 70% of token budget, summarize older messages and keep last 6.

---

## Implementation Roadmap

| Phase | Features | Effort |
|---|---|---|
| **1** | Memory quality (2.1), Entities (2.2), Doom loop (A) | ~2 weeks |
| **2** | Event triggers (5.1), Evaluator-optimizer (1.6), Compaction (C) | ~2 weeks |
| **3** | Parallel (1.3), Route (1.4), Loop (1.5), Chains (5.3) | ~2 weeks |
| **4** | MCP client (4.1-4.3), Vector search (2.3), User memory (2.4) | ~2.5 weeks |
| **5** | OpenTelemetry (6.1), Run replay (6.2), Cost analytics (6.3) | ~2 weeks |
| **6** | Auto-gen (7), MCP server (4.4), Checkpointing (5.2) | ~2.5 weeks |

**Total: ~13.5 weeks**

---

## Replit Compatibility Notes

1. **pgvector** — Neon PostgreSQL supports it. `CREATE EXTENSION IF NOT EXISTS vector;`
2. **Embeddings** — OpenAI `text-embedding-3-small` (1536 dims). ~$0.02/1M tokens.
3. **MCP** — Streamable HTTP only. No stdio child process spawning.
4. **OpenTelemetry** — Standard npm. Export to Grafana Cloud free tier.
5. **No filesystem** — All persistence via PostgreSQL. No SQLite, no local caches.
6. **Background workers** — pg-boss on Reserved VM. Chains/triggers use same infra.
7. **ChromaDB** — Skip it. pgvector handles all vector needs in existing DB.
