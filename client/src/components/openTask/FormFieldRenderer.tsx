import type { AskField } from '../../../../shared/types/askForm';

interface FormFieldRendererProps {
  field: AskField;
  value: unknown;
  onChange: (key: string, value: unknown) => void;
  error?: string;
}

const inputBase =
  'w-full rounded border px-2 py-1.5 text-[13px] text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500';
const inputNormal = `${inputBase} border-slate-300 bg-white`;
const inputError = `${inputBase} border-red-400 bg-white`;

export function FormFieldRenderer({ field, value, onChange, error }: FormFieldRendererProps) {
  const inputClass = error ? inputError : inputNormal;
  const strValue = value != null ? String(value) : '';

  return (
    <div className="flex flex-col gap-1">
      <label className="text-[12px] font-medium text-slate-700">
        {field.label}
        {field.required && <span className="ml-0.5 text-red-500">*</span>}
      </label>

      {field.help_text && (
        <p className="text-[11px] text-slate-500">{field.help_text}</p>
      )}

      {field.type === 'text' && (
        <input
          type="text"
          className={inputClass}
          value={strValue}
          placeholder={field.label}
          onChange={(e) => onChange(field.key, e.target.value)}
        />
      )}

      {field.type === 'textarea' && (
        <textarea
          className={inputClass}
          value={strValue}
          placeholder={field.label}
          rows={3}
          onChange={(e) => onChange(field.key, e.target.value)}
        />
      )}

      {field.type === 'select' && (
        <select
          className={inputClass}
          value={strValue}
          onChange={(e) => onChange(field.key, e.target.value)}
        >
          <option value="">Select...</option>
          {(field.options ?? []).map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      )}

      {field.type === 'multi-select' && (
        <div className="flex flex-col gap-1">
          {(field.options ?? []).map((opt) => {
            const selected = Array.isArray(value) && (value as string[]).includes(opt.value);
            return (
              <label key={opt.value} className="flex items-center gap-2 text-[13px] text-slate-700">
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={(e) => {
                    const current = Array.isArray(value) ? (value as string[]) : [];
                    const next = e.target.checked
                      ? [...current, opt.value]
                      : current.filter((v) => v !== opt.value);
                    onChange(field.key, next);
                  }}
                />
                {opt.label}
              </label>
            );
          })}
        </div>
      )}

      {field.type === 'number' && (
        <input
          type="number"
          className={inputClass}
          value={strValue}
          min={field.min}
          max={field.max}
          onChange={(e) => onChange(field.key, e.target.value)}
        />
      )}

      {field.type === 'date' && (
        <input
          type="date"
          className={inputClass}
          value={strValue}
          onChange={(e) => onChange(field.key, e.target.value)}
        />
      )}

      {field.type === 'checkbox' && (
        <label className="flex items-center gap-2 text-[13px] text-slate-700">
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => onChange(field.key, e.target.checked)}
          />
          {field.label}
        </label>
      )}

      {error && <p className="text-[11px] text-red-500">{error}</p>}
    </div>
  );
}
