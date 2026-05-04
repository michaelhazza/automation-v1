import type { BlockReasonCount } from './TopBlockReasonsAggregationPure.js';

interface TopBlockReasonsPanelProps {
  reasons: BlockReasonCount[];
  windowDays?: number;
}

/**
 * Shows top block/deny reasons for the last N days, sorted by count desc.
 * Inline state — no separate dashboard panel required.
 */
export default function TopBlockReasonsPanel({ reasons, windowDays = 7 }: TopBlockReasonsPanelProps) {
  if (reasons.length === 0) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
        <p className="text-[12.5px] font-semibold text-slate-700 mb-1">
          Top block reasons{' '}
          <span className="text-slate-400 font-normal">last {windowDays}d</span>
        </p>
        <p className="text-[12px] text-slate-400">No blocked or denied charges in this window.</p>
      </div>
    );
  }

  const max = reasons[0].count;

  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
      <p className="text-[12.5px] font-semibold text-slate-700 mb-3">
        Top block reasons{' '}
        <span className="text-slate-400 font-normal">last {windowDays}d</span>
      </p>
      <div className="space-y-2">
        {reasons.map(({ reason, count }) => (
          <div key={reason} className="flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="text-[12px] text-slate-700 font-medium truncate mb-1">
                {reason.replace(/_/g, ' ')}
              </div>
              <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-red-400 rounded-full transition-all duration-300"
                  style={{ width: `${Math.round((count / max) * 100)}%` }}
                />
              </div>
            </div>
            <span className="text-[12px] font-semibold text-slate-600 tabular-nums w-8 text-right shrink-0">
              {count}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
