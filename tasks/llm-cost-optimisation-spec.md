# LLM Cost Optimisation: Adaptive Intelligence Routing

**Status:** Spec — awaiting review
**Date:** 2026-04-04
**Classification:** Significant (multi-domain, new patterns, design decisions)

---

## 1. Problem Statement

Every LLM call in Automation OS currently uses the agent's configured model (default: `claude-sonnet-4-6`) regardless of cognitive demand. A simple "parse this JSON tool result" call costs the same as a complex planning call. At scale, this is unsustainable.

**Current state:**
- 12 `routeCall()` call sites across 5 services
- All use the agent's configured model statically
- 7 of 12 calls are low-complexity (extraction, tool-result parsing, summaries)
- Only Anthropic adapter is implemented; OpenAI and Gemini are stubs
- No dynamic model selection exists

**Target state:**
- Every LLM call is routed to the cheapest model that can do the job
- Routing is deterministic and system-aware (not prompt-aware)
- Four providers available: Anthropic, OpenAI, Gemini, OpenRouter
- Agent config sets the **ceiling**, not the constant
- Full cost analytics by execution phase

**Estimated cost reduction:** 60-70% blended across the platform.

---

## 2. Core Mental Model

We are NOT routing requests to models.

We are routing **execution phases** to **capability tiers**, which resolve to **provider + model**.

```
ExecutionPhase  →  CapabilityTier  →  Provider + Model
(deterministic)    (simple map)       (resolver with fallbacks)
```

### Why This Beats Prompt-Based Routing

Systems like ClawRouter infer intent from prompt content using keyword scoring. We don't need that — our system **knows** the purpose of every call structurally:

- `taskType` tells us **why** the call was made (billing/analytics)
- `executionPhase` tells us **how hard** the LLM needs to think (routing)
- `iteration` + `previousResponseHadToolCalls` tells us **where** we are in the agent loop

These are stronger signals than any keyword classifier can provide.

---

## 3. Type Definitions

### 3.1 Execution Phase

```typescript
// server/services/llmRouter.ts

export type ExecutionPhase = 'planning' | 'execution' | 'synthesis';
```

| Phase | Cognitive Demand | When | Tier |
|-------|-----------------|------|------|
| `planning` | High — reasoning, task understanding, tool selection | First iteration; multi-turn reasoning without tools | `frontier` |
| `execution` | Low — parsing tool results, deciding next step, structured extraction | Mid-loop after tool calls; all `memory_compile` calls | `economy` |
| `synthesis` | High — producing user-facing output, quality formatting | Final iteration (no more tool calls); wrap-up summaries | `frontier` |

### 3.2 Capability Tier

```typescript
export type CapabilityTier = 'frontier' | 'economy';
```

- **`frontier`**: Best available model within the agent's configured ceiling. Used for planning and synthesis.
- **`economy`**: Cheapest model that satisfies constraints (tool-calling support, context window). Used for execution.

### 3.3 Routing Mode

```typescript
export type RoutingMode = 'ceiling' | 'forced';
```

| Mode | Behaviour |
|------|-----------|
| `ceiling` (default) | Router can downgrade to economy tier for execution phase. Never upgrades beyond the configured model. |
| `forced` | Always use the configured provider + model. No routing. For agents where model choice is non-negotiable (compliance, financial output). |

**Derivation:** Agents with `allowModelOverride: false` → `forced`. All others → `ceiling`.

### 3.4 Resolver Interface

```typescript
// server/services/llmResolver.ts

export interface ResolveLLMParams {
  phase:       ExecutionPhase;
  taskType:    TaskType;
  ceiling?:    { provider: string; model: string };
  mode:        RoutingMode;
  constraints?: {
    requiresToolCalling?: boolean;   // derived from params.tools presence
    maxCostPerCallCents?: number;    // future — not implemented in v1
  };
}

export interface ResolveLLMResult {
  provider:       string;
  model:          string;
  tier:           CapabilityTier;
  wasDowngraded:  boolean;   // true if economy tier was selected instead of frontier
}
```

### 3.5 Iteration Hint

Passed from the agent loop to enable phase detection inside `routeCall()`:

```typescript
export interface IterationHint {
  iteration:                number;
  previousResponseHadToolCalls: boolean;
  hasToolResults:           boolean;
  totalToolCalls:           number;
}
```

### 3.6 Updated LLMCallContext

