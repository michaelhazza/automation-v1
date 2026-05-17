import type { SkillExecutionContext } from '../context.js';
import { HIERARCHY_CONTEXT_MISSING, CROSS_SUBTREE_NOT_PERMITTED, DELEGATION_OUT_OF_SCOPE } from '../../../../shared/types/delegation.js';
import { classifySpawnTargets, evaluateSpawnPreconditions, resolveWriteSkillScope } from '../../skillExecutorDelegationPure.js';
import { computeDescendantIds } from '../../../tools/config/configSkillHandlersPure.js';
import { executeTriggerredProcess } from '../../llmService.js';
import { db } from '../../../db/index.js';
import { subaccountAgents, agents, agentRuns } from '../../../db/schema/index.js';
import { eq, and, inArray, or } from 'drizzle-orm';
import { isActive } from '../../../lib/queryHelpers.js';
import { MAX_HANDOFF_DEPTH, MAX_SUB_AGENTS, MIN_SUB_AGENT_TOKEN_BUDGET, SUB_AGENT_TIMEOUT_BUFFER, MAX_TASK_TITLE_LENGTH, MAX_TASK_DESCRIPTION_LENGTH } from '../../../config/limits.js';
import { insertOutcomeSafe } from '../../delegationOutcomeService.js';
import { insertExecutionEventSafe } from '../../agentExecutionEventService.js';
import { taskService } from '../../taskService.js';
import { createEvent } from '../../../lib/tracing.js';
import { getOrgScopedDb } from '../../../lib/orgScopedDb.js';
import { enqueueHandoff } from '../pipeline.js';
import { isTerminalRunStatus } from '../../../../shared/runStatus.js';

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
    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
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
    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
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
  const { accepted: _accepted, rejected } = classifySpawnTargets({
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
    const pollIntervalMs = 1000;
    const spawnDeadlineMs = (context.startTime ?? Date.now()) + (context.timeoutMs ?? 300000);

    // Create task cards for all accepted targets
    const childJobs: Array<{
      task: { id: string; title: string };
      saLink: { id: string; agentId: string };
      runId: string | null;
      enqueueError: string | null;
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

      const enqueueResult = await enqueueHandoff({
        taskId: task.id,
        agentId: t.saLink.agentId,
        subaccountId: context.subaccountId!,
        organisationId: context.organisationId,
        sourceRunId: context.runId,
        handoffDepth: (context.handoffDepth ?? 0) + 1,
      });

      let resolvedRunId: string | null = null;
      let enqueueError: string | null = null;

      if (enqueueResult.enqueued) {
        resolvedRunId = enqueueResult.runId;
      } else if (enqueueResult.reason === 'duplicate') {
        // Resolve the existing running/pending run for this agent+task
        // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
        const [existingRun] = await db
          .select({ id: agentRuns.id })
          .from(agentRuns)
          .where(
            and(
              eq(agentRuns.agentId, t.saLink.agentId),
              eq(agentRuns.taskId, task.id),
              eq(agentRuns.subaccountId, context.subaccountId!),
              or(
                eq(agentRuns.status, 'running'),
                eq(agentRuns.status, 'pending'),
              ),
            )
          )
          .limit(1);
        resolvedRunId = existingRun?.id ?? null;
        if (!resolvedRunId) {
          enqueueError = 'duplicate_run_not_found';
        }
      } else {
        enqueueError = enqueueResult.reason;
      }

      childJobs.push({ task, saLink: t.saLink, runId: resolvedRunId, enqueueError });
    }

    createEvent('agent.spawn.fanout', {
      fanOutCount: childJobs.length,
      perChildBudget,
      perChildTimeoutMs: perChildTimeout,
    });

    // Separate immediately-failed enqueues from those with runIds to poll
    type ChildResult = {
      title: string;
      status: string;
      summary: string | null;
      task_id: string;
      agent_run_id: string | null;
      tokens_used: number;
      error?: string;
    };

    const settled: ChildResult[] = [];
    const polling: Array<{ job: (typeof childJobs)[0] }> = [];

    for (const job of childJobs) {
      if (job.enqueueError || !job.runId) {
        settled.push({
          title: job.task.title,
          status: 'failed',
          summary: null,
          task_id: job.task.id,
          agent_run_id: null,
          tokens_used: 0,
          error: job.enqueueError ?? 'enqueue_failed',
        });
      } else {
        polling.push({ job });
      }
    }

    // Parent-restart resume: also pick up any existing children by parentRunId
    // that were spawned in a prior attempt and may already be in-flight or terminal.
    if (polling.length === 0 && settled.length === childJobs.length) {
      // All failed at enqueue — return immediately without polling
    } else {
      // Check for existing children by parentRunId (resume after parent restart)
      const pollingRunIds = polling.map(p => p.job.runId!);
      if (pollingRunIds.length > 0) {
        // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
        const existingChildren = await db
          .select({
            id: agentRuns.id,
            status: agentRuns.status,
            summary: agentRuns.summary,
            totalTokens: agentRuns.totalTokens,
            taskId: agentRuns.taskId,
          })
          .from(agentRuns)
          .where(
            and(
              eq(agentRuns.parentRunId, context.runId),
              inArray(agentRuns.id, pollingRunIds),
            )
          );

        // Merge any already-terminal children from the resume query into settled
        for (const child of existingChildren) {
          if (!isTerminalRunStatus(child.status)) continue;
          const idx = polling.findIndex(p => p.job.runId === child.id);
          if (idx === -1) continue;
          const p = polling[idx];
          polling.splice(idx, 1);
          settled.push({
            title: p.job.task.title,
            status: child.status,
            summary: child.summary ?? null,
            task_id: child.taskId ?? p.job.task.id,
            agent_run_id: child.id,
            tokens_used: child.totalTokens ?? 0,
          });
        }
      }
    }

    // Poll until all children are terminal or timeout
    while (polling.length > 0) {
      if (Date.now() >= spawnDeadlineMs) {
        // Timeout — return partial results with pending list
        const pendingRunIds = polling.map(p => p.job.runId);

        // Write accepted outcome rows for the jobs we did enqueue (fire-and-forget per INV-3)
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

        const totalTokens = settled.reduce((sum, r) => sum + (r.tokens_used ?? 0), 0);
        return {
          success: false,
          error: 'spawn_timeout',
          results: settled,
          pending: pendingRunIds,
          total_tokens: totalTokens,
          total_duration_ms: Date.now() - (context.startTime ?? Date.now()),
        };
      }

      // Check parent's own status before waiting — propagates operator cancel within ≤ 1 poll interval
      // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
      const [parentStatus] = await db
        .select({ status: agentRuns.status })
        .from(agentRuns)
        .where(eq(agentRuns.id, context.runId))
        .limit(1);
      if (parentStatus?.status === 'cancelling' || parentStatus?.status === 'cancelled') {
        const pendingRunIds = polling.map(p => p.job.runId);
        const totalTokens = settled.reduce((sum, r) => sum + (r.tokens_used ?? 0), 0);
        return {
          success: false,
          error: 'spawn_timeout',
          results: settled,
          pending: pendingRunIds,
          total_tokens: totalTokens,
          total_duration_ms: Date.now() - (context.startTime ?? Date.now()),
        };
      }

      await new Promise<void>(resolve => setTimeout(resolve, pollIntervalMs));

      const runIds = polling.map(p => p.job.runId!);
      // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
      const rows = await db
        .select({
          id: agentRuns.id,
          status: agentRuns.status,
          summary: agentRuns.summary,
          totalTokens: agentRuns.totalTokens,
          taskId: agentRuns.taskId,
        })
        .from(agentRuns)
        .where(inArray(agentRuns.id, runIds));

      const rowsById = new Map(rows.map(r => [r.id, r]));

      for (let i = polling.length - 1; i >= 0; i--) {
        const p = polling[i];
        const row = rowsById.get(p.job.runId!);
        if (!row || !isTerminalRunStatus(row.status)) continue;
        polling.splice(i, 1);
        settled.push({
          title: p.job.task.title,
          status: row.status,
          summary: row.summary ?? null,
          task_id: row.taskId ?? p.job.task.id,
          agent_run_id: row.id,
          tokens_used: row.totalTokens ?? 0,
        });
      }
    }

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

    const totalTokens = settled.reduce((sum, r) => sum + (r.tokens_used ?? 0), 0);

    return {
      success: true,
      results: settled,
      total_tokens: totalTokens,
      total_duration_ms: Date.now() - (context.startTime ?? Date.now()),
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Failed to spawn sub-agents: ${errMsg}` };
  }
}

