export const ANOMALY_THRESHOLDS = {
  fallback:   { warn: 0.05, danger: 0.15 },
  escalation: { warn: 0.10, danger: 0.25 },
};

export const TIER_COLORS: Record<string, string> = { frontier: 'bg-indigo-100 text-indigo-700', economy: 'bg-emerald-100 text-emerald-700' };
export const REASON_COLORS: Record<string, string> = { forced: 'bg-purple-100 text-purple-700', ceiling: 'bg-blue-100 text-blue-700', economy: 'bg-emerald-100 text-emerald-700', fallback: 'bg-amber-100 text-amber-700' };
export const STATUS_COLORS: Record<string, string> = { success: 'bg-emerald-100 text-emerald-700', error: 'bg-red-100 text-red-700', timeout: 'bg-amber-100 text-amber-700', budget_blocked: 'bg-orange-100 text-orange-700', rate_limited: 'bg-yellow-100 text-yellow-700', provider_unavailable: 'bg-slate-100 text-slate-700', provider_not_configured: 'bg-slate-100 text-slate-600', partial: 'bg-blue-100 text-blue-700' };

export const SHIMMER_CLASS = 'bg-[linear-gradient(90deg,#f1f5f9_25%,#e2e8f0_50%,#f1f5f9_75%)] bg-[length:400%_100%] animate-[shimmer_1.4s_ease-in-out_infinite] rounded-lg';
