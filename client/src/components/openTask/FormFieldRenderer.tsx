/**
 * FormFieldRenderer — maps an AskFormFieldDef to its input component.
 *
 * Seven field types: short_text, long_text, number, boolean, select,
 * multi_select, date.
 *
 * Spec: docs/workflows-dev-spec.md §11.
 */

import type { AskFormFieldDef, AskFormValues } from '../../../../shared/types/askForm.js';

interface FormFieldRendererProps {
  field: AskFormFieldDef;
  value: AskFormValues[string];
  onChange: (key: string, value: AskFormValues[string]) => void;
  error?: string;
  disabled?: boolean;
}

export default function FormFieldRenderer({
  field,
  value,
  onChange,
  error,
  disabled,
}: FormFieldRendererProps) {
  const inputBase =
    'w-full rounded-md border border-slate-600 bg-slate-700/60 px-3 py-2 text-[13px] text-slate-200 placeholder-slate-500 outline-none focus:ring-1 focus:ring-amber-500 focus:border-amber-500 transition-colors disabled:opacity-50';

  return (
    <div className="flex flex-col gap-1">
      <label className="text-[12px] font-medium text-slate-300">
        {field.label}
        {field.required && <span className="text-amber-400 ml-1">*</span>}
      </label>

      {field.description && (
        <p className="text-[11.5px] text-slate-500 mt-0 mb-0.5">{field.description}</p>
      )}

      {field.type === 'short_text' && (
        <input
          type="text"
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(field.key, e.target.value)}
          placeholder={field.placeholder ?? ''}
          maxLength={256}
          disabled={disabled}
          className={inputBase}
        />
      )}

      {field.type === 'long_text' && (
        <textarea
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(field.key, e.target.value)}
          placeholder={field.placeholder ?? ''}
          maxLength={8192}
          rows={4}
          disabled={disabled}
          className={`${inputBase} resize-y`}
        />
      )}

      {field.type === 'number' && (
        <input
          type="number"
          value={typeof value === 'number' ? value : ''}
          onChange={(e) => {
            const parsed = parseFloat(e.target.value);
            onChange(field.key, isNaN(parsed) ? null : parsed);
          }}
          placeholder={field.placeholder ?? ''}
          min={field.min}
          max={field.max}
          disabled={disabled}
          className={inputBase}
        />
      )}

      {field.type === 'boolean' && (
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={value === true}
            onChange={(e) => onChange(field.key, e.target.checked)}
            disabled={disabled}
            className="w-4 h-4 rounded border-slate-600 bg-slate-700 accent-amber-500 cursor-pointer"
          />
          <span className="text-[13px] text-slate-300">
            {field.placeholder ?? (value === true ? 'Yes' : 'No')}
          </span>
        </label>
      )}

      {field.type === 'select' && (
        <select
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(field.key, e.target.value || null)}
          disabled={disabled}
          className={`${inputBase} cursor-pointer`}
        >
          <option value="">{field.placeholder ?? 'Select an option...'}</option>
          {(field.options ?? []).map((opt: { value: string; label: string }) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      )}

      {field.type === 'multi_select' && (
        <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto p-2 rounded-md border border-slate-600 bg-slate-700/40">
          {(field.options ?? []).map((opt: { value: string; label: string }) => {
            const selected = Array.isArray(value) && value.includes(opt.value);
            return (
              <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={(e) => {
                    const current = Array.isArray(value) ? [...value] : [];
                    if (e.target.checked) {
                      onChange(field.key, [...current, opt.value]);
                    } else {
                      onChange(field.key, current.filter((v) => v !== opt.value));
                    }
                  }}
                  disabled={disabled}
                  className="w-4 h-4 rounded border-slate-600 bg-slate-700 accent-amber-500 cursor-pointer"
                />
                <span className="text-[13px] text-slate-300">{opt.label}</span>
              </label>
            );
          })}
          {(field.options ?? []).length === 0 && (
            <p className="text-[12px] text-slate-500 italic">No options available</p>
          )}
        </div>
      )}

      {field.type === 'date' && (
        <input
          type="date"
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(field.key, e.target.value || null)}
          disabled={disabled}
          className={inputBase}
        />
      )}

      {error && (
        <p className="text-[11.5px] text-red-400 mt-0.5">{error}</p>
      )}
    </div>
  );
}
