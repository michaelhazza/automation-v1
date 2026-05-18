// ---------------------------------------------------------------------------
// peerReviewCaller — wraps llmRouter.routeCall() for the peer-review call.
// Closed-Loop Skill Improvement spec §9.1 step 10, §15.3 (Chunk 4).
//
// Centralises the GPT-class call signature, idempotency-key derivation,
// response parsing, and router-exhaustion detection.
//
// Anti-recursion (§6.2): this caller uses sourceType='failure_post_mortem'
// and taskType='peer_review' — distinct from the RCA proposer call which uses
// taskType='general'. The peer reviewer never reads skill_amendments directly.
// ---------------------------------------------------------------------------

import { routeCall } from './llmRouter.js';
import { ProviderTimeoutError } from './llmRouter.js';
import type { AmendmentKind } from '../../shared/types/skillAmendments.js';

// Model pinned for peer-review calls. GPT-class per spec §15.3 requirement
// that the peer reviewer runs on a different model family from the RCA proposer.
const PEER_REVIEW_MODEL = 'gpt-4o';
const PEER_REVIEW_PROVIDER = 'openai';

export interface PeerReviewInput {
  scorecardJudgementId: string;
  organisationId: string;
  subaccountId: string;
  runId: string;
  proposedKind: AmendmentKind;
  proposedBody: string;
  failureMode: string;
  contributingFactors: string[];
}

export type PeerReviewResult =
  | { status: 'addresses_root_cause'; reasoning: string; peerReviewerModelVersion: string }
  | { status: 'does_not_address'; reasoning: string; peerReviewerModelVersion: string }
  | { status: 'router_exhausted'; reason: 'all_providers_unavailable' | 'circuit_breaker_open' | 'timeout' | 'retry_budget_exhausted' };

interface PeerReviewLlmResponse {
  verdict: 'addresses_root_cause' | 'does_not_address';
  reasoning: string;
}

/**
 * Parse the raw LLM response content into a typed verdict.
 * Returns null if the response is malformed.
 */
export function parsePeerReviewResponse(raw: string): PeerReviewLlmResponse | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.trim());
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const obj = parsed as Record<string, unknown>;
  if (
    (obj['verdict'] !== 'addresses_root_cause' && obj['verdict'] !== 'does_not_address') ||
    typeof obj['reasoning'] !== 'string'
  ) {
    return null;
  }
  return {
    verdict: obj['verdict'] as PeerReviewLlmResponse['verdict'],
    reasoning: obj['reasoning'],
  };
}

/**
 * Classify a routeCall thrown error into a router_exhausted reason.
 * Returns null if the error is not a router-exhaustion type (caller should rethrow).
 */
export function classifyRouterExhaustionReason(
  err: unknown,
): PeerReviewResult & { status: 'router_exhausted' } | null {
  if (err instanceof ProviderTimeoutError) {
    return { status: 'router_exhausted', reason: 'timeout' };
  }
  const e = err as { code?: string; name?: string } | null | undefined;
  if (!e || typeof e !== 'object') return null;

  if (e.code === 'PROVIDER_UNAVAILABLE') {
    return { status: 'router_exhausted', reason: 'all_providers_unavailable' };
  }
  if (e.code === 'PROVIDER_NOT_CONFIGURED') {
    return { status: 'router_exhausted', reason: 'all_providers_unavailable' };
  }
  // ComputeBudgetExceededError — treated as circuit_breaker_open per spec §9.1
  if (e.name === 'ComputeBudgetExceededError') {
    return { status: 'router_exhausted', reason: 'circuit_breaker_open' };
  }
  // RateLimitError — treated as retry_budget_exhausted per spec §9.1
  if (e.name === 'RateLimitError') {
    return { status: 'router_exhausted', reason: 'retry_budget_exhausted' };
  }
  return null;
}

/**
 * Call the peer reviewer (GPT-class via llmRouter) to assess whether the
 * proposed amendment addresses the root cause identified by the RCA.
 *
 * Returns a structured result including the verdict, reasoning, and the
 * model version used. On router exhaustion returns `router_exhausted` so
 * the caller can emit the terminal event without retrying.
 */
export async function callPeerReview(input: PeerReviewInput): Promise<PeerReviewResult> {
  const system = `You are a senior AI quality assurance engineer reviewing a proposed skill amendment for an AI agent system. Your task is to assess whether a proposed amendment addresses the root cause of a recorded failure.

You will be given:
1. The failure mode (root cause) identified by a root-cause analysis
2. Contributing factors that led to the failure
3. The proposed amendment kind and body text

Respond with a single JSON object:
{
  "verdict": "addresses_root_cause" | "does_not_address",
  "reasoning": "<one sentence explaining your verdict>"
}

Rules:
- "addresses_root_cause": the proposed amendment, if applied, would prevent or significantly mitigate the described failure mode.
- "does_not_address": the proposed amendment does not target the root cause, is off-topic, or would not prevent the failure.
- Respond with only the JSON object, no preamble or explanation.`;

  const userLines = [
    `## Failure mode (root cause)`,
    input.failureMode,
    ``,
    `## Contributing factors`,
    ...input.contributingFactors.map((f, i) => `${i + 1}. ${f}`),
    ``,
    `## Proposed amendment`,
    `Kind: ${input.proposedKind}`,
    `Body:`,
    input.proposedBody,
  ];
  const user = userLines.join('\n');

  let response: Awaited<ReturnType<typeof routeCall>>;
  try {
    response = await routeCall({
      messages: [{ role: 'user', content: user }],
      system,
      maxTokens: 256,
      context: {
        organisationId: input.organisationId,
        sourceType: 'failure_post_mortem',
        taskType: 'peer_review',
        featureTag: 'closed-loop-amendment-peer-review',
        systemCallerPolicy: 'bypass_routing',
        provider: PEER_REVIEW_PROVIDER,
        model: PEER_REVIEW_MODEL,
      },
    });
  } catch (err) {
    const exhausted = classifyRouterExhaustionReason(err);
    if (exhausted) return exhausted;
    throw err;
  }

  const rawContent = typeof response.content === 'string' ? response.content.trim() : '';
  const parsed = parsePeerReviewResponse(rawContent);

  if (!parsed) {
    // Malformed LLM response — treat as a retryable error so pg-boss retries
    throw new Error(`peerReviewCaller: unparseable response from peer reviewer: ${rawContent.slice(0, 200)}`);
  }

  return {
    status: parsed.verdict,
    reasoning: parsed.reasoning,
    peerReviewerModelVersion: PEER_REVIEW_MODEL,
  };
}
