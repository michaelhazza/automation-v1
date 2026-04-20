import { fmtCurrency, fmtPct } from './PnlFormat';

// KPI card — one of four at the top of the System P&L page.
// Matches prototypes/system-costs-page.html line ~370 styling.

type ChangeDirection = 'up' | 'down' | 'flat';

interface Props {
  label:   string;
  valueCents: number;
  sublineLeft?:  string;         // e.g. "Gross margin 22.3%"
  change?: { amount: number; unit: 'pct' | 'pp'; direction: ChangeDirection } | null;
  tone?:   'default' | 'overhead';
}

export default function PnlKpiCard({ label, valueCents, sublineLeft, change, tone = 'default' }: Props) {
  const borderTone = tone === 'overhead' ? 'border-l-4 border-l-indigo-400' : 'border-l-4 border-l-transparent';
  return (
    <div className={`bg-white rounded-lg border border-slate-200 px-5 py-4 ${borderTone}`}>
      <div className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-slate-900 tabular-nums">
        {fmtCurrency(valueCents)}
      </div>
      <div className="mt-1 flex items-center justify-between text-xs text-slate-500">
        <span>{sublineLeft ?? ''}</span>
        {change ? <ChangeChip change={change} /> : <span />}
      </div>
    </div>
  );
}

function ChangeChip({ change }: { change: { amount: number; unit: 'pct' | 'pp'; direction: ChangeDirection } }) {
  const tone =
    change.direction === 'up'   ? 'text-emerald-600' :
    change.direction === 'down' ? 'text-rose-600'    :
                                   'text-slate-500';
  const arrow =
    change.direction === 'up'   ? '▲' :
    change.direction === 'down' ? '▼' :
                                   '–';
  const unitLabel = change.unit === 'pp' ? 'pp' : '';
  return (
    <span className={`inline-flex items-center gap-1 ${tone}`}>
      <span>{arrow}</span>
      <span>{fmtPct(change.amount, change.unit === 'pp' ? 1 : 1)}{unitLabel ? ' ' + unitLabel : ''}</span>
    </span>
  );
}
