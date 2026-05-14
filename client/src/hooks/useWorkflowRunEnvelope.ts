import { useCallback, useEffect, useState } from 'react';
import api from '../lib/api';
import { useSocketRoom, useSocketConnected } from './useSocket';
import type { Envelope } from '../components/workflow-run/types';
import { TERMINAL_RUN_STATUSES } from '../components/workflow-run/types';

export interface UseWorkflowRunEnvelopeResult {
  envelope: Envelope | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  socketConnected: boolean;
  selectedStepRunId: string | null;
  setSelectedStepRunId: (id: string | null) => void;
}

export function useWorkflowRunEnvelope(
  subaccountId: string | undefined,
  runId: string | undefined,
): UseWorkflowRunEnvelopeResult {
  const [envelope, setEnvelope] = useState<Envelope | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedStepRunId, setSelectedStepRunId] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!subaccountId || !runId) return;
    try {
      const res = await api.get(
        `/api/subaccounts/${subaccountId}/workflow-runs/${runId}/envelope`,
      );
      const env = res.data as Envelope;
      setEnvelope(env);
      setError(null);
      // Default selection: prefer existing selection if still present; else first
      // awaiting_* step; else first running step; else first step.
      setSelectedStepRunId((prev) => {
        if (prev && env.stepRuns.some((s) => s.id === prev)) return prev;
        const actionable = env.stepRuns.find(
          (s) => s.status === 'awaiting_approval' || s.status === 'awaiting_input',
        );
        if (actionable) return actionable.id;
        const running = env.stepRuns.find((s) => s.status === 'running');
        if (running) return running.id;
        return env.stepRuns[0]?.id ?? null;
      });
    } catch (err) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        (err instanceof Error ? err.message : 'Failed to load run');
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [subaccountId, runId]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  useSocketRoom(
    'workflow-run',
    runId ?? null,
    {
      'Workflow:run:status': () => refetch(),
      'Workflow:run:bulk_fanout': () => refetch(),
      'Workflow:step:dispatched': () => refetch(),
      'Workflow:step:completed': () => refetch(),
      'Workflow:step:failed': () => refetch(),
      'Workflow:step:awaiting_input': () => refetch(),
      'Workflow:step:awaiting_approval': () => refetch(),
      'Workflow:step:run_now_skipped_replay': () => refetch(),
    },
    refetch,
  );

  const socketConnected = useSocketConnected();

  useEffect(() => {
    if (!envelope) return;
    if (socketConnected) return;
    if (TERMINAL_RUN_STATUSES.includes(envelope.run.status)) return;
    const id = window.setInterval(() => {
      refetch();
    }, 12000);
    return () => window.clearInterval(id);
  }, [envelope, socketConnected, refetch]);

  return {
    envelope,
    loading,
    error,
    refetch,
    socketConnected,
    selectedStepRunId,
    setSelectedStepRunId,
  };
}
