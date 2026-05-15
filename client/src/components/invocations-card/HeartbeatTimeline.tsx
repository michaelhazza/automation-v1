export function HeartbeatTimeline({
  agentName,
  intervalHours,
  offsetHours,
  offsetMinutes = 0,
}: {
  agentName: string;
  intervalHours: number;
  offsetHours: number;
  offsetMinutes?: number;
}) {
  const startMins = offsetHours * 60 + offsetMinutes;
  const runMins: number[] = [];
  for (let m = startMins; m < 24 * 60; m += intervalHours * 60) runMins.push(m);

  const fmtMin = (m: number) =>
    `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

  return (
    <div className="bg-slate-50 border border-slate-200 rounded-[10px] px-[18px] py-[14px]">
      <div className="flex items-center gap-3 mb-1">
        <span className="text-xs font-semibold text-gray-700 w-[130px] shrink-0 overflow-hidden text-ellipsis whitespace-nowrap">
          {agentName}
        </span>
        <span className="text-[11px] text-slate-400 w-[70px] shrink-0">every {intervalHours}h</span>
        <svg width="100%" height="28" viewBox="0 0 480 28" preserveAspectRatio="none" className="flex-1 min-w-0">
          <line x1="0" y1="14" x2="480" y2="14" stroke="#d1d5db" strokeWidth="1.5" />
          {[0, 4, 8, 12, 16, 20, 24].map((h) => (
            <line key={h} x1={h / 24 * 480} y1="10" x2={h / 24 * 480} y2="18" stroke="#d1d5db" strokeWidth="1" />
          ))}
          {runMins.map((m) => (
            <circle key={m} cx={m / (24 * 60) * 480} cy="14" r="5" fill="#6366f1" />
          ))}
        </svg>
      </div>
      <div className="flex justify-between pl-[202px] text-[10px] text-slate-400 mt-0.5">
        {[0, 4, 8, 12, 16, 20, 24].map((h) => (
          <span key={h}>{h === 24 ? '' : `${h}h`}</span>
        ))}
      </div>
      <div className="mt-2.5 pl-[202px] text-xs text-indigo-500 font-medium">
        Runs at: {runMins.map(fmtMin).join('  ·  ')}
      </div>
    </div>
  );
}
