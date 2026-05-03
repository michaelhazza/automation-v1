/**
 * PauseCard — pause gate rendered in the Chat pane.
 *
 * Shows the pause reason and offers Stop or Continue (with extension).
 * Defaults: 250 cents ($2.50) / 1800 seconds (30 min).
 *
 * Spec: docs/workflows-dev-spec.md §7.2, §7.5.
 */

import { useState } from 'react';
import api from '../../lib/api.js';

interface PauseCardProps {
  reason: 'cost_ceiling' | 'wall_clock' | 'by_user' | null;
  taskId: string;
  onResumed?: () => void;
  onStopped?: () => void;
}

const REASON_LABELS: Record<string, string> = {
  cost_ceiling: 'Paused: cost ceiling reached',
  wall_clock:   'Paused: time cap hit',
  by_user:      'Paused by user',
};

export default function PauseCard({ reason, taskId, onResumed, onStopped }: PauseCardProps) {
  const [extCostCents, setExtCostCents] = useState(250);
  const [extSeconds, setExtSeconds] = useState(1800);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [maxExtReached, setMaxExtReached] = useState(false);

  const isCapTriggered = reason === 'cost_ceiling' || reason === 'wall_clock';

  async function handleContinue() {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const body = isCapTriggered
        ? { extendCostCents: extCostCents, extendSeconds: extSeconds }
        : {};
      await api.post(`/api/tasks/${taskId}/run/resume`, body);
      onResumed?.();
    } catch (err: unknown) {
      const data = (err as { response?: { data?: { error?: string } } })?.response?.data;
      if (data?.error === 'extension_cap_reached') {
        setMaxExtReached(true);
      } else {
        setError(data?.error ?? 'Failed to resume');
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleStop() {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.post(`/api/tasks/${taskId}/run/stop`);
      onStopped?.();
    } catch (err: unknown) {
      setError(
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to stop',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-4 my-2 rounded-lg border border-amber-700/60 bg-amber-900/20 px-4 py-3 space-y-3">
      <p className="text-[13.5px] font-medium text-amber-300">
        {REASON_LABELS[reason ?? ''] ?? 'Paused'}
      </p>

      {maxExtReached && (
        <p className="text-[12px] text-red-400">Max extensions used. Stop the run to proceed.</p>
      )}

      {error && (
        <p className="text-[12px] text-red-400">{error}</p>
      )}

      {isCapTriggered && !maxExtReached && (
        <div className="space-y-2">
          <div className="flex gap-3">
            <label className="flex-1 space-y-0.5">
              <span className="block text-[11px] text-slate-400">Extra budget (cents)</span>
              <input
                type="number"
                min={1}
                max={10000}
                value={extCostCents}
                onChange={(e) => setExtCostCents(Number(e.target.value))}
                className="w-full rounded-md border border-slate-600 bg-slate-700 px-2 py-1 text-[13px] text-slate-200 outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </label>
            <label className="flex-1 space-y-0.5">
              <span className="block text-[11px] text-slate-400">Extra time (seconds)</span>
              <input
                type="number"
                min={1}
                max={86400}
                value={extSeconds}
                onChange={(e) => setExtSeconds(Number(e.target.value))}
                className="w-full rounded-md border border-slate-600 bg-slate-700 px-2 py-1 text-[13px] text-slate-200 outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </label>
          </div>
        </div>
      )}

      <div className="flex gap-2">
        {!maxExtReached && (
          <button
            type="button"
            onClick={handleContinue}
            disabled={submitting}
            className="flex-1 rounded-md bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 px-3 py-1.5 text-[13px] font-medium text-white transition-colors"
          >
            {submitting ? 'Working...' : 'Continue'}
          </button>
        )}
        <button
          type="button"
          onClick={handleStop}
          disabled={submitting}
          className="flex-1 rounded-md border border-red-700/60 hover:bg-red-900/30 disabled:opacity-50 px-3 py-1.5 text-[13px] font-medium text-red-400 transition-colors"
        >
          Stop run
        </button>
      </div>
    </div>
  );
}
