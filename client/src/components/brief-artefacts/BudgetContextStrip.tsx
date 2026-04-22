interface BudgetContextStripProps {
  costCents: number;
  source?: string;
  freshnessMs?: number;
}

function formatCost(cents: number): string {
  if (cents < 1) return '<$0.01';
  return `$${(cents / 100).toFixed(2)}`;
}

function formatFreshness(ms: number): string {
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  return `${Math.round(ms / 3_600_000)}h ago`;
}

export function BudgetContextStrip({ costCents, source, freshnessMs }: BudgetContextStripProps) {
  const showSource = source && (source === 'hybrid' || (source === 'canonical' && freshnessMs && freshnessMs > 60_000));
  return (
    <div className="flex items-center gap-3 text-xs text-gray-400 mt-2 pt-2 border-t border-gray-100">
      <span>{formatCost(costCents)}</span>
      {showSource && (
        <span className="capitalize">{source}{freshnessMs ? ` · data from ${formatFreshness(freshnessMs)}` : ''}</span>
      )}
    </div>
  );
}
