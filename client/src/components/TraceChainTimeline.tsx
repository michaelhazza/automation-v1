interface ChainRun {
  id: string;
  agentName: string;
  isSubAgent: boolean;
  runSource: string;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  totalTokens: number | null;
}

interface Props {
  runs: ChainRun[];
  selectedRunId: string;
  onSelectRun: (id: string) => void;
}

const STATUS_COLORS: Record<string, string> = {
  completed: '#22c55e',
  failed: '#ef4444',
  running: '#3b82f6',
  pending: '#94a3b8',
  timeout: '#f97316',
  cancelled: '#94a3b8',
  loop_detected: '#f59e0b',
  budget_exceeded: '#ef4444',
};

export default function TraceChainTimeline({ runs, selectedRunId, onSelectRun }: Props) {
  if (runs.length < 2) return null;

  // Calculate time bounds
  const timestamps = runs
    .filter(r => r.startedAt)
    .map(r => new Date(r.startedAt!).getTime());
  const endTimestamps = runs
    .filter(r => r.completedAt)
    .map(r => new Date(r.completedAt!).getTime());

  if (timestamps.length === 0) return null;

  const minTime = Math.min(...timestamps);
  const maxTime = Math.max(...timestamps, ...endTimestamps);
  const totalSpan = maxTime - minTime || 1;

  const barHeight = 20;
  const rowGap = 4;
  const labelWidth = 120;
  const chartWidth = 400;
  const svgWidth = labelWidth + chartWidth + 20;
  const svgHeight = runs.length * (barHeight + rowGap) + 30;

  return (
    <div className="overflow-x-auto">
      <svg
        width={svgWidth}
        height={svgHeight}
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        className="text-xs"
      >
        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map(pct => {
          const x = labelWidth + pct * chartWidth;
          const ms = totalSpan * pct;
          return (
            <g key={pct}>
              <line x1={x} y1={0} x2={x} y2={svgHeight - 20} stroke="#e2e8f0" strokeWidth={1} />
              <text x={x} y={svgHeight - 5} textAnchor="middle" fill="#94a3b8" fontSize={10}>
                {ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`}
              </text>
            </g>
          );
        })}

        {/* Bars */}
        {runs.map((run, i) => {
          const y = i * (barHeight + rowGap);
          const start = run.startedAt ? new Date(run.startedAt).getTime() : minTime;
          const end = run.completedAt ? new Date(run.completedAt).getTime() : maxTime;
          const x = labelWidth + ((start - minTime) / totalSpan) * chartWidth;
          const w = Math.max(((end - start) / totalSpan) * chartWidth, 4);
          const color = STATUS_COLORS[run.status] ?? '#94a3b8';
          const isSelected = run.id === selectedRunId;
          const label = run.isSubAgent ? `Sub: ${run.agentName}` :
            run.runSource === 'handoff' ? `HO: ${run.agentName}` : run.agentName;

          return (
            <g key={run.id} onClick={() => onSelectRun(run.id)} className="cursor-pointer">
              {/* Label */}
              <text x={labelWidth - 6} y={y + barHeight / 2 + 4} textAnchor="end" fill="#475569" fontSize={11}>
                {label.length > 16 ? label.slice(0, 15) + '…' : label}
              </text>

              {/* Bar */}
              <rect
                x={x} y={y} width={w} height={barHeight}
                rx={3} fill={color} opacity={isSelected ? 1 : 0.7}
                stroke={isSelected ? '#4f46e5' : 'none'} strokeWidth={isSelected ? 2 : 0}
              />

              {/* Failure marker */}
              {(run.status === 'failed' || run.status === 'timeout' || run.status === 'budget_exceeded') && (
                <text x={x + w + 4} y={y + barHeight / 2 + 4} fill="#ef4444" fontSize={12} fontWeight="bold">✗</text>
              )}

              {/* Hover tooltip via title */}
              <title>{`${run.agentName}\nStatus: ${run.status}\nDuration: ${run.durationMs ? `${(run.durationMs / 1000).toFixed(1)}s` : '—'}\nTokens: ${run.totalTokens ?? '—'}`}</title>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
