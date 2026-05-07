import React from 'react';
import type { AgentFull, AgentRunPreview } from '../../../../../../shared/types/build';

interface RunsTabProps {
  agentId: string;
  runs: AgentFull['runs'];
}

const STATUS_STYLES: Record<string, string> = {
  completed: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
  running: 'bg-blue-100 text-blue-700',
  cancelled: 'bg-slate-100 text-slate-500',
};

function formatDuration(ms: number | null): string {
  if (ms === null) return '--';
  if (ms < 1000) return '0s';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
}

function formatCostUsd(usd: number): string {
  if (usd === 0) return '$0.00';
  if (usd < 0.01) return '<$0.01';
  return `$${usd.toFixed(2)}`;
}

function RunRow({ run }: { run: AgentRunPreview }) {
  const startedAt = new Date(run.startedAt);
  return (
    <li className="flex items-center gap-3 px-4 py-3 bg-white">
      <div className="flex-1 min-w-0">
        <span className="text-xs text-slate-500 font-mono">{run.id}</span>
        <span className="block text-xs text-slate-400 mt-0.5">
          {startedAt.toLocaleString()}
        </span>
      </div>
      <span className="text-xs text-slate-500">{formatDuration(run.durationMs)}</span>
      <span className="text-xs text-slate-500">{formatCostUsd(run.costUsd)}</span>
      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${STATUS_STYLES[run.status] ?? STATUS_STYLES.cancelled}`}>
        {run.status}
      </span>
    </li>
  );
}

export default function RunsTab({ agentId: _agentId, runs }: RunsTabProps) {
  return (
    <div className="space-y-5 max-w-2xl">
      {/* Summary stats */}
      <div className="flex gap-6">
        <div className="flex-1 p-4 bg-white border border-slate-200 rounded-lg">
          <p className="text-xs text-slate-500 mb-1">Runs (30d)</p>
          <p className="text-2xl font-semibold text-slate-800">{runs.total30d}</p>
        </div>
        <div className="flex-1 p-4 bg-white border border-slate-200 rounded-lg">
          <p className="text-xs text-slate-500 mb-1">Cost (30d)</p>
          <p className="text-2xl font-semibold text-slate-800">{formatCostUsd(runs.cost30d)}</p>
        </div>
      </div>

      {/* Recent runs */}
      <div>
        <h3 className="text-sm font-semibold text-slate-700 mb-2">Recent runs</h3>
        {runs.last5.length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-400 border border-dashed border-slate-200 rounded-lg">
            No runs yet.
          </div>
        ) : (
          <ul className="divide-y divide-slate-100 border border-slate-200 rounded-lg overflow-hidden">
            {runs.last5.map(run => <RunRow key={run.id} run={run} />)}
          </ul>
        )}
      </div>
    </div>
  );
}
