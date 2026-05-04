/**
 * client/src/hooks/useAgentRecommendationsTotal.ts
 *
 * Lightweight count-only hook for the sidebar badge and any surface that needs
 * to know whether open recommendations exist without fetching their content.
 *
 * Uses limit=0 to short-circuit to a SELECT COUNT on the backend, avoiding
 * the cost of fetching row payloads.
 *
 * Spec: docs/sub-account-optimiser-spec.md §6.5
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import api from '../lib/api.js';
import { getSocket } from '../lib/socket.js';

export type RecommendationsTotalScope =
  | { type: 'org'; id: string }
  | { type: 'subaccount'; id: string };

const DEBOUNCE_MS = 250;

/**
 * Returns the count of open recommendations for the given scope, or `null`
 * while the initial fetch is in flight.
 *
 * Pass `null` for `scope` to disable the hook (returns `null` immediately,
 * fires no requests).
 */
export function useAgentRecommendationsTotal(
  scope: RecommendationsTotalScope | null,
): number | null {
  const [total, setTotal] = useState<number | null>(null);
  const mountedRef = useRef(true);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchCount = useCallback(async () => {
    if (!scope) return;

    try {
      const params = new URLSearchParams({
        scopeType: scope.type,
        scopeId: scope.id,
        // includeDescendantSubaccounts is only relevant for org scope
        ...(scope.type === 'org' ? { includeDescendantSubaccounts: 'true' } : {}),
        limit: '0',
      });

      const res = await api.get<{ rows: unknown[]; total: number }>(
        `/api/recommendations?${params.toString()}`,
      );

      if (!mountedRef.current) return;
      setTotal(res.data.total);
    } catch {
      // Swallow — badge stays null (no flash of incorrect count)
    }
  }, [scope]);

  useEffect(() => {
    mountedRef.current = true;

    if (!scope) {
      setTotal(null);
      return () => {
        mountedRef.current = false;
      };
    }

    setTotal(null);
    void fetchCount();

    return () => {
      mountedRef.current = false;
    };
  }, [fetchCount, scope]);

  // Socket subscription: re-fetch count on recommendations change (250ms debounce)
  useEffect(() => {
    if (!scope) return;

    const socket = getSocket();
    if (!socket) return;

    const handleChange = () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(() => {
        if (mountedRef.current) void fetchCount();
        debounceTimerRef.current = null;
      }, DEBOUNCE_MS);
    };

    socket.on('dashboard.recommendations.changed', handleChange);

    return () => {
      socket.off('dashboard.recommendations.changed', handleChange);
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [fetchCount, scope]);

  return total;
}
