import { monthLabel } from './format';

const ChevLeft = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="15 18 9 12 15 6" />
  </svg>
);
const ChevRight = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

interface MonthNavigatorProps {
  month: string;
  thisMonth: string;
  onPrev(): void;
  onNext(): void;
}

export function MonthNavigator({ month, thisMonth, onPrev, onNext }: MonthNavigatorProps) {
  return (
    <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-3 py-2">
      <button
        onClick={onPrev}
        className="text-slate-400 hover:text-slate-700 bg-transparent border-0 cursor-pointer flex items-center p-0.5"
      >
        <ChevLeft />
      </button>
      <span className="text-[13px] font-semibold text-slate-700 min-w-[130px] text-center">
        {monthLabel(month)}
      </span>
      <button
        onClick={onNext}
        disabled={month >= thisMonth}
        className="text-slate-400 hover:text-slate-700 bg-transparent border-0 cursor-pointer flex items-center p-0.5 disabled:opacity-30 disabled:cursor-not-allowed"
      >
        <ChevRight />
      </button>
    </div>
  );
}
