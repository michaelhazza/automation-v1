import type { TaskProjection } from '../../../../shared/types/taskProjection';
import { classifyTask } from './openTaskViewPure';

const SHOW_CONFIDENCE_CHIP = (import.meta as unknown as Record<string, Record<string, string>>).env?.VITE_SHOW_CONFIDENCE_CHIP === 'true';

interface PlanTabProps { projection: TaskProjection }

export function PlanTab({ projection }: PlanTabProps) {
  const classification = classifyTask(projection);

  if (projection.steps.length === 0) {
    return (
      <div className="p-4 text-[13px] text-slate-400">
        The plan will appear once the workflow begins.
      </div>
    );
  }

  return (
    <div className="p-4 space-y-1">
      <p className="text-[11px] text-slate-400 mb-3 uppercase tracking-wide">
        {classification.replace('_', ' ')}
      </p>
      {projection.steps.map((step, i) => {
        const statusDot =
          (
            {
              pending: 'bg-slate-300',
              running: 'bg-green-400 animate-pulse',
              completed: 'bg-green-500',
              failed: 'bg-red-400',
              awaiting_approval: 'bg-amber-400',
              awaiting_ask: 'bg-amber-400',
            } as Record<string, string>
          )[step.status] ?? 'bg-slate-300';

        return (
          <div key={step.stepId} className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-slate-50">
            <span className="text-[11px] text-slate-400 w-4 text-right">{i + 1}</span>
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${statusDot}`} />
            <span className="text-[13px] text-slate-700 truncate">{step.stepType}</span>
            {SHOW_CONFIDENCE_CHIP && step.params?.seenConfidence != null && (
              <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">
                {String(step.params.seenConfidence)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
