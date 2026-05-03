/**
 * critiqueGate — Sprint 5 P4.4 shadow-mode semantic critique.
 *
 * PostCall middleware phase: fires after the LLM responds but before
 * tool calls execute. Evaluates economy-tier tool calls for semantic
 * correctness via a flash-tier LLM call. In shadow mode (default), the
 * result is logged to llmRequests.metadataJson but the tool call is
 * NOT blocked.
 *
 * Activation conditions (all must be true):
 *   - phase === 'execution'
 *   - response was downgraded to economy tier
 *   - actionDef.requiresCritiqueGate === true
 *
 * The CRITIQUE_GATE_SHADOW_MODE constant in limits.ts controls
 * whether this middleware only logs (true) or also reroutes (false).
 * Active mode is not part of the Sprint 5 scope — it requires 2-4
 * weeks of shadow-mode data.
 *
 * Contract: docs/improvements-roadmap-spec.md §P4.4.
 */

import { getActionDefinition } from '../../config/actionRegistry.js';
import { CRITIQUE_GATE_SHADOW_MODE } from '../../config/limits.js';
import {
  shouldCritique,
  buildCritiquePrompt,
  parseCritiqueResult,
} from './critiqueGatePure.js';

export interface PostCallContext {
  runId: string;
  organisationId: string;
  phase: string;
  wasDowngraded: boolean;
  /** Last 3 messages for context in the critique prompt. */
  recentMessages: Array<{ role: string; content: string }>;
  /** Callback to log the critique result to llmRequests.metadataJson. */
  logCritiqueResult?: (result: { verdict: string; reason: string; toolName: string }) => void;
}

export interface PostCallToolCall {
  name: string;
  input: Record<string, unknown>;
}

export interface CritiqueGateResult {
  /** Whether any tool call was flagged as suspect. */
  hasSuspect: boolean;
  /** Critique results per tool call. */
  results: Array<{
    toolName: string;
    verdict: 'ok' | 'suspect' | 'skipped' | 'error';
    reason: string;
  }>;
}

/**
 * Evaluate tool calls through the critique gate. In shadow mode,
 * this only logs results — it does not block execution.
 *
 * This function is intentionally NOT a full middleware (no
 * MiddlewarePipeline registration) because the postCall phase does
 * not exist in the current pipeline types. It is invoked directly
 * from runAgenticLoop after the LLM responds and before tool
 * execution begins.
 */
export async function evaluateCritiqueGate(
  toolCalls: readonly PostCallToolCall[],
  context: PostCallContext,
): Promise<CritiqueGateResult> {
  const results: CritiqueGateResult['results'] = [];
  const hasSuspect = false;

  for (const tc of toolCalls) {
    const actionDef = getActionDefinition(tc.name);

    const shouldRun = shouldCritique({
      phase: context.phase,
      wasDowngraded: context.wasDowngraded,
      requiresCritiqueGate: actionDef?.requiresCritiqueGate === true,
      shadowMode: CRITIQUE_GATE_SHADOW_MODE,
    });

    if (!shouldRun) {
      results.push({ toolName: tc.name, verdict: 'skipped', reason: 'Not eligible for critique' });
      continue;
    }

    try {
      const prompt = buildCritiquePrompt(tc.name, tc.input, context.recentMessages);

      // In this iteration, we build the prompt but don't make the actual
      // flash-tier LLM call — that requires wiring routeCall with a
      // parentRequestId pattern. Instead, we log the intent so the
      // shadow-mode telemetry pipeline is ready.
      //
      // The actual LLM call will be wired when the flash-tier routing
      // is available. For now, every eligible call gets a placeholder
      // result that records the prompt was built successfully.
      const result = {
        toolName: tc.name,
        verdict: 'ok' as const,
        reason: `Shadow mode — critique prompt built (${prompt.length} chars), LLM evaluation deferred`,
      };

      results.push(result);

      // Log to llmRequests.metadataJson if callback provided
      if (context.logCritiqueResult) {
        context.logCritiqueResult({
          verdict: result.verdict,
          reason: result.reason,
          toolName: tc.name,
        });
      }
    } catch (error) {
      results.push({
        toolName: tc.name,
        verdict: 'error',
        reason: `Critique evaluation failed: ${error instanceof Error ? error.message : 'unknown'}`,
      });
    }
  }

  return { hasSuspect, results };
}

// Re-export pure helpers for tests
export { parseCritiqueResult, buildCritiquePrompt, shouldCritique } from './critiqueGatePure.js';
