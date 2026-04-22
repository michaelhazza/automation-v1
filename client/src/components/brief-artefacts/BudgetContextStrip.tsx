import { shouldShowSource, formatCost, formatFreshness } from './BudgetContextStripPure.js';

interface BudgetContextStripProps {
  costCents: number;
  source?: string;
  freshnessMs?: number;
}

export function BudgetContextStrip({ costCents, source, freshnessMs }: BudgetContextStripProps) {
  const showSource = shouldShowSource(source, freshnessMs);
  return (
    <div className="flex items-center gap-3 text-xs text-gray-400 mt-2 pt-2 border-t border-gray-100">
      <span>{formatCost(costCents)}</span>
      {showSource && (
        <span className="capitalize">{source}{freshnessMs ? ` · data from ${formatFreshness(freshnessMs)}` : ''}</span>
      )}
    </div>
  );
}
