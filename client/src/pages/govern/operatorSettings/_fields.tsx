import { type ChangeEvent } from 'react';

const inputCls =
  'w-[90px] px-2.5 py-1.5 border border-slate-300 rounded-lg text-[13px] text-slate-800 bg-white ' +
  'text-right font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 ' +
  'disabled:opacity-50 disabled:bg-slate-50 disabled:cursor-not-allowed';

interface NumberFieldProps {
  label: string;
  helpText: string;
  unit: string;
  value: number;
  min: number;
  max: number;
  disabled: boolean;
  onChange: (v: number) => void;
}

export function NumberField({
  label,
  helpText,
  unit,
  value,
  min,
  max,
  disabled,
  onChange,
}: NumberFieldProps) {
  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const parsed = parseInt(e.target.value, 10);
    if (!isNaN(parsed)) onChange(parsed);
  };

  const clamped = Math.min(max, Math.max(min, value));
  const invalid = value < min || value > max;

  return (
    <div className="grid grid-cols-[1fr_160px] items-start gap-4 py-3.5 px-5 border-b border-slate-50 last:border-b-0">
      <div>
        <div className="text-[13px] font-semibold text-slate-800 mb-0.5">{label}</div>
        <div className="text-[12px] text-slate-500 leading-snug">{helpText}</div>
      </div>
      <div className="flex items-center gap-1.5 justify-end">
        <input
          type="number"
          className={`${inputCls} ${invalid ? 'border-red-400 focus:ring-red-400' : ''}`}
          value={clamped}
          min={min}
          max={max}
          disabled={disabled}
          onChange={handleChange}
          aria-label={label}
        />
        <span className="text-[12px] text-slate-500 whitespace-nowrap">{unit}</span>
      </div>
    </div>
  );
}
