import { useState, useEffect, useCallback } from 'react';
import api from '../lib/api';
import type { VoiceProfile } from '../../../shared/types/voiceProfile';

export type { VoiceProfile };

export function useVoiceProfile(profileId?: string): {
  data: VoiceProfile | null;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
} {
  const [data, setData] = useState<VoiceProfile | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isError, setIsError] = useState(false);
  const [fetchTick, setFetchTick] = useState(0);

  useEffect(() => {
    if (!profileId) {
      setData(null);
      setIsLoading(false);
      setIsError(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setIsError(false);

    api.get<VoiceProfile>(`/api/voice-profiles/${profileId}`)
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
  }, [profileId, fetchTick]);

  const refetch = useCallback(() => setFetchTick(t => t + 1), []);

  return { data, isLoading, isError, refetch };
}

export function useOptOutVoiceProfile(): {
  optOut: (profileId: string) => Promise<void>;
  isPending: boolean;
  error: string | null;
} {
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const optOut = useCallback(async (profileId: string) => {
    if (isPending) return;
    setIsPending(true);
    setError(null);
    try {
      await api.post(`/api/voice-profiles/${profileId}/opt-out`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to opt out');
      throw err;
    } finally {
      setIsPending(false);
    }
  }, [isPending]);

  return { optOut, isPending, error };
}

export function useRefreshVoiceProfile(): {
  refresh: (profileId: string) => Promise<void>;
  isPending: boolean;
  error: string | null;
} {
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (profileId: string) => {
    if (isPending) return;
    setIsPending(true);
    setError(null);
    try {
      await api.post(`/api/voice-profiles/${profileId}/refresh`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to refresh voice profile');
      throw err;
    } finally {
      setIsPending(false);
    }
  }, [isPending]);

  return { refresh, isPending, error };
}
