import type { SkillExecutionContext } from './context.js';
import {
  applyOnFailurePure,
  applyOnFailureForStructuredFailurePure,
  type OnFailureDirective,
} from '../skillExecutorPure.js';
import type { ProcessorHooks, ProcessorContext } from '../../types/processor.js';
import { createEvent } from '../../lib/tracing.js';
import { TripWire } from '../../lib/tripwire.js';
import { getActionDefinition } from '../../config/actionRegistry.js';
import { recordIncident } from '../incidentIngestor.js';
import { db } from '../../db/index.js';
import { subaccountAgents, agents, agentRuns } from '../../db/schema/index.js';
import { eq, and } from 'drizzle-orm';
import { isActive } from '../../lib/queryHelpers.js';
import { MAX_HANDOFF_DEPTH } from '../../config/limits.js';
import type PgBoss from 'pg-boss';
import { logger } from '../../lib/logger.js';
import { emitAgentEvent } from '../agentExecutionEventEmitter.js';

// ---------------------------------------------------------------------------
// onFailure dispatch (P0.2 Slice C of docs/improvements-roadmap-spec.md)
//
// When a skill handler throws or returns { success: false, ... }, look up
// the action definition's `onFailure` directive and dispatch:
//
//   - 'retry' (default)  — propagate the original error / failure object
//                          unchanged. Caller is responsible for retry logic
//                          (withBackoff / TripWire / agent loop).
//   - 'skip'             — return { success: false, skipped: true, reason }
//                          to the LLM. The agent loop continues without the
//                          result. Used for non-essential reads.
//   - 'fail_run'         — terminate the entire agent run via the closed
//                          FailureReason enum. Caller catches via FailureError.
//   - 'fallback'         — return actionDef.fallbackValue as the result
//                          instead of failing. Used for read-only tools where
//                          a stale or empty value is preferable.
// ---------------------------------------------------------------------------

function applyOnFailure(toolSlug: string, err: unknown): unknown {
  const actionDef = getActionDefinition(toolSlug);
  const directive: OnFailureDirective = actionDef?.onFailure ?? 'retry';
  return applyOnFailurePure(toolSlug, directive, actionDef?.fallbackValue, err);
}

function applyOnFailureForStructuredFailure(
  toolSlug: string,
  result: Record<string, unknown>,
): unknown {
  const actionDef = getActionDefinition(toolSlug);
  const directive: OnFailureDirective = actionDef?.onFailure ?? 'retry';
  return applyOnFailureForStructuredFailurePure(toolSlug, directive, actionDef?.fallbackValue, result);
}

// ---------------------------------------------------------------------------
// Per-tool processor hooks registry
// Maps action type slug → ProcessorHooks (input/output transform pipeline)
// ---------------------------------------------------------------------------

const processorRegistry: Map<string, ProcessorHooks> = new Map();

/** Register processor hooks for a tool slug. Called at module load time. */
export function registerProcessor(toolSlug: string, hooks: ProcessorHooks): void {
  processorRegistry.set(toolSlug, hooks);
}

