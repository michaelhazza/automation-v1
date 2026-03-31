# Phase 1 & Phase 2 Design Specification

**Date:** 31 March 2026
**Status:** Implementation-ready spec
**Scope:** Memory quality + entities + provider fallback (P1) → Vector search + event triggers (P2)

---

## Scope

**Phase 1 (Immediate):**
- Memory quality scoring on entries
- Basic entity extraction
- Provider fallback + retry layer in llmRouter

**Phase 2 (Next):**
- Vector memory search via pgvector
- Event-based triggers (task_created, task_moved, agent_completed)

Everything else is deferred.

---

## Phase 1A: Memory Quality Scoring

### What Changes

Every memory entry extracted from a run gets scored 0.0–1.0 before insertion. Entries below the workspace threshold are stored but never promoted to summaries.

### Database Changes

**File:** `server/db/schema/workspaceMemories.ts`

Add to `workspaceMemoryEntries`:
```typescript
qualityScore: real('quality_score'),
```

Add to `workspaceMemories`:
```typescript
qualityThreshold: real('quality_threshold').notNull().default(0.5),
```

**Migration:**
```sql
ALTER TABLE workspace_memory_entries ADD COLUMN quality_score REAL;
ALTER TABLE workspace_memories ADD COLUMN quality_threshold REAL NOT NULL DEFAULT 0.5;
```

### Implementation

**File:** `server/services/workspaceMemoryService.ts`

Add scoring function (heuristic — no LLM call):

```typescript
function scoreMemoryEntry(entry: { content: string; entryType: string }): number {
  const content = entry.content;

  const completeness = Math.min(content.length / 200, 1.0);

  const specificitySignals = [
    /\d+/.test(content),
    /\b[A-Z][a-z]+(?:\s[A-Z][a-z]+)+\b/.test(content),
    /"[^"]+"/.test(content),
    /\b\d{4}-\d{2}-\d{2}\b/.test(content),
    /\$[\d,]+/.test(content),
  ];
  const specificity = specificitySignals.filter(Boolean).length / specificitySignals.length;

  const typeBoosts: Record<string, number> = {
    preference: 1.0, pattern: 0.9, decision: 0.85, issue: 0.8, observation: 0.6,
  };
  const relevance = typeBoosts[entry.entryType] ?? 0.5;

  const actionability = /should|must|always|never|prefers?|requires?|wants?|needs?|avoid/i
    .test(content) ? 0.9 : 0.4;

  return 0.25 * completeness + 0.25 * relevance + 0.25 * specificity + 0.25 * actionability;
}
```

**Modify `extractRunInsights()`** — add `qualityScore` to each entry value.

**Modify `regenerateSummary()`** — filter entries by quality threshold:
```sql
AND quality_score >= workspace_memories.quality_threshold
```

Low-quality entries remain in DB (queryable for debugging) but never enter summaries.

### Files Modified

| File | Change |
|---|---|
| `server/db/schema/workspaceMemories.ts` | Add columns |
| `server/services/workspaceMemoryService.ts` | Add scoring, modify extraction + regeneration |
| `server/routes/workspaceMemory.ts` | Expose threshold in GET/PATCH |
| Drizzle migration | ALTER TABLE |

---

## Phase 1B: Basic Entity Extraction

### What Changes

After each agent run, extract named entities (people, companies, products) alongside memory insights. Store with mention counts. Inject top entities into agent prompts.

### Database Changes

**New file:** `server/db/schema/workspaceEntities.ts`

```sql
CREATE TABLE workspace_entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES organisations(id),
  subaccount_id UUID NOT NULL REFERENCES subaccounts(id),
  name TEXT NOT NULL,
  entity_type TEXT NOT NULL, -- person | company | product | project | location | other
  attributes JSONB DEFAULT '{}',
  mention_count INTEGER NOT NULL DEFAULT 1,
  first_seen_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  UNIQUE(subaccount_id, name, entity_type)
);
```

