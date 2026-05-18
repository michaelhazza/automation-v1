import React, { useState } from 'react';
import type { ValidatorParameterField } from '../../lib/api/validators';

interface ValidatorParameterFormProps {
  schema: ValidatorParameterField[];
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}

export function ValidatorParameterForm({ schema, value, onChange }: ValidatorParameterFormProps) {
  // Draft text per field for JSON-shaped inputs (array/object/code-editor/json-schema).
  // Lets the user type freely; we only emit parsed values to onChange when parse succeeds.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string | null>>({});

  function set(name: string, fieldValue: unknown) {
    onChange({ ...value, [name]: fieldValue });
  }

  function setJsonDraft(name: string, text: string, expectArray: boolean) {
    setDrafts((d) => ({ ...d, [name]: text }));
    try {
      const parsed = JSON.parse(text);
      const shapeOk = expectArray ? Array.isArray(parsed) : typeof parsed === 'object' && parsed !== null;
      if (!shapeOk) {
        setErrors((e) => ({ ...e, [name]: expectArray ? 'Expected JSON array' : 'Expected JSON object' }));
        return;
      }
      setErrors((e) => ({ ...e, [name]: null }));
      set(name, parsed);
    } catch (parseErr) {
      setErrors((e) => ({ ...e, [name]: `Invalid JSON: ${(parseErr as Error).message}` }));
    }
  }

  if (schema.length === 0) return null;

  return (
    <div className="space-y-3 mt-2">
      {schema.map((field) => (
        <div key={field.name}>
          <label className="block text-xs font-medium text-slate-600 mb-1">
            {field.name}
            {field.required && <span className="text-red-500 ml-0.5">*</span>}
          </label>
          {renderField(field, value[field.name], (v) => set(field.name, v), drafts, setJsonDraft)}
          {errors[field.name] && (
            <p className="text-xs text-red-600 mt-0.5">{errors[field.name]}</p>
          )}
          {field.description && (
            <p className="text-xs text-slate-400 mt-0.5">{field.description}</p>
          )}
        </div>
      ))}
    </div>
  );
}

function renderField(
  field: ValidatorParameterField,
  current: unknown,
  onChange: (v: unknown) => void,
  drafts: Record<string, string>,
  setJsonDraft: (name: string, text: string, expectArray: boolean) => void,
) {
  const hint = field.uiHint;

  if (hint === 'textarea' && field.type !== 'array' && field.type !== 'object') {
    return (
      <textarea
        value={typeof current === 'string' ? current : ''}
        onChange={(e) => onChange(e.target.value)}
        rows={4}
        className="w-full border border-slate-200 rounded px-2 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-y"
      />
    );
  }

  if (hint === 'code-editor' || hint === 'json-schema') {
    const draftText =
      drafts[field.name] ?? (typeof current === 'string' ? current : JSON.stringify(current ?? {}, null, 2));
    return (
      <textarea
        value={draftText}
        onChange={(e) => setJsonDraft(field.name, e.target.value, false)}
        rows={6}
        className="w-full border border-slate-200 rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-y"
        placeholder={hint === 'json-schema' ? '{ "type": "object", ... }' : ''}
      />
    );
  }

  if (hint === 'number-range') {
    const numVal = typeof current === 'number' ? current : (field.default as number | undefined) ?? 0;
    const min = field.validation?.min;
    const max = field.validation?.max;
    return (
      <input
        type="number"
        value={numVal}
        min={min}
        max={max}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-32 border border-slate-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
      />
    );
  }

  if (hint === 'slug-picker') {
    const strVal = typeof current === 'string' ? current : '';
    const opts = (field.validation?.enum ?? []) as string[];
    if (opts.length > 0) {
      return (
        <select
          value={strVal}
          onChange={(e) => onChange(e.target.value)}
          className="w-full border border-slate-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
        >
          <option value="">Select...</option>
          {opts.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      );
    }
    return (
      <input
        type="text"
        value={strVal}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-slate-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
        placeholder="Enter slug..."
      />
    );
  }

  if (field.type === 'boolean') {
    return (
      <input
        type="checkbox"
        checked={typeof current === 'boolean' ? current : false}
        onChange={(e) => onChange(e.target.checked)}
        className="rounded border-slate-300"
      />
    );
  }

  if (field.type === 'number') {
    return (
      <input
        type="number"
        value={typeof current === 'number' ? current : ''}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full border border-slate-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
      />
    );
  }

  if (field.type === 'array' || field.type === 'object') {
    const expectArray = field.type === 'array';
    const draftText =
      drafts[field.name] ?? JSON.stringify(current ?? (expectArray ? [] : {}), null, 2);
    return (
      <textarea
        value={draftText}
        onChange={(e) => setJsonDraft(field.name, e.target.value, expectArray)}
        rows={4}
        className="w-full border border-slate-200 rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-y"
      />
    );
  }

  return (
    <input
      type="text"
      value={typeof current === 'string' ? current : ''}
      onChange={(e) => onChange(e.target.value)}
      className="w-full border border-slate-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
    />
  );
}
