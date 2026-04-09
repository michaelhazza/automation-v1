/**
 * agentExecutionServicePure — pure helpers extracted from agentExecutionService.ts
 *
 * Per docs/improvements-roadmap-spec.md P0.1 Layer 3, this file contains the
 * leaf-level pure logic that runAgenticLoop depends on. Lives next to the
 * impure service so tests can import from here without pulling in db / env /
 * any runtime service dependencies.
 *
 * Invariants:
 *   - NO imports of db, env, or any service module with side effects.
 *   - Types-only imports from types modules are fine (they erase at runtime).
 *   - Every exported function must be referentially transparent: same inputs
 *     → same outputs, no environment reads, no mutation of inputs.
 *   - Carve-out: validateToolCalls emits a single console.warn for unknown
 *     tool-call fields. This is observational only — it does not affect the
 *     return value — and is preserved verbatim from the original inline
 *     implementation in runAgenticLoop. All other functions here are strictly
 *     side-effect-free.
 *
 * If you add a function here that needs state, it belongs in
 * agentExecutionService.ts, not here. The verify-pure-helper-convention.sh
 * gate enforces the *Pure.ts + *.test.ts sibling relationship.
 */

import type { ProviderTool } from './providers/types.js';
import type {
  MiddlewareContext,
  SerialisableMiddlewareContext,
  AgentRunCheckpoint,
} from './middleware/types.js';
import type { AgentRunRequest } from './agentExecutionService.js';
import type { SubaccountAgent } from '../db/schema/index.js';
import { MIDDLEWARE_CONTEXT_VERSION } from '../config/limits.js';
import { getUniversalSkillNames } from '../config/actionRegistry.js';

// ---------------------------------------------------------------------------
// selectExecutionPhase — pure function that maps loop iteration state to the
// execution phase used by llmRouter for model-tier selection.
//
// Previously inlined in runAgenticLoop. Extracted verbatim per P0.1 Layer 3.
// ---------------------------------------------------------------------------

export type ExecutionPhase = 'planning' | 'execution' | 'synthesis';

export function selectExecutionPhase(
  iteration: number,
  previousResponseHadToolCalls: boolean,
  totalToolCalls: number,
): ExecutionPhase {
  if (iteration === 0) {
    return 'planning';
  }
  if (previousResponseHadToolCalls) {
    return 'execution';
  }
  if (totalToolCalls > 0 && !previousResponseHadToolCalls) {
    return 'synthesis';
  }
  if (iteration > 0 && totalToolCalls === 0) {
    return 'synthesis';
  }
  return 'planning';
}

// ---------------------------------------------------------------------------
// validateToolCalls — lightweight structural validation of LLM-emitted tool
// calls against the active tool set. Used by the cascade escalation path:
// if an economy-tier model produces invalid tool calls, runAgenticLoop
// retries with the frontier (ceiling) model.
//
// Check list:
//   1. Tool name must be in the active tool set.
//   2. Input must be a non-null object.
//   3. All required fields from the tool's input schema must be present.
//   4. Extra (unknown) fields are logged as warnings but do not fail the check.
//
// Extracted verbatim from the inline version previously in
// agentExecutionService.ts.
// ---------------------------------------------------------------------------

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ValidateToolCallsResult {
  valid: boolean;
  failureReason?: string;
}

