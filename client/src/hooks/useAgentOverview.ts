import { useState, useEffect } from 'react';
import api from '../lib/api';
import type { AgentPresenceState, CurrentFocus } from '../../../shared/types/agentPresence';
import type { AgentObservation } from '../../../shared/types/agentObservations';

export interface OverviewPresence {
  state: AgentPresenceState;
  subtitle: string | null;
  activeRunId: string | null;
  currentFocus: CurrentFocus | null;
  elapsedSinceRunStartMs: number | null;
  serverNow: string;
}

export interface OverviewIdentity {
  id: string;
  name: string;
  role: string;
  reportsTo: string | null;
  subaccountId: string | null;
}

export interface AgentOverviewData {
  identity: OverviewIdentity;
  presence: OverviewPresence;
  activeGoals: unknown[];
  recentObservations: AgentObservation[];
  knowledgeInUse: unknown[];
  filesSnapshot: unknown[];
  toolsUsageBands: { frequently: string[]; occasionally: string[]; rarely: string[]; asOf: string; };
  schedulePeek: { nextRunAt: string | null; trigger: string | null; label: string | null; } | null;
  connectionsHealth: unknown[];
  workingTime: { range: string; buckets: Array<{ date: string; seconds: number }>; captionTotalSeconds: number; captionRunsCount: number; captionSuccessRate: number; captionAverageRunDurationSeconds: number; };
  activityFeed: Array<{ eventId: string; eventType: string; eventTimestamp: string; runId: string; }>;
}

export function useAgentOverview(agentId: string): {
  data: AgentOverviewData | null;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
} {
  const [data, setData] = useState<AgentOverviewData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isError, setIsError] = useState(false);
  const [fetchTick, setFetchTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setIsError(false);

    api.get<AgentOverviewData>(`/api/agents/${agentId}/overview`)
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
  }, [agentId, fetchTick]);

  return {
    data,
    isLoading,
    isError,
    refetch: () => setFetchTick(t => t + 1),
  };
}
