import { formatCents } from '../format';

export function BudgetBar({ spent, limit, label }: { spent: number; limit: number | null; label: string }) {
  if (!limit) return null;
  const pct = Math.min(spent / limit, 1);
  const isWarning = pct > 0.75;
  const isDanger = pct > 0.9;
  return (
    <div className="mt-3">
      <div className="flex justify-between text-[12px] mb-1">
        <span className="text-slate-500">{label}</span>
        <span className={`font-semibold ${isDanger ? 'text-red-600' : isWarning ? 'text-amber-600' : 'text-slate-700'}`}>
          {formatCents(spent)} / {formatCents(limit)}
          <span className="ml-1.5 text-slate-400 font-normal">({Math.round(pct * 100)}%)</span>
        </span>
      </div>
      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            isDanger ? 'bg-red-400' : isWarning ? 'bg-amber-400' : 'bg-indigo-400'
          }`}
          style={{ width: `${pct * 100}%` }}
        />
      </div>
    </div>
  );
}
