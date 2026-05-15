import { formatCents, formatTokens } from '../format';
import { SHIMMER_CLASS } from '../constants';
import type { AgentUsageRow } from '../types';

interface AgentsTabProps {
  rows: AgentUsageRow[];
  loading: boolean;
}

export function AgentsTab({ rows, loading }: AgentsTabProps) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-100 bg-slate-50/50">
            <th className="text-left px-5 py-3 text-[11px] font-bold text-slate-400 uppercase tracking-wider">Agent</th>
            <th className="text-right px-5 py-3 text-[11px] font-bold text-slate-400 uppercase tracking-wider">Requests</th>
            <th className="text-right px-5 py-3 text-[11px] font-bold text-slate-400 uppercase tracking-wider">Tokens In</th>
            <th className="text-right px-5 py-3 text-[11px] font-bold text-slate-400 uppercase tracking-wider">Tokens Out</th>
            <th className="text-right px-5 py-3 text-[11px] font-bold text-slate-400 uppercase tracking-wider">Cost</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {loading ? (
            [...Array(4)].map((_, i) => (
              <tr key={i}>
                {[...Array(5)].map((_, j) => (
                  <td key={j} className="px-5 py-3">
                    <div className={`h-4 rounded ${SHIMMER_CLASS}`} style={{ width: j === 0 ? '120px' : '60px' }} />
                  </td>
                ))}
              </tr>
            ))
          ) : rows.length === 0 ? (
            <tr><td colSpan={5} className="px-5 py-10 text-center text-slate-400 text-sm">No agent activity this period</td></tr>
          ) : (
            rows.map((row, i) => (
              <tr key={i} className="hover:bg-slate-50 transition-colors">
                <td className="px-5 py-3 font-medium text-slate-900">{row.agentName ?? '—'}</td>
                <td className="px-5 py-3 text-right text-slate-600">{row.requestCount.toLocaleString()}</td>
                <td className="px-5 py-3 text-right text-slate-600">{formatTokens(row.totalTokensIn)}</td>
                <td className="px-5 py-3 text-right text-slate-600">{formatTokens(row.totalTokensOut)}</td>
                <td className="px-5 py-3 text-right font-semibold text-slate-900">{formatCents(row.totalCostCents)}</td>
              </tr>
            ))
          )}
        </tbody>
        {rows.length > 0 && !loading && (
          <tfoot>
            <tr className="border-t border-slate-200 bg-slate-50/50">
              <td className="px-5 py-3 font-bold text-slate-700">Total</td>
              <td className="px-5 py-3 text-right font-bold text-slate-700">
                {rows.reduce((s, r) => s + r.requestCount, 0).toLocaleString()}
              </td>
              <td className="px-5 py-3 text-right font-bold text-slate-700">
                {formatTokens(rows.reduce((s, r) => s + r.totalTokensIn, 0))}
              </td>
              <td className="px-5 py-3 text-right font-bold text-slate-700">
                {formatTokens(rows.reduce((s, r) => s + r.totalTokensOut, 0))}
              </td>
              <td className="px-5 py-3 text-right font-bold text-slate-900">
                {formatCents(rows.reduce((s, r) => s + r.totalCostCents, 0))}
              </td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
