# LLM Cost Optimisation: Adaptive Intelligence Routing (v2)

**Status:** Spec — awaiting review
**Date:** 2026-04-04
**Classification:** Significant (multi-domain, new patterns, design decisions)
**Supersedes:** `llm-cost-optimisation-spec.md` (v1)

---

## 1. Problem Statement

Every LLM call in Automation OS currently uses the agent's configured model (default: `claude-sonnet-4-6`) regardless of cognitive demand. A simple "parse this JSON tool result" call costs the same as a complex planning call. At scale, this is unsustainable.

**Current state:**
- 12 `routeCall()` call sites across 5 services
- All use the agent's configured model statically
- 7 of 12 calls are low-complexity (extraction, tool-result parsing, summaries)
- Only Anthropic adapter is implemented; OpenAI and Gemini are stubs
- No prompt caching — system prompts and tools re-sent on every iteration
- No dynamic model selection exists

**Target state:**
- Prompt caching active on all providers (highest single impact)
- Every LLM call routed to the cheapest model that can do the job
- Routing is deterministic and system-aware (not prompt-aware)
- Four providers available: Anthropic, OpenAI, Gemini, OpenRouter
- Agent config sets the **ceiling**, not the constant
- Lightweight cascade validation catches economy model failures
- Full cost analytics by execution phase

**Estimated cost reduction:**
- Initial (Anthropic-only routing + caching): **30-50%**
- Full system (cross-provider routing + caching + cascade): **60-70%**

---

## 2. Core Mental Model

We are NOT routing requests to models.

We are routing **execution phases** to **capability tiers**, which resolve to **provider + model**.

```
ExecutionPhase  →  CapabilityTier  →  Provider + Model
(deterministic)    (simple map)       (resolver with fallbacks)
```

Three layers of cost reduction that stack multiplicatively:

1. **Caching** → reduces cost per call (50-90% input token savings)
2. **Routing** → reduces cost per decision (use cheap models for cheap work)
3. **Escalation** → protects correctness (catch economy model failures before they propagate)

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
- **`economy`**: Cheapest model that satisfies constraints (tool-calling reliability, context window). Used for execution.

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
    requiresToolCalling?: boolean;         // derived from params.tools presence
    requiresStructuredOutput?: boolean;    // future-proofing, minimal cost
    estimatedContextTokens?: number;       // accumulated tokens so far
    expectedMaxOutputTokens?: number;      // maxTokens for this call
  };
}

export type ResolveLLMReason =
  | 'forced'              // routing mode was forced
  | 'ceiling'             // frontier tier, returned ceiling model
  | 'economy'             // economy tier, returned cheapest candidate
  | 'fallback';           // no candidates matched, fell back to ceiling
  // NOTE: 'escalated' is NOT a resolver reason — escalation happens in the agent loop
  // after the resolver runs. Tracked separately via wasEscalated + escalationReason on the ledger.

