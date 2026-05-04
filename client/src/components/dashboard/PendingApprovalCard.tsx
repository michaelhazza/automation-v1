import type { PulseItem } from '../../hooks/usePulseAttention';

// ── Lane config ────────────────────────────────────────────────────────────────

export interface LaneConfig {
  badgeText: string;
  dotClass: string;
}

export const LANE_CONFIG: Record<string, LaneConfig> = {
  client: { badgeText: 'ClientPulse', dotClass: 'bg-rose-700' },
  major: { badgeText: 'Config change', dotClass: 'bg-amber-500' },
  internal: { badgeText: 'Agent clarification', dotClass: 'bg-slate-500' },
  spend: { badgeText: 'Spend', dotClass: 'bg-emerald-600' },
};

// Exported so the unknown-lane fallback can be unit-tested. Any new lane
// added to the system without a matching entry here falls back to the raw
// lane string + a neutral slate dot, rather than crashing or rendering blank.
export function getLaneConfig(lane: string): LaneConfig {
  return LANE_CONFIG[lane] ?? { badgeText: lane, dotClass: 'bg-slate-300' };
}

// ── Props ──────────────────────────────────────────────────────────────────────

export interface PendingApprovalCardProps {
  item: PulseItem;
  resolveDetailUrl: (detailUrl: string, subaccountId?: string | null) => string | null;
  onAct: (item: PulseItem, intent: 'approve' | 'reject' | 'open') => void;
}

// ── Component ──────────────────────────────────────────────────────────────────

export function PendingApprovalCard({ item, resolveDetailUrl, onAct }: PendingApprovalCardProps) {
  const laneConfig = getLaneConfig(item.lane);

  // Prefer the pre-resolved URL from the server; fall back to the client-side resolver.
  const destination = item.resolvedUrl ?? resolveDetailUrl(item.detailUrl, item.subaccountId);
  const isDisabled = destination === null;
  const disabledTitle = isDisabled ? 'This item cannot be actioned from here.' : undefined;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      {/* Header row: dot + lane badge + subaccount */}
      <div className="flex items-center gap-2 mb-2">
        <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${laneConfig.dotClass}`} />
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-600 uppercase tracking-wide">
          {laneConfig.badgeText}
        </span>
        {item.subaccountId && item.subaccountName && (
          <span className="text-xs text-slate-500 truncate">{item.subaccountName}</span>
        )}
      </div>

      {/* Action description */}
      <p className="text-sm font-semibold text-slate-800 leading-snug mb-1">{item.title}</p>

      {/* Rationale */}
      {item.reasoning && (
        <p className="text-xs text-slate-500 line-clamp-2 mb-3">{item.reasoning}</p>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => onAct(item, 'open')}
          disabled={isDisabled}
          title={disabledTitle}
          className="px-3 py-1.5 text-xs font-medium rounded border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Open in context
        </button>
        <button
          onClick={() => onAct(item, 'approve')}
          disabled={isDisabled}
          title={disabledTitle}
          className="px-3 py-1.5 text-xs font-semibold rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Approve
        </button>
        <button
          onClick={() => onAct(item, 'reject')}
          disabled={isDisabled}
          title={disabledTitle}
          className="px-3 py-1.5 text-xs font-medium rounded border border-red-200 bg-white text-red-600 hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Reject
        </button>
      </div>
    </div>
  );
}
