// LLM-backed skill handler for support.classify_ticket.
// Reads the ticket thread, prompts the model, validates via Zod, and falls back
// to a sentinel result on parse failure — never throws on malformed model output.

import { routeCall } from '../llmRouter.js';
import { logger } from '../../lib/logger.js';
import { SupportClassifyTicketResultSchema } from '../../../shared/types/supportClassifyTicketResult.js';
import type { SupportClassifyTicketResult } from '../../../shared/types/supportClassifyTicketResult.js';
import { readThreadForAgent } from '../supportTicketService.js';
import { emitPhase1RunRenderedEvent } from '../phase1RunTraceEventEmitter.js';
import {
  buildClassifyPrompt,
  buildSentinelResult,
} from './supportClassifyTicketPure.js';

export interface ClassifyTicketInput {
  organisationId: string;
  subaccountId?: string | null;
  ticketId: string;
  runId?: string;
  /**
   * Resolved Support Agent master prompt from supportAgentMasterPrompt.resolveMasterPrompt(...).
   * When provided, prepended to the skill-local system message so the LLM call sees the
   * agent-level guidance ahead of the per-skill instructions. Optional for direct callers
   * (e.g. tests or HTTP-route entry points) that do not have an agent-run context.
   */
  masterPrompt?: string;
}

export async function classifyTicket(input: ClassifyTicketInput): Promise<SupportClassifyTicketResult> {
  const { organisationId, subaccountId = null, ticketId, runId, masterPrompt } = input;

  if (!input.ticketId) {
    throw Object.assign(new Error('classify_invalid_input'), { statusCode: 400, errorCode: 'classify_invalid_input' });
  }

  // Read ticket thread — uses existing supportTicketService so we don't duplicate DB logic.
  const principalCtx = { organisationId } as import('../principal/types.js').PrincipalContext;
  let ticket: Awaited<ReturnType<typeof readThreadForAgent>>['ticket'];
  let messages: Awaited<ReturnType<typeof readThreadForAgent>>['messages'];
  try {
    ({ ticket, messages } = await readThreadForAgent(ticketId, principalCtx));
  } catch (err) {
    if ((err as { statusCode?: number })?.statusCode === 404) {
      throw Object.assign(new Error('ticket_not_found'), { statusCode: 404, errorCode: 'ticket_not_found' });
    }
    throw Object.assign(new Error('classify_db_failed'), { statusCode: 502, errorCode: 'classify_db_failed', cause: err });
  }

  const ticketSubject = ticket.subject ?? '(no subject)';
  const recentMessages = messages
    .slice(-5)
    .map((m) => `[${m.direction}] ${m.body}`);
  const latestMessage = recentMessages.at(-1) ?? '';

  const { system: skillSystem, user } = buildClassifyPrompt(ticketSubject, latestMessage, recentMessages.slice(0, -1));
  const system = masterPrompt ? `${masterPrompt}\n\n---\n\n${skillSystem}` : skillSystem;

  let rawContent: string;
  try {
    const response = await routeCall({
      system,
      messages: [{ role: 'user', content: user }],
      maxTokens: 1024,
      temperature: 0.1,
      context: {
        organisationId,
        runId: runId ?? undefined,
        sourceType: 'system',
        featureTag: 'support-classify-ticket',
        taskType: 'general',
        systemCallerPolicy: 'bypass_routing',
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
      },
    });
    rawContent = response.content;
  } catch (err) {
    // LLM call failure — caller treats as low-confidence and routes to escalation.
    throw Object.assign(
      new Error('classify_llm_failed'),
      { statusCode: 502, errorCode: 'classify_llm_failed', cause: err },
    );
  }

  // Strip markdown fences if the model wraps JSON in ```json ... ``` blocks.
  const jsonText = rawContent.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    parsed = null;
  }

  const zodResult = SupportClassifyTicketResultSchema.safeParse(parsed);

  if (zodResult.success) {
    logger.info('phase1.support.ticket_classified', {
      ticketId,
      intent: zodResult.data.intent,
      urgency: zodResult.data.urgency,
      confidence: zodResult.data.confidence,
    });
    if (runId) {
      await emitPhase1RunRenderedEvent({
        runId,
        organisationId,
        subaccountId,
        eventType: 'phase1.support.ticket_classified',
        payload: {
          ticketId,
          intent: zodResult.data.intent,
          urgency: zodResult.data.urgency,
          confidence: zodResult.data.confidence,
        },
        sourceService: 'supportClassifyTicket',
      });
    }
    return zodResult.data;
  }

  const rawModelOutputRedacted = rawContent.slice(0, 200);
  const parseError = zodResult.error.message;

  logger.warn('phase1.support.classify_failed', {
    ticketId,
    parseError,
    rawModelOutputRedacted,
  });
  if (runId) {
    await emitPhase1RunRenderedEvent({
      runId,
      organisationId,
      subaccountId,
      eventType: 'phase1.support.classify_failed',
      payload: { ticketId, parseError, rawModelOutputRedacted },
      sourceService: 'supportClassifyTicket',
    });
  }

  return buildSentinelResult('classification_parse_failed');
}
