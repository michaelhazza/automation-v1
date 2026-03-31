# Phase 1 & Phase 2 Design Specification (v3 — Final)

**Date:** 31 March 2026
**Status:** Ready to build
**Scope:** Memory quality + entities + provider fallback (P1) → Vector search + event triggers (P2)

**v2 changes:** Min content gate, entity normalization + confidence filter, provider timeout guard, vector recency cap + similarity threshold, trigger rate cap + dry run mode.

**v3 changes:** Entity attribute cap (max 10 keys), provider cooldown map (skip recently-failed providers), empty query context guard, rate cap soft warning at 70%, lightweight observability logs.

---

## Phase 1A: Memory Quality Scoring

### What Changes

Every memory entry gets scored 0.0–1.0 before insertion. A hard minimum content gate (40 chars) rejects trivially short entries before scoring. Entries below the workspace threshold are stored but never promoted to summaries.

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

```typescript
function scoreMemoryEntry(entry: { content: string; entryType: string }): number {
  const content = entry.content;

  // Hard floor: trivially short content is always zero
  if (content.length < MIN_MEMORY_CONTENT_LENGTH) return 0;

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

**Modify `extractRunInsights()`** — add `qualityScore` to each entry.

**Modify `regenerateSummary()`** — filter by quality threshold:
```sql
AND quality_score >= workspace_memories.quality_threshold
```

Low-quality entries remain in DB for debugging but never enter summaries.

### Files Modified

| File | Change |
|---|---|
| `server/db/schema/workspaceMemories.ts` | Add columns |
| `server/services/workspaceMemoryService.ts` | Add scoring with min-length gate, modify extraction + regeneration |
| `server/config/limits.ts` | `MIN_MEMORY_CONTENT_LENGTH = 40` |
| `server/routes/workspaceMemory.ts` | Expose threshold in GET/PATCH |
| Drizzle migration | ALTER TABLE |

---

## Phase 1B: Basic Entity Extraction

### What Changes

After each run, extract named entities with **name normalization** (prevents "John Smith" vs "john smith" fragmentation) and **confidence filtering** (rejects hallucinated entities below 0.7).

### Database Changes

**New file:** `server/db/schema/workspaceEntities.ts`

```sql
CREATE TABLE workspace_entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES organisations(id),
  subaccount_id UUID NOT NULL REFERENCES subaccounts(id),
  name TEXT NOT NULL,                    -- normalized (lowercase, trimmed)
  display_name TEXT NOT NULL,            -- original casing
  entity_type TEXT NOT NULL,             -- person | company | product | project | location | other
  attributes JSONB DEFAULT '{}',
  confidence REAL,                       -- LLM confidence at extraction (0.0-1.0)
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

**Name normalization:**
```typescript
function normalizeEntityName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}
```

**LLM prompt** (strict, with confidence):
```
Only include entities you are highly confident are real and explicitly mentioned.
Do not infer or guess. Confidence: 1.0 = explicitly named, 0.7 = clearly referenced.
```

**Confidence filter:**
```typescript
if ((entity.confidence ?? 0) < MIN_ENTITY_CONFIDENCE) continue;
```

**Upsert on normalized name** — increment `mention_count`, merge `attributes`, preserve `displayName`.

**Attribute bloat guard** — cap at 10 keys per entity to prevent unbounded growth:
```typescript
const merged = { ...existing.attributes, ...newAttributes };
const capped = Object.fromEntries(Object.entries(merged).slice(0, MAX_ENTITY_ATTRIBUTES));
```

**Prompt injection** — top 10 entities by mention_count wrapped in `<workspace-entities>`.

### Files Modified

| File | Change |
|---|---|
| `server/db/schema/workspaceEntities.ts` | **New** |
| `server/services/workspaceMemoryService.ts` | `extractEntities()` + `getEntitiesForPrompt()` |
| `server/services/agentExecutionService.ts` | Call extraction, inject into prompt |
| `server/config/limits.ts` | `MAX_PROMPT_ENTITIES=10`, `MIN_ENTITY_CONFIDENCE=0.7`, `MAX_ENTITY_ATTRIBUTES=10` |

---

## Phase 1C: Provider Fallback + Retry

### What Changes

When a provider fails or **hangs**, retry with backoff, then fall back. A **30s timeout guard** wraps every call.

### Implementation

**File:** `server/services/llmRouter.ts`

**Timeout guard:**
```typescript
async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Provider call timed out after ${ms}ms (${label})`)), ms)
    ),
  ]);
}
```

**Provider cooldown map** — skip recently-failed providers to avoid repeated slow failures:
```typescript
const providerCooldowns: Map<string, number> = new Map(); // provider → timestamp
const PROVIDER_COOLDOWN_MS = 60000; // 60s

function isProviderCoolingDown(provider: string): boolean {
  const cooldownUntil = providerCooldowns.get(provider);
  if (!cooldownUntil) return false;
  if (Date.now() > cooldownUntil) {
    providerCooldowns.delete(provider);
    return false;
  }
  return true;
}

