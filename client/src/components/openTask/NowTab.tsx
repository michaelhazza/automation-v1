import type { TaskProjection } from '../../../../shared/types/taskProjection';

interface NowTabProps { projection: TaskProjection }

export function NowTab({ projection }: NowTabProps) {
  const activeSteps = projection.steps.filter(
    s => s.status === 'running' || s.status === 'awaiting_approval'
  );

  if (activeSteps.length === 0) {
    return <div className="p-4 text-[13px] text-slate-400">No active steps.</div>;
  }

  return (
    <div className="p-4 space-y-2">
      {activeSteps.map(step => (
        <div key={step.stepId} className="flex items-center gap-2 p-2 rounded-lg bg-slate-50 border border-slate-200">
          <span className={`w-2 h-2 rounded-full ${step.status === 'running' ? 'bg-green-400 animate-pulse' : 'bg-amber-400'}`} />
          <span className="text-[13px] text-slate-700 font-medium truncate">{step.stepType}</span>
          <span className="text-[11px] text-slate-400 truncate">{step.stepId}</span>
        </div>
      ))}
    </div>
  );
}