export function validateToolCalls(
  toolCalls: readonly ToolCall[],
  activeTools: readonly ProviderTool[],
): ValidateToolCallsResult {
  const toolNames = new Set(activeTools.map((t) => t.name));

  for (const tc of toolCalls) {
    if (!toolNames.has(tc.name)) {
      return { valid: false, failureReason: `unknown_tool:${tc.name}` };
    }

    if (tc.input === null || typeof tc.input !== 'object') {
      return { valid: false, failureReason: `invalid_input:${tc.name}` };
    }

    const toolDef = activeTools.find((t) => t.name === tc.name);
    if (toolDef?.input_schema?.required) {
      for (const field of toolDef.input_schema.required) {
        if (!(field in tc.input)) {
          return { valid: false, failureReason: `missing_field:${tc.name}.${field}` };
        }
      }
    }

    // Log-only: unexpected fields (common hallucination, usually harmless).
    // We keep the console.warn here for parity with the original inline
    // version — this is the one non-pure leak, but it is observational only
    // and does not affect the return value.
    if (toolDef?.input_schema?.properties) {
      const knownFields = new Set(Object.keys(toolDef.input_schema.properties));
      const extraFields = Object.keys(tc.input).filter((k) => !knownFields.has(k));
      if (extraFields.length > 0) {
        console.warn(`[toolCallValidator] unexpected fields in ${tc.name}: ${extraFields.join(', ')}`);
      }
    }
  }

  return { valid: true };
}

// ---------------------------------------------------------------------------
// buildMiddlewareContext — pure constructor for the MiddlewareContext object
// that runAgenticLoop passes to every middleware in the pre/post pipelines.
//
// Previously inlined at the top of runAgenticLoop. Extracted so tests can
// assert the initial-state shape without spinning up the full loop.
// ---------------------------------------------------------------------------

export interface BuildMiddlewareContextParams {
  runId: string;
  request: AgentRunRequest;
  agent: { modelId: string; temperature: number; maxTokens: number };
  saLink: SubaccountAgent;
  startTime: number;
  tokenBudget: number;
  maxToolCalls: number;
  timeoutMs: number;
}

export function buildMiddlewareContext(
  params: BuildMiddlewareContextParams,
): MiddlewareContext {
  return {
    runId: params.runId,
    request: params.request,
    agent: params.agent,
    saLink: params.saLink,
    tokensUsed: 0,
    toolCallsCount: 0,
    toolCallHistory: [],
    iteration: 0,
    startTime: params.startTime,
    tokenBudget: params.tokenBudget,
    maxToolCalls: params.maxToolCalls,
    timeoutMs: params.timeoutMs,
    // Sprint 2 P1.1 Layer 3 — in-memory idempotency cache for preTool decisions.
    // Keyed by toolCallId. Bound to the MiddlewareContext lifetime (one run).
    preToolDecisions: new Map(),
  };
}

// ---------------------------------------------------------------------------
// extractToolIntentConfidence — Sprint 3 P2.3
//
// Parses the agent's last assistant text for a `tool_intent` JSON block and
// pulls out the self-reported confidence score for a specific tool call.
// The block is surfaced to the agent via a system prompt snippet and looks
// like:
//
//   <tool_intent>
//   { "tool": "send_email", "confidence": 0.82, "reason": "..." }
//   </tool_intent>
//
// or, for multi-tool plans:
//
//   <tool_intent>
//   [
//     { "tool": "send_email", "confidence": 0.82 },
//     { "tool": "create_deal", "confidence": 0.41 }
//   ]
//   </tool_intent>
//
// The block MAY also be fenced as a JSON code block immediately after
// the opening tag (the master prompt template shows both variants as
// acceptable). We strip a leading ```json / ``` fence pair if present.
//
// Matching rules:
//   - Case-insensitive tag match (`<tool_intent>`, `<Tool_Intent>`, etc).
//   - The last `<tool_intent>` block in the text wins — lets the model
//     revise its plan mid-response.
//   - `tool` comparison is exact case-sensitive on the tool slug.
//   - Confidence must be a finite number in [0, 1]; otherwise returns
//     null so the caller falls back to the "missing confidence" branch
//     of the confidence gate (fail-closed).
//   - Malformed JSON → null.
//   - No `<tool_intent>` block → null.
//
// Returns null if anything is wrong; the caller treats null as "unknown,
// fail closed" per applyConfidenceUpgrade semantics.
// ---------------------------------------------------------------------------

interface ToolIntentEntry {
  tool: string;
  confidence: number;
}

