import { eq, and, isNull, asc, max, desc, inArray, sql as drizzleSql } from 'drizzle-orm';
import { getOrgScopedDb } from '../../lib/orgScopedDb.js';
import { agents, agentDataSources, users, agentPromptRevisions } from '../../db/schema/index.js';
import { resolveTemperature, resolveMaxTokens } from '../llmService.js';
import { assertScopeSingle } from '../../lib/scopeAssertion.js';
import { configHistoryService } from '../configHistoryService.js';
import { auditService } from '../auditService.js';
import { validateHierarchy } from '../hierarchyService.js';
import { softDeleteByTarget } from '../agentTestFixturesService.js';
import crypto from 'crypto';
import { makeSlug } from './helpers.js';

export async function listAgents(organisationId: string, includeInactive = false) {
  const listAgentsScopedDb = getOrgScopedDb('crud.listAgents');
  const rows = await listAgentsScopedDb
    .select()
    .from(agents)
    .where(and(
      eq(agents.organisationId, organisationId),
      isNull(agents.deletedAt),
      includeInactive ? undefined : eq(agents.status, 'active'),
    ));

  // INVARIANT-C5b-A: batch-fetch revision stats — 2 queries total, no N+1
  const revisionStats = await listAgentsScopedDb
    .select({
      agentId: agentPromptRevisions.agentId,
      count: drizzleSql<number>`COUNT(*)::int`,
      lastEditedAt: drizzleSql<string>`MAX(${agentPromptRevisions.createdAt})`,
      lastAuthorId: drizzleSql<string>`(ARRAY_AGG(${agentPromptRevisions.changedBy} ORDER BY ${agentPromptRevisions.createdAt} DESC))[1]`,
    })
    .from(agentPromptRevisions)
    .where(eq(agentPromptRevisions.organisationId, organisationId))
    .groupBy(agentPromptRevisions.agentId);

  const authorIds = [...new Set(revisionStats.map(r => r.lastAuthorId).filter(Boolean))];
  const authors = authorIds.length > 0
    ? await listAgentsScopedDb.select({ id: users.id, firstName: users.firstName, lastName: users.lastName }).from(users).where(inArray(users.id, authorIds))
    : [];
  const authorMap = new Map(authors.map(u => [u.id, `${u.firstName} ${u.lastName}`.trim()]));
  const revisionMap = new Map(revisionStats.map(r => [r.agentId, r]));

  return rows.map((a) => ({
    id: a.id,
    name: a.name,
    slug: a.slug,
    description: a.description,
    modelProvider: a.modelProvider,
    modelId: a.modelId,
    status: a.status,
    systemAgentId: a.systemAgentId,
    isSystemManaged: a.isSystemManaged,
    heartbeatEnabled: a.heartbeatEnabled,
    heartbeatIntervalHours: a.heartbeatIntervalHours,
    heartbeatOffsetHours: a.heartbeatOffsetHours,
    parentAgentId: a.parentAgentId,
    agentRole: a.agentRole,
    agentTitle: a.agentTitle,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
    // INVARIANT-C5b-A: agents with zero revision rows return 1, never 0
    agentRevisionCount: revisionMap.get(a.id)?.count ?? 1,
    lastRevisionEditedAt: revisionMap.get(a.id)?.lastEditedAt ?? null,
    lastRevisionAuthor: authorMap.get(revisionMap.get(a.id)?.lastAuthorId ?? '') ?? null,
  }));
}

