/**
 * Configuration Assistant skill handlers.
 *
 * Each handler is keyed by the skill slug and follows the SkillHandler
 * signature from skillExecutor.ts. Mutation handlers use
 * executeWithActionAudit for audit trail; read-only handlers return data
 * directly.
 */
import type { SkillExecutionContext } from '../../services/skillExecutor.js';
import { agentService } from '../../services/agentService.js';
import { subaccountAgentService } from '../../services/subaccountAgentService.js';
import { scheduledTaskService } from '../../services/scheduledTaskService.js';
import { agentScheduleService } from '../../services/agentScheduleService.js';
import { systemSkillService } from '../../services/systemSkillService.js';
import { skillService } from '../../services/skillService.js';
import { configHistoryService } from '../../services/configHistoryService.js';
import { boardService } from '../../services/boardService.js';
import { db } from '../../db/index.js';
import { subaccounts, agents, subaccountAgents } from '../../db/schema/index.js';
import { eq, and, isNull } from 'drizzle-orm';
import { logger } from '../../lib/logger.js';
import { computeDescendantIds, mapSubaccountAgentIdsToAgentIds, resolveEffectiveScope, type RosterEntry } from './configSkillHandlersPure.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve the config assistant's own agent ID (for self-modification guard). */
async function getConfigAgentId(orgId: string): Promise<string | null> {
  const { systemAgents } = await import('../../db/schema/index.js');
  const rows = await db
    .select({ agentId: agents.id })
    .from(agents)
    .innerJoin(systemAgents, eq(agents.systemAgentId, systemAgents.id))
    .where(and(eq(agents.organisationId, orgId), eq(systemAgents.slug, 'configuration-assistant')));
  return rows[0]?.agentId ?? null;
}

