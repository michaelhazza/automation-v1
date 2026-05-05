interface Signal {
  slug: string;
  label: string | null;
  lastSeenAt: string | null;
}

export default function SignalPanel({ signals, lastUpdatedAt }: { signals: Signal[]; lastUpdatedAt: string | null }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-[13px] font-bold uppercase text-slate-500">Top signals</h3>
        {lastUpdatedAt && (
          <span className="text-[11px] text-slate-400">as of {new Date(lastUpdatedAt).toLocaleString()}</span>
        )}
      </div>
      {signals.length === 0 ? (
        <p className="text-[13px] text-slate-500">No contributing signals for the current assessment.</p>
      ) : (
        <ul className="space-y-1.5">
          {signals.map((s) => (
            <li key={s.slug} className="text-[13px]">
              <div>
                <div className="font-semibold text-slate-800">{s.label ?? s.slug}</div>
                {s.lastSeenAt && (
                  <div className="text-[11px] text-slate-400">
                    last seen {new Date(s.lastSeenAt).toLocaleDateString()}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
