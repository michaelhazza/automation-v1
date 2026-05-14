import { FilterSelect } from '../atoms/FilterSelect';
import { FilterText } from '../atoms/FilterText';
import type { RoutingDistribution, RoutingFilters } from '../types';

interface RoutingFiltersProps {
  dist: RoutingDistribution | null;
  filters: RoutingFilters;
  onFilterChange: (next: RoutingFilters) => void;
}

export function RoutingFilters({ dist, filters, onFilterChange }: RoutingFiltersProps) {
  const setFilter = <K extends keyof RoutingFilters>(key: K, value: string) => {
    const next: RoutingFilters = { ...filters };
    if (value) next[key] = value;
    else delete next[key];
    onFilterChange(next);
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="flex flex-wrap gap-2 items-center">
        <FilterSelect label="Provider" value={filters.provider} options={dist ? Object.keys(dist.byProvider) : []} onChange={v => setFilter('provider', v)} />
        <FilterSelect label="Reason" value={filters.routingReason} options={['forced', 'ceiling', 'economy', 'fallback']} onChange={v => setFilter('routingReason', v)} />
        <FilterSelect label="Tier" value={filters.capabilityTier} options={['frontier', 'economy']} onChange={v => setFilter('capabilityTier', v)} />
        <FilterSelect label="Phase" value={filters.executionPhase} options={['planning', 'execution', 'synthesis']} onChange={v => setFilter('executionPhase', v)} />
        <FilterSelect label="Status" value={filters.status} options={dist ? Object.keys(dist.byStatus) : []} onChange={v => setFilter('status', v)} />
        <FilterSelect label="Downgraded" value={filters.wasDowngraded} options={['true', 'false']} onChange={v => setFilter('wasDowngraded', v)} />
        <FilterSelect label="Escalated" value={filters.wasEscalated} options={['true', 'false']} onChange={v => setFilter('wasEscalated', v)} />
        <FilterText label="Agent" value={filters.agentName} onChange={v => setFilter('agentName', v)} />
        <FilterText label="Run ID" value={filters.runId} onChange={v => setFilter('runId', v)} />
        {Object.keys(filters).length > 0 && (
          <button onClick={() => onFilterChange({})} className="text-[11px] text-indigo-600 hover:text-indigo-800 bg-transparent border-0 cursor-pointer font-semibold [font-family:inherit]">
            Clear all
          </button>
        )}
      </div>
    </div>
  );
}
