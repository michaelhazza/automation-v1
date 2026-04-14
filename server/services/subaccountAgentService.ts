import { eq, and, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { subaccountAgents, agents, agentDataSources } from '../db/schema/index.js';
import { configHistoryService } from './configHistoryService.js';
import { validateHierarchy, buildTree } from './hierarchyService.js';

export const subaccountAgentService = {
  async listSubaccountAgents(organisationId: string, subaccountId: string) {
    const rows = await db
      .select({
        link: subaccountAgents,
        agentName: agents.name,
        agentSlug: agents.slug,
        agentDescription: agents.description,
        agentIcon: agents.icon,
        agentStatus: agents.status,
      })
      .from(subaccountAgents)
      .innerJoin(agents, eq(agents.id, subaccountAgents.agentId))
      .where(and(eq(subaccountAgents.organisationId, organisationId), eq(subaccountAgents.subaccountId, subaccountId)));

    return rows.map(({ link, agentName, agentSlug, agentDescription, agentIcon, agentStatus }) => ({
      id: link.id,
      agentId: link.agentId,
      subaccountId: link.subaccountId,
      isActive: link.isActive,
      // Hierarchy
      parentSubaccountAgentId: link.parentSubaccountAgentId,
      agentRole: link.agentRole,
      agentTitle: link.agentTitle,
      appliedTemplateId: link.appliedTemplateId,
      appliedTemplateVersion: link.appliedTemplateVersion,
      // Schedule & config
      scheduleCron: link.scheduleCron,
      scheduleEnabled: link.scheduleEnabled,
      scheduleTimezone: link.scheduleTimezone,
      tokenBudgetPerRun: link.tokenBudgetPerRun,
      maxToolCallsPerRun: link.maxToolCallsPerRun,
      timeoutSeconds: link.timeoutSeconds,
      skillSlugs: link.skillSlugs,
      customInstructions: link.customInstructions,
      lastRunAt: link.lastRunAt,
      nextRunAt: link.nextRunAt,
      createdAt: link.createdAt,
      updatedAt: link.updatedAt,
      agent: {
        id: link.agentId,
        name: agentName,
        slug: agentSlug,
        description: agentDescription,
        icon: agentIcon,
        status: agentStatus,
      },
    }));
  },

  async linkAgent(organisationId: string, subaccountId: string, agentId: string) {
    // Verify agent belongs to this org
    const [agent] = await db
      .select({ id: agents.id })
      .from(agents)
      .where(and(eq(agents.id, agentId), eq(agents.organisationId, organisationId), isNull(agents.deletedAt)));

    if (!agent) throw { statusCode: 404, message: 'Agent not found in this organisation' };

    // Load full agent to get default skill slugs + heartbeat config
    const [fullAgent] = await db
      .select({
        defaultSkillSlugs: agents.defaultSkillSlugs,
        heartbeatEnabled: agents.heartbeatEnabled,
        heartbeatIntervalHours: agents.heartbeatIntervalHours,
        heartbeatOffsetHours: agents.heartbeatOffsetHours,
      })
      .from(agents)
      .where(and(eq(agents.id, agentId), eq(agents.organisationId, organisationId)));

    try {
      const [link] = await db
        .insert(subaccountAgents)
        .values({
          organisationId,
          subaccountId,
          agentId,
          isActive: true,
          skillSlugs: fullAgent?.defaultSkillSlugs ?? null,
          heartbeatEnabled: fullAgent?.heartbeatEnabled ?? false,
          heartbeatIntervalHours: fullAgent?.heartbeatIntervalHours ?? null,
          heartbeatOffsetHours: fullAgent?.heartbeatOffsetHours ?? 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();

      await configHistoryService.recordHistory({
        entityType: 'subaccount_agent',
        entityId: link.id,
        organisationId,
        snapshot: link as unknown as Record<string, unknown>,
        changedBy: null,
        changeSource: 'api',
      });

      return link;
    } catch (err: unknown) {
      const e = err as { code?: string };
      if (e.code === '23505') throw { statusCode: 409, message: 'Agent is already linked to this subaccount' };
      throw err;
    }
  },

  async unlinkAgent(organisationId: string, subaccountId: string, agentId: string) {
    const [link] = await db
      .select()
      .from(subaccountAgents)
      .where(
        and(
          eq(subaccountAgents.organisationId, organisationId),
          eq(subaccountAgents.subaccountId, subaccountId),
          eq(subaccountAgents.agentId, agentId)
        )
      );

    if (!link) throw { statusCode: 404, message: 'Agent link not found' };

    await configHistoryService.recordHistory({
      entityType: 'subaccount_agent',
      entityId: link.id,
      organisationId,
      snapshot: link as unknown as Record<string, unknown>,
      changedBy: null,
      changeSource: 'api',
      changeSummary: 'Entity deleted',
    });

    // Cascade deletes subaccount-level data sources via FK
    await db.delete(subaccountAgents).where(eq(subaccountAgents.id, link.id));
  },

  async getLinkById(organisationId: string, subaccountId: string, linkId: string) {
    const [row] = await db
      .select({
        link: subaccountAgents,
        agentName: agents.name,
        agentSlug: agents.slug,
        agentDescription: agents.description,
        agentIcon: agents.icon,
        agentStatus: agents.status,
        agentModelProvider: agents.modelProvider,
        agentModelId: agents.modelId,
        agentDefaultSkillSlugs: agents.defaultSkillSlugs,
      })
      .from(subaccountAgents)
      .innerJoin(agents, eq(agents.id, subaccountAgents.agentId))
      .where(
        and(
          eq(subaccountAgents.id, linkId),
          eq(subaccountAgents.organisationId, organisationId),
          eq(subaccountAgents.subaccountId, subaccountId),
        )
      )
      .limit(1);

    if (!row) throw { statusCode: 404, message: 'Agent link not found' };

    const { link, agentName, agentSlug, agentDescription, agentIcon, agentStatus, agentModelProvider, agentModelId, agentDefaultSkillSlugs } = row;
    return {
      id: link.id,
      agentId: link.agentId,
      subaccountId: link.subaccountId,
      organisationId: link.organisationId,
      isActive: link.isActive,
      parentSubaccountAgentId: link.parentSubaccountAgentId,
      agentRole: link.agentRole,
      agentTitle: link.agentTitle,
      scheduleCron: link.scheduleCron,
      scheduleEnabled: link.scheduleEnabled,
      scheduleTimezone: link.scheduleTimezone,
      concurrencyPolicy: link.concurrencyPolicy,
      catchUpPolicy: link.catchUpPolicy,
      catchUpCap: link.catchUpCap,
      maxConcurrentRuns: link.maxConcurrentRuns,
      heartbeatEnabled: link.heartbeatEnabled,
      heartbeatIntervalHours: link.heartbeatIntervalHours,
      heartbeatOffsetHours: link.heartbeatOffsetHours,
      heartbeatOffsetMinutes: link.heartbeatOffsetMinutes,
      tokenBudgetPerRun: link.tokenBudgetPerRun,
      maxToolCallsPerRun: link.maxToolCallsPerRun,
      timeoutSeconds: link.timeoutSeconds,
      skillSlugs: link.skillSlugs,
      customInstructions: link.customInstructions,
      maxCostPerRunCents: link.maxCostPerRunCents,
      maxLlmCallsPerRun: link.maxLlmCallsPerRun,
      lastRunAt: link.lastRunAt,
      nextRunAt: link.nextRunAt,
      createdAt: link.createdAt,
      updatedAt: link.updatedAt,
      agent: {
        id: link.agentId,
        name: agentName,
        slug: agentSlug,
        description: agentDescription,
        icon: agentIcon,
        status: agentStatus,
        modelProvider: agentModelProvider,
        modelId: agentModelId,
        defaultSkillSlugs: (agentDefaultSkillSlugs ?? []) as string[],
      },
    };
  },

  async updateLink(organisationId: string, linkId: string, data: {
    isActive?: boolean;
    parentSubaccountAgentId?: string | null;
    agentRole?: string | null;
    agentTitle?: string | null;
    heartbeatEnabled?: boolean;
    heartbeatIntervalHours?: number | null;
    heartbeatOffsetHours?: number;
    heartbeatOffsetMinutes?: number;
    concurrencyPolicy?: 'skip_if_active' | 'coalesce_if_active' | 'always_enqueue';
    catchUpPolicy?: 'skip_missed' | 'enqueue_missed_with_cap';
    catchUpCap?: number;
    maxConcurrentRuns?: number;
    skillSlugs?: string[] | null;
    customInstructions?: string | null;
    tokenBudgetPerRun?: number;
    maxToolCallsPerRun?: number;
    timeoutSeconds?: number;
    maxCostPerRunCents?: number | null;
    maxLlmCallsPerRun?: number | null;
  }) {
    const [link] = await db
      .select()
      .from(subaccountAgents)
      .where(and(eq(subaccountAgents.id, linkId), eq(subaccountAgents.organisationId, organisationId)));

    if (!link) throw { statusCode: 404, message: 'Agent link not found' };

    await configHistoryService.recordHistory({
      entityType: 'subaccount_agent',
      entityId: linkId,
      organisationId,
      snapshot: link as unknown as Record<string, unknown>,
      changedBy: null,
      changeSource: 'api',
    });

    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (data.isActive !== undefined) update.isActive = data.isActive;
    if (data.agentRole !== undefined) update.agentRole = data.agentRole;
    if (data.agentTitle !== undefined) update.agentTitle = data.agentTitle;
    if (data.heartbeatEnabled !== undefined) update.heartbeatEnabled = data.heartbeatEnabled;
    if (data.heartbeatIntervalHours !== undefined) update.heartbeatIntervalHours = data.heartbeatIntervalHours;
    if (data.heartbeatOffsetHours !== undefined) update.heartbeatOffsetHours = data.heartbeatOffsetHours;
    if (data.heartbeatOffsetMinutes !== undefined) update.heartbeatOffsetMinutes = data.heartbeatOffsetMinutes;
    // Concurrency policies
    if (data.concurrencyPolicy !== undefined) update.concurrencyPolicy = data.concurrencyPolicy;
    if (data.catchUpPolicy !== undefined) update.catchUpPolicy = data.catchUpPolicy;
    if (data.catchUpCap !== undefined) update.catchUpCap = data.catchUpCap;
    if (data.maxConcurrentRuns !== undefined) update.maxConcurrentRuns = data.maxConcurrentRuns;
    // Skills, instructions, budget
    if ('skillSlugs' in data) update.skillSlugs = data.skillSlugs ?? null;
    if ('customInstructions' in data) update.customInstructions = data.customInstructions ?? null;
    if (data.tokenBudgetPerRun !== undefined) update.tokenBudgetPerRun = data.tokenBudgetPerRun;
    if (data.maxToolCallsPerRun !== undefined) update.maxToolCallsPerRun = data.maxToolCallsPerRun;
    if (data.timeoutSeconds !== undefined) update.timeoutSeconds = data.timeoutSeconds;
    if ('maxCostPerRunCents' in data) update.maxCostPerRunCents = data.maxCostPerRunCents ?? null;
    if ('maxLlmCallsPerRun' in data) update.maxLlmCallsPerRun = data.maxLlmCallsPerRun ?? null;

    if ('parentSubaccountAgentId' in data) {
      const parentId = data.parentSubaccountAgentId;
      if (parentId) {
        const validation = await validateHierarchy('subaccount_agents', linkId, parentId);
        if (!validation.valid) throw { statusCode: 400, message: validation.error };
      }
      update.parentSubaccountAgentId = parentId ?? null;
    }

    const [updated] = await db
      .update(subaccountAgents)
      .set(update)
      .where(and(eq(subaccountAgents.id, linkId), eq(subaccountAgents.organisationId, organisationId)))
      .returning();

    return updated;
  },

  async getTree(organisationId: string, subaccountId: string) {
    const rows = await db
      .select({
        link: subaccountAgents,
        agentName: agents.name,
        agentSlug: agents.slug,
        agentStatus: agents.status,
        agentMasterPrompt: agents.masterPrompt,
      })
      .from(subaccountAgents)
      .innerJoin(agents, eq(agents.id, subaccountAgents.agentId))
      .where(and(
        eq(subaccountAgents.organisationId, organisationId),
        eq(subaccountAgents.subaccountId, subaccountId)
      ));

    const items = rows.map(({ link, agentName, agentSlug, agentStatus, agentMasterPrompt }) => ({
      id: link.id,
      agentId: link.agentId,
      parentSubaccountAgentId: link.parentSubaccountAgentId,
      agentRole: link.agentRole,
      agentTitle: link.agentTitle,
      isActive: link.isActive,
      sortOrder: 0,
      createdAt: link.createdAt,
      agent: {
        name: agentName,
        slug: agentSlug,
        status: agentStatus,
        isDraft: agentStatus === 'draft',
        requiresPrompt: agentStatus === 'draft' && !agentMasterPrompt,
      },
    }));

    return buildTree(items, (i) => i.parentSubaccountAgentId);
  },

  async getLinkByAgentInSubaccount(organisationId: string, subaccountId: string, agentId: string) {
    const [link] = await db
      .select()
      .from(subaccountAgents)
      .where(
        and(
          eq(subaccountAgents.organisationId, organisationId),
          eq(subaccountAgents.subaccountId, subaccountId),
          eq(subaccountAgents.agentId, agentId),
        )
      )
      .limit(1);
    return link ?? null;
  },

  // ─── Subaccount-level data sources ──────────────────────────────────────────

  async listSubaccountDataSources(subaccountAgentId: string) {
    return db
      .select()
      .from(agentDataSources)
      .where(eq(agentDataSources.subaccountAgentId, subaccountAgentId));
  },

  async addSubaccountDataSource(
    subaccountAgentId: string,
    agentId: string,
    data: {
      name: string;
      description?: string;
      sourceType: 'r2' | 's3' | 'http_url' | 'google_docs' | 'dropbox' | 'file_upload';
      sourcePath: string;
      sourceHeaders?: Record<string, string>;
      contentType?: 'json' | 'csv' | 'markdown' | 'text' | 'auto';
      priority?: number;
      maxTokenBudget?: number;
      cacheMinutes?: number;
      syncMode?: 'lazy' | 'proactive';
    }
  ) {
    const [source] = await db
      .insert(agentDataSources)
      .values({
        agentId,
        subaccountAgentId,
        name: data.name,
        description: data.description ?? null,
        sourceType: data.sourceType,
        sourcePath: data.sourcePath,
        sourceHeaders: data.sourceHeaders ? JSON.stringify(data.sourceHeaders) : null,
        contentType: data.contentType ?? 'auto',
        priority: data.priority ?? 0,
        maxTokenBudget: data.maxTokenBudget ?? 8000,
        cacheMinutes: data.cacheMinutes ?? 60,
        syncMode: data.syncMode ?? 'lazy',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return source;
  },

  async removeSubaccountDataSource(id: string, subaccountAgentId: string) {
    const [source] = await db
      .select()
      .from(agentDataSources)
      .where(and(eq(agentDataSources.id, id), eq(agentDataSources.subaccountAgentId, subaccountAgentId)));

    if (!source) throw { statusCode: 404, message: 'Data source not found' };

    await db.delete(agentDataSources).where(eq(agentDataSources.id, id));
  },
};
