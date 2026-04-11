/**
 * ExecutionPlanPane.tsx — Brain Tree OS adoption P2.
 *
 * Right-hand panel on RunTraceViewerPage. Shows the run's plan (or tool call
 * timeline as fallback) as a scannable list with status pills, a progress
 * bar, and click-through to expand the matching tool call in the main pane.
 *
 * Spec: docs/brain-tree-os-adoption-spec.md §P2
 */

import { deriveView, type PlanItemView } from '../lib/runPlanView';

interface RunInputShape {
  status: string;
  planJson: { actions?: Array<{ tool: string; reason: string }> } | null;
  toolCallsLog: Array<{ tool?: string; name?: string; output?: unknown; durationMs?: number }> | null;
}

interface Props {
  run: RunInputShape;
  onSelectToolCall?: (toolCallIndex: number) => void;
}

const STATUS_PILL: Record<PlanItemView['status'], string> = {
  pending:     'bg-slate-100 text-slate-500 border-slate-200',
  in_progress: 'bg-blue-50 text-blue-700 border-blue-200',
  complete:    'bg-emerald-50 text-emerald-700 border-emerald-200',
  skipped:     'bg-amber-50 text-amber-700 border-amber-200',
};

const STATUS_LABEL: Record<PlanItemView['status'], string> = {
  pending:     'Pending',
  in_progress: 'In progress',
  complete:    'Complete',
  skipped:     'Skipped',
};

export default function ExecutionPlanPane({ run, onSelectToolCall }: Props) {
  const view = deriveView(run);

  if (view.source === 'empty') {
    return (
      <div className="w-[320px] shrink-0 sticky top-4 self-start hidden xl:block">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-[12px] font-semibold text-slate-500 uppercase tracking-wider mb-2">Execution Plan</div>
          <div className="text-[13px] text-slate-400">No plan recorded and no tool calls.</div>
        </div>
      </div>
    );
  }

  const isFallback = view.source === 'tool_calls_log';

  return (
    <div className="w-[320px] shrink-0 sticky top-4 self-start hidden xl:block">
      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <div className="flex items-baseline justify-between mb-2">
          <div className="text-[12px] font-semibold text-slate-500 uppercase tracking-wider">
            {isFallback ? 'Tool Call Timeline' : 'Execution Plan'}
          </div>
          <div className="text-[12px] font-semibold text-slate-700">
            {view.completedCount}/{view.totalCount}
          </div>
        </div>

        {/* Progress bar */}
        <div className="bg-slate-100 rounded-full h-1.5 overflow-hidden mb-3">
          <div
            className="h-full rounded-full bg-emerald-500 transition-all"
            style={{ width: `${view.progressPct}%` }}
          />
        </div>

        {isFallback && (
          <div className="text-[11px] text-slate-400 italic mb-3">
            No plan recorded — showing tool calls in encounter order.
          </div>
        )}

        {/* Phase groups */}
        <div className="flex flex-col gap-3">
          {view.phases.map((phase, phaseIdx) => (
            <div key={phaseIdx}>
              {phase.phase && (
                <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                  {phase.phase}
                </div>
              )}
              <div className="flex flex-col gap-1.5">
                {phase.items.map((item) => {
                  const clickable = item.evidenceToolCallIndex != null && !!onSelectToolCall;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      disabled={!clickable}
                      onClick={() => {
                        if (clickable && item.evidenceToolCallIndex != null) {
                          onSelectToolCall!(item.evidenceToolCallIndex);
                        }
                      }}
                      className={`text-left p-2 rounded-lg border transition-colors ${
                        clickable
                          ? 'border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/30 cursor-pointer'
                          : 'border-slate-100 cursor-default'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2 mb-0.5">
                        <span className="text-[12.5px] font-semibold text-slate-800 line-clamp-2 flex-1">
                          {item.label}
                        </span>
                        <span
                          className={`shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${STATUS_PILL[item.status]}`}
                        >
                          {STATUS_LABEL[item.status]}
                        </span>
                      </div>
                      {item.tool && item.tool !== item.label && (
                        <div className="text-[10.5px] text-slate-400 font-mono truncate">{item.tool}</div>
                      )}
                      {item.durationMs != null && (
                        <div className="text-[10px] text-slate-400 mt-0.5">
                          {item.durationMs < 1000 ? `${item.durationMs}ms` : `${(item.durationMs / 1000).toFixed(1)}s`}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
