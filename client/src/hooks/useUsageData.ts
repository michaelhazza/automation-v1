import { useEffect, useState, useCallback } from 'react';
import api from '../lib/api';
import type {
  UsageSummary,
  AgentUsageRow,
  ModelUsageRow,
  RunCostRow,
  DayBucket,
  RoutingDistribution,
  RoutingLogItem,
  IeeUsageRow,
  IeeUsageSummary,
  Tab,
  RoutingFilters,
  IeeFilters,
} from '../components/usage/types';

export function useUsageData(subaccountId: string | undefined, month: string) {
  const [summary, setSummary]     = useState<UsageSummary | null>(null);
  const [agents, setAgents]       = useState<AgentUsageRow[]>([]);
  const [models, setModels]       = useState<ModelUsageRow[]>([]);
  const [runs, setRuns]           = useState<RunCostRow[]>([]);
  const [daily, setDaily]         = useState<DayBucket[]>([]);
  const [loading, setLoading]     = useState(true);
  const [tabLoading, setTabLoading] = useState(false);

  // Routing tab state
  const [routingDist, setRoutingDist]                   = useState<RoutingDistribution | null>(null);
  const [routingLog, setRoutingLog]                     = useState<RoutingLogItem[]>([]);
  const [routingNextCursor, setRoutingNextCursor]       = useState<string | null>(null);
  const [routingNextCursorId, setRoutingNextCursorId]   = useState<string | null>(null);
  const [routingLoadingMore, setRoutingLoadingMore]     = useState(false);
  const [selectedRequest, setSelectedRequest]           = useState<RoutingLogItem | null>(null);
  const [routingFilters, setRoutingFilters]             = useState<RoutingFilters>({});

  // IEE tab state
  const [ieeRows,    setIeeRows]    = useState<IeeUsageRow[]>([]);
  const [ieeSummary, setIeeSummary] = useState<IeeUsageSummary | null>(null);
  const [ieeFilters, setIeeFilters] = useState<IeeFilters>({ types: '', statuses: '', minCostCents: '', search: '' });

  // Load summary + daily activity on month change
  useEffect(() => {
    if (!subaccountId) return;
    setLoading(true);
    Promise.all([
      api.get(`/api/subaccounts/${subaccountId}/usage/summary`, { params: { month } }),
      api.get('/api/agent-activity/daily', { params: { subaccountId, sinceDays: 14 } }),
    ]).then(([s, d]) => {
      setSummary(s.data);
      setDaily(d.data);
    }).catch((err) => console.error('[UsagePage] Failed to load usage data:', err)).finally(() => setLoading(false));
  }, [subaccountId, month]);

  const loadTab = useCallback(async (t: Tab) => {
    if (!subaccountId) return;
    setTabLoading(true);
    try {
      if (t === 'agents') {
        const { data } = await api.get(`/api/subaccounts/${subaccountId}/usage/agents`, { params: { month } });
        setAgents(data.agents ?? []);
      } else if (t === 'models') {
        const { data } = await api.get(`/api/subaccounts/${subaccountId}/usage/models`, { params: { month } });
        setModels(data.models ?? []);
      } else if (t === 'runs') {
        const { data } = await api.get(`/api/subaccounts/${subaccountId}/usage/runs`);
        setRuns(data.runs ?? []);
      } else if (t === 'routing') {
        const params: Record<string, string> = { month, ...(routingFilters as Record<string, string>) };
        const [distRes, logRes] = await Promise.all([
          api.get(`/api/subaccounts/${subaccountId}/usage/routing-distribution`, { params: { month } }),
          api.get(`/api/subaccounts/${subaccountId}/usage/routing-log`, { params }),
        ]);
        setRoutingDist(distRes.data);
        setRoutingLog(logRes.data.items ?? []);
        setRoutingNextCursor(logRes.data.nextCursor);
        setRoutingNextCursorId(logRes.data.nextCursorId);
        setSelectedRequest(null);
      } else if (t === 'iee') {
        // §11.8.6 — single-endpoint cursor-paginated query.
        // Date range = the active month so the IEE tab inherits the page-level
        // month picker. The user can refine via the IEE-specific filters.
        const monthStart = new Date(`${month}-01T00:00:00Z`).toISOString();
        const monthEndDate = new Date(`${month}-01T00:00:00Z`);
        monthEndDate.setUTCMonth(monthEndDate.getUTCMonth() + 1);
        const monthEnd = monthEndDate.toISOString();
        const params: Record<string, string> = {
          from: monthStart,
          to:   monthEnd,
          sort: 'startedAt',
          order: 'desc',
          limit: '50',
        };
        if (ieeFilters.types)        params.types        = ieeFilters.types;
        if (ieeFilters.statuses)     params.statuses     = ieeFilters.statuses;
        if (ieeFilters.minCostCents) params.minCostCents = ieeFilters.minCostCents;
        if (ieeFilters.search)       params.search       = ieeFilters.search;
        const { data } = await api.get(`/api/subaccounts/${subaccountId}/iee/usage`, { params });
        setIeeRows(data.rows ?? []);
        setIeeSummary(data.summary ?? null);
      }
    } catch { /* ignore */ }
    finally { setTabLoading(false); }
  }, [subaccountId, month, routingFilters, ieeFilters]);

  const routingLoadMore = useCallback(async () => {
    if (!routingNextCursor || !routingNextCursorId || !subaccountId) return;
    setRoutingLoadingMore(true);
    try {
      const params: Record<string, string> = { month, ...(routingFilters as Record<string, string>), cursor: routingNextCursor, cursorId: routingNextCursorId };
      const { data } = await api.get(`/api/subaccounts/${subaccountId}/usage/routing-log`, { params });
      setRoutingLog(prev => [...prev, ...(data.items ?? [])]);
      setRoutingNextCursor(data.nextCursor);
      setRoutingNextCursorId(data.nextCursorId);
    } catch { /* ignore */ }
    finally { setRoutingLoadingMore(false); }
  }, [subaccountId, month, routingFilters, routingNextCursor, routingNextCursorId]);

  return {
    summary,
    daily,
    loading,
    tabLoading,
    agents,
    models,
    runs,
    routing: {
      distribution: routingDist,
      log: routingLog,
      nextCursor: routingNextCursor,
      nextCursorId: routingNextCursorId,
      loadingMore: routingLoadingMore,
      selectedRequest,
      filters: routingFilters,
      tabLoading,
    },
    iee: {
      rows: ieeRows,
      summary: ieeSummary,
      filters: ieeFilters,
      tabLoading,
    },
    loadTab,
    setRoutingFilters,
    setIeeFilters,
    routingLoadMore,
    selectRequest: setSelectedRequest,
  };
}
