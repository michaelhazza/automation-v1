import { Link } from 'react-router-dom';
import { formatCents } from '../format';
import { SHIMMER_CLASS } from '../constants';
import type { RunCostRow } from '../types';

interface RunsTabProps {
  rows: RunCostRow[];
  loading: boolean;
  subaccountId: string;
}

export function RunsTab({ rows, loading, subaccountId }: RunsTabProps) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
        <span className="text-[13px] font-bold text-slate-700">Last 50 runs by cost</span>
        <span className="text-[12px] text-slate-400">All time</span>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-100 bg-slate-50/50">
            <th className="text-left px-5 py-3 text-[11px] font-bold text-slate-400 uppercase tracking-wider">Run ID</th>
            <th className="text-right px-5 py-3 text-[11px] font-bold text-slate-400 uppercase tracking-wider">Requests</th>
            <th className="text-right px-5 py-3 text-[11px] font-bold text-slate-400 uppercase tracking-wider">Cost</th>
            <th className="text-right px-5 py-3 text-[11px] font-bold text-slate-400 uppercase tracking-wider">Last Updated</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {loading ? (
            [...Array(5)].map((_, i) => (
              <tr key={i}>
                {[...Array(4)].map((_, j) => (
                  <td key={j} className="px-5 py-3">
                    <div className={`h-4 rounded ${SHIMMER_CLASS}`} style={{ width: j === 0 ? '100px' : '70px' }} />
                  </td>
                ))}
              </tr>
            ))
          ) : rows.length === 0 ? (
            <tr><td colSpan={4} className="px-5 py-10 text-center text-slate-400 text-sm">No run cost data yet</td></tr>
          ) : (
            rows.map(run => (
              <tr key={run.entityId} className="hover:bg-slate-50 transition-colors">
                <td className="px-5 py-3">
                  <Link
                    to={`/admin/subaccounts/${subaccountId}/runs/${run.entityId}`}
                    className="font-mono text-[12px] text-indigo-600 hover:text-indigo-700 no-underline"
                  >
                    {run.entityId.substring(0, 8)}
                  </Link>
                </td>
                <td className="px-5 py-3 text-right text-slate-600">{run.requestCount}</td>
                <td className="px-5 py-3 text-right font-semibold text-slate-900">{formatCents(run.totalCostCents)}</td>
                <td className="px-5 py-3 text-right text-slate-400 text-[12px]">
                  {new Date(run.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
