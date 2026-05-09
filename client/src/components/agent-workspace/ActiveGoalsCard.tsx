interface Props {
  goals: unknown[];
  agentId: string;
}

export default function ActiveGoalsCard({ goals }: Props) {
  if (goals.length === 0) {
    return null;
  }

  return (
    <div className="bg-white rounded-lg border border-slate-100 p-4">
      <h4 className="text-sm font-semibold text-slate-700 mb-3">Active Goals</h4>
      <p className="text-xs text-slate-500">{goals.length} active {goals.length === 1 ? 'goal' : 'goals'}</p>
    </div>
  );
}
