import { useState, useCallback } from 'react';

// ---------------------------------------------------------------------------
// Types — mirrors shared/skillParameters.ts (duplicated to avoid import issues
// in the Vite client bundle; the server uses the shared module directly).
// ---------------------------------------------------------------------------

export interface SkillParameter {
  name: string;
  type: 'string' | 'number' | 'integer' | 'boolean' | 'enum';
  required: boolean;
  description: string;
  enumValues?: string[];
}

// ---------------------------------------------------------------------------
// Conversion helpers (pure, no deps)
// ---------------------------------------------------------------------------

function schemaToParameters(schema: {
  properties?: Record<string, { type?: string; enum?: string[]; description?: string }>;
  required?: string[];
}): SkillParameter[] {
  const props = schema.properties ?? {};
  const req = new Set(schema.required ?? []);
  return Object.entries(props).map(([name, def]) => {
    if (def.enum && Array.isArray(def.enum)) {
      return { name, type: 'enum' as const, required: req.has(name), description: def.description ?? '', enumValues: def.enum.map(String) };
    }
    const rawType = def.type ?? 'string';
    const type = (['string', 'number', 'integer', 'boolean'].includes(rawType) ? rawType : 'string') as SkillParameter['type'];
    return { name, type, required: req.has(name), description: def.description ?? '' };
  });
}

