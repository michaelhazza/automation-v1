// client/src/pages/govern/components/SpendTrendChart.tsx
// Vanilla SVG multi-line chart for 6-month spend trends.
// Lines become dashed red when capUsage > 100 (over cap). Spec §4.5.

import type { SpendTrends } from '../../../../../shared/types/govern.js';

const PALETTE = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444'];
const OVER_COLOR = '#ef4444';

interface Props {
  trends: SpendTrends;
}

export function SpendTrendChart({ trends }: Props) {
  const { workspaces, monthLabels } = trends;
  if (workspaces.length === 0) {
    return (
      <svg viewBox="0 0 320 160" className="w-full h-auto" role="img" aria-label="Spend trend chart">
        <text x={160} y={80} textAnchor="middle" fontSize="11" fill="#94a3b8">No data</text>
      </svg>
    );
  }

  const allSpend = workspaces.flatMap((w) => w.spend6mo);
  const maxSpend = Math.max(...allSpend, 1);
  const W = 280, H = 120, PADL = 30, PADT = 10;
  const xStep = W / Math.max(monthLabels.length - 1, 1);

  return (
    <svg viewBox={`0 0 ${W + PADL + 20} ${H + PADT + 30}`} className="w-full h-auto" role="img" aria-label="Spend trend chart">
      {monthLabels.map((label, i) => (
        <text key={label} x={PADL + i * xStep} y={H + PADT + 20} fontSize="9" textAnchor="middle" fill="#94a3b8">
          {label}
        </text>
      ))}
      {workspaces.map((w, wi) => {
        const color = PALETTE[wi % PALETTE.length];
        const points = w.spend6mo.map((s, i) => [
          PADL + i * xStep,
          PADT + H - (s / maxSpend) * H,
        ] as [number, number]);

        const segments: Array<{ points: [number, number][]; over: boolean }> = [];
        let current: { points: [number, number][]; over: boolean } | null = null;

        for (let i = 0; i < points.length; i++) {
          const over = (w.capUsage6mo[i] ?? 0) > 100;
          if (!current || current.over !== over) {
            if (current) segments.push(current);
            current = { points: [points[i]], over };
          } else {
            current.points.push(points[i]);
          }
        }
        if (current) segments.push(current);

        return (
          <g key={w.id}>
            {segments.map((seg, si) => {
              const d = seg.points
                .map((p, k) => `${k === 0 ? 'M' : 'L'} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`)
                .join(' ');
              return (
                <path
                  key={si}
                  d={d}
                  fill="none"
                  stroke={seg.over ? OVER_COLOR : color}
                  strokeWidth={2}
                  strokeDasharray={seg.over ? '5 3' : undefined}
                />
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}
