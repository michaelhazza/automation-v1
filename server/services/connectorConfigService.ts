import { eq, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import { connectorConfigs, canonicalAccounts } from '../db/schema/index.js';
import { configHistoryService } from './configHistoryService.js';

type ConnectorInsert = typeof connectorConfigs.$inferInsert;
type ConnectorType = ConnectorInsert['connectorType'];
type ConnectorStatus = ConnectorInsert['status'];
type SyncPhase = ConnectorInsert['syncPhase'];

export const connectorConfigService = {
  async listByOrg(organisationId: string) {
    return db
      .select()
      .from(connectorConfigs)
      .where(eq(connectorConfigs.organisationId, organisationId));
  },

  async listBySubaccount(organisationId: string, subaccountId: string) {
    return db
      .select()
      .from(connectorConfigs)
      .where(
        and(
          eq(connectorConfigs.organisationId, organisationId),
          eq(connectorConfigs.subaccountId, subaccountId),
        )
      );
  },

  async get(id: string, organisationId: string) {
    const [config] = await db
      .select()
      .from(connectorConfigs)
      .where(and(eq(connectorConfigs.id, id), eq(connectorConfigs.organisationId, organisationId)));
    if (!config) throw { statusCode: 404, message: 'Connector config not found' };
    return config;
  },

  async getByType(organisationId: string, connectorType: string) {
    const [config] = await db
      .select()
      .from(connectorConfigs)
      .where(and(eq(connectorConfigs.organisationId, organisationId), eq(connectorConfigs.connectorType, connectorType as ConnectorType)));
    return config ?? null;
  },

  async getActiveByOrg(organisationId: string) {
    return db
      .select()
      .from(connectorConfigs)
      .where(and(eq(connectorConfigs.organisationId, organisationId), eq(connectorConfigs.status, 'active')));
  },

  async create(organisationId: string, data: {
    connectorType: string;
    connectionId?: string;
    configJson?: Record<string, unknown>;
    pollIntervalMinutes?: number;
    webhookSecret?: string;
  }) {
    const [config] = await db
      .insert(connectorConfigs)
      .values({
        organisationId,
        connectorType: data.connectorType as ConnectorType,
        connectionId: data.connectionId ?? null,
        configJson: data.configJson ?? null,
        pollIntervalMinutes: data.pollIntervalMinutes ?? 60,
        webhookSecret: data.webhookSecret ?? null,
      })
      .returning();

    await configHistoryService.recordHistory({
      entityType: 'connector_config', entityId: config.id, organisationId,
      snapshot: config as unknown as Record<string, unknown>,
      changedBy: null, changeSource: 'api',
    });

    return config;
  },

  async createForSubaccount(organisationId: string, subaccountId: string, data: {
    connectorType: string;
    connectionId?: string;
    configJson?: Record<string, unknown>;
    pollIntervalMinutes?: number;
    webhookSecret?: string;
  }) {
    const [config] = await db
      .insert(connectorConfigs)
      .values({
        organisationId,
        subaccountId,
        connectorType: data.connectorType as ConnectorType,
        connectionId: data.connectionId ?? null,
        configJson: data.configJson ?? null,
        pollIntervalMinutes: data.pollIntervalMinutes ?? 60,
        webhookSecret: data.webhookSecret ?? null,
      })
      .returning();
    return config;
  },

  async update(id: string, organisationId: string, data: Partial<{
    connectionId: string | null;
    configJson: Record<string, unknown>;
    status: ConnectorStatus;
    pollIntervalMinutes: number;
    webhookSecret: string | null;
    syncPhase: SyncPhase;
    lastSyncAt: Date;
    lastSyncStatus: string;
    lastSyncError: string | null;
    configVersion: string;
  }>) {
    const [preState] = await db.select().from(connectorConfigs)
      .where(and(eq(connectorConfigs.id, id), eq(connectorConfigs.organisationId, organisationId)));
    if (preState) {
      await configHistoryService.recordHistory({
        entityType: 'connector_config', entityId: id, organisationId,
        snapshot: preState as unknown as Record<string, unknown>,
        changedBy: null, changeSource: 'api',
      });
    }

    const [updated] = await db
      .update(connectorConfigs)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(connectorConfigs.id, id), eq(connectorConfigs.organisationId, organisationId)))
      .returning();
    if (!updated) throw { statusCode: 404, message: 'Connector config not found' };
    return updated;
  },

  async delete(id: string, organisationId: string) {
    const [preState] = await db.select().from(connectorConfigs)
      .where(and(eq(connectorConfigs.id, id), eq(connectorConfigs.organisationId, organisationId)));
    if (preState) {
      await configHistoryService.recordHistory({
        entityType: 'connector_config', entityId: id, organisationId,
        snapshot: preState as unknown as Record<string, unknown>,
        changedBy: null, changeSource: 'api', changeSummary: 'Entity deleted',
      });
    }

    const [deleted] = await db
      .delete(connectorConfigs)
      .where(and(eq(connectorConfigs.id, id), eq(connectorConfigs.organisationId, organisationId)))
      .returning();
    if (!deleted) throw { statusCode: 404, message: 'Connector config not found' };
    return deleted;
  },

  /** Find the first active connector config for a given type (across all orgs). Used by webhook routes. */
  async findActiveByType(connectorType: string) {
    const [config] = await db
      .select()
      .from(connectorConfigs)
      .where(and(eq(connectorConfigs.connectorType, connectorType as ConnectorType), eq(connectorConfigs.status, 'active')))
      .limit(1);
    return config ?? null;
  },

  /** Find all active connector configs for a given type (across all orgs). Used by webhook routes that match by signature. */
  async findAllActiveByType(connectorType: string) {
    return db
      .select()
      .from(connectorConfigs)
      .where(and(eq(connectorConfigs.connectorType, connectorType as ConnectorType), eq(connectorConfigs.status, 'active')));
  },

  /** Find a connector config by matching a canonical account's externalId to a connectorType. Used by GHL webhook. */
  async findByAccountExternalId(accountExternalId: string, connectorType: string) {
    const [result] = await db
      .select({ config: connectorConfigs, account: canonicalAccounts })
      .from(canonicalAccounts)
      .innerJoin(connectorConfigs, eq(connectorConfigs.id, canonicalAccounts.connectorConfigId))
      .where(and(
        eq(canonicalAccounts.externalId, accountExternalId),
        eq(connectorConfigs.connectorType, connectorType as ConnectorType),
      ))
      .limit(1);
    return result ?? null;
  },

  async updateSyncStatus(id: string, organisationId: string, status: { lastSyncAt: Date; lastSyncStatus: string; lastSyncError?: string | null }) {
    await db
      .update(connectorConfigs)
      .set({ ...status, updatedAt: new Date() })
      .where(and(eq(connectorConfigs.id, id), eq(connectorConfigs.organisationId, organisationId)));
  },
};
