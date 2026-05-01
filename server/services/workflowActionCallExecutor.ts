/**
 * Workflow Action Call Executor — thin bridge between the Workflow engine
 * dispatch path and the existing action pipeline.
 *
 * Spec: docs/onboarding-Workflows-spec.md §4.6.
 *
 * Responsibility: given a resolved action slug + resolved inputs + the caller
 * context (run + step run + agent id + idempotency key), route through
 * `actionService.proposeAction` → `skillExecutor.execute` and return a
 * structured result to the engine dispatcher. The engine decides how to
 * transition the step-run row based on the result status.
 *
 * This helper deliberately does NOT:
 *   - update `workflowStepRuns` — the engine owns that.
 *   - handle replay mode — the engine short-circuits replay before calling us.
 *   - perform side-effect cleanup on failure — idempotency + actions audit do that.
 */

import { eq, and, sql, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { actions, agents, systemAgents } from '../db/schema/index.js';
import type { Action } from '../db/schema/index.js';
import { actionService } from './actionService.js';
import { skillExecutor, type SkillExecutionContext } from './skillExecutor.js';
import { maybeTruncateOutput } from './workflowActionCallExecutorPure.js';

const DEFAULT_ACTION_TIMEOUT_MS = 30_000;
const MAX_ACTION_TIMEOUT_MS = 120_000;

export class ActionTimeoutError extends Error {
  readonly actionSlug: string;
  readonly timeoutMs: number;
  constructor(actionSlug: string, timeoutMs: number) {
    super(`action_timeout: '${actionSlug}' exceeded ${timeoutMs}ms`);
    this.name = 'ActionTimeoutError';
    this.actionSlug = actionSlug;
    this.timeoutMs = timeoutMs;
  }
}

export interface ActionCallExecuteArgs {
  organisationId: string;
  subaccountId: string;
  /** Configuration Assistant's org agent row id — resolved at run start. */
  agentId: string;
  /** Workflow step run id for audit metadata + HITL resumption linking. */
  WorkflowStepRunId: string;
  /** Run id (threaded to skill context.runId). */
  WorkflowRunId: string;
  actionSlug: string;
  actionInputs: Record<string, unknown>;
  idempotencyKey: string;
  /** Defaults to 30s. Clamped to 120s. */
  timeoutMs?: number;
}

export type ActionCallExecuteResult =
  | { status: 'approved_and_executed'; actionId: string; output: unknown }
  | { status: 'pending_approval'; actionId: string }
  | { status: 'blocked'; actionId: string; reason?: string }
  | { status: 'failed'; actionId: string; error: string };

/**
 * Resolves the Configuration Assistant's agent id for an organisation.
 * Returns null if the org does not have the Configuration Assistant installed.
 * Spec §4.8.
 */
export async function resolveConfigurationAssistantAgentId(
  orgId: string,
): Promise<string | null> {
  const rows = await db
    .select({ agentId: agents.id })
    .from(agents)
    .innerJoin(systemAgents, and(eq(agents.systemAgentId, systemAgents.id), isNull(systemAgents.deletedAt)))
    .where(
      and(
        eq(agents.organisationId, orgId),
        eq(systemAgents.slug, 'configuration-assistant'),
      ),
    );
  return rows[0]?.agentId ?? null;
}

/**
 * Propose + execute an action from a Workflow step. Returns a structured
 * result; the caller handles the status transition on `workflowStepRuns`.
 */
export async function executeActionCall(
  args: ActionCallExecuteArgs,
): Promise<ActionCallExecuteResult> {
  const timeoutMs = Math.min(
    args.timeoutMs ?? DEFAULT_ACTION_TIMEOUT_MS,
    MAX_ACTION_TIMEOUT_MS,
  );

  let proposed;
  try {
    proposed = await actionService.proposeAction({
      organisationId: args.organisationId,
      subaccountId: args.subaccountId,
      agentId: args.agentId,
      actionType: args.actionSlug,
      idempotencyKey: args.idempotencyKey,
      payload: args.actionInputs,
      metadata: {
        source: 'workflow_action_call',
        WorkflowStepRunId: args.WorkflowStepRunId,
        WorkflowRunId: args.WorkflowRunId,
      },
    });
  } catch (err) {
    return {
      status: 'failed',
      actionId: '',
      error: `propose_action_failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (proposed.status === 'blocked') {
    return { status: 'blocked', actionId: proposed.actionId };
  }

  if (proposed.status === 'pending_approval') {
    return { status: 'pending_approval', actionId: proposed.actionId };
  }

  if (proposed.status !== 'approved') {
    // Any other non-terminal status is unexpected — surface as failure.
    return {
      status: 'failed',
      actionId: proposed.actionId,
      error: `unexpected_action_status: ${proposed.status}`,
    };
  }

  // Approved → execute the skill handler, wrapped in a timeout race.
  const context: SkillExecutionContext = {
    runId: args.WorkflowRunId,
    organisationId: args.organisationId,
    subaccountId: args.subaccountId,
    agentId: args.agentId,
    orgProcesses: [],
  };

  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const output = await Promise.race([
      skillExecutor.execute({
        skillName: args.actionSlug,
        input: args.actionInputs,
        context,
      }),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new ActionTimeoutError(args.actionSlug, timeoutMs));
        }, timeoutMs);
      }),
    ]);

    // Structured failure returned from the handler (common pattern).
    if (
      output &&
      typeof output === 'object' &&
      (output as { success?: boolean }).success === false
    ) {
      const errMsg =
        (output as { error?: string }).error ??
        'skill_returned_failure';
      // Transition the action row to 'failed' so audit reflects reality.
      try {
        await actionService.transitionState(
          proposed.actionId,
          args.organisationId,
          'failed',
        );
      } catch {
        /* best-effort audit transition */
      }
      return { status: 'failed', actionId: proposed.actionId, error: errMsg };
    }

    // Mark the action as completed for audit completeness.
    try {
      await actionService.transitionState(
        proposed.actionId,
        args.organisationId,
        'completed',
      );
    } catch {
      /* best-effort audit transition */
    }

    const sizedOutput = maybeTruncateOutput(output);
    return {
      status: 'approved_and_executed',
      actionId: proposed.actionId,
      output: sizedOutput,
    };
  } catch (err) {
    if (err instanceof ActionTimeoutError) {
      try {
        await actionService.transitionState(
          proposed.actionId,
          args.organisationId,
          'failed',
        );
      } catch {
        /* best-effort audit transition */
      }
      throw err;
    }
    try {
      await actionService.transitionState(
        proposed.actionId,
        args.organisationId,
        'failed',
      );
    } catch {
      /* best-effort audit transition */
    }
    return {
      status: 'failed',
      actionId: proposed.actionId,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Look up the action row for a given workflow_step_run_id. Used by HITL
 * resumption after approval. Spec §4.7. Uses the JSON ->> operator to
 * match on the embedded `WorkflowStepRunId` key set by this module's
 * `executeActionCall()` call.
 */
export async function findActionByWorkflowStepRunId(
  stepRunId: string,
): Promise<{ id: string; status: string } | null> {
  const rows = await db
    .select({
      id: actions.id,
      status: actions.status,
    })
    .from(actions)
    .where(sql`${actions.metadataJson}->>'WorkflowStepRunId' = ${stepRunId}`)
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Raw config_* skill handler dispatch map — keyed by action slug. Used by the
 * HITL resumption path (§4.7) to run the mutation WITHOUT going back through
 * `executeWithActionAudit` (which would propose a second action row).
 *
 * The auto-gated path in the engine still goes through `skillExecutor.execute`
 * because that path has no pre-existing audit row to reuse. The HITL path
 * already has an approved action row from the original `executeActionCall`;
 * we bypass the wrapper so both the approval decision and the execution
 * outcome land on the same action row.
 */
type RawHandler = (
  input: Record<string, unknown>,
  context: SkillExecutionContext,
) => Promise<unknown>;

const RAW_CONFIG_HANDLERS: Record<string, () => Promise<RawHandler>> = {
  config_create_agent: async () =>
    (await import('../tools/config/configSkillHandlers.js')).executeConfigCreateAgent,
  config_update_agent: async () =>
    (await import('../tools/config/configSkillHandlers.js')).executeConfigUpdateAgent,
  config_activate_agent: async () =>
    (await import('../tools/config/configSkillHandlers.js')).executeConfigActivateAgent,
  config_link_agent: async () =>
    (await import('../tools/config/configSkillHandlers.js')).executeConfigLinkAgent,
  config_update_link: async () =>
    (await import('../tools/config/configSkillHandlers.js')).executeConfigUpdateLink,
  config_set_link_skills: async () =>
    (await import('../tools/config/configSkillHandlers.js')).executeConfigSetLinkSkills,
  config_set_link_instructions: async () =>
    (await import('../tools/config/configSkillHandlers.js')).executeConfigSetLinkInstructions,
  config_set_link_schedule: async () =>
    (await import('../tools/config/configSkillHandlers.js')).executeConfigSetLinkSchedule,
  config_set_link_limits: async () =>
    (await import('../tools/config/configSkillHandlers.js')).executeConfigSetLinkLimits,
  config_create_subaccount: async () =>
    (await import('../tools/config/configSkillHandlers.js')).executeConfigCreateSubaccount,
  config_create_scheduled_task: async () =>
    (await import('../tools/config/configSkillHandlers.js')).executeConfigCreateScheduledTask,
  config_update_scheduled_task: async () =>
    (await import('../tools/config/configSkillHandlers.js')).executeConfigUpdateScheduledTask,
  config_attach_data_source: async () =>
    (await import('../tools/config/configSkillHandlers.js')).executeConfigAttachDataSource,
  config_update_data_source: async () =>
    (await import('../tools/config/configSkillHandlers.js')).executeConfigUpdateDataSource,
  config_remove_data_source: async () =>
    (await import('../tools/config/configSkillHandlers.js')).executeConfigRemoveDataSource,
  config_restore_version: async () =>
    (await import('../tools/config/configSkillHandlers.js')).executeConfigRestoreVersion,
};

async function invokeRawActionHandler(
  slug: string,
  input: Record<string, unknown>,
  context: SkillExecutionContext,
): Promise<unknown> {
  const loader = RAW_CONFIG_HANDLERS[slug];
  if (!loader) {
    throw new Error(`no_raw_handler_for_action_call: '${slug}'`);
  }
  const handler = await loader();
  return handler(input, context);
}

export interface ResumeActionCallArgs {
  action: Action;
  approverUserId: string;
}

export interface ResumeActionCallResult {
  stepRunId: string;
  runId: string;
  status: 'completed' | 'failed';
  output?: unknown;
  error?: string;
}

/**
 * HITL resumption — runs the mutation after a human approves the review item
 * for an `action_call` step. Spec §4.7.
 *
 * The caller (reviewService.approveItem branch) has already transitioned the
 * action row to `approved`. We:
 *   1. Lock the action for execution ('approved' → 'executing').
 *   2. Dispatch the raw config skill handler directly (bypassing the audit
 *      wrapper so both decision + execution land on the same row).
 *   3. Transition the action to `completed` / `failed` based on the outcome.
 *   4. Resume the Workflow step run via
 *      `WorkflowEngineService.completeStepRunFromReview` /
 *      `failStepRunInternal`.
 *
 * Errors are contained — any failure during resumption flips the action +
 * step run to failed with a descriptive reason. This never re-throws into
 * the approval path because the approval itself succeeded.
 */
export async function resumeActionCallAfterApproval(
  args: ResumeActionCallArgs,
): Promise<ResumeActionCallResult | null> {
  const action = args.action;
  const meta = (action.metadataJson ?? null) as Record<string, unknown> | null;
  const stepRunId = meta?.WorkflowStepRunId as string | undefined;
  const runId = meta?.WorkflowRunId as string | undefined;
  if (!stepRunId || !runId) {
    return null;
  }

  // Load the step run + Workflow run so we have subaccountId for the
  // execution context and the full WorkflowStepRun row for the engine.
  const { workflowStepRuns, workflowRuns } = await import('../db/schema/index.js');
  const [sr] = await db
    .select()
    .from(workflowStepRuns)
    .where(eq(workflowStepRuns.id, stepRunId));
  if (!sr) {
    return { stepRunId, runId, status: 'failed', error: 'step_run_not_found' };
  }
  // If the step run has already been resolved (e.g. double-approval race),
  // do nothing.
  if (sr.status !== 'awaiting_approval') {
    return { stepRunId, runId, status: 'failed', error: `step_run_wrong_status: ${sr.status}` };
  }
  const [run] = await db
    .select()
    .from(workflowRuns)
    .where(eq(workflowRuns.id, runId));
  if (!run) {
    return { stepRunId, runId, status: 'failed', error: 'workflow_run_not_found' };
  }

  // 1. Lock action for execution (approved → executing). Idempotent: returns
  //    false if another worker already took the lock.
  const locked = await actionService.lockForExecution(action.id, action.organisationId);
  if (!locked) {
    return { stepRunId, runId, status: 'failed', error: 'action_lock_failed' };
  }

  // Engine is imported dynamically to avoid a service-graph cycle
  const { WorkflowEngineService } = await import('./workflowEngineService.js');

  const context: SkillExecutionContext = {
    runId,
    organisationId: action.organisationId,
    subaccountId: action.subaccountId,
    agentId: action.agentId,
    orgProcesses: [],
  };

  try {
    const output = await invokeRawActionHandler(
      action.actionType,
      (action.payloadJson ?? {}) as Record<string, unknown>,
      context,
    );

    // Structured skill failure — surface as action + step failure.
    if (
      output &&
      typeof output === 'object' &&
      (output as { success?: boolean }).success === false
    ) {
      const errMsg =
        (output as { error?: string }).error ?? 'skill_returned_failure';
      await actionService.markFailed(action.id, action.organisationId, errMsg);
      await WorkflowEngineService.failStepRunInternal(sr, `action_failed: ${errMsg}`);
      return { stepRunId, runId, status: 'failed', error: errMsg };
    }

    const sizedOutput = maybeTruncateOutput(output);
    await actionService.markCompleted(action.id, action.organisationId, sizedOutput);
    await WorkflowEngineService.completeStepRunFromReview(
      sr,
      sizedOutput,
      'action_call_after_review',
      args.approverUserId,
    );
    return { stepRunId, runId, status: 'completed', output: sizedOutput };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await actionService.markFailed(action.id, action.organisationId, message);
    await WorkflowEngineService.failStepRunInternal(
      sr,
      `action_call_error: ${message}`,
    );
    return { stepRunId, runId, status: 'failed', error: message };
  }
}