function selfModGuard(targetAgentId: string, configAgentId: string | null): string | null {
  if (configAgentId && targetAgentId === configAgentId) {
    return 'The Configuration Assistant cannot modify its own definition.';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Mutation handlers (15)
// ---------------------------------------------------------------------------

export async function executeConfigCreateAgent(
  input: Record<string, unknown>,
  context: SkillExecutionContext,
): Promise<unknown> {
  const name = String(input.name ?? '');
  if (!name) return { success: false, error: 'name is required' };
  const masterPrompt = String(input.masterPrompt ?? '');
  if (!masterPrompt) return { success: false, error: 'masterPrompt is required' };

  try {
    const result = await agentService.createAgent(context.organisationId, {
      name,
      description: input.description ? String(input.description) : undefined,
      masterPrompt,
      modelProvider: input.modelProvider ? String(input.modelProvider) : 'anthropic',
      modelId: input.modelId ? String(input.modelId) : 'claude-sonnet-4-6',
      responseMode: input.responseMode ? String(input.responseMode) : undefined,
      outputSize: input.outputSize ? String(input.outputSize) : undefined,
      defaultSkillSlugs: Array.isArray(input.defaultSkillSlugs)
        ? (input.defaultSkillSlugs as string[])
        : undefined,
      icon: input.icon ? String(input.icon) : undefined,
    });
    return { success: true, entityId: result.id, name: result.name };
  } catch (err) {
    const e = err as { message?: string };
    return { success: false, error: e.message ?? String(err) };
  }
}

export async function executeConfigUpdateAgent(
  input: Record<string, unknown>,
  context: SkillExecutionContext,
): Promise<unknown> {
  const agentId = String(input.agentId ?? '');
  if (!agentId) return { success: false, error: 'agentId is required' };

  const guard = selfModGuard(agentId, await getConfigAgentId(context.organisationId));
  if (guard) return { success: false, error: guard };

  const patch: Record<string, unknown> = {};
  for (const key of ['name', 'description', 'masterPrompt', 'modelProvider', 'modelId', 'responseMode', 'outputSize', 'icon']) {
    if (input[key] !== undefined) patch[key] = input[key];
  }
  if (input.defaultSkillSlugs !== undefined) patch.defaultSkillSlugs = input.defaultSkillSlugs;

  try {
    const result = await agentService.updateAgent(agentId, context.organisationId, patch as Parameters<typeof agentService.updateAgent>[2]);
    return { success: true, entityId: result.id, name: result.name };
  } catch (err) {
    const e = err as { message?: string };
    return { success: false, error: e.message ?? String(err) };
  }
}

export async function executeConfigActivateAgent(
  input: Record<string, unknown>,
  context: SkillExecutionContext,
): Promise<unknown> {
  const agentId = String(input.agentId ?? '');
  const status = String(input.status ?? '');
  if (!agentId) return { success: false, error: 'agentId is required' };
  if (status !== 'active' && status !== 'inactive') return { success: false, error: 'status must be active or inactive' };

  const guard = selfModGuard(agentId, await getConfigAgentId(context.organisationId));
  if (guard) return { success: false, error: guard };

  try {
    const result = status === 'active'
      ? await agentService.activateAgent(agentId, context.organisationId)
      : await agentService.deactivateAgent(agentId, context.organisationId);
    return { success: true, entityId: result.id, status: result.status };
  } catch (err) {
    const e = err as { message?: string };
    return { success: false, error: e.message ?? String(err) };
  }
}

export async function executeConfigLinkAgent(
  input: Record<string, unknown>,
  context: SkillExecutionContext,
): Promise<unknown> {
  const agentId = String(input.agentId ?? '');
  const subaccountId = String(input.subaccountId ?? '');
  if (!agentId || !subaccountId) return { success: false, error: 'agentId and subaccountId are required' };

  try {
    const link = await subaccountAgentService.linkAgent(context.organisationId, subaccountId, agentId);
    return { success: true, entityId: link.id, agentId: link.agentId, subaccountId: link.subaccountId };
  } catch (err) {
    const e = err as { message?: string };
    return { success: false, error: e.message ?? String(err) };
  }
}

export async function executeConfigUpdateLink(
  input: Record<string, unknown>,
  context: SkillExecutionContext,
): Promise<unknown> {
  const linkId = String(input.linkId ?? '');
  if (!linkId) return { success: false, error: 'linkId is required' };

  const patch: Record<string, unknown> = {};
  for (const key of [
    'skillSlugs', 'customInstructions', 'tokenBudgetPerRun', 'maxToolCallsPerRun',
    'timeoutSeconds', 'maxCostPerRunCents', 'maxLlmCallsPerRun', 'heartbeatEnabled',
    'heartbeatIntervalHours', 'heartbeatOffsetMinutes', 'isActive',
  ]) {
    if (input[key] !== undefined) patch[key] = input[key];
  }

  try {
    const result = await subaccountAgentService.updateLink(context.organisationId, linkId, patch as Parameters<typeof subaccountAgentService.updateLink>[2]);
    // scheduleCron/scheduleEnabled require agentScheduleService to keep pg-boss in sync — handled by executeConfigSetLinkSchedule
    return { success: true, entityId: result.id };
  } catch (err) {
    const e = err as { message?: string };
    return { success: false, error: e.message ?? String(err) };
  }
}

export async function executeConfigSetLinkSkills(
  input: Record<string, unknown>,
  context: SkillExecutionContext,
): Promise<unknown> {
  const linkId = String(input.linkId ?? '');
  if (!linkId) return { success: false, error: 'linkId is required' };
  if (!Array.isArray(input.skillSlugs)) return { success: false, error: 'skillSlugs array is required' };

  try {
    const result = await subaccountAgentService.updateLink(context.organisationId, linkId, {
      skillSlugs: input.skillSlugs as string[],
    });
    return { success: true, entityId: result.id, skillSlugs: (result as Record<string, unknown>).skillSlugs };
  } catch (err) {
    const e = err as { message?: string };
    return { success: false, error: e.message ?? String(err) };
  }
}

export async function executeConfigSetLinkInstructions(
  input: Record<string, unknown>,
  context: SkillExecutionContext,
): Promise<unknown> {
  const linkId = String(input.linkId ?? '');
  if (!linkId) return { success: false, error: 'linkId is required' };
  // Allow empty string to clear custom instructions; only reject if not provided at all
  if (input.customInstructions === undefined) return { success: false, error: 'customInstructions is required' };
  const customInstructions = input.customInstructions === null ? null : String(input.customInstructions);
  if (customInstructions && customInstructions.length > 10000) return { success: false, error: 'customInstructions exceeds 10000 characters' };

  try {
    const result = await subaccountAgentService.updateLink(context.organisationId, linkId, { customInstructions });
    return { success: true, entityId: result.id };
  } catch (err) {
    const e = err as { message?: string };
    return { success: false, error: e.message ?? String(err) };
  }
}

export async function executeConfigSetLinkSchedule(
  input: Record<string, unknown>,
  context: SkillExecutionContext,
): Promise<unknown> {
  const linkId = String(input.linkId ?? '');
  if (!linkId) return { success: false, error: 'linkId is required' };

  try {
    // Heartbeat fields (heartbeatEnabled, heartbeatIntervalHours, heartbeatOffsetMinutes) go through
    // updateLink — they don't require pg-boss coordination.
    const heartbeatPatch: Record<string, unknown> = {};
    for (const key of ['heartbeatEnabled', 'heartbeatIntervalHours', 'heartbeatOffsetMinutes', 'isActive']) {
      if (input[key] !== undefined) heartbeatPatch[key] = input[key];
    }
    let result: { id: string } | undefined;
    if (Object.keys(heartbeatPatch).length > 0) {
      result = await subaccountAgentService.updateLink(context.organisationId, linkId, heartbeatPatch as Parameters<typeof subaccountAgentService.updateLink>[2]);
    }

    // Cron schedule fields must go through agentScheduleService to keep pg-boss in sync.
    const cronPatch: { scheduleCron?: string | null; scheduleEnabled?: boolean } = {};
    if (input.scheduleCron !== undefined) cronPatch.scheduleCron = input.scheduleCron === null ? null : String(input.scheduleCron);
    if (input.scheduleEnabled !== undefined) cronPatch.scheduleEnabled = Boolean(input.scheduleEnabled);
    if (Object.keys(cronPatch).length > 0) {
      result = await agentScheduleService.updateSchedule(linkId, cronPatch);
    }

    if (!result) return { success: false, error: 'No schedule fields provided' };
    return { success: true, entityId: result.id };
  } catch (err) {
    const e = err as { message?: string };
    return { success: false, error: e.message ?? String(err) };
  }
}

export async function executeConfigSetLinkLimits(
  input: Record<string, unknown>,
  context: SkillExecutionContext,
): Promise<unknown> {
  const linkId = String(input.linkId ?? '');
  if (!linkId) return { success: false, error: 'linkId is required' };

  const patch: Record<string, unknown> = {};
  for (const key of ['tokenBudgetPerRun', 'maxToolCallsPerRun', 'timeoutSeconds', 'maxCostPerRunCents', 'maxLlmCallsPerRun']) {
    if (input[key] !== undefined) patch[key] = input[key];
  }

  try {
    const result = await subaccountAgentService.updateLink(context.organisationId, linkId, patch as Parameters<typeof subaccountAgentService.updateLink>[2]);
    return { success: true, entityId: result.id };
  } catch (err) {
    const e = err as { message?: string };
    return { success: false, error: e.message ?? String(err) };
  }
}

export async function executeConfigCreateSubaccount(
  input: Record<string, unknown>,
  context: SkillExecutionContext,
): Promise<unknown> {
  const name = String(input.name ?? '');
  if (!name) return { success: false, error: 'name is required' };
  const slug = input.slug
    ? String(input.slug)
    : name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

  try {
    const [sa] = await db
      .insert(subaccounts)
      .values({
        organisationId: context.organisationId,
        name,
        slug,
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    // Auto-init board config (matches subaccount creation route behaviour)
    boardService.initSubaccountBoard(context.organisationId, sa.id).catch(() => {
      // Non-critical: if org has no board config, skip silently
    });

    await configHistoryService.recordHistory({
      entityType: 'subaccount',
      entityId: sa.id,
      organisationId: context.organisationId,
      snapshot: sa as unknown as Record<string, unknown>,
      changedBy: null,
      changeSource: 'config_agent',
      sessionId: context.runId,
    });

    return { success: true, entityId: sa.id, name: sa.name, slug: sa.slug };
  } catch (err) {
    const e = err as { message?: string };
    return { success: false, error: e.message ?? String(err) };
  }
}

export async function executeConfigCreateScheduledTask(
  input: Record<string, unknown>,
  context: SkillExecutionContext,
): Promise<unknown> {
  const title = String(input.title ?? '');
  const subaccountId = String(input.subaccountId ?? '');
  if (!title) return { success: false, error: 'title is required' };
  if (!subaccountId) return { success: false, error: 'subaccountId is required' };

  // Strict idempotency (spec §5.5.1): if a `taskSlug` is supplied and an
  // active task already exists for (subaccountId, taskSlug), return it
  // as if we had just created it. Prevents playbook replay, double-click
  // form submission, and auto-start races from minting duplicates. The
  // service layer already enforces uniqueness, but we short-circuit here
  // so the response shape remains `success: true` rather than surfacing
  // a confusing "already exists" error.
  const taskSlug = input.taskSlug ? String(input.taskSlug) : undefined;
  if (taskSlug) {
    const existing = await scheduledTaskService.findActiveBySlug(subaccountId, taskSlug);
    if (existing) {
      if (input.runNow === true || input.runNow === 'true') {
        await scheduledTaskService.enqueueRunNow(existing.id, context.organisationId);
      }
      return { success: true, entityId: existing.id, title: existing.title };
    }
  }

  try {
    const task = await scheduledTaskService.create(context.organisationId, subaccountId, {
      title,
      description: input.description ? String(input.description) : undefined,
      brief: input.brief ? String(input.brief) : undefined,
      priority: input.priority ? String(input.priority) : undefined,
      assignedAgentId: input.assignedAgentId ? String(input.assignedAgentId) : '',
      rrule: input.rrule ? String(input.rrule) : 'FREQ=WEEKLY;BYDAY=MO',
      timezone: input.timezone ? String(input.timezone) : undefined,
      scheduleTime: input.scheduleTime ? String(input.scheduleTime) : '09:00',
      taskSlug,
      createdByWorkflowSlug: input.createdByWorkflowSlug
        ? String(input.createdByWorkflowSlug)
        : undefined,
      firstRunAt: input.firstRunAt ? new Date(String(input.firstRunAt)) : undefined,
      firstRunAtTz: input.firstRunAtTz ? String(input.firstRunAtTz) : undefined,
      runNow: input.runNow === true || input.runNow === 'true',
    });

    if (input.isActive === false) {
      await scheduledTaskService.toggleActive(task.id, context.organisationId, false);
    }

    return { success: true, entityId: task.id, title: task.title };
  } catch (err) {
    const e = err as { message?: string };
    return { success: false, error: e.message ?? String(err) };
  }
}

export async function executeConfigUpdateScheduledTask(
  input: Record<string, unknown>,
  context: SkillExecutionContext,
): Promise<unknown> {
  const taskId = String(input.taskId ?? '');
  if (!taskId) return { success: false, error: 'taskId is required' };

  const patch: Record<string, unknown> = {};
  for (const key of ['title', 'description', 'brief', 'priority', 'assignedAgentId', 'rrule', 'timezone', 'scheduleTime']) {
    if (input[key] !== undefined) patch[key] = input[key];
  }

  try {
    const result = await scheduledTaskService.update(taskId, context.organisationId, patch as Parameters<typeof scheduledTaskService.update>[2]);

    if (input.isActive !== undefined) {
      await scheduledTaskService.toggleActive(taskId, context.organisationId, Boolean(input.isActive));
    }

    return { success: true, entityId: result.id, title: result.title };
  } catch (err) {
    const e = err as { message?: string };
    return { success: false, error: e.message ?? String(err) };
  }
}

export async function executeConfigAttachDataSource(
  input: Record<string, unknown>,
  context: SkillExecutionContext,
): Promise<unknown> {
  const name = String(input.name ?? '');
  const sourceType = String(input.sourceType ?? '');
  const sourcePath = String(input.sourcePath ?? '');
  if (!name || !sourceType || !sourcePath) return { success: false, error: 'name, sourceType, and sourcePath are required' };

  const dsData = {
    name,
    sourceType: sourceType as 'http_url' | 'file_upload',
    sourcePath,
    contentType: input.contentType ? String(input.contentType) as 'json' | 'csv' | 'markdown' | 'text' | 'auto' : undefined,
    priority: input.priority ? Number(input.priority) : undefined,
    maxTokenBudget: input.maxTokenBudget ? Number(input.maxTokenBudget) : undefined,
    loadingMode: input.loadingMode ? String(input.loadingMode) as 'eager' | 'lazy' : undefined,
    cacheMinutes: input.cacheMinutes ? Number(input.cacheMinutes) : undefined,
  };

  try {
    if (input.agentId) {
      const ds = await agentService.addDataSource(String(input.agentId), context.organisationId, dsData);
      return { success: true, entityId: ds.id };
    } else if (input.subaccountAgentId) {
      // Subaccount agent data sources — need agentId from the link
      const link = await subaccountAgentService.getLinkById(context.organisationId, String(input.subaccountId ?? ''), String(input.subaccountAgentId));
      const ds = await subaccountAgentService.addSubaccountDataSource(
        String(input.subaccountAgentId),
        (link as Record<string, unknown>).agentId as string,
        dsData,
      );
      return { success: true, entityId: ds.id };
    }
    return { success: false, error: 'One of agentId or subaccountAgentId is required' };
  } catch (err) {
    const e = err as { message?: string };
    return { success: false, error: e.message ?? String(err) };
  }
}

export async function executeConfigUpdateDataSource(
  input: Record<string, unknown>,
  context: SkillExecutionContext,
): Promise<unknown> {
  const dataSourceId = String(input.dataSourceId ?? '');
  if (!dataSourceId) return { success: false, error: 'dataSourceId is required' };

  const patch: Record<string, unknown> = {};
  for (const key of ['name', 'priority', 'maxTokenBudget', 'loadingMode', 'cacheMinutes', 'contentType']) {
    if (input[key] !== undefined) patch[key] = input[key];
  }

  try {
    // Data source updates require agentId — look up with org scoping
    const { agentDataSources } = await import('../../db/schema/index.js');
    const [ds] = await db
      .select({ id: agentDataSources.id, agentId: agentDataSources.agentId })
      .from(agentDataSources)
      .innerJoin(agents, and(eq(agentDataSources.agentId, agents.id), isNull(agents.deletedAt)))
      .where(and(eq(agentDataSources.id, dataSourceId), eq(agents.organisationId, context.organisationId)));
    if (!ds) return { success: false, error: 'Data source not found' };

    const result = await agentService.updateDataSource(dataSourceId, ds.agentId, context.organisationId, patch as Parameters<typeof agentService.updateDataSource>[3]);
    return { success: true, entityId: result.id };
  } catch (err) {
    const e = err as { message?: string };
    return { success: false, error: e.message ?? String(err) };
  }
}

export async function executeConfigRemoveDataSource(
  input: Record<string, unknown>,
  context: SkillExecutionContext,
): Promise<unknown> {
  const dataSourceId = String(input.dataSourceId ?? '');
  if (!dataSourceId) return { success: false, error: 'dataSourceId is required' };

  try {
    const { agentDataSources } = await import('../../db/schema/index.js');
    const [ds] = await db
      .select({ id: agentDataSources.id, agentId: agentDataSources.agentId })
      .from(agentDataSources)
      .innerJoin(agents, and(eq(agentDataSources.agentId, agents.id), isNull(agents.deletedAt)))
      .where(and(eq(agentDataSources.id, dataSourceId), eq(agents.organisationId, context.organisationId)));
    if (!ds) return { success: false, error: 'Data source not found' };

    await agentService.deleteDataSource(dataSourceId, ds.agentId, context.organisationId);
    return { success: true };
  } catch (err) {
    const e = err as { message?: string };
    return { success: false, error: e.message ?? String(err) };
  }
}

// ---------------------------------------------------------------------------
// Read-only handlers (9)
// ---------------------------------------------------------------------------

export async function executeConfigListAgents(
  input: Record<string, unknown>,
  context: SkillExecutionContext,
): Promise<unknown> {
  // Determine effectiveScope
  const effectiveScope = resolveEffectiveScope({ rawScope: input.scope, hierarchy: context.hierarchy });

  // Warn when hierarchy is missing (falls through to subaccount behaviour)
  if (!context.hierarchy) {
    logger.warn('hierarchy_missing_read_skill_fallthrough', { skill: 'config_list_agents', runId: context.runId });
  }

  try {
    const list = await agentService.listAllAgents(context.organisationId);

    // Apply hierarchy-based filtering when scope is children or descendants
    let filteredList = list as Record<string, unknown>[];

    if ((effectiveScope === 'children' || effectiveScope === 'descendants') && context.hierarchy) {
      // Load roster: subaccountAgents for this subaccount (active rows only)
      const subaccountId = context.subaccountId;
      let agentIdSet: Set<string>;

      if (subaccountId) {
        const rosterRows = await db
          .select({
            subaccountAgentId: subaccountAgents.id,
            agentId: subaccountAgents.agentId,
            parentSubaccountAgentId: subaccountAgents.parentSubaccountAgentId,
          })
          .from(subaccountAgents)
          .where(
            and(
              eq(subaccountAgents.organisationId, context.organisationId),
              eq(subaccountAgents.subaccountId, subaccountId),
              eq(subaccountAgents.isActive, true),
            ),
          );

        const roster: RosterEntry[] = rosterRows.map((r) => ({
          subaccountAgentId: r.subaccountAgentId,
          agentId: r.agentId,
          parentSubaccountAgentId: r.parentSubaccountAgentId ?? null,
        }));

        let targetSubaccountAgentIds: string[];
        if (effectiveScope === 'children') {
          targetSubaccountAgentIds = context.hierarchy.childIds;
        } else {
          // descendants
          targetSubaccountAgentIds = computeDescendantIds({
            callerSubaccountAgentId: context.hierarchy.agentId,
            roster,
          });
        }

        const targetAgentIds = mapSubaccountAgentIdsToAgentIds({
          subaccountAgentIds: targetSubaccountAgentIds,
          roster,
        });
        agentIdSet = new Set(targetAgentIds);
      } else {
        // No subaccount context — cannot scope by hierarchy; return empty
        agentIdSet = new Set();
      }

      filteredList = filteredList.filter((a) => agentIdSet.has(a.id as string));
    }
    // effectiveScope === 'subaccount': return all agents (existing behaviour)

    return {
      success: true,
      agents: filteredList.map((a) => ({
        id: a.id,
        name: a.name,
        slug: a.slug,
        status: a.status,
        modelId: a.modelId,
        defaultSkillSlugs: a.defaultSkillSlugs,
        description: a.description,
      })),
    };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function executeConfigListSubaccounts(
  // scope is accepted for signature consistency; has no filter effect in v1
  _input: Record<string, unknown>,
  context: SkillExecutionContext,
): Promise<unknown> {
  try {
    const rows = await db
      .select({ id: subaccounts.id, name: subaccounts.name, slug: subaccounts.slug, status: subaccounts.status })
      .from(subaccounts)
      .where(and(eq(subaccounts.organisationId, context.organisationId), isNull(subaccounts.deletedAt)));
    return { success: true, subaccounts: rows };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function executeConfigListLinks(
  // scope is accepted for signature consistency; has no filter effect in v1
  input: Record<string, unknown>,
  context: SkillExecutionContext,
): Promise<unknown> {
  const subaccountId = String(input.subaccountId ?? '');
  if (!subaccountId) return { success: false, error: 'subaccountId is required' };

  try {
    const links = await subaccountAgentService.listSubaccountAgents(context.organisationId, subaccountId);
    return {
      success: true,
      links: links.map((l: Record<string, unknown>) => ({
        id: l.id,
        agentId: l.agentId,
        agentName: l.agentName ?? l.agent_name,
        isActive: l.isActive,
        skillSlugs: l.skillSlugs,
        heartbeatEnabled: l.heartbeatEnabled,
        scheduleCron: l.scheduleCron,
      })),
    };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function executeConfigListScheduledTasks(
  input: Record<string, unknown>,
  context: SkillExecutionContext,
): Promise<unknown> {
  const subaccountId = String(input.subaccountId ?? '');
  if (!subaccountId) return { success: false, error: 'subaccountId is required' };

  try {
    const tasks = await scheduledTaskService.list(context.organisationId, subaccountId);
    return {
      success: true,
      tasks: tasks.map((t: Record<string, unknown>) => ({
        id: t.id,
        title: t.title,
        assignedAgentId: t.assignedAgentId,
        rrule: t.rrule,
        scheduleTime: t.scheduleTime,
        isActive: t.isActive,
      })),
    };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function executeConfigListDataSources(
  input: Record<string, unknown>,
  context: SkillExecutionContext,
): Promise<unknown> {
  try {
    const { agentDataSources } = await import('../../db/schema/index.js');
    let rows;

    if (input.agentId) {
      // Org-scoped: join through agents to verify ownership
      rows = await db
        .select({
          id: agentDataSources.id, name: agentDataSources.name,
          sourceType: agentDataSources.sourceType, sourcePath: agentDataSources.sourcePath,
          loadingMode: agentDataSources.loadingMode, priority: agentDataSources.priority,
        })
        .from(agentDataSources)
        .innerJoin(agents, and(eq(agentDataSources.agentId, agents.id), isNull(agents.deletedAt)))
        .where(and(eq(agentDataSources.agentId, String(input.agentId)), eq(agents.organisationId, context.organisationId)));
    } else if (input.subaccountAgentId) {
      // Org-scoped: subaccountAgentService.getLinkById verifies org ownership
      const { subaccountAgents } = await import('../../db/schema/index.js');
      rows = await db
        .select({
          id: agentDataSources.id, name: agentDataSources.name,
          sourceType: agentDataSources.sourceType, sourcePath: agentDataSources.sourcePath,
          loadingMode: agentDataSources.loadingMode, priority: agentDataSources.priority,
        })
        .from(agentDataSources)
        .innerJoin(subaccountAgents, and(eq(agentDataSources.subaccountAgentId, subaccountAgents.id), eq(subaccountAgents.isActive, true)))
        .innerJoin(agents, and(eq(subaccountAgents.agentId, agents.id), isNull(agents.deletedAt)))
        .where(and(eq(agentDataSources.subaccountAgentId, String(input.subaccountAgentId)), eq(agents.organisationId, context.organisationId)));
    } else {
      return { success: false, error: 'One of agentId or subaccountAgentId is required' };
    }

    return {
      success: true,
      dataSources: rows.map((ds: Record<string, unknown>) => ({
        id: ds.id,
        name: ds.name,
        sourceType: ds.sourceType,
        sourcePath: ds.sourcePath,
        loadingMode: ds.loadingMode,
        priority: ds.priority,
      })),
    };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function executeConfigListSystemSkills(
  _input: Record<string, unknown>,
  _context: SkillExecutionContext,
): Promise<unknown> {
  try {
    const skills = await systemSkillService.listActiveSkills();
    return {
      success: true,
      skills: skills.map((s) => ({
        slug: s.slug,
        name: s.name,
        description: s.description,
        visibility: s.visibility,
      })),
    };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function executeConfigListOrgSkills(
  _input: Record<string, unknown>,
  context: SkillExecutionContext,
): Promise<unknown> {
  try {
    const skills = await skillService.listSkills(context.organisationId);
    return {
      success: true,
      skills: skills.map((s: Record<string, unknown>) => ({
        slug: s.slug,
        name: s.name,
        description: s.description,
        isActive: s.isActive,
      })),
    };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function executeConfigGetAgentDetail(
  input: Record<string, unknown>,
  context: SkillExecutionContext,
): Promise<unknown> {
  const agentId = String(input.agentId ?? '');
  if (!agentId) return { success: false, error: 'agentId is required' };

  try {
    const agent = await agentService.getAgent(agentId, context.organisationId);
    return { success: true, agent };
  } catch (err) {
    const e = err as { message?: string };
    return { success: false, error: e.message ?? String(err) };
  }
}

export async function executeConfigGetLinkDetail(
  input: Record<string, unknown>,
  context: SkillExecutionContext,
): Promise<unknown> {
  const linkId = String(input.linkId ?? '');
  const subaccountId = String(input.subaccountId ?? '');
  if (!linkId || !subaccountId) return { success: false, error: 'linkId and subaccountId are required' };

  try {
    const link = await subaccountAgentService.getLinkById(context.organisationId, subaccountId, linkId);
    return { success: true, link };
  } catch (err) {
    const e = err as { message?: string };
    return { success: false, error: e.message ?? String(err) };
  }
}

// ---------------------------------------------------------------------------
// Validation & history handlers (4)
// ---------------------------------------------------------------------------

export async function executeConfigRunHealthCheck(
  _input: Record<string, unknown>,
  context: SkillExecutionContext,
): Promise<unknown> {
  try {
    const { runAudit } = await import('../../services/workspaceHealth/workspaceHealthService.js');
    const result = await runAudit(context.organisationId);
    return { success: true, ...result };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function executeConfigPreviewPlan(
  input: Record<string, unknown>,
  _context: SkillExecutionContext,
): Promise<unknown> {
  // The preview plan tool just structures and returns the plan for the UI.
  // The LLM constructs the plan; this handler validates and returns it.
  return {
    success: true,
    plan: {
      summary: input.summary ?? '',
      targetScope: input.targetScope ?? { type: 'org' },
      planBudget: input.planBudget ?? { maxSteps: 30 },
      failFast: input.failFast !== false,
      steps: Array.isArray(input.steps) ? input.steps : [],
    },
  };
}

export async function executeConfigViewHistory(
  input: Record<string, unknown>,
  context: SkillExecutionContext,
): Promise<unknown> {
  const entityType = String(input.entityType ?? '');
  const entityId = String(input.entityId ?? '');
  if (!entityType || !entityId) return { success: false, error: 'entityType and entityId are required' };

  try {
    const limit = input.limit ? Number(input.limit) : 20;
    const versions = await configHistoryService.listHistory(entityType, entityId, context.organisationId, { limit });

    // Resolve entity name for display
    let entityName = '';
    if (entityType === 'agent') {
      try {
        const agent = await agentService.getAgent(entityId, context.organisationId);
        entityName = agent.name;
      } catch { /* entity may be deleted */ }
    }

    return { success: true, entityType, entityId, entityName, versions };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function executeConfigRestoreVersion(
  input: Record<string, unknown>,
  context: SkillExecutionContext,
): Promise<unknown> {
  const entityType = String(input.entityType ?? '');
  const entityId = String(input.entityId ?? '');
  const version = Number(input.version ?? 0);
  if (!entityType || !entityId || !version) return { success: false, error: 'entityType, entityId, and version are required' };

  try {
    // Fetch target version snapshot
    const targetRecord = await configHistoryService.getVersion(entityType, entityId, version, context.organisationId);
    if (!targetRecord) return { success: false, error: `Version ${version} not found` };

    const snapshot = targetRecord.snapshot as Record<string, unknown>;

    // Apply the snapshot based on entity type
    const notes: string[] = [];
    if (entityType === 'agent') {
      const { name, masterPrompt, description, modelProvider, modelId, responseMode, outputSize, defaultSkillSlugs, icon } = snapshot;
      // masterPrompt is redacted from snapshots of system-managed agents
      if (masterPrompt === undefined) {
        notes.push('masterPrompt was not restored (system-managed agent — masterPrompt is controlled at the system level)');
      }
      await agentService.updateAgent(entityId, context.organisationId, {
        name: name as string,
        masterPrompt: masterPrompt as string,
        description: description as string | null,
        modelProvider: modelProvider as string,
        modelId: modelId as string,
        responseMode: responseMode as string,
        outputSize: outputSize as string,
        defaultSkillSlugs: defaultSkillSlugs as string[],
        icon: icon as string,
      });
    } else if (entityType === 'subaccount_agent') {
      const { skillSlugs, customInstructions, tokenBudgetPerRun, maxToolCallsPerRun, timeoutSeconds, isActive, heartbeatEnabled, heartbeatIntervalHours } = snapshot;
      await subaccountAgentService.updateLink(context.organisationId, entityId, {
        skillSlugs: skillSlugs as string[] | null,
        customInstructions: customInstructions as string | null,
        tokenBudgetPerRun: tokenBudgetPerRun as number,
        maxToolCallsPerRun: maxToolCallsPerRun as number,
        timeoutSeconds: timeoutSeconds as number,
        isActive: isActive as boolean,
        heartbeatEnabled: heartbeatEnabled as boolean,
        heartbeatIntervalHours: heartbeatIntervalHours as number | null,
      });
    } else if (entityType === 'scheduled_task') {
      await scheduledTaskService.update(entityId, context.organisationId, {
        title: snapshot.title as string,
        description: snapshot.description as string,
        brief: snapshot.brief as string,
        priority: snapshot.priority as string,
        assignedAgentId: snapshot.assignedAgentId as string,
        rrule: snapshot.rrule as string,
        timezone: snapshot.timezone as string,
        scheduleTime: snapshot.scheduleTime as string,
      });
      // Restore activation state — scheduledTaskService.update does not touch isActive
      if (snapshot.isActive !== undefined) {
        await scheduledTaskService.toggleActive(entityId, context.organisationId, Boolean(snapshot.isActive));
      }
    } else {
      return { success: false, error: `Restore not supported for entity type: ${entityType}` };
    }

    // Record restore history
    await configHistoryService.recordHistory({
      entityType,
      entityId,
      organisationId: context.organisationId,
      snapshot,
      changedBy: null,
      changeSource: 'restore',
      sessionId: context.runId,
      changeSummary: `Restored to version ${version}`,
    });

    const newVersion = await configHistoryService.getLatestVersion(entityType, entityId, context.organisationId);
    return { success: true, restoredToVersion: version, newVersion, ...(notes.length ? { notes } : {}) };
  } catch (err) {
    const e = err as { message?: string };
    return { success: false, error: e.message ?? String(err) };
  }
}
