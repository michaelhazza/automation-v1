import type { DailyTrendRow } from '../../../../shared/types/systemPnl';
import { fmtCurrency } from './PnlFormat';

// Minimal inline-SVG trend chart — revenue + cost + overhead as three lines.
// Net profit is derived client-side as (revenue - cost) per spec §19.5a so
// the wire format stays narrow.

interface Props {
  rows: DailyTrendRow[];
  width?:  number;
  height?: number;
}

export default function PnlTrendChart({ rows, width = 720, height = 180 }: Props) {
  if (rows.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-slate-200 px-5 py-10 text-center text-sm text-slate-500">
        No activity in the selected window.
      </div>
    );
  }

  const maxCents = Math.max(
    ...rows.flatMap((r) => [r.revenueCents, r.costCents, r.overheadCents]),
    1,
  );
  const stepX = rows.length > 1 ? width / (rows.length - 1) : width;
  const toY = (cents: number) => height - (cents / maxCents) * (height - 20) - 10;

  const seriesPoints = (pick: (r: DailyTrendRow) => number) =>
    rows.map((r, i) => `${(i * stepX).toFixed(1)},${toY(pick(r)).toFixed(1)}`).join(' ');

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-5">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-sm font-semibold text-slate-900">30-day financial trend</h3>
        <div className="text-xs text-slate-500">peak {fmtCurrency(maxCents)}</div>
      </div>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="w-full h-auto">
        <polyline
          points={seriesPoints((r) => r.revenueCents)}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          className="text-emerald-500"
        />
        <polyline
          points={seriesPoints((r) => r.costCents)}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          className="text-rose-400"
        />
        <polyline
          points={seriesPoints((r) => r.overheadCents)}
          fill="none"
          stroke="currentColor"
          strokeWidth={1}
          strokeDasharray="3 3"
          className="text-indigo-400"
        />
      </svg>
      <div className="mt-3 flex items-center gap-4 text-xs">
        <span className="inline-flex items-center gap-1 text-emerald-600">
          <span className="inline-block w-3 h-0.5 bg-emerald-500" /> Revenue
        </span>
        <span className="inline-flex items-center gap-1 text-rose-600">
          <span className="inline-block w-3 h-0.5 bg-rose-400" /> Cost
        </span>
        <span className="inline-flex items-center gap-1 text-indigo-600">
          <span className="inline-block w-3 h-0.5 border-t border-dashed border-indigo-400" /> Platform overhead
        </span>
      </div>
    </div>
  );
}
