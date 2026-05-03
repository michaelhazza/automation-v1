/**
 * TaskHeader — task name, status badge, Pause/Stop buttons.
 *
 * Pause / Stop buttons visible only to users in the §14.5 visibility set:
 * task requester, org admins / managers, subaccount admins on the task's subaccount.
 *
 * Spec: docs/workflows-dev-spec.md §9.5, §14.5.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { TaskStatus } from '../../hooks/useTaskProjectionPure.js';
import api from '../../lib/api.js';

interface TaskHeaderProps {
  taskId: string;
  taskName: string;
  status: TaskStatus;
  /** True when the current user has edit-access (requester, org admin/manager, subaccount admin). */
  canEditTask: boolean;
}

const STATUS_BADGE: Record<TaskStatus, string> = {
  pending:           'bg-slate-100 text-slate-600 border-slate-200',
  running:           'bg-blue-50 text-blue-700 border-blue-200',
  paused:            'bg-amber-50 text-amber-700 border-amber-200',
  awaiting_input:    'bg-violet-50 text-violet-700 border-violet-200',
  awaiting_approval: 'bg-amber-50 text-amber-700 border-amber-200',
  succeeded:         'bg-emerald-50 text-emerald-700 border-emerald-200',
  failed:            'bg-red-50 text-red-700 border-red-200',
  cancelled:         'bg-slate-100 text-slate-400 border-slate-200',
  partial:           'bg-amber-50 text-amber-700 border-amber-200',
};

const STATUS_LABEL: Record<TaskStatus, string> = {
  pending:           'Pending',
  running:           'Running',
  paused:            'Paused',
  awaiting_input:    'Awaiting input',
  awaiting_approval: 'Awaiting approval',
  succeeded:         'Done',
  failed:            'Failed',
  cancelled:         'Cancelled',
  partial:           'Degraded',
};

const TERMINAL_STATUSES: TaskStatus[] = ['succeeded', 'failed', 'cancelled'];

export default function TaskHeader({ taskId, taskName, status, canEditTask }: TaskHeaderProps) {
  const [pausing, setPausing] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const isTerminal = TERMINAL_STATUSES.includes(status);
  const isPaused = status === 'paused';

  async function handlePause() {
    if (pausing || isTerminal) return;
    setPausing(true);
    setActionError(null);
    try {
      // TODO: POST /api/tasks/:taskId/run/pause endpoint not yet implemented in Chunk 7.
      // Chunk 7 shipped resume and stop; pause was overlooked. Returns 404 until added.
      await api.post(`/api/tasks/${taskId}/run/pause`);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
        ?? 'Pause failed';
      setActionError(msg);
    } finally {
      setPausing(false);
    }
  }

  async function handleStop() {
    if (stopping || isTerminal) return;
    setStopping(true);
    setActionError(null);
    try {
      await api.post(`/api/tasks/${taskId}/run/stop`);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
        ?? 'Stop failed';
      setActionError(msg);
    } finally {
      setStopping(false);
    }
  }

  const badgeClass = STATUS_BADGE[status] ?? STATUS_BADGE.pending;

  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-700/50 bg-slate-900/60">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1 text-[12px] text-slate-500 shrink-0">
        <Link to="/tasks" className="hover:text-slate-300 transition-colors">Tasks</Link>
        <span>/</span>
        <span className="text-slate-400 max-w-[200px] truncate" title={taskName}>
          {taskName || taskId.slice(0, 8)}
        </span>
      </nav>

      <div className="flex-1 min-w-0" />

      {/* Status badge */}
      <span
        className={`shrink-0 text-[12px] font-semibold px-2.5 py-0.5 rounded-full border ${badgeClass}`}
      >
        {STATUS_LABEL[status]}
      </span>

      {/* Pause / Stop buttons — only for users with edit access, non-terminal runs */}
      {canEditTask && !isTerminal && (
        <div className="flex items-center gap-2 shrink-0">
          {!isPaused && (
            <button
              type="button"
              onClick={() => void handlePause()}
              disabled={pausing}
              className="rounded-md border border-amber-700/60 bg-amber-900/20 hover:bg-amber-900/40 disabled:opacity-50 px-3 py-1 text-[12px] font-medium text-amber-300 transition-colors"
              title="Pause this run"
            >
              {pausing ? '...' : 'Pause'}
            </button>
          )}
          <button
            type="button"
            onClick={() => void handleStop()}
            disabled={stopping}
            className="rounded-md border border-red-700/60 bg-red-900/20 hover:bg-red-900/40 disabled:opacity-50 px-3 py-1 text-[12px] font-medium text-red-400 transition-colors"
            title="Stop this run"
          >
            {stopping ? '...' : 'Stop'}
          </button>
        </div>
      )}

      {actionError && (
        <span className="text-[11.5px] text-red-400 shrink-0">{actionError}</span>
      )}
    </div>
  );
}