/** Internal: run registered processor phases around a tool executor. */
export async function runWithProcessors(
  toolSlug: string,
  input: Record<string, unknown>,
  context: SkillExecutionContext,
  executor: (processedInput: Record<string, unknown>) => Promise<unknown>,
  actionId?: string,
): Promise<unknown> {
  const hooks = processorRegistry.get(toolSlug);
  const processorCtx: ProcessorContext = {
    toolSlug,
    input,
    subaccountId: context.subaccountId,
    organisationId: context.organisationId,
    agentRunId: context.runId,
    actionId,
  };

  let processedInput = input;

  // Phase 1: processInput (before gate)
  if (hooks?.processInput) {
    try {
      processedInput = (await hooks.processInput({ ...processorCtx, input: processedInput })) as Record<string, unknown>;
    } catch (err) {
      if (err instanceof TripWire) {
        if (!err.options.retry) throw err;  // fatal — propagate to caller
        return { success: false, error: err.reason, retryable: true };
      }
      throw err;
    }
  }

  // Phase 2: processInputStep (after gate, before execute)
  if (hooks?.processInputStep) {
    try {
      processedInput = (await hooks.processInputStep({ ...processorCtx, input: processedInput })) as Record<string, unknown>;
    } catch (err) {
      if (err instanceof TripWire) {
        if (!err.options.retry) throw err;
        return { success: false, error: err.reason, retryable: true };
      }
      throw err;
    }
  }

  // Execute — dispatch on actionDef.onFailure (P0.2 Slice C) for failures.
  let result: unknown;
  try {
    result = await executor(processedInput);
  } catch (err) {
    if (err instanceof TripWire) {
      return { success: false, error: err.reason, retryable: err.options.retry };
    }
    // Non-TripWire failure — apply the action's onFailure directive if declared.
    // When fail_run fires, record a system incident before propagating.
    const actionDef = getActionDefinition(toolSlug);
    if ((actionDef?.onFailure ?? 'retry') === 'fail_run') {
      recordIncident({
        source: 'skill',
        summary: `Skill terminal failure: ${toolSlug} — ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`,
        errorCode: 'skill_fail_run',
        stack: err instanceof Error ? err.stack : undefined,
        organisationId: context.organisationId,
        subaccountId: context.subaccountId,
        fingerprintOverride: `skill:${toolSlug}:fail_run`,
      });
    }
    return applyOnFailure(toolSlug, err);
  }

  // Successful return value but the executor signalled a structured failure.
  // Apply onFailure here too so 'skip' / 'fallback' fire on either error path.
  if (
    result !== null &&
    typeof result === 'object' &&
    (result as { success?: unknown }).success === false
  ) {
    // Symmetric with the thrown-error path: the pure helper already handles
    // 'retry' / unset by returning the result unchanged.
    result = applyOnFailureForStructuredFailure(toolSlug, result as Record<string, unknown>);
  }

  // Phase 3: processOutputStep (after execute)
  if (hooks?.processOutputStep) {
    try {
      result = await hooks.processOutputStep({ ...processorCtx, input: processedInput, actionId }, result);
    } catch (err) {
      if (err instanceof TripWire) {
        if (!err.options.retry) throw err;
        return { success: false, error: err.reason, retryable: true };
      }
      throw err;
    }
  }

  return result;
}

// Handoff job queue name
export const AGENT_HANDOFF_QUEUE = 'agent-handoff-run';

// pg-boss reference for enqueueing handoff jobs (set by agentScheduleService)
let pgBossSend: ((name: string, data: object, options?: PgBoss.SendOptions) => Promise<string | null>) | null = null;

export function setHandoffJobSender(sender: (name: string, data: object, options?: PgBoss.SendOptions) => Promise<string | null>) {
  pgBossSend = sender;
}

export type HandoffEnqueueResult =
  | { enqueued: true; runId: string; jobId: string }
  | { enqueued: false; runId: null; jobId: null; reason: 'duplicate' | 'no_link' | 'depth_cap' | 'no_sender' | 'send_failed' };

// Checked once on first call; subsequent calls skip the assertion for perf.
let _pgBossDbShapeAsserted = false;

function makePgBossDb(tx: any): PgBoss.Db {
  const transactionSql = tx._.session.client;
  if (!transactionSql) throw new Error('[Handoff] makePgBossDb: tx session client is null — withOrgTx contract violated');
  if (!_pgBossDbShapeAsserted) {
    // Verify the adapter contract holds at runtime. If this throws, a Drizzle
    // minor upgrade likely changed the internal session shape — see docs/adapter-contract.md.
    if (typeof transactionSql.unsafe !== 'function') {
      throw new Error('[Handoff] makePgBossDb: tx._.session.client.unsafe is not a function — adapter-contract.md violated; check Drizzle version');
    }
    _pgBossDbShapeAsserted = true;
  }
  return {
    async executeSql(text: string, values: unknown[]) {
      const rows = await transactionSql.unsafe(text, values as any[]);
      return { rows: rows as unknown[], rowCount: rows.length };
    },
  };
}

interface HandoffRequest {
  taskId: string;
  agentId: string;
  subaccountId: string;
  organisationId: string;
  sourceRunId: string;
  handoffDepth: number;
  handoffContext?: string;
}

