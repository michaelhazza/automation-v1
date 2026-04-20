import { useMemo } from 'react';
import type { OrgRow, OverheadRow } from '../../../../shared/types/systemPnl';
import PnlMarginPill from './PnlMarginPill';
import PnlSparkline from './PnlSparkline';
import PnlColHeader, { type PnlSortDir, type PnlSortState } from './PnlColHeader';
import { fmtCurrency, fmtInt, fmtPct } from './PnlFormat';

type OrgSortKey =
  | 'name'
  | 'subaccounts'
  | 'requests'
  | 'revenue'
  | 'cost'
  | 'profit'
  | 'margin'
  | 'pctOfRev';

interface Props {
  orgs:     OrgRow[];
  overhead: OverheadRow | null;
  sort:     PnlSortState<OrgSortKey> | null;
  onSort:   (key: OrgSortKey, dir: PnlSortDir) => void;
}

export default function PnlByOrganisationTable({ orgs, overhead, sort, onSort }: Props) {
  const sorted = useMemo(() => {
    if (!sort) return orgs;
    const mul = sort.dir === 'asc' ? 1 : -1;
    const get = (o: OrgRow): number | string => {
      switch (sort.key) {
        case 'name':        return o.organisationName.toLowerCase();
        case 'subaccounts': return o.subaccountCount;
        case 'requests':    return o.requests;
        case 'revenue':     return o.revenueCents;
        case 'cost':        return o.costCents;
        case 'profit':      return o.profitCents;
        case 'margin':      return o.marginPct;
        case 'pctOfRev':    return o.pctOfRevenue;
      }
    };
    return [...orgs].sort((a, b) => {
      const av = get(a); const bv = get(b);
      if (av === bv) return 0;
      return av < bv ? -1 * mul : 1 * mul;
    });
  }, [orgs, sort]);

  const totals = useMemo(() => {
    return orgs.reduce(
      (acc, o) => ({
        subaccounts:  acc.subaccounts + o.subaccountCount,
        requests:     acc.requests    + o.requests,
        revenueCents: acc.revenueCents + o.revenueCents,
        costCents:    acc.costCents   + o.costCents,
        profitCents:  acc.profitCents + o.profitCents,
      }),
      { subaccounts: 0, requests: 0, revenueCents: 0, costCents: 0, profitCents: 0 },
    );
  }, [orgs]);
  const totalsMarginPct = totals.revenueCents > 0
    ? Math.round((totals.profitCents / totals.revenueCents) * 10000) / 100
    : 0;

  return (
    <div className="bg-white rounded-lg border border-slate-200 overflow-visible">
      <table className="min-w-full divide-y divide-slate-200">
        <thead className="bg-slate-50">
          <tr>
            <PnlColHeader<OrgSortKey> label="Organisation" colKey="name"        sort={sort} onSort={onSort} />
            <PnlColHeader<OrgSortKey> label="Subaccts"     colKey="subaccounts" sort={sort} onSort={onSort} align="right" ascLabel="Few → Many"   descLabel="Many → Few" />
            <PnlColHeader<OrgSortKey> label="Requests"     colKey="requests"    sort={sort} onSort={onSort} align="right" ascLabel="Low → High"   descLabel="High → Low" />
            <PnlColHeader<OrgSortKey> label="Revenue"      colKey="revenue"     sort={sort} onSort={onSort} align="right" ascLabel="Low → High"   descLabel="High → Low" />
            <PnlColHeader<OrgSortKey> label="Cost"         colKey="cost"        sort={sort} onSort={onSort} align="right" ascLabel="Low → High"   descLabel="High → Low" />
            <PnlColHeader<OrgSortKey> label="Profit"       colKey="profit"      sort={sort} onSort={onSort} align="right" ascLabel="Low → High"   descLabel="High → Low" />
            <PnlColHeader<OrgSortKey> label="Margin"       colKey="margin"      sort={sort} onSort={onSort} align="right" ascLabel="Low → High"   descLabel="High → Low" />
            <PnlColHeader<OrgSortKey> label="% of Rev"     colKey="pctOfRev"    sort={sort} onSort={onSort} align="right" ascLabel="Low → High"   descLabel="High → Low" />
            <th className="px-4 py-2 text-right text-xs font-medium text-slate-500 uppercase tracking-wide">Trend</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {sorted.map((o) => (
            <tr key={o.organisationId} className="text-sm">
              <td className="px-4 py-2">
                <div className="font-medium text-slate-900">{o.organisationName}</div>
                <div className="text-xs text-slate-500">tier {o.marginTier.toFixed(2)}×</div>
              </td>
              <td className="px-4 py-2 text-right tabular-nums">{fmtInt(o.subaccountCount)}</td>
              <td className="px-4 py-2 text-right tabular-nums">{fmtInt(o.requests)}</td>
              <td className="px-4 py-2 text-right tabular-nums">{fmtCurrency(o.revenueCents)}</td>
              <td className="px-4 py-2 text-right tabular-nums">{fmtCurrency(o.costCents)}</td>
              <td className="px-4 py-2 text-right tabular-nums">{fmtCurrency(o.profitCents)}</td>
              <td className="px-4 py-2 text-right">
                <PnlMarginPill marginPct={o.marginPct} revenueCents={o.revenueCents} />
              </td>
              <td className="px-4 py-2 text-right tabular-nums text-slate-600">{fmtPct(o.pctOfRevenue)}</td>
              <td className="px-4 py-2 text-right"><PnlSparkline values={o.trendSparkline} /></td>
            </tr>
          ))}
          {overhead && (
            <tr className="text-sm bg-indigo-50/50">
              <td className="px-4 py-2">
                <div className="font-medium text-indigo-900">{overhead.label}</div>
                <div className="text-xs text-indigo-700">{overhead.description}</div>
              </td>
              <td className="px-4 py-2 text-right text-slate-400">—</td>
              <td className="px-4 py-2 text-right tabular-nums">{fmtInt(overhead.requests)}</td>
              <td className="px-4 py-2 text-right text-slate-400">—</td>
              <td className="px-4 py-2 text-right tabular-nums">{fmtCurrency(overhead.costCents)}</td>
              <td className="px-4 py-2 text-right tabular-nums text-slate-500">{fmtCurrency(overhead.profitCents)}</td>
              <td className="px-4 py-2 text-right">
                <PnlMarginPill marginPct={null} revenueCents={null} />
              </td>
              <td className="px-4 py-2 text-right tabular-nums text-slate-600">{fmtPct(overhead.pctOfRevenue)}</td>
              <td className="px-4 py-2 text-right text-slate-300">—</td>
            </tr>
          )}
          <tr className="text-sm bg-slate-100 font-semibold">
            <td className="px-4 py-2 text-slate-900">Total</td>
            <td className="px-4 py-2 text-right tabular-nums">{fmtInt(totals.subaccounts)}</td>
            <td className="px-4 py-2 text-right tabular-nums">{fmtInt(totals.requests)}</td>
            <td className="px-4 py-2 text-right tabular-nums">{fmtCurrency(totals.revenueCents)}</td>
            <td className="px-4 py-2 text-right tabular-nums">{fmtCurrency(totals.costCents)}</td>
            <td className="px-4 py-2 text-right tabular-nums">{fmtCurrency(totals.profitCents)}</td>
            <td className="px-4 py-2 text-right">
              <PnlMarginPill marginPct={totalsMarginPct} revenueCents={totals.revenueCents} />
            </td>
            <td className="px-4 py-2 text-right tabular-nums text-slate-600">—</td>
            <td className="px-4 py-2 text-right text-slate-300">—</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