/**
 * Extract the last `<tool_intent>` block from a piece of assistant text
 * and return the confidence for the given tool slug, or null if the
 * block is missing, malformed, or lacks an entry for this tool.
 */
export function extractToolIntentConfidence(
  assistantText: string | null | undefined,
  toolSlug: string,
): number | null {
  if (!assistantText || typeof assistantText !== 'string') return null;

  // Collect every <tool_intent>...</tool_intent> block, last-match wins.
  const blockRegex = /<tool_intent>([\s\S]*?)<\/tool_intent>/gi;
  let lastBody: string | null = null;
  let match: RegExpExecArray | null;
  while ((match = blockRegex.exec(assistantText)) !== null) {
    lastBody = match[1];
  }
  if (lastBody === null) return null;

  // Strip optional ```json / ``` fences.
  const trimmed = lastBody
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  if (trimmed.length === 0) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }

  const entries: ToolIntentEntry[] = [];
  const pushIfValid = (candidate: unknown) => {
    if (!candidate || typeof candidate !== 'object') return;
    const obj = candidate as Record<string, unknown>;
    const tool = obj.tool;
    const confidence = obj.confidence;
    if (typeof tool !== 'string' || typeof confidence !== 'number') return;
    if (!Number.isFinite(confidence)) return;
    if (confidence < 0 || confidence > 1) return;
    entries.push({ tool, confidence });
  };

  if (Array.isArray(parsed)) {
    for (const item of parsed) pushIfValid(item);
  } else {
    pushIfValid(parsed);
  }

  // Prefer the last matching entry (agent may have revised its plan).
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].tool === toolSlug) return entries[i].confidence;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Sprint 3 P2.1 Sprint 3A — checkpoint serialisation helpers
//
// `serialiseMiddlewareContext` strips a live `MiddlewareContext` down to the
// subset that can survive a JSON round-trip inside
// `agent_run_snapshots.checkpoint`. The Map-backed `preToolDecisions` cache
// is flattened into a plain object keyed on `toolCallId` because `Map<K,V>`
// loses its entries on JSON.stringify. Ephemeral runtime-only fields
// (`startTime`, `timeoutMs`, `tokenBudget`, `request`, `agent`, `saLink`)
// are deliberately excluded — they are rehydrated from the `agent_runs` row
// and the live process defaults on resume.
//
// `deserialiseMiddlewareContext` is the inverse used by the Sprint 3B resume
// path. It asserts `middlewareVersion === MIDDLEWARE_CONTEXT_VERSION` before
// rehydrating so checkpoints from an older runtime are refused loudly rather
// than coerced into the current shape.
//
// `buildResumeContext` wraps the two above: given a checkpoint + the live
// runtime params (request handle, agent handle, saLink, fresh
// startTime/timeoutMs/tokenBudget), it returns a ready-to-use
// `MiddlewareContext` at `iteration + 1`.
// ---------------------------------------------------------------------------

/**
 * Extract the JSON-safe subset of a live `MiddlewareContext` for
 * persistence into `agent_run_snapshots.checkpoint`. The returned
 * object is structurally identical across equal inputs (no timestamps,
 * no random ids) so tests can snapshot it directly.
 */
export function serialiseMiddlewareContext(
  ctx: MiddlewareContext,
): SerialisableMiddlewareContext {
  const preToolDecisions: Record<string, import('./middleware/types.js').SerialisablePreToolDecision> = {};
  for (const [toolCallId, decision] of ctx.preToolDecisions.entries()) {
    preToolDecisions[toolCallId] = decision;
  }

  return {
    middlewareVersion: MIDDLEWARE_CONTEXT_VERSION,
    iteration: ctx.iteration,
    tokensUsed: ctx.tokensUsed,
    toolCallsCount: ctx.toolCallsCount,
    // Defensive copy so later mutations of ctx.toolCallHistory do not
    // bleed into the serialised snapshot.
    toolCallHistory: ctx.toolCallHistory.map((entry) => ({ ...entry })),
    lastReviewCodeVerdict: ctx.lastReviewCodeVerdict ?? null,
    reviewCodeIterations: ctx.reviewCodeIterations ?? 0,
    lastAssistantText: ctx.lastAssistantText,
    preToolDecisions,
  };
}

