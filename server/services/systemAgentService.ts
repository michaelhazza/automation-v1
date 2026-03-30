import { eq, and, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { systemAgents, agents } from '../db/schema/index.js';

// ---------------------------------------------------------------------------
// System Agent Service — manages platform-level agent definitions
// ---------------------------------------------------------------------------

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

export const systemAgentService = {
  async listAgents(filters?: { publishedOnly?: boolean }) {
    const conditions: ReturnType<typeof eq>[] = [];
    conditions.push(isNull(systemAgents.deletedAt));
    if (filters?.publishedOnly) conditions.push(eq(systemAgents.isPublished, true));

    return db
      .select()
      .from(systemAgents)
      .where(and(...conditions))
      .orderBy(systemAgents.name);
  },

  async getAgent(id: string) {
    const [agent] = await db
      .select()
      .from(systemAgents)
      .where(and(eq(systemAgents.id, id), isNull(systemAgents.deletedAt)));

    if (!agent) throw { statusCode: 404, message: 'System agent not found' };
    return agent;
  },

  async createAgent(data: {
    name: string;
    description?: string;
    icon?: string;
    masterPrompt: string;
    modelProvider?: string;
    modelId?: string;
    temperature?: number;
    maxTokens?: number;
    defaultSystemSkillSlugs?: string[];
    defaultOrgSkillSlugs?: string[];
    allowModelOverride?: boolean;
    defaultScheduleCron?: string;
    defaultTokenBudget?: number;
    defaultMaxToolCalls?: number;
    executionMode?: string;
  }) {
    const slug = slugify(data.name);

    const [agent] = await db
      .insert(systemAgents)
      .values({
        name: data.name,
        slug,
        description: data.description ?? null,
        icon: data.icon ?? null,
        masterPrompt: data.masterPrompt,
        modelProvider: data.modelProvider ?? 'anthropic',
        modelId: data.modelId ?? 'claude-sonnet-4-6',
        temperature: data.temperature ?? 0.7,
        maxTokens: data.maxTokens ?? 4096,
        defaultSystemSkillSlugs: data.defaultSystemSkillSlugs ?? [],
        defaultOrgSkillSlugs: data.defaultOrgSkillSlugs ?? [],
        allowModelOverride: data.allowModelOverride ?? true,
        defaultScheduleCron: data.defaultScheduleCron ?? null,
        defaultTokenBudget: data.defaultTokenBudget ?? 30000,
        defaultMaxToolCalls: data.defaultMaxToolCalls ?? 20,
        executionMode: (data.executionMode as 'api' | 'headless') ?? 'api',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return agent;
  },

  async updateAgent(id: string, data: Partial<{
    name: string;
    description: string;
    icon: string;
    masterPrompt: string;
    modelProvider: string;
    modelId: string;
    temperature: number;
    maxTokens: number;
    defaultSystemSkillSlugs: string[];
    defaultOrgSkillSlugs: string[];
    allowModelOverride: boolean;
    defaultScheduleCron: string;
    defaultTokenBudget: number;
    defaultMaxToolCalls: number;
    executionMode: string;
    status: string;
  }>) {
    const [existing] = await db.select().from(systemAgents)
      .where(and(eq(systemAgents.id, id), isNull(systemAgents.deletedAt)));
    if (!existing) throw { statusCode: 404, message: 'System agent not found' };

    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (data.name !== undefined) {
      update.name = data.name;
      update.slug = slugify(data.name);
    }
    if (data.description !== undefined) update.description = data.description;
    if (data.icon !== undefined) update.icon = data.icon;
    if (data.masterPrompt !== undefined) update.masterPrompt = data.masterPrompt;
    if (data.modelProvider !== undefined) update.modelProvider = data.modelProvider;
    if (data.modelId !== undefined) update.modelId = data.modelId;
    if (data.temperature !== undefined) update.temperature = data.temperature;
    if (data.maxTokens !== undefined) update.maxTokens = data.maxTokens;
    if (data.defaultSystemSkillSlugs !== undefined) update.defaultSystemSkillSlugs = data.defaultSystemSkillSlugs;
    if (data.defaultOrgSkillSlugs !== undefined) update.defaultOrgSkillSlugs = data.defaultOrgSkillSlugs;
    if (data.allowModelOverride !== undefined) update.allowModelOverride = data.allowModelOverride;
    if (data.defaultScheduleCron !== undefined) update.defaultScheduleCron = data.defaultScheduleCron;
    if (data.defaultTokenBudget !== undefined) update.defaultTokenBudget = data.defaultTokenBudget;
    if (data.defaultMaxToolCalls !== undefined) update.defaultMaxToolCalls = data.defaultMaxToolCalls;
    if (data.executionMode !== undefined) update.executionMode = data.executionMode;
    if (data.status !== undefined) update.status = data.status;

    const [updated] = await db.update(systemAgents).set(update).where(eq(systemAgents.id, id)).returning();
    return updated;
  },

  /**
   * Upsert a system agent by slug. Used by the CSV import endpoint.
   * Returns { created: true } when inserted, { created: false } when updated.
   */
  async upsertBySlug(data: {
    slug: string;
    name: string;
    description?: string | null;
    icon?: string | null;
    masterPrompt: string;
    modelProvider?: string;
    modelId?: string;
    temperature?: number;
    maxTokens?: number;
    defaultSystemSkillSlugs?: string[];
    defaultOrgSkillSlugs?: string[];
    defaultTokenBudget?: number;
    defaultMaxToolCalls?: number;
    executionMode?: string;
    isPublished?: boolean;
    status?: string;
    defaultScheduleCron?: string | null;
  }): Promise<{ agent: typeof systemAgents.$inferSelect; created: boolean }> {
    const [existing] = await db
      .select({ id: systemAgents.id })
      .from(systemAgents)
      .where(and(eq(systemAgents.slug, data.slug), isNull(systemAgents.deletedAt)));

    const values = {
      name: data.name,
      description: data.description ?? null,
      icon: data.icon ?? null,
      masterPrompt: data.masterPrompt,
      modelProvider: data.modelProvider ?? 'anthropic',
      modelId: data.modelId ?? 'claude-sonnet-4-6',
      temperature: data.temperature ?? 0.7,
      maxTokens: data.maxTokens ?? 4096,
      defaultSystemSkillSlugs: data.defaultSystemSkillSlugs ?? [],
      defaultOrgSkillSlugs: data.defaultOrgSkillSlugs ?? [],
      defaultTokenBudget: data.defaultTokenBudget ?? 30000,
      defaultMaxToolCalls: data.defaultMaxToolCalls ?? 20,
      executionMode: (data.executionMode as 'api' | 'headless') ?? 'api',
      isPublished: data.isPublished ?? false,
      status: (data.status as 'draft' | 'active' | 'inactive') ?? 'draft',
      defaultScheduleCron: data.defaultScheduleCron ?? null,
      updatedAt: new Date(),
    };

    if (existing) {
      const [agent] = await db.update(systemAgents).set(values).where(eq(systemAgents.id, existing.id)).returning();
      return { agent, created: false };
    }

    const [agent] = await db.insert(systemAgents).values({ ...values, slug: data.slug, createdAt: new Date() }).returning();
    return { agent, created: true };
  },

  async deleteAgent(id: string) {
    const [existing] = await db.select().from(systemAgents)
      .where(and(eq(systemAgents.id, id), isNull(systemAgents.deletedAt)));
    if (!existing) throw { statusCode: 404, message: 'System agent not found' };

    const [deleted] = await db.update(systemAgents).set({
      deletedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(systemAgents.id, id)).returning();

    return deleted;
  },

  async publishAgent(id: string) {
    const [existing] = await db.select().from(systemAgents)
      .where(and(eq(systemAgents.id, id), isNull(systemAgents.deletedAt)));
    if (!existing) throw { statusCode: 404, message: 'System agent not found' };

    const [published] = await db.update(systemAgents).set({
      isPublished: true,
      status: 'active',
      updatedAt: new Date(),
    }).where(eq(systemAgents.id, id)).returning();
    return published;
  },

  async unpublishAgent(id: string) {
    const [existing] = await db.select().from(systemAgents)
      .where(and(eq(systemAgents.id, id), isNull(systemAgents.deletedAt)));
    if (!existing) throw { statusCode: 404, message: 'System agent not found' };

    const [unpublished] = await db.update(systemAgents).set({
      isPublished: false,
      updatedAt: new Date(),
    }).where(eq(systemAgents.id, id)).returning();
    return unpublished;
  },

  /**
   * Install a system agent into an org as a linked org agent.
   * Creates an agents record with systemAgentId FK for living inheritance.
   */
  async installToOrg(systemAgentId: string, organisationId: string) {
    const systemAgent = await this.getAgent(systemAgentId);
    if (!systemAgent.isPublished) throw { statusCode: 400, message: 'System agent is not published' };

    const slug = systemAgent.slug + '-' + Date.now().toString(36);

    const [agent] = await db
      .insert(agents)
      .values({
        organisationId,
        systemAgentId: systemAgent.id,
        isSystemManaged: true,
        name: systemAgent.name,
        slug,
        description: systemAgent.description,
        icon: systemAgent.icon,
        // masterPrompt left empty for system-managed — the system prompt comes from systemAgents at runtime
        masterPrompt: '',
        additionalPrompt: '',
        modelProvider: systemAgent.modelProvider,
        modelId: systemAgent.modelId,
        temperature: systemAgent.temperature,
        maxTokens: systemAgent.maxTokens,
        defaultSkillSlugs: systemAgent.defaultOrgSkillSlugs ?? [],
        status: 'draft',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return agent;
  },

  /**
   * Get count of org agents linked to a system agent.
   */
  async getInstallCount(systemAgentId: string) {
    const rows = await db
      .select()
      .from(agents)
      .where(and(eq(agents.systemAgentId, systemAgentId), isNull(agents.deletedAt)));
    return rows.length;
  },
};
