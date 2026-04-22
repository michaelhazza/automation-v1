import { fmtPct } from './PnlFormat';

// Margin pill — renders either a green/red percentage pill for billable rows
// or an "overhead" badge for rows whose revenue is null (spec §11.5).
//
// The overhead predicate is structural: revenueCents === null, regardless of
// sourceType. A future hybrid workflow (subsidised agent run, billed-back
// system call) stays correct under this rule.

interface Props {
  marginPct:    number | null;
  revenueCents: number | null;
}

export default function PnlMarginPill({ marginPct, revenueCents }: Props) {
  if (revenueCents === null) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-600 border border-slate-200">
        overhead
      </span>
    );
  }
  if (marginPct === null) return <span className="text-slate-400">—</span>;

  const isPositive = marginPct >= 0;
  const tone = isPositive
    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : 'bg-rose-50 text-rose-700 border-rose-200';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${tone}`}>
      {fmtPct(marginPct)}
    </span>
  );
}