/**
 * Rehydrate a `SerialisableMiddlewareContext` into the shape the
 * resume path needs. Does NOT return a complete `MiddlewareContext` —
 * callers must supply the live runtime fields via `buildResumeContext`.
 * Exposed separately so tests can assert the pure-rehydration logic
 * without constructing a full runtime bundle.
 *
 * Throws on version mismatch so stale checkpoints are rejected rather
 * than silently coerced.
 */
export function deserialiseMiddlewareContext(
  serialised: SerialisableMiddlewareContext,
): Pick<
  MiddlewareContext,
  | 'iteration'
  | 'tokensUsed'
  | 'toolCallsCount'
  | 'toolCallHistory'
  | 'lastReviewCodeVerdict'
  | 'reviewCodeIterations'
  | 'lastAssistantText'
  | 'preToolDecisions'
> {
  if (serialised.middlewareVersion !== MIDDLEWARE_CONTEXT_VERSION) {
    throw new Error(
      `agentExecutionServicePure.deserialiseMiddlewareContext: checkpoint middlewareVersion=${serialised.middlewareVersion} does not match runtime MIDDLEWARE_CONTEXT_VERSION=${MIDDLEWARE_CONTEXT_VERSION}. Refusing to resume.`,
    );
  }

  const preToolDecisions = new Map<string, import('./middleware/types.js').PreToolDecision>();
  if (serialised.preToolDecisions) {
    for (const [toolCallId, decision] of Object.entries(serialised.preToolDecisions)) {
      preToolDecisions.set(toolCallId, decision);
    }
  }

  return {
    iteration: serialised.iteration,
    tokensUsed: serialised.tokensUsed,
    toolCallsCount: serialised.toolCallsCount,
    toolCallHistory: serialised.toolCallHistory.map((entry) => ({ ...entry })),
    lastReviewCodeVerdict: serialised.lastReviewCodeVerdict ?? null,
    reviewCodeIterations: serialised.reviewCodeIterations ?? 0,
    lastAssistantText: serialised.lastAssistantText,
    preToolDecisions,
  };
}

/**
 * Given a checkpoint and the freshly constructed runtime params
 * (request handle, agent handle, saLink, and the live
 * startTime/tokenBudget/maxToolCalls/timeoutMs for the new worker),
 * return a fully-populated `MiddlewareContext` at
 * `checkpoint.iteration + 1` — the exact state `runAgenticLoop` would
 * have held at the top of the next iteration had the run not been
 * paused.
 *
 * Pure: no IO, no clock reads. The caller supplies `startTime` so the
 * function stays deterministic under test.
 */
export interface BuildResumeContextParams {
  checkpoint: AgentRunCheckpoint;
  runId: string;
  request: AgentRunRequest;
  agent: { modelId: string; temperature: number; maxTokens: number };
  saLink: SubaccountAgent;
  startTime: number;
  tokenBudget: number;
  maxToolCalls: number;
  timeoutMs: number;
}

