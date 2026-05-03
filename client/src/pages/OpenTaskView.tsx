/**
 * OpenTaskView — the open task three-pane layout.
 *
 * Route: /tasks/:taskId
 *
 * Three columns: Chat (26%) | Activity (22% / 36px collapsed) | Right pane (52% / ~74%)
 *
 * Loads task metadata via the replay endpoint (fromSeq=0 gives initial state),
 * subscribes to useTaskProjection for live updates.
 *
 * Spec: docs/workflows-dev-spec.md §9.
 */

import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import api from '../lib/api.js';
import { useTaskProjection } from '../hooks/useTaskProjection.js';
import ChatPane from '../components/openTask/ChatPane.js';
import ActivityPane from '../components/openTask/ActivityPane.js';
import RightPaneTabs from '../components/openTask/RightPaneTabs.js';
import TaskHeader from '../components/openTask/TaskHeader.js';
import type { User } from '../lib/auth.js';

interface OpenTaskViewProps {
  user: User;
}

/** Minimal task metadata from the tasks list/detail endpoint. */
interface TaskMeta {
  id: string;
  title: string;
  subaccountId: string | null;
  requesterUserId?: string | null;
}

/**
 * Determine whether the current user has edit access to the task.
 *
 * Per §14.5: task requester, org admin/manager, subaccount admin on the task's subaccount.
 * We use role-based check here; the server enforces the same rule on action endpoints.
 */
function resolveCanEdit(user: User, taskMeta: TaskMeta | null): boolean {
  if (!taskMeta) return false;
  const role = user.role;
  // System admin and org admin always have edit access
  if (role === 'system_admin' || role === 'org_admin') return true;
  // org_manager has edit access
  if (role === 'org_manager') return true;
  // Requester (checked client-side via taskMeta.requesterUserId when available)
  if (taskMeta.requesterUserId && taskMeta.requesterUserId === user.id) return true;
  // Other roles (subaccount_admin) — we can't easily check subaccount admin without
  // an extra API call. We'll conservatively grant edit to 'user' role who is the requester;
  // the server will reject unauthorized Pause/Stop calls anyway.
  return false;
}

export default function OpenTaskView({ user }: OpenTaskViewProps) {
  const { taskId } = useParams<{ taskId: string }>();

  const [taskMeta, setTaskMeta] = useState<TaskMeta | null>(null);
  const [activityCollapsed, setActivityCollapsed] = useState(false);

  const { projection, degraded } = useTaskProjection(taskId, taskMeta?.title);

  // Load task metadata. We use the replay endpoint at fromSeq=0 which returns
  // an initial snapshot of events (the hook also ingests them). For the page
  // title we try GET /api/tasks/:taskId first (may not exist yet), then fall
  // back to the first task.created event payload embedded in the projection.
  useEffect(() => {
    if (!taskId) return;
    let cancelled = false;

    api
      .get<TaskMeta>(`/api/tasks/${taskId}`)
      .then(({ data }) => {
        if (!cancelled) setTaskMeta(data);
      })
      .catch(() => {
        // Fallback: use projection data (taskId as partial name)
        if (!cancelled) {
          setTaskMeta({ id: taskId, title: '', subaccountId: null });
        }
      });

    return () => { cancelled = true; };
  }, [taskId]);

  // Derive task name from projection (populated by task.created or page metadata)
  const taskName = projection.taskName || taskMeta?.title || '';

  const canEdit = resolveCanEdit(user, {
    id: taskId ?? '',
    title: taskName,
    subaccountId: taskMeta?.subaccountId ?? null,
    requesterUserId: projection.requesterUserId,
  });

  if (!taskId) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-slate-400">Invalid task ID.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-slate-900">
      {/* Header — full-width strip */}
      <TaskHeader
        taskId={taskId}
        taskName={taskName}
        status={projection.status}
        canEditTask={canEdit}
      />

      {/* Degradation banner */}
      {degraded && (
        <div className="bg-amber-900/30 border-b border-amber-700/50 px-4 py-1.5 text-[12px] text-amber-300">
          Live stream degraded. Some events may be missing. Reconnecting...
        </div>
      )}

      {/* Three-pane layout */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Chat pane — 26% */}
        <div
          className="flex flex-col border-r border-slate-700/40"
          style={{ width: '26%', minWidth: 320 }}
        >
          <ChatPane
            taskId={taskId}
            projection={projection}
            currentUserId={user.id}
          />
        </div>

        {/* Activity pane — 22% expanded / 36px collapsed */}
        <div
          style={activityCollapsed ? { width: 36, flexShrink: 0 } : { width: '22%', minWidth: 240, flexShrink: 0 }}
          className="flex-shrink-0"
        >
          <ActivityPane
            activityFeed={projection.activityFeed}
            collapsed={activityCollapsed}
            onToggleCollapse={() => setActivityCollapsed((c) => !c)}
          />
        </div>

        {/* Right pane — 52% expanded / ~74% when activity collapsed */}
        <div className="flex-1 min-w-0 flex flex-col border-l border-slate-700/40">
          <RightPaneTabs projection={projection} taskId={taskId ?? ''} />
        </div>
      </div>
    </div>
  );
}