function parametersToDefinition(slug: string, description: string, params: SkillParameter[]): object {
  const properties: Record<string, object> = {};
  const required: string[] = [];

  for (const p of params) {
    if (p.type === 'enum' && p.enumValues && p.enumValues.length > 0) {
      properties[p.name] = { type: 'string', enum: p.enumValues, description: p.description };
    } else {
      properties[p.name] = { type: p.type === 'enum' ? 'string' : p.type, description: p.description };
    }
    if (p.required) required.push(p.name);
  }

  return {
    name: slug,
    description,
    input_schema: { type: 'object', properties, required },
  };
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const inputCls = 'w-full px-2.5 py-1.5 border border-slate-200 rounded-md text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500';

const PARAM_TYPES: SkillParameter['type'][] = ['string', 'number', 'integer', 'boolean', 'enum'];

function ParameterRow({
  param,
  index,
  onChange,
  onRemove,
  disabled,
}: {
  param: SkillParameter;
  index: number;
  onChange: (index: number, param: SkillParameter) => void;
  onRemove: (index: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid grid-cols-[1fr_120px_auto_1fr_auto] gap-2 items-start py-2 border-b border-slate-100 last:border-0">
      <input
        value={param.name}
        onChange={(e) => onChange(index, { ...param, name: e.target.value.replace(/[^a-z0-9_]/gi, '_').toLowerCase() })}
        className={inputCls}
        placeholder="param_name"
        disabled={disabled}
      />
      <select
        value={param.type}
        onChange={(e) => onChange(index, { ...param, type: e.target.value as SkillParameter['type'] })}
        className={`${inputCls} cursor-pointer`}
        disabled={disabled}
      >
        {PARAM_TYPES.map((t) => (
          <option key={t} value={t}>{t}</option>
        ))}
      </select>
      <label className="flex items-center gap-1.5 pt-1.5 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={param.required}
          onChange={(e) => onChange(index, { ...param, required: e.target.checked })}
          className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
          disabled={disabled}
        />
        <span className="text-[12px] text-slate-600 whitespace-nowrap">Required</span>
      </label>
      <input
        value={param.description}
        onChange={(e) => onChange(index, { ...param, description: e.target.value })}
        className={inputCls}
        placeholder="Description"
        disabled={disabled}
      />
      {!disabled && (
        <button
          onClick={() => onRemove(index)}
          className="mt-1 px-2 py-1 text-red-500 hover:text-red-700 hover:bg-red-50 rounded text-[14px] bg-transparent border-0 cursor-pointer transition-colors"
          title="Remove parameter"
        >
          &times;
        </button>
      )}
      {param.type === 'enum' && (
        <div className="col-span-5 pl-1 pb-1">
          <input
            value={(param.enumValues ?? []).join(', ')}
            onChange={(e) =>
              onChange(index, {
                ...param,
                enumValues: e.target.value.split(',').map((v) => v.trim()).filter(Boolean),
              })
            }
            className={`${inputCls} text-[12px]`}
            placeholder="Comma-separated enum values: draft, published, archived"
            disabled={disabled}
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface ParameterBuilderProps {
  /** Current JSON definition string (the full tool def, not just input_schema). */
  definitionJson: string;
  /** Skill slug — used to auto-populate the 'name' field in the definition. */
  slug: string;
  /** Skill description — used to auto-populate the 'description' field. */
  description: string;
  /** Called when parameters change, with the updated JSON definition string. */
  onChange: (definitionJson: string) => void;
  disabled?: boolean;
}

export default function ParameterBuilder({ definitionJson, slug, description, onChange, disabled }: ParameterBuilderProps) {
  const [showRawJson, setShowRawJson] = useState(false);

  // Parse current definition into parameters. The runtime shape is whatever
  // JSON.parse returns; we narrow it to the structure schemaToParameters
  // expects, then it tolerates missing/extra fields per-property.
  let parsedDef: {
    input_schema?: {
      properties?: Record<string, { type?: string; enum?: string[]; description?: string }>;
      required?: string[];
    };
  } = {};
  try {
    parsedDef = JSON.parse(definitionJson);
  } catch {
    // invalid JSON — show raw editor
  }

  const params = schemaToParameters(parsedDef.input_schema ?? {});

  const updateParams = useCallback(
    (newParams: SkillParameter[]) => {
      const def = parametersToDefinition(slug || 'skill_name', description || '', newParams);
      onChange(JSON.stringify(def, null, 2));
    },
    [slug, description, onChange],
  );

  const handleParamChange = useCallback(
    (index: number, param: SkillParameter) => {
      const newParams = [...params];
      newParams[index] = param;
      updateParams(newParams);
    },
    [params, updateParams],
  );

  const handleParamRemove = useCallback(
    (index: number) => {
      const newParams = params.filter((_, i) => i !== index);
      updateParams(newParams);
    },
    [params, updateParams],
  );

  const handleAddParam = useCallback(() => {
    updateParams([...params, { name: '', type: 'string', required: false, description: '' }]);
  }, [params, updateParams]);

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="text-[13px] font-medium text-slate-700">
          Parameters ({params.length})
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowRawJson(!showRawJson)}
            className="text-[12px] text-slate-500 hover:text-slate-700 bg-transparent border border-slate-200 rounded-md px-2.5 py-1 cursor-pointer transition-colors"
          >
            {showRawJson ? 'Parameter Editor' : 'View JSON'}
          </button>
          {!showRawJson && !disabled && (
            <button
              onClick={handleAddParam}
              className="text-[12px] text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-md px-2.5 py-1 cursor-pointer font-medium transition-colors"
            >
              + Add Parameter
            </button>
          )}
        </div>
      </div>

      {showRawJson ? (
        <div>
          <textarea
            value={definitionJson}
            onChange={(e) => onChange(e.target.value)}
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-[12px] font-mono bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 min-h-[200px] resize-y"
            disabled={disabled}
          />
          <div className="text-[11px] text-slate-400 mt-1">
            Auto-generated from parameters above. Edit directly only if needed.
          </div>
        </div>
      ) : (
        <div>
          {params.length > 0 && (
            <div className="grid grid-cols-[1fr_120px_auto_1fr_auto] gap-2 pb-1 mb-1 border-b border-slate-200">
              <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Name</div>
              <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Type</div>
              <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Req</div>
              <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Description</div>
              <div />
            </div>
          )}

          {params.map((param, i) => (
            <ParameterRow
              key={i}
              param={param}
              index={i}
              onChange={handleParamChange}
              onRemove={handleParamRemove}
              disabled={disabled}
            />
          ))}

          {params.length === 0 && (
            <div className="py-6 text-center text-[13px] text-slate-400 bg-slate-50 rounded-lg border border-dashed border-slate-200">
              No parameters defined. Click &ldquo;+ Add Parameter&rdquo; to add the first one.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