```typescript
const LLMCallContextSchema = z.object({
  organisationId:     z.string().uuid(),
  subaccountId:       z.string().uuid().optional(),
  userId:             z.string().uuid().optional(),
  runId:              z.string().uuid().optional(),
  executionId:        z.string().uuid().optional(),
  subaccountAgentId:  z.string().uuid().optional(),
  sourceType:         z.enum(SOURCE_TYPES),
  agentName:          z.string().optional(),
  taskType:           z.enum(TASK_TYPES),

  // --- NEW FIELDS ---
  executionPhase:     z.enum(['planning', 'execution', 'synthesis']),

  // provider and model become OPTIONAL — resolved by the router when not provided
  provider:           z.string().min(1).optional(),
  model:              z.string().min(1).optional(),

  // Routing mode — 'ceiling' allows downgrade, 'forced' locks to configured model
  routingMode:        z.enum(['ceiling', 'forced']).default('ceiling'),
});
```

### 3.7 LLM Selection (Provider + Model registry entry)

```typescript
// server/config/modelRegistry.ts

export interface ModelCapability {
  provider:            string;
  model:               string;
  tier:                CapabilityTier;
  supportsToolCalling: boolean;
  maxContextTokens:    number;
  // Cost per 1K tokens (used for tier sorting, not billing — billing uses pricingService)
  approxInputCostPer1K:  number;
  approxOutputCostPer1K: number;
}
```

---

## 4. Phase Detection Logic

### 4.1 Agent Loop (Dynamic — iteration-aware)

**File:** `server/services/agentExecutionService.ts` — inside `runAgenticLoop()`, before the `routeCall()` at line 875.

```typescript
// Track across iterations (declare before the loop)
let previousResponseHadToolCalls = false;

// Inside the loop, before routeCall():
let phase: ExecutionPhase;

if (iteration === 0) {
  // First contact with the task — needs full reasoning
  phase = 'planning';
}
else if (previousResponseHadToolCalls && hasToolResults) {
  // Just got tool results back — parsing + next-step decision is mechanical
  phase = 'execution';
}
else if (totalToolCalls > 0 && !previousResponseHadToolCalls) {
  // Tools were used previously, but last response had no tool calls
  // Agent is producing final output — needs quality
  phase = 'synthesis';
}
else if (iteration > 0 && totalToolCalls === 0) {
  // Multi-turn but no tools used at all — concluding a pure reasoning chain
  phase = 'synthesis';
}
else {
  // Fallback: treat as planning (frontier) — safe default
  phase = 'planning';
}

// After routeCall(), update tracking:
previousResponseHadToolCalls = !!(response.toolCalls && response.toolCalls.length > 0);
```

**Edge cases handled:**
- Agent that never uses tools → `planning` on iteration 0, `synthesis` on iteration 1+
- Agent in extended tool-calling loop → `execution` for every tool-result iteration
- Final output after tool use → `synthesis` (frontier quality for user-facing text)
- Multi-turn reasoning without tools → `planning` then `synthesis`

### 4.2 Non-Agent Calls (Static — hardcoded per call site)

These never need iteration awareness. Phase is determined by the call's purpose:

| Service | Line | Current taskType | Phase | Rationale |
|---------|------|-----------------|-------|-----------|
| `agentExecutionService.ts` | 855 | `general` | `synthesis` | Wrap-up on middleware stop — user-facing summary |
| `agentExecutionService.ts` | 926 | `general` | `synthesis` | Wrap-up on tool-stop — user-facing summary |
| `conversationService.ts` | 246 | `general` | `planning` | Initial response to user message — needs reasoning |
| `conversationService.ts` | 361 | `process_trigger` | `synthesis` | Post-tool response — user-facing output |
| `workspaceMemoryService.ts` | 173 | `memory_compile` | `execution` | Insight extraction — structured JSON output |
| `workspaceMemoryService.ts` | 331 | `memory_compile` | `execution` | Memory summary compilation |
| `workspaceMemoryService.ts` | 535 | `memory_compile` | `execution` | Entity extraction — structured JSON output |
| `workspaceMemoryService.ts` | 770 | `memory_compile` | `execution` | Deduplication comparison |
| `outcomeLearningService.ts` | 101 | `memory_compile` | `execution` | Lesson extraction — single string output |

---

## 5. The Resolver (`resolveLLM`)

### 5.1 Location

New file: `server/services/llmResolver.ts`

### 5.2 Algorithm