// Called after exhausting retries for a provider:
providerCooldowns.set(provider, Date.now() + PROVIDER_COOLDOWN_MS);
```

**Retry-fallback loop** replaces step 8 in `routeCall()`:
- Chain: Anthropic → OpenAI → Gemini
- Skip providers in cooldown (recently failed)
- 2 retries per provider with backoff [1s, 3s]
- Each call wrapped in `withTimeout(call, 30000)`
- Non-retryable errors (auth, bad request) propagate immediately
- After exhausting retries, provider enters 60s cooldown
- Audit record logs actual provider/model used + fallback metadata

**Model mapping:**
```typescript
openai:  { 'claude-sonnet-4-6': 'gpt-4o',             'claude-haiku-4-5': 'gpt-4o-mini' }
google:  { 'claude-sonnet-4-6': 'gemini-2.0-flash',    'claude-haiku-4-5': 'gemini-2.0-flash-lite' }
```

### Files Modified

| File | Change |
|---|---|
| `server/services/llmRouter.ts` | `withTimeout()`, retry loop, fallback chain, model mapping |
| `server/config/limits.ts` | `PROVIDER_CALL_TIMEOUT_MS=30000`, `PROVIDER_MAX_RETRIES=2`, `PROVIDER_COOLDOWN_MS=60000` |

---

## Phase 2A: Vector Memory Search (pgvector)

### What Changes

Semantic search replaces "dump all memory". Results filtered by **similarity threshold** (0.75) and capped by **90-day recency window** to prevent unbounded scans.

### Database Changes

```sql
CREATE EXTENSION IF NOT EXISTS vector;
ALTER TABLE workspace_memory_entries ADD COLUMN embedding vector(1536);
CREATE INDEX idx_memory_entries_embedding
  ON workspace_memory_entries USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
CREATE INDEX idx_memory_entries_recent
  ON workspace_memory_entries (subaccount_id, created_at DESC)
  WHERE embedding IS NOT NULL;
```

### Implementation

**New file: `server/lib/embeddings.ts`** — wraps OpenAI `text-embedding-3-small` (1536 dims, ~$0.02/1M tokens).

**Embed at insert time** — batch call in `extractRunInsights()`. Non-fatal on failure.

**Empty query context guard** — skip vector search for weak/empty context:
```typescript
if (!taskContext || taskContext.length < 20) {
  return []; // forces fallback to compiled summary
}
```

**Semantic retrieval:**
```sql
WHERE subaccount_id = $1
  AND embedding IS NOT NULL
  AND quality_score >= threshold
  AND created_at > NOW() - INTERVAL '90 days'
ORDER BY embedding <=> query_vector
LIMIT 5
```

**Post-query filter:**
```typescript
const filtered = results.filter(r => r.similarity >= VECTOR_SIMILARITY_THRESHOLD);
```
If empty after filtering → graceful fallback to compiled summary.

**Updated `getMemoryForPrompt(taskContext?)`:**
1. If task context → semantic search for top-K relevant entries + abbreviated summary
2. If no results above threshold → fallback to full compiled summary
3. If no task context → original behavior (full summary)

### Files

| File | Change |
|---|---|
| `server/lib/embeddings.ts` | **New** |
| `server/db/schema/workspaceMemories.ts` | Add `embedding` column |
| `server/services/workspaceMemoryService.ts` | Embed at insert, `getRelevantMemories()`, update prompt builder |
| `server/services/agentExecutionService.ts` | Pass task context |
| `server/config/limits.ts` | `VECTOR_SIMILARITY_THRESHOLD=0.75`, `VECTOR_SEARCH_RECENCY_DAYS=90`, `MIN_QUERY_CONTEXT_LENGTH=20` |
| `.env.example` | `OPENAI_API_KEY` |

---

## Phase 2B: Event-Based Triggers

### What Changes

Agents fire on events with **global rate cap** (10 triggered runs/minute/workspace) and **dry run mode** for testing without execution.

### Database Changes

**New table `agent_triggers`:**
```sql
CREATE TABLE agent_triggers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL,
  subaccount_id UUID NOT NULL,
  subaccount_agent_id UUID NOT NULL,
  event_type TEXT NOT NULL,          -- task_created | task_moved | agent_completed
  event_filter JSONB DEFAULT '{}',   -- { "column": "In Progress" }
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

**New file: `server/services/triggerService.ts`**

`checkAndFire(subaccountId, orgId, eventType, eventData)`:
1. **Global rate cap** — count triggered runs in last minute, reject if >= `MAX_TRIGGERED_RUNS_PER_MINUTE`
   - **Soft warning at 70%**: log `console.warn` when count >= 7 (early signal before suppression)
2. Find active triggers matching event type
3. **Cooldown check** — skip if fired within cooldown window
4. **Filter match** — all filter keys must match event data
5. **Self-trigger guard** — skip if triggering agent = target agent
6. Enqueue via pg-boss
7. Update trigger stats
8. **Log execution count**: `console.info('[TriggerService] Fired N triggers for event_type in subaccount')`

