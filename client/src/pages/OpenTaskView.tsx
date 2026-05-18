import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { useTaskProjection } from '../hooks/useTaskProjection';
import { TaskHeader } from '../components/openTask/TaskHeader';
import { ChatPane } from '../components/openTask/ChatPane';
import { ActivityPane } from '../components/openTask/ActivityPane';
import { RightPaneTabs } from '../components/openTask/RightPaneTabs';
import type { User } from '../lib/auth';

interface TaskMeta {
  id: string;
  title: string;
  status: string;
  executionMode?: string | null;
}

// Operator task-level state returned by the task-intake endpoint when
// executionMode === 'operator_managed'.
interface OperatorTaskState {
  agentRunStatus?: string | null;
  chainSeq?: number | null;
  stepCount?: number | null;
  isAutoExtending?: boolean;
  totalElapsedMs?: number | null;
  totalLinks?: number | null;
}

export default function OpenTaskView({ user }: { user: User }) {
  const { taskId } = useParams<{ taskId: string }>();
  const navigate = useNavigate();
  const [taskMeta, setTaskMeta] = useState<TaskMeta | null>(null);
  const [operatorState, setOperatorState] = useState<OperatorTaskState | null>(null);
  const [loading, setLoading] = useState(true);
  const { projection, reconcileNow } = useTaskProjection(taskId);

  const canPauseStop =
    user.role === 'system_admin' || user.role === 'org_admin' || user.role === 'manager';

  useEffect(() => {
    if (!taskId) return;
    api.get<TaskMeta>(`/api/task-intake/${taskId}`)
      .then(({ data }) => {
        setTaskMeta(data);
        if (data.executionMode === 'operator_managed') {
          api.get<OperatorTaskState>(`/api/task-intake/${taskId}/operator-state`)
            .then(({ data: os }) => setOperatorState(os))
            .catch(() => setOperatorState(null));
        }
      })
      .catch((err) => {
        if (err?.response?.status === 404) navigate('/admin/tasks', { replace: true });
      })
      .finally(() => setLoading(false));
  }, [taskId, navigate]);

  if (loading) {
    return <div className="p-8 text-[13px] text-slate-400">Loading...</div>;
  }
  if (!taskMeta) return null;

  const isOperator = taskMeta.executionMode === 'operator_managed';

  const agentRunStatus = operatorState?.agentRunStatus ?? null;
  const isTerminal =
    agentRunStatus === 'completed' ||
    agentRunStatus === 'failed' ||
    agentRunStatus === 'cancelled';

  const operatorCopy = isOperator ? (() => {
    if (agentRunStatus === 'completed') {
      return (
        <div className="px-4 py-2 bg-indigo-50 border-b border-indigo-200 text-[12px] text-indigo-700">
          Operator session completed successfully.
        </div>
      );
    }
    if (agentRunStatus === 'failed') {
      return (
        <div className="px-4 py-2 bg-red-50 border-b border-red-200 text-[12px] text-red-700">
          Operator session ended with an error.
        </div>
      );
    }
    if (agentRunStatus === 'cancelled') {
      return (
        <div className="px-4 py-2 bg-slate-50 border-b border-slate-200 text-[12px] text-slate-500">
          Operator session was cancelled.
        </div>
      );
    }
    return null;
  })() : null;

  const operatorMeta = isOperator
    ? {
        isOperator: true as const,
        isAutoExtending: operatorState?.isAutoExtending ?? false,
        chainSeq: operatorState?.chainSeq ?? undefined,
        estimatedTotalLinks: null,
        isTerminal,
        totalLinks: operatorState?.totalLinks ?? undefined,
        totalElapsedMs: operatorState?.totalElapsedMs ?? undefined,
      }
    : undefined;

  return (
    <div className="flex flex-col h-screen bg-white">
      <TaskHeader
        taskId={taskId!}
        taskTitle={taskMeta.title}
        projection={projection}
        canPauseStop={canPauseStop}
        onAction={reconcileNow}
        operatorMeta={operatorMeta}
      />
      {projection.isDegraded && (
        <div className="px-4 py-2 bg-orange-50 border-b border-orange-200 text-[12px] text-orange-700">
          Event stream degraded. Some events may be missing. {projection.degradationReason}
        </div>
      )}
      {operatorCopy}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <div className="border-r border-slate-200 overflow-hidden flex flex-col" style={{ flex: '0 0 26%' }}>
          <ChatPane taskId={taskId!} projection={projection} operatorRunStatus={agentRunStatus} />
        </div>
        <div className="border-r border-slate-200 overflow-hidden flex flex-col" style={{ flex: '0 0 22%' }}>
          <ActivityPane projection={projection} operatorRunStatus={agentRunStatus} />
        </div>
        <div className="flex-1 overflow-hidden flex flex-col">
          <RightPaneTabs projection={projection} taskId={taskId!} files={projection.files} />
        </div>
      </div>
    </div>
  );
}
