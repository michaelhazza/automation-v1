// DR2 — shared classify→dispatch logic for Task messages (creation + follow-up).
// selectDispatchRoute lives in taskDispatchRoutePure.ts (side-effect-free, unit-testable).
// The full handleTaskMessage function requires DB for cap checks.

import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { agentRuns } from '../db/schema/index.js';
import { and, eq, gte, count, inArray } from 'drizzle-orm';
import type { TaskUiContext, FastPathDecision, TaskScope } from '../../shared/types/taskFastPath.js';
import type { BriefStructuredResult } from '../../shared/types/briefResultContract.js';
import { classifyChatIntent, DEFAULT_CHAT_TRIAGE_CONFIG } from './chatTriageClassifier.js';
import { generateSimpleReply } from './taskSimpleReplyGeneratorPure.js';
import { writeConversationMessage } from './taskConversationWriter.js';
import { IN_FLIGHT_RUN_STATUSES } from '../../shared/runStatus.js';
import { logger } from '../lib/logger.js';
import { selectDispatchRoute } from './taskDispatchRoutePure.js';
export { selectDispatchRoute } from './taskDispatchRoutePure.js';
export type { DispatchRoute } from './taskDispatchRoutePure.js';
import type { DispatchRoute } from './taskDispatchRoutePure.js';

// Per spec §4.5.3: 5 orchestrator invocations per task per 10-minute sliding window.
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

export interface HandleTaskMessageInput {
  conversationId: string;
  taskId: string;
  organisationId: string;
  subaccountId?: string;
  text: string;
  uiContext: TaskUiContext;
  scope?: TaskScope;
  /** When true, frequency + concurrency caps are enforced. False for initial Task creation. */
  isFollowUp?: boolean;
  /**
   * Precomputed classification result. When supplied, the internal
   * `classifyChatIntent` call is skipped — used by `taskCreationService` to
   * classify before persisting the task, so a classifier failure does not
   * leave an orphaned task/conversation in the DB.
   */
  prefetchedDecision?: FastPathDecision;
}

export async function handleTaskMessage(
  input: HandleTaskMessageInput,
): Promise<{ route: DispatchRoute; fastPathDecision: FastPathDecision }> {
  const triageInput = {
    text: input.text,
    uiContext: input.uiContext,
    config: DEFAULT_CHAT_TRIAGE_CONFIG,
  };

  const fastPathDecision = input.prefetchedDecision ?? await classifyChatIntent(triageInput);

  let frequencyCapHit = false;
  let concurrencyCapHit = false;

  if (input.isFollowUp) {
    // agent_runs is FORCE-RLS — must run inside the request-scoped org tx
    // so the cap checks see the task's actual run history. Bare `db`
    // would read on a fresh connection without app.organisation_id and
    // fail-closed to zero rows, silently disabling the caps.
    const tx = getOrgScopedDb('taskMessageHandler');
    const windowStart = new Date(Date.now() - FOLLOWUP_WINDOW_MS);

    const [freqRow] = await tx
      .select({ c: count() })
      .from(agentRuns)
      .where(and(
        eq(agentRuns.taskId, input.taskId),
        eq(agentRuns.organisationId, input.organisationId),
        gte(agentRuns.createdAt, windowStart),
      ));
    frequencyCapHit = (freqRow?.c ?? 0) >= FOLLOWUP_FREQUENCY_CAP;

    if (!frequencyCapHit) {
      const [concRow] = await tx
        .select({ c: count() })
        .from(agentRuns)
        .where(and(
          eq(agentRuns.taskId, input.taskId),
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
      taskId: input.taskId,
      organisationId: input.organisationId,
      subaccountId: input.subaccountId,
      role: 'assistant',
      content: '',
      artefacts: [artefact],
    });
    if (input.isFollowUp) {
      logger.info('task.followup.simple_reply_emitted', {
        event: 'task.followup.simple_reply_emitted',
        conversationId: input.conversationId,
        status: 'success',
      });
    }
  } else if (dispatchRoute === 'frequency_capped') {
    logger.info('task.followup.cap_hit', {
      event: 'task.followup.cap_hit',
      conversationId: input.conversationId,
      count: FOLLOWUP_FREQUENCY_CAP,
      windowStartMs: FOLLOWUP_WINDOW_MS,
      status: 'partial',
    });
    await writeConversationMessage({
      conversationId: input.conversationId,
      taskId: input.taskId,
      organisationId: input.organisationId,
      subaccountId: input.subaccountId,
      role: 'assistant',
      content: '',
      artefacts: [buildSentinelArtefact(
        'You have reached the maximum number of analyses in a short period. Please wait a moment before sending another follow-up.',
      )],
    });
  } else if (dispatchRoute === 'concurrency_capped') {
    logger.info('task.followup.concurrency_blocked', {
      event: 'task.followup.concurrency_blocked',
      conversationId: input.conversationId,
      status: 'partial',
    });
    await writeConversationMessage({
      conversationId: input.conversationId,
      taskId: input.taskId,
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
      logger.info('task.followup.classified', {
        event: 'task.followup.classified',
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
          id: input.taskId,
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
        logger.info('task.followup.orchestrator_enqueued', {
          event: 'task.followup.orchestrator_enqueued',
          conversationId: input.conversationId,
          status: 'success',
        });
      }
    } catch (err: unknown) {
      const event = input.isFollowUp ? 'task.followup.failed' : 'task.orchestrator_enqueue_failed';
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
