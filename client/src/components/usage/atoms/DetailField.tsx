export function DetailField({ label, value, mono }: { label: string; value: string | null | undefined; mono?: boolean }) {
  return (
    <div>
      <div className="text-slate-400 font-semibold mb-0.5">{label}</div>
      <div className={`text-slate-900 ${mono ? 'font-mono text-[11px] break-all' : ''}`}>{value ?? '—'}</div>
    </div>
  );
}
