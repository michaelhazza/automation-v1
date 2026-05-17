import { eq, and, sql } from 'drizzle-orm';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { mcpServerConfigs, mcpServerAgentLinks } from '../db/schema/index.js';
import type { McpServerConfig, NewMcpServerConfig } from '../db/schema/mcpServerConfigs.js';
import { configHistoryService } from './configHistoryService.js';
import { connectionTokenService } from './connectionTokenService.js';

// ---------------------------------------------------------------------------
// MCP Server Config Service — CRUD for org-level MCP server definitions
// ---------------------------------------------------------------------------

export const mcpServerConfigService = {
  async list(organisationId: string): Promise<McpServerConfig[]> {
    return getOrgScopedDb('mcpServerConfigService.list')
      .select()
      .from(mcpServerConfigs)
      .where(eq(mcpServerConfigs.organisationId, organisationId))
      .orderBy(mcpServerConfigs.createdAt);
  },

  async listBySubaccount(organisationId: string, subaccountId: string): Promise<McpServerConfig[]> {
    return getOrgScopedDb('mcpServerConfigService.listBySubaccount')
      .select()
      .from(mcpServerConfigs)
      .where(
        and(
          eq(mcpServerConfigs.organisationId, organisationId),
          eq(mcpServerConfigs.subaccountId, subaccountId),
        )
      )
      .orderBy(mcpServerConfigs.createdAt);
  },

  async getById(id: string, organisationId: string): Promise<McpServerConfig> {
    const [config] = await getOrgScopedDb('mcpServerConfigService.getById')
      .select()
      .from(mcpServerConfigs)
      .where(
        and(eq(mcpServerConfigs.id, id), eq(mcpServerConfigs.organisationId, organisationId))
      );
    if (!config) throw Object.assign(new Error('MCP server config not found'), { statusCode: 404 });
    return config;
  },

  async getBySlug(slug: string, organisationId: string): Promise<McpServerConfig | null> {
    const [config] = await getOrgScopedDb('mcpServerConfigService.getBySlug')
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

    const [config] = await getOrgScopedDb('mcpServerConfigService.create')
      .insert(mcpServerConfigs)
      .values({
        ...input,
        organisationId,
        envEncrypted,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    await configHistoryService.recordHistory({
      entityType: 'mcp_server_config',
      entityId: config.id,
      organisationId,
      snapshot: config as unknown as Record<string, unknown>,
      changedBy: null,
      changeSource: 'api',
    });

    return config;
  },

  async createForSubaccount(
    organisationId: string,
    subaccountId: string,
    input: Omit<NewMcpServerConfig, 'id' | 'organisationId' | 'subaccountId' | 'createdAt' | 'updatedAt'>,
  ): Promise<McpServerConfig> {
    // Check slug uniqueness scoped to the subaccount
    const createForSubScopedDb = getOrgScopedDb('mcpServerConfigService.createForSubaccount');
    const [existing] = await createForSubScopedDb
      .select()
      .from(mcpServerConfigs)
      .where(
        and(
          eq(mcpServerConfigs.slug, input.slug!),
          eq(mcpServerConfigs.organisationId, organisationId),
          eq(mcpServerConfigs.subaccountId, subaccountId),
        )
      );
    if (existing) {
      throw Object.assign(new Error(`MCP server with slug "${input.slug}" already exists in this subaccount`), { statusCode: 409 });
    }

    // Encrypt env vars if provided
    let envEncrypted: string | null = null;
    if (input.envEncrypted) {
      envEncrypted = connectionTokenService.encryptToken(input.envEncrypted);
    }

    const [config] = await createForSubScopedDb
      .insert(mcpServerConfigs)
      .values({
        ...input,
        organisationId,
        subaccountId,
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
    // Record pre-mutation snapshot for config history
    const updateScopedDb = getOrgScopedDb('mcpServerConfigService.update');
    const [preState] = await updateScopedDb.select().from(mcpServerConfigs)
      .where(and(eq(mcpServerConfigs.id, id), eq(mcpServerConfigs.organisationId, organisationId)));
    if (preState) {
      await configHistoryService.recordHistory({
        entityType: 'mcp_server_config', entityId: id, organisationId,
        snapshot: preState as unknown as Record<string, unknown>,
        changedBy: null, changeSource: 'api',
      });
    }

    const data: Record<string, unknown> = { ...updates, updatedAt: new Date() };

    // Encrypt env vars if being updated
    if (updates.envEncrypted !== undefined && updates.envEncrypted !== null) {
      data.envEncrypted = connectionTokenService.encryptToken(updates.envEncrypted);
    }

    const [updated] = await updateScopedDb
      .update(mcpServerConfigs)
      .set(data)
      .where(and(eq(mcpServerConfigs.id, id), eq(mcpServerConfigs.organisationId, organisationId)))
      .returning();
    if (!updated) throw Object.assign(new Error('MCP server config not found'), { statusCode: 404 });
    return updated;
  },

  async delete(id: string, organisationId: string): Promise<void> {
    const deleteScopedDb = getOrgScopedDb('mcpServerConfigService.delete');
    const [preState] = await deleteScopedDb.select().from(mcpServerConfigs)
      .where(and(eq(mcpServerConfigs.id, id), eq(mcpServerConfigs.organisationId, organisationId)));
    if (preState) {
      await configHistoryService.recordHistory({
        entityType: 'mcp_server_config', entityId: id, organisationId,
        snapshot: preState as unknown as Record<string, unknown>,
        changedBy: null, changeSource: 'api', changeSummary: 'Entity deleted',
      });
    }

    const [deleted] = await deleteScopedDb
      .delete(mcpServerConfigs)
      .where(and(eq(mcpServerConfigs.id, id), eq(mcpServerConfigs.organisationId, organisationId)))
      .returning({ id: mcpServerConfigs.id });
    if (!deleted) throw Object.assign(new Error('MCP server config not found'), { statusCode: 404 });
  },

  /** List active servers for an agent run. Respects agent links if any exist. */
  async listForAgent(agentId: string, organisationId: string): Promise<McpServerConfig[]> {
    // Check if agent has explicit links — org-scoped via join to prevent cross-org leakage
    const listForAgentScopedDb = getOrgScopedDb('mcpServerConfigService.listForAgent');
    const links = await listForAgentScopedDb
      .select({ mcpServerConfigId: mcpServerAgentLinks.mcpServerConfigId })
      .from(mcpServerAgentLinks)
      .innerJoin(mcpServerConfigs, eq(mcpServerAgentLinks.mcpServerConfigId, mcpServerConfigs.id))
      .where(and(
        eq(mcpServerAgentLinks.agentId, agentId),
        eq(mcpServerConfigs.organisationId, organisationId),
      ));

    if (links.length > 0) {
      // Agent has explicit links — only return those servers that are active
      const linkedIds = new Set(links.map((l: { mcpServerConfigId: string }) => l.mcpServerConfigId));
      const allActive = await listForAgentScopedDb
        .select()
        .from(mcpServerConfigs)
        .where(and(eq(mcpServerConfigs.organisationId, organisationId), eq(mcpServerConfigs.status, 'active')));
      return allActive.filter((c: { id: string }) => linkedIds.has(c.id));
    }

    // No explicit links — return all active servers (opt-out model)
    return listForAgentScopedDb
      .select()
      .from(mcpServerConfigs)
      .where(and(eq(mcpServerConfigs.organisationId, organisationId), eq(mcpServerConfigs.status, 'active')));
  },

  // ── Circuit breaker helpers ─────────────────────────────────────────────────

  async incrementFailure(id: string): Promise<void> {
    await getOrgScopedDb('mcpServerConfigService.incrementFailure')
      .update(mcpServerConfigs)
      .set({
        consecutiveFailures: sql`${mcpServerConfigs.consecutiveFailures} + 1`,
        lastError: 'Connection failed',
        updatedAt: new Date(),
      })
      .where(eq(mcpServerConfigs.id, id));
  },

  async openCircuit(id: string, until: Date): Promise<void> {
    await getOrgScopedDb('mcpServerConfigService.openCircuit')
      .update(mcpServerConfigs)
      .set({ circuitOpenUntil: until, status: 'error', updatedAt: new Date() })
      .where(eq(mcpServerConfigs.id, id));
  },

  async resetCircuit(id: string): Promise<void> {
    await getOrgScopedDb('mcpServerConfigService.resetCircuit')
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
    await getOrgScopedDb('mcpServerConfigService.updateDiscoveredTools')
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
    return getOrgScopedDb('mcpServerConfigService.listAgentLinks')
      .select()
      .from(mcpServerAgentLinks)
      .where(eq(mcpServerAgentLinks.mcpServerConfigId, mcpServerConfigId));
  },

  async createAgentLink(mcpServerConfigId: string, agentId: string, gateOverride?: string | null) {
    const [link] = await getOrgScopedDb('mcpServerConfigService.createAgentLink')
      .insert(mcpServerAgentLinks)
      .values({ mcpServerConfigId, agentId, gateOverride: gateOverride as 'auto' | 'review' | 'block' | null })
      .returning();
    return link;
  },

  async deleteAgentLink(linkId: string) {
    await getOrgScopedDb('mcpServerConfigService.deleteAgentLink').delete(mcpServerAgentLinks).where(eq(mcpServerAgentLinks.id, linkId));
  },
};
