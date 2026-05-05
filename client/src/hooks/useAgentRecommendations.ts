/**
 * client/src/hooks/useAgentRecommendations.ts
 *
 * Fetch + socket-subscribe hook for agent_recommendations.
 * Subscribes to `dashboard.recommendations.changed` and refetches
 * with a 250ms trailing-window debounce on socket events.
 *
 * Spec: docs/sub-account-optimiser-spec.md §6.5 "Refetch debounce"
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import api from '../lib/api.js';
import { getSocket } from '../lib/socket.js';

export interface AgentRecommendationRowHook {
  id: string;
  scope_type: string;
  scope_id: string;
  subaccount_display_name?: string;
  category: string;
  severity: 'info' | 'warn' | 'critical';
  title: string;
  body: string;
  action_hint: string | null;
  evidence: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  acknowledged_at: string | null;
  dismissed_at: string | null;
}

export interface UseAgentRecommendationsParams {
  scopeType: 'org' | 'subaccount';
  scopeId: string;
  includeDescendantSubaccounts?: boolean;
  limit?: number;
}

export interface UseAgentRecommendationsResult {
  rows: AgentRecommendationRowHook[];
  total: number;
  latestUpdatedAt: Date | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

const DEBOUNCE_MS = 250;

export function useAgentRecommendations({
  scopeType,
  scopeId,
  includeDescendantSubaccounts = false,
  limit = 20,
}: UseAgentRecommendationsParams): UseAgentRecommendationsResult {
  const [rows, setRows] = useState<AgentRecommendationRowHook[]>([]);
  const [total, setTotal] = useState(0);
  const [latestUpdatedAt, setLatestUpdatedAt] = useState<Date | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const fetchData = useCallback(async () => {
    if (!scopeId) return;

    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        scopeType,
        scopeId,
        includeDescendantSubaccounts: String(includeDescendantSubaccounts),
        limit: String(Math.min(limit, 100)),
      });

      const res = await api.get<{
        rows: AgentRecommendationRowHook[];
        total: number;
      }>(`/api/recommendations?${params.toString()}`);

      if (!mountedRef.current) return;

      setRows(res.data.rows);
      setTotal(res.data.total);

      // Compute max updated_at
      if (res.data.rows.length > 0) {
        const maxTime = Math.max(
          ...res.data.rows.map((r) => new Date(r.updated_at).getTime()),
        );
        setLatestUpdatedAt(new Date(maxTime));
      } else {
        setLatestUpdatedAt(null);
      }
    } catch (err: unknown) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : 'Failed to fetch recommendations');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [scopeType, scopeId, includeDescendantSubaccounts, limit]);

  // Initial fetch
  useEffect(() => {
    mountedRef.current = true;
    void fetchData();

    return () => {
      mountedRef.current = false;
    };
  }, [fetchData]);

  // Socket subscription with 250ms trailing-window debounce
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const handleChange = () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = setTimeout(() => {
        if (mountedRef.current) {
          void fetchData();
        }
        debounceTimerRef.current = null;
      }, DEBOUNCE_MS);
    };

    socket.on('dashboard.recommendations.changed', handleChange);

    return () => {
      socket.off('dashboard.recommendations.changed', handleChange);
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [fetchData]);

  const refetch = useCallback(() => {
    void fetchData();
  }, [fetchData]);

  return { rows, total, latestUpdatedAt, loading, error, refetch };
}
