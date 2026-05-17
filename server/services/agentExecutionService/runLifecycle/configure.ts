import { createHash } from 'crypto';
import { eq, and, count } from 'drizzle-orm';
import { agentRuns, subaccountAgents } from '../../../db/schema/index.js';
import { getOrgScopedDb } from '../../../lib/orgScopedDb.js';
import { agentService } from '../../agentService.js';
import { devContextService } from '../../devContextService.js';
import { checkWorkspaceLimits } from '../../middleware/index.js';
import { CONTROLLER_LIMITS } from '../../../config/controllerLimits.js';
import {
  resolvePolicyEnvelope,
  persist as persistPolicyEnvelope,
  ExecutionModeNotAllowedForAgentError,
} from '../../policyEnvelopeResolver.js';
import { executionModeToEnvironment } from '../../../../shared/types/executionEnvironment.js';
import { tryEmitAgentEvent } from '../../agentExecutionEventEmitter.js';
import { fingerprint } from '../../regressionCaptureServicePure.js';
import type { AgentRunRequest, AgentRunResult, RunExecutionContext } from '../types.js';

export async function configureRun(
  request: AgentRunRequest,
  ctx: RunExecutionContext,
): Promise<{ kind: 'early_exit_failed'; result: AgentRunResult } | { kind: 'configured' }> {
  const run = ctx.run!;
  const scopedDb = getOrgScopedDb('configure.configureRun');

  // ── 2. Load agent config ────────────────────────────────────────────
  const agent = await agentService.getAgent(request.agentId, request.organisationId);

  const [link] = await scopedDb
    .select()
    .from(subaccountAgents)
    .where(and(
      eq(subaccountAgents.id, request.subaccountAgentId!),
      eq(subaccountAgents.organisationId, request.organisationId),
    ));

  if (!link) throw Object.assign(new Error('Subaccount agent link not found'), { statusCode: 404, errorCode: 'SUBACCOUNT_AGENT_NOT_FOUND' });

  ctx.saLink = link;

  const controllerLimits = CONTROLLER_LIMITS[run.controllerStyle];
  const tokenBudget = Math.round(link.tokenBudgetPerRun * controllerLimits.defaultTokenBudgetMultiplier);
  const maxToolCalls = link.maxToolCallsPerRun;
  const timeoutMs = link.timeoutSeconds * 1000;
  const configSkillSlugs = (link.skillSlugs ?? []) as string[];
  const configCustomInstructions: string | null = link.customInstructions;

  // ── 2a. Snapshot resolved config for reproducibility ──────────────
  const resolvedConfig = {
    tokenBudget,
    maxToolCalls,
    timeoutMs,
    skillSlugs: configSkillSlugs,
    customInstructions: configCustomInstructions,
    executionScope: 'subaccount' as const,
  };
  const configHashValue = createHash('sha256').update(JSON.stringify(resolvedConfig)).digest('hex');

  await scopedDb.update(agentRuns).set({
    tokenBudget,
    configSnapshot: resolvedConfig,
    configHash: configHashValue,
    resolvedSkillSlugs: configSkillSlugs,
    resolvedLimits: { tokenBudget, maxToolCalls, timeoutMs },
  }).where(eq(agentRuns.id, run.id));

  ctx.agent = agent;
  ctx.tokenBudget = tokenBudget;
  ctx.maxToolCalls = maxToolCalls;
  ctx.timeoutMs = timeoutMs;
  ctx.configSkillSlugs = configSkillSlugs;
  ctx.configCustomInstructions = configCustomInstructions;
  ctx.configHash = configHashValue;
  ctx.configVersion = fingerprint(resolvedConfig);

  // ── 2b. Workspace limit check (pre-run guard) ─────────────────────
  const limitCheck = await checkWorkspaceLimits(request.subaccountId!, tokenBudget);
  if (!limitCheck.allowed) {
    const durationMs = Date.now() - ctx.startTime;
    await scopedDb.update(agentRuns).set({
      status: 'failed',
      errorMessage: limitCheck.reason ?? 'Workspace limit exceeded',
      errorDetail: {
        type: 'workspace_limit',
        dailyUsed: limitCheck.dailyUsed,
        dailyLimit: limitCheck.dailyLimit,
        requestedBudget: tokenBudget,
      },
      completedAt: new Date(),
      durationMs,
      updatedAt: new Date(),
    }).where(eq(agentRuns.id, run.id));

    return {
      kind: 'early_exit_failed',
      result: {
        runId: run.id,
        status: 'failed',
        summary: null,
        totalToolCalls: 0,
        totalTokens: 0,
        durationMs,
        tasksCreated: 0,
        tasksUpdated: 0,
        deliverablesCreated: 0,
      },
    };
  }

  // ── 2c. Snapshot DEC hash + iteration count into triggerContext ──
  try {
    const { hash: decHash } = await devContextService.getContext(request.subaccountId!);

    // Count prior runs for this task to determine current iteration
    let iteration = 0;
    if (request.taskId) {
      const [{ total }] = await scopedDb
        .select({ total: count() })
        .from(agentRuns)
        .where(and(
          eq(agentRuns.taskId, request.taskId),
          eq(agentRuns.subaccountId, request.subaccountId!),
        ));
      // Subtract 1 because current run is already inserted
      iteration = Math.max(0, Number(total) - 1);
    }

    const existingCtx = (request.triggerContext ?? {}) as Record<string, unknown>;
    await scopedDb.update(agentRuns).set({
      triggerContext: {
        ...existingCtx,
        executionSnapshot: {
          decHash,
          iteration,
          snapshotAt: new Date().toISOString(),
        },
      },
      updatedAt: new Date(),
    }).where(eq(agentRuns.id, run.id));
  } catch {
    // DEC not configured for this subaccount — skip snapshot (non-dev agents)
  }

  // ── 2d. Resolve and persist policy envelope (INV-19) ─────────────────
  // Must complete before any tool call, LLM call, or IEE dispatch.
  // On failure: run is transitioned to 'failed' and execution is aborted.
  try {
    const policyEnvelopeCtx = {
      runId: run.id,
      agentId: request.agentId,
      subaccountAgentId: request.subaccountAgentId!,
      organisationId: request.organisationId,
      subaccountId: request.subaccountId!,
      controllerStyle: run.controllerStyle,
      executionMode: request.executionMode ?? 'api',
      tokenBudget,
      maxToolCalls,
    };
    const snapshot = await resolvePolicyEnvelope(policyEnvelopeCtx);
    await persistPolicyEnvelope(run.id, snapshot);

    // Enforce allowedEnvironments (spec §4.2.8). The envelope captures
    // the constraint at run start; this gate rejects a run whose
    // requested executionMode maps to an environment the agent is not
    // permitted to use. Without this check, a Governance-tab restriction
    // (e.g. browser-disabled) is silently ignored.
    const requestedEnv = executionModeToEnvironment(
      request.executionMode ?? 'api',
    );
    if (!snapshot.allowedEnvironments.includes(requestedEnv)) {
      throw new ExecutionModeNotAllowedForAgentError(
        request.executionMode ?? 'api',
        requestedEnv,
      );
    }

    tryEmitAgentEvent({
      runId: run.id,
      organisationId: request.organisationId,
      subaccountId: request.subaccountId ?? null,
      sourceService: 'agentExecutionService',
      payload: {
        eventType: 'foundation.policy_envelope.resolved',
        critical: false,
        runId: run.id,
        schemaVersion: 1,
        sourceCounts: {
          activePolicyRuleIds: snapshot.activePolicyRuleIds.length,
          availableCredentialIds: snapshot.availableCredentialIds.length,
          allowedSkillSlugs: snapshot.allowedSkillSlugs.length,
        },
      },
      linkedEntity: { type: 'agent', id: request.agentId },
    });

    ctx.policyEnvelope = snapshot;
  } catch (envelopeErr) {
    const durationMs = Date.now() - ctx.startTime;
    const isEnvViolation = envelopeErr instanceof ExecutionModeNotAllowedForAgentError;
    const failureType = isEnvViolation
      ? 'execution_mode_not_allowed_for_agent'
      : 'policy_envelope_resolution_failed';

    tryEmitAgentEvent({
      runId: run.id,
      organisationId: request.organisationId,
      subaccountId: request.subaccountId ?? null,
      sourceService: 'agentExecutionService',
      payload: {
        eventType: isEnvViolation
          ? 'foundation.execution_environment.rejected'
          : 'foundation.policy_envelope.resolution_failed',
        critical: false,
        runId: run.id,
        error: envelopeErr instanceof Error ? envelopeErr.message : String(envelopeErr),
      },
      linkedEntity: { type: 'agent', id: request.agentId },
    });

    await scopedDb.update(agentRuns).set({
      status: 'failed',
      errorMessage: envelopeErr instanceof Error ? envelopeErr.message : 'Policy envelope resolution failed',
      errorDetail: {
        type: failureType,
        failureReason: failureType,
      },
      completedAt: new Date(),
      durationMs,
      updatedAt: new Date(),
    }).where(eq(agentRuns.id, run.id));

    return {
      kind: 'early_exit_failed',
      result: {
        runId: run.id,
        status: 'failed',
        summary: null,
        totalToolCalls: 0,
        totalTokens: 0,
        durationMs,
        tasksCreated: 0,
        tasksUpdated: 0,
        deliverablesCreated: 0,
      },
    };
  }

  ctx.maxLoopIterations = CONTROLLER_LIMITS[run.controllerStyle].maxLoopIterations;

  return { kind: 'configured' };
}
