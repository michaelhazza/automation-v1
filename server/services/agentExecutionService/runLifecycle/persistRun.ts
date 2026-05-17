import { eq, and } from 'drizzle-orm';
import { db } from '../../../db/index.js';
import { logger } from '../../../lib/logger.js';
import { agentRuns, subaccountAgents } from '../../../db/schema/index.js';
import { deriveControllerStyle } from '../../controllerStyleResolver.js';
import { emitAgentEvent, tryEmitAgentEvent } from '../../agentExecutionEventEmitter.js';
import { emitAgentRunUpdate, emitSubaccountUpdate } from '../../../websocket/emitters.js';
import type { AgentRunRequest, RunExecutionContext } from '../types.js';

export async function persistAndAnnounce(
  request: AgentRunRequest,
  ctx: RunExecutionContext,
): Promise<{ run: typeof agentRuns.$inferSelect }> {
  // ── 1. Resolve controller style before inserting the run ─────────────
  // Read controllerStyleAllowed from the subaccountAgents row so we can
  // pass the resolved value into the INSERT. Default 'native_only' matches
  // the DB column default so missing rows are safe.
  let resolvedControllerStyleAllowed = 'native_only';
  if (request.subaccountAgentId) {
    const [saGovRow] = await db
      .select({ controllerStyleAllowed: subaccountAgents.controllerStyleAllowed })
      .from(subaccountAgents)
      .where(and(
        eq(subaccountAgents.id, request.subaccountAgentId),
        eq(subaccountAgents.organisationId, request.organisationId),
      ));
    if (saGovRow) {
      resolvedControllerStyleAllowed = saGovRow.controllerStyleAllowed;
    }
  }
  const { controllerStyle: resolvedControllerStyle, source: controllerStyleSource } =
    deriveControllerStyle(
      request.executionMode ?? 'api',
      resolvedControllerStyleAllowed,
      request.controllerStyle,
    );

  ctx.resolvedControllerStyleAllowed = resolvedControllerStyleAllowed;
  ctx.controllerStyleSource = controllerStyleSource;

  // ── 2. Create or claim the run record ────────────────────────────────
  // AE2 / spec §5.2 step 1: when the handoff worker dequeues a job whose
  // payload carries the pre-created runId, it forwards that id here so we
  // take ownership of the existing `pending` row instead of inserting a
  // second `agent_runs` row. The transition uses a concurrency-guarded
  // UPDATE (`WHERE status = 'pending'`) so a duplicate dispatch cannot
  // re-start a row that has already moved on.
  let run: typeof agentRuns.$inferSelect;
  if (request.preCreatedRunId) {
    const [claimed] = await db
      .update(agentRuns)
      .set({
        // Fields the pre-created row may not have populated.
        subaccountAgentId: request.subaccountAgentId ?? null,
        idempotencyKey: request.idempotencyKey ?? null,
        runType: request.runType,
        executionMode: request.executionMode ?? 'api',
        executionScope: 'subaccount',
        controllerStyle: resolvedControllerStyle,
        runSource: request.runSource ?? null,
        status: 'running',
        triggerContext: request.triggerContext ?? null,
        handoffSourceRunId: request.handoffSourceRunId ?? null,
        isSubAgent: request.isSubAgent ?? false,
        workflowStepRunId: request.workflowStepRunId ?? null,
        isTestRun: request.isTestRun ?? false,
        delegationScope: request.delegationScope ?? null,
        delegationDirection: request.delegationDirection ?? null,
        lastActivityAt: new Date(),
        startedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(
        eq(agentRuns.id, request.preCreatedRunId),
        eq(agentRuns.status, 'pending'),
      ))
      .returning();
    if (!claimed) {
      // Row missing or not-pending: surface as fail-loud per spec §5.2
      // step 1 worker-side guard. The worker has already validated row
      // presence and pending-status before reaching here, so missing-here
      // implies a concurrent transition that the AE2 contract forbids.
      throw new Error(`[persistAndAnnounce] pre-created agent_runs row ${request.preCreatedRunId} could not be claimed (missing or not in 'pending' status)`);
    }
    run = claimed;
  } else {
    [run] = await db
      .insert(agentRuns)
      .values({
        organisationId: request.organisationId,
        subaccountId: request.subaccountId,
        agentId: request.agentId,
        subaccountAgentId: request.subaccountAgentId ?? null,
        idempotencyKey: request.idempotencyKey ?? null,
        runType: request.runType,
        executionMode: request.executionMode ?? 'api',
        executionScope: 'subaccount',
        controllerStyle: resolvedControllerStyle,
        runSource: request.runSource ?? null,
        status: 'running',
        triggerContext: request.triggerContext ?? null,
        taskId: request.taskId ?? null,
        handoffDepth: request.handoffDepth ?? 0,
        parentRunId: request.parentRunId ?? null,
        handoffSourceRunId: request.handoffSourceRunId ?? null,
        isSubAgent: request.isSubAgent ?? false,
        parentSpawnRunId: request.parentSpawnRunId ?? null,
        workflowStepRunId: request.workflowStepRunId ?? null,
        isTestRun: request.isTestRun ?? false,
        delegationScope: request.delegationScope ?? null,
        delegationDirection: request.delegationDirection ?? null,
        lastActivityAt: new Date(),
        startedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
  }

  // Emit run started event
  emitAgentRunUpdate(run.id, 'agent:run:started', {
    agentId: request.agentId, subaccountId: request.subaccountId ?? null,
    runType: request.runType, status: 'running',
  });
  emitSubaccountUpdate(request.subaccountId!, 'live:agent_started', {
    runId: run.id, agentId: request.agentId,
  });

  // Live Agent Execution Log — critical lifecycle bookend (spec §5.3).
  // Awaited so that run.started claims sequence_number=1 before any later
  // event (prompt.assembled, context.source_loaded, etc.) allocates a
  // sequence number. Using tryEmitAgentEvent here would fire it in the
  // background, creating a race where a subsequent event could win the
  // lower sequence and sort before the bookend in the timeline.
  await emitAgentEvent({
    runId: run.id,
    organisationId: request.organisationId,
    subaccountId: request.subaccountId ?? null,
    sourceService: 'agentExecutionService',
    payload: {
      eventType: 'run.started',
      critical: true,
      agentId: request.agentId,
      runType: request.runType,
      triggeredBy: request.runSource ?? 'unknown',
    },
    linkedEntity: { type: 'agent', id: request.agentId },
  });

  // Log the resolved controller style for observability (spec §3.5 log code).
  tryEmitAgentEvent({
    runId: run.id,
    organisationId: request.organisationId,
    subaccountId: request.subaccountId ?? null,
    sourceService: 'agentExecutionService',
    payload: {
      eventType: 'foundation.controller_style.derived',
      critical: false,
      runId: run.id,
      executionMode: request.executionMode ?? 'api',
      controllerStyle: resolvedControllerStyle,
      source: controllerStyleSource,
    },
    linkedEntity: { type: 'agent', id: request.agentId },
  });

  // Live Agent Execution Log — `orchestrator.routing_decided` (spec §5.3).
  // Emitted here (not from the orchestrator job) so the event lands
  // inside THIS run's timeline at sequence 2, immediately after
  // `run.started`. The previous shape — job calls tryEmitAgentEvent
  // AFTER awaiting executeRun — put the event after `run.completed`,
  // breaking the "timeline represents actual execution order"
  // invariant. Fire-and-forget is safe: this is a non-critical event
  // and the run is now committed with sequence_number = 1 claimed.
  if (request.orchestratorDispatch) {
    tryEmitAgentEvent({
      runId: run.id,
      organisationId: request.organisationId,
      subaccountId: request.subaccountId ?? null,
      sourceService: 'orchestratorFromTaskJob',
      payload: {
        eventType: 'orchestrator.routing_decided',
        critical: false,
        taskId: request.orchestratorDispatch.taskId,
        chosenAgentId: request.orchestratorDispatch.chosenAgentId,
        idempotencyKey: request.orchestratorDispatch.idempotencyKey,
        routingSource: request.orchestratorDispatch.routingSource,
      },
      linkedEntity: { type: 'agent', id: request.orchestratorDispatch.chosenAgentId },
    });
  }

  // Observability: temporary metric for org subaccount runs (remove after 2 weeks stable)
  if (ctx.isOrgSubaccountRun) {
    logger.info('org_subaccount_run', {
      orgId: request.organisationId,
      agentId: request.agentId,
      runId: run.id,
      runType: request.runType,
    });
  }

  return { run };
}
