import { useState, useEffect } from 'react';
import api from '../lib/api.js';
import type { AmendmentKind } from '../../../shared/types/skillAmendments.js';

// ── Client-side mirror of SnapshotSummary from skillCompositionSnapshotService ─

export interface SnapshotAmendmentIncluded {
  id: string;
  kind: AmendmentKind;
  activatedAt: string;
  bodyPreview: string;
}

export interface SnapshotAmendmentExcluded {
  id: string;
  retirementReason: string | null;
}

export interface SnapshotSummary {
  resolverVersion: string;
  composedSizeChars: number;
  amendmentVersionSetHash: string;
  includedAmendments: SnapshotAmendmentIncluded[];
  excludedAmendments: SnapshotAmendmentExcluded[];
  truncated: boolean;
}

// ── useCompositionSnapshot ────────────────────────────────────────────────────

export interface UseCompositionSnapshotResult {
  snapshot: SnapshotSummary | null;
  loading: boolean;
  error: string | null;
}

export function useCompositionSnapshot(runId: string | null): UseCompositionSnapshotResult {
  const [snapshot, setSnapshot] = useState<SnapshotSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!runId) {
      setSnapshot(null);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    api.get<SnapshotSummary | null>(`/api/agent-runs/${runId}/skill-composition-snapshot`)
      .then(({ data }) => {
        if (!cancelled) setSnapshot(data);
      })
      .catch(() => {
        if (!cancelled) setError('Failed to load composition snapshot');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [runId]);

  return { snapshot, loading, error };
}