```typescript
export function resolveLLM(params: ResolveLLMParams): ResolveLLMResult {
  const { phase, taskType, ceiling, mode, constraints } = params;

  // ── 1. Forced mode — skip all routing ──────────────────────────────
  if (mode === 'forced' && ceiling) {
    return {
      provider: ceiling.provider,
      model:    ceiling.model,
      tier:     'frontier',
      wasDowngraded: false,
    };
  }

  // ── 2. Determine required tier ─────────────────────────────────────
  const tier: CapabilityTier = phase === 'execution' ? 'economy' : 'frontier';

  // ── 3. If frontier, return ceiling directly ────────────────────────
  if (tier === 'frontier' && ceiling) {
    return {
      provider: ceiling.provider,
      model:    ceiling.model,
      tier:     'frontier',
      wasDowngraded: false,
    };
  }

  // ── 4. Economy tier — find cheapest capable model ──────────────────
  let candidates = getEconomyModels();

  // Filter: tool-calling capability
  if (constraints?.requiresToolCalling) {
    candidates = candidates.filter(m => m.supportsToolCalling);
  }

  // Sort by cost (cheapest first — use output rate as primary, it dominates)
  candidates.sort((a, b) => a.approxOutputCostPer1K - b.approxOutputCostPer1K);

  // ── 5. Safety fallback — if no candidates, use ceiling ────────────
  if (candidates.length === 0) {
    return {
      provider: ceiling?.provider ?? 'anthropic',
      model:    ceiling?.model ?? 'claude-sonnet-4-6',
      tier:     'frontier',
      wasDowngraded: false,
    };
  }

  // ── 6. Return cheapest candidate ──────────────────────────────────
  const selected = candidates[0];
  return {
    provider:      selected.provider,
    model:         selected.model,
    tier:          'economy',
    wasDowngraded: true,
  };
}
```

### 5.3 Integration Point in `routeCall()`

**File:** `server/services/llmRouter.ts` — insert between step 1 (validate context) and step 2 (check provider).

```typescript
export async function routeCall(params: RouterCallParams): Promise<ProviderResponse> {
  const routerStart = Date.now();

  // ── 1. Validate context ────────────────────────────────────────────
  const ctx = LLMCallContextSchema.parse(params.context);

  // ── 1b. Resolve provider + model from execution phase (NEW) ────────
  const resolved = resolveLLM({
    phase:       ctx.executionPhase,
    taskType:    ctx.taskType,
    ceiling:     (ctx.provider && ctx.model) ? { provider: ctx.provider, model: ctx.model } : undefined,
    mode:        ctx.routingMode ?? 'ceiling',
    constraints: {
      requiresToolCalling: !!(params.tools && params.tools.length > 0),
    },
  });

  // Use resolved values for the rest of the flow
  const effectiveProvider = resolved.provider;
  const effectiveModel    = resolved.model;

  // ── 2. Check provider is registered ────────────────────────────────
  const adapter = getProviderAdapter(effectiveProvider);

  // ... rest of routeCall uses effectiveProvider/effectiveModel
  // ... resolved.tier, resolved.wasDowngraded written to llm_requests record
}
```

### 5.4 What the Resolver Does NOT Do

- No prompt inspection or keyword scoring
- No LLM calls for classification
- No latency-aware routing (future)
- No provider health scoring (future — but the existing cooldown system handles outages)
- No cost estimation within the resolver (that stays in pricingService)

---

## 6. Provider Adapters

### 6.1 Architecture

All providers implement the existing `LLMProviderAdapter` interface (no changes needed):

```typescript
// server/services/providers/types.ts (UNCHANGED)

export interface LLMProviderAdapter {
  readonly provider: string;
  call(params: ProviderCallParams): Promise<ProviderResponse>;
}
```

The existing `ProviderCallParams` and `ProviderResponse` interfaces are provider-agnostic by design. Each adapter translates to/from the provider's native API format.

### 6.2 OpenAI Adapter

**File:** `server/services/providers/openaiAdapter.ts` (replace stub)

**API:** `POST https://api.openai.com/v1/chat/completions`

**Key mapping:**

| Our interface | OpenAI API |
|--------------|-----------|
| `messages[].role` | Same (`user`, `assistant`) |
| `messages[].content` (text) | `content` string |
| `messages[].content` (tool_use) | `tool_calls[]` on assistant message |
| `messages[].content` (tool_result) | Message with `role: 'tool'`, `tool_call_id` |
| `system` | `messages[0]` with `role: 'system'` |
| `tools` | `tools[]` with `type: 'function'`, `function: { name, description, parameters }` |
| `maxTokens` | `max_tokens` |
| `temperature` | `temperature` |
| `response.content` | `choices[0].message.content` |
| `response.toolCalls` | `choices[0].message.tool_calls` → map to `{ id, name, input }` |
| `response.tokensIn` | `usage.prompt_tokens` |
| `response.tokensOut` | `usage.completion_tokens` |
| `response.stopReason` | `choices[0].finish_reason` |
| `response.providerRequestId` | `id` field or `x-request-id` header |

**Tool schema mapping:** Our `input_schema` maps directly to OpenAI's `parameters` field (both JSON Schema).

**Error handling:** Follow same pattern as Anthropic adapter — 503/529 → `PROVIDER_UNAVAILABLE`, 400/401/403 → non-retryable.

**Env:** `OPENAI_API_KEY` (already defined in `server/lib/env.ts`)

### 6.3 Gemini Adapter

**File:** `server/services/providers/geminiAdapter.ts` (replace stub)

**API:** `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`

**Key mapping:**

