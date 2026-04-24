import { useMemo } from 'react';
import type { SourceTypeRow } from '../../../../shared/types/systemPnl';
import PnlMarginPill from './PnlMarginPill';
import PnlColHeader, { type PnlSortDir, type PnlSortState } from './PnlColHeader';
import { fmtCurrency, fmtInt, fmtPct } from './PnlFormat';

type SourceSortKey =
  | 'label'
  | 'orgs'
  | 'requests'
  | 'revenue'
  | 'cost'
  | 'profit'
  | 'margin'
  | 'pctOfCost';

interface Props {
  rows:   SourceTypeRow[];
  sort:   PnlSortState<SourceSortKey> | null;
  onSort: (key: SourceSortKey, dir: PnlSortDir) => void;
}

export default function PnlBySourceTypeTable({ rows, sort, onSort }: Props) {
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const mul = sort.dir === 'asc' ? 1 : -1;
    const get = (r: SourceTypeRow): number | string => {
      switch (sort.key) {
        case 'label':     return r.label.toLowerCase();
        case 'orgs':      return r.orgsCount;
        case 'requests':  return r.requests;
        case 'revenue':   return r.revenueCents ?? -1;  // overhead rows (null) sort last on asc
        case 'cost':      return r.costCents;
        case 'profit':    return r.profitCents ?? 0;
        case 'margin':    return r.marginPct ?? -1;
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
        orgs:         Math.max(acc.orgs, r.orgsCount),  // not additive; show max
        requests:     acc.requests    + r.requests,
        revenueCents: acc.revenueCents + (r.revenueCents ?? 0),
        costCents:    acc.costCents   + r.costCents,
        profitCents:  acc.profitCents + (r.profitCents ?? 0),
      }),
      { orgs: 0, requests: 0, revenueCents: 0, costCents: 0, profitCents: 0 },
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
            <PnlColHeader<SourceSortKey> label="Source Type" colKey="label"     sort={sort} onSort={onSort} />
            <PnlColHeader<SourceSortKey> label="Orgs"        colKey="orgs"      sort={sort} onSort={onSort} align="right" ascLabel="Few → Many" descLabel="Many → Few" />
            <PnlColHeader<SourceSortKey> label="Requests"    colKey="requests"  sort={sort} onSort={onSort} align="right" ascLabel="Low → High" descLabel="High → Low" />
            <PnlColHeader<SourceSortKey> label="Revenue"     colKey="revenue"   sort={sort} onSort={onSort} align="right" ascLabel="Low → High" descLabel="High → Low" />
            <PnlColHeader<SourceSortKey> label="Cost"        colKey="cost"      sort={sort} onSort={onSort} align="right" ascLabel="Low → High" descLabel="High → Low" />
            <PnlColHeader<SourceSortKey> label="Profit"      colKey="profit"    sort={sort} onSort={onSort} align="right" ascLabel="Low → High" descLabel="High → Low" />
            <PnlColHeader<SourceSortKey> label="Margin"      colKey="margin"    sort={sort} onSort={onSort} align="right" ascLabel="Low → High" descLabel="High → Low" />
            <PnlColHeader<SourceSortKey> label="% of Cost"   colKey="pctOfCost" sort={sort} onSort={onSort} align="right" ascLabel="Low → High" descLabel="High → Low" />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {sorted.map((r) => {
            const overhead = r.revenueCents === null;
            return (
              <tr key={r.sourceType} className={overhead ? 'text-sm bg-indigo-50/50' : 'text-sm'}>
                <td className="px-4 py-2">
                  <div className={overhead ? 'font-medium text-indigo-900' : 'font-medium text-slate-900'}>{r.label}</div>
                  <div className={overhead ? 'text-xs text-indigo-700' : 'text-xs text-slate-500'}>{r.description}</div>
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{fmtInt(r.orgsCount)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{fmtInt(r.requests)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{fmtCurrency(r.revenueCents)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{fmtCurrency(r.costCents)}</td>
                <td className={'px-4 py-2 text-right tabular-nums ' + (overhead ? 'text-slate-500' : '')}>{fmtCurrency(r.profitCents)}</td>
                <td className="px-4 py-2 text-right">
                  <PnlMarginPill marginPct={r.marginPct} revenueCents={r.revenueCents} />
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-slate-600">{fmtPct(r.pctOfCost)}</td>
              </tr>
            );
          })}
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
