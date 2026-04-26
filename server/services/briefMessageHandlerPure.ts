// DR2 — shared classify→dispatch logic for Brief messages (creation + follow-up).
// selectDispatchRoute lives in briefDispatchRoutePure.ts (side-effect-free, unit-testable).
// The full handleBriefMessage function requires DB for cap checks.

import { db } from '../db/index.js';
import { agentRuns } from '../db/schema/index.js';
import { and, eq, gte, count, inArray } from 'drizzle-orm';
import type { BriefUiContext, FastPathDecision, BriefScope } from '../../shared/types/briefFastPath.js';
import type { BriefStructuredResult } from '../../shared/types/briefResultContract.js';
import { classifyChatIntent, DEFAULT_CHAT_TRIAGE_CONFIG } from './chatTriageClassifier.js';
import { generateSimpleReply } from './briefSimpleReplyGeneratorPure.js';
import { writeConversationMessage } from './briefConversationWriter.js';
import { IN_FLIGHT_RUN_STATUSES } from '../../shared/runStatus.js';
import { logger } from '../lib/logger.js';
import { selectDispatchRoute } from './briefDispatchRoutePure.js';
export { selectDispatchRoute } from './briefDispatchRoutePure.js';
export type { DispatchRoute } from './briefDispatchRoutePure.js';
import type { DispatchRoute } from './briefDispatchRoutePure.js';

// Per spec §4.5.3: 5 orchestrator invocations per brief per 10-minute sliding window.
const FOLLOWUP_FREQUENCY_CAP = 5;
const FOLLOWUP_WINDOW_MS = 10 * 60 * 1000;

function buildSentinelArtefact(summary: string): BriefStructuredResult {
  return {
    artefactId: crypto.randomUUID(),
    kind: 'structured',
    summary,
    entityType: 'other',
    source: 'canonical',
    filtersApplied: [],
    rows: [],
    rowCount: 0,
    truncated: false,
    suggestions: [],
    costCents: 0,
    confidence: 1,
    confidenceSource: 'deterministic',
    status: 'final',
  };
}

export interface HandleBriefMessageInput {
  conversationId: string;
  briefId: string;
  organisationId: string;
  subaccountId?: string;
  text: string;
  uiContext: BriefUiContext;
  scope?: BriefScope;
  /** When true, frequency + concurrency caps are enforced. False for initial Brief creation. */
  isFollowUp?: boolean;
}

export async function handleBriefMessage(
  input: HandleBriefMessageInput,
): Promise<{ route: DispatchRoute; fastPathDecision: FastPathDecision }> {
  const triageInput = {
    text: input.text,
    uiContext: input.uiContext,
    config: DEFAULT_CHAT_TRIAGE_CONFIG,
  };

  const fastPathDecision = await classifyChatIntent(triageInput);

  let frequencyCapHit = false;
  let concurrencyCapHit = false;

  if (input.isFollowUp) {
    const windowStart = new Date(Date.now() - FOLLOWUP_WINDOW_MS);

    const [freqRow] = await db
      .select({ c: count() })
      .from(agentRuns)
      .where(and(
        eq(agentRuns.taskId, input.briefId),
        eq(agentRuns.organisationId, input.organisationId),
        gte(agentRuns.createdAt, windowStart),
      ));
    frequencyCapHit = (freqRow?.c ?? 0) >= FOLLOWUP_FREQUENCY_CAP;

    if (!frequencyCapHit) {
      const [concRow] = await db
        .select({ c: count() })
        .from(agentRuns)
        .where(and(
          eq(agentRuns.taskId, input.briefId),
          eq(agentRuns.organisationId, input.organisationId),
          inArray(agentRuns.status, [...IN_FLIGHT_RUN_STATUSES]),
        ));
      concurrencyCapHit = (concRow?.c ?? 0) >= 1;
    }
  }

  const dispatchRoute = selectDispatchRoute(fastPathDecision.route, { frequencyCapHit, concurrencyCapHit });

  if (dispatchRoute === 'simple_reply') {
    const artefact = generateSimpleReply(fastPathDecision, triageInput);
    await writeConversationMessage({
      conversationId: input.conversationId,
      briefId: input.briefId,
      organisationId: input.organisationId,
      subaccountId: input.subaccountId,
      role: 'assistant',
      content: '',
      artefacts: [artefact],
    });
    if (input.isFollowUp) {
      logger.info('brief.followup.simple_reply_emitted', {
        event: 'brief.followup.simple_reply_emitted',
        conversationId: input.conversationId,
        status: 'success',
      });
    }
  } else if (dispatchRoute === 'frequency_capped') {
    logger.info('brief.followup.cap_hit', {
      event: 'brief.followup.cap_hit',
      conversationId: input.conversationId,
      count: FOLLOWUP_FREQUENCY_CAP,
      windowStartMs: FOLLOWUP_WINDOW_MS,
      status: 'partial',
    });
    await writeConversationMessage({
      conversationId: input.conversationId,
      briefId: input.briefId,
      organisationId: input.organisationId,
      subaccountId: input.subaccountId,
      role: 'assistant',
      content: '',
      artefacts: [buildSentinelArtefact(
        'You have reached the maximum number of analyses in a short period. Please wait a moment before sending another follow-up.',
      )],
    });
  } else if (dispatchRoute === 'concurrency_capped') {
    logger.info('brief.followup.concurrency_blocked', {
      event: 'brief.followup.concurrency_blocked',
      conversationId: input.conversationId,
      status: 'partial',
    });
    await writeConversationMessage({
      conversationId: input.conversationId,
      briefId: input.briefId,
      organisationId: input.organisationId,
      subaccountId: input.subaccountId,
      role: 'assistant',
      content: '',
      artefacts: [buildSentinelArtefact(
        'An analysis is still running — your follow-up will be processed once it completes.',
      )],
    });
  } else {
    // orchestrator / needs_orchestrator / needs_clarification path
    if (input.isFollowUp) {
      logger.info('brief.followup.classified', {
        event: 'brief.followup.classified',
        conversationId: input.conversationId,
        intentKind: fastPathDecision.route,
      });
    }
    // Dynamic import to avoid circular dependency — orchestratorFromTaskJob → services.
    // Awaited so enqueue failures surface to the caller and terminal events fire correctly.
    try {
      const { enqueueOrchestratorRoutingIfEligible } = await import('../jobs/orchestratorFromTaskJob.js');
      await enqueueOrchestratorRoutingIfEligible(
        {
          id: input.briefId,
          organisationId: input.organisationId,
          status: 'inbox',
          assignedAgentId: null,
          isSubTask: false,
          createdByAgentId: null,
          description: input.text,
        },
        { scope: input.scope ?? fastPathDecision.scope },
      );
      if (input.isFollowUp) {
        logger.info('brief.followup.orchestrator_enqueued', {
          event: 'brief.followup.orchestrator_enqueued',
          conversationId: input.conversationId,
          status: 'success',
        });
      }
    } catch (err: unknown) {
      const event = input.isFollowUp ? 'brief.followup.failed' : 'brief.orchestrator_enqueue_failed';
      logger.error(event, {
        event,
        conversationId: input.conversationId,
        error: err instanceof Error ? err.message : String(err),
        ...(input.isFollowUp ? { status: 'failed' } : {}),
      });
    }
  }

  return { route: dispatchRoute, fastPathDecision };
}