export async function listAllAgents(organisationId: string) {
  const listAllAgentsScopedDb = getOrgScopedDb('crud.listAllAgents');
  const rows = await listAllAgentsScopedDb
    .select()
    .from(agents)
    .where(and(eq(agents.organisationId, organisationId), isNull(agents.deletedAt)));

  // INVARIANT-C5b-A: batch-fetch revision stats — 2 queries total, no N+1
  const revisionStats = await listAllAgentsScopedDb
    .select({
      agentId: agentPromptRevisions.agentId,
      count: drizzleSql<number>`COUNT(*)::int`,
      lastEditedAt: drizzleSql<string>`MAX(${agentPromptRevisions.createdAt})`,
      lastAuthorId: drizzleSql<string>`(ARRAY_AGG(${agentPromptRevisions.changedBy} ORDER BY ${agentPromptRevisions.createdAt} DESC))[1]`,
    })
    .from(agentPromptRevisions)
    .where(eq(agentPromptRevisions.organisationId, organisationId))
    .groupBy(agentPromptRevisions.agentId);

  const authorIds = [...new Set(revisionStats.map(r => r.lastAuthorId).filter(Boolean))];
  const authors = authorIds.length > 0
    ? await listAllAgentsScopedDb.select({ id: users.id, firstName: users.firstName, lastName: users.lastName }).from(users).where(inArray(users.id, authorIds))
    : [];
  const authorMap = new Map(authors.map(u => [u.id, `${u.firstName} ${u.lastName}`.trim()]));
  const revisionMap = new Map(revisionStats.map(r => [r.agentId, r]));

  return rows.map((a) => ({
    id: a.id,
    name: a.name,
    slug: a.slug,
    description: a.description,
    modelProvider: a.modelProvider,
    modelId: a.modelId,
    status: a.status,
    systemAgentId: a.systemAgentId,
    isSystemManaged: a.isSystemManaged,
    heartbeatEnabled: a.heartbeatEnabled,
    heartbeatIntervalHours: a.heartbeatIntervalHours,
    heartbeatOffsetHours: a.heartbeatOffsetHours,
    parentAgentId: a.parentAgentId,
    agentRole: a.agentRole,
    agentTitle: a.agentTitle,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
    // INVARIANT-C5b-A: agents with zero revision rows return 1, never 0
    agentRevisionCount: revisionMap.get(a.id)?.count ?? 1,
    lastRevisionEditedAt: revisionMap.get(a.id)?.lastEditedAt ?? null,
    lastRevisionAuthor: authorMap.get(revisionMap.get(a.id)?.lastAuthorId ?? '') ?? null,
  }));
}

export async function listOwnedByUser(organisationId: string, userId: string) {
  return getOrgScopedDb('crud.listOwnedByUser')
    .select({
      id: agents.id,
      name: agents.name,
      slug: agents.slug,
      status: agents.status,
      ownerUserId: agents.ownerUserId,
      systemAgentId: agents.systemAgentId,
      isSystemManaged: agents.isSystemManaged,
      createdAt: agents.createdAt,
      updatedAt: agents.updatedAt,
    })
    .from(agents)
    .where(and(
      eq(agents.organisationId, organisationId),
      eq(agents.ownerUserId, userId),
      isNull(agents.deletedAt),
    ));
}

export async function getAgent(id: string, organisationId: string) {
  const getAgentScopedDb = getOrgScopedDb('crud.getAgent');
  const [rawAgent] = await getAgentScopedDb
    .select()
    .from(agents)
    .where(and(eq(agents.id, id), eq(agents.organisationId, organisationId), isNull(agents.deletedAt)));

  // P1.1 Layer 2 scope assertion — agent.additionalPrompt is merged
  // into the LLM system prompt window, so this is a retrieval boundary
  // that must be guarded belt-and-suspenders even though the query
  // already filters by organisationId.
  const agent = assertScopeSingle(
    rawAgent ?? null,
    { organisationId },
    'agentService.getAgent',
  );

  if (!agent) throw { statusCode: 404, message: 'Agent not found' };

  const sources = await getAgentScopedDb
    .select()
    .from(agentDataSources)
    .where(eq(agentDataSources.agentId, id))
    .orderBy(asc(agentDataSources.priority));

  return {
    id: agent.id,
    name: agent.name,
    slug: agent.slug,
    description: agent.description,
    masterPrompt: agent.masterPrompt,
    additionalPrompt: agent.additionalPrompt,
    modelProvider: agent.modelProvider,
    modelId: agent.modelId,
    // Effective values derived from presets (used by execution services)
    temperature: resolveTemperature(agent.responseMode, agent.temperature),
    maxTokens: resolveMaxTokens(agent.outputSize, agent.maxTokens),
    // Preset fields (used by the UI)
    responseMode: agent.responseMode,
    outputSize: agent.outputSize,
    allowModelOverride: agent.allowModelOverride,
    defaultSkillSlugs: (agent.defaultSkillSlugs ?? []) as string[],
    icon: agent.icon ?? '',
    status: agent.status,
    systemAgentId: agent.systemAgentId,
    isSystemManaged: agent.isSystemManaged,
    heartbeatEnabled: agent.heartbeatEnabled,
    heartbeatIntervalHours: agent.heartbeatIntervalHours,
    heartbeatOffsetHours: agent.heartbeatOffsetHours,
    parentAgentId: agent.parentAgentId,
    agentRole: agent.agentRole,
    agentTitle: agent.agentTitle,
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
    dataSources: sources.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      sourceType: s.sourceType,
      sourcePath: s.sourcePath,
      contentType: s.contentType,
      syncMode: s.syncMode,
      priority: s.priority,
      maxTokenBudget: s.maxTokenBudget,
      cacheMinutes: s.cacheMinutes,
      lastFetchedAt: s.lastFetchedAt,
      lastFetchStatus: s.lastFetchStatus,
      lastFetchError: s.lastFetchError,
    })),
  };
}

