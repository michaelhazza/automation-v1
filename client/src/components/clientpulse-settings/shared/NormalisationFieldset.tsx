// ---------------------------------------------------------------------------
// Normalisation sub-form — used by HealthScoreFactorsEditor to edit each
// factor's normalisation strategy (linear | threshold | …). Kept separate so
// future normalisation strategies can be added without touching the factor row.
// ---------------------------------------------------------------------------

interface Props {
  value: Record<string, unknown> | undefined;
  onChange: (next: Record<string, unknown>) => void;
}

export default function NormalisationFieldset({ value, onChange }: Props) {
  const normalisation = value ?? { strategy: 'linear' };
  const strategy = typeof normalisation.strategy === 'string' ? normalisation.strategy : 'linear';

  const set = (key: string, val: unknown) => {
    const next = { ...normalisation };
    if (val === undefined || val === '' || val === null) delete next[key];
    else next[key] = val;
    onChange(next);
  };

  return (
    <div className="space-y-1">
      <label className="block text-[10.5px] font-bold uppercase text-slate-500">Normalisation</label>
      <select
        value={strategy}
        onChange={(e) => set('strategy', e.target.value)}
        className="w-full px-2 py-1 rounded-md border border-slate-200 text-[12px]"
      >
        <option value="linear">linear</option>
        <option value="threshold">threshold</option>
        <option value="bucketed">bucketed</option>
      </select>
      {strategy === 'threshold' && (
        <input
          type="number"
          placeholder="threshold"
          value={typeof normalisation.threshold === 'number' ? normalisation.threshold : ''}
          onChange={(e) => set('threshold', e.target.value === '' ? undefined : Number.parseFloat(e.target.value))}
          className="w-full px-2 py-1 rounded-md border border-slate-200 text-[12px]"
        />
      )}
    </div>
  );
}
