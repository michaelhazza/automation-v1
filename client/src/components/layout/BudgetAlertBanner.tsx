import { Link } from 'react-router-dom';

interface BudgetAlertBannerProps {
  alert: { pct: number; spent: number; limit: number } | null;
  activeClientId: string | null;
  onDismiss(): void;
}

export function BudgetAlertBanner({ alert, activeClientId, onDismiss }: BudgetAlertBannerProps) {
  if (!alert || !activeClientId) return null;

  return (
    <div className={`flex items-center gap-3 px-5 py-2.5 text-[13px] shrink-0 ${
      alert.pct >= 0.95 ? 'bg-red-500' : alert.pct >= 0.9 ? 'bg-red-400' : 'bg-amber-400'
    } text-white`}>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
        <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
      </svg>
      <span className="flex-1 font-medium">
        {alert.pct >= 0.95
          ? `Budget almost exhausted — ${Math.round(alert.pct * 100)}% of monthly limit used ($${(alert.spent / 100).toFixed(2)} of $${(alert.limit / 100).toFixed(2)}). Near limit — figures may update shortly.`
          : `Budget warning — ${Math.round(alert.pct * 100)}% of monthly limit used ($${(alert.spent / 100).toFixed(2)} of $${(alert.limit / 100).toFixed(2)})`
        }
      </span>
      <Link
        to={`/admin/subaccounts/${activeClientId}/usage`}
        className="text-white/90 hover:text-white font-semibold underline"
      >
        View usage →
      </Link>
      <button
        onClick={onDismiss}
        className="bg-transparent border-0 text-white/70 hover:text-white cursor-pointer p-0.5 [font-family:inherit]"
      >
        ✕
      </button>
    </div>
  );
}
