import { sql, and, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { integrationConnections } from '../db/schema/integrationConnections.js';
import { mcpServerConfigs } from '../db/schema/mcpServerConfigs.js';
import { mcpServerConfigService } from './mcpServerConfigService.js';
import {
  encodeCursor,
  decodeCursor,
  UnknownEnumValueError,
  type ContractAuthMethod,
  type ContractStatus,
} from './connectionsListPure.js';
import type { Connection } from '../../shared/types/govern.js';

type RawConnectionRow = {
  id: string;
  kind: string;
  provider: string;
  label: string | null;
  display_name: string | null;
  /** Contract auth method ('oauth' | 'api_key' | ...) or null when unmapped (I2 fail-closed). */
  auth_method: ContractAuthMethod | null;
  /** Contract status ('connected' | 'expired' | ...) or null when unmapped (I2 fail-closed). */
  status: ContractStatus | null;
  /** Raw DB enum kept for I2 fail-closed error context. */
  raw_auth_type: string | null;
  raw_status: string | null;
  raw_oauth_status: string | null;
  created_at: Date | string;
  last_sync_at: Date | string | null;
  subaccount_id: string | null;
  subaccount_name: string | null;
  organisation_id: string;
};

type FacetRow = { facet: string; value: string; count: number };

type NamedRow = { id: string; name: string };

/** Backwards-compatible alias for Connection (Govern surface contract). */
export type ConnectionRow = Connection;

export interface ConnectionListInput {
  organisationId: string;
  /** Optional scope filter: 'workspace' restricts to a single subaccount;
   *  'org' returns only org-level connections (subaccount_id IS NULL);
   *  undefined returns everything in the org. */
  scope?: 'workspace' | 'org';
  /** Required when scope='workspace'. */
  subaccountId?: string;
  provider?: string;
  authMethod?: ContractAuthMethod;
  status?: ContractStatus;
  q?: string;
  cursor: string | null;
  limit: number;
  sortDir: 'asc' | 'desc';
}

export interface ConnectionListResult {
  rows: Connection[];
  cursor: string | null;
  filterOptions: {
    provider: Array<{ value: string; label: string; count: number }>;
    authMethod: Array<{ value: string; label: string; count: number }>;
    status: Array<{ value: string; label: string; count: number }>;
  };
}

export interface ConnectionUsageResult {
  agents: Array<{ id: string; name: string }>;
  recurringTasks: Array<{ id: string; name: string }>;
  workflows: Array<{ id: string; name: string }>;
}

export async function listConnections(input: ConnectionListInput): Promise<ConnectionListResult> {
  const limit = Math.min(input.limit, 50);
  const cursor = input.cursor ? decodeCursor(input.cursor) : null;

  // Build cursor clause for seek pagination on (created_at, id)
  const cursorClause = cursor
    ? input.sortDir === 'asc'
      ? sql`AND (c.created_at, c.id) > (${cursor.primary}::timestamptz, ${cursor.id}::uuid)`
      : sql`AND (c.created_at, c.id) < (${cursor.primary}::timestamptz, ${cursor.id}::uuid)`
    : sql``;

  const providerFilter = input.provider
    ? sql`AND c.provider = ${input.provider}`
    : sql``;

  // Filters use the derived contract values (auth_method_contract / status_contract) so
  // callers can pass `oauth` / `connected` etc. directly.
  const authMethodFilter = input.authMethod
    ? sql`AND c.auth_method_contract = ${input.authMethod}`
    : sql``;

  const statusFilter = input.status
    ? sql`AND c.status_contract = ${input.status}`
    : sql``;

  const qFilter = input.q
    ? sql`AND (LOWER(c.label) LIKE ${`%${input.q.toLowerCase()}%`} OR LOWER(c.display_name) LIKE ${`%${input.q.toLowerCase()}%`} OR LOWER(c.provider) LIKE ${`%${input.q.toLowerCase()}%`})`
    : sql``;

  // Scope filter — see ConnectionListInput.scope.
  const scopeFilter =
    input.scope === 'workspace' && input.subaccountId
      ? sql`AND c.subaccount_id = ${input.subaccountId}::uuid`
      : input.scope === 'org'
        ? sql`AND c.subaccount_id IS NULL`
        : sql``;

  // UNION ALL of integration_connections and mcp_server_configs.
  // Raw DB enum values are returned to the JS layer; mapping to contract enums
  // happens in connectionsListPure (single source of truth + I2 fail-closed).
  // For filterability we still need the contract value at SQL level, so we apply
  // the filter on the raw value via a derived expression in the WHERE clauses.
  const allRows = [...await db.execute<RawConnectionRow>(sql`
    WITH base AS (
      SELECT
        ic.id,
        'integration'::text AS kind,
        ic.provider_type AS provider,
        ic.label,
        ic.display_name,
        ic.auth_type AS raw_auth_type,
        ic.connection_status AS raw_status,
        ic.oauth_status AS raw_oauth_status,
        ic.created_at,
        ic.last_successful_sync_at AS last_sync_at,
        ic.subaccount_id,
        ic.organisation_id
      FROM integration_connections ic
      WHERE ic.organisation_id = ${input.organisationId}::uuid

      UNION ALL

      SELECT
        ms.id,
        'mcp'::text AS kind,
        ms.slug AS provider,
        NULL AS label,
        ms.name AS display_name,
        'mcp'::text AS raw_auth_type,
        ms.status AS raw_status,
        NULL AS raw_oauth_status,
        ms.created_at,
        NULL::timestamptz AS last_sync_at,
        ms.subaccount_id,
        ms.organisation_id
      FROM mcp_server_configs ms
      WHERE ms.organisation_id = ${input.organisationId}::uuid
    ),
    derived AS (
      SELECT
        c.*,
        -- Derived contract auth_method/status are used for filterability only.
        -- Final mapping for the response goes through connectionsListPure (single source of truth).
        CASE c.raw_auth_type
          WHEN 'oauth2' THEN 'oauth'
          WHEN 'api_key' THEN 'api_key'
          WHEN 'service_account' THEN 'web_login'
          WHEN 'web_login' THEN 'web_login'
          WHEN 'github_app' THEN 'oauth'
          WHEN 'mcp' THEN 'mcp'
          ELSE NULL
        END AS auth_method_contract,
        CASE
          WHEN c.raw_oauth_status IS NOT NULL THEN
            CASE c.raw_oauth_status
              WHEN 'active' THEN 'connected'
              WHEN 'expired' THEN 'expired'
              WHEN 'error' THEN 'failed'
              WHEN 'disconnected' THEN 'failed'
              ELSE NULL
            END
          ELSE
            CASE c.raw_status
              WHEN 'active' THEN 'connected'
              WHEN 'revoked' THEN 'failed'
              WHEN 'error' THEN 'failed'
              WHEN 'disabled' THEN 'failed'
              ELSE NULL
            END
        END AS status_contract
      FROM base c
    )
    SELECT
      c.id::text,
      c.kind,
      c.provider,
      c.label,
      c.display_name,
      c.auth_method_contract AS auth_method,
      c.status_contract AS status,
      c.raw_auth_type,
      c.raw_status,
      c.raw_oauth_status,
      c.created_at,
      c.last_sync_at,
      c.subaccount_id::text AS subaccount_id,
      sa.name AS subaccount_name,
      c.organisation_id::text AS organisation_id
    FROM derived c
    LEFT JOIN subaccounts sa ON sa.id = c.subaccount_id
    WHERE 1=1
    ${providerFilter}
    ${authMethodFilter}
    ${statusFilter}
    ${qFilter}
    ${scopeFilter}
    ${cursorClause}
    ORDER BY c.created_at ${input.sortDir === 'asc' ? sql`ASC` : sql`DESC`}, c.id ${input.sortDir === 'asc' ? sql`ASC` : sql`DESC`}
    LIMIT ${limit + 1}
  `)];

  const hasMore = allRows.length > limit;
  const pageRows = hasMore ? allRows.slice(0, limit) : allRows;

  // Project to shared Connection contract (shared/types/govern.ts §Connections).
  // - `name`: display_name → label → provider (first non-null).
  // - `owner.kind`: 'workspace' if subaccount_id present, else 'org'.
  // - `lastSyncAt`: last_successful_sync_at for integrations; null for MCP (no sync column).
  // - auth_method / status are SQL-derived contract values; null means the raw enum
  //   was unrecognised — fail closed per I2 by throwing UnknownEnumValueError so a
  //   schema enum addition surfaces immediately rather than silently returning bad data.
  const rows: Connection[] = pageRows.map(r => {
    if (r.auth_method === null) {
      throw new UnknownEnumValueError('integration_connections.auth_type', r.raw_auth_type ?? '<null>');
    }
    if (r.status === null) {
      throw new UnknownEnumValueError(
        r.raw_oauth_status ? 'integration_connections.oauth_status' : 'integration_connections.connection_status',
        r.raw_oauth_status ?? r.raw_status ?? '<null>',
      );
    }
    const isWorkspace = r.subaccount_id !== null;
    const name = r.display_name ?? r.label ?? r.provider;
    return {
      id: r.id,
      name,
      provider: r.provider,
      authMethod: r.auth_method,
      status: r.status,
      lastSyncAt: r.last_sync_at
        ? (r.last_sync_at instanceof Date ? r.last_sync_at.toISOString() : String(r.last_sync_at))
        : null,
      owner: isWorkspace
        ? { kind: 'workspace' as const, id: r.subaccount_id!, name: r.subaccount_name ?? r.subaccount_id! }
        : { kind: 'org' as const, id: r.organisation_id, name: 'Organisation' },
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    };
  });

  const lastRow = pageRows[pageRows.length - 1];
  const nextCursor = hasMore && lastRow
    ? encodeCursor({ primary: lastRow.created_at instanceof Date ? lastRow.created_at.toISOString() : String(lastRow.created_at), id: lastRow.id })
    : null;

  // filterOptions from same UNION snapshot (same-snapshot CTE per §4.0)
  const facetRows = [...await db.execute<FacetRow>(sql`
    WITH base AS (
      SELECT
        ic.provider_type AS provider,
        CASE ic.auth_type
          WHEN 'oauth2' THEN 'oauth'
          WHEN 'api_key' THEN 'api_key'
          WHEN 'service_account' THEN 'web_login'
          WHEN 'web_login' THEN 'web_login'
          WHEN 'github_app' THEN 'oauth'
          ELSE NULL
        END AS auth_method,
        CASE
          WHEN ic.oauth_status IS NOT NULL THEN
            CASE ic.oauth_status
              WHEN 'active' THEN 'connected'
              WHEN 'expired' THEN 'expired'
              WHEN 'error' THEN 'failed'
              WHEN 'disconnected' THEN 'failed'
              ELSE NULL
            END
          ELSE
            CASE ic.connection_status
              WHEN 'active' THEN 'connected'
              WHEN 'revoked' THEN 'failed'
              WHEN 'error' THEN 'failed'
              ELSE NULL
            END
        END AS status
      FROM integration_connections ic
      WHERE ic.organisation_id = ${input.organisationId}::uuid

      UNION ALL

      SELECT
        ms.slug AS provider,
        'mcp'::text AS auth_method,
        CASE ms.status
          WHEN 'active' THEN 'connected'
          WHEN 'disabled' THEN 'failed'
          WHEN 'error' THEN 'failed'
          ELSE NULL
        END AS status
      FROM mcp_server_configs ms
      WHERE ms.organisation_id = ${input.organisationId}::uuid
    )
    SELECT
      'provider' AS facet,
      provider AS value,
      COUNT(*)::int AS count
    FROM base
    GROUP BY provider

    UNION ALL

    SELECT
      'auth_method' AS facet,
      auth_method AS value,
      COUNT(*)::int AS count
    FROM base
    GROUP BY auth_method

    UNION ALL

    SELECT
      'status' AS facet,
      status AS value,
      COUNT(*)::int AS count
    FROM base
    GROUP BY status

    ORDER BY facet, count DESC, value ASC
  `)];

  const filterOptions = {
    provider: facetRows.filter(r => r.facet === 'provider').map(r => ({ value: r.value, label: r.value, count: r.count })),
    authMethod: facetRows.filter(r => r.facet === 'auth_method').map(r => ({ value: r.value, label: r.value, count: r.count })),
    status: facetRows.filter(r => r.facet === 'status').map(r => ({ value: r.value, label: r.value, count: r.count })),
  };

  return { rows, cursor: nextCursor, filterOptions };
}

export async function getConnectionUsage(
  connectionId: string,
  organisationId: string,
): Promise<ConnectionUsageResult> {
  // Agents using this connection via agent_data_sources
  const agentRows = [...await db.execute<NamedRow>(sql`
    SELECT DISTINCT a.id::text AS id, a.name
    FROM agent_data_sources ads
    JOIN agents a ON a.id = ads.agent_id
    WHERE ads.connection_id = ${connectionId}::uuid
      AND a.organisation_id = ${organisationId}::uuid
    ORDER BY a.name ASC
  `)];

  // Automations using this connection via automation_connection_mappings
  const workflowRows = [...await db.execute<NamedRow>(sql`
    SELECT DISTINCT au.id::text AS id, au.name
    FROM automation_connection_mappings acm
    JOIN automations au ON au.id = acm.process_id
    WHERE acm.connection_id = ${connectionId}::uuid
      AND acm.organisation_id = ${organisationId}::uuid
    ORDER BY au.name ASC
  `)];

  return {
    agents: agentRows.map(r => ({ id: r.id, name: r.name })),
    recurringTasks: [],
    workflows: workflowRows.map(r => ({ id: r.id, name: r.name })),
  };
}

/**
 * Unified disconnect for the Govern Connections surface.
 * Delegates to existing per-kind paths per spec §4.10:
 *   - integration_connections (org or subaccount) → status='revoked', tokens cleared.
 *   - mcp_server_configs                          → mcpServerConfigService.delete (hard delete).
 *
 * Idempotent: returns { alreadyDisconnected: true } when the integration row
 * is already revoked, or when no matching row exists in either table (404).
 */
export async function disconnectConnection(
  connectionId: string,
  organisationId: string,
): Promise<{ alreadyDisconnected: boolean; kind: 'integration' | 'mcp' } | { notFound: true }> {
  // Try integration_connections first (handles both org-level and subaccount-level by id+org).
  const [intg] = await db.select()
    .from(integrationConnections)
    .where(and(
      eq(integrationConnections.id, connectionId),
      eq(integrationConnections.organisationId, organisationId),
    ));

  if (intg) {
    if (intg.connectionStatus === 'revoked') {
      return { alreadyDisconnected: true, kind: 'integration' };
    }
    await db.update(integrationConnections)
      .set({ connectionStatus: 'revoked', accessToken: null, refreshToken: null, updatedAt: new Date() })
      .where(and(
        eq(integrationConnections.id, connectionId),
        eq(integrationConnections.organisationId, organisationId),
      ));
    return { alreadyDisconnected: false, kind: 'integration' };
  }

  // Fall through to mcp_server_configs.
  const [mcp] = await db.select()
    .from(mcpServerConfigs)
    .where(and(
      eq(mcpServerConfigs.id, connectionId),
      eq(mcpServerConfigs.organisationId, organisationId),
    ));

  if (mcp) {
    await mcpServerConfigService.delete(connectionId, organisationId);
    return { alreadyDisconnected: false, kind: 'mcp' };
  }

  return { notFound: true };
}
