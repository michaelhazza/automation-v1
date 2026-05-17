import type { UsageSummary } from './types';
import { formatCents, formatTokens } from './format';
import { SHIMMER_CLASS } from './constants';

interface SummaryCardsProps {
  summary: UsageSummary | null;
  loading: boolean;
}

export function SummaryCards({ summary, loading }: SummaryCardsProps) {
  const monthlySpent = summary?.monthly?.totalCostCents ?? 0;
  const todaySpent   = summary?.today?.totalCostCents ?? 0;
  const monthLimit   = summary?.limits?.monthlyCostLimitCents ?? null;
  const dailyLimit   = summary?.limits?.dailyCostLimitCents ?? null;

  const cards = [
    {
      label: 'Month Spend',
      value: loading ? null : formatCents(monthlySpent),
      sub: monthLimit ? `of ${formatCents(monthLimit)} limit` : 'no limit set',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
        </svg>
      ),
      iconBg: 'bg-indigo-50', iconColor: 'text-indigo-500',
    },
    {
      label: 'Today',
      value: loading ? null : formatCents(todaySpent),
      sub: dailyLimit ? `of ${formatCents(dailyLimit)} daily limit` : 'no daily limit',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
        </svg>
      ),
      iconBg: 'bg-blue-50', iconColor: 'text-blue-500',
    },
    {
      label: 'LLM Requests',
      value: loading ? null : (summary?.monthly?.requestCount ?? 0).toLocaleString(),
      sub: summary?.monthly?.errorCount ? `${summary.monthly.errorCount} errors` : 'no errors',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
        </svg>
      ),
      iconBg: 'bg-emerald-50', iconColor: 'text-emerald-500',
    },
    {
      label: 'Tokens Used',
      value: loading ? null : formatTokens((summary?.monthly?.tokensIn ?? 0) + (summary?.monthly?.tokensOut ?? 0)),
      sub: loading ? '' : `${formatTokens(summary?.monthly?.tokensIn ?? 0)} in · ${formatTokens(summary?.monthly?.tokensOut ?? 0)} out`,
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
        </svg>
      ),
      iconBg: 'bg-violet-50', iconColor: 'text-violet-500',
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
      {cards.map(card => (
        <div key={card.label} className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${card.iconBg} ${card.iconColor}`}>
              {card.icon}
            </div>
            {card.value === null
              ? <div className={`h-7 w-16 ${SHIMMER_CLASS}`} />
              : <div className="text-[22px] font-extrabold text-slate-900 leading-none">{card.value}</div>
            }
          </div>
          <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">{card.label}</div>
          {card.sub && <div className="text-[11px] text-slate-400 mt-0.5">{card.sub}</div>}
        </div>
      ))}
    </div>
  );
}
