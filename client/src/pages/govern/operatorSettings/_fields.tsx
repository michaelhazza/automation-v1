import { type ChangeEvent } from 'react';

interface ToggleFieldProps {
  label: string;
  helpText: string;
  value: 'on' | 'off';
  onChange: (v: 'on' | 'off') => void;
  disabled?: boolean;
}

export function ToggleField({ label, helpText, value, onChange, disabled }: ToggleFieldProps) {
  const active = value === 'on';
  return (
    <div className="grid grid-cols-[1fr_160px] items-start gap-4 py-3.5 px-5 border-b border-slate-50 last:border-b-0">
      <div>
        <div className="text-[13px] font-semibold text-slate-800 mb-0.5">{label}</div>
        <div className="text-[12px] text-slate-500 leading-snug">{helpText}</div>
      </div>
      <div className="flex items-center justify-end">
        <button
          type="button"
          role="switch"
          aria-checked={active}
          aria-label={label}
          disabled={disabled}
          onClick={() => onChange(active ? 'off' : 'on')}
          className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed ${active ? 'bg-indigo-600' : 'bg-slate-200'}`}
        >
          <span className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${active ? 'translate-x-5' : 'translate-x-0'}`} />
        </button>
      </div>
    </div>
  );
}

interface CurrencyFieldProps {
  label: string;
  helpText: string;
  valueCents: number;
  onChangeCents: (v: number) => void;
  minCents: number;
  maxCents: number;
  disabled?: boolean;
}

export function CurrencyField({
  label,
  helpText,
  valueCents,
  onChangeCents,
  minCents,
  maxCents,
  disabled,
}: CurrencyFieldProps) {
  const dollars = valueCents / 100;
  const minDollars = minCents / 100;
  const maxDollars = maxCents / 100;
  const invalid = valueCents < minCents || valueCents > maxCents;

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const parsed = parseFloat(e.target.value);
    if (!isNaN(parsed)) onChangeCents(Math.round(parsed * 100));
  };

  return (
    <div className="grid grid-cols-[1fr_160px] items-start gap-4 py-3.5 px-5 border-b border-slate-50 last:border-b-0">
      <div>
        <div className="text-[13px] font-semibold text-slate-800 mb-0.5">{label}</div>
        <div className="text-[12px] text-slate-500 leading-snug">{helpText}</div>
      </div>
      <div className="flex items-center gap-1 justify-end">
        <span className="text-[12px] text-slate-500">$</span>
        <input
          type="number"
          className={`${inputCls} ${invalid ? 'border-red-400 focus:ring-red-400' : ''}`}
          value={dollars.toFixed(1)}
          min={minDollars}
          max={maxDollars}
          step={0.1}
          disabled={disabled}
          onChange={handleChange}
          aria-label={label}
        />
      </div>
    </div>
  );
}

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
