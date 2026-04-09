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
 *     → same outputs, no side effects, no environment reads.
 *
 * If you add a function here that needs state, it belongs in
 * agentExecutionService.ts, not here. The verify-pure-helper-convention.sh
 * gate enforces the *Pure.ts + *.test.ts sibling relationship.
 */

import type { ProviderTool } from './providers/types.js';
import type { MiddlewareContext } from './middleware/types.js';
import type { AgentRunRequest } from './agentExecutionService.js';
import type { SubaccountAgent } from '../db/schema/index.js';

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
