import type { SkillExecutionContext } from '../context.js';
import { HIERARCHY_CONTEXT_MISSING, CROSS_SUBTREE_NOT_PERMITTED, DELEGATION_OUT_OF_SCOPE } from '../../../../shared/types/delegation.js';
import { classifySpawnTargets, evaluateSpawnPreconditions, resolveWriteSkillScope } from '../../skillExecutorDelegationPure.js';
import { computeDescendantIds } from '../../../tools/config/configSkillHandlersPure.js';
import { executeTriggerredProcess } from '../../llmService.js';
import { agentExecutionService } from '../../agentExecutionService.js';
import { db } from '../../../db/index.js';
import { subaccountAgents, agents } from '../../../db/schema/index.js';
import { eq, and } from 'drizzle-orm';
import { isActive } from '../../../lib/queryHelpers.js';
import { MAX_HANDOFF_DEPTH, MAX_SUB_AGENTS, MIN_SUB_AGENT_TOKEN_BUDGET, SUB_AGENT_TIMEOUT_BUFFER, MAX_TASK_TITLE_LENGTH, MAX_TASK_DESCRIPTION_LENGTH } from '../../../config/limits.js';
import { insertOutcomeSafe } from '../../delegationOutcomeService.js';
import { insertExecutionEventSafe } from '../../agentExecutionEventService.js';
import { taskService } from '../../taskService.js';
import { createEvent } from '../../../lib/tracing.js';
import { getOrgScopedDb } from '../../../lib/orgScopedDb.js';

// ---------------------------------------------------------------------------
// Trigger Task
// ---------------------------------------------------------------------------

