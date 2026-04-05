import { eq, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import { mcpServerConfigs, mcpServerAgentLinks } from '../db/schema/index.js';
import type { McpServerConfig, NewMcpServerConfig } from '../db/schema/mcpServerConfigs.js';
import { connectionTokenService } from './connectionTokenService.js';

// ---------------------------------------------------------------------------
// MCP Server Config Service — CRUD for org-level MCP server definitions
// ---------------------------------------------------------------------------

export const mcpServerConfigService = {
  async list(organisationId: string): Promise<McpServerConfig[]> {
    return db
      .select()
      .from(mcpServerConfigs)
      .where(eq(mcpServerConfigs.organisationId, organisationId))
      .orderBy(mcpServerConfigs.createdAt);
  },

  async getById(id: string, organisationId: string): Promise<McpServerConfig> {
    const [config] = await db
      .select()
      .from(mcpServerConfigs)
      .where(
        and(eq(mcpServerConfigs.id, id), eq(mcpServerConfigs.organisationId, organisationId))
      );
    if (!config) throw Object.assign(new Error('MCP server config not found'), { statusCode: 404 });
    return config;
  },

  async getBySlug(slug: string, organisationId: string): Promise<McpServerConfig | null> {
    const [config] = await db
      .select()
      .from(mcpServerConfigs)
      .where(
        and(eq(mcpServerConfigs.slug, slug), eq(mcpServerConfigs.organisationId, organisationId))
      );
    return config ?? null;
  },

  async create(organisationId: string, input: Omit<NewMcpServerConfig, 'id' | 'organisationId' | 'createdAt' | 'updatedAt'>): Promise<McpServerConfig> {
    // Check slug uniqueness
    const existing = await this.getBySlug(input.slug!, organisationId);
    if (existing) {
      throw Object.assign(new Error(`MCP server with slug "${input.slug}" already exists`), { statusCode: 409 });
    }

    // Encrypt env vars if provided
    let envEncrypted: string | null = null;
    if (input.envEncrypted) {
      envEncrypted = connectionTokenService.encryptToken(input.envEncrypted);
    }

    const [config] = await db
      .insert(mcpServerConfigs)
      .values({
        ...input,
        organisationId,
        envEncrypted,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
    return config;
  },

  async update(
    id: string,
    organisationId: string,
    updates: Partial<Pick<McpServerConfig, 'envEncrypted' | 'defaultGateLevel' | 'toolGateOverrides' | 'status' | 'allowedTools' | 'blockedTools' | 'priority' | 'maxConcurrency' | 'connectionMode'>>
  ): Promise<McpServerConfig> {
    const data: Record<string, unknown> = { ...updates, updatedAt: new Date() };

    // Encrypt env vars if being updated
    if (updates.envEncrypted !== undefined && updates.envEncrypted !== null) {
      data.envEncrypted = connectionTokenService.encryptToken(updates.envEncrypted);
    }

    const [updated] = await db
      .update(mcpServerConfigs)
      .set(data)
      .where(and(eq(mcpServerConfigs.id, id), eq(mcpServerConfigs.organisationId, organisationId)))
      .returning();
    if (!updated) throw Object.assign(new Error('MCP server config not found'), { statusCode: 404 });
    return updated;
  },

  async delete(id: string, organisationId: string): Promise<void> {
    const [deleted] = await db
      .delete(mcpServerConfigs)
      .where(and(eq(mcpServerConfigs.id, id), eq(mcpServerConfigs.organisationId, organisationId)))
      .returning({ id: mcpServerConfigs.id });
    if (!deleted) throw Object.assign(new Error('MCP server config not found'), { statusCode: 404 });
  },

  /** List active servers for an agent run. Respects agent links if any exist. */
  async listForAgent(agentId: string, organisationId: string): Promise<McpServerConfig[]> {
    // Check if agent has explicit links
    const links = await db
      .select({ mcpServerConfigId: mcpServerAgentLinks.mcpServerConfigId })
      .from(mcpServerAgentLinks)
      .where(eq(mcpServerAgentLinks.agentId, agentId));

    if (links.length > 0) {
      // Agent has explicit links — only return those servers
      const linkedIds = new Set(links.map((l: { mcpServerConfigId: string }) => l.mcpServerConfigId));
      const allActive = await db
        .select()
        .from(mcpServerConfigs)
        .where(and(eq(mcpServerConfigs.organisationId, organisationId), eq(mcpServerConfigs.status, 'active')));
      return allActive.filter((c: { id: string }) => linkedIds.has(c.id));
    }

    // No explicit links — return all active servers (opt-out model)
    return db
      .select()
      .from(mcpServerConfigs)
      .where(and(eq(mcpServerConfigs.organisationId, organisationId), eq(mcpServerConfigs.status, 'active')));
  },

  // ── Circuit breaker helpers ─────────────────────────────────────────────────

  async incrementFailure(id: string): Promise<void> {
    await db.execute(
      // Raw SQL for atomic increment
      /* sql */`
      UPDATE mcp_server_configs
      SET consecutive_failures = consecutive_failures + 1,
          last_error = 'Connection failed',
          updated_at = NOW()
      WHERE id = '${id}'
      `
    );
  },

  async openCircuit(id: string, until: Date): Promise<void> {
    await db
      .update(mcpServerConfigs)
      .set({ circuitOpenUntil: until, status: 'error', updatedAt: new Date() })
      .where(eq(mcpServerConfigs.id, id));
  },

  async resetCircuit(id: string): Promise<void> {
    await db
      .update(mcpServerConfigs)
      .set({
        consecutiveFailures: 0,
        circuitOpenUntil: null,
        status: 'active',
        lastConnectedAt: new Date(),
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(mcpServerConfigs.id, id));
  },

  async updateDiscoveredTools(
    id: string,
    tools: McpServerConfig['discoveredToolsJson'],
    hash: string,
    rejectedCount: number,
  ): Promise<void> {
    await db
      .update(mcpServerConfigs)
      .set({
        discoveredToolsJson: tools,
        discoveredToolsHash: hash,
        lastToolsRefreshAt: new Date(),
        rejectedToolCount: rejectedCount,
        updatedAt: new Date(),
      })
      .where(eq(mcpServerConfigs.id, id));
  },

  // ── Agent link helpers ──────────────────────────────────────────────────────

  async listAgentLinks(mcpServerConfigId: string) {
    return db
      .select()
      .from(mcpServerAgentLinks)
      .where(eq(mcpServerAgentLinks.mcpServerConfigId, mcpServerConfigId));
  },

  async createAgentLink(mcpServerConfigId: string, agentId: string, gateOverride?: string | null) {
    const [link] = await db
      .insert(mcpServerAgentLinks)
      .values({ mcpServerConfigId, agentId, gateOverride: gateOverride as 'auto' | 'review' | 'block' | null })
      .returning();
    return link;
  },

  async deleteAgentLink(linkId: string) {
    await db.delete(mcpServerAgentLinks).where(eq(mcpServerAgentLinks.id, linkId));
  },
};