### Implementation

**File:** `server/services/workspaceMemoryService.ts`

Add `extractEntities()` — LLM call extracts JSON array of entities, upsert on conflict (increment mention_count, merge attributes).

Add `getEntitiesForPrompt()` — returns top 10 entities by mention_count wrapped in `<workspace-entities>` boundary markers.

**File:** `server/services/agentExecutionService.ts`

Call `extractEntities()` after `extractRunInsights()` in finalization (step 10).
Inject entities into system prompt after memory injection.

### Config

```typescript
export const MAX_PROMPT_ENTITIES = 10;
export const MAX_ENTITIES_PER_EXTRACTION = 10;
export const VALID_ENTITY_TYPES = ['person', 'company', 'product', 'project', 'location', 'other'] as const;
```

### Files Modified

| File | Change |
|---|---|
| `server/db/schema/workspaceEntities.ts` | **New** |
| `server/db/schema/index.ts` | Export |
| `server/services/workspaceMemoryService.ts` | Add entity functions |
| `server/services/agentExecutionService.ts` | Call extraction, inject into prompt |
| `server/config/limits.ts` | Entity constants |
| `server/routes/workspaceMemory.ts` | Entity CRUD endpoints |

---

## Phase 1C: Provider Fallback + Retry

### What Changes

When a provider call fails (rate limit, outage, timeout), retry with backoff, then fall back to the next provider. Currently a failure kills the run.

### Design

No database changes. Pure logic in `llmRouter.ts`.

**Fallback chain:** Anthropic → OpenAI → Gemini
**Retry policy:** 2 retries with backoff [1s, 3s] per provider before fallover.

### Implementation

**File:** `server/services/llmRouter.ts`

Replace step 8 (provider call) with a retry-with-fallback loop:

```typescript
const providerChain = [ctx.provider, ...FALLBACK_CHAIN.filter(p => p !== ctx.provider)];

for (const provider of providerChain) {
  const model = provider === ctx.provider ? ctx.model : getFallbackModel(ctx.model, provider);
  if (!model) continue;

  for (let retry = 0; retry <= MAX_RETRIES; retry++) {
    if (retry > 0) await sleep(BACKOFF_MS[retry - 1]);
    try {
      providerResponse = await adapter.call({ model, ... });
      break outer;
    } catch (err) {
      if (!isRetryableError(err)) throw err;
    }
  }
}
```

**Model mapping:**
```typescript
{
  openai: { 'claude-sonnet-4-6': 'gpt-4o', 'claude-haiku-4-5': 'gpt-4o-mini' },
  google: { 'claude-sonnet-4-6': 'gemini-2.0-flash', 'claude-haiku-4-5': 'gemini-2.0-flash-lite' },
}
```

Audit record logs actual provider/model used + fallback metadata.

### Config

```typescript
export const PROVIDER_MAX_RETRIES = 2;
export const PROVIDER_BACKOFF_MS = [1000, 3000];
export const PROVIDER_FALLBACK_CHAIN = ['anthropic', 'openai', 'google'];
```

### Files Modified

| File | Change |
|---|---|
| `server/services/llmRouter.ts` | Retry loop, fallback chain, model mapping |
| `server/config/limits.ts` | Fallback constants |

---

## Phase 2A: Vector Memory Search (pgvector)

### What Changes

Replace "dump all memory" with semantic search. Find top-K most relevant memories for the current task. Keeps prompts lean as workspaces grow.

### Prerequisites

- Phase 1A (quality scoring)
- `OPENAI_API_KEY` for embeddings

### Database Changes

```sql
CREATE EXTENSION IF NOT EXISTS vector;
ALTER TABLE workspace_memory_entries ADD COLUMN embedding vector(1536);
CREATE INDEX idx_memory_entries_embedding
  ON workspace_memory_entries USING hnsw (embedding vector_cosine_ops);
```

### Implementation

**New file:** `server/lib/embeddings.ts` — wraps OpenAI `text-embedding-3-small`

