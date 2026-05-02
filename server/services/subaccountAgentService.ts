import { eq, and, isNull, ne } from 'drizzle-orm';
import { db } from '../db/index.js';
import { subaccountAgents, agents, agentDataSources, subaccounts, systemAgents } from '../db/schema/index.js';
import { workspaceIdentities } from '../db/schema/workspaceIdentities.js';
import { configHistoryService } from './configHistoryService.js';
import { validateHierarchy, buildTree } from './hierarchyService.js';
import { materialiseAutoAttachForAgent } from './memoryBlockService.js';
import { logger } from '../lib/logger.js';

// ─── Soft-delete defence-in-depth ──────────────────────────────────────────
function assertNotSoftDeleted(record: { deletedAt: Date | null }, label: string): void {
  if (record.deletedAt !== null) {
    throw new Error(`soft_deleted_${label}_leak`);
  }
}

// ─── Last-root invariant ────────────────────────────────────────────────────
// Invariant: every subaccount that has ever had a root agent must always have
// at least one active root (parent_subaccount_agent_id IS NULL AND is_active =
// true). The partial unique index (migration 0214) enforces "at most one";
// this helper enforces "at least one" at the service-layer mutation boundary.
//
// Transient 0-root states are allowed only during low-level transactional
// flows that bypass these service methods (e.g. hierarchyTemplateService
// .applyTemplate manages its own atomic swap). User-facing mutations that
// flow through updateLink / unlinkAgent MUST keep at least one root alive.
async function assertAnotherActiveRootExistsInSubaccount(
  organisationId: string,
  subaccountId: string,
  excludeLinkId: string,
): Promise<void> {
  const others = await db
    .select({ id: subaccountAgents.id })
    .from(subaccountAgents)
    .where(and(
      eq(subaccountAgents.organisationId, organisationId),
      eq(subaccountAgents.subaccountId, subaccountId),
      isNull(subaccountAgents.parentSubaccountAgentId),
      eq(subaccountAgents.isActive, true),
      ne(subaccountAgents.id, excludeLinkId),
    ))
    .limit(1);

  if (others.length === 0) {
    throw {
      statusCode: 409,
      errorCode: 'last_root_protected',
      message:
        'Cannot deactivate, unlink, or re-parent the last active root agent of a subaccount. ' +
        'Activate another root (parentSubaccountAgentId: null, isActive: true) before removing this one, ' +
        'or apply a hierarchy template to atomically replace the tree.',
    };
  }
}

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
        workspaceIdentityStatus: workspaceIdentities.status,
      })
      .from(subaccountAgents)
      .innerJoin(agents, and(eq(agents.id, subaccountAgents.agentId), isNull(agents.deletedAt)))
      .leftJoin(
        workspaceIdentities,
        and(
          eq(workspaceIdentities.actorId, agents.workspaceActorId),
          isNull(workspaceIdentities.archivedAt),
        ),
      )
      .where(
        and(
          eq(subaccountAgents.organisationId, organisationId),
          eq(subaccountAgents.subaccountId, subaccountId),
          eq(subaccountAgents.isActive, true),
        ),
      );

    return rows.map(({ link, agentName, agentSlug, agentDescription, agentIcon, agentStatus, workspaceIdentityStatus }) => ({
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
      // Heartbeat
      heartbeatEnabled: link.heartbeatEnabled,
      heartbeatIntervalHours: link.heartbeatIntervalHours,
      heartbeatOffsetHours: link.heartbeatOffsetHours,
      heartbeatOffsetMinutes: link.heartbeatOffsetMinutes,
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
      workspaceIdentityStatus: workspaceIdentityStatus ?? null,
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

      // Phase G / §7.4 / G7.2 — newly-linked agent inherits every
      // auto-attach memory block in the sub-account. Best-effort: failures
      // here are logged but do not undo the link.
      try {
        await materialiseAutoAttachForAgent(agentId, subaccountId, organisationId);
      } catch (err) {
        logger.error('subaccount_agent_auto_attach_failed', {
          agentId,
          subaccountId,
          error: err instanceof Error ? err.message : String(err),
        });
      }

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

    // Guard last-root invariant — cannot hard-delete the last active root.
    if (link.parentSubaccountAgentId === null && link.isActive) {
      await assertAnotherActiveRootExistsInSubaccount(
        organisationId,
        link.subaccountId,
        link.id,
      );
    }

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
        agentWorkspaceActorId: agents.workspaceActorId,
        agentDeletedAt: agents.deletedAt,
      })
      .from(subaccountAgents)
      .innerJoin(agents, and(eq(agents.id, subaccountAgents.agentId), isNull(agents.deletedAt)))
      .where(
        and(
          eq(subaccountAgents.id, linkId),
          eq(subaccountAgents.organisationId, organisationId),
          eq(subaccountAgents.subaccountId, subaccountId),
        )
      )
      .limit(1);

    if (!row) throw { statusCode: 404, message: 'Agent link not found' };
    assertNotSoftDeleted({ deletedAt: row.agentDeletedAt }, 'agent');

    const { link, agentName, agentSlug, agentDescription, agentIcon, agentStatus, agentModelProvider, agentModelId, agentDefaultSkillSlugs, agentWorkspaceActorId } = row;
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
        workspaceActorId: agentWorkspaceActorId ?? null,
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

    // Guard last-root invariant — if this link is currently an active root
    // and the caller is trying to deactivate it or re-parent it (away from
    // root status), require another active root to exist first.
    const isCurrentlyActiveRoot = link.parentSubaccountAgentId === null && link.isActive;
    const wouldDeactivate = data.isActive === false;
    const wouldReparentAwayFromRoot =
      'parentSubaccountAgentId' in data &&
      data.parentSubaccountAgentId !== null &&
      data.parentSubaccountAgentId !== undefined;

    if (isCurrentlyActiveRoot && (wouldDeactivate || wouldReparentAwayFromRoot)) {
      await assertAnotherActiveRootExistsInSubaccount(
        organisationId,
        link.subaccountId,
        link.id,
      );
    }

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
      .innerJoin(agents, and(eq(agents.id, subaccountAgents.agentId), isNull(agents.deletedAt)))
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

  /**
   * Returns the systemAgent slug for the given agent, or null if the agent
   * is not system-managed. Used to enforce per-slug linking restrictions.
   */
  async getAgentSystemSlug(agentId: string, organisationId: string): Promise<string | null> {
    const [row] = await db
      .select({ systemAgentSlug: systemAgents.slug })
      .from(agents)
      .leftJoin(systemAgents, and(eq(agents.systemAgentId, systemAgents.id), isNull(systemAgents.deletedAt)))
      .where(and(eq(agents.id, agentId), eq(agents.organisationId, organisationId)));
    return row?.systemAgentSlug ?? null;
  },

  /**
   * Returns true if the given subaccount is the org subaccount (isOrgSubaccount=true).
   * Used to enforce that certain agents (e.g. configuration-assistant) can only
   * be linked to the org subaccount.
   */
  async isOrgSubaccount(subaccountId: string, organisationId: string): Promise<boolean> {
    const [sa] = await db
      .select({ isOrgSubaccount: subaccounts.isOrgSubaccount })
      .from(subaccounts)
      .where(and(eq(subaccounts.id, subaccountId), eq(subaccounts.organisationId, organisationId)));
    return sa?.isOrgSubaccount ?? false;
  },

  async findLink(
    linkId: string,
    subaccountId: string,
    agentId: string,
  ): Promise<{ id: string; agentId: string; subaccountId: string } | undefined> {
    const [row] = await db
      .select({ id: subaccountAgents.id, agentId: subaccountAgents.agentId, subaccountId: subaccountAgents.subaccountId })
      .from(subaccountAgents)
      .where(and(
        eq(subaccountAgents.id, linkId),
        eq(subaccountAgents.subaccountId, subaccountId),
        eq(subaccountAgents.agentId, agentId),
      ))
      .limit(1);
    return row;
  },
};
