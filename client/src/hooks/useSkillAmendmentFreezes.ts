import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../lib/api.js';
import type { FreezeScope, FreezeType } from '../../../shared/types/skillAmendments.js';

// ── Wire shape returned by GET /api/subaccounts/:id/skill-amendment-freezes ──

export interface FreezeRow {
  id: string;
  scope: FreezeScope;
  scopeId: string | null;
  freezeType: FreezeType;
  reason: string;
  createdByUserId: string | null;
  thawedAt: string | null;
  thawedByUserId: string | null;
  createdAt: string;
}

// ── useListFreezes ────────────────────────────────────────────────────────────

export interface UseListFreezesResult {
  freezes: FreezeRow[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useListFreezes(subaccountId: string): UseListFreezesResult {
  const [freezes, setFreezes] = useState<FreezeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const fetchData = useCallback(async () => {
    if (!subaccountId) return;
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get<FreezeRow[]>(
        `/api/subaccounts/${subaccountId}/skill-amendment-freezes`,
      );
      if (mountedRef.current) {
        setFreezes(data);
      }
    } catch {
      if (mountedRef.current) {
        setError('Failed to load freezes');
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [subaccountId]);

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;

    setLoading(true);
    setError(null);

    api.get<FreezeRow[]>(`/api/subaccounts/${subaccountId}/skill-amendment-freezes`)
      .then(({ data }) => {
        if (!cancelled && mountedRef.current) setFreezes(data);
      })
      .catch(() => {
        if (!cancelled && mountedRef.current) setError('Failed to load freezes');
      })
      .finally(() => {
        if (!cancelled && mountedRef.current) setLoading(false);
      });

    return () => {
      cancelled = true;
      mountedRef.current = false;
    };
  }, [subaccountId]);

  const refetch = useCallback(() => { void fetchData(); }, [fetchData]);

  return { freezes, loading, error, refetch };
}

// ── useFreezesMutations ───────────────────────────────────────────────────────

export interface FreezeMutations {
  create: (input: {
    scope: FreezeScope;
    scopeId?: string;
    freezeType: FreezeType;
    reason: string;
  }) => Promise<void>;
  thaw: (freezeId: string) => Promise<void>;
}

export function useFreezesMutations(
  subaccountId: string,
  onSuccess: () => void,
): FreezeMutations {
  const create = useCallback(
    async (input: {
      scope: FreezeScope;
      scopeId?: string;
      freezeType: FreezeType;
      reason: string;
    }) => {
      await api.post(
        `/api/subaccounts/${subaccountId}/skill-amendment-freezes`,
        {
          scope: input.scope,
          ...(input.scopeId ? { scopeId: input.scopeId } : {}),
          freezeType: input.freezeType,
          reason: input.reason,
        },
      );
      onSuccess();
    },
    [subaccountId, onSuccess],
  );

  const thaw = useCallback(
    async (freezeId: string) => {
      await api.delete(
        `/api/subaccounts/${subaccountId}/skill-amendment-freezes/${freezeId}`,
      );
      onSuccess();
    },
    [subaccountId, onSuccess],
  );

  return { create, thaw };
}
