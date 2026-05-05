/**
 * SessionLogCardList.tsx — Brain Tree OS adoption P3.
 *
 * Compact, scan-friendly card list of agent runs. Each card shows the
 * session number, status pill, duration, relative timestamp, the next
 * recommended action (or summary fallback), and impact counters.
 *
 * Sourced from `agentActivityService.listRuns()` via the existing routes.
 *
 * Spec: docs/brain-tree-os-adoption-spec.md §P3
 */

import { StatusBadge } from '../lib/statusBadge';
import { formatDuration } from '../lib/formatDuration';
import { relativeTime } from '../lib/relativeTime';
import { isTerminalRunStatus } from '../lib/runStatus';
import { RunCostPanel } from './run-cost/RunCostPanel';

interface HandoffShape {
  version: 1;
  nextRecommendedAction: string | null;
}

export interface SessionLogRun {
  id: string;
  status: string;
  summary: string | null;
  handoffJson: HandoffShape | null;
  durationMs: number | null;
  totalToolCalls: number;
  tasksCreated: number;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

interface Props {
  runs: SessionLogRun[];
  /** Number to assign to the first (newest) run in the list. Defaults to runs.length. */
  startNumber?: number;
  onSelectRun?: (runId: string) => void;
  emptyMessage?: string;
}

function firstSentence(text: string | null): string | null {
  if (!text) return null;
  const match = text.match(/^[^.!?]+[.!?]/);
  return (match ? match[0] : text).trim().slice(0, 200);
}

export default function SessionLogCardList({ runs, startNumber, onSelectRun, emptyMessage }: Props) {
  if (runs.length === 0) {
    return (
      <div className="bg-white border border-dashed border-slate-200 rounded-xl p-6 text-center">
        <div className="text-[13px] text-slate-400">{emptyMessage ?? 'No runs yet.'}</div>
      </div>
    );
  }

  const baseNumber = startNumber ?? runs.length;

  return (
    <div className="flex flex-col gap-2">
      {runs.map((run, idx) => {
        const sessionNumber = baseNumber - idx;
        const next = run.handoffJson?.nextRecommendedAction ?? firstSentence(run.summary) ?? 'No summary';
        const ts = run.completedAt ?? run.createdAt;
        const showCounters = run.tasksCreated > 0 || run.totalToolCalls > 0;
        const clickable = !!onSelectRun;

        return (
          <div
            key={run.id}
            className={`bg-white border border-slate-200 rounded-xl transition-colors ${
              clickable ? 'hover:border-indigo-300 hover:bg-indigo-50/30' : ''
            }`}
          >
            <button
              type="button"
              disabled={!clickable}
              onClick={() => clickable && onSelectRun!(run.id)}
              className={`w-full text-left p-3.5 bg-transparent border-0 [font-family:inherit] ${
                clickable ? 'cursor-pointer' : 'cursor-default'
              }`}
            >
              <div className="flex items-center gap-2.5 mb-1.5 flex-wrap">
                <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-slate-100 text-[11px] font-bold text-slate-600">
                  #{sessionNumber}
                </span>
                <StatusBadge status={run.status} />
                <span className="text-[12px] text-slate-500 font-medium">{formatDuration(run.durationMs)}</span>
                <span className="text-[12px] text-slate-400">{relativeTime(ts)}</span>
              </div>

              <div className="text-[13.5px] text-slate-700 leading-snug line-clamp-2">
                {run.handoffJson?.nextRecommendedAction && (
                  <span className="text-indigo-500 font-semibold">Next: </span>
                )}
                {next}
              </div>

              {showCounters && (
                <div className="mt-1.5 text-[11px] text-slate-400 flex gap-2">
                  {run.tasksCreated > 0 && <span>{run.tasksCreated} tasks</span>}
                  {run.totalToolCalls > 0 && <span>· {run.totalToolCalls} tool calls</span>}
                </div>
              )}
            </button>

            {/* Hermes Tier 1 Phase A — per-run cost line. */}
            <div className="px-3.5 pb-3">
              <RunCostPanel
                runId={run.id}
                runIsTerminal={isTerminalRunStatus(run.status)}
                compact
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