| Our interface | Gemini API |
|--------------|-----------|
| `messages[].role: 'user'` | `contents[].role: 'user'` |
| `messages[].role: 'assistant'` | `contents[].role: 'model'` |
| `messages[].content` (text) | `parts: [{ text }]` |
| `messages[].content` (tool_use) | `parts: [{ functionCall: { name, args } }]` |
| `messages[].content` (tool_result) | `parts: [{ functionResponse: { name, response } }]` |
| `system` | `systemInstruction: { parts: [{ text }] }` |
| `tools` | `tools: [{ functionDeclarations: [{ name, description, parameters }] }]` |
| `maxTokens` | `generationConfig.maxOutputTokens` |
| `temperature` | `generationConfig.temperature` |
| `response.content` | `candidates[0].content.parts` → extract text parts |
| `response.toolCalls` | `candidates[0].content.parts` → extract `functionCall` parts |
| `response.tokensIn` | `usageMetadata.promptTokenCount` |
| `response.tokensOut` | `usageMetadata.candidatesTokenCount` |
| `response.stopReason` | `candidates[0].finishReason` |

**Auth:** API key passed as query parameter `?key={GEMINI_API_KEY}`.

**Env:** `GEMINI_API_KEY` (already defined in `server/lib/env.ts`)

### 6.4 OpenRouter Adapter

**File:** `server/services/providers/openrouterAdapter.ts` (new file)

**API:** `POST https://openrouter.ai/api/v1/chat/completions` — **OpenAI-compatible format**.

This adapter reuses the OpenAI message/tool format with three differences:

1. **Base URL:** `https://openrouter.ai/api/v1` instead of `https://api.openai.com/v1`
2. **Auth header:** `Authorization: Bearer {OPENROUTER_API_KEY}`
3. **Extra headers:** `HTTP-Referer` and `X-Title` for OpenRouter analytics

**Implementation approach:** Extract the OpenAI adapter's message transformation into a shared utility (`openaiFormat.ts`), then both `openaiAdapter` and `openrouterAdapter` reuse it with different base URLs and auth.

**Env:** Add `OPENROUTER_API_KEY: z.string().optional()` to `server/lib/env.ts`

### 6.5 Provider Registry Update

**File:** `server/services/providers/registry.ts`

```typescript
import openrouterAdapter from './openrouterAdapter.js';

const registry: Record<string, LLMProviderAdapter> = {
  anthropic:   anthropicAdapter,
  openai:      openaiAdapter,
  gemini:      geminiAdapter,
  openrouter:  openrouterAdapter,  // NEW
};
```

### 6.6 Model Selection is Now Provider + Model

When configuring an agent, the user selects:
1. **Provider** (Anthropic, OpenAI, Gemini, OpenRouter)
2. **Model** (filtered list based on selected provider)

This maps to the existing `agents.modelProvider` and `agents.modelId` columns — no schema change needed for this part.

The UI change: the model dropdown becomes a two-step picker (provider first, then model). The available models per provider come from the model registry (section 3.7).

### 6.7 Fallback Chain Update

**File:** `server/config/limits.ts`

```typescript
// Updated fallback chain — OpenRouter added as final fallback
export const PROVIDER_FALLBACK_CHAIN = ['anthropic', 'openai', 'gemini', 'openrouter'] as const;
```

**Fallback model mapping update:**

```typescript
// server/services/llmRouter.ts

const FALLBACK_MODEL_MAP: Record<string, Record<string, string>> = {
  openai: {
    'claude-sonnet-4-6':  'gpt-4o',
    'claude-haiku-4-5':   'gpt-4o-mini',
    'claude-opus-4-6':    'gpt-4o',
  },
  gemini: {
    'claude-sonnet-4-6':  'gemini-2.0-flash',
    'claude-haiku-4-5':   'gemini-2.0-flash-lite',
    'claude-opus-4-6':    'gemini-2.0-flash',
  },
  openrouter: {
    'claude-sonnet-4-6':  'anthropic/claude-sonnet-4-6',
    'claude-haiku-4-5':   'anthropic/claude-haiku-4-5',
    'claude-opus-4-6':    'anthropic/claude-opus-4-6',
    'gpt-4o':             'openai/gpt-4o',
    'gpt-4o-mini':        'openai/gpt-4o-mini',
  },
};
```

**Note:** OpenRouter model IDs use `provider/model` format. The adapter handles this transparently.

---

## 7. Schema Changes & Migration

### 7.1 `llm_requests` Table — New Columns

**File:** `server/db/schema/llmRequests.ts`

Add three columns to the append-only ledger:

```typescript
// After existing 'taskType' column:
executionPhase:    text('execution_phase').notNull().default('planning'),
// 'planning' | 'execution' | 'synthesis'

capabilityTier:    text('capability_tier').notNull().default('frontier'),
// 'frontier' | 'economy'

wasDowngraded:     boolean('was_downgraded').notNull().default(false),
// true if resolver selected economy tier instead of frontier
```

