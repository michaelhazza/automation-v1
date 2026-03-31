import { eq, and, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { subaccountAgents, agents, agentDataSources } from '../db/schema/index.js';
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

    // Load full agent to get default skill slugs
    const [fullAgent] = await db
      .select({ defaultSkillSlugs: agents.defaultSkillSlugs })
      .from(agents)
      .where(eq(agents.id, agentId));

    const [link] = await db
      .insert(subaccountAgents)
      .values({
        organisationId,
        subaccountId,
        agentId,
        isActive: true,
        skillSlugs: fullAgent?.defaultSkillSlugs ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return link;
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

    // Cascade deletes subaccount-level data sources via FK
    await db.delete(subaccountAgents).where(eq(subaccountAgents.id, link.id));
  },

  async toggleActive(organisationId: string, linkId: string, isActive: boolean) {
    const [link] = await db
      .select()
      .from(subaccountAgents)
      .where(and(eq(subaccountAgents.id, linkId), eq(subaccountAgents.organisationId, organisationId)));

    if (!link) throw { statusCode: 404, message: 'Agent link not found' };

    const [updated] = await db
      .update(subaccountAgents)
      .set({ isActive, updatedAt: new Date() })
      .where(eq(subaccountAgents.id, linkId))
      .returning();

    return updated;
  },

  async updateLink(organisationId: string, linkId: string, data: {
    isActive?: boolean;
    parentSubaccountAgentId?: string | null;
    agentRole?: string | null;
    agentTitle?: string | null;
  }) {
    const [link] = await db
      .select()
      .from(subaccountAgents)
      .where(and(eq(subaccountAgents.id, linkId), eq(subaccountAgents.organisationId, organisationId)));

    if (!link) throw { statusCode: 404, message: 'Agent link not found' };

    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (data.isActive !== undefined) update.isActive = data.isActive;
    if (data.agentRole !== undefined) update.agentRole = data.agentRole;
    if (data.agentTitle !== undefined) update.agentTitle = data.agentTitle;

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
      .where(eq(subaccountAgents.id, linkId))
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
        sourceHeaders: data.sourceHeaders ?? null,
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
