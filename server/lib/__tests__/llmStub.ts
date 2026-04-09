/**
 * llmStub — deterministic test stub that matches the `routeCall()` shape from
 * server/services/llmRouter.ts.
 *
 * Introduced by P0.1 Layer 2 of docs/improvements-roadmap-spec.md. The stub is
 * explicitly NOT a global monkey-patch — it is constructed per-test and passed
 * into whatever production code would otherwise call `routeCall()`. This forces
 * production callsites to take the router as a parameter (dependency inversion),
 * which is the right shape for testability.
 *
 * Usage:
 *
 *   import { createLLMStub } from '../../../lib/__tests__/llmStub.js';
 *
 *   const stub = createLLMStub([
 *     {
 *       matchOnLastUser: /read the workspace/i,
 *       response: {
 *         content: '',
 *         toolCalls: [{ id: 'tc-1', name: 'read_workspace', input: { key: 'intake' } }],
 *         stopReason: 'tool_use',
 *         tokensIn: 100,
 *         tokensOut: 20,
 *         providerRequestId: 'stub-req-1',
 *       },
 *     },
 *     {
 *       // fallback — matches anything
 *       response: { content: 'done', stopReason: 'end_turn', tokensIn: 50, tokensOut: 10, providerRequestId: 'stub-req-2' },
 *     },
 *   ]);
 *
 *   const response = await stub.routeCall({ messages: [...], context: {...} });
 *   // stub.calls[0].params is the captured RouterCallParams of the first call
 *   // stub.calls[0].scenarioIndex is which scenario matched (0-indexed)
 *
 * Semantics:
 *
 *   - Scenarios are evaluated in order. The first match wins.
 *   - A scenario with no matchers (neither `matchOnSystem` nor `matchOnLastUser`)
 *     is a wildcard and matches any call. Use it as a fallback at the end of the array.
 *   - If no scenario matches, `routeCall()` throws with the messages array attached
 *     so the test can see exactly what the stub was asked for.
 *   - Every call is recorded in `stub.calls[]` with its matched scenario index and
 *     its captured params, so the test can assert on what the production code asked for.
 */

import type { RouterCallParams } from '../../services/llmRouter.js';
import type { ProviderResponse, ProviderMessage } from '../../services/providers/types.js';

/**
 * One canned response, optionally gated by matchers against the incoming params.
 * If both matchers are present, BOTH must match for the scenario to fire.
 * If neither matcher is present, the scenario is a wildcard.
 */
export interface LLMStubScenario {
  /** Optional regex matched against `params.system`. */
  matchOnSystem?: RegExp;
  /**
   * Optional regex matched against the concatenated text of the LAST user message.
   * If the last message is not a user message, this never matches.
   */
  matchOnLastUser?: RegExp;
  /** The response to return when this scenario matches. */
  response: ProviderResponse;
}

export interface LLMStubCallRecord {
  params: RouterCallParams;
  scenarioIndex: number;
  timestamp: number;
}

export interface LLMStub {
  routeCall: (params: RouterCallParams) => Promise<ProviderResponse>;
  calls: LLMStubCallRecord[];
  /** Total number of times `routeCall` has been invoked on this stub. */
  readonly callCount: number;
  /** Reset the call history without rebuilding the stub. Scenarios remain. */
  reset: () => void;
}

/**
 * Build an LLM stub from a scenario array.
 *
 * The returned object is a fresh stub — no shared state between stubs. Each
 * stub holds its own `calls[]` history so parallel tests do not interfere.
 */
export function createLLMStub(scenarios: LLMStubScenario[]): LLMStub {
  const calls: LLMStubCallRecord[] = [];

  async function routeCall(params: RouterCallParams): Promise<ProviderResponse> {
    const matchedIndex = scenarios.findIndex((scenario) =>
      matchesScenario(scenario, params),
    );

    if (matchedIndex === -1) {
      const err = new Error(
        `[llmStub] no scenario matched. See err.messages and err.system for the call that was rejected.`,
      ) as Error & { messages: ProviderMessage[]; system?: string };
      err.messages = params.messages;
      err.system = params.system;
      throw err;
    }

    const scenario = scenarios[matchedIndex];
    calls.push({
      params,
      scenarioIndex: matchedIndex,
      timestamp: Date.now(),
    });

    // Return a deep clone so the test can't accidentally mutate the
    // scenario's canned response and affect later calls.
    return JSON.parse(JSON.stringify(scenario.response)) as ProviderResponse;
  }

  return {
    routeCall,
    calls,
    get callCount() {
      return calls.length;
    },
    reset() {
      calls.length = 0;
    },
  };
}

// ---------------------------------------------------------------------------
// Internal: scenario matching
// ---------------------------------------------------------------------------

function matchesScenario(scenario: LLMStubScenario, params: RouterCallParams): boolean {
  const hasSystemMatcher = scenario.matchOnSystem !== undefined;
  const hasUserMatcher = scenario.matchOnLastUser !== undefined;

  // Wildcard: no matchers at all = matches everything.
  if (!hasSystemMatcher && !hasUserMatcher) {
    return true;
  }

  if (hasSystemMatcher) {
    if (!params.system || !scenario.matchOnSystem!.test(params.system)) {
      return false;
    }
  }

  if (hasUserMatcher) {
    const lastUserText = extractLastUserText(params.messages);
    if (lastUserText === null || !scenario.matchOnLastUser!.test(lastUserText)) {
      return false;
    }
  }

  return true;
}

/**
 * Extract the plain-text content of the LAST user message in the messages array.
 * Returns null if the last message is not a user message or has no text content.
 * Used by the `matchOnLastUser` matcher.
 *
 * Exported so tests can assert on the extraction behaviour independently.
 */
export function extractLastUserText(messages: readonly ProviderMessage[]): string | null {
  if (messages.length === 0) return null;
  const last = messages[messages.length - 1];
  if (last.role !== 'user') return null;

  if (typeof last.content === 'string') {
    return last.content;
  }

  // Content is a block array — concatenate every text block. tool_use /
  // tool_result blocks are ignored.
  const textParts: string[] = [];
  for (const block of last.content) {
    if (block.type === 'text') {
      textParts.push(block.text);
    }
  }
  return textParts.length > 0 ? textParts.join('\n') : null;
}
