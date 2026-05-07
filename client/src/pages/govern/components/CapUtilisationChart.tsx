// client/src/pages/govern/components/CapUtilisationChart.tsx
// Vanilla SVG cap utilisation bars per workspace.
// Over 100% = red. Spec §4.5.

import type { SpendTrends } from '../../../../../shared/types/govern.js';

interface Props {
  trends: SpendTrends;
  /** Show utilisation for this month index (0-5, 5 = current). Default 5. */
  monthIndex?: number;
}

export function CapUtilisationChart({ trends, monthIndex = 5 }: Props) {
  const rows = trends.workspaces
    .map((w) => ({ id: w.id, name: w.name, pct: w.capUsage6mo[monthIndex] }))
    .filter((r): r is { id: string; name: string; pct: number } => r.pct !== null);

  if (rows.length === 0) {
    return (
      <svg viewBox="0 0 320 80" className="w-full h-auto" role="img" aria-label="Cap utilisation chart">
        <text x={160} y={40} textAnchor="middle" fontSize="11" fill="#94a3b8">No cap data</text>
      </svg>
    );
  }

  return (
    <svg
      viewBox={`0 0 320 ${30 + rows.length * 28}`}
      className="w-full h-auto"
      role="img"
      aria-label="Cap utilisation chart"
    >
      {rows.map((r, i) => {
        const barW = Math.min(r.pct, 200);
        const over = r.pct > 100;
        const y = 10 + i * 28;
        return (
          <g key={r.id}>
            <text x={4} y={y + 13} fontSize="10" fill="#64748b">
              {r.name.length > 14 ? r.name.slice(0, 13) + '…' : r.name}
            </text>
            <rect x={110} y={y + 2} width={180} height={14} fill="#f1f5f9" rx={2} />
            <rect x={110} y={y + 2} width={Math.max(barW * 0.9, 2)} height={14} fill={over ? '#ef4444' : '#6366f1'} rx={2} />
            <text x={300} y={y + 13} fontSize="9" textAnchor="end" fill={over ? '#ef4444' : '#64748b'}>
              {r.pct.toFixed(0)}%
            </text>
          </g>
        );
      })}
    </svg>
  );
}
