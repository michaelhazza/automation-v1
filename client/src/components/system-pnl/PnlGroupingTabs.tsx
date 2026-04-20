// Segmented control that selects between the 4 grouping tabs.
// Styling mirrors the segmented control pattern already used elsewhere
// in the admin surface (VisibilitySegmentedControl).

export type PnlGrouping = 'organisation' | 'subaccount' | 'source-type' | 'provider-model';

const OPTIONS: Array<{ id: PnlGrouping; label: string }> = [
  { id: 'organisation',   label: 'By Organisation' },
  { id: 'subaccount',     label: 'By Subaccount' },
  { id: 'source-type',    label: 'By Source Type' },
  { id: 'provider-model', label: 'By Provider / Model' },
];

interface Props {
  active:   PnlGrouping;
  onChange: (g: PnlGrouping) => void;
}

export default function PnlGroupingTabs({ active, onChange }: Props) {
  return (
    <div className="inline-flex rounded-md border border-slate-200 bg-white p-0.5 shadow-sm">
      {OPTIONS.map((opt) => {
        const isActive = active === opt.id;
        return (
          <button
            key={opt.id}
            onClick={() => onChange(opt.id)}
            className={
              'px-3 py-1.5 text-sm font-medium rounded transition-colors ' +
              (isActive
                ? 'bg-indigo-600 text-white'
                : 'text-slate-700 hover:bg-slate-50')
            }
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
