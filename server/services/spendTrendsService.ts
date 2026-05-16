import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { sql } from 'drizzle-orm';
import {
  buildTrends,
  type WorkspaceTrendInput,
  type TrendsOutput,
} from './spendTrendsServicePure.js';

export interface GetSpendTrendsInput {
  organisationId: string;
}

type MonthlySpendRow = {
  workspace_id: string;
  workspace_name: string;
  months_ago: string | number;  // 0 = current month, 5 = 5 months ago
  spend_cents: string | number;
};

type WorkspaceCapRow = {
  workspace_id: string;
  monthly_cap_cents: string | number | null;
};

type CurrentMtdRow = {
  workspace_id: string;
  mtd_cents: string | number;
};

function buildMonthLabels(now: Date): string[] {
  const labels: string[] = [];
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    labels.push(monthNames[d.getUTCMonth()]);
  }
  return labels;
}

export async function getSpendTrends(input: GetSpendTrendsInput): Promise<TrendsOutput> {
  const db = getOrgScopedDb('spendTrendsService.getSpendTrends');
  const now = new Date();

  // Start of window: 6 months ago (first day of that month)
  const windowStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1));

  // Query 6 months of spend by workspace, grouped by month offset (0=oldest, 5=current)
  const spendRows = await db.execute<MonthlySpendRow>(sql`
    SELECT
      ac.subaccount_id::text AS workspace_id,
      COALESCE(sa.name, 'Unknown') AS workspace_name,
      (EXTRACT(YEAR FROM age(DATE_TRUNC('month', NOW()), DATE_TRUNC('month', ac.created_at))) * 12
       + EXTRACT(MONTH FROM age(DATE_TRUNC('month', NOW()), DATE_TRUNC('month', ac.created_at))))::int AS months_ago,
      COALESCE(SUM(ac.amount_minor), 0)::bigint AS spend_cents
    FROM agent_charges ac
    LEFT JOIN subaccounts sa ON sa.id = ac.subaccount_id AND sa.deleted_at IS NULL
    WHERE ac.organisation_id = ${input.organisationId}::uuid
      AND ac.subaccount_id IS NOT NULL
      AND ac.created_at >= ${windowStart.toISOString()}::timestamptz
      AND ac.status IN ('succeeded', 'shadow_settled')
    GROUP BY ac.subaccount_id, sa.name, DATE_TRUNC('month', ac.created_at)
  `);

  // Query workspace caps (monthly_cost_limit_cents from workspace_limits)
  const capRows = await db.execute<WorkspaceCapRow>(sql`
    SELECT
      wl.subaccount_id::text AS workspace_id,
      wl.monthly_cost_limit_cents AS monthly_cap_cents
    FROM workspace_limits wl
    INNER JOIN subaccounts sa ON sa.id = wl.subaccount_id
    WHERE sa.organisation_id = ${input.organisationId}::uuid
      AND sa.deleted_at IS NULL
  `);

  // Query current MTD spend for ranking
  const currentMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const mtdRows = await db.execute<CurrentMtdRow>(sql`
    SELECT
      ac.subaccount_id::text AS workspace_id,
      COALESCE(SUM(ac.amount_minor), 0)::bigint AS mtd_cents
    FROM agent_charges ac
    WHERE ac.organisation_id = ${input.organisationId}::uuid
      AND ac.subaccount_id IS NOT NULL
      AND ac.created_at >= ${currentMonthStart.toISOString()}::timestamptz
      AND ac.status IN ('succeeded', 'shadow_settled')
    GROUP BY ac.subaccount_id
  `);

  const rawSpend = spendRows as unknown as MonthlySpendRow[];
  const rawCaps = capRows as unknown as WorkspaceCapRow[];
  const rawMtd = mtdRows as unknown as CurrentMtdRow[];

  // Build a map of workspace_id → monthly cap
  const capMap = new Map<string, number | null>();
  for (const r of rawCaps) {
    capMap.set(r.workspace_id, r.monthly_cap_cents !== null ? Number(r.monthly_cap_cents) : null);
  }

  // Build a map of workspace_id → current mtd
  const mtdMap = new Map<string, number>();
  for (const r of rawMtd) {
    mtdMap.set(r.workspace_id, Number(r.mtd_cents));
  }

  // Aggregate spend rows into per-workspace 6-month arrays
  // months_ago: 0 = current month, 5 = 5 months ago → array index = 5 - months_ago
  type WorkspaceAccum = {
    workspaceId: string;
    workspaceName: string;
    spend6mo: number[];
  };

  const workspaceMap = new Map<string, WorkspaceAccum>();

  for (const r of rawSpend) {
    const monthsAgo = Number(r.months_ago);
    if (monthsAgo < 0 || monthsAgo > 5) continue;
    const idx = 5 - monthsAgo;

    let accum = workspaceMap.get(r.workspace_id);
    if (!accum) {
      accum = {
        workspaceId: r.workspace_id,
        workspaceName: r.workspace_name,
        spend6mo: [0, 0, 0, 0, 0, 0],
      };
      workspaceMap.set(r.workspace_id, accum);
    }
    accum.spend6mo[idx] = Number(r.spend_cents);
  }

  // Also include workspaces that have an MTD row but no historical spend yet
  for (const r of rawMtd) {
    if (!workspaceMap.has(r.workspace_id)) {
      workspaceMap.set(r.workspace_id, {
        workspaceId: r.workspace_id,
        workspaceName: 'Unknown',
        spend6mo: [0, 0, 0, 0, 0, 0],
      });
    }
  }

  const workspaces: WorkspaceTrendInput[] = [];
  for (const accum of workspaceMap.values()) {
    const cap = capMap.get(accum.workspaceId) ?? null;
    workspaces.push({
      workspaceId: accum.workspaceId,
      workspaceName: accum.workspaceName,
      spend6moCents: accum.spend6mo,
      cap6moCents: [cap, cap, cap, cap, cap, cap],
      currentMtdCents: mtdMap.get(accum.workspaceId) ?? 0,
    });
  }

  const monthLabels = buildMonthLabels(now);
  return buildTrends(workspaces, monthLabels);
}