export interface ResolveLLMResult {
  provider:       string;
  model:          string;
  tier:           CapabilityTier;
  wasDowngraded:  boolean;
  reason:         ResolveLLMReason;
}
```

### 3.5 Iteration Hint

Passed from the agent loop to enable phase detection inside `routeCall()`:

```typescript
export interface IterationHint {
  iteration:                     number;
  previousResponseHadToolCalls:  boolean;
  hasToolResults:                boolean;
  totalToolCalls:                number;
  estimatedTotalTokensSoFar:     number;   // running count for context window guard
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

### 3.7 Model Registry

```typescript
// server/config/modelRegistry.ts

export type ToolCallingReliability = 'stable' | 'experimental' | 'none';

export interface ModelCapability {
  provider:               string;
  model:                  string;
  tier:                   CapabilityTier;
  toolCallingReliability: ToolCallingReliability;
  maxContextTokens:       number;
  supportsPromptCaching:  boolean;
  deprecationDate?:       string;            // ISO date — triggers startup warning within 30 days
  // Cost per 1K tokens (used for tier sorting, not billing — billing uses pricingService)
  approxInputCostPer1K:   number;
  approxOutputCostPer1K:  number;
}
```

### 3.8 ProviderResponse Update

```typescript
// server/services/providers/types.ts — add to ProviderResponse

export interface ProviderResponse {
  // ... existing fields ...
  cachedPromptTokens?: number;   // tokens served from cache (Anthropic, OpenAI, Gemini)

  // Routing metadata — set by routeCall(), consumed by agent loop for escalation decisions
  routing?: {
    tier:           CapabilityTier;
    wasDowngraded:  boolean;
    reason:         ResolveLLMReason;
  };
}
```

The `routing` field is populated by `routeCall()` (not by provider adapters). This makes routing decisions visible to callers without leaking resolver internals. The agent loop uses `response.routing?.wasDowngraded` to decide whether to run tool call validation.

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
      reason: 'forced',
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
      reason: 'ceiling',
    };
  }

  // ── 4. Economy tier — find cheapest capable model ──────────────────
  let candidates = getEconomyModels();

  // Filter: tool-calling capability (stable or experimental, exclude 'none')
  if (constraints?.requiresToolCalling) {
    candidates = candidates.filter(m => m.toolCallingReliability !== 'none');
  }

  // Filter: context window — candidate must fit accumulated context + expected output
  const estimatedContext = constraints?.estimatedContextTokens ?? 0;
  const expectedOutput = constraints?.expectedMaxOutputTokens ?? 4096;  // default if not specified
  if (estimatedContext > 0) {
    const requiredWindow = estimatedContext + expectedOutput;
    candidates = candidates.filter(m => m.maxContextTokens >= requiredWindow);
  }

  // Sort by cost (cheapest first — output rate dominates total cost)
  // Within same cost, prefer 'stable' tool calling over 'experimental'
  candidates.sort((a, b) => {
    const costDiff = a.approxOutputCostPer1K - b.approxOutputCostPer1K;
    if (Math.abs(costDiff) > 0.0001) return costDiff;
    const reliabilityOrder = { stable: 0, experimental: 1, none: 2 };
    return reliabilityOrder[a.toolCallingReliability] - reliabilityOrder[b.toolCallingReliability];
  });

  // ── 5. Safety fallback — if no candidates, use ceiling ────────────
  if (candidates.length === 0) {
    return {
      provider: ceiling?.provider ?? 'anthropic',
      model:    ceiling?.model ?? 'claude-sonnet-4-6',
      tier:     'frontier',
      wasDowngraded: false,
      reason: 'fallback',
    };
  }

  // ── 6. Return cheapest candidate ──────────────────────────────────
  const selected = candidates[0];

  // Debug log — one line, saves hours in production
  console.debug(`[resolver] phase=${phase} → ${selected.provider}/${selected.model} (reason=economy)`);

  return {
    provider:      selected.provider,
    model:         selected.model,
    tier:          'economy',
    wasDowngraded: true,
    reason:        'economy',
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

  // ── 1b. Global kill switch — forces frontier on everything ──────────
  //        Takes precedence over shadow mode and resolver.
  //        "System behaves as if routing never existed."
  if (env.ROUTER_FORCE_FRONTIER) {
    const effectiveProvider = ctx.provider ?? 'anthropic';
    const effectiveModel = ctx.model ?? 'claude-sonnet-4-6';
    // Proceed directly to step 2 with ceiling values.
    // Skip resolver, skip shadow mode, skip escalation.
    // Attach routing metadata so callers know no downgrade occurred:
    // response.routing = { tier: 'frontier', wasDowngraded: false, reason: 'forced' }
  }

  // ── 1c. Resolve provider + model from execution phase ─────────────
  const resolved = resolveLLM({
    phase:       ctx.executionPhase,
    taskType:    ctx.taskType,
    ceiling:     (ctx.provider && ctx.model) ? { provider: ctx.provider, model: ctx.model } : undefined,
    mode:        ctx.routingMode ?? 'ceiling',
    constraints: {
      requiresToolCalling: !!(params.tools && params.tools.length > 0),
      estimatedContextTokens: params.estimatedContextTokens,
      expectedMaxOutputTokens: params.maxTokens,
    },
  });

  // ── 1d. Shadow mode — log resolution but use ceiling ───────────────
  if (env.ROUTER_SHADOW_MODE) {
    // Log what would have been used, but actually use the ceiling
    console.info('[llmRouter] shadow:', JSON.stringify({
      wouldUse: { provider: resolved.provider, model: resolved.model, tier: resolved.tier },
      actuallyUsing: { provider: ctx.provider, model: ctx.model },
      reason: resolved.reason,
    }));
    // Override to ceiling
    resolved.provider = ctx.provider ?? 'anthropic';
    resolved.model = ctx.model ?? 'claude-sonnet-4-6';
    resolved.tier = 'frontier';
    resolved.wasDowngraded = false;
    resolved.reason = 'ceiling';
  }

  // Use resolved values for the rest of the flow
  const effectiveProvider = resolved.provider;
  const effectiveModel    = resolved.model;

  // ── 2. Check provider is registered ────────────────────────────────
  const adapter = getProviderAdapter(effectiveProvider);

  // ... rest of routeCall uses effectiveProvider/effectiveModel
  // ... resolved.tier, resolved.wasDowngraded, resolved.reason written to llm_requests record
  // ... attach routing metadata to response for caller visibility:
  //     providerResponse.routing = { tier: resolved.tier, wasDowngraded: resolved.wasDowngraded, reason: resolved.reason }
}
```

### 5.4 What the Resolver Does NOT Do

- No prompt inspection or keyword scoring
- No LLM calls for classification
- No latency-aware routing (future)
- No provider health scoring (future — but the existing cooldown system handles outages)
- No cost estimation within the resolver (that stays in pricingService)

---

## 6. Cascade Escalation & Tool Call Validation

### 6.1 The Risk

Economy models have documented tool-calling failure modes:
- **GPT-4o-mini:** Confabulates arguments, picks wrong tools, hallucinated ENUM values (BFCL: 78.8%)
- **Gemini Flash:** Outputs markdown instead of tool calls after several interactions
- **Claude Haiku 4.5:** Drops to 42% on multi-turn tool calling in complex scenarios

If an economy model has a 5% error rate per step and an agent loop runs 10 steps, the probability of a fully correct run is ~60%. Without validation, bad tool calls propagate into real side effects.

### 6.2 Lightweight Validation (before tool execution)

**Location:** `server/services/agentExecutionService.ts` — after receiving response from economy model, before passing tool calls to `skillExecutor`.

Validation checks (in order):

1. **Tool name exists** — is the tool name in the active tool set for this agent?
2. **Arguments parse as JSON** — does `JSON.parse(toolCall.input)` succeed?
3. **Required fields present** — do the required fields from the tool's `input_schema` exist in the parsed arguments?
4. **Unexpected fields (log-only)** — if argument keys exist that are not in `input_schema.properties`, log a warning. Do NOT fail — economy models commonly hallucinate extra params that are harmless (the skill executor ignores them), but the log gives debugging value.

```typescript
function validateToolCalls(
  toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }>,
  activeTools: ProviderTool[],
): { valid: boolean; failureReason?: string } {
  const toolNames = new Set(activeTools.map(t => t.name));

  for (const tc of toolCalls) {
    // 1. Tool name must exist
    if (!toolNames.has(tc.name)) {
      return { valid: false, failureReason: `unknown_tool:${tc.name}` };
    }

    // 2. Input must be a valid object (already parsed by provider adapter, but guard)
    if (tc.input === null || typeof tc.input !== 'object') {
      return { valid: false, failureReason: `invalid_input:${tc.name}` };
    }

    // 3. Required fields must be present
    const toolDef = activeTools.find(t => t.name === tc.name);
    if (toolDef?.input_schema?.required) {
      for (const field of toolDef.input_schema.required) {
        if (!(field in tc.input)) {
          return { valid: false, failureReason: `missing_field:${tc.name}.${field}` };
        }
      }
    }

    // 4. Unexpected fields — log-only, do not fail
    if (toolDef?.input_schema?.properties) {
      const knownFields = new Set(Object.keys(toolDef.input_schema.properties));
      const extraFields = Object.keys(tc.input).filter(k => !knownFields.has(k));
      if (extraFields.length > 0) {
        console.warn(`[toolCallValidator] unexpected fields in ${tc.name}: ${extraFields.join(', ')}`);
      }
    }
  }

  return { valid: true };
}
```

### 6.3 Escalation Flow

When validation fails on an economy model response:

```
1. Economy model returns tool calls
2. validateToolCalls() fails
3. Guard: if escalationAttempted → do NOT retry (prevents double execution)
4. Re-call routeCall() with:
   - Same messages/system/tools
   - routingMode: 'forced' (force ceiling model — skips all resolver filtering
     including context window guard, which is safe because forced mode returns
     the ceiling model directly)
