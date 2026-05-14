import type { MilestoneProjection } from '../../../../shared/types/taskProjection';

interface MilestoneCardProps { milestone: MilestoneProjection }

export function MilestoneCard({ milestone }: MilestoneCardProps) {
  return (
    <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-3 mb-2">
      <p className="text-[13px] text-indigo-900 font-medium">{milestone.summary}</p>
      <p className="text-[11px] text-indigo-500 mt-0.5">Agent {milestone.agentId.slice(0, 8)}</p>
    </div>
  );
}
