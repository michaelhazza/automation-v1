import { useState } from 'react';
import api from '../../lib/api';
import type { TaskProjection } from '../../../../shared/types/taskProjection';
import { OperatorChainLinkIndicator } from './OperatorChainLinkIndicator.js';
import { OperatorAutoExtendBanner } from './OperatorAutoExtendBanner.js';

// Operator-specific metadata passed by OpenTaskView when the task is running
// under the operator_managed backend.
export interface OperatorChainMeta {
  isOperator: true;
  isAutoExtending: boolean;
  // Running state
  chainSeq?: number;
  estimatedTotalLinks?: number | null;
  // Terminal state
  totalLinks?: number;
  totalElapsedMs?: number;
  isTerminal: boolean;
}

interface TaskHeaderProps {
  taskId: string;
  taskTitle: string;
  projection: TaskProjection;
  canPauseStop: boolean;
  onAction?: () => void;
  operatorMeta?: OperatorChainMeta;
}

export function TaskHeader({ taskId, taskTitle, projection, canPauseStop, onAction, operatorMeta }: TaskHeaderProps) {
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

  const isAutoExtending = operatorMeta?.isAutoExtending ?? false;

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
      : isAutoExtending
        ? 'bg-amber-100 text-amber-700'
        : projection.runStatus?.startsWith('paused')
          ? 'bg-amber-100 text-amber-700'
          : 'bg-green-100 text-green-700';

  // Sub-label distinguishes auto-extend amber from paused amber (spec open question 5).
  const subLabel = isAutoExtending ? 'Extending' : undefined;

  const showPause =
    canPauseStop &&
    !isAutoExtending &&
    !projection.runStatus?.startsWith('paused') &&
    projection.runStatus !== 'stopped';

  const showStop =
    canPauseStop &&
    !projection.runStatus?.startsWith('paused') &&
    projection.runStatus !== 'stopped';

  const operatorIndicator =
    operatorMeta?.isOperator ? (
      operatorMeta.isTerminal &&
      operatorMeta.totalLinks !== undefined &&
      operatorMeta.totalElapsedMs !== undefined ? (
        <OperatorChainLinkIndicator
          variant="terminal"
          totalLinks={operatorMeta.totalLinks}
          totalElapsedMs={operatorMeta.totalElapsedMs}
        />
      ) : operatorMeta.chainSeq !== undefined ? (
        <OperatorChainLinkIndicator
          variant="running"
          chainSeq={operatorMeta.chainSeq}
          estimatedTotalLinks={operatorMeta.estimatedTotalLinks ?? null}
        />
      ) : null
    ) : null;

  return (
    <div>
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-white">
        <div className="flex items-center gap-3">
          <h1 className="text-[15px] font-semibold text-slate-900 truncate max-w-[320px]">{taskTitle}</h1>
          <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${badgeColor}`}>
            {subLabel ? subLabel : statusBadge}
          </span>
          {projection.isDegraded && (
            <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-orange-100 text-orange-700">Degraded</span>
          )}
          {operatorIndicator}
        </div>
        <div className="flex items-center gap-2">
          {showPause && (
            <button
              onClick={handlePause}
              disabled={loading}
              className="px-3 py-1 text-[12px] border border-slate-200 text-slate-600 rounded-md hover:bg-slate-50 disabled:opacity-50"
            >
              Pause
            </button>
          )}
          {showStop && (
            <button
              onClick={handleStop}
              disabled={loading}
              className="px-3 py-1 text-[12px] border border-red-200 text-red-600 rounded-md hover:bg-red-50 disabled:opacity-50"
            >
              Stop
            </button>
          )}
          {inlineError && <span className="text-[11px] text-slate-500">{inlineError}</span>}
        </div>
      </div>
      {isAutoExtending && <OperatorAutoExtendBanner />}
    </div>
  );
}