5. Use frontier response instead
6. Record: wasEscalated = true, escalationReason = failureReason
```

**Important:** Escalation is tracked separately from resolver routing. The resolver never returns `reason: 'escalated'` — it returns `'economy'` on the first call. Escalation happens after the resolver, in the agent loop, when validation fails. This keeps clean attribution between routing decisions and execution failures.

**Location in agent loop:**

```typescript
// Inside the loop body, at the top of each iteration (resets per iteration):
let escalationAttempted = false;

// After routeCall at line 875:
const response = await routeCall({ /* economy model */ });

// Skip validation entirely if kill switch is active (no economy model in play)
// If economy model was used and returned tool calls, validate
if (!env.ROUTER_FORCE_FRONTIER && response.routing?.wasDowngraded && response.toolCalls?.length && !escalationAttempted) {
  const validation = validateToolCalls(response.toolCalls, tools);

  if (!validation.valid) {
    escalationAttempted = true;  // prevent recursive retries

    // Escalate: retry with ceiling model (forced mode bypasses all resolver filtering)
    const escalatedResponse = await routeCall({
      ...params,
      context: { ...params.context, routingMode: 'forced' },
    });
    // Use escalated response, track the escalation
    wasEscalated = true;
    escalationReason = validation.failureReason;
    // response = escalatedResponse for the rest of the loop
  }
}
```

**Scope:** `escalationAttempted` is declared inside the loop body (not before it), so it resets to `false` on each iteration. Each iteration gets exactly one escalation chance. This prevents cascade-of-cascades while still allowing escalation on different iterations.

**Kill switch:** When `ROUTER_FORCE_FRONTIER=true`, the validation + escalation block is skipped entirely. The kill switch means "system behaves as if routing never existed" — no economy models, no validation, no escalation.

### 6.4 What This Does NOT Do

- No full JSON Schema validation of argument types (skill executor handles type mismatches)
- No retry loops — exactly one escalation attempt per iteration
- No learning/adaptation — if escalation rate is high for a model, remove it from the registry manually
- No escalation for non-tool-calling responses (text-only responses from economy models are fine)
- No double execution — `escalationAttempted` guard prevents recursive retries

### 6.5 Monitoring

Track in the `llm_requests` ledger:
- `wasEscalated: boolean` — did this call require frontier retry?
- `escalationReason: text` — what validation check failed? (`unknown_tool:X`, `missing_field:X.Y`, `invalid_input:X`)

**Alert threshold:** If escalation rate exceeds 15% for any economy model over a rolling 24h window, investigate and consider removing that model from the economy tier.

---

## 7. Prompt Caching (Phase 0 — Implement First)

This is the single highest-impact optimisation. Every iteration of the agent loop re-sends the full system prompt, all tool definitions, and growing conversation history. In a 10-iteration loop, the system prompt is sent 10 times. Caching converts 9 of those 10 sends to cheap cache reads.

### 7.1 Anthropic Caching

**Discount:** Cache reads cost 10% of standard input price (90% savings on cached tokens).

**Implementation in `anthropicAdapter.ts`:**

Place `cache_control: { type: "ephemeral" }` breakpoints at stable content boundaries:

```typescript
// 1. System prompt — mark the end as cacheable
body.system = [
  { type: 'text', text: params.system, cache_control: { type: 'ephemeral' } },
];