Add index for phase-based analytics:

```typescript
// In the indexes section:
executionPhaseIdx: index('llm_requests_execution_phase_idx')
  .on(table.executionPhase, table.billingMonth),
```

**Note:** `iterationNumber` is NOT added to the schema now. It can be derived from run-level analysis if needed later. Keeps the ledger lean.

### 7.2 `TASK_TYPES` and `EXECUTION_PHASES` Constants

**File:** `server/db/schema/llmRequests.ts`

```typescript
// Existing — unchanged
export const TASK_TYPES = [
  'qa_validation', 'development', 'memory_compile', 'process_trigger',
  'search', 'handoff', 'scheduling', 'review', 'general',
] as const;

// NEW — execution phases for routing
export const EXECUTION_PHASES = ['planning', 'execution', 'synthesis'] as const;
export type ExecutionPhase = typeof EXECUTION_PHASES[number];

// NEW — capability tiers
export const CAPABILITY_TIERS = ['frontier', 'economy'] as const;
export type CapabilityTier = typeof CAPABILITY_TIERS[number];

// NEW — routing modes
export const ROUTING_MODES = ['ceiling', 'forced'] as const;
export type RoutingMode = typeof ROUTING_MODES[number];
```

### 7.3 Model Registry Configuration

**New file:** `server/config/modelRegistry.ts`

This is the single source of truth for what models are available and their capabilities. It is NOT a database table — it's a static config that changes with code deploys. Models change infrequently; a config file is simpler and faster than a DB lookup.

```typescript
import type { CapabilityTier } from '../db/schema/llmRequests.js';

export interface ModelCapability {
  provider:              string;
  model:                 string;
  tier:                  CapabilityTier;
  supportsToolCalling:   boolean;
  maxContextTokens:      number;
  approxInputCostPer1K:  number;   // $ per 1K tokens (for sorting only)
  approxOutputCostPer1K: number;   // $ per 1K tokens (for sorting only)
}

// ── Frontier models (used for planning + synthesis) ──────────────────

const FRONTIER_MODELS: ModelCapability[] = [
  {
    provider: 'anthropic', model: 'claude-opus-4-6', tier: 'frontier',
    supportsToolCalling: true, maxContextTokens: 200000,
    approxInputCostPer1K: 0.015, approxOutputCostPer1K: 0.075,
  },
  {
    provider: 'anthropic', model: 'claude-sonnet-4-6', tier: 'frontier',
    supportsToolCalling: true, maxContextTokens: 200000,
    approxInputCostPer1K: 0.003, approxOutputCostPer1K: 0.015,
  },
  {
    provider: 'openai', model: 'gpt-4o', tier: 'frontier',
    supportsToolCalling: true, maxContextTokens: 128000,
    approxInputCostPer1K: 0.0025, approxOutputCostPer1K: 0.01,
  },
];

// ── Economy models (used for execution phase) ────────────────────────

const ECONOMY_MODELS: ModelCapability[] = [
  {
    provider: 'gemini', model: 'gemini-2.0-flash', tier: 'economy',
    supportsToolCalling: true, maxContextTokens: 1000000,
    approxInputCostPer1K: 0.0001, approxOutputCostPer1K: 0.0004,
  },
  {
    provider: 'openai', model: 'gpt-4o-mini', tier: 'economy',
    supportsToolCalling: true, maxContextTokens: 128000,
    approxInputCostPer1K: 0.00015, approxOutputCostPer1K: 0.0006,
  },
  {
    provider: 'anthropic', model: 'claude-haiku-4-5', tier: 'economy',
    supportsToolCalling: true, maxContextTokens: 200000,
    approxInputCostPer1K: 0.00025, approxOutputCostPer1K: 0.00125,
  },
  {
    provider: 'openrouter', model: 'arcee-ai/trinity-large-thinking', tier: 'economy',
    supportsToolCalling: true, maxContextTokens: 128000,
    approxInputCostPer1K: 0.0003, approxOutputCostPer1K: 0.0009,
  },
  {
    provider: 'openrouter', model: 'deepseek/deepseek-r1', tier: 'economy',
    supportsToolCalling: false, maxContextTokens: 64000,
    approxInputCostPer1K: 0.00014, approxOutputCostPer1K: 0.00042,
  },
];

// ── Public API ──────────────────────────────────────────────────────

export function getEconomyModels(): ModelCapability[] {
  return [...ECONOMY_MODELS];
}

export function getFrontierModels(): ModelCapability[] {
  return [...FRONTIER_MODELS];
}

export function getAllModels(): ModelCapability[] {
  return [...FRONTIER_MODELS, ...ECONOMY_MODELS];
}

export function getModelsForProvider(provider: string): ModelCapability[] {
  return getAllModels().filter(m => m.provider === provider);
}
```