export async function createAgent(
  organisationId: string,
  data: {
    name: string;
    description?: string;
    masterPrompt: string;
    modelProvider?: string;
    modelId?: string;
    temperature?: number;
    maxTokens?: number;
    responseMode?: string;
    outputSize?: string;
    allowModelOverride?: boolean;
    defaultSkillSlugs?: string[];
    icon?: string;
  }
) {
  const slug = makeSlug(data.name);
  const [agent] = await getOrgScopedDb('crud.createAgent')
    .insert(agents)
    .values({
      organisationId,
      name: data.name,
      slug,
      description: data.description,
      icon: data.icon ?? null,
      masterPrompt: data.masterPrompt,
      modelProvider: data.modelProvider ?? 'anthropic',
      modelId: data.modelId ?? 'claude-sonnet-4-6',
      temperature: data.temperature ?? 0.7,
      maxTokens: data.maxTokens ?? 4096,
      responseMode: (data.responseMode as 'balanced' | 'precise' | 'expressive' | 'highly_creative') ?? 'balanced',
      outputSize: (data.outputSize as 'standard' | 'extended' | 'maximum') ?? 'standard',
      allowModelOverride: data.allowModelOverride ?? true,
      defaultSkillSlugs: data.defaultSkillSlugs ?? null,
      status: 'draft',
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();

  await configHistoryService.recordHistory({
    entityType: 'agent',
    entityId: agent.id,
    organisationId,
    snapshot: agent as unknown as Record<string, unknown>,
    changedBy: null,
    changeSource: 'api',
    sessionId: null,
    changeSummary: null,
  });

  return { id: agent.id, name: agent.name, status: agent.status };
}

export async function updateAgent(
  id: string,
  organisationId: string,
  data: Partial<{
    name: string;
    description: string | null;
    masterPrompt: string;
    additionalPrompt: string;
    modelProvider: string;
    modelId: string;
    temperature: number;
    maxTokens: number;
    responseMode: string;
    outputSize: string;
    allowModelOverride: boolean;
    defaultSkillSlugs: string[];
    icon: string;
    agentRole: string | null;
    agentTitle: string | null;
    parentAgentId: string | null;
    heartbeatEnabled: boolean;
    heartbeatIntervalHours: number | null;
    heartbeatOffsetHours: number;
    concurrencyPolicy: 'skip_if_active' | 'coalesce_if_active' | 'always_enqueue';
    catchUpPolicy: 'skip_missed' | 'enqueue_missed_with_cap';
    catchUpCap: number;
    maxConcurrentRuns: number;
  }>
) {
  const updateAgentScopedDb = getOrgScopedDb('crud.updateAgent');
  const [existing] = await updateAgentScopedDb
    .select()
    .from(agents)
    .where(and(eq(agents.id, id), eq(agents.organisationId, organisationId), isNull(agents.deletedAt)));

  if (!existing) throw { statusCode: 404, message: 'Agent not found' };

  // System-managed agents: block editing the masterPrompt (that's the system layer)
  if (existing.isSystemManaged && data.masterPrompt !== undefined) {
    throw { statusCode: 400, message: 'Cannot edit master prompt on system-managed agents. Use additionalPrompt instead.' };
  }

  await configHistoryService.recordHistory({
    entityType: 'agent',
    entityId: id,
    organisationId,
    snapshot: existing as unknown as Record<string, unknown>,
    changedBy: null,
    changeSource: 'api',
    sessionId: null,
    changeSummary: null,
  });

  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (data.name !== undefined) { update.name = data.name; update.slug = makeSlug(data.name); }
  if (data.description !== undefined) update.description = data.description;
  if (!existing.isSystemManaged && data.masterPrompt !== undefined) update.masterPrompt = data.masterPrompt;
  if (data.additionalPrompt !== undefined) update.additionalPrompt = data.additionalPrompt;
  if (data.modelProvider !== undefined) update.modelProvider = data.modelProvider;
  if (data.modelId !== undefined) update.modelId = data.modelId;
  if (data.temperature !== undefined) update.temperature = data.temperature;
  if (data.maxTokens !== undefined) update.maxTokens = data.maxTokens;
  if (data.responseMode !== undefined) update.responseMode = data.responseMode;
  if (data.outputSize !== undefined) update.outputSize = data.outputSize;
  if (data.allowModelOverride !== undefined) update.allowModelOverride = data.allowModelOverride;
  if (data.defaultSkillSlugs !== undefined) update.defaultSkillSlugs = data.defaultSkillSlugs;
  if (data.icon !== undefined) update.icon = data.icon;
  if (data.heartbeatEnabled !== undefined) update.heartbeatEnabled = data.heartbeatEnabled;
  if (data.heartbeatIntervalHours !== undefined) update.heartbeatIntervalHours = data.heartbeatIntervalHours;
  if (data.heartbeatOffsetHours !== undefined) update.heartbeatOffsetHours = data.heartbeatOffsetHours;
  if (data.concurrencyPolicy !== undefined) update.concurrencyPolicy = data.concurrencyPolicy;
  if (data.catchUpPolicy !== undefined) update.catchUpPolicy = data.catchUpPolicy;
  if (data.catchUpCap !== undefined) update.catchUpCap = data.catchUpCap;
  if (data.maxConcurrentRuns !== undefined) update.maxConcurrentRuns = data.maxConcurrentRuns;
  if (data.agentRole !== undefined) update.agentRole = data.agentRole;
  if (data.agentTitle !== undefined) update.agentTitle = data.agentTitle;

  // Handle parentAgentId with hierarchy validation
  if ('parentAgentId' in data) {
    const parentId = (data as { parentAgentId?: string | null }).parentAgentId;
    if (parentId) {
      const validation = await validateHierarchy('agents', id, parentId);
      if (!validation.valid) throw { statusCode: 400, message: validation.error };
    }
    update.parentAgentId = parentId ?? null;
  }

  // ── Prompt revision tracking ────────────────────────────────────────
  const promptChanged =
    (data.masterPrompt !== undefined && data.masterPrompt !== existing.masterPrompt) ||
    (data.additionalPrompt !== undefined && data.additionalPrompt !== existing.additionalPrompt);

  if (promptChanged) {
    const newMasterPrompt = data.masterPrompt !== undefined ? data.masterPrompt : existing.masterPrompt;
    const newAdditionalPrompt = data.additionalPrompt !== undefined ? data.additionalPrompt : existing.additionalPrompt;
    const hash = crypto.createHash('sha256').update(newMasterPrompt + '\0' + newAdditionalPrompt).digest('hex');

    // Check if hash matches latest revision — skip if identical (dedup)
    const [latestRevision] = await updateAgentScopedDb
      .select({ promptHash: agentPromptRevisions.promptHash })
      .from(agentPromptRevisions)
      .where(eq(agentPromptRevisions.agentId, id))
      .orderBy(desc(agentPromptRevisions.revisionNumber))
      .limit(1);

    if (!latestRevision || latestRevision.promptHash !== hash) {
      const [maxRow] = await updateAgentScopedDb
        .select({ maxNum: max(agentPromptRevisions.revisionNumber) })
        .from(agentPromptRevisions)
        .where(eq(agentPromptRevisions.agentId, id));

      const nextRevisionNumber = (maxRow?.maxNum ?? 0) + 1;

      // Auto-generate change description
      const changes: string[] = [];
      if (data.masterPrompt !== undefined && data.masterPrompt !== existing.masterPrompt) {
        const diff = (data.masterPrompt?.length ?? 0) - (existing.masterPrompt?.length ?? 0);
        changes.push(`masterPrompt changed (${diff >= 0 ? '+' : ''}${diff} chars)`);
      }
      if (data.additionalPrompt !== undefined && data.additionalPrompt !== existing.additionalPrompt) {
        const diff = (data.additionalPrompt?.length ?? 0) - (existing.additionalPrompt?.length ?? 0);
        changes.push(`additionalPrompt changed (${diff >= 0 ? '+' : ''}${diff} chars)`);
      }

      await updateAgentScopedDb.insert(agentPromptRevisions).values({
        agentId: id,
        organisationId,
        revisionNumber: nextRevisionNumber,
        masterPrompt: newMasterPrompt,
        additionalPrompt: newAdditionalPrompt,
        promptHash: hash,
        changeDescription: changes.join('; '),
      });

      // Emit audit event for prompt change
      await auditService.log({
        organisationId,
        actorType: 'user',
        action: 'agent.prompt.updated',
        entityType: 'agent',
        entityId: id,
        metadata: { revisionNumber: nextRevisionNumber, changeDescription: changes.join('; ') },
      });
    }
  }

  const [updated] = await updateAgentScopedDb
    .update(agents)
    .set(update)
    // guard-ignore-next-line: org-scoped-writes reason="existing agent was fetched above with and(eq(agents.id, id), eq(agents.organisationId, organisationId)) — org membership already verified"
    .where(eq(agents.id, id))
    .returning();

  return { id: updated.id, name: updated.name, status: updated.status };
}

export async function activateAgent(id: string, organisationId: string) {
  const activateAgentScopedDb = getOrgScopedDb('crud.activateAgent');
  const [existing] = await activateAgentScopedDb
    .select()
    .from(agents)
    .where(and(eq(agents.id, id), eq(agents.organisationId, organisationId), isNull(agents.deletedAt)));
  if (!existing) throw { statusCode: 404, message: 'Agent not found' };

  // Draft agents require a masterPrompt before activation
  // System-managed agents inherit their prompt at runtime, so they are exempt
  if (!existing.isSystemManaged && !existing.masterPrompt?.trim()) {
    throw { statusCode: 400, message: 'Cannot activate agent: masterPrompt is required. Add a prompt before activating.' };
  }

  await configHistoryService.recordHistory({
    entityType: 'agent',
    entityId: id,
    organisationId,
    snapshot: existing as unknown as Record<string, unknown>,
    changedBy: null,
    changeSource: 'api',
    sessionId: null,
    changeSummary: null,
  });

  const [updated] = await activateAgentScopedDb
    .update(agents)
    .set({ status: 'active', updatedAt: new Date() })
    // guard-ignore-next-line: org-scoped-writes reason="existing agent was fetched above with and(eq(agents.id, id), eq(agents.organisationId, organisationId)) — org membership already verified"
    .where(eq(agents.id, id))
    .returning();

  return { id: updated.id, status: updated.status };
}

export async function deactivateAgent(id: string, organisationId: string) {
  const deactivateAgentScopedDb = getOrgScopedDb('crud.deactivateAgent');
  const [existing] = await deactivateAgentScopedDb
    .select()
    .from(agents)
    .where(and(eq(agents.id, id), eq(agents.organisationId, organisationId), isNull(agents.deletedAt)));
  if (!existing) throw { statusCode: 404, message: 'Agent not found' };

  await configHistoryService.recordHistory({
    entityType: 'agent',
    entityId: id,
    organisationId,
    snapshot: existing as unknown as Record<string, unknown>,
    changedBy: null,
    changeSource: 'api',
    sessionId: null,
    changeSummary: null,
  });

  const [updated] = await deactivateAgentScopedDb
    .update(agents)
    .set({ status: 'inactive', updatedAt: new Date() })
    // guard-ignore-next-line: org-scoped-writes reason="existing agent was fetched above with and(eq(agents.id, id), eq(agents.organisationId, organisationId)) — org membership already verified"
    .where(eq(agents.id, id))
    .returning();

  return { id: updated.id, status: updated.status };
}

export async function deleteAgent(id: string, organisationId: string) {
  const deleteAgentScopedDb = getOrgScopedDb('crud.deleteAgent');
  const [existing] = await deleteAgentScopedDb
    .select()
    .from(agents)
    .where(and(eq(agents.id, id), eq(agents.organisationId, organisationId), isNull(agents.deletedAt)));
  if (!existing) throw { statusCode: 404, message: 'Agent not found' };

  const now = new Date();
  await deleteAgentScopedDb.update(agents).set({ deletedAt: now, updatedAt: now }).where(and(eq(agents.id, id), eq(agents.organisationId, organisationId)));
  // Feature 2 §9 orphan cleanup: soft-delete test fixtures for this agent
  // (best-effort — not in the same DB transaction as the agent soft-delete above).
  await softDeleteByTarget(organisationId, 'agent', id);
  return { message: 'Agent deleted successfully' };
}
