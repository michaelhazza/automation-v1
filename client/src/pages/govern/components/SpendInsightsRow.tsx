// client/src/pages/govern/components/SpendInsightsRow.tsx
// Govern surface — Spend Insights tiles (org view, org-admin only).
// Spec: tasks/builds/consolidation-govern/spec.md §4.4, §4.14

import type { SpendInsights } from '../../../../../shared/types/govern.js';

const fmt = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function pctLabel(deltaPct: number | null): string {
  if (deltaPct === null) return '—';
  const sign = deltaPct >= 0 ? '+' : '';
  return `${sign}${deltaPct.toFixed(1)}%`;
}

interface InsightTileProps {
  title: string;
  primary: string;
  secondary?: string;
}

function InsightTile({ title, primary, secondary }: InsightTileProps) {
  return (
    <div className="flex-1 min-w-0 rounded-lg border border-slate-200 bg-white px-4 py-3">
      <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">{title}</p>
      <p className="text-base font-semibold text-slate-900 truncate">{primary}</p>
      {secondary && (
        <p className="text-xs text-slate-500 mt-0.5 truncate">{secondary}</p>
      )}
    </div>
  );
}

interface Props {
  insights: SpendInsights;
}

export function SpendInsightsRow({ insights }: Props) {
  return (
    <div className="flex gap-3 mb-4">
      {insights.topSpender ? (
        <InsightTile
          title="Top Spender"
          primary={`${insights.topSpender.workspace.name} — ${fmt.format(insights.topSpender.mtdUsd)}`}
          secondary={`MTD delta: ${pctLabel(insights.topSpender.deltaPct)}`}
        />
      ) : (
        <InsightTile title="Top Spender" primary="—" />
      )}

      {insights.fastestGrower ? (
        <InsightTile
          title="Fastest Grower"
          primary={insights.fastestGrower.workspace.name}
          secondary={`Growth: ${pctLabel(insights.fastestGrower.deltaPct)}`}
        />
      ) : (
        <InsightTile title="Fastest Grower" primary="—" />
      )}

      {insights.mostActiveAgent ? (
        <InsightTile
          title="Most Active Agent"
          primary={insights.mostActiveAgent.agent.name}
          secondary={`${insights.mostActiveAgent.runs30d} runs in 30d — ${insights.mostActiveAgent.workspace.name}`}
        />
      ) : (
        <InsightTile title="Most Active Agent" primary="—" />
      )}
    </div>
  );
}
