// LLM-backed skill handler for support.find_customer_history.
// Performs a deterministic cross-CRM lookup by customer email then summarises
// the findings with an LLM. Used when intent is account_question, billing_question,
// or cancellation_request to enrich the draft with account context.

import { eq, and, desc } from 'drizzle-orm';
import { routeCall } from '../llmRouter.js';
import { logger } from '../../lib/logger.js';
import { getOrgScopedDb } from '../../lib/orgScopedDb.js';
import { canonicalTickets } from '../../db/schema/index.js';

export interface FindCustomerHistoryInput {
  organisationId: string;
  ticketId: string;
  runId: string;
  customerEmail: string | null;
  /**
   * Resolved Support Agent master prompt. When provided, prepended to the skill-local
   * system message so the LLM call sees agent-level guidance ahead of the per-skill rules.
   */
  masterPrompt?: string;
}

export interface FindCustomerHistoryResult {
  summary: string;
  ticketCount: number;
}

export async function findCustomerHistory(
  input: FindCustomerHistoryInput,
): Promise<FindCustomerHistoryResult> {
  const { organisationId, ticketId, runId, customerEmail, masterPrompt } = input;

  if (!customerEmail) {
    return { summary: 'No customer email available for history lookup.', ticketCount: 0 };
  }

  const db = getOrgScopedDb('supportFindCustomerHistory');

  // Deterministic search: find recent tickets by customer email, exclude current ticket
  // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
  const recentTickets = await db
    .select({
      id: canonicalTickets.id,
      subject: canonicalTickets.subject,
      status: canonicalTickets.status,
      createdAt: canonicalTickets.createdAt,
      closedAt: canonicalTickets.closedAt,
      priority: canonicalTickets.priority,
    })
    .from(canonicalTickets)
    .where(
      and(
        eq(canonicalTickets.organisationId, organisationId),
        eq(canonicalTickets.customerEmail, customerEmail),
      ),
    )
    .orderBy(desc(canonicalTickets.createdAt))
    .limit(10);

  const otherTickets = recentTickets.filter((t) => t.id !== ticketId);

  if (otherTickets.length === 0) {
    return { summary: 'No prior support history found for this customer.', ticketCount: 0 };
  }

  const ticketLines = otherTickets.map((t) => {
    const closedNote = t.closedAt ? ` (closed ${t.closedAt.toISOString().slice(0, 10)})` : '';
    return `- [${t.status}${closedNote}] ${t.subject} (${t.priority} priority, opened ${t.createdAt.toISOString().slice(0, 10)})`;
  });

  const skillSystem = `You are a support context summariser. Summarise the customer's support history in 2-3 sentences. Focus on: patterns, recurring issues, unresolved items, and overall satisfaction signal. Be factual and brief — this summary will be used to inform a reply draft.`;
  const system = masterPrompt ? `${masterPrompt}\n\n---\n\n${skillSystem}` : skillSystem;

  const user = `Customer email: ${customerEmail}
Prior support tickets (${otherTickets.length} found):
${ticketLines.join('\n')}

Provide a 2-3 sentence summary of this customer's support history:`;

  let summary: string;
  try {
    const response = await routeCall({
      system,
      messages: [{ role: 'user', content: user }],
      maxTokens: 512,
      temperature: 0.1,
      context: {
        organisationId,
        runId: runId ?? undefined,
        sourceType: 'system',
        featureTag: 'support-find-customer-history',
        taskType: 'general',
        systemCallerPolicy: 'bypass_routing',
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
      },
    });
    summary = response.content.trim();
  } catch (err) {
    logger.warn('support.find_customer_history.llm_failed', {
      ticketId,
      customerEmail,
      err: err instanceof Error ? err.message : String(err),
    });
    // Fall back to a raw list rather than failing the whole execution
    summary = `Customer has ${otherTickets.length} prior ticket(s): ${ticketLines.slice(0, 3).join('; ')}`;
  }

  logger.info('support.find_customer_history.completed', {
    ticketId,
    customerEmail,
    ticketCount: otherTickets.length,
  });

  return { summary, ticketCount: otherTickets.length };
}
