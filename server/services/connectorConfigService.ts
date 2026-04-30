import { eq, and, ne } from 'drizzle-orm';
import { db } from '../db/index.js';
import { connectorConfigs, canonicalAccounts, subaccounts } from '../db/schema/index.js';
import { configHistoryService } from './configHistoryService.js';
import type { WorkspaceTenantConfig } from '../../shared/types/workspaceAdapterContract.js';

export function buildWorkspaceTenantConfig(
  subaccountName: string,
  connectorConfig: { id: string; connectorType: string; configJson: unknown } | null,
): WorkspaceTenantConfig {
  const cfg = (connectorConfig?.configJson as Record<string, unknown> | null) ?? {};
  const configDomain = typeof cfg.domain === 'string' && cfg.domain.length > 0 ? cfg.domain : null;

  // Workspace `domain` resolution mirrors the GET /workspace summary route:
  // per-subaccount override (configJson.domain) → NATIVE_EMAIL_DOMAIN → null.
  // Returning `null` (rather than 'workspace.local') lets callers distinguish
  // "no workspace configured" from "configured with the dev fallback".
  // Read from process.env directly rather than the validated env module so that
  // pure unit tests of this builder don't have to bootstrap the entire env Zod
  // schema (which requires DATABASE_URL, EMAIL_FROM, ...).
  const envDomain = typeof process.env.NATIVE_EMAIL_DOMAIN === 'string' && process.env.NATIVE_EMAIL_DOMAIN.length > 0
    ? process.env.NATIVE_EMAIL_DOMAIN
    : null;
  const resolvedDomain = configDomain ?? envDomain;

  const backend = connectorConfig?.connectorType === 'synthetos_native' || connectorConfig?.connectorType === 'google_workspace'
    ? connectorConfig.connectorType
    : null;

  return {
    backend,
    connectorConfigId: connectorConfig?.id ?? null,
    domain: resolvedDomain,
    subaccountName,
    defaultSignatureTemplate: typeof cfg.defaultSignatureTemplate === 'string' ? cfg.defaultSignatureTemplate : '',
    discloseAsAgent: cfg.discloseAsAgent === true,
    vanityDomain: typeof cfg.vanityDomain === 'string' ? cfg.vanityDomain : null,
  };
}

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
    // Workspace connector types (synthetos_native, google_workspace) are
    // subaccount-scoped after migration 0254 — the unique index is
    // (org_id, connector_type) WHERE connector_type IN ('crm', ...) only.
    // Callers that need a workspace connector must use getBySubaccountAndType.
    if (connectorType === 'synthetos_native' || connectorType === 'google_workspace') {
      throw new Error(
        `getByType does not support workspace connector type '${connectorType}'. ` +
        'Use getBySubaccountAndType(organisationId, subaccountId, connectorType) instead.',
      );
    }
    const [config] = await db
      .select()
      .from(connectorConfigs)
      .where(and(eq(connectorConfigs.organisationId, organisationId), eq(connectorConfigs.connectorType, connectorType as ConnectorType)));
    return config ?? null;
  },

  async getBySubaccountAndType(organisationId: string, subaccountId: string, connectorType: string) {
    const [config] = await db
      .select()
      .from(connectorConfigs)
      .where(and(
        eq(connectorConfigs.organisationId, organisationId),
        eq(connectorConfigs.subaccountId, subaccountId),
        eq(connectorConfigs.connectorType, connectorType as ConnectorType),
      ));
    return config ?? null;
  },

  /**
   * Returns the first connector config for this subaccount whose connectorType
   * differs from the given `connectorType`. Used by the /configure guard to
   * detect a backend-swap attempt before any identities have been migrated.
   */
  async getBySubaccountAndDifferentType(organisationId: string, subaccountId: string, connectorType: string) {
    const [config] = await db
      .select()
      .from(connectorConfigs)
      .where(and(
        eq(connectorConfigs.organisationId, organisationId),
        eq(connectorConfigs.subaccountId, subaccountId),
        ne(connectorConfigs.connectorType, connectorType as ConnectorType),
      ))
      .limit(1);
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

  async getWorkspaceTenantConfig(orgId: string, subaccountId: string): Promise<WorkspaceTenantConfig> {
    const [sub] = await db
      .select({ name: subaccounts.name })
      .from(subaccounts)
      .where(and(eq(subaccounts.id, subaccountId), eq(subaccounts.organisationId, orgId)));

    const [config] = await db
      .select({
        id: connectorConfigs.id,
        connectorType: connectorConfigs.connectorType,
        configJson: connectorConfigs.configJson,
      })
      .from(connectorConfigs)
      .where(and(
        eq(connectorConfigs.organisationId, orgId),
        eq(connectorConfigs.subaccountId, subaccountId),
      ))
      .limit(1);

    return buildWorkspaceTenantConfig(sub?.name ?? '', config ?? null);
  },
};
