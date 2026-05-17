import { formatCents, monthLabel } from '../format';
import type { UsageSummary } from '../types';

interface OverviewTabProps {
  month: string;
  summary: UsageSummary | null;
}

export function OverviewTab({ month, summary }: OverviewTabProps) {
  const monthlySpent = summary?.monthly?.totalCostCents ?? 0;
  const todaySpent   = summary?.today?.totalCostCents ?? 0;

  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100">
          <h3 className="text-[14px] font-bold text-slate-900 m-0">Invoice Summary — {monthLabel(month)}</h3>
        </div>
        <div className="p-5 text-sm text-slate-500">
          <div className="flex justify-between py-2 border-b border-slate-50">
            <span>Total LLM cost</span>
            <span className="font-semibold text-slate-900">{formatCents(monthlySpent)}</span>
          </div>
          <div className="flex justify-between py-2 border-b border-slate-50">
            <span>Requests</span>
            <span className="font-semibold text-slate-900">{(summary?.monthly?.requestCount ?? 0).toLocaleString()}</span>
          </div>
          <div className="flex justify-between py-2 border-b border-slate-50">
            <span>Errors</span>
            <span className={`font-semibold ${(summary?.monthly?.errorCount ?? 0) > 0 ? 'text-red-600' : 'text-slate-900'}`}>
              {summary?.monthly?.errorCount ?? 0}
            </span>
          </div>
          <div className="flex justify-between py-2">
            <span>Today</span>
            <span className="font-semibold text-slate-900">{formatCents(todaySpent)}</span>
          </div>
        </div>
      </div>

      {(summary?.limits?.maxCostPerRunCents) && (
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <h3 className="text-[14px] font-bold text-slate-900 m-0 mb-3">Run Limits</h3>
          <div className="flex justify-between text-sm py-2">
            <span className="text-slate-500">Max cost per run</span>
            <span className="font-semibold text-slate-900">{formatCents(summary.limits.maxCostPerRunCents)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
