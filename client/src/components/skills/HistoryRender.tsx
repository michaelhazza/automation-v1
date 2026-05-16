export function CheckOption({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: React.ReactNode }) {
  return (
    <label className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-slate-50 cursor-pointer text-[12px] text-slate-700">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="w-3.5 h-3.5 accent-indigo-600 cursor-pointer"
      />
      {label}
    </label>
  );
}

export function FilterActions({ onAll, onNone }: { onAll: () => void; onNone: () => void }) {
  return (
    <div className="flex items-center gap-2 px-2 pb-1.5">
      <button onClick={onAll} className="text-[11px] text-indigo-600 hover:text-indigo-800 bg-transparent border-0 p-0 cursor-pointer">All</button>
      <span className="text-slate-300 text-[11px]">·</span>
      <button onClick={onNone} className="text-[11px] text-indigo-600 hover:text-indigo-800 bg-transparent border-0 p-0 cursor-pointer">None</button>
    </div>
  );
}
