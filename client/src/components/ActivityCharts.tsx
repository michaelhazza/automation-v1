// Adapted from Paperclip (MIT) — custom SVG activity charts, no external charting library.

interface DayBucket {
  date: string;
  completed: number;
  failed: number;
  timeout: number;
  other: number;
  total: number;
}

function formatDateLabel(dateStr: string, idx: number, total: number): string {
  const d = new Date(dateStr + 'T00:00:00');
  // Show label every ~3 days to avoid crowding
  if (idx % Math.ceil(total / 5) !== 0 && idx !== total - 1) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ─── Run Activity Chart ────────────────────────────────────────────────────────
export function RunActivityChart({ data, height = 140 }: { data: DayBucket[]; height?: number }) {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-[140px] text-sm text-slate-400">
        No activity data yet
      </div>
    );
  }

  const maxVal = Math.max(...data.map(d => d.total), 1);
  const barAreaHeight = height - 24; // reserve 24px for labels
  const barWidth = 100 / data.length;
  const gap = 0.5; // % gap each side of bar

  return (
    <div className="w-full select-none">
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 100 ${height}`}
        preserveAspectRatio="none"
        className="overflow-visible"
      >
        {/* Horizontal grid lines */}
        {[0.25, 0.5, 0.75, 1].map(frac => {
          const y = barAreaHeight * (1 - frac);
          return (
            <line
              key={frac}
              x1="0" y1={y} x2="100" y2={y}
              stroke="#f1f5f9" strokeWidth="0.3"
            />
          );
        })}

        {data.map((day, i) => {
          const x = i * barWidth + gap;
          const bw = barWidth - gap * 2;

          const completedH = (day.completed / maxVal) * barAreaHeight;
          const failedH = (day.failed / maxVal) * barAreaHeight;
          const timeoutH = (day.timeout / maxVal) * barAreaHeight;
          const otherH = (day.other / maxVal) * barAreaHeight;

          // Stack: completed (bottom), other, timeout, failed (top)
          let yStack = barAreaHeight;

          const segments: Array<{ h: number; fill: string; label: string; count: number }> = [
            { h: completedH, fill: '#10b981', label: 'Completed', count: day.completed },
            { h: otherH,     fill: '#94a3b8', label: 'Other',     count: day.other },
            { h: timeoutH,   fill: '#f59e0b', label: 'Timeout',   count: day.timeout },
            { h: failedH,    fill: '#f43f5e', label: 'Failed',    count: day.failed },
          ];

          const label = formatDateLabel(day.date, i, data.length);

          return (
            <g key={day.date}>
              {/* Tooltip trigger area */}
              <title>{`${day.date}\nCompleted: ${day.completed}\nFailed: ${day.failed}\nTimeout: ${day.timeout}\nOther: ${day.other}`}</title>

              {segments.map(seg => {
                if (seg.h <= 0) return null;
                yStack -= seg.h;
                return (
                  <rect
                    key={seg.label}
                    x={x} y={yStack}
                    width={bw} height={seg.h}
                    fill={seg.fill}
                    opacity={0.85}
                    rx="0.3"
                  />
                );
              })}

              {/* Empty bar placeholder */}
              {day.total === 0 && (
                <rect
                  x={x} y={barAreaHeight - 1}
                  width={bw} height={1}
                  fill="#e2e8f0"
                />
              )}

              {/* Date label */}
              {label && (
                <text
                  x={x + bw / 2}
                  y={height - 4}
                  textAnchor="middle"
                  fontSize="3"
                  fill="#94a3b8"
                  fontFamily="system-ui, sans-serif"
                >
                  {label}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-2 flex-wrap">
        {[
          { color: '#10b981', label: 'Completed' },
          { color: '#f43f5e', label: 'Failed' },
          { color: '#f59e0b', label: 'Timeout' },
          { color: '#94a3b8', label: 'Other' },
        ].map(({ color, label }) => (
          <div key={label} className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: color }} />
            <span className="text-[11px] text-slate-400">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Success Rate Chart ────────────────────────────────────────────────────────
export function SuccessRateChart({ data, height = 140 }: { data: DayBucket[]; height?: number }) {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-[140px] text-sm text-slate-400">
        No data yet
      </div>
    );
  }

  const barAreaHeight = height - 24;
  const barWidth = 100 / data.length;
  const gap = 0.5;

  return (
    <div className="w-full select-none">
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 100 ${height}`}
        preserveAspectRatio="none"
        className="overflow-visible"
      >
        {[0.25, 0.5, 0.75, 1].map(frac => (
          <line key={frac} x1="0" y1={barAreaHeight * (1 - frac)} x2="100" y2={barAreaHeight * (1 - frac)}
            stroke="#f1f5f9" strokeWidth="0.3" />
        ))}

        {/* 80% success threshold line */}
        <line x1="0" y1={barAreaHeight * 0.2} x2="100" y2={barAreaHeight * 0.2}
          stroke="#e2e8f0" strokeWidth="0.4" strokeDasharray="1,1" />

        {data.map((day, i) => {
          const rate = day.total > 0 ? day.completed / day.total : 0;
          const barH = rate * barAreaHeight;
          const fill = rate >= 0.8 ? '#10b981' : rate >= 0.5 ? '#f59e0b' : day.total > 0 ? '#f43f5e' : '#e2e8f0';
          const label = formatDateLabel(day.date, i, data.length);
          return (
            <g key={day.date}>
              <title>{`${day.date}\nSuccess rate: ${day.total > 0 ? Math.round(rate * 100) : '--'}%`}</title>
              <rect
                x={i * barWidth + gap}
                y={barAreaHeight - barH}
                width={barWidth - gap * 2}
                height={Math.max(barH, day.total > 0 ? 1 : 0)}
                fill={fill}
                opacity={0.85}
                rx="0.3"
              />
              {day.total === 0 && (
                <rect x={i * barWidth + gap} y={barAreaHeight - 1} width={barWidth - gap * 2} height={1} fill="#e2e8f0" />
              )}
              {label && (
                <text x={i * barWidth + gap + (barWidth - gap * 2) / 2} y={height - 4}
                  textAnchor="middle" fontSize="3" fill="#94a3b8" fontFamily="system-ui, sans-serif">
                  {label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ─── Mini sparkline (for metric cards) ────────────────────────────────────────
export function SparkLine({ values, color = '#6366f1' }: { values: number[]; color?: string }) {
  if (!values || values.length < 2) return null;
  const max = Math.max(...values, 1);
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * 100;
    const y = 100 - (v / max) * 80 - 10;
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg width="60" height="24" viewBox="0 0 100 100" preserveAspectRatio="none" className="shrink-0">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