**Modify `extractRunInsights()`** — generate embeddings at insert time (batch call).

**Add `getRelevantMemories()`** — pgvector cosine similarity search filtered by quality threshold.

**Update `getMemoryForPrompt()`** — accepts optional `taskContext`. When provided:
1. Semantic search for top 5 relevant entries
2. Include abbreviated compiled summary as general context
3. Fallback to full summary if no embeddings or no task context

### Cost

text-embedding-3-small: ~$0.02 per 1M tokens. ~$0.0001 per agent run. Negligible.

### Files

| File | Change |
|---|---|
| `server/lib/embeddings.ts` | **New** |
| `server/db/schema/workspaceMemories.ts` | Add embedding column |
| `server/services/workspaceMemoryService.ts` | Embed at insert, semantic retrieval, updated prompt builder |
| `server/services/agentExecutionService.ts` | Pass task context to memory prompt |
| `server/config/limits.ts` | Vector search constants |
| `.env.example` | OPENAI_API_KEY |

---

## Phase 2B: Event-Based Triggers

### What Changes

Agents fire on events: task_created, task_moved, agent_completed. With cooldowns and filters.

### Database Changes

**New table `agent_triggers`:**
```sql
CREATE TABLE agent_triggers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL,
  subaccount_id UUID NOT NULL,
  subaccount_agent_id UUID NOT NULL,
  event_type TEXT NOT NULL, -- task_created | task_moved | agent_completed
  event_filter JSONB DEFAULT '{}',
  cooldown_seconds INTEGER NOT NULL DEFAULT 60,
  is_active BOOLEAN DEFAULT true,
  last_triggered_at TIMESTAMPTZ,
  trigger_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
```

### Implementation

**New file:** `server/services/triggerService.ts`

`checkAndFire(subaccountId, orgId, eventType, eventData)`:
1. Find matching active triggers
2. Check cooldown window
3. Match event filter (all filter keys must match event data)
4. Self-trigger guard (skip if triggering agent = target agent)
5. Enqueue via pg-boss
6. Update trigger stats

**Hook points (non-blocking .catch()):**
- `taskService.ts` → task creation → `checkAndFire('task_created', ...)`
- `taskService.ts` → task move → `checkAndFire('task_moved', ...)`
- `agentExecutionService.ts` → run completed → `checkAndFire('agent_completed', ...)`

**Job sender** wired via `setTriggerJobSender()` in `agentScheduleService.initialize()`.

### Loop Prevention

1. Self-trigger guard in checkAndFire
2. Cooldown (60s default)
3. Existing MAX_HANDOFF_DEPTH (5)
4. Existing token budget limits per run

### API Routes

**New file:** `server/routes/agentTriggers.ts` — CRUD (list, create, patch, delete)
Permissions: `view_agents` for read, `manage_agents` for write.

### Files

| File | Change |
|---|---|
| `server/db/schema/agentTriggers.ts` | **New** |
| `server/db/schema/index.ts` | Export |
| `server/services/triggerService.ts` | **New** |
| `server/routes/agentTriggers.ts` | **New** |
| `server/services/taskService.ts` | Emit events |
| `server/services/agentExecutionService.ts` | Emit agent_completed |
| `server/services/agentScheduleService.ts` | Wire job sender |
| `server/index.ts` | Mount routes |

---

## Summary

### Phase 1 (~2 weeks)

| Item | Effort |
|---|---|
| Memory quality scoring | 2-3 days |
| Entity extraction | 3-4 days |
| Provider fallback | 2-3 days |

### Phase 2 (~2 weeks)

| Item | Effort |
|---|---|
| Vector memory search | 3-4 days |
| Event triggers | 4-5 days |

### New Dependencies

- `openai` npm package (embeddings only, Phase 2)

### Replit Compatible

All confirmed. pgvector on Neon. OpenAI embeddings via HTTP. Triggers via pg-boss.
