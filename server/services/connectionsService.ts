import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  encodeCursor,
  decodeCursor,
  dbAuthTypeToContract,
  dbConnectionStatusToContract,
  type ContractAuthMethod,
  type ContractStatus,
} from './connectionsListPure.js';

type RawConnectionRow = {
  id: string;
  kind: string;
  provider: string;
  label: string | null;
  display_name: string | null;
  auth_method: string | null;
  status: string | null;
  created_at: Date | string;
};

type FacetRow = { facet: string; value: string; count: number };

type NamedRow = { id: string; name: string };

export interface ConnectionRow {
  id: string;
  kind: 'integration' | 'mcp';
  provider: string;
  label: string | null;
  displayName: string | null;
  authMethod: ContractAuthMethod;
  status: ContractStatus;
  createdAt: string;
}

export interface ConnectionListInput {
  organisationId: string;
  provider?: string;
  authMethod?: ContractAuthMethod;
  status?: ContractStatus;
  q?: string;
  cursor: string | null;
  limit: number;
  sortDir: 'asc' | 'desc';
}

export interface ConnectionListResult {
  rows: ConnectionRow[];
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

  const authMethodFilter = input.authMethod
    ? sql`AND c.auth_method = ${input.authMethod}`
    : sql``;

  const statusFilter = input.status
    ? sql`AND c.status = ${input.status}`
    : sql``;

  const qFilter = input.q
    ? sql`AND (LOWER(c.label) LIKE ${`%${input.q.toLowerCase()}%`} OR LOWER(c.display_name) LIKE ${`%${input.q.toLowerCase()}%`} OR LOWER(c.provider) LIKE ${`%${input.q.toLowerCase()}%`})`
    : sql``;

  // UNION ALL of integration_connections and mcp_server_configs
  // Both projected into a common shape with computed contract fields
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
        ic.created_at
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
        ms.created_at
      FROM mcp_server_configs ms
      WHERE ms.organisation_id = ${input.organisationId}::uuid
    ),
    mapped AS (
      SELECT
        c.id,
        c.kind,
        c.provider,
        c.label,
        c.display_name,
        CASE c.raw_auth_type
          WHEN 'oauth2' THEN 'oauth'
          WHEN 'api_key' THEN 'api_key'
          WHEN 'service_account' THEN 'web_login'
          WHEN 'web_login' THEN 'web_login'
          WHEN 'github_app' THEN 'oauth'
          WHEN 'mcp' THEN 'mcp'
          ELSE NULL
        END AS auth_method,
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
        END AS status,
        c.created_at
      FROM base c
    )
    SELECT
      c.id::text,
      c.kind,
      c.provider,
      c.label,
      c.display_name,
      c.auth_method,
      c.status,
      c.created_at
    FROM mapped c
    WHERE 1=1
    ${providerFilter}
    ${authMethodFilter}
    ${statusFilter}
    ${qFilter}
    ${cursorClause}
    ORDER BY c.created_at ${input.sortDir === 'asc' ? sql`ASC` : sql`DESC`}, c.id ${input.sortDir === 'asc' ? sql`ASC` : sql`DESC`}
    LIMIT ${limit + 1}
  `)];

  const hasMore = allRows.length > limit;
  const pageRows = hasMore ? allRows.slice(0, limit) : allRows;

  const rows: ConnectionRow[] = pageRows.map(r => ({
    id: r.id,
    kind: r.kind as 'integration' | 'mcp',
    provider: r.provider,
    label: r.label,
    displayName: r.display_name,
    authMethod: dbAuthTypeToContract(r.auth_method ?? '<null>'),
    status: dbConnectionStatusToContract(r.status ?? '<null>'),
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
  }));

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
