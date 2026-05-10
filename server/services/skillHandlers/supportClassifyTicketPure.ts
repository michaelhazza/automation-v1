// Pure helpers for support.classify_ticket — no DB, no LLM, no side effects.
// These functions are extracted for unit-testability.

import type { SupportClassifyTicketResult } from '../../../shared/types/supportClassifyTicketResult.js';
import { SupportClassifyTicketResultSchema } from '../../../shared/types/supportClassifyTicketResult.js';

/**
 * Build the system + user prompt for the LLM classification call.
 */
export function buildClassifyPrompt(
  ticketSubject: string,
  ticketBody: string,
  recentMessages: string[],
): { system: string; user: string } {
  const system = `You are a support ticket classifier. Classify the ticket by intent, urgency, recommended_action, confidence (0-1), reasoning, and escalate_reason (null if not escalating). Respond ONLY with valid JSON matching this schema:
{ "intent": "account_question"|"billing_question"|"bug_report"|"feature_request"|"how_to_question"|"complaint"|"cancellation_request"|"sales_inquiry"|"other", "urgency": "low"|"medium"|"high"|"urgent", "recommended_action": "draft_reply"|"escalate_to_human"|"add_internal_note_only"|"close_as_no_action", "confidence": 0.0-1.0, "reasoning": "...", "escalate_reason": null | "..." }`;

  const messageLines = recentMessages.length > 0
    ? `\nRecent messages:\n${recentMessages.map((m, i) => `[${i + 1}] ${m}`).join('\n')}`
    : '';

  const user = `Classify this support ticket:\nSubject: ${ticketSubject}\nLatest message: ${ticketBody}${messageLines}`;

  return { system, user };
}

/**
 * Pass-through confidence scorer. The LLM provides confidence directly;
 * this function is the hook for future override logic.
 */
export function scoreIntentConfidence(parseResult: SupportClassifyTicketResult): number {
  return parseResult.confidence;
}

/**
 * Returns true when the result object is structurally malformed:
 * null/undefined, null intent, confidence out of [0,1] range, or missing recommended_action.
 */
export function isMalformedOutput(result: unknown): boolean {
  if (result === null || result === undefined) return true;
  if (typeof result !== 'object') return true;

  const r = result as Record<string, unknown>;

  if (r['intent'] === null || r['intent'] === undefined) return true;

  const confidence = r['confidence'];
  if (typeof confidence !== 'number' || confidence < 0 || confidence > 1) return true;

  if (r['recommended_action'] === null || r['recommended_action'] === undefined) return true;

  // Run through the full Zod schema to catch enum mismatches
  return !SupportClassifyTicketResultSchema.safeParse(result).success;
}

/**
 * Build the safe fallback sentinel result used when parse fails.
 */
export function buildSentinelResult(reason: string): SupportClassifyTicketResult {
  return {
    intent: 'other',
    urgency: 'medium',
    recommended_action: 'escalate_to_human',
    confidence: 0,
    reasoning: 'Parse failed',
    escalate_reason: reason,
  };
}