export async function enqueueHandoff(req: HandoffRequest): Promise<HandoffEnqueueResult> {
  // Depth cap — structured event for observability (audit finding line 302).
  // logger.warn lands on the same Langfuse span as the surrounding run via
  // the request-ALS context.
  if (req.handoffDepth > MAX_HANDOFF_DEPTH) {
    logger.warn('handoff.depth_cap_rejected', {
      sourceRunId: req.sourceRunId,
      agentId: req.agentId,
      subaccountId: req.subaccountId,
      organisationId: req.organisationId,
      handoffDepth: req.handoffDepth,
      maxHandoffDepth: MAX_HANDOFF_DEPTH,
    });
    return { enqueued: false, runId: null, jobId: null, reason: 'depth_cap' };
  }

  // Look up the subaccount agent link for the target agent
  const [saLink] = await db
    .select({
      sa: subaccountAgents,
    })
    .from(subaccountAgents)
    .innerJoin(agents, and(eq(agents.id, subaccountAgents.agentId), isActive(agents)))
    .where(
      and(
        eq(subaccountAgents.subaccountId, req.subaccountId),
        eq(subaccountAgents.agentId, req.agentId),
        eq(subaccountAgents.isActive, true),
        eq(agents.status, 'active'),
      )
    );

  if (!saLink) {
    console.warn(`[Handoff] No active subaccount agent link for agent ${req.agentId} in subaccount ${req.subaccountId}`);
    return { enqueued: false, runId: null, jobId: null, reason: 'no_link' };
  }

  // Duplicate prevention: check for running/pending runs for same agent+task
  const [existingRun] = await db
    .select()
    .from(agentRuns)
    .where(
      and(
        eq(agentRuns.agentId, req.agentId),
        eq(agentRuns.taskId, req.taskId),
        eq(agentRuns.subaccountId, req.subaccountId)
      )
    )
    .limit(1);

  if (existingRun && (existingRun.status === 'running' || existingRun.status === 'pending')) {
    console.warn(`[Handoff] Agent ${req.agentId} already has a ${existingRun.status} run for task ${req.taskId}, skipping`);
    return { enqueued: false, runId: null, jobId: null, reason: 'duplicate' };
  }

  if (!pgBossSend) {
    console.warn('[Handoff] pg-boss sender not configured, cannot enqueue handoff');
    return { enqueued: false, runId: null, jobId: null, reason: 'no_sender' };
  }

  try {
    let runId!: string;
    let jobId!: string;

    await db.transaction(async (tx) => {
      const [newRun] = await tx
        .insert(agentRuns)
        .values({
          organisationId: req.organisationId,
          subaccountId: req.subaccountId,
          agentId: req.agentId,
          subaccountAgentId: saLink.sa.id,
          runType: 'triggered',
          runSource: 'handoff',
          executionMode: 'api',
          executionScope: 'subaccount',
          status: 'pending',
          taskId: req.taskId,
          handoffDepth: req.handoffDepth,
          parentRunId: req.sourceRunId,
          parentSpawnRunId: req.sourceRunId,
          principalType: 'service',
          principalId: `handoff:${req.sourceRunId}`,
        })
        .returning({ id: agentRuns.id });

      runId = newRun.id;

      const pgBossDb = makePgBossDb(tx);
      const sent = await pgBossSend!(AGENT_HANDOFF_QUEUE, {
        taskId: req.taskId,
        agentId: req.agentId,
        subaccountAgentId: saLink.sa.id,
        subaccountId: req.subaccountId,
        organisationId: req.organisationId,
        sourceRunId: req.sourceRunId,
        handoffDepth: req.handoffDepth,
        handoffContext: req.handoffContext,
        runId,
      }, { db: pgBossDb });

      jobId = sent ?? '';
    });

    // Emitted post-commit so subscribers see a row that exists (AE2 invariant)
    createEvent('agent.handoff.enqueued', {
      targetAgentId: req.agentId,
      sourceRunId: req.sourceRunId,
      handoffDepth: req.handoffDepth,
      taskId: req.taskId,
    });

    // Critical emission: awaited so it completes before the function returns.
    // emitAgentEvent catches internal throws — enqueueHandoff never re-throws on emission failure.
    await emitAgentEvent({
      runId: req.sourceRunId,
      organisationId: req.organisationId,
      subaccountId: req.subaccountId,
      sourceService: 'skillExecutor',
      payload: {
        eventType: 'handoff.decided',
        critical: true,
        targetAgentId: req.agentId,
        reasonText: req.handoffContext ?? '',
        depth: req.handoffDepth,
        parentRunId: req.sourceRunId,
      },
      linkedEntity: { type: 'agent', id: req.agentId },
    });

    return { enqueued: true, runId: runId!, jobId: jobId! };
  } catch (err) {
    console.error('[Handoff] Failed to enqueue handoff job:', err);
    return { enqueued: false, runId: null, jobId: null, reason: 'send_failed' };
  }
}
