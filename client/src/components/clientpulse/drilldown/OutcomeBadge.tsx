// Mirror of server/services/drilldownOutcomeBadgePure.ts OutcomeBadge shape.
export type OutcomeBadge =
  | { kind: 'band_improved'; fromBand: string; toBand: string }
  | { kind: 'band_worsened'; fromBand: string; toBand: string }
  | { kind: 'score_improved'; delta: number }
  | { kind: 'score_worsened'; delta: number }
  | { kind: 'neutral' }
  | { kind: 'pending'; reason: 'no_snapshot' | 'window_open' | 'operator_alert_no_signal' }
  | { kind: 'failed' };

export default function OutcomeBadge({ badge }: { badge: OutcomeBadge }) {
  switch (badge.kind) {
    case 'band_improved':
      return (
        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-emerald-100 text-emerald-700">
          {badge.fromBand} → {badge.toBand}
        </span>
      );
    case 'band_worsened':
      return (
        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-red-100 text-red-700">
          {badge.fromBand} → {badge.toBand}
        </span>
      );
    case 'score_improved':
      return (
        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700">
          +{badge.delta}
        </span>
      );
    case 'score_worsened':
      return (
        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-50 text-red-700">
          {badge.delta}
        </span>
      );
    case 'neutral':
      return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600">no change</span>;
    case 'pending':
      return (
        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700">
          {badge.reason === 'window_open' ? 'measuring…' : badge.reason === 'operator_alert_no_signal' ? 'no signal' : 'pending'}
        </span>
      );
    case 'failed':
      return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-500 line-through">failed</span>;
  }
}
