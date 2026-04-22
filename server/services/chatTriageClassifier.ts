import type { FastPathDecision } from '../../shared/types/briefFastPath.js';
import {
  classifyChatIntentPure,
  DEFAULT_CHAT_TRIAGE_CONFIG,
  type ChatTriageInput,
} from './chatTriageClassifierPure.js';
import { routeCall } from './llmRouter.js';
import { ParseFailureError } from '../lib/parseFailureError.js';
import { logger } from '../lib/logger.js';

function parseLlmDecision(content: string, input: ChatTriageInput): FastPathDecision {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new ParseFailureError({ rawExcerpt: content.slice(0, 512) });
  }

  const p = parsed as Record<string, unknown>;
  const validRoutes = ['simple_reply', 'needs_clarification', 'needs_orchestrator', 'cheap_answer'] as const;
  const validScopes = ['subaccount', 'org', 'system'] as const;

  const route = p['route'];
  const scope = p['scope'];

  if (!validRoutes.includes(route as typeof validRoutes[number])) {
    throw new ParseFailureError({ rawExcerpt: content.slice(0, 512) });
  }
  if (!validScopes.includes(scope as typeof validScopes[number])) {
    throw new ParseFailureError({ rawExcerpt: content.slice(0, 512) });
  }

  return {
    route: route as FastPathDecision['route'],
    scope: scope as FastPathDecision['scope'],
    confidence: typeof p['confidence'] === 'number' ? p['confidence'] : 0.7,
    tier: 2,
    secondLookTriggered: false,
    reasoning: typeof p['reasoning'] === 'string' ? p['reasoning'] : undefined,
  };
}

async function classifyWithLlm(input: ChatTriageInput): Promise<FastPathDecision> {
  const systemPrompt = `You are a query triage classifier. Given a user message, classify it into one of:
- simple_reply: acknowledgement, filler, or very short conversational turn
- cheap_answer: well-known metric query with a canned answer (pipeline velocity, churn rate, MRR, active contacts, open opportunities)
- needs_clarification: ambiguous or incomplete request needing more info
- needs_orchestrator: a meaningful query or action request

Also classify scope:
- subaccount: affects one specific company workspace
- org: affects all companies or the agency organisation
- system: affects platform-wide configuration

Respond with JSON only: { "route": "...", "scope": "...", "confidence": 0.0-1.0, "reasoning": "..." }`;

  const response = await routeCall({
    messages: [{ role: 'user', content: input.text }],
    system: systemPrompt,
    maxTokens: 256,
    context: {
      sourceType: 'system',
      taskType: 'general',
      featureTag: 'chat-triage',
      organisationId: input.uiContext.currentOrgId,
    },
    postProcess: (content: string) => {
      parseLlmDecision(content, input);
    },
  });

  return parseLlmDecision(response.content, input);
}

/**
 * Classifies a user's free-text Brief submission into a routing decision.
 * Tier 1: pure heuristics (< 2ms). Tier 2: Haiku LLM call (< 200ms P95).
 * Tier 2 is invoked when tier 1 confidence < threshold OR when a risky
 * write-intent route is detected with secondLookTriggered.
 */
export async function classifyChatIntent(input: ChatTriageInput): Promise<FastPathDecision> {
  const tier1 = classifyChatIntentPure(input);

  const needsTier2 =
    tier1.confidence < input.config.tier1ConfidenceThreshold ||
    tier1.secondLookTriggered;

  if (!needsTier2) {
    return tier1;
  }

  try {
    return await classifyWithLlm(input);
  } catch (err) {
    logger.warn('chatTriageClassifier.tier2_failed', {
      error: err instanceof Error ? err.message : String(err),
      tier1Route: tier1.route,
    });
    // Fall back to tier 1 result on LLM failure — never block Brief creation
    return { ...tier1, secondLookTriggered: false };
  }
}

export { DEFAULT_CHAT_TRIAGE_CONFIG };
export type { ChatTriageInput };
