import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { sql } from 'drizzle-orm';
import {
  computeInsights,
  type WorkspaceMonthlySpend,
  type AgentRunCount,
  type SpendInsightsOutput,
} from './spendInsightsServicePure.js';

export interface GetSpendInsightsInput {
  organisationId: string;
}

type WorkspaceSpendRow = {
  workspace_id: string;
  workspace_name: string;
  mtd_cents: string | number;
  prev_month_cents: string | number | null;
};

type AgentRunRow = {
  agent_id: string;
  agent_name: string;
  workspace_id: string;
  workspace_name: string;
  runs_30d: string | number;
};

export async function getSpendInsights(input: GetSpendInsightsInput): Promise<SpendInsightsOutput> {
  const db = getOrgScopedDb('spendInsightsService.getSpendInsights');
  const now = new Date();
  const currentMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const prevMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const prevMonthEnd = new Date(currentMonthStart.getTime() - 1);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const spendRows = await db.execute<WorkspaceSpendRow>(sql`
    WITH mtd AS (
      SELECT
        ac.subaccount_id::text AS workspace_id,
        COALESCE(sa.name, 'Unknown') AS workspace_name,
        COALESCE(SUM(ac.amount_minor), 0)::bigint AS mtd_cents
      FROM agent_charges ac
      LEFT JOIN subaccounts sa ON sa.id = ac.subaccount_id AND sa.deleted_at IS NULL
      WHERE ac.organisation_id = ${input.organisationId}::uuid
        AND ac.subaccount_id IS NOT NULL
        AND ac.created_at >= ${currentMonthStart.toISOString()}::timestamptz
        AND ac.status IN ('succeeded', 'shadow_settled')
      GROUP BY ac.subaccount_id, sa.name
    ),
    prev AS (
      SELECT
        ac.subaccount_id::text AS workspace_id,
        COALESCE(SUM(ac.amount_minor), 0)::bigint AS prev_month_cents
      FROM agent_charges ac
      WHERE ac.organisation_id = ${input.organisationId}::uuid
        AND ac.subaccount_id IS NOT NULL
        AND ac.created_at >= ${prevMonthStart.toISOString()}::timestamptz
        AND ac.created_at <= ${prevMonthEnd.toISOString()}::timestamptz
        AND ac.status IN ('succeeded', 'shadow_settled')
      GROUP BY ac.subaccount_id
    )
    SELECT
      m.workspace_id,
      m.workspace_name,
      m.mtd_cents,
      p.prev_month_cents
    FROM mtd m
    LEFT JOIN prev p ON p.workspace_id = m.workspace_id
    ORDER BY m.mtd_cents DESC
  `);

  const runRows = await db.execute<AgentRunRow>(sql`
    SELECT
      ar.agent_id::text AS agent_id,
      COALESCE(a.name, 'Unknown') AS agent_name,
      ar.subaccount_id::text AS workspace_id,
      COALESCE(sa.name, 'Unknown') AS workspace_name,
      COUNT(*)::int AS runs_30d
    FROM agent_runs ar
    LEFT JOIN agents a ON a.id = ar.agent_id AND a.deleted_at IS NULL
    LEFT JOIN subaccounts sa ON sa.id = ar.subaccount_id AND sa.deleted_at IS NULL
    WHERE ar.organisation_id = ${input.organisationId}::uuid
      AND ar.subaccount_id IS NOT NULL
      AND ar.created_at >= ${thirtyDaysAgo.toISOString()}::timestamptz
    GROUP BY ar.agent_id, a.name, ar.subaccount_id, sa.name
    ORDER BY runs_30d DESC
  `);

  const rawSpendRows = spendRows as unknown as WorkspaceSpendRow[];
  const rawRunRows = runRows as unknown as AgentRunRow[];

  const spends: WorkspaceMonthlySpend[] = rawSpendRows.map((r) => ({
    workspaceId: r.workspace_id,
    workspaceName: r.workspace_name,
    mtdCents: Number(r.mtd_cents),
    prevMonthCents: r.prev_month_cents !== null ? Number(r.prev_month_cents) : null,
  }));

  const runs: AgentRunCount[] = rawRunRows.map((r) => ({
    agentId: r.agent_id,
    agentName: r.agent_name,
    workspaceId: r.workspace_id,
    workspaceName: r.workspace_name,
    runs30d: Number(r.runs_30d),
  }));

  return computeInsights(spends, runs);
}
