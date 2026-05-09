import { useState, useEffect } from 'react';
import api from '../lib/api';

export interface WorkingTimeBucket {
  date: string;
  seconds: number;
}

interface WorkingTimeResponse {
  range: string;
  buckets: WorkingTimeBucket[];
  captionTotalSeconds: number;
  captionRunsCount: number;
  captionSuccessRate: number;
  captionAverageRunDurationSeconds: number;
}

export function useAgentWorkingTime(
  agentId: string,
  range: 'today' | 'week' | 'month' | 'quarter'
): {
  buckets: WorkingTimeBucket[];
  captionTotalSeconds: number;
  captionRunsCount: number;
  captionSuccessRate: number;
  captionAverageRunDurationSeconds: number;
  isLoading: boolean;
  isError: boolean;
} {
  const [data, setData] = useState<WorkingTimeResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isError, setIsError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setIsError(false);

    api.get<WorkingTimeResponse>(`/api/agents/${agentId}/working-time?range=${range}`)
      .then(res => {
        if (!cancelled) {
          setData(res.data);
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
  }, [agentId, range]);

  return {
    buckets: data?.buckets ?? [],
    captionTotalSeconds: data?.captionTotalSeconds ?? 0,
    captionRunsCount: data?.captionRunsCount ?? 0,
    captionSuccessRate: data?.captionSuccessRate ?? 0,
    captionAverageRunDurationSeconds: data?.captionAverageRunDurationSeconds ?? 0,
    isLoading,
    isError,
  };
}
