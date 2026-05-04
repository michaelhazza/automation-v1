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

  const handlePause = async () => {
    setLoading(true);
    try {
      await api.post(`/api/tasks/${taskId}/run/pause`);
      onAction?.();
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
        <button
          onClick={handlePause}
          disabled={loading}
          className="px-3 py-1 text-[12px] border border-slate-200 text-slate-600 rounded-md hover:bg-slate-50 disabled:opacity-50"
        >
          Pause
        </button>
      )}
    </div>
  );
}