// 2. Tool definitions — mark the last tool as cacheable
if (params.tools?.length) {
  const toolsCopy = [...params.tools];
  toolsCopy[toolsCopy.length - 1] = {
    ...toolsCopy[toolsCopy.length - 1],
    cache_control: { type: 'ephemeral' },
  };
  body.tools = toolsCopy;
}
```

**Extract cached token count from response:**

```typescript
// Anthropic response.usage includes:
// cache_creation_input_tokens — tokens written to cache (charged at 1.25x)
// cache_read_input_tokens — tokens served from cache (charged at 0.1x)
cachedPromptTokens: data.usage.cache_read_input_tokens ?? 0,
```

**Header update:** Add `'anthropic-beta': 'prompt-caching-2024-07-31'` to request headers (or use the latest stable version if caching has graduated from beta).

### 7.2 OpenAI Caching

**Discount:** 50% automatic caching on prompts over 1,024 tokens.

**Implementation:** Zero code changes required — OpenAI caches automatically. Just extract the cached count:

```typescript
// OpenAI response.usage includes:
// prompt_tokens_details.cached_tokens
cachedPromptTokens: data.usage?.prompt_tokens_details?.cached_tokens ?? 0,
```

### 7.3 Gemini Caching

**Discount:** 75-90% savings on cached inputs with explicit context caching.

**Implementation:** Use Gemini's explicit context caching API for system prompts and tool definitions when they exceed a threshold size. Gemini caching requires a separate `cachedContents.create` call with a TTL.

For v1, rely on Gemini's automatic internal caching (no explicit API). Track via `usageMetadata.cachedContentTokenCount` if available.

### 7.4 Cost Calculation Update

The `pricingService.calculateCost()` function needs to account for cached tokens:

```typescript
// Updated formula:
const inputCost =
  ((tokensIn - cachedPromptTokens) / 1000) * pricing.inputRate +   // uncached at full price
  (cachedPromptTokens / 1000) * pricing.inputRate * cacheReadMultiplier;  // cached at discount

// Cache read multipliers:
// Anthropic: 0.10 (90% discount)
// OpenAI: 0.50 (50% discount)
// Gemini: 0.25 (75% discount)
```

---

## 8. Provider Adapters

### 8.1 Architecture

All providers implement the existing `LLMProviderAdapter` interface. The only change is adding `cachedPromptTokens` to `ProviderResponse`:

```typescript
// server/services/providers/types.ts

export interface ProviderResponse {
  content:            string;
  toolCalls?:         Array<{ id: string; name: string; input: Record<string, unknown> }>;
  stopReason:         string;
  tokensIn:           number;
  tokensOut:          number;
  providerRequestId:  string;
  cachedPromptTokens?: number;   // NEW
}
```

### 8.2 OpenAI Adapter

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
| `response.cachedPromptTokens` | `usage.prompt_tokens_details.cached_tokens` |
| `response.stopReason` | `choices[0].finish_reason` |
| `response.providerRequestId` | `id` field or `x-request-id` header |

**Error handling:** Follow same pattern as Anthropic adapter — 503/529 → `PROVIDER_UNAVAILABLE`, 400/401/403 → non-retryable.

**Env:** `OPENAI_API_KEY` (already defined in `server/lib/env.ts`)

### 8.3 Gemini Adapter

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
| `response.cachedPromptTokens` | `usageMetadata.cachedContentTokenCount` |
| `response.stopReason` | `candidates[0].finishReason` |

**Auth:** API key passed as query parameter `?key={GEMINI_API_KEY}`.

**Important:** Use Gemini 2.5 Flash / 2.5 Flash-Lite (NOT 2.0 Flash — deprecated, shuts down June 1 2026).

**Env:** `GEMINI_API_KEY` (already defined in `server/lib/env.ts`)

### 8.4 OpenRouter Adapter

**File:** `server/services/providers/openrouterAdapter.ts` (new file)

**API:** `POST https://openrouter.ai/api/v1/chat/completions` — **OpenAI-compatible format**.

This adapter reuses the OpenAI message/tool format with three differences:

1. **Base URL:** `https://openrouter.ai/api/v1` instead of `https://api.openai.com/v1`
2. **Auth header:** `Authorization: Bearer {OPENROUTER_API_KEY}`
3. **Extra headers:** `HTTP-Referer` and `X-Title` for OpenRouter analytics

**Implementation approach:** Extract the OpenAI adapter's message transformation into a shared utility (`openaiFormat.ts`), then both `openaiAdapter` and `openrouterAdapter` reuse it with different base URLs and auth.

**Env:** Add `OPENROUTER_API_KEY: z.string().optional()` to `server/lib/env.ts`

### 8.5 Provider Registry Update

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

### 8.6 Model Selection is Now Provider + Model

When configuring an agent, the user selects:
1. **Provider** (Anthropic, OpenAI, Gemini, OpenRouter)
2. **Model** (filtered list based on selected provider)

