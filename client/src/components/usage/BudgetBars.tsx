import { BudgetBar } from './atoms/BudgetBar';

interface BudgetBarsProps {
  monthlySpent: number;
  todaySpent: number;
  monthLimit: number | null;
  dailyLimit: number | null;
}

export function BudgetBars({ monthlySpent, todaySpent, monthLimit, dailyLimit }: BudgetBarsProps) {
  if (monthLimit === null && dailyLimit === null) return null;
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 mb-6">
      <h3 className="text-[13px] font-bold text-slate-700 mb-0">Budget Limits</h3>
      <BudgetBar spent={monthlySpent} limit={monthLimit} label="Monthly budget" />
      <BudgetBar spent={todaySpent}   limit={dailyLimit} label="Daily budget" />
    </div>
  );
}
