import type { OrgRow, OverheadRow } from '../../../../shared/types/systemPnl';
import PnlMarginPill from './PnlMarginPill';
import PnlSparkline from './PnlSparkline';
import { fmtCurrency, fmtInt, fmtPct } from './PnlFormat';

interface Props {
  orgs:     OrgRow[];
  overhead: OverheadRow | null;
}

export default function PnlByOrganisationTable({ orgs, overhead }: Props) {
  return (
    <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
      <table className="min-w-full divide-y divide-slate-200">
        <thead className="bg-slate-50">
          <tr className="text-left text-xs font-medium text-slate-500 uppercase tracking-wide">
            <th className="px-4 py-2">Organisation</th>
            <th className="px-4 py-2 text-right">Subaccts</th>
            <th className="px-4 py-2 text-right">Requests</th>
            <th className="px-4 py-2 text-right">Revenue</th>
            <th className="px-4 py-2 text-right">Cost</th>
            <th className="px-4 py-2 text-right">Profit</th>
            <th className="px-4 py-2 text-right">Margin</th>
            <th className="px-4 py-2 text-right">% of Rev</th>
            <th className="px-4 py-2 text-right">Trend</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {orgs.map((o) => (
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
        </tbody>
      </table>
    </div>
  );
}
