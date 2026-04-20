import { useMemo } from 'react';
import type { ProviderModelRow } from '../../../../shared/types/systemPnl';
import PnlMarginPill from './PnlMarginPill';
import PnlColHeader, { type PnlSortDir, type PnlSortState } from './PnlColHeader';
import { fmtCurrency, fmtInt, fmtPct, fmtLatencyMs } from './PnlFormat';

type ModelSortKey =
  | 'provider'
  | 'model'
  | 'requests'
  | 'revenue'
  | 'cost'
  | 'profit'
  | 'margin'
  | 'latency'
  | 'pctOfCost';

interface Props {
  rows:   ProviderModelRow[];
  sort:   PnlSortState<ModelSortKey> | null;
  onSort: (key: ModelSortKey, dir: PnlSortDir) => void;
}

export default function PnlByProviderModelTable({ rows, sort, onSort }: Props) {
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const mul = sort.dir === 'asc' ? 1 : -1;
    const get = (r: ProviderModelRow): number | string => {
      switch (sort.key) {
        case 'provider':  return r.provider.toLowerCase();
        case 'model':     return r.model.toLowerCase();
        case 'requests':  return r.requests;
        case 'revenue':   return r.revenueCents;
        case 'cost':      return r.costCents;
        case 'profit':    return r.profitCents;
        case 'margin':    return r.marginPct;
        case 'latency':   return r.avgLatencyMs;
        case 'pctOfCost': return r.pctOfCost;
      }
    };
    return [...rows].sort((a, b) => {
      const av = get(a); const bv = get(b);
      if (av === bv) return 0;
      return av < bv ? -1 * mul : 1 * mul;
    });
  }, [rows, sort]);

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, r) => ({
        requests:     acc.requests    + r.requests,
        revenueCents: acc.revenueCents + r.revenueCents,
        costCents:    acc.costCents   + r.costCents,
        profitCents:  acc.profitCents + r.profitCents,
      }),
      { requests: 0, revenueCents: 0, costCents: 0, profitCents: 0 },
    );
  }, [rows]);
  const totalsMarginPct = totals.revenueCents > 0
    ? Math.round((totals.profitCents / totals.revenueCents) * 10000) / 100
    : 0;

  return (
    <div className="bg-white rounded-lg border border-slate-200 overflow-visible">
      <table className="min-w-full divide-y divide-slate-200">
        <thead className="bg-slate-50">
          <tr>
            <PnlColHeader<ModelSortKey> label="Provider"    colKey="provider"  sort={sort} onSort={onSort} />
            <PnlColHeader<ModelSortKey> label="Model"       colKey="model"     sort={sort} onSort={onSort} />
            <PnlColHeader<ModelSortKey> label="Requests"    colKey="requests"  sort={sort} onSort={onSort} align="right" ascLabel="Low → High"  descLabel="High → Low" />
            <PnlColHeader<ModelSortKey> label="Revenue"     colKey="revenue"   sort={sort} onSort={onSort} align="right" ascLabel="Low → High"  descLabel="High → Low" />
            <PnlColHeader<ModelSortKey> label="Cost"        colKey="cost"      sort={sort} onSort={onSort} align="right" ascLabel="Low → High"  descLabel="High → Low" />
            <PnlColHeader<ModelSortKey> label="Profit"      colKey="profit"    sort={sort} onSort={onSort} align="right" ascLabel="Low → High"  descLabel="High → Low" />
            <PnlColHeader<ModelSortKey> label="Margin"      colKey="margin"    sort={sort} onSort={onSort} align="right" ascLabel="Low → High"  descLabel="High → Low" />
            <PnlColHeader<ModelSortKey> label="Avg Latency" colKey="latency"   sort={sort} onSort={onSort} align="right" ascLabel="Fast → Slow" descLabel="Slow → Fast" />
            <PnlColHeader<ModelSortKey> label="% of Cost"   colKey="pctOfCost" sort={sort} onSort={onSort} align="right" ascLabel="Low → High"  descLabel="High → Low" />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {sorted.map((r) => (
            <tr key={r.provider + '/' + r.model} className="text-sm">
              <td className="px-4 py-2 capitalize font-medium text-slate-900">{r.provider}</td>
              <td className="px-4 py-2 text-slate-600">{r.model}</td>
              <td className="px-4 py-2 text-right tabular-nums">{fmtInt(r.requests)}</td>
              <td className="px-4 py-2 text-right tabular-nums">{fmtCurrency(r.revenueCents)}</td>
              <td className="px-4 py-2 text-right tabular-nums">{fmtCurrency(r.costCents)}</td>
              <td className="px-4 py-2 text-right tabular-nums">{fmtCurrency(r.profitCents)}</td>
              <td className="px-4 py-2 text-right">
                <PnlMarginPill marginPct={r.marginPct} revenueCents={r.revenueCents} />
              </td>
              <td className="px-4 py-2 text-right tabular-nums text-slate-600">{fmtLatencyMs(r.avgLatencyMs)}</td>
              <td className="px-4 py-2 text-right tabular-nums text-slate-600">{fmtPct(r.pctOfCost)}</td>
            </tr>
          ))}
          <tr className="text-sm bg-slate-100 font-semibold">
            <td className="px-4 py-2 text-slate-900">Total</td>
            <td className="px-4 py-2 text-slate-400">—</td>
            <td className="px-4 py-2 text-right tabular-nums">{fmtInt(totals.requests)}</td>
            <td className="px-4 py-2 text-right tabular-nums">{fmtCurrency(totals.revenueCents)}</td>
            <td className="px-4 py-2 text-right tabular-nums">{fmtCurrency(totals.costCents)}</td>
            <td className="px-4 py-2 text-right tabular-nums">{fmtCurrency(totals.profitCents)}</td>
            <td className="px-4 py-2 text-right">
              <PnlMarginPill marginPct={totalsMarginPct} revenueCents={totals.revenueCents} />
            </td>
            <td className="px-4 py-2 text-right text-slate-300">—</td>
            <td className="px-4 py-2 text-right text-slate-300">—</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
