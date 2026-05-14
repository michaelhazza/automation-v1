import { useState, useEffect, useCallback } from 'react';
import api from '../lib/api';
import type { AgentListItem } from '../../../shared/types/build';

export type AgentSummary = AgentListItem;

export function useUserOwnedAgents(): {
  data: AgentSummary[];
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
} {
  const [data, setData] = useState<AgentSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isError, setIsError] = useState(false);
  const [fetchTick, setFetchTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setIsError(false);

    api.get<{ agents: AgentSummary[] }>('/api/agents?ownerScope=user')
      .then(res => {
        if (!cancelled) {
          setData(res.data.agents ?? []);
          setIsLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setIsError(true);
          setIsLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [fetchTick]);

  const refetch = useCallback(() => setFetchTick(t => t + 1), []);

  return { data, isLoading, isError, refetch };
}
