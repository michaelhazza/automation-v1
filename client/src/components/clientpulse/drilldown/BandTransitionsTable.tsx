interface Transition {
  fromBand: string;
  toBand: string;
  changedAt: string;
  triggerReason: string | null;
}

const BAND_CLASS: Record<string, string> = {
  healthy: 'bg-emerald-100 text-emerald-700',
  watch: 'bg-yellow-100 text-yellow-700',
  atRisk: 'bg-amber-100 text-amber-700',
  critical: 'bg-red-100 text-red-700',
};

export default function BandTransitionsTable({ transitions, windowDays }: { transitions: Transition[]; windowDays: number }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="text-[13px] font-bold uppercase text-slate-500 mb-3">Band transitions (last {windowDays} days)</h3>
      {transitions.length === 0 ? (
        <p className="text-[13px] text-slate-500">No band changes in this window.</p>
      ) : (
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-[11px] font-bold uppercase text-slate-400">
              <th className="pb-2">When</th>
              <th className="pb-2">From</th>
              <th className="pb-2">To</th>
              <th className="pb-2">Reason</th>
            </tr>
          </thead>
          <tbody>
            {transitions.map((t, i) => (
              <tr key={`${t.changedAt}-${i}`} className="border-t border-slate-100">
                <td className="py-1.5 text-slate-600">{new Date(t.changedAt).toLocaleString()}</td>
                <td className="py-1.5">
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${BAND_CLASS[t.fromBand] ?? 'bg-slate-100 text-slate-600'}`}>{t.fromBand}</span>
                </td>
                <td className="py-1.5">
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${BAND_CLASS[t.toBand] ?? 'bg-slate-100 text-slate-600'}`}>{t.toBand}</span>
                </td>
                <td className="py-1.5 text-slate-500 text-[12px]">{t.triggerReason ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
