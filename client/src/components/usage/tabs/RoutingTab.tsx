import { SHIMMER_CLASS } from '../constants';
import type { RoutingDistribution, RoutingLogItem, RoutingFilters } from '../types';
import { RoutingAnomalies } from './RoutingAnomalies';
import { RoutingDistribution as RoutingDistributionPanel } from './RoutingDistribution';
import { RoutingFilters as RoutingFiltersBar } from './RoutingFilters';
import { RoutingLogTable } from './RoutingLogTable';
import { RequestDetailDrawer } from './RequestDetailDrawer';

interface RoutingTabProps {
  subaccountId: string;
  month: string;
  distribution: RoutingDistribution | null;
  log: RoutingLogItem[];
  nextCursor: string | null;
  nextCursorId: string | null;
  loadingMore: boolean;
  selectedRequest: RoutingLogItem | null;
  filters: RoutingFilters;
  tabLoading: boolean;
  onFilterChange: (f: RoutingFilters) => void;
  onLoadMore: () => void;
  onSelectRequest: (r: RoutingLogItem | null) => void;
}

export function RoutingTab({
  subaccountId: _subaccountId,
  month: _month,
  distribution,
  log,
  nextCursor,
  nextCursorId,
  loadingMore,
  selectedRequest,
  filters,
  tabLoading,
  onFilterChange,
  onLoadMore,
  onSelectRequest,
}: RoutingTabProps) {
  if (tabLoading && !distribution) {
    return (
      <div className="space-y-4">
        <div className={`h-20 ${SHIMMER_CLASS}`} />
        <div className={`h-48 ${SHIMMER_CLASS}`} />
        <div className={`h-64 ${SHIMMER_CLASS}`} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {distribution && distribution.totalRequests > 0 && (
        <RoutingAnomalies dist={distribution} />
      )}
      {distribution && distribution.totalRequests > 0 && (
        <RoutingDistributionPanel dist={distribution} />
      )}
      <RoutingFiltersBar dist={distribution} filters={filters} onFilterChange={onFilterChange} />
      <RoutingLogTable
        log={log}
        selectedRequest={selectedRequest}
        tabLoading={tabLoading}
        nextCursor={nextCursor}
        nextCursorId={nextCursorId}
        loadingMore={loadingMore}
        onSelectRequest={onSelectRequest}
        onLoadMore={onLoadMore}
      />
      {selectedRequest && (
        <RequestDetailDrawer request={selectedRequest} onClose={() => onSelectRequest(null)} />
      )}
    </div>
  );
}
