import { formatCents, formatTokens } from '../format';
import { SHIMMER_CLASS } from '../constants';
import type { ModelUsageRow } from '../types';

interface ModelsTabProps {
  rows: ModelUsageRow[];
  loading: boolean;
}

export function ModelsTab({ rows, loading }: ModelsTabProps) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-100 bg-slate-50/50">
            <th className="text-left px-5 py-3 text-[11px] font-bold text-slate-400 uppercase tracking-wider">Provider / Model</th>
            <th className="text-right px-5 py-3 text-[11px] font-bold text-slate-400 uppercase tracking-wider">Requests</th>
            <th className="text-right px-5 py-3 text-[11px] font-bold text-slate-400 uppercase tracking-wider">Tokens In</th>
            <th className="text-right px-5 py-3 text-[11px] font-bold text-slate-400 uppercase tracking-wider">Tokens Out</th>
            <th className="text-right px-5 py-3 text-[11px] font-bold text-slate-400 uppercase tracking-wider">Avg Latency</th>
            <th className="text-right px-5 py-3 text-[11px] font-bold text-slate-400 uppercase tracking-wider">Cost</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {loading ? (
            [...Array(3)].map((_, i) => (
              <tr key={i}>
                {[...Array(6)].map((_, j) => (
                  <td key={j} className="px-5 py-3">
                    <div className={`h-4 rounded ${SHIMMER_CLASS}`} style={{ width: j === 0 ? '160px' : '60px' }} />
                  </td>
                ))}
              </tr>
            ))
          ) : rows.length === 0 ? (
            <tr><td colSpan={6} className="px-5 py-10 text-center text-slate-400 text-sm">No model usage this period</td></tr>
          ) : (
            rows.map((row, i) => (
              <tr key={i} className="hover:bg-slate-50 transition-colors">
                <td className="px-5 py-3">
                  <div className="font-medium text-slate-900">{row.model}</div>
                  <div className="text-[11px] text-slate-400 capitalize">{row.provider}</div>
                </td>
                <td className="px-5 py-3 text-right text-slate-600">{row.requestCount.toLocaleString()}</td>
                <td className="px-5 py-3 text-right text-slate-600">{formatTokens(row.totalTokensIn)}</td>
                <td className="px-5 py-3 text-right text-slate-600">{formatTokens(row.totalTokensOut)}</td>
                <td className="px-5 py-3 text-right text-slate-400 text-[12px]">
                  {row.avgLatencyMs ? `${(row.avgLatencyMs / 1000).toFixed(1)}s` : '—'}
                </td>
                <td className="px-5 py-3 text-right font-semibold text-slate-900">{formatCents(row.totalCostCents)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
