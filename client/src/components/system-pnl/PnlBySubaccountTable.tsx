import type { SubacctRow } from '../../../../shared/types/systemPnl';
import PnlMarginPill from './PnlMarginPill';
import { fmtCurrency, fmtInt, fmtPct } from './PnlFormat';

interface Props {
  rows: SubacctRow[];
}

export default function PnlBySubaccountTable({ rows }: Props) {
  return (
    <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
      <table className="min-w-full divide-y divide-slate-200">
        <thead className="bg-slate-50">
          <tr className="text-left text-xs font-medium text-slate-500 uppercase tracking-wide">
            <th className="px-4 py-2">Subaccount</th>
            <th className="px-4 py-2">Organisation</th>
            <th className="px-4 py-2 text-right">Requests</th>
            <th className="px-4 py-2 text-right">Revenue</th>
            <th className="px-4 py-2 text-right">Cost</th>
            <th className="px-4 py-2 text-right">Profit</th>
            <th className="px-4 py-2 text-right">Margin</th>
            <th className="px-4 py-2 text-right">% of Rev</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => (
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
        </tbody>
      </table>
    </div>
  );
}
