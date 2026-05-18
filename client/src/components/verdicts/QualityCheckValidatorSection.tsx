import React, { useEffect, useState } from 'react';
import { ValidatorParameterForm } from './ValidatorParameterForm';
import { listValidators, type ValidatorSummary } from '../../lib/api/validators';

export interface QualityCheckValidatorConfig {
  kind?: 'semantic' | 'deterministic' | 'hybrid';
  validatorSlug?: string;
  validatorParameters?: Record<string, unknown>;
  preconditionSlugs?: string[];
  preconditionParameters?: Array<Record<string, unknown>>;
  safetyClass?: boolean;
}

interface QualityCheckValidatorSectionProps {
  value: QualityCheckValidatorConfig;
  onChange: (next: QualityCheckValidatorConfig) => void;
}

export function QualityCheckValidatorSection({ value, onChange }: QualityCheckValidatorSectionProps) {
  const [validators, setValidators] = useState<ValidatorSummary[]>([]);

  useEffect(() => {
    listValidators().then(setValidators).catch(() => setValidators([]));
  }, []);

  const kind = value.kind ?? 'semantic';
  const deterministicValidators = validators.filter(
    (v) => v.kind === 'deterministic' || v.kind === 'deterministic_external',
  );
  const selectedValidator = deterministicValidators.find((v) => v.slug === value.validatorSlug);

  function setKind(next: 'semantic' | 'deterministic' | 'hybrid') {
    onChange({ ...value, kind: next, validatorSlug: undefined, validatorParameters: undefined });
  }

  return (
    <div className="mt-3 border border-slate-200 rounded p-3 space-y-2 bg-slate-50">
      <div className="flex items-center gap-1 mb-1">
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Validator configuration</span>
        <span className="text-xs text-slate-400 ml-1">(staff only)</span>
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Kind</label>
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as 'semantic' | 'deterministic' | 'hybrid')}
          className="w-full border border-slate-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
        >
          <option value="semantic">Semantic (LLM judge)</option>
          <option value="deterministic">Deterministic</option>
          <option value="hybrid">Hybrid</option>
        </select>
      </div>

      {kind === 'deterministic' && (
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Validator</label>
          <select
            value={value.validatorSlug ?? ''}
            onChange={(e) =>
              onChange({ ...value, validatorSlug: e.target.value || undefined, validatorParameters: undefined })
            }
            className="w-full border border-slate-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
          >
            <option value="">Select validator...</option>
            {deterministicValidators.map((v) => (
              <option key={v.slug} value={v.slug}>
                {v.name} ({v.slug})
              </option>
            ))}
          </select>
          {selectedValidator && selectedValidator.parameterSchema.length > 0 && (
            <ValidatorParameterForm
              schema={selectedValidator.parameterSchema}
              value={value.validatorParameters ?? {}}
              onChange={(params) => onChange({ ...value, validatorParameters: params })}
            />
          )}
        </div>
      )}

      {kind === 'hybrid' && (
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Precondition validators</label>
          <p className="text-xs text-slate-400 mb-1">
            Comma-separated slugs. These run before the LLM judge.
          </p>
          <input
            type="text"
            value={(value.preconditionSlugs ?? []).join(', ')}
            onChange={(e) =>
              onChange({
                ...value,
                preconditionSlugs: e.target.value
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
            placeholder="e.g. output_non_empty, output_length_within_bounds"
            className="w-full border border-slate-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
          />
        </div>
      )}

      <div className="flex items-center gap-2">
        <input
          id="safetyClass"
          type="checkbox"
          checked={value.safetyClass ?? false}
          onChange={(e) => onChange({ ...value, safetyClass: e.target.checked })}
          className="rounded border-slate-300"
        />
        <label htmlFor="safetyClass" className="text-xs text-slate-600">
          Safety class (failures trigger safety alert)
        </label>
      </div>
    </div>
  );
}
