import { useState } from 'react';
import api from '../../lib/api';
import type { TaskProjection } from '../../../../shared/types/taskProjection';

interface TaskHeaderProps {
  taskId: string;
  taskTitle: string;
  projection: TaskProjection;
  canPauseStop: boolean;
  onAction?: () => void;
}

export function TaskHeader({ taskId, taskTitle, projection, canPauseStop, onAction }: TaskHeaderProps) {
  const [loading, setLoading] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);

  const handlePause = async () => {
    setLoading(true);
    setInlineError(null);
    try {
      await api.post(`/api/tasks/${taskId}/run/pause`);
      onAction?.();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      if (e?.response?.data?.error === 'no_active_run_for_task') {
        setInlineError('No active workflow on this task.');
        onAction?.();
      }
    } finally {
      setLoading(false);
    }
  };

  const handleStop = async () => {
    setLoading(true);
    setInlineError(null);
    try {
      await api.post(`/api/tasks/${taskId}/run/stop`);
      onAction?.();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      if (e?.response?.data?.error === 'no_active_run_for_task') {
        setInlineError('No active workflow on this task.');
        onAction?.();
      }
    } finally {
      setLoading(false);
    }
  };

  const statusBadge = projection.runStatus
    ? (
        {
          paused: 'Paused',
          paused_cost: 'Paused',
          paused_wall_clock: 'Paused',
          stopped: 'Stopped',
          running: 'Running',
        } as Record<string, string>
      )[projection.runStatus] ?? 'Active'
    : 'Active';

  const badgeColor =
    projection.runStatus === 'stopped'
      ? 'bg-red-100 text-red-700'
      : projection.runStatus?.startsWith('paused')
        ? 'bg-amber-100 text-amber-700'
        : 'bg-green-100 text-green-700';

  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-white">
      <div className="flex items-center gap-3">
        <h1 className="text-[15px] font-semibold text-slate-900 truncate max-w-[320px]">{taskTitle}</h1>
        <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${badgeColor}`}>{statusBadge}</span>
        {projection.isDegraded && (
          <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-orange-100 text-orange-700">Degraded</span>
        )}
      </div>
      {canPauseStop && !projection.runStatus?.startsWith('paused') && projection.runStatus !== 'stopped' && (
        <div className="flex items-center">
          <button
            onClick={handlePause}
            disabled={loading}
            className="px-3 py-1 text-[12px] border border-slate-200 text-slate-600 rounded-md hover:bg-slate-50 disabled:opacity-50"
          >
            Pause
          </button>
          <button
            onClick={handleStop}
            disabled={loading}
            className="px-3 py-1 text-[12px] border border-red-200 text-red-600 rounded-md hover:bg-red-50 disabled:opacity-50 ml-2"
          >
            Stop
          </button>
          {inlineError && <span className="text-[11px] text-slate-500 ml-2">{inlineError}</span>}
        </div>
      )}
    </div>
  );
}
