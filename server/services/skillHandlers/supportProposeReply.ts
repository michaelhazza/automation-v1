// LLM-backed skill handler for support.propose_reply.
// Drafts a reply for a support ticket using the voice profile and classification
// context. Writes the draft via supportDraftDispatchService.proposeReply.
// Never writes canonical_ticket_messages directly (INV-11).

import { routeCall } from '../llmRouter.js';
import { logger } from '../../lib/logger.js';
import { proposeReply } from '../supportDraftDispatchService.js';
import type { PrincipalContext } from '../principal/types.js';

export interface ProposeReplyInput {
  organisationId: string;
  ticketId: string;
  runId: string;
  ticketSubject: string;
  recentMessages: string[];
  intent: string;
  urgency: string;
  confidence: number;
  voiceProfile: 'casual' | 'neutral' | 'formal' | 'custom';
  customerHistoryContext?: string;
  /**
   * Resolved Support Agent master prompt. When provided, prepended to the skill-local
   * system message so the LLM call sees agent-level guidance ahead of the per-skill rules.
   */
  masterPrompt?: string;
}

export interface ProposeReplyResult {
  draftId: string;
  bodyText: string;
}

const VOICE_PROFILE_INSTRUCTIONS: Record<string, string> = {
  casual: 'Write in a friendly, conversational tone. Use contractions and approachable language.',
  neutral: 'Write in a clear, professional tone. Be concise and helpful.',
  formal: 'Write in a formal, respectful tone. Avoid contractions and colloquialisms.',
  custom: 'Write in the organisation\'s configured tone.',
};

const INTENT_DRAFTING_RULES: Record<string, string> = {
  account_question: 'Focus on account status and next steps. Be specific about what the customer needs to do.',
  billing_question: 'Address the billing concern directly. Offer to connect them with billing support if needed.',
  cancellation_request: 'Acknowledge the request empathetically. Offer retention options if appropriate.',
  bug_report: 'Acknowledge the issue, confirm it is being investigated, and provide a realistic timeline.',
  feature_request: 'Thank the customer for the feedback. Confirm the request has been noted.',
  how_to_question: 'Provide clear step-by-step guidance. Link to documentation where available.',
  complaint: 'Acknowledge the frustration first. Focus on resolution, not justification.',
  sales_inquiry: 'Respond helpfully with relevant product information. Offer a follow-up call if appropriate.',
  other: 'Respond helpfully and professionally to the customer\'s message.',
};

export async function proposeReplyForTicket(
  input: ProposeReplyInput,
  principalCtx: PrincipalContext,
): Promise<ProposeReplyResult> {
  const {
    organisationId,
    ticketId,
    runId,
    ticketSubject,
    recentMessages,
    intent,
    urgency,
    voiceProfile,
    customerHistoryContext,
    masterPrompt,
  } = input;

  const voiceInstruction = VOICE_PROFILE_INSTRUCTIONS[voiceProfile] ?? VOICE_PROFILE_INSTRUCTIONS.neutral;
  const intentRule = INTENT_DRAFTING_RULES[intent] ?? INTENT_DRAFTING_RULES.other;

  const historySection = customerHistoryContext
    ? `\n\nCustomer history context:\n${customerHistoryContext}`
    : '';

  const skillSystem = `You are a support reply drafter. Your task is to write a helpful, accurate reply to a support ticket.

Voice profile: ${voiceProfile}
${voiceInstruction}

Intent-specific guidance: ${intentRule}

IMPORTANT: Respond ONLY with the reply body text. Do not include subject lines, greetings like "Dear Customer", or sign-offs — those are added automatically. Write the body of the reply only.`;

  const system = masterPrompt ? `${masterPrompt}\n\n---\n\n${skillSystem}` : skillSystem;

  const messageContext = recentMessages.length > 0
    ? `\nRecent conversation:\n${recentMessages.map((m, i) => `[${i + 1}] ${m}`).join('\n')}`
    : '';

  const user = `Draft a reply for this support ticket.
Subject: ${ticketSubject}
Urgency: ${urgency}${messageContext}${historySection}

Write the reply body:`;

  let rawContent: string;
  try {
    const response = await routeCall({
      system,
      messages: [{ role: 'user', content: user }],
      maxTokens: 2048,
      temperature: 0.3,
      context: {
        organisationId,
        runId: runId ?? undefined,
        sourceType: 'system',
        featureTag: 'support-propose-reply',
        taskType: 'general',
        systemCallerPolicy: 'bypass_routing',
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
      },
    });
    rawContent = response.content.trim();
  } catch (err) {
    throw Object.assign(
      new Error('propose_reply_llm_failed'),
      { statusCode: 502, errorCode: 'propose_reply_llm_failed', cause: err },
    );
  }

  if (!rawContent) {
    throw Object.assign(
      new Error('propose_reply_empty_response'),
      { statusCode: 502, errorCode: 'propose_reply_empty_response' },
    );
  }

  const draft = await proposeReply(
    {
      ticketId,
      body: rawContent,
      visibility: 'public',
      runId,
    },
    principalCtx,
  );

  return { draftId: draft.id, bodyText: rawContent };
}
