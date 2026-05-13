import { useState, useEffect, useCallback } from 'react';
import api from '../lib/api';
import type { HomeWidget } from '../../../shared/types/homeWidget';

export type { HomeWidget };

export function useHomeWidgets(): {
  data: HomeWidget[];
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
} {
  const [data, setData] = useState<HomeWidget[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isError, setIsError] = useState(false);
  const [fetchTick, setFetchTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setIsError(false);

    api.get<{ widgets: HomeWidget[] }>('/api/agent-home-widgets')
      .then(res => {
        if (!cancelled) {
          setData(res.data.widgets ?? []);
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
