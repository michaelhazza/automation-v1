import { useState } from 'react';
import { useAgentWorkingTime } from '../../hooks/useAgentWorkingTime';

type Range = 'today' | 'week' | 'month' | 'quarter';

const RANGE_LABELS: Record<Range, string> = {
  today: 'Today',
  week: 'Week',
  month: 'Month',
  quarter: 'Quarter',
};

const RANGES: Range[] = ['today', 'week', 'month', 'quarter'];

function formatSeconds(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const remainMins = mins % 60;
  if (remainMins === 0) return `${hrs}h`;
  return `${hrs}h ${remainMins}m`;
}

interface Props {
  agentId: string;
}

export default function WorkingTimeChart({ agentId }: Props) {
  const [range, setRange] = useState<Range>('week');

  const {
    buckets,
    captionTotalSeconds,
    captionRunsCount,
    captionSuccessRate,
    captionAverageRunDurationSeconds,
    isLoading,
    isError,
  } = useAgentWorkingTime(agentId, range);

  const maxSeconds = Math.max(...buckets.map(b => b.seconds), 1);

  return (
    <div className="bg-white rounded-lg border border-slate-100 p-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold text-slate-700">Working Time</h4>
        <div className="flex gap-1">
          {RANGES.map(r => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                range === r
                  ? 'bg-slate-800 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {RANGE_LABELS[r]}
            </button>
          ))}
        </div>
      </div>

      {isLoading && (
        <p className="text-xs text-slate-400 text-center py-4">Loading...</p>
      )}

      {isError && (
        <p className="text-xs text-red-500 text-center py-4">Failed to load working time.</p>
      )}

      {!isLoading && !isError && buckets.length === 0 && (
        <p className="text-xs text-slate-400 text-center py-4">No working time recorded for this period.</p>
      )}

      {!isLoading && !isError && buckets.length > 0 && (
        <>
          <div className="flex items-end gap-1 h-16 mb-2">
            {buckets.map(bucket => {
              const heightPct = Math.max((bucket.seconds / maxSeconds) * 100, bucket.seconds > 0 ? 4 : 0);
              return (
                <div
                  key={bucket.date}
                  className="flex-1 flex flex-col items-center justify-end group relative"
                >
                  <div
                    className="w-full bg-slate-200 rounded-t group-hover:bg-slate-400 transition-colors"
                    style={{ height: `${heightPct}%` }}
                    title={`${bucket.date}: ${formatSeconds(bucket.seconds)}`}
                  />
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 mb-2">
            <span className="text-xs text-slate-600">
              <span className="font-medium">Total:</span> {formatSeconds(captionTotalSeconds)}
            </span>
            <span className="text-xs text-slate-600">
              <span className="font-medium">Runs:</span> {captionRunsCount}
            </span>
            <span className="text-xs text-slate-600">
              <span className="font-medium">Success:</span> {Math.round(captionSuccessRate * 100)}%
            </span>
            <span className="text-xs text-slate-600">
              <span className="font-medium">Avg run:</span> {formatSeconds(captionAverageRunDurationSeconds)}
            </span>
          </div>
        </>
      )}

      <p className="text-xs text-slate-400 mt-2">
        You're billed for this time only, not while the agent is idle.
      </p>
    </div>
  );
}