`dryRun(subaccountId, orgId, eventType, eventData)`:
- Returns array of `{ triggerId, agentId, wouldFire, reason }` without executing
- Reasons: `cooldown_active`, `filter_mismatch`, `self_trigger`

**Hook points** (non-blocking `.catch()`):
- `taskService.ts` → task creation → `checkAndFire('task_created', ...)`
- `taskService.ts` → task move → `checkAndFire('task_moved', ...)`
- `agentExecutionService.ts` → run completed → `checkAndFire('agent_completed', ...)`

### Safety: 4-Layer Loop Prevention

1. **Self-trigger guard** — agent can't trigger itself
2. **Cooldown** — 60s default per trigger
3. **Global rate cap** — 10 triggered runs/min/workspace
4. **Existing depth limit** — `MAX_HANDOFF_DEPTH = 5`

### API Routes

**New file: `server/routes/agentTriggers.ts`**

| Method | Path | Permission | Description |
|---|---|---|---|
| GET | `/api/subaccounts/:id/triggers` | `view_agents` | List triggers |
| POST | `/api/subaccounts/:id/triggers` | `manage_agents` | Create trigger |
| PATCH | `/api/subaccounts/:id/triggers/:id` | `manage_agents` | Update trigger |
| DELETE | `/api/subaccounts/:id/triggers/:id` | `manage_agents` | Soft delete |
| POST | `/api/subaccounts/:id/triggers/dry-run` | `manage_agents` | Test trigger matching |

### Files

| File | Change |
|---|---|
| `server/db/schema/agentTriggers.ts` | **New** |
| `server/services/triggerService.ts` | **New** — matching, firing, dry run, CRUD |
| `server/routes/agentTriggers.ts` | **New** — API routes |
| `server/services/taskService.ts` | Emit events |
| `server/services/agentExecutionService.ts` | Emit `agent_completed` |
| `server/services/agentScheduleService.ts` | Wire job sender |
| `server/config/limits.ts` | `MAX_TRIGGERED_RUNS_PER_MINUTE = 10` |
| `server/index.ts` | Mount routes |

---

## Cross-Cutting: Lightweight Observability Logs

Three `console.info` lines added to existing services — no infrastructure, immediate visibility:

```typescript
// In workspaceMemoryService.extractRunInsights(), after insertion:
console.info(`[WorkspaceMemory] Extracted ${values.length} entries (${values.filter(v => v.qualityScore >= threshold).length} above threshold) for subaccount ${subaccountId}`);

// In workspaceMemoryService.extractEntities(), after processing:
console.info(`[WorkspaceMemory] Extracted ${stored} entities (${skipped} below confidence) for subaccount ${subaccountId}`);

// In triggerService.checkAndFire(), after firing:
console.info(`[TriggerService] Fired ${fired} of ${triggers.length} triggers for ${eventType} in subaccount ${subaccountId}`);
```

These provide immediate debugging signal without OpenTelemetry.

---

## Summary

### Phase 1 (~2 weeks)

| Item | Effort | v2 Improvements |
|---|---|---|
| Memory quality scoring | 2-3 days | Min content gate (40 chars) |
| Entity extraction | 3-4 days | Name normalization, confidence filter (0.7), attribute cap (10 keys) |
| Provider fallback | 2-3 days | Timeout guard (30s), provider cooldown map (60s) |

### Phase 2 (~2 weeks)

| Item | Effort | v2 Improvements |
|---|---|---|
| Vector memory search | 3-4 days | 90-day recency cap, similarity threshold (0.75), empty context guard |
| Event triggers | 4-5 days | Global rate cap (10/min), soft warning at 70%, dry run mode |

### All Config Constants

```typescript
// Phase 1A
MIN_MEMORY_CONTENT_LENGTH = 40;

// Phase 1B
MAX_PROMPT_ENTITIES = 10;
MAX_ENTITIES_PER_EXTRACTION = 10;
MIN_ENTITY_CONFIDENCE = 0.7;
MAX_ENTITY_ATTRIBUTES = 10;

// Phase 1C
PROVIDER_MAX_RETRIES = 2;
PROVIDER_BACKOFF_MS = [1000, 3000];
PROVIDER_FALLBACK_CHAIN = ['anthropic', 'openai', 'google'];
PROVIDER_CALL_TIMEOUT_MS = 30000;
PROVIDER_COOLDOWN_MS = 60000;

// Phase 2A
VECTOR_SEARCH_LIMIT = 5;
VECTOR_SIMILARITY_THRESHOLD = 0.75;
VECTOR_SEARCH_RECENCY_DAYS = 90;
ABBREVIATED_SUMMARY_LENGTH = 500;
MIN_QUERY_CONTEXT_LENGTH = 20;

// Phase 2B
MAX_TRIGGERED_RUNS_PER_MINUTE = 10;
```

### New Dependencies

- `openai` npm package (embeddings only, Phase 2)

### Replit Compatible

All confirmed. pgvector on Neon. Embeddings via HTTP. Triggers via pg-boss. No filesystem.