### 7.4 Config Changes

**File:** `server/config/limits.ts`

```typescript
// REMOVE:
// export const EXTRACTION_MODEL = 'claude-sonnet-4-6';
// (Absorbed into the resolver — extraction calls now pass executionPhase: 'execution'
// and the resolver picks the cheapest economy model)

// UPDATE:
export const PROVIDER_FALLBACK_CHAIN = ['anthropic', 'openai', 'gemini', 'openrouter'] as const;
```

**File:** `server/lib/env.ts`

```typescript
// ADD:
OPENROUTER_API_KEY: z.string().optional(),
```

### 7.5 Pricing Service Update

**File:** `server/services/pricingService.ts`

Add failsafe pricing for new models:

```typescript
const FAILSAFE_PRICING: Record<string, { inputRate: number; outputRate: number }> = {
  // Existing
  'anthropic:claude-opus-4-6':          { inputRate: 0.015,    outputRate: 0.075    },
  'anthropic:claude-sonnet-4-6':        { inputRate: 0.003,    outputRate: 0.015    },
  'anthropic:claude-haiku-4-5':         { inputRate: 0.00025,  outputRate: 0.00125  },
  'openai:gpt-4o':                      { inputRate: 0.0025,   outputRate: 0.01     },
  'openai:gpt-4o-mini':                 { inputRate: 0.00015,  outputRate: 0.0006   },
  'gemini:gemini-2.0-flash':            { inputRate: 0.0001,   outputRate: 0.0004   },
  // NEW
  'gemini:gemini-2.0-flash-lite':       { inputRate: 0.00005,  outputRate: 0.0002   },
  'openrouter:arcee-ai/trinity-large-thinking':  { inputRate: 0.0003,  outputRate: 0.0009  },
  'openrouter:deepseek/deepseek-r1':    { inputRate: 0.00014,  outputRate: 0.00042  },
  'openrouter:anthropic/claude-sonnet-4-6': { inputRate: 0.003, outputRate: 0.015   },
  '__default__':                        { inputRate: 0.015,    outputRate: 0.075    },
};
```

### 7.6 DB Migration

**New migration file** via Drizzle:

```sql
ALTER TABLE llm_requests
  ADD COLUMN execution_phase text NOT NULL DEFAULT 'planning',
  ADD COLUMN capability_tier text NOT NULL DEFAULT 'frontier',
  ADD COLUMN was_downgraded boolean NOT NULL DEFAULT false;

CREATE INDEX llm_requests_execution_phase_idx
  ON llm_requests (execution_phase, billing_month);
```

**Seed `llm_pricing` table** with rows for new provider/model combinations so `pricingService.getPricing()` returns real rates instead of failsafe.

### 7.7 Cost Aggregates Update

**File:** `server/db/schema/costAggregates.ts`

Add `execution_phase` as a new entity type for aggregation:

```typescript
// In the entity_type enum/check:
// Existing: 'organisation' | 'subaccount' | 'run' | 'agent' | 'task_type' | 'provider' | 'platform'
// Add: 'execution_phase'
```

This enables dashboard queries like: "How much did we spend on `execution` phase calls this month?"

**File:** `server/services/routerJobService.ts`

Add an aggregate upsert for the `execution_phase` dimension in the `llm-aggregate-update` job handler.

---

## 8. Call-Site Changes (Complete Diff Summary)

Every `routeCall()` invocation changes to pass `executionPhase` instead of (or alongside) hardcoded `provider`/`model`. The router resolves the actual provider+model.

### 8.1 `agentExecutionService.ts`

**Main loop call (line 875):**

```typescript
// BEFORE:
context: { ...routerCtx, taskType: 'development', provider: agent.modelProvider, model: agent.modelId },

// AFTER:
context: {
  ...routerCtx,
  taskType: 'development',
  executionPhase: phase,                          // derived from iteration logic (section 4.1)
  provider: agent.modelProvider,                  // ceiling
  model: agent.modelId,                           // ceiling
  routingMode: agent.allowModelOverride ? 'ceiling' : 'forced',
},
```

**Wrap-up calls (lines 855, 926):**

```typescript
// BEFORE:
context: { ...routerCtx, taskType: 'general', provider: agent.modelProvider, model: agent.modelId },

// AFTER:
context: {
  ...routerCtx,
  taskType: 'general',
  executionPhase: 'synthesis',                    // always synthesis for wrap-ups
  provider: agent.modelProvider,
  model: agent.modelId,
  routingMode: 'ceiling',
},
```

**New variable before the loop:**

```typescript
let previousResponseHadToolCalls = false;
```

**After routeCall response (after line 882):**