This maps to the existing `agents.modelProvider` and `agents.modelId` columns — no schema change needed for this part.

### 8.7 Fallback Chain Update

**File:** `server/config/limits.ts`

```typescript
export const PROVIDER_FALLBACK_CHAIN = ['anthropic', 'openai', 'gemini', 'openrouter'] as const;
```

**Fallback model mapping update:**

```typescript
const FALLBACK_MODEL_MAP: Record<string, Record<string, string>> = {
  openai: {
    'claude-sonnet-4-6':  'gpt-4o',
    'claude-haiku-4-5':   'gpt-4o-mini',
    'claude-opus-4-6':    'gpt-4o',
  },
  gemini: {
    'claude-sonnet-4-6':  'gemini-2.5-flash',
    'claude-haiku-4-5':   'gemini-2.5-flash-lite',
    'claude-opus-4-6':    'gemini-2.5-flash',
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

---

## 9. Schema Changes & Migration

### 9.1 `llm_requests` Table — New Columns

**File:** `server/db/schema/llmRequests.ts`

Add six columns to the append-only ledger:

```typescript
// Routing metadata
executionPhase:      text('execution_phase').notNull().default('planning'),
capabilityTier:      text('capability_tier').notNull().default('frontier'),
wasDowngraded:       boolean('was_downgraded').notNull().default(false),
routingReason:       text('routing_reason'),

// Escalation tracking
wasEscalated:        boolean('was_escalated').notNull().default(false),
escalationReason:    text('escalation_reason'),

// Caching
cachedPromptTokens:  integer('cached_prompt_tokens').notNull().default(0),
```

Add index for phase-based analytics:

```typescript
executionPhaseIdx: index('llm_requests_execution_phase_idx')
  .on(table.executionPhase, table.billingMonth),
```

### 9.2 Constants

**File:** `server/db/schema/llmRequests.ts`

```typescript
// Existing — unchanged
export const TASK_TYPES = [
  'qa_validation', 'development', 'memory_compile', 'process_trigger',
  'search', 'handoff', 'scheduling', 'review', 'general',
] as const;

// NEW
export const EXECUTION_PHASES = ['planning', 'execution', 'synthesis'] as const;
export type ExecutionPhase = typeof EXECUTION_PHASES[number];

export const CAPABILITY_TIERS = ['frontier', 'economy'] as const;
export type CapabilityTier = typeof CAPABILITY_TIERS[number];

export const ROUTING_MODES = ['ceiling', 'forced'] as const;
export type RoutingMode = typeof ROUTING_MODES[number];
```

### 9.3 Model Registry

**New file:** `server/config/modelRegistry.ts`

Static config — not a DB table. Models change infrequently; code-level config is simpler and faster.

```typescript
const FRONTIER_MODELS: ModelCapability[] = [
  {
    provider: 'anthropic', model: 'claude-opus-4-6', tier: 'frontier',
    toolCallingReliability: 'stable', maxContextTokens: 200000,
    supportsPromptCaching: true,
    approxInputCostPer1K: 0.015, approxOutputCostPer1K: 0.075,
  },
  {
    provider: 'anthropic', model: 'claude-sonnet-4-6', tier: 'frontier',
    toolCallingReliability: 'stable', maxContextTokens: 200000,
    supportsPromptCaching: true,
    approxInputCostPer1K: 0.003, approxOutputCostPer1K: 0.015,
  },
  {
    provider: 'openai', model: 'gpt-4o', tier: 'frontier',
    toolCallingReliability: 'stable', maxContextTokens: 128000,
    supportsPromptCaching: true,
    approxInputCostPer1K: 0.0025, approxOutputCostPer1K: 0.01,
  },
];

const ECONOMY_MODELS: ModelCapability[] = [
  {
    provider: 'gemini', model: 'gemini-2.5-flash-lite', tier: 'economy',
    toolCallingReliability: 'stable', maxContextTokens: 1000000,
    supportsPromptCaching: true,
    approxInputCostPer1K: 0.0001, approxOutputCostPer1K: 0.0004,
  },
  {
    provider: 'openai', model: 'gpt-4o-mini', tier: 'economy',
    toolCallingReliability: 'experimental', maxContextTokens: 128000,
    supportsPromptCaching: true,
    approxInputCostPer1K: 0.00015, approxOutputCostPer1K: 0.0006,
  },
  {
    provider: 'gemini', model: 'gemini-2.5-flash', tier: 'economy',
    toolCallingReliability: 'stable', maxContextTokens: 1000000,
    supportsPromptCaching: true,
    approxInputCostPer1K: 0.0003, approxOutputCostPer1K: 0.0025,
  },
  {
    provider: 'anthropic', model: 'claude-haiku-4-5', tier: 'economy',
    toolCallingReliability: 'stable', maxContextTokens: 200000,
    supportsPromptCaching: true,
    approxInputCostPer1K: 0.001, approxOutputCostPer1K: 0.005,
  },
  {
    provider: 'openrouter', model: 'deepseek/deepseek-v3', tier: 'economy',
    toolCallingReliability: 'stable', maxContextTokens: 128000,
    supportsPromptCaching: false,
    approxInputCostPer1K: 0.00027, approxOutputCostPer1K: 0.0011,
  },
  {
    provider: 'openrouter', model: 'arcee-ai/trinity-large-thinking', tier: 'economy',
    toolCallingReliability: 'experimental', maxContextTokens: 128000,
    supportsPromptCaching: false,
    approxInputCostPer1K: 0.0003, approxOutputCostPer1K: 0.0009,
  },
];
```

**Note:** Gemini 2.0 Flash removed (deprecated, shuts down June 1 2026). DeepSeek R1 replaced with DeepSeek V3 for stable tool calling. GPT-4o-mini marked `experimental` for tool calling due to documented reliability issues.

**Startup check:** On server boot, warn if any model's `deprecationDate` is within 30 days.

### 9.4 Config Changes

**File:** `server/config/limits.ts`

```typescript
// REMOVE:
// export const EXTRACTION_MODEL = 'claude-sonnet-4-6';

