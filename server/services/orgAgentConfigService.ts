import { eq, and, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { orgAgentConfigs, agents } from '../db/schema/index.js';

/**
 * @deprecated — Data migrated to `subaccount_agents` via migration 0106.
 * Callers should use `subaccountAgentService` with the org subaccount ID.
 * This service is kept during Phase 1 transition. Will be deleted in Phase 2 cleanup.
 * See: docs/org-subaccount-refactor-spec.md §10c
 */
export const orgAgentConfigService = {
  async listByOrg(organisationId: string) {
    const rows = await db
      .select({
        config: orgAgentConfigs,
        agentName: agents.name,
        agentSlug: agents.slug,
        agentDescription: agents.description,
        agentIcon: agents.icon,
        agentStatus: agents.status,
      })
      .from(orgAgentConfigs)
      .innerJoin(agents, eq(agents.id, orgAgentConfigs.agentId))
      .where(eq(orgAgentConfigs.organisationId, organisationId));

    return rows.map(({ config, agentName, agentSlug, agentDescription, agentIcon, agentStatus }) => ({
      ...config,
      agent: {
        id: config.agentId,
        name: agentName,
        slug: agentSlug,
        description: agentDescription,
        icon: agentIcon,
        status: agentStatus,
      },
    }));
  },

  async get(id: string, organisationId: string) {
    const [config] = await db
      .select()
      .from(orgAgentConfigs)
      .where(and(eq(orgAgentConfigs.id, id), eq(orgAgentConfigs.organisationId, organisationId)));
    if (!config) throw { statusCode: 404, message: 'Org agent config not found' };
    return config;
  },

  async getByAgentId(organisationId: string, agentId: string) {
    const [config] = await db
      .select()
      .from(orgAgentConfigs)
      .where(and(eq(orgAgentConfigs.organisationId, organisationId), eq(orgAgentConfigs.agentId, agentId)));
    if (!config) throw { statusCode: 404, message: 'Org agent config not found for this agent' };
    return config;
  },

  async getActiveConfigs(organisationId: string) {
    return db
      .select()
      .from(orgAgentConfigs)
      .where(and(eq(orgAgentConfigs.organisationId, organisationId), eq(orgAgentConfigs.isActive, true)));
  },

  async create(organisationId: string, data: {
    agentId: string;
    isActive?: boolean;
    tokenBudgetPerRun?: number;
    maxToolCallsPerRun?: number;
    timeoutSeconds?: number;
    maxCostPerRunCents?: number | null;
    maxLlmCallsPerRun?: number | null;
    skillSlugs?: string[] | null;
    allowedSkillSlugs?: string[] | null;
    customInstructions?: string | null;
    heartbeatEnabled?: boolean;
    heartbeatIntervalHours?: number;
    heartbeatOffsetMinutes?: number;
    scheduleCron?: string | null;
    scheduleEnabled?: boolean;
    scheduleTimezone?: string;
    allowedSubaccountIds?: string[] | null;
  }) {
    // Verify agent belongs to this org
    const [agent] = await db
      .select({ id: agents.id })
      .from(agents)
      .where(and(eq(agents.id, data.agentId), eq(agents.organisationId, organisationId), isNull(agents.deletedAt)));

    if (!agent) throw { statusCode: 404, message: 'Agent not found in this organisation' };

    const [config] = await db
      .insert(orgAgentConfigs)
      .values({
        organisationId,
        ...data,
      })
      .returning();

    return config;
  },

  async update(id: string, organisationId: string, data: Partial<{
    isActive: boolean;
    tokenBudgetPerRun: number;
    maxToolCallsPerRun: number;
    timeoutSeconds: number;
    maxCostPerRunCents: number | null;
    maxLlmCallsPerRun: number | null;
    skillSlugs: string[] | null;
    allowedSkillSlugs: string[] | null;
    customInstructions: string | null;
    heartbeatEnabled: boolean;
    heartbeatIntervalHours: number;
    heartbeatOffsetMinutes: number;
    scheduleCron: string | null;
    scheduleEnabled: boolean;
    scheduleTimezone: string;
    allowedSubaccountIds: string[] | null;
  }>) {
    const [updated] = await db
      .update(orgAgentConfigs)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(orgAgentConfigs.id, id), eq(orgAgentConfigs.organisationId, organisationId)))
      .returning();

    if (!updated) throw { statusCode: 404, message: 'Org agent config not found' };
    return updated;
  },

  async delete(id: string, organisationId: string) {
    const [deleted] = await db
      .delete(orgAgentConfigs)
      .where(and(eq(orgAgentConfigs.id, id), eq(orgAgentConfigs.organisationId, organisationId)))
      .returning();

    if (!deleted) throw { statusCode: 404, message: 'Org agent config not found' };
    return deleted;
  },

  async updateLastRunAt(id: string, organisationId: string) {
    await db
      .update(orgAgentConfigs)
      .set({ lastRunAt: new Date(), updatedAt: new Date() })
      .where(and(eq(orgAgentConfigs.id, id), eq(orgAgentConfigs.organisationId, organisationId)));
  },
};