```typescript
previousResponseHadToolCalls = !!(response.toolCalls && response.toolCalls.length > 0);
```

### 8.2 `conversationService.ts`

**Initial response (line 246):**

```typescript
// BEFORE:
context: { organisationId, userId, sourceType: 'agent_run', agentName: agent.name,
  taskType: 'general', provider: agent.modelProvider ?? 'anthropic', model: agent.modelId },

// AFTER:
context: { organisationId, userId, sourceType: 'agent_run', agentName: agent.name,
  taskType: 'general', executionPhase: 'planning',
  provider: agent.modelProvider ?? 'anthropic', model: agent.modelId, routingMode: 'ceiling' },
```

**Post-tool continuation (line 361):**

```typescript
// BEFORE:
context: { organisationId, userId, sourceType: 'agent_run', agentName: agent.name,
  taskType: 'process_trigger', provider: agent.modelProvider ?? 'anthropic', model: agent.modelId },

// AFTER:
context: { organisationId, userId, sourceType: 'agent_run', agentName: agent.name,
  taskType: 'process_trigger', executionPhase: 'synthesis',
  provider: agent.modelProvider ?? 'anthropic', model: agent.modelId, routingMode: 'ceiling' },
```

### 8.3 `workspaceMemoryService.ts`

**All 4 call sites (lines 173, 331, 535, 770):**

```typescript
// BEFORE:
provider: 'anthropic',
model: EXTRACTION_MODEL,

// AFTER:
executionPhase: 'execution',
// provider and model OMITTED — resolver picks cheapest economy model
// No ceiling needed — these are internal calls with no quality ceiling requirement
routingMode: 'ceiling',
```

### 8.4 `outcomeLearningService.ts`

**Line 101:**

```typescript
// BEFORE:
provider: 'anthropic',
model: EXTRACTION_MODEL,

// AFTER:
executionPhase: 'execution',
routingMode: 'ceiling',
```

### 8.5 `llmRouter.ts` — `routeCall()` Internal Changes

1. Update `LLMCallContextSchema` — make `provider`/`model` optional, add `executionPhase`, `routingMode`
2. Insert `resolveLLM()` call after validation (section 5.3)
3. Use `effectiveProvider`/`effectiveModel` throughout the rest of the function
4. Write `executionPhase`, `capabilityTier`, `wasDowngraded` to the `llm_requests` insert
5. Update idempotency key generation to use `effectiveProvider`/`effectiveModel`

---

## 9. Implementation Order

Five phases, each independently deployable and testable. Each phase delivers value on its own.

### Phase 1: Core Types + Resolver + Schema Migration
**Est. effort:** Small
**Files touched:** 4 new/modified

| Step | File | Change |
|------|------|--------|
| 1a | `server/db/schema/llmRequests.ts` | Add `EXECUTION_PHASES`, `CAPABILITY_TIERS`, `ROUTING_MODES` constants and types. Add 3 columns to `llmRequests` table definition. |
| 1b | `server/config/modelRegistry.ts` | **New file.** Static model registry with capabilities and cost rates. |
| 1c | `server/services/llmResolver.ts` | **New file.** `resolveLLM()` function implementing the algorithm from section 5.2. |
| 1d | DB migration | Generate and run Drizzle migration for the 3 new columns + index. |

**Verification:** Unit tests for `resolveLLM()` — test all phase/mode/constraint combinations. Verify migration runs cleanly.

### Phase 2: Router Integration + Call-Site Updates
**Est. effort:** Medium
**Files touched:** 5 modified

| Step | File | Change |
|------|------|--------|
| 2a | `server/services/llmRouter.ts` | Update `LLMCallContextSchema`, insert resolver call, use effective provider/model, write new fields to ledger. |
| 2b | `server/services/agentExecutionService.ts` | Add `previousResponseHadToolCalls` tracking, compute `phase` per iteration, pass `executionPhase` + `routingMode` in all 3 `routeCall()` contexts. |
| 2c | `server/services/conversationService.ts` | Add `executionPhase` to both `routeCall()` contexts. |
| 2d | `server/services/workspaceMemoryService.ts` | Replace `provider`/`model` with `executionPhase: 'execution'` on all 4 call sites. |
| 2e | `server/services/outcomeLearningService.ts` | Replace `provider`/`model` with `executionPhase: 'execution'`. |

**Verification:**
- Deploy with only Anthropic configured → all `execution` phase calls route to Haiku, all `planning`/`synthesis` stay on Sonnet.
- Run a full agent loop, inspect `llm_requests` ledger: verify `execution_phase`, `capability_tier`, `was_downgraded` columns are populated correctly.
- Verify `forced` mode prevents downgrade for agents with `allowModelOverride: false`.
- Verify safety fallback: if no economy model satisfies constraints, ceiling model is used.

