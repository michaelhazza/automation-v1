// Filter pill for agent-diagnosed incidents (spec §10.5).
// Four values: all / diagnosed / awaiting / not-triaged.
// ANDs with existing filters; no count badges (per CLAUDE.md frontend rules).

export type DiagnosisFilter = 'all' | 'diagnosed' | 'awaiting' | 'not-triaged' | 'failed-triage';

const PILL_OPTIONS: Array<{ value: DiagnosisFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'diagnosed', label: 'Diagnosed by agent' },
  { value: 'awaiting', label: 'Awaiting diagnosis' },
  { value: 'not-triaged', label: 'Not auto-triaged' },
  { value: 'failed-triage', label: 'Failed triage' },
];

interface Props {
  value: DiagnosisFilter;
  onChange: (value: DiagnosisFilter) => void;
}

export default function DiagnosisFilterPill({ value, onChange }: Props) {
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {PILL_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={[
            'px-2.5 py-1 text-[11px] font-medium rounded-full border transition-colors',
            value === opt.value
              ? 'bg-indigo-600 border-indigo-600 text-white'
              : 'bg-white border-slate-200 text-slate-600 hover:border-slate-400',
          ].join(' ')}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
