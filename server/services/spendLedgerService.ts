import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { sql } from 'drizzle-orm';
import {
  encodeCursor, decodeCursor,
  amountMinorToCostUsd,
  chargeTypeToContractType,
  type DbChargeType,
  type CursorPayload,
} from './spendLedgerServicePure.js';

export interface LedgerListInput {
  organisationId: string;
  scope: 'workspace' | 'org';
  subaccountId?: string;
  workspace?: string[];
  agent?: string[];
  type?: Array<'llm' | 'embedding' | 'tool_call' | 'storage' | 'other'>;
  from?: Date;
  to?: Date;
  q?: string;
  cursor: string | null;
  limit: number;
  sortKey: 'timestamp' | 'workspace' | 'agent' | 'type' | 'tokens' | 'cost';
  sortDir: 'asc' | 'desc';
}

export interface LedgerRowOut {
  id: string;
  timestamp: string;
  workspace: { id: string; name: string };
  agent: { id: string; name: string };
  type: 'llm' | 'embedding' | 'tool_call' | 'storage' | 'other';
  provider: string;
  model: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  costUsd: number;
}

export interface LedgerListResult {
  rows: LedgerRowOut[];
  cursor: string | null;
  filterOptions: Record<string, Array<{ value: string; label: string; count: number }>>;
}

export async function listLedger(input: LedgerListInput): Promise<LedgerListResult> {
  const limit = Math.min(input.limit, 50);
  const cursor = input.cursor ? decodeCursor(input.cursor) : null;

  // INVARIANT I1: seek pagination via tuple comparison. Never SQL OFFSET.
  // DESC: WHERE (col, id) < (cursor.primary, cursor.id)
  // ASC:  WHERE (col, id) > (cursor.primary, cursor.id)
  // Column names reference the `ordered` CTE which queries from `base`.
  const cursorClause = cursor ? buildCursorClause(input.sortKey, input.sortDir, cursor) : sql``;

  // Scope filter (workspace scope scopes to a single subaccount)
  const scopeFilter =
    input.scope === 'workspace' && input.subaccountId
      ? sql`AND ac.subaccount_id = ${input.subaccountId}::uuid`
      : sql``;

  // Workspace filter (array of subaccount IDs)
  const workspaceFilter =
    input.workspace && input.workspace.length > 0
      ? sql`AND ac.subaccount_id = ANY(${input.workspace}::uuid[])`
      : sql``;

  // Agent filter (array of agent IDs)
  const agentFilter =
    input.agent && input.agent.length > 0
      ? sql`AND ac.agent_id = ANY(${input.agent}::uuid[])`
      : sql``;

  // Charge type filter (array of charge types)
  const typeFilter =
    input.type && input.type.length > 0
      ? sql`AND ac.charge_type = ANY(${input.type}::text[])`
      : sql``;

  // Date range filters
  const fromFilter = input.from
    ? sql`AND ac.created_at >= ${input.from.toISOString()}::timestamptz`
    : sql``;
  const toFilter = input.to
    ? sql`AND ac.created_at <= ${input.to.toISOString()}::timestamptz`
    : sql``;

  // Case-insensitive full-text search against agent name and workspace name
  const qPattern = input.q ? `%${input.q}%` : null;
  const qFilter = qPattern
    ? sql`AND (a.name ILIKE ${qPattern} OR sa.name ILIKE ${qPattern})`
    : sql``;

  const orderCol = primarySortCol(input.sortKey);
  const dir = input.sortDir === 'asc' ? sql.raw('ASC') : sql.raw('DESC');

  type LedgerRawRow = {
    rows: Array<{
      id: string;
      timestamp: string;
      subaccount_id: string;
      subaccount_name: string;
      agent_id: string;
      agent_name: string;
      charge_type: string;
      provider: string;
      amount_minor: string | number;
    }> | null;
    workspace_options: Array<{ value: string; label: string; count: number }> | null;
    agent_options: Array<{ value: string; label: string; count: number }> | null;
  };

  const resultRows = await getOrgScopedDb('spendLedgerService.listLedger').execute<LedgerRawRow>(sql`
    WITH base AS (
      SELECT
        ac.id::text AS id,
        ac.created_at AS timestamp,
        ac.subaccount_id::text AS subaccount_id,
        COALESCE(sa.name, 'Unknown') AS subaccount_name,
        ac.agent_id::text AS agent_id,
        COALESCE(a.name, 'Unknown') AS agent_name,
        ac.charge_type,
        COALESCE(ac.merchant_descriptor, 'unknown') AS provider,
        ac.amount_minor
      FROM agent_charges ac
      LEFT JOIN subaccounts sa ON sa.id = ac.subaccount_id AND sa.deleted_at IS NULL
      LEFT JOIN agents a ON a.id = ac.agent_id AND a.deleted_at IS NULL
      WHERE ac.organisation_id = ${input.organisationId}::uuid
        ${scopeFilter}
        ${workspaceFilter}
        ${agentFilter}
        ${typeFilter}
        ${fromFilter}
        ${toFilter}
        ${qFilter}
    ),
    ordered AS (
      SELECT * FROM base
      WHERE 1=1 ${cursorClause}
      ORDER BY ${sql.raw(orderCol)} ${dir}, id ${dir}
      LIMIT ${limit + 1}
    ),
    ws_options AS (
      SELECT subaccount_id AS value, MAX(subaccount_name) AS label, COUNT(*)::int AS count
      FROM base WHERE subaccount_id IS NOT NULL
      GROUP BY subaccount_id
      ORDER BY count DESC, value ASC
    ),
    agent_options AS (
      SELECT agent_id AS value, MAX(agent_name) AS label, COUNT(*)::int AS count
      FROM base WHERE agent_id IS NOT NULL
      GROUP BY agent_id
      ORDER BY count DESC, value ASC
    )
    SELECT
      (SELECT json_agg(row_to_json(ordered.*)) FROM ordered) AS rows,
      (SELECT json_agg(row_to_json(ws_options.*)) FROM ws_options) AS workspace_options,
      (SELECT json_agg(row_to_json(agent_options.*)) FROM agent_options) AS agent_options
  `);

  const raw = (resultRows as unknown as LedgerRawRow[])[0] ?? {
    rows: null,
    workspace_options: null,
    agent_options: null,
  };

  const allRows = raw.rows ?? [];
  const hasMore = allRows.length > limit;
  const pageRows = hasMore ? allRows.slice(0, limit) : allRows;

  const lastRow = hasMore ? allRows[limit - 1] : null;
  const nextCursor = lastRow
    ? (() => {
        const sortAlias = cursorSortAlias(input.sortKey);
        const lastPrimaryValue = String((lastRow as Record<string, unknown>)[sortAlias]);
        return encodeCursor({ primary: lastPrimaryValue, id: lastRow.id });
      })()
    : null;

  const rows: LedgerRowOut[] = pageRows.map((r) => ({
    id: r.id,
    timestamp: typeof r.timestamp === 'string'
      ? r.timestamp
      : new Date(r.timestamp as unknown as string).toISOString(),
    workspace: { id: r.subaccount_id, name: r.subaccount_name },
    agent: { id: r.agent_id, name: r.agent_name },
    type: (() => {
      try {
        return chargeTypeToContractType(r.charge_type as DbChargeType);
      } catch {
        return 'other' as const;
      }
    })(),
    provider: r.provider,
    model: null,
    tokensIn: null,
    tokensOut: null,
    costUsd: amountMinorToCostUsd(
      typeof r.amount_minor === 'string' ? BigInt(r.amount_minor) : r.amount_minor,
    ),
  }));

  return {
    rows,
    cursor: nextCursor,
    filterOptions: {
      workspace: raw.workspace_options ?? [],
      agent: raw.agent_options ?? [],
    },
  };
}

