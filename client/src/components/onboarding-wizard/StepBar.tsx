const STEPS = ['Connect GHL', 'Select clients', 'Syncing', 'Tell us', 'Done'];

export function StepBar({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-0 mb-10">
      {STEPS.map((label, i) => (
        <div key={label} className="flex items-center gap-0 flex-1 last:flex-none">
          <div className="flex flex-col items-center gap-1.5">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
              i < current
                ? 'bg-indigo-500 text-white'
                : i === current
                  ? 'bg-indigo-600 text-white ring-2 ring-indigo-200'
                  : 'bg-slate-200 text-slate-400'
            }`}>
              {i < current ? (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              ) : i + 1}
            </div>
            <span className={`text-[11px] font-medium whitespace-nowrap ${
              i === current ? 'text-indigo-600' : i < current ? 'text-slate-500' : 'text-slate-400'
            }`}>{label}</span>
          </div>
          {i < STEPS.length - 1 && (
            <div className={`flex-1 h-0.5 mx-2 mb-[18px] ${i < current ? 'bg-indigo-400' : 'bg-slate-200'}`} />
          )}
        </div>
      ))}
    </div>
  );
}
