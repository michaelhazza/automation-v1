export function Badge({ label, colorMap }: { label: string | null; colorMap: Record<string, string> }) {
  if (!label) return <span className="text-slate-400">—</span>;
  const cls = colorMap[label] ?? 'bg-slate-100 text-slate-600';
  return <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold ${cls}`}>{label}</span>;
}