function primarySortCol(key: LedgerListInput['sortKey']): string {
  return ({
    timestamp: 'timestamp',
    workspace: 'subaccount_name',
    agent: 'agent_name',
    type: 'charge_type',
    tokens: 'amount_minor',
    cost: 'amount_minor',
  } satisfies Record<LedgerListInput['sortKey'], string>)[key];
}

function cursorSortAlias(key: LedgerListInput['sortKey']): string {
  return ({
    timestamp: 'timestamp',
    workspace: 'subaccount_name',
    agent: 'agent_name',
    type: 'charge_type',
    tokens: 'amount_minor',
    cost: 'amount_minor',
  } satisfies Record<LedgerListInput['sortKey'], string>)[key];
}

function buildCursorClause(
  sortKey: LedgerListInput['sortKey'],
  sortDir: LedgerListInput['sortDir'],
  cursor: CursorPayload,
): ReturnType<typeof sql> {
  const col = cursorSortAlias(sortKey);
  const op = sortDir === 'asc' ? '>' : '<';
  const cast =
    sortKey === 'timestamp'
      ? sql`::timestamptz`
      : sortKey === 'tokens' || sortKey === 'cost'
        ? sql`::bigint`
        : sql``;
  return sql`AND (${sql.raw(col)}, id) ${sql.raw(op)} (${cursor.primary}${cast}, ${cursor.id})`;
}