// UPDATE:
export const PROVIDER_FALLBACK_CHAIN = ['anthropic', 'openai', 'gemini', 'openrouter'] as const;
```

**File:** `server/lib/env.ts`

```typescript
// ADD:
OPENROUTER_API_KEY: z.string().optional(),
ROUTER_SHADOW_MODE: z.coerce.boolean().default(false),
ROUTER_ENABLE_ECONOMY: z.coerce.boolean().default(false),
ROUTER_FORCE_FRONTIER: z.coerce.boolean().default(false),  // kill switch — forces ceiling model globally
```

### 9.5 Pricing Service Update

**File:** `server/services/pricingService.ts`

Add failsafe pricing and cache read multipliers:

```typescript
const FAILSAFE_PRICING: Record<string, { inputRate: number; outputRate: number }> = {
  // Existing
  'anthropic:claude-opus-4-6':     { inputRate: 0.015,   outputRate: 0.075   },
  'anthropic:claude-sonnet-4-6':   { inputRate: 0.003,   outputRate: 0.015   },
  'anthropic:claude-haiku-4-5':    { inputRate: 0.001,   outputRate: 0.005   },
  'openai:gpt-4o':                 { inputRate: 0.0025,  outputRate: 0.01    },
  'openai:gpt-4o-mini':            { inputRate: 0.00015, outputRate: 0.0006  },
  // Updated
  'gemini:gemini-2.5-flash':       { inputRate: 0.0003,  outputRate: 0.0025  },
  'gemini:gemini-2.5-flash-lite':  { inputRate: 0.0001,  outputRate: 0.0004  },
  // New
  'openrouter:deepseek/deepseek-v3':            { inputRate: 0.00027, outputRate: 0.0011  },
  'openrouter:arcee-ai/trinity-large-thinking': { inputRate: 0.0003,  outputRate: 0.0009  },
  'openrouter:anthropic/claude-sonnet-4-6':     { inputRate: 0.003,   outputRate: 0.015   },
  '__default__':                   { inputRate: 0.015,   outputRate: 0.075   },
};

// Cache read discount multipliers by provider
export const CACHE_READ_MULTIPLIERS: Record<string, number> = {
  anthropic:  0.10,   // 90% discount
  openai:     0.50,   // 50% discount
  gemini:     0.25,   // 75% discount
  openrouter: 1.00,   // no caching through OpenRouter
};
```

### 9.6 DB Migration

```sql
ALTER TABLE llm_requests
  ADD COLUMN execution_phase text NOT NULL DEFAULT 'planning',
  ADD COLUMN capability_tier text NOT NULL DEFAULT 'frontier',
  ADD COLUMN was_downgraded boolean NOT NULL DEFAULT false,
  ADD COLUMN routing_reason text,
  ADD COLUMN was_escalated boolean NOT NULL DEFAULT false,
  ADD COLUMN escalation_reason text,
  ADD COLUMN cached_prompt_tokens integer NOT NULL DEFAULT 0;

CREATE INDEX llm_requests_execution_phase_idx
  ON llm_requests (execution_phase, billing_month);
```

### 9.7 Cost Aggregates Update

**File:** `server/db/schema/costAggregates.ts`

Add `'execution_phase'` to entity type.

**File:** `server/services/routerJobService.ts`

Add aggregate upsert for the `execution_phase` dimension in the `llm-aggregate-update` job handler.

---

## 10. Call-Site Changes (Complete Diff Summary)

### 10.1 `agentExecutionService.ts`

**Main loop call (line 875):**

```typescript
// BEFORE:
context: { ...routerCtx, taskType: 'development', provider: agent.modelProvider, model: agent.modelId },

// AFTER:
context: {
  ...routerCtx,
  taskType: 'development',
  executionPhase: phase,
  provider: agent.modelProvider,
  model: agent.modelId,
  routingMode: agent.allowModelOverride ? 'ceiling' : 'forced',
},
```

**Wrap-up calls (lines 855, 926):**

```typescript
// AFTER:
context: {
  ...routerCtx, taskType: 'general', executionPhase: 'synthesis',
  provider: agent.modelProvider, model: agent.modelId, routingMode: 'ceiling',
},
```

**New variables before loop + post-response tracking + validation:**

```typescript
let previousResponseHadToolCalls = false;

// After each routeCall:
previousResponseHadToolCalls = !!(response.toolCalls && response.toolCalls.length > 0);

