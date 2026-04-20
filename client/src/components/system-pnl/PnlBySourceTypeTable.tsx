import type { SourceTypeRow } from '../../../../shared/types/systemPnl';
import PnlMarginPill from './PnlMarginPill';
import { fmtCurrency, fmtInt, fmtPct } from './PnlFormat';

interface Props {
  rows: SourceTypeRow[];
}

export default function PnlBySourceTypeTable({ rows }: Props) {
  return (
    <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
      <table className="min-w-full divide-y divide-slate-200">
        <thead className="bg-slate-50">
          <tr className="text-left text-xs font-medium text-slate-500 uppercase tracking-wide">
            <th className="px-4 py-2">Source Type</th>
            <th className="px-4 py-2 text-right">Orgs</th>
            <th className="px-4 py-2 text-right">Requests</th>
            <th className="px-4 py-2 text-right">Revenue</th>
            <th className="px-4 py-2 text-right">Cost</th>
            <th className="px-4 py-2 text-right">Profit</th>
            <th className="px-4 py-2 text-right">Margin</th>
            <th className="px-4 py-2 text-right">% of Cost</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => {
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
        </tbody>
      </table>
    </div>
  );
}
