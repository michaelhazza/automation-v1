import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../lib/api';
import { useSocketRoom } from './useSocket';

export type PulseLane = 'client' | 'major' | 'internal';

export interface PulseItem {
  id: string;
  kind: 'review' | 'task' | 'failed_run' | 'health_finding';
  lane: PulseLane;
  title: string;
  reasoning: string | null;
  evidence: Record<string, unknown> | null;
  costSummary: string;
  estimatedCostMinor: number | null;
  reversible: boolean;
  ackText: string | null;
  ackAmountMinor: number | null;
  ackCurrencyCode: string | null;
  subaccountId: string;
  subaccountName: string;
  agentId: string | null;
  agentName: string | null;
  createdAt: string;
  detailUrl: string;
  actionType: string | null;
  runId: string | null;
}

export interface PulseWarning {
  source: 'reviews' | 'tasks' | 'runs' | 'health';
  type: 'timeout' | 'error';
}

export interface PulseAttentionResponse {
  lanes: { client: PulseItem[]; major: PulseItem[]; internal: PulseItem[] };
  counts: { client: number; major: number; internal: number; total: number };
  warnings: PulseWarning[];
  isPartial: boolean;
  generatedAt: string;
}

interface UsePulseAttentionArgs {
  scope: 'org' | 'subaccount';
  subaccountId?: string;
}

export function usePulseAttention({ scope, subaccountId }: UsePulseAttentionArgs) {
  const [data, setData] = useState<PulseAttentionResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mergeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const url = scope === 'org'
    ? '/api/pulse/attention'
    : `/api/subaccounts/${subaccountId}/pulse/attention`;

  const fetchData = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const res = await api.get(url);
      setData(res.data);
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      const message = status === 403
        ? 'You do not have org-level review permission. Select a client from the sidebar to view their Pulse feed.'
        : err instanceof Error ? err.message : 'Failed to load Pulse data';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [url]);

  useEffect(() => {
    fetchData();
    return () => {
      if (mergeTimerRef.current) {
        clearTimeout(mergeTimerRef.current);
        mergeTimerRef.current = null;
      }
    };
  }, [fetchData]);

  // WebSocket merge — debounced to absorb event storms
  const mergeFromEvent = useCallback(async () => {
    if (mergeTimerRef.current) return;
    mergeTimerRef.current = setTimeout(async () => {
      mergeTimerRef.current = null;
      await fetchData();
    }, 300);
  }, [fetchData]);

  // Optimistic removal on approve
  const removeItem = useCallback((itemId: string) => {
    setData(prev => {
      if (!prev) return prev;
      const lanes = {
        client: prev.lanes.client.filter(i => i.id !== itemId),
        major: prev.lanes.major.filter(i => i.id !== itemId),
        internal: prev.lanes.internal.filter(i => i.id !== itemId),
      };
      return {
        ...prev,
        lanes,
        counts: {
          client: lanes.client.length,
          major: lanes.major.length,
          internal: lanes.internal.length,
          total: lanes.client.length + lanes.major.length + lanes.internal.length,
        },
      };
    });
  }, []);

  // Subscribe to relevant WebSocket events
  const roomType = scope === 'org' ? 'org' : 'subaccount';
  const roomId = scope === 'org' ? 'current' : subaccountId || '';

  useSocketRoom(roomType, roomId, {
    'review:item_created': mergeFromEvent,
    'review:item_updated': mergeFromEvent,
    'task:status_changed': mergeFromEvent,
    'agent:run:failed': mergeFromEvent,
    'workspace_health:finding_created': mergeFromEvent,
  }, fetchData);

  return { attention: data, isLoading, error, refetch: fetchData, removeItem };
}