export function buildResumeContext(
  params: BuildResumeContextParams,
): MiddlewareContext {
  if (params.checkpoint.version !== 1) {
    throw new Error(
      `agentExecutionServicePure.buildResumeContext: checkpoint version=${params.checkpoint.version} is not supported. Refusing to resume.`,
    );
  }

  const rehydrated = deserialiseMiddlewareContext(params.checkpoint.middlewareContext);

  return {
    runId: params.runId,
    request: params.request,
    agent: params.agent,
    saLink: params.saLink,
    // Carry the persisted counters forward so the budget guards have
    // an accurate starting point.
    tokensUsed: rehydrated.tokensUsed,
    toolCallsCount: rehydrated.toolCallsCount,
    toolCallHistory: rehydrated.toolCallHistory,
    // Resume picks up at the NEXT iteration — the checkpoint captures
    // the state *after* `iteration` completed.
    iteration: rehydrated.iteration + 1,
    startTime: params.startTime,
    tokenBudget: params.tokenBudget,
    maxToolCalls: params.maxToolCalls,
    timeoutMs: params.timeoutMs,
    preToolDecisions: rehydrated.preToolDecisions,
    lastReviewCodeVerdict: rehydrated.lastReviewCodeVerdict,
    reviewCodeIterations: rehydrated.reviewCodeIterations,
    lastAssistantText: rehydrated.lastAssistantText,
  };
}

// ---------------------------------------------------------------------------
// Sprint 5 P4.1 — mutateActiveToolsPreservingUniversal
//
// The ONE approved way for middleware to mutate activeTools. Every mutation
// path goes through this helper, which re-injects universal skills as its
// final step. The static gate verify-universal-skills-preserved.sh fails
// CI if any middleware in the pipeline mutates activeTools without calling
// this.
// ---------------------------------------------------------------------------

/**
 * Apply a transform to the active tools list while preserving universal
 * skills. Any universal skill removed by the transform is re-injected
 * from `allAvailableTools`.
 */
export function mutateActiveToolsPreservingUniversal(
  current: ProviderTool[],
  transform: (tools: ProviderTool[]) => ProviderTool[],
  allAvailableTools: ProviderTool[],
): ProviderTool[] {
  const transformed = transform(current);
  const universalNames = new Set(getUniversalSkillNames());
  const universalTools = allAvailableTools.filter((t) => universalNames.has(t.name));
  const transformedNames = new Set(transformed.map((t) => t.name));
  // Re-inject any universal tools that the transform removed.
  const preserved = [...transformed];
  for (const ut of universalTools) {
    if (!transformedNames.has(ut.name)) preserved.push(ut);
  }
  return preserved;
}

// ---------------------------------------------------------------------------
// Sprint 5 P4.3 — plan-then-execute helpers
// ---------------------------------------------------------------------------

export interface AgentPlan {
  actions: Array<{
    tool: string;
    reason?: string;
  }>;
}

/**
 * Parse a plan JSON from the LLM's planning output. Returns null if
 * the content is malformed or has no actions.
 */
export function parsePlan(content: string | null | undefined): AgentPlan | null {
  if (!content || typeof content !== 'string') return null;

  // Try to extract JSON from the content (may be wrapped in markdown fences)
  let jsonStr = content.trim();
  const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    jsonStr = fenceMatch[1].trim();
  }

  try {
    const parsed = JSON.parse(jsonStr);
    if (parsed && typeof parsed === 'object') {
      // Accept both { plan: { actions: [...] } } and { actions: [...] }
      const plan = parsed.plan ?? parsed;
      if (plan.actions && Array.isArray(plan.actions) && plan.actions.length > 0) {
        return { actions: plan.actions };
      }
    }
  } catch {
    // Try to find a JSON object in the text
    const jsonMatch = content.match(/\{[\s\S]*"actions"\s*:\s*\[[\s\S]*\][\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.actions && Array.isArray(parsed.actions)) {
          return { actions: parsed.actions };
        }
      } catch {
        return null;
      }
    }
  }

  return null;
}

/**
 * Determine if a run should use plan-then-execute mode.
 *
 * A run is "complex" if any of:
 *   - agent.complexityHint === 'complex'
 *   - User message word count > 300
 *   - Agent allowlist skill count > 15
 */
export function isComplexRun(params: {
  complexityHint?: string | null;
  messageWordCount: number;
  skillCount: number;
}): boolean {
  if (params.complexityHint === 'complex') return true;
  if (params.messageWordCount > 300) return true;
  if (params.skillCount > 15) return true;
  return false;
}
