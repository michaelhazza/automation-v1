import { eq, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import { connectorConfigs, canonicalAccounts } from '../db/schema/index.js';

export const connectorConfigService = {
  async listByOrg(organisationId: string) {
    return db
      .select()
      .from(connectorConfigs)
      .where(eq(connectorConfigs.organisationId, organisationId));
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
      .where(and(eq(connectorConfigs.organisationId, organisationId), eq(connectorConfigs.connectorType, connectorType)));
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
        connectorType: data.connectorType,
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
    status: string;
    pollIntervalMinutes: number;
    webhookSecret: string | null;
    syncPhase: string;
    lastSyncAt: Date;
    lastSyncStatus: string;
    lastSyncError: string | null;
    configVersion: string;
  }>) {
    const [updated] = await db
      .update(connectorConfigs)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(connectorConfigs.id, id), eq(connectorConfigs.organisationId, organisationId)))
      .returning();
    if (!updated) throw { statusCode: 404, message: 'Connector config not found' };
    return updated;
  },

  async delete(id: string, organisationId: string) {
    const [deleted] = await db
      .delete(connectorConfigs)
      .where(and(eq(connectorConfigs.id, id), eq(connectorConfigs.organisationId, organisationId)))
      .returning();
    if (!deleted) throw { statusCode: 404, message: 'Connector config not found' };
    return deleted;
  },

  async updateSyncStatus(id: string, status: { lastSyncAt: Date; lastSyncStatus: string; lastSyncError?: string | null }) {
    await db
      .update(connectorConfigs)
      .set({ ...status, updatedAt: new Date() })
      .where(eq(connectorConfigs.id, id));
  },
};