### Phase 3: OpenAI + Gemini Adapters
**Est. effort:** Medium
**Files touched:** 4 modified, 1 new

| Step | File | Change |
|------|------|--------|
| 3a | `server/services/providers/openaiAdapter.ts` | Full implementation — message translation, tool mapping, error handling. |
| 3b | `server/services/providers/openaiFormat.ts` | **New file.** Shared OpenAI-format message/tool translation utilities. |
| 3c | `server/services/providers/geminiAdapter.ts` | Full implementation — Gemini-specific message/tool mapping. |
| 3d | `server/services/pricingService.ts` | Add failsafe pricing for new models. |
| 3e | Seed migration | Insert `llm_pricing` rows for OpenAI + Gemini models. |

**Verification:**
- Set `OPENAI_API_KEY` in env, run agent loop → verify OpenAI calls succeed, tokens/cost tracked correctly.
- Set `GEMINI_API_KEY` in env, run agent loop → verify Gemini calls succeed.
- Test tool-calling through both adapters — verify tool calls + results round-trip correctly.
- Test fallback: disable Anthropic API key → verify fallback to OpenAI → Gemini works.

### Phase 4: OpenRouter Adapter
**Est. effort:** Small
**Files touched:** 3 modified, 1 new

| Step | File | Change |
|------|------|--------|
| 4a | `server/services/providers/openrouterAdapter.ts` | **New file.** Reuses OpenAI format utilities with OpenRouter base URL + auth. |
| 4b | `server/services/providers/registry.ts` | Register `openrouter` adapter. |
| 4c | `server/lib/env.ts` | Add `OPENROUTER_API_KEY`. |
| 4d | `server/config/limits.ts` | Add `'openrouter'` to `PROVIDER_FALLBACK_CHAIN`. |

**Verification:**
- Set `OPENROUTER_API_KEY`, configure an agent with `modelProvider: 'openrouter'`, `modelId: 'arcee-ai/trinity-large-thinking'`.
- Verify calls succeed and cost tracking works.
- Verify economy resolver can select OpenRouter models for execution phase.

### Phase 5: Config Cleanup + Analytics
**Est. effort:** Small
**Files touched:** 3 modified

| Step | File | Change |
|------|------|--------|
| 5a | `server/config/limits.ts` | Remove `EXTRACTION_MODEL` constant (now handled by resolver). |
| 5b | `server/services/routerJobService.ts` | Add `execution_phase` dimension to aggregate upserts. |
| 5c | `server/db/schema/costAggregates.ts` | Add `'execution_phase'` to entity type. |

**Verification:**
- Query cost aggregates by execution phase — verify `execution` phase shows economy-tier costs.
- Compare: total cost this month vs projected cost without routing (all frontier) → confirm savings %.

---

## 10. What This Spec Excludes (Explicitly)

These are not in scope. Documented here to prevent scope creep:

| Excluded | Reason |
|----------|--------|
| Prompt-based complexity scoring | System-aware signals are stronger; keyword matching adds no value |
| LLM-based routing | Adds cost and latency to every call — defeats the purpose |
| Org-level tier configuration | Users don't choose tiers; the system routes intelligently |
| Latency-aware routing | Future enhancement — not needed for v1 |
| Provider health scoring | Existing cooldown system handles outages adequately |
| `iterationNumber` on `llm_requests` | Can be derived from run-level analysis later if needed |
| UI for model registry management | Static config file is sufficient; models change infrequently |
| Streaming support across providers | Out of scope — current system uses non-streaming calls |

---

## 11. Risk Assessment

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Economy model produces bad tool calls | Medium | Tool-calling guard filters out non-capable models. Monitor error rates by tier post-deploy. |
| Economy model misinterprets tool results | Low | Tool results are structured JSON — parsing is mechanical. Haiku/Flash handle this well. |
| Synthesis on economy model (edge case miss) | Low | Phase detection has explicit fallback to `planning` (frontier). Safety fallback in resolver returns ceiling. |
| OpenRouter rate limits or downtime | Medium | It's last in the fallback chain. Platform works without it. |
| Pricing drift (model costs change) | Low | Failsafe pricing uses most expensive known rates. DB pricing is authoritative when available. |
| `forced` mode forgotten on critical agents | Low | Derived from existing `allowModelOverride` flag — no new config to forget. |

---

## 12. Success Metrics

Post-deployment, measure:

1. **Cost per agent run** — before vs after (target: 60-70% reduction)
2. **% of calls on economy tier** — should be ~58% (7 of 12 call patterns)
3. **Error rate by tier** — economy tier should not have meaningfully higher error rates
4. **`wasDowngraded` rate** — visibility into how often routing triggers
5. **Cost by execution phase** — planning + synthesis should be ~30-40% of total cost despite being frontier
6. **Agent output quality** — no degradation in user-facing outputs (synthesis phase stays frontier)
