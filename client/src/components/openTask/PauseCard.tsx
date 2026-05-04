import { useState } from 'react';
import api from '../../lib/api';

interface PauseCardProps {
  taskId: string;
  reason: 'paused' | 'paused_cost' | 'paused_wall_clock';
  onResume?: () => void;
  onStop?: () => void;
}

export function PauseCard({ taskId, reason, onResume, onStop }: PauseCardProps) {
  const [loading, setLoading] = useState(false);

  const handleResume = async () => {
    setLoading(true);
    try {
      await api.post(`/api/tasks/${taskId}/run/resume`);
      onResume?.();
    } finally {
      setLoading(false);
    }
  };

  const handleStop = async () => {
    setLoading(true);
    try {
      await api.post(`/api/tasks/${taskId}/run/stop`);
      onStop?.();
    } finally {
      setLoading(false);
    }
  };

  const label =
    reason === 'paused_cost'
      ? 'Cost ceiling reached'
      : reason === 'paused_wall_clock'
        ? 'Time limit reached'
        : 'Paused';

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 mb-2">
      <p className="text-[13px] font-semibold text-amber-800">{label}</p>
      <div className="flex gap-2 mt-2">
        <button
          onClick={handleResume}
          disabled={loading}
          className="px-3 py-1 text-[12px] bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50"
        >
          Continue
        </button>
        <button
          onClick={handleStop}
          disabled={loading}
          className="px-3 py-1 text-[12px] bg-red-50 text-red-600 border border-red-200 rounded-md hover:bg-red-100 disabled:opacity-50"
        >
          Stop
        </button>
      </div>
    </div>
  );
}
