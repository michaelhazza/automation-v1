export function FilterText({ label, value, onChange }: { label: string; value?: string; onChange: (v: string) => void }) {
  return (
    <input
      type="text"
      placeholder={label}
      value={value || ''}
      onChange={e => onChange(e.target.value)}
      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
      className="text-[12px] border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-700 w-[110px] [font-family:inherit] placeholder:text-slate-400"
    />
  );
}
