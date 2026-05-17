export function FilterSelect({ label, value, options, onChange }: { label: string; value?: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <select
      value={value || ''}
      onChange={e => onChange(e.target.value)}
      className="text-[12px] border border-slate-200 rounded-lg px-2 py-1.5 bg-white text-slate-700 [font-family:inherit] cursor-pointer"
    >
      <option value="">{label}: Any</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}
