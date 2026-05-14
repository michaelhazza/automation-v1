// client/src/pages/govern/components/SpendBarChart.tsx
// Spec §2 non-goal 5: no chart library.

interface BarRow { id: string; name: string; usd: number; }

export function SpendBarChart({ rows }: { rows: BarRow[] }) {
  const max = rows.length > 0 ? Math.max(...rows.map((r) => r.usd)) : 1;
  const fmt = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

  return (
    <svg
      viewBox="0 0 340 180"
      className="w-full h-auto"
      role="img"
      aria-label="Top spenders bar chart"
    >
      {rows.slice(0, 5).map((r, i) => {
        const barW = max > 0 ? (r.usd / max) * 180 : 0;
        const y = 10 + i * 32;
        return (
          <g key={r.id}>
            <text x={4} y={y + 14} fontSize="10" fill="#64748b">
              {r.name.length > 16 ? r.name.slice(0, 15) + '…' : r.name}
            </text>
            <rect x={116} y={y + 2} width={Math.max(barW, 2)} height={18} fill="#6366f1" rx={2} />
            <text x={116 + Math.max(barW, 2) + 4} y={y + 15} fontSize="10" fill="#1e293b">{fmt(r.usd)}</text>
          </g>
        );
      })}
      {rows.length === 0 && (
        <text x={170} y={90} textAnchor="middle" fontSize="11" fill="#94a3b8">No data</text>
      )}
    </svg>
  );
}
