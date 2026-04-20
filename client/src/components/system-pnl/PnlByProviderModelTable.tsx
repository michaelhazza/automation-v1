import type { ProviderModelRow } from '../../../../shared/types/systemPnl';
import PnlMarginPill from './PnlMarginPill';
import { fmtCurrency, fmtInt, fmtPct, fmtLatencyMs } from './PnlFormat';

interface Props {
  rows: ProviderModelRow[];
}

export default function PnlByProviderModelTable({ rows }: Props) {
  return (
    <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
      <table className="min-w-full divide-y divide-slate-200">
        <thead className="bg-slate-50">
          <tr className="text-left text-xs font-medium text-slate-500 uppercase tracking-wide">
            <th className="px-4 py-2">Provider</th>
            <th className="px-4 py-2">Model</th>
            <th className="px-4 py-2 text-right">Requests</th>
            <th className="px-4 py-2 text-right">Revenue</th>
            <th className="px-4 py-2 text-right">Cost</th>
            <th className="px-4 py-2 text-right">Profit</th>
            <th className="px-4 py-2 text-right">Margin</th>
            <th className="px-4 py-2 text-right">Avg Latency</th>
            <th className="px-4 py-2 text-right">% of Cost</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => (
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
        </tbody>
      </table>
    </div>
  );
}
