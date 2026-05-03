import { eq, and, ne, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { connectorConfigs, canonicalAccounts, subaccounts } from '../db/schema/index.js';
import { configHistoryService } from './configHistoryService.js';
import { connectionTokenService } from './connectionTokenService.js';
import { withAdminConnection } from '../lib/adminDbConnection.js';
import { logger } from '../lib/logger.js';
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

  async upsertAgencyConnection(params: {
    orgId: string;
    companyId: string;
    accessToken: string;
    refreshToken: string;
    expiresAt: Date;
    scope: string;
  }): Promise<typeof connectorConfigs.$inferSelect> {
    // connector_configs has FORCE ROW LEVEL SECURITY. The OAuth callback that
    // calls this is intentionally unauthenticated (browser redirect with no
    // JWT), so app.organisation_id is never set. Use withAdminConnection +
    // SET LOCAL ROLE admin_role to bypass RLS — orgId is already validated
    // by the state-nonce consume step at the route layer, so org isolation
    // is upheld at the application boundary.
    const encryptedAccess = connectionTokenService.encryptToken(params.accessToken);
    const encryptedRefresh = connectionTokenService.encryptToken(params.refreshToken);
    try {
      return await withAdminConnection(
        { source: 'ghl_oauth_callback_upsert', skipAudit: true },
        async (adminDb) => {
          await adminDb.execute(sql`SET LOCAL ROLE admin_role`);
          const [row] = await adminDb
            .insert(connectorConfigs)
            .values({
              organisationId: params.orgId,
              connectorType: 'ghl' as ConnectorType,
              tokenScope: 'agency',
              companyId: params.companyId,
              accessToken: encryptedAccess,
              refreshToken: encryptedRefresh,
              expiresAt: params.expiresAt,
              scope: params.scope,
              status: 'active' as ConnectorStatus,
              installedAt: new Date(),
              disconnectedAt: null,
            })
            .onConflictDoUpdate({
              target: [connectorConfigs.organisationId, connectorConfigs.connectorType, connectorConfigs.companyId],
              targetWhere: sql`token_scope = 'agency' AND status <> 'disconnected'`,
              set: {
                accessToken: encryptedAccess,
                refreshToken: encryptedRefresh,
                expiresAt: params.expiresAt,
                scope: params.scope,
                status: 'active' as ConnectorStatus,
                disconnectedAt: null,
                updatedAt: new Date(),
              },
            })
            .returning();
          return row;
        },
      );
    } catch (err: unknown) {
      const pg = err as { code?: string; constraint?: string };
      if (pg.code === '23505' && pg.constraint?.includes('global_agency')) {
        throw Object.assign(
          new Error('agency_already_installed_under_different_org'),
          { statusCode: 409, errorCode: 'AGENCY_ALREADY_INSTALLED', companyId: params.companyId },
        );
      }
      throw err;
    }
  },

  async findAgencyConnectionByCompanyId(companyId: string): Promise<typeof connectorConfigs.$inferSelect | null> {
    // Cross-org primitive — used by the unauthenticated webhook route to map
    // GHL companyId to the owning organisation. Plain `db` reads return zero
    // rows under FORCE RLS without an app.organisation_id GUC. Bypass via
    // admin role; the companyId match (with status<>disconnected and
    // tokenScope=agency) provides the application-layer scoping.
    return await withAdminConnection(
      { source: 'ghl_webhook_company_lookup', skipAudit: true },
      async (adminDb) => {
        await adminDb.execute(sql`SET LOCAL ROLE admin_role`);
        const [row] = await adminDb
          .select()
          .from(connectorConfigs)
          .where(
            and(
              eq(connectorConfigs.connectorType, 'ghl' as ConnectorType),
              eq(connectorConfigs.companyId, companyId),
              eq(connectorConfigs.tokenScope, 'agency'),
              ne(connectorConfigs.status, 'disconnected'),
            )
          )
          .limit(1);
        return row ?? null;
      },
    );
  },

  async refreshAgencyTokenIfExpired(configId: string): Promise<void> {
    // connector_configs has FORCE ROW LEVEL SECURITY — a plain `db` handle with
    // no app.organisation_id set returns zero rows. Use withAdminConnection +
    // SET LOCAL ROLE admin_role for every DB operation in this cross-org sweep.
    // The network call to GHL runs outside any transaction to avoid holding a
    // connection for up to 20 seconds.
    const config = await withAdminConnection(
      { source: 'connector_polling_agency_refresh', skipAudit: true },
      async (adminDb) => {
        await adminDb.execute(sql`SET LOCAL ROLE admin_role`);
        const [row] = await adminDb
          .select()
          .from(connectorConfigs)
          .where(and(eq(connectorConfigs.id, configId), eq(connectorConfigs.tokenScope, 'agency')));
        return row ?? null;
      },
    );
    if (!config || !config.expiresAt) return;

    const { isAgencyTokenExpiringSoon, buildRefreshTokenBody } =
      await import('./ghlAgencyOauthServicePure.js');

    if (!isAgencyTokenExpiringSoon(config.expiresAt)) return;

    const clientId = process.env.OAUTH_GHL_CLIENT_ID;
    const clientSecret = process.env.OAUTH_GHL_CLIENT_SECRET;
    if (!clientId || !clientSecret) return;

    const rawRefreshToken = connectionTokenService.decryptToken(config.refreshToken ?? '');
    const body = buildRefreshTokenBody({
      refreshToken: rawRefreshToken,
      clientId,
      clientSecret,
    });

    const GHL_TOKEN_URL = 'https://services.leadconnectorhq.com/oauth/token';
    const response = await fetch(GHL_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(20_000),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      if (response.status === 401) {
        await withAdminConnection(
          { source: 'connector_polling_agency_refresh', skipAudit: true },
          async (adminDb) => {
            await adminDb.execute(sql`SET LOCAL ROLE admin_role`);
            await adminDb
              .update(connectorConfigs)
              .set({ status: 'disconnected', disconnectedAt: new Date(), updatedAt: new Date() })
              .where(eq(connectorConfigs.id, configId));
          },
        );
        logger.error('ghl.agency_token.revoked', {
          event: 'ghl.agency_token.revoked',
          provider: 'ghl',
          orgId: config.organisationId,
          companyId: config.companyId,
          locationId: null,
          configId,
          result: 'failure',
          error: { code: 'AGENCY_TOKEN_REVOKED', message: `permanent 401 from refresh; status flipped to disconnected` },
        });
        throw Object.assign(new Error(`Agency token permanently revoked for config ${configId}`), {
          code: 'AGENCY_TOKEN_REVOKED',
          statusCode: 401,
        });
      }
      logger.warn('ghl.agency_token.refresh_failure', {
        event: 'ghl.agency_token.refresh_failure',
        provider: 'ghl',
        orgId: config.organisationId,
        companyId: config.companyId,
        locationId: null,
        configId,
        result: 'failure',
        error: { code: 'AGENCY_TOKEN_REFRESH_FAILED', statusCode: response.status, message: text.slice(0, 200) },
      });
      throw Object.assign(new Error(`Agency token refresh failed: ${response.status} ${text}`), {
        code: 'AGENCY_TOKEN_REFRESH_FAILED',
        statusCode: response.status,
      });
    }

    const data = await response.json() as { access_token: string; refresh_token: string; expires_in: number; scope: string };
    const claimedAt = new Date();
    const { computeAgencyTokenExpiresAt } = await import('./ghlAgencyOauthServicePure.js');

    await withAdminConnection(
      { source: 'connector_polling_agency_refresh', skipAudit: true },
      async (adminDb) => {
        await adminDb.execute(sql`SET LOCAL ROLE admin_role`);
        await adminDb
          .update(connectorConfigs)
          .set({
            accessToken: connectionTokenService.encryptToken(data.access_token),
            refreshToken: connectionTokenService.encryptToken(data.refresh_token),
            expiresAt: computeAgencyTokenExpiresAt(claimedAt, data.expires_in),
            scope: data.scope,
            updatedAt: new Date(),
          })
          .where(eq(connectorConfigs.id, configId));
      },
    );

    logger.info('ghl.agency_token.refresh', {
      event: 'ghl.agency_token.refresh',
      provider: 'ghl',
      orgId: config.organisationId,
      companyId: config.companyId,
      locationId: null,
      configId,
      result: 'success',
      tokenAgeMs: 0,
      error: null,
    });
  },
};
