import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { useTaskProjection } from '../hooks/useTaskProjection';
import { TaskHeader } from '../components/openTask/TaskHeader';
import { ChatPane } from '../components/openTask/ChatPane';
import { ActivityPane } from '../components/openTask/ActivityPane';
import { RightPaneTabs } from '../components/openTask/RightPaneTabs';
import type { User } from '../lib/auth';

interface TaskMeta { id: string; title: string; status: string; }

export default function OpenTaskView({ user }: { user: User }) {
  const { taskId } = useParams<{ taskId: string }>();
  const navigate = useNavigate();
  const [taskMeta, setTaskMeta] = useState<TaskMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const { projection, reconcileNow } = useTaskProjection(taskId);

  const canPauseStop =
    user.role === 'system_admin' || user.role === 'org_admin' || user.role === 'manager';

  useEffect(() => {
    if (!taskId) return;
    // Brief id and task id are the same row (workflows-v1 task = legacy brief).
    // /api/briefs/:briefId returns { id, title, status, conversationId } —
    // extra conversationId field is harmless to TaskMeta consumers here.
    api.get<TaskMeta>(`/api/briefs/${taskId}`)
      .then(({ data }) => setTaskMeta(data))
      .catch((err) => {
        if (err?.response?.status === 404) navigate('/admin/tasks', { replace: true });
      })
      .finally(() => setLoading(false));
  }, [taskId, navigate]);

  if (loading) {
    return <div className="p-8 text-[13px] text-slate-400">Loading...</div>;
  }
  if (!taskMeta) return null;

  return (
    <div className="flex flex-col h-screen bg-white">
      <TaskHeader
        taskId={taskId!}
        taskTitle={taskMeta.title}
        projection={projection}
        canPauseStop={canPauseStop}
        onAction={reconcileNow}
      />
      {projection.isDegraded && (
        <div className="px-4 py-2 bg-orange-50 border-b border-orange-200 text-[12px] text-orange-700">
          Event stream degraded. Some events may be missing. {projection.degradationReason}
        </div>
      )}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <div className="border-r border-slate-200 overflow-hidden flex flex-col" style={{ flex: '0 0 26%' }}>
          <ChatPane taskId={taskId!} projection={projection} />
        </div>
        <div className="border-r border-slate-200 overflow-hidden flex flex-col" style={{ flex: '0 0 22%' }}>
          <ActivityPane projection={projection} />
        </div>
        <div className="flex-1 overflow-hidden flex flex-col">
          <RightPaneTabs projection={projection} taskId={taskId!} files={projection.files} />
        </div>
      </div>
    </div>
  );
}
