// Binary toggle rendered in WorkspaceBoardPage header to filter the board
// to only operator-managed tasks (mockup r12). Default off.

interface OperatorFilterToggleProps {
  value: boolean;
  onChange: (v: boolean) => void;
}

export function OperatorFilterToggle({ value, onChange }: OperatorFilterToggleProps) {
  return (
    <label className="flex items-center gap-2 cursor-pointer select-none text-[12px] text-slate-600">
      <span>Operator only</span>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        onClick={() => onChange(!value)}
        className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 transition-colors focus:outline-none ${
          value
            ? 'bg-indigo-600 border-indigo-600'
            : 'bg-slate-200 border-slate-200'
        }`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform mt-px ${
            value ? 'translate-x-4' : 'translate-x-px'
          }`}
        />
      </button>
    </label>
  );
}
