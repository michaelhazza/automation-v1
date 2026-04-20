import { useMemo } from 'react';
import type { SubacctRow } from '../../../../shared/types/systemPnl';
import PnlMarginPill from './PnlMarginPill';
import PnlColHeader, { type PnlSortDir, type PnlSortState } from './PnlColHeader';
import { fmtCurrency, fmtInt, fmtPct } from './PnlFormat';

type SubSortKey =
  | 'subaccount'
  | 'organisation'
  | 'requests'
  | 'revenue'
  | 'cost'
  | 'profit'
  | 'margin'
  | 'pctOfRev';

interface Props {
  rows:   SubacctRow[];
  sort:   PnlSortState<SubSortKey> | null;
  onSort: (key: SubSortKey, dir: PnlSortDir) => void;
}

export default function PnlBySubaccountTable({ rows, sort, onSort }: Props) {
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const mul = sort.dir === 'asc' ? 1 : -1;
    const get = (r: SubacctRow): number | string => {
      switch (sort.key) {
        case 'subaccount':   return r.subaccountName.toLowerCase();
        case 'organisation': return r.organisationName.toLowerCase();
        case 'requests':     return r.requests;
        case 'revenue':      return r.revenueCents;
        case 'cost':         return r.costCents;
        case 'profit':       return r.profitCents;
        case 'margin':       return r.marginPct;
        case 'pctOfRev':     return r.pctOfRevenue;
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
            <PnlColHeader<SubSortKey> label="Subaccount"   colKey="subaccount"   sort={sort} onSort={onSort} />
            <PnlColHeader<SubSortKey> label="Organisation" colKey="organisation" sort={sort} onSort={onSort} />
            <PnlColHeader<SubSortKey> label="Requests"     colKey="requests"     sort={sort} onSort={onSort} align="right" ascLabel="Low → High" descLabel="High → Low" />
            <PnlColHeader<SubSortKey> label="Revenue"      colKey="revenue"      sort={sort} onSort={onSort} align="right" ascLabel="Low → High" descLabel="High → Low" />
            <PnlColHeader<SubSortKey> label="Cost"         colKey="cost"         sort={sort} onSort={onSort} align="right" ascLabel="Low → High" descLabel="High → Low" />
            <PnlColHeader<SubSortKey> label="Profit"       colKey="profit"       sort={sort} onSort={onSort} align="right" ascLabel="Low → High" descLabel="High → Low" />
            <PnlColHeader<SubSortKey> label="Margin"       colKey="margin"       sort={sort} onSort={onSort} align="right" ascLabel="Low → High" descLabel="High → Low" />
            <PnlColHeader<SubSortKey> label="% of Rev"     colKey="pctOfRev"     sort={sort} onSort={onSort} align="right" ascLabel="Low → High" descLabel="High → Low" />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {sorted.map((r) => (
            <tr key={r.subaccountId} className="text-sm">
              <td className="px-4 py-2">
                <div className="font-medium text-slate-900">{r.subaccountName}</div>
                <div className="text-xs text-slate-500">tier {r.marginTier.toFixed(2)}×</div>
              </td>
              <td className="px-4 py-2 text-slate-600">{r.organisationName}</td>
              <td className="px-4 py-2 text-right tabular-nums">{fmtInt(r.requests)}</td>
              <td className="px-4 py-2 text-right tabular-nums">{fmtCurrency(r.revenueCents)}</td>
              <td className="px-4 py-2 text-right tabular-nums">{fmtCurrency(r.costCents)}</td>
              <td className="px-4 py-2 text-right tabular-nums">{fmtCurrency(r.profitCents)}</td>
              <td className="px-4 py-2 text-right">
                <PnlMarginPill marginPct={r.marginPct} revenueCents={r.revenueCents} />
              </td>
              <td className="px-4 py-2 text-right tabular-nums text-slate-600">{fmtPct(r.pctOfRevenue)}</td>
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
          </tr>
        </tbody>
      </table>
    </div>
  );
}