// After economy model returns tool calls:
// → Run validateToolCalls(), escalate on failure (section 6.3)
```

### 10.2 `conversationService.ts`

```typescript
// Line 246 — add: executionPhase: 'planning', routingMode: 'ceiling'
// Line 361 — add: executionPhase: 'synthesis', routingMode: 'ceiling'
```

### 10.3 `workspaceMemoryService.ts` + `outcomeLearningService.ts`

All 5 call sites:

```typescript
// BEFORE:
provider: 'anthropic', model: EXTRACTION_MODEL,

// AFTER:
executionPhase: 'execution', routingMode: 'ceiling',
// provider and model OMITTED — resolver picks cheapest economy model
```

### 10.4 `llmRouter.ts` — Internal Changes

1. Update `LLMCallContextSchema` — make `provider`/`model` optional, add `executionPhase`, `routingMode`
2. Insert `resolveLLM()` call after validation
3. Insert shadow mode check
4. Use `effectiveProvider`/`effectiveModel` throughout
5. Write `executionPhase`, `capabilityTier`, `wasDowngraded`, `routingReason`, `wasEscalated`, `escalationReason`, `cachedPromptTokens` to the `llm_requests` insert
6. Update idempotency key generation to use `effectiveProvider`/`effectiveModel`

---

## 11. Implementation Order

Six phases, each independently deployable. Each phase delivers value on its own.

### Phase 0: Prompt Caching (NEW — Implement First)
**Est. effort:** Small
**Est. savings:** 30-60% on input tokens alone

| Step | File | Change |
|------|------|--------|
| 0a | `server/services/providers/anthropicAdapter.ts` | Add `cache_control` breakpoints on system prompt and last tool definition. Extract `cache_read_input_tokens` from response. |
| 0b | `server/services/providers/types.ts` | Add `cachedPromptTokens` to `ProviderResponse`. |
| 0c | `server/db/schema/llmRequests.ts` | Add `cached_prompt_tokens` column. |
| 0d | `server/services/llmRouter.ts` | Write `cachedPromptTokens` from provider response to ledger. |
| 0e | `server/services/pricingService.ts` | Add `CACHE_READ_MULTIPLIERS`, update `calculateCost()` to account for cached tokens. |
| 0f | DB migration | Add `cached_prompt_tokens` column. |

**Verification:** Run an agent loop, inspect `llm_requests` — after iteration 2+, `cached_prompt_tokens` should be >0 and growing. Compare input costs to pre-caching baseline.

### Phase 1: Core Types + Resolver + Schema
**Est. effort:** Small

| Step | File | Change |
|------|------|--------|
| 1a | `server/db/schema/llmRequests.ts` | Add `EXECUTION_PHASES`, `CAPABILITY_TIERS`, `ROUTING_MODES` constants/types. Add routing + escalation columns. |
| 1b | `server/config/modelRegistry.ts` | **New file.** Static model registry with `toolCallingReliability`, `deprecationDate`, `supportsPromptCaching`. |
| 1c | `server/services/llmResolver.ts` | **New file.** `resolveLLM()` with context window guard, tool-calling filter, `reason` field. |
| 1d | DB migration | Add routing/escalation columns + index. |

**Verification:** Unit tests for `resolveLLM()` — all phase/mode/constraint/fallback combinations.

### Phase 2: Router Integration + Call-Site Updates
**Est. effort:** Medium

| Step | File | Change |
|------|------|--------|
| 2a | `server/services/llmRouter.ts` | Update schema, insert resolver, shadow mode, write new fields to ledger. |
| 2b | `server/services/agentExecutionService.ts` | Phase detection, `previousResponseHadToolCalls`, `routingMode` on all 3 contexts. |
| 2c | `server/services/conversationService.ts` | Add `executionPhase` to both contexts. |
| 2d | `server/services/workspaceMemoryService.ts` | Replace `provider`/`model` with `executionPhase: 'execution'` on all 4 sites. |
| 2e | `server/services/outcomeLearningService.ts` | Same. |
| 2f | `server/lib/env.ts` | Add `ROUTER_SHADOW_MODE`, `ROUTER_ENABLE_ECONOMY`, `ROUTER_FORCE_FRONTIER`. |

**Rollout:** Deploy with `ROUTER_SHADOW_MODE=true` first. Validate routing decisions in logs for 7+ days. Then flip `ROUTER_ENABLE_ECONOMY=true` for Anthropic-only routing (Haiku as economy).

**Verification:** Inspect `llm_requests` — verify all new columns populated correctly. Verify `forced` mode for `allowModelOverride: false` agents.

### Phase 3: Cascade Validation + OpenAI/Gemini Adapters
**Est. effort:** Medium

| Step | File | Change |
|------|------|--------|
| 3a | `server/services/agentExecutionService.ts` | Add `validateToolCalls()`, escalation logic after economy model responses. |
| 3b | `server/services/providers/openaiAdapter.ts` | Full implementation with cached token tracking. |
| 3c | `server/services/providers/openaiFormat.ts` | **New file.** Shared OpenAI-format message/tool translation. |
| 3d | `server/services/providers/geminiAdapter.ts` | Full implementation (Gemini 2.5 Flash). |
| 3e | `server/services/pricingService.ts` | Add failsafe pricing for new models. |
| 3f | Seed migration | Insert `llm_pricing` rows for new models. |

**Verification:** Test tool-calling through OpenAI + Gemini adapters. Test cascade: inject a bad tool call from economy model, verify escalation fires and frontier model retries. Monitor `was_escalated` rate.

### Phase 4: OpenRouter Adapter
**Est. effort:** Small

| Step | File | Change |
|------|------|--------|
| 4a | `server/services/providers/openrouterAdapter.ts` | **New file.** Reuses OpenAI format with different base URL + auth. |
| 4b | `server/services/providers/registry.ts` | Register `openrouter`. |
| 4c | `server/lib/env.ts` | Add `OPENROUTER_API_KEY`. |
| 4d | `server/config/limits.ts` | Add `'openrouter'` to fallback chain. |

**Verification:** Configure agent with OpenRouter model, verify calls succeed and cost tracking works.

### Phase 5: Config Cleanup + Analytics
**Est. effort:** Small

| Step | File | Change |
|------|------|--------|
| 5a | `server/config/limits.ts` | Remove `EXTRACTION_MODEL`. |
| 5b | `server/services/routerJobService.ts` | Add `execution_phase` dimension to aggregate upserts. |
| 5c | `server/db/schema/costAggregates.ts` | Add `'execution_phase'` entity type. |

**Verification:** Query cost aggregates by execution phase. Calculate: cache hit rate, escalation rate, cost per phase, savings vs baseline.

---

## 12. What This Spec Excludes (Explicitly)

| Excluded | Reason |
|----------|--------|
| Prompt-based complexity scoring | System-aware signals are stronger; keyword matching adds no value |
| LLM-based routing | Adds cost and latency to every call — defeats the purpose |
| Org-level tier configuration | Users don't choose tiers; the system routes intelligently |
| Latency-aware routing | Future enhancement — not needed for v1 |
| Provider health scoring | Existing cooldown system handles outages adequately |
| `iterationNumber` on `llm_requests` | Can be derived from run-level analysis later |
| UI for model registry management | Static config file is sufficient |
| Streaming support across providers | Out of scope — current system uses non-streaming calls |
| `CachePolicy` interface on router context | Caching is adapter-level, not routing-level |
| Expanded `RoutingConstraints` beyond tool-calling + context window | Premature — add when call sites need them |
| `pricingType` / `supportedParameters` on model registry | Controlled via registry contents directly |
| `policySnapshot` / `candidatesConsidered` on resolver result | Ledger columns are the audit trail |

---

## 13. Risk Assessment

| Risk | Severity | Likelihood | Mitigation |
|------|----------|-----------|------------|
| Economy model tool-calling failures corrupt downstream tools | Critical | Medium | Cascade escalation + tool call validation (Phase 3). Monitor `was_escalated` rate. Kill switch: `ROUTER_FORCE_FRONTIER=true`. |
| Gemini 2.0 Flash deprecation (June 1 2026) | Critical | Certain | Removed from registry. Replaced with 2.5 Flash / Flash-Lite. |
| Economy model misinterprets tool results silently | High | Low | Tool results are structured JSON — parsing is mechanical. Escalation catches structural failures. |
| Context window overflow mid-loop on smaller economy model | High | Medium | Context window guard in resolver filters by `estimatedTotalTokensSoFar`. |
| Model version drift causes silent regressions | Medium | Medium | Pin specific model versions in registry. `deprecationDate` field with startup warning. |
| OpenRouter reliability / downtime | Medium | Medium | Last in fallback chain. Platform works without it. |
| Pricing drift (provider changes pricing) | Low | Medium | Failsafe pricing uses most expensive known rates. DB pricing is authoritative. |
| `forced` mode forgotten on critical agents | Low | Low | Derived from existing `allowModelOverride` flag — no new config to forget. |
| Synthesis on economy model (edge case miss) | Low | Low | Phase detection falls back to `planning` (frontier). Resolver falls back to ceiling. |
| Cascade retry costs erode savings | Low | Low | Monitor escalation rate. If >15% for a model, remove from economy tier. |
| Need to disable routing during incident | Low | Low | `ROUTER_FORCE_FRONTIER=true` — env change, no deploy needed. Disables routing, escalation, forces ceiling model globally. |

---

## 14. Success Metrics

Post-deployment, measure:

### Cost Metrics
1. **Cost per agent run** — before vs after (initial target: 30-50%, full target: 60-70%)
2. **Cost by execution phase** — planning + synthesis should be ~30-40% of total despite being frontier
3. **Cache hit rate** — `cached_prompt_tokens / total_prompt_tokens` per phase (target: 50-80% after iteration 2+)

### Routing Metrics
4. **% of calls on economy tier** — should be ~58% (7 of 12 call patterns)
5. **`wasDowngraded` rate** — visibility into how often routing triggers
6. **`reason` distribution** — breakdown of `economy` / `ceiling` / `forced` / `fallback` (escalation tracked separately via `wasEscalated`)

### Quality Metrics
7. **Escalation rate** — `was_escalated / total_economy_calls` (target: <5%, alert at >15%)
8. **Escalation reasons** — which tool calls fail validation on which models
9. **Error rate by tier** — economy vs frontier error rates should be comparable
10. **Agent output quality** — no degradation in user-facing outputs (synthesis stays frontier)

### Operational Metrics
11. **Provider latency by tier** — economy models should be equal or faster
12. **Fallback rate** — how often resolver has zero candidates and falls back to ceiling
