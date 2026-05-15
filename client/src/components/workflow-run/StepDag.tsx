import React from 'react';
import type { StepRun, StepDef } from './types';
import { STATUS_DOT_COLORS, SIDE_EFFECT_COLORS } from './types';

interface StepDagProps {
  stepRuns: StepRun[];
  stepDefById: Map<string, StepDef>;
  selectedStepRunId: string | null;
  onSelectStepRun(stepRunId: string): void;
}

export default function StepDag({
  stepRuns,
  stepDefById,
  selectedStepRunId,
  onSelectStepRun,
}: StepDagProps) {
  return (
    <aside className="border-r border-slate-200 bg-white overflow-y-auto">
      <div className="px-3 pt-4 pb-2 text-[11px] uppercase tracking-wider text-slate-400 font-medium">
        Steps
      </div>
      <ul className="pb-4">
        {stepRuns.map((sr) => {
          const def = stepDefById.get(sr.stepId);
          const isSelected = sr.id === selectedStepRunId;
          const dot = STATUS_DOT_COLORS[sr.status] ?? STATUS_DOT_COLORS.pending;
          return (
            <li key={sr.id}>
              <button
                type="button"
                onClick={() => onSelectStepRun(sr.id)}
                className={`w-full flex items-start gap-3 px-4 py-2.5 text-left hover:bg-slate-50 border-l-2 ${
                  isSelected
                    ? 'border-indigo-500 bg-indigo-50/60'
                    : 'border-transparent'
                }`}
              >
                <span
                  className={`mt-1 inline-block h-2.5 w-2.5 rounded-full flex-shrink-0 ${dot}`}
                  aria-hidden="true"
                />
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-medium text-slate-800 truncate">
                    {def?.name ?? sr.stepId}
                  </span>
                  <span className="flex items-center gap-2 mt-0.5 text-[11px] text-slate-500">
                    <span>{sr.stepType}</span>
                    <span
                      className={`${
                        SIDE_EFFECT_COLORS[sr.sideEffectType] ?? ''
                      } uppercase tracking-wide`}
                    >
                      {sr.sideEffectType}
                    </span>
                  </span>
                  <span className="block text-[11px] text-slate-400 mt-0.5">
                    {sr.status}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
        {stepRuns.length === 0 && (
          <li className="px-4 py-3 text-xs text-slate-500">
            No steps dispatched yet.
          </li>
        )}
      </ul>
    </aside>
  );
}
