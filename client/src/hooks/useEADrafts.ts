import { useState, useEffect, useCallback } from 'react';
import api from '../lib/api';
import type { EADraft } from '../../../shared/types/eaDraft';

export type { EADraft };

export function useEADrafts(): {
  data: EADraft[];
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
} {
  const [data, setData] = useState<EADraft[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isError, setIsError] = useState(false);
  const [fetchTick, setFetchTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setIsError(false);

    api.get<{ drafts: EADraft[] }>('/api/ea-drafts')
      .then(res => {
        if (!cancelled) {
          setData(res.data.drafts ?? []);
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

export function useApproveEADraft(onSuccess?: () => void): {
  approve: (draftId: string) => Promise<void>;
  isPending: boolean;
  error: string | null;
} {
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const approve = useCallback(async (draftId: string) => {
    if (isPending) return;
    setIsPending(true);
    setError(null);
    try {
      await api.post(`/api/ea-drafts/${draftId}/approve`);
      onSuccess?.();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to approve draft');
      throw err;
    } finally {
      setIsPending(false);
    }
  }, [isPending, onSuccess]);

  return { approve, isPending, error };
}

export function useRejectEADraft(onSuccess?: () => void): {
  reject: (draftId: string) => Promise<void>;
  isPending: boolean;
  error: string | null;
} {
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reject = useCallback(async (draftId: string) => {
    if (isPending) return;
    setIsPending(true);
    setError(null);
    try {
      await api.post(`/api/ea-drafts/${draftId}/reject`);
      onSuccess?.();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to reject draft');
      throw err;
    } finally {
      setIsPending(false);
    }
  }, [isPending, onSuccess]);

  return { reject, isPending, error };
}

export function useRetryEADraft(onSuccess?: () => void): {
  retry: (draftId: string) => Promise<void>;
  isPending: boolean;
  error: string | null;
} {
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const retry = useCallback(async (draftId: string) => {
    if (isPending) return;
    setIsPending(true);
    setError(null);
    try {
      await api.post(`/api/ea-drafts/${draftId}/retry`);
      onSuccess?.();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to retry draft');
      throw err;
    } finally {
      setIsPending(false);
    }
  }, [isPending, onSuccess]);

  return { retry, isPending, error };
}
