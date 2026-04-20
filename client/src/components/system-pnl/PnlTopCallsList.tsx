import type { TopCallRow } from '../../../../shared/types/systemPnl';
import { fmtCurrency, fmtInt } from './PnlFormat';

interface Props {
  rows:        TopCallRow[];
  limit:       number;
  onClickRow?: (id: string) => void;
  onViewAll?:  () => void;
}

export default function PnlTopCallsList({ rows, limit, onClickRow, onViewAll }: Props) {
  return (
    <div className="bg-white rounded-lg border border-slate-200 overflow-hidden" id="top-calls-section">
      <div className="px-5 py-3 flex items-baseline justify-between border-b border-slate-100">
        <h3 className="text-sm font-semibold text-slate-900">Top calls by cost</h3>
        {onViewAll && limit <= 10 && (
          <button
            onClick={onViewAll}
            className="text-xs text-indigo-600 hover:text-indigo-700 font-medium"
          >
            View all
          </button>
        )}
      </div>
      <table className="min-w-full">
        <thead className="bg-slate-50">
          <tr className="text-left text-xs font-medium text-slate-500 uppercase tracking-wide">
            <th className="px-4 py-2">Time</th>
            <th className="px-4 py-2">Organisation · Subaccount</th>
            <th className="px-4 py-2">Source</th>
            <th className="px-4 py-2">Provider / Model</th>
            <th className="px-4 py-2 text-right">Tokens</th>
            <th className="px-4 py-2 text-right">Cost</th>
            <th className="px-4 py-2 text-right">Profit</th>
            <th className="px-4 py-2">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => (
            <tr
              key={r.id}
              onClick={onClickRow ? () => onClickRow(r.id) : undefined}
              className={'text-sm ' + (onClickRow ? 'cursor-pointer hover:bg-slate-50' : '')}
            >
              <td className="px-4 py-2 text-slate-500 text-xs font-mono">{r.createdAt.slice(11, 19)}</td>
              <td className="px-4 py-2">
                {r.organisationName ? (
                  <>
                    <div className="font-medium text-slate-900">{r.organisationName}</div>
                    {r.subaccountName && <div className="text-xs text-slate-500">{r.subaccountName}</div>}
                  </>
                ) : (
                  <span className="italic text-slate-500">— system —</span>
                )}
              </td>
              <td className="px-4 py-2 text-slate-600">{r.sourceLabel}</td>
              <td className="px-4 py-2 text-slate-600">
                <span className="capitalize">{r.provider}</span>
                <span className="text-slate-400"> · </span>
                <span className="text-slate-500 text-xs font-mono">{r.model}</span>
              </td>
              <td className="px-4 py-2 text-right tabular-nums text-slate-600">
                {fmtInt(r.tokensIn)} <span className="text-slate-400">/</span> {fmtInt(r.tokensOut)}
              </td>
              <td className="px-4 py-2 text-right tabular-nums">{fmtCurrency(r.costCents)}</td>
              <td className="px-4 py-2 text-right tabular-nums text-slate-600">{fmtCurrency(r.profitCents)}</td>
              <td className="px-4 py-2">
                <StatusPill status={r.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  let tone = 'bg-slate-100 text-slate-700 border-slate-200';
  if (status === 'success') tone = 'bg-emerald-50 text-emerald-700 border-emerald-200';
  else if (status === 'client_disconnected' || status === 'aborted_by_caller') tone = 'bg-amber-50 text-amber-700 border-amber-200';
  else if (status === 'parse_failure') tone = 'bg-rose-50 text-rose-700 border-rose-200';
  else if (status === 'error' || status === 'timeout' || status === 'provider_unavailable') tone = 'bg-rose-50 text-rose-700 border-rose-200';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${tone}`}>
      {status}
    </span>
  );
}