export async function executeTriggerProcess(
  input: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  const processId = String(input.process_id ?? '');
  const inputData = String(input.input_data ?? '{}');
  const reason = String(input.reason ?? '');
  const configOverridesStr = String(input.config_overrides ?? '{}');

  if (!processId) return { success: false, error: 'process_id is required' };

  let configOverrides: Record<string, unknown> | undefined;
  try {
    const parsed = JSON.parse(configOverridesStr);
    if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
      configOverrides = parsed;
    }
  } catch { /* ignore parse errors */ }

  try {
    const result = await executeTriggerredProcess(
      context.organisationId,
      processId,
      context.agentId,
      inputData,
      {
        subaccountId: context.subaccountId ?? undefined,
        triggerType: 'agent',
        triggerSourceId: context.runId,
        configOverrides,
      }
    );

    return {
      success: true,
      execution_id: result.executionId,
      process_name: result.processName,
      status: result.status,
      message: `Process "${result.processName}" has been queued. Execution ID: ${result.executionId}`,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Failed to trigger process: ${errMsg}` };
  }
}

// ---------------------------------------------------------------------------
// Spawn Sub-Agents — parallel execution of 2-3 sub-tasks
// ---------------------------------------------------------------------------

export async function executeSpawnSubAgents(
  input: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  // --- STEP 1: Validate input structure ---
  const subTasks = input.sub_tasks as Array<{ title: string; brief: string; assigned_agent_id: string }> | undefined;

  if (!subTasks || !Array.isArray(subTasks)) {
    return { success: false, error: 'sub_tasks array is required' };
  }
  if (subTasks.length < 2 || subTasks.length > MAX_SUB_AGENTS) {
    return { success: false, error: `sub_tasks must contain 2-${MAX_SUB_AGENTS} items` };
  }
  for (const st of subTasks) {
    if (!st.title || !st.brief || !st.assigned_agent_id) {
      return { success: false, error: 'Each sub-task requires title, brief, and assigned_agent_id' };
    }
  }

  // --- STEP 2: Compute effective scope ---
  const effectiveScope = context.hierarchy
    ? resolveWriteSkillScope({ rawScope: input.delegationScope, hierarchy: context.hierarchy })
    : 'children'; // dummy — evaluateSpawnPreconditions rejects before using this

  // --- STEP 3: Evaluate preconditions (hierarchy + depth + subaccount-scope) ---
  const spawnPre = evaluateSpawnPreconditions({
    hierarchy: context.hierarchy,
    currentHandoffDepth: context.handoffDepth ?? 0,
    maxHandoffDepth: MAX_HANDOFF_DEPTH,
    effectiveScope,
  });

  if (!spawnPre.ok) {
    if (spawnPre.errorCode === 'hierarchy_context_missing') {
      const errorCtx = { runId: context.runId, callerAgentId: context.agentId, skillSlug: 'spawn_sub_agents' };
      await insertExecutionEventSafe({
        runId: context.runId,
        organisationId: context.organisationId,
        subaccountId: context.subaccountId ?? null,
        payload: { eventType: 'tool.error', critical: false, error: { code: HIERARCHY_CONTEXT_MISSING, message: 'Hierarchy context is missing', context: errorCtx } },
        sourceService: 'skillExecutor',
      });
      return { success: false, error: HIERARCHY_CONTEXT_MISSING, context: errorCtx };
    }
    if (spawnPre.errorCode === 'max_handoff_depth_exceeded') {
      return { success: false, error: `Handoff depth limit (${MAX_HANDOFF_DEPTH}) reached. Cannot spawn sub-agents at this depth.` };
    }
    // cross_subtree_not_permitted
    const hierarchy = context.hierarchy!;
    const errorCtx = {
      runId: context.runId,
      callerAgentId: context.agentId,
      callerParentId: hierarchy.parentId,
      suggestedScope: hierarchy.childIds.length > 0 ? 'children' : 'descendants',
    };
    for (const st of subTasks) {
      await insertOutcomeSafe({
        organisationId: context.organisationId,
        subaccountId: context.subaccountId!,
        runId: context.runId,
        callerAgentId: hierarchy.agentId,
        targetAgentId: st.assigned_agent_id,
        delegationScope: effectiveScope,
        outcome: 'rejected',
        reason: CROSS_SUBTREE_NOT_PERMITTED,
        delegationDirection: 'lateral',
      });
    }
    await insertExecutionEventSafe({
      runId: context.runId,
      organisationId: context.organisationId,
      subaccountId: context.subaccountId ?? null,
      payload: { eventType: 'tool.error', critical: false, error: { code: CROSS_SUBTREE_NOT_PERMITTED, message: 'Cross-subtree spawn is not permitted. Use children or descendants scope.', context: errorCtx } },
      sourceService: 'skillExecutor',
    });
    return { success: false, error: CROSS_SUBTREE_NOT_PERMITTED, context: errorCtx };
  }

  const hierarchy = context.hierarchy!;
  const safeScope = spawnPre.effectiveScope;

  // --- STEP 4: Budget check ---
  const totalBudget = context.tokenBudget ?? 30000;
  const elapsed = context.startTime ? Date.now() - context.startTime : 0;
  const totalTimeout = context.timeoutMs ?? 300000;
  const remainingTimeMs = Math.max(totalTimeout - elapsed, 30000);
  const perChildBudget = Math.floor(totalBudget / subTasks.length);
  const perChildTimeout = Math.floor(remainingTimeMs / SUB_AGENT_TIMEOUT_BUFFER);

  if (perChildBudget < MIN_SUB_AGENT_TOKEN_BUDGET) {
    return { success: false, error: `Insufficient token budget remaining for ${subTasks.length} sub-agents. Need at least ${MIN_SUB_AGENT_TOKEN_BUDGET * subTasks.length} tokens.` };
  }

  // --- STEP 7: Resolve saLinks for all targets ---
  // Must be done before scope classification because we need subaccountAgentIds.
  const resolvedTargets: Array<{ st: typeof subTasks[0]; saLink: { id: string; agentId: string } }> = [];
  for (const st of subTasks) {
    const [saLink] = await db
      .select({ sa: subaccountAgents })
      .from(subaccountAgents)
      .innerJoin(agents, and(eq(agents.id, subaccountAgents.agentId), isActive(agents)))
      .where(
        and(
          eq(subaccountAgents.subaccountId, context.subaccountId!),
          eq(subaccountAgents.agentId, st.assigned_agent_id),
          eq(subaccountAgents.isActive, true),
          eq(agents.status, 'active'),
        )
      );

    if (!saLink) {
      return { success: false, error: `Agent ${st.assigned_agent_id} not found or inactive in this subaccount` };
    }

    resolvedTargets.push({ st, saLink: { id: saLink.sa.id, agentId: st.assigned_agent_id } });
  }

  // --- STEP 8: Compute descendant ids if needed ---
  let descendantIds: string[] = [];
  if (safeScope === 'descendants') {
    const rosterRows = await db
      .select({
        subaccountAgentId: subaccountAgents.id,
        agentId: subaccountAgents.agentId,
        parentSubaccountAgentId: subaccountAgents.parentSubaccountAgentId,
      })
      .from(subaccountAgents)
      .where(
        and(
          eq(subaccountAgents.subaccountId, context.subaccountId!),
          eq(subaccountAgents.organisationId, context.organisationId),
          eq(subaccountAgents.isActive, true)
        )
      );
    descendantIds = computeDescendantIds({
      callerSubaccountAgentId: hierarchy.agentId,
      roster: rosterRows.map(r => ({
        subaccountAgentId: r.subaccountAgentId,
        agentId: r.agentId,
        parentSubaccountAgentId: r.parentSubaccountAgentId ?? null,
      })),
    });
  }

  // --- STEP 9: Scope classification ---
  const { accepted, rejected } = classifySpawnTargets({
    proposedSubaccountAgentIds: resolvedTargets.map(t => t.saLink.id),
    effectiveScope: safeScope,
    childIds: hierarchy.childIds,
    descendantIds,
  });

  if (rejected.length > 0) {
    const rejectedTargets = resolvedTargets.filter(t => rejected.includes(t.saLink.id));
    for (const t of rejectedTargets) {
      await insertOutcomeSafe({
        organisationId: context.organisationId,
        subaccountId: context.subaccountId!,
        runId: context.runId,
        callerAgentId: hierarchy.agentId,
        targetAgentId: t.saLink.id,
        delegationScope: safeScope,
        outcome: 'rejected',
        reason: DELEGATION_OUT_OF_SCOPE,
        delegationDirection: 'down',
      });
    }
    const rejectedAgentIds = rejectedTargets.map(t => t.saLink.agentId);
    const callerChildIds = hierarchy.childIds.slice(0, 50);
    const errorCtx: Record<string, unknown> = {
      runId: context.runId,
      callerAgentId: context.agentId,
      targetAgentId: rejectedAgentIds[0],
      delegationScope: safeScope,
      callerChildIds,
    };
    if (hierarchy.childIds.length > 50) errorCtx.truncated = true;
    await insertExecutionEventSafe({
      runId: context.runId,
      organisationId: context.organisationId,
      subaccountId: context.subaccountId ?? null,
      payload: { eventType: 'tool.error', critical: false, error: { code: DELEGATION_OUT_OF_SCOPE, message: 'One or more spawn targets are outside delegation scope.', context: errorCtx } },
      sourceService: 'skillExecutor',
    });
    return { success: false, error: DELEGATION_OUT_OF_SCOPE, context: errorCtx };
  }

  // --- STEP 10: Execute spawn ---
  try {
    // Create task cards for all accepted targets
    const childJobs: Array<{
      task: { id: string; title: string };
      saLink: { id: string; agentId: string };
    }> = [];

    for (const t of resolvedTargets) {
      const tx = getOrgScopedDb('service:skillExecutor.executeSpawnSubAgents');
      const task = await taskService.createTask(
        {
          organisationId: context.organisationId,
          subaccountId: context.subaccountId!,
          data: {
            title: t.st.title.slice(0, MAX_TASK_TITLE_LENGTH),
            brief: t.st.brief.slice(0, MAX_TASK_DESCRIPTION_LENGTH),
            status: 'in_progress',
            assignedAgentId: t.st.assigned_agent_id,
            createdByAgentId: context.agentId,
            isSubTask: true,
            parentTaskId: context.runId,
          },
        },
        tx,
      );
      childJobs.push({ task, saLink: t.saLink });
    }

    // Execute all children in parallel
    createEvent('agent.spawn.fanout', {
      fanOutCount: childJobs.length,
      perChildBudget,
      perChildTimeoutMs: perChildTimeout,
    });
    const childResults = await Promise.all(
      childJobs.map(async (job) => {
        try {
          const result = await agentExecutionService.executeRun({
            agentId: job.saLink.agentId,
            subaccountId: context.subaccountId,
            subaccountAgentId: job.saLink.id,
            organisationId: context.organisationId,
            executionScope: 'subaccount',
            runType: 'triggered',
            runSource: 'sub_agent',
            executionMode: 'api',
            taskId: job.task.id,
            triggerContext: {
              type: 'sub_agent',
              parentRunId: context.runId,
            },
            isSubAgent: true,
            parentSpawnRunId: context.runId,
            delegationScope: safeScope,
            delegationDirection: 'down',
          });

          return {
            title: job.task.title,
            status: result.status,
            summary: result.summary,
            task_id: job.task.id,
            agent_run_id: result.runId,
            tokens_used: result.totalTokens,
          };
        } catch (err) {
          return {
            title: job.task.title,
            status: 'failed' as const,
            summary: null,
            error: err instanceof Error ? err.message : String(err),
            task_id: job.task.id,
            agent_run_id: null,
            tokens_used: 0,
          };
        }
      })
    );

    // Write accepted outcome rows (fire-and-forget per INV-3)
    for (const t of resolvedTargets) {
      void insertOutcomeSafe({
        organisationId: context.organisationId,
        subaccountId: context.subaccountId!,
        runId: context.runId,
        callerAgentId: hierarchy.agentId,
        targetAgentId: t.saLink.id,
        delegationScope: safeScope,
        outcome: 'accepted',
        reason: null,
        delegationDirection: 'down',
      });
    }

    const totalTokens = childResults.reduce((sum, r) => sum + (r.tokens_used ?? 0), 0);

    return {
      success: true,
      results: childResults,
      total_tokens: totalTokens,
      total_duration_ms: Date.now() - (context.startTime ?? Date.now()),
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Failed to spawn sub-agents: ${errMsg}` };
  }
}

