import type {
  KpiChangePct,
  KpiChangePp,
  SourceTypeRow,
} from '../../shared/types/systemPnl.js';

// ---------------------------------------------------------------------------
// Pure helpers for the System P&L page. No DB access; every function is a
// deterministic transform over inputs the service layer has already fetched.
// Covered by server/services/__tests__/systemPnlServicePure.test.ts.
//
// See spec §11.5 (column math) and §19 (contracts).
// ---------------------------------------------------------------------------

/**
 * Overhead predicate — spec §11.5: a row is "overhead" iff its revenue is
 * null. Classification (sourceType) is not used here so future hybrid
 * workflows (subsidised agent runs, billed-back system calls) stay correct.
 */
export function isOverheadRow(row: { revenueCents: number | null }): boolean {
  return row.revenueCents === null;
}

/**
 * Margin percentage with a null-safe denominator. Returns null for overhead
 * rows so the client can render an "overhead" badge instead of a percentage.
 */
export function computeMarginPct(revenueCents: number | null, costCents: number): number | null {
  if (revenueCents === null) return null;
  if (revenueCents === 0) return 0;
  const profit = revenueCents - costCents;
  return round2((profit / revenueCents) * 100);
}

/**
 * Profit math — for overhead rows (revenue === null) the row's profit is
 * the negative of cost (pure expense). For billable rows it's the normal
 * revenue minus cost.
 */
export function computeProfitCents(revenueCents: number | null, costCents: number): number {
  if (revenueCents === null) return -costCents;
  return revenueCents - costCents;
}

/**
 * KPI change indicator — percent change vs previous period. Returns null
 * when previousCents is null (no prior period data).
 */
export function computeKpiChangePct(
  currentCents: number,
  previousCents: number | null,
): KpiChangePct | null {
  if (previousCents === null) return null;
  if (previousCents === 0) {
    return currentCents === 0
      ? { pct: 0, direction: 'flat' }
      : { pct: 100, direction: currentCents > 0 ? 'up' : 'down' };
  }
  const raw = ((currentCents - previousCents) / previousCents) * 100;
  return {
    pct: Math.abs(round2(raw)),
    direction: raw > 0 ? 'up' : raw < 0 ? 'down' : 'flat',
  };
}

/**
 * KPI change indicator — percentage-point change (for margins). `currentPct`
 * and `previousPct` are already in percentage units.
 */
export function computeKpiChangePp(
  currentPct: number,
  previousPct: number | null,
): KpiChangePp | null {
  if (previousPct === null) return null;
  const raw = round2(currentPct - previousPct);
  return {
    pp: Math.abs(raw),
    direction: raw > 0 ? 'up' : raw < 0 ? 'down' : 'flat',
  };
}

/**
 * Percentage of a scalar against a total. Returns 0 when total is 0 (avoids
 * NaN). Rounded to two decimal places for display consistency.
 */
export function pctOfTotal(partCents: number, totalCents: number): number {
  if (totalCents <= 0) return 0;
  return round2((partCents / totalCents) * 100);
}

/**
 * Aggregated overhead row for the By Organisation tab — sums cost across
 * every overhead-bearing row (i.e. every row whose sourceType is in the
 * non-billable set). `platformRevenueCents` scales the pctOfRevenue column.
 */
export function buildAggregatedOverheadRow(args: {
  overheadRows: SourceTypeRow[];             // pre-filtered to overhead rows
  platformRevenueCents: number;
  label?: string;
  description?: string;
}): {
  kind: 'overhead';
  label: string;
  description: string;
  requests: number;
  revenueCents: null;
  costCents: number;
  profitCents: number;
  marginPct: null;
  pctOfRevenue: number;
} {
  const requests = args.overheadRows.reduce((sum, r) => sum + r.requests, 0);
  const costCents = args.overheadRows.reduce((sum, r) => sum + r.costCents, 0);
  return {
    kind:         'overhead',
    label:        args.label ?? 'Overhead · Platform background work',
    description:  args.description ?? 'System + analyzer (see By Source Type for split)',
    requests,
    revenueCents: null,
    costCents,
    profitCents:  -costCents,
    marginPct:    null,
    pctOfRevenue: pctOfTotal(costCents, args.platformRevenueCents),
  };
}

/**
 * Derive the Net Profit KPI from an already-computed Gross Profit and a
 * Platform Overhead total. Net = Gross - Overhead. Kept as a pure function
 * because two callers (the live KPI card and the trend chart delta on
 * hover) need the same math and a single source of truth is safer than
 * duplicating the subtraction.
 */
export function computeNetProfit(grossProfitCents: number, platformOverheadCents: number): number {
  return grossProfitCents - platformOverheadCents;
}

/**
 * Totals row at the bottom of each tab table. Sums the scalar columns and
 * derives the net margin. Passed an iterable of rows that expose
 * `revenueCents`, `costCents`, `requests` — matches the shape of every
 * *Row contract in shared/types/systemPnl.ts.
 */
export function computeTotalsRow(
  rows: ReadonlyArray<{ requests: number; revenueCents: number | null; costCents: number }>,
): { requests: number; revenueCents: number; costCents: number; profitCents: number; marginPct: number } {
  let requests = 0;
  let revenueCents = 0;
  let costCents = 0;
  for (const r of rows) {
    requests += r.requests;
    revenueCents += r.revenueCents ?? 0;         // overhead rows contribute 0 to revenue
    costCents += r.costCents;
  }
  const profitCents = revenueCents - costCents;
  const marginPct = revenueCents > 0 ? round2((profitCents / revenueCents) * 100) : 0;
  return { requests, revenueCents, costCents, profitCents, marginPct };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
