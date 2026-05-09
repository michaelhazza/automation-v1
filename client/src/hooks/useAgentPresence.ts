import { useState, useEffect } from 'react';
import api from '../lib/api';
import type { AgentPresenceState, CurrentFocus } from '../../../shared/types/agentPresence';

interface AgentPresenceData {
  state: AgentPresenceState;
  subtitle: string | null;
  currentFocus: CurrentFocus | null;
  elapsedSinceRunStartMs: number | null;
  serverNow: string;
}

export function useAgentPresence(agentId: string): AgentPresenceData & {
  isLoading: boolean;
  isError: boolean;
} {
  const [data, setData] = useState<AgentPresenceData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isError, setIsError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setIsError(false);

    api.get<{ presence: AgentPresenceData }>(`/api/agents/${agentId}/overview`)
      .then(res => {
        if (!cancelled) {
          setData(res.data.presence);
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
  }, [agentId]);

  return {
    state: data?.state ?? 'idle',
    subtitle: data?.subtitle ?? null,
    currentFocus: data?.currentFocus ?? null,
    elapsedSinceRunStartMs: data?.elapsedSinceRunStartMs ?? null,
    serverNow: data?.serverNow ?? new Date().toISOString(),
    isLoading,
    isError,
  };
}
