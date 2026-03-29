import { eq, and, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { agents } from '../db/schema/index.js';
import { agentTemplates } from '../db/schema/agentTemplates.js';

// ---------------------------------------------------------------------------
// Agent Template Service — system-level template library
// ---------------------------------------------------------------------------

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

export const agentTemplateService = {
  async listTemplates(filters?: { category?: string; publishedOnly?: boolean }) {
    const conditions: ReturnType<typeof eq>[] = [];
    if (filters?.publishedOnly) conditions.push(eq(agentTemplates.isPublished, true));
    if (filters?.category) conditions.push(eq(agentTemplates.category, filters.category));

    const rows = await db
      .select()
      .from(agentTemplates)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(agentTemplates.category, agentTemplates.name);

    return rows;
  },

  async getTemplate(id: string) {
    const [template] = await db
      .select()
      .from(agentTemplates)
      .where(eq(agentTemplates.id, id));

    if (!template) throw { statusCode: 404, message: 'Agent template not found' };
    return template;
  },

  async createTemplate(data: {
    name: string;
    description?: string;
    category?: string;
    masterPrompt: string;
    modelProvider?: string;
    modelId?: string;
    temperature?: number;
    maxTokens?: number;
    responseMode?: string;
    outputSize?: string;
    allowModelOverride?: number;
    defaultScheduleCron?: string;
    defaultTokenBudget?: number;
    defaultMaxToolCalls?: number;
    expectedDataTypes?: string[];
    skillSlugs?: string[];
    executionMode?: string;
  }) {
    const slug = slugify(data.name);

    const [template] = await db
      .insert(agentTemplates)
      .values({
        name: data.name,
        slug,
        description: data.description ?? null,
        category: data.category ?? null,
        masterPrompt: data.masterPrompt,
        modelProvider: data.modelProvider ?? 'anthropic',
        modelId: data.modelId ?? 'claude-sonnet-4-6',
        temperature: data.temperature ?? 0.7,
        maxTokens: data.maxTokens ?? 4096,
        responseMode: (data.responseMode as 'balanced' | 'precise' | 'expressive' | 'highly_creative') ?? 'balanced',
        outputSize: (data.outputSize as 'standard' | 'extended' | 'maximum') ?? 'standard',
        allowModelOverride: data.allowModelOverride ?? 1,
        defaultScheduleCron: data.defaultScheduleCron ?? null,
        defaultTokenBudget: data.defaultTokenBudget ?? 30000,
        defaultMaxToolCalls: data.defaultMaxToolCalls ?? 20,
        expectedDataTypes: data.expectedDataTypes ?? null,
        skillSlugs: data.skillSlugs ?? null,
        executionMode: data.executionMode ?? 'api',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return template;
  },

  async updateTemplate(id: string, data: Partial<{
    name: string;
    description: string;
    category: string;
    masterPrompt: string;
    modelProvider: string;
    modelId: string;
    temperature: number;
    maxTokens: number;
    responseMode: string;
    outputSize: string;
    allowModelOverride: number;
    defaultScheduleCron: string;
    defaultTokenBudget: number;
    defaultMaxToolCalls: number;
    expectedDataTypes: string[];
    skillSlugs: string[];
    executionMode: string;
    isPublished: boolean;
  }>) {
    const [existing] = await db.select().from(agentTemplates).where(eq(agentTemplates.id, id));
    if (!existing) throw { statusCode: 404, message: 'Agent template not found' };

    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (data.name !== undefined) {
      update.name = data.name;
      update.slug = slugify(data.name);
    }
    if (data.description !== undefined) update.description = data.description;
    if (data.category !== undefined) update.category = data.category;
    if (data.masterPrompt !== undefined) update.masterPrompt = data.masterPrompt;
    if (data.modelProvider !== undefined) update.modelProvider = data.modelProvider;
    if (data.modelId !== undefined) update.modelId = data.modelId;
    if (data.temperature !== undefined) update.temperature = data.temperature;
    if (data.maxTokens !== undefined) update.maxTokens = data.maxTokens;
    if (data.responseMode !== undefined) update.responseMode = data.responseMode;
    if (data.outputSize !== undefined) update.outputSize = data.outputSize;
    if (data.allowModelOverride !== undefined) update.allowModelOverride = data.allowModelOverride;
    if (data.defaultScheduleCron !== undefined) update.defaultScheduleCron = data.defaultScheduleCron;
    if (data.defaultTokenBudget !== undefined) update.defaultTokenBudget = data.defaultTokenBudget;
    if (data.defaultMaxToolCalls !== undefined) update.defaultMaxToolCalls = data.defaultMaxToolCalls;
    if (data.expectedDataTypes !== undefined) update.expectedDataTypes = data.expectedDataTypes;
    if (data.skillSlugs !== undefined) update.skillSlugs = data.skillSlugs;
    if (data.executionMode !== undefined) update.executionMode = data.executionMode;
    if (data.isPublished !== undefined) update.isPublished = data.isPublished;

    const [updated] = await db
      .update(agentTemplates)
      .set(update)
      .where(eq(agentTemplates.id, id))
      .returning();

    return updated;
  },

  async deleteTemplate(id: string) {
    const [existing] = await db.select().from(agentTemplates).where(eq(agentTemplates.id, id));
    if (!existing) throw { statusCode: 404, message: 'Agent template not found' };

    await db.delete(agentTemplates).where(eq(agentTemplates.id, id));
    return { message: 'Template deleted' };
  },

  async publishTemplate(id: string) {
    return this.updateTemplate(id, { isPublished: true });
  },

  async unpublishTemplate(id: string) {
    return this.updateTemplate(id, { isPublished: false });
  },

  /**
   * Install a template into an org as a real agent.
   * Creates the agent at org level, returns the new agent record.
   */
  async installToOrg(templateId: string, organisationId: string) {
    const template = await this.getTemplate(templateId);
    if (!template.isPublished) throw { statusCode: 400, message: 'Template is not published' };

    const slug = template.slug + '-' + Date.now().toString(36);

    const [agent] = await db
      .insert(agents)
      .values({
        organisationId,
        sourceTemplateId: template.id,
        sourceTemplateVersion: template.version,
        name: template.name,
        slug,
        description: template.description,
        masterPrompt: template.masterPrompt,
        modelProvider: template.modelProvider,
        modelId: template.modelId,
        temperature: template.temperature,
        maxTokens: template.maxTokens,
        responseMode: template.responseMode,
        outputSize: template.outputSize,
        allowModelOverride: template.allowModelOverride,
        status: 'draft',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return agent;
  },
};
