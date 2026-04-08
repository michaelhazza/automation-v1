import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../lib/api';
import DataSourceManager from '../components/DataSourceManager';
import RecurrencePicker, { type RecurrenceValue } from '../components/RecurrencePicker';

interface ScheduledTaskDetail {
  id: string;
  title: string;
  description: string | null;
  brief: string | null;
  rrule: string;
  timezone: string;
  scheduleTime: string;
  isActive: boolean;
  priority: string;
  assignedAgentId: string;
  assignedAgentName: string | null;
  tokenBudgetPerRun: number;
  retryPolicy: { maxRetries: number; backoffMinutes: number; pauseAfterConsecutiveFailures: number } | null;
  nextRunAt: string | null;
  lastRunAt: string | null;
  totalRuns: number;
  totalFailures: number;
  consecutiveFailures: number;
  runs: Array<{
    id: string;
    occurrence: number;
    status: string;
    attempt: number;
    scheduledFor: string;
    startedAt: string | null;
    completedAt: string | null;
    errorMessage: string | null;
    taskId: string | null;
    agentRunId: string | null;
  }>;
  upcoming: string[];
}

interface EditForm {
  title: string;
  brief: string;
  description: string;
  priority: string;
  rrule: string;
  timezone: string;
  scheduleTime: string;
  endsAt: string | null;
  endsAfterRuns: number | null;
}

const STATUS_CLS: Record<string, string> = {
  completed: 'bg-green-100 text-green-800',
  running:   'bg-blue-100 text-blue-800',
  pending:   'bg-slate-100 text-slate-600',
  failed:    'bg-red-100 text-red-800',
  retrying:  'bg-amber-100 text-amber-800',
  skipped:   'bg-slate-100 text-slate-400',
};

const inputCls = 'w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500';

export default function ScheduledTaskDetailPage({ user: _user }: { user: { id: string; role: string } }) {
  const { subaccountId, stId } = useParams<{ subaccountId: string; stId: string }>();
  const [detail, setDetail] = useState<ScheduledTaskDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [showFullInstructions, setShowFullInstructions] = useState(false);
  const [canManageDataSources, setCanManageDataSources] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get(`/api/subaccounts/${subaccountId}/scheduled-tasks/${stId}`);
      setDetail(res.data);
    } catch {
      setError('Failed to load');
    } finally {
      setLoading(false);
    }
  }, [subaccountId, stId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    // Resolve the current user's permission to manage scheduled task data sources
    (async () => {
      try {
        const res = await api.get('/api/my-permissions');
        const perms: string[] = res.data?.permissions ?? [];
        setCanManageDataSources(
          perms.includes('org.scheduled_tasks.data_sources.manage')
          || perms.includes('org.agents.edit')
        );
      } catch {
        setCanManageDataSources(false);
      }
    })();
  }, []);

  function startEdit() {
    if (!detail) return;
    setEditForm({
      title: detail.title,
      brief: detail.brief ?? '',
      description: detail.description ?? '',
      priority: detail.priority,
      rrule: detail.rrule,
      timezone: detail.timezone,
      scheduleTime: detail.scheduleTime,
      endsAt: null,
      endsAfterRuns: null,
    });
    setEditing(true);
    setError('');
  }

  function cancelEdit() {
    setEditing(false);
    setEditForm(null);
    setError('');
  }

  async function saveEdit() {
    if (!editForm) return;
    try {
      setError('');
      await api.patch(`/api/subaccounts/${subaccountId}/scheduled-tasks/${stId}`, editForm);
      setEditing(false);
      setEditForm(null);
      await load();
    } catch {
      setError('Failed to save');
    }
  }

  if (loading) return <div className="p-8"><div className="h-72 rounded-xl bg-[linear-gradient(90deg,#f1f5f9_25%,#e2e8f0_50%,#f1f5f9_75%)] bg-[length:400%_100%] animate-[shimmer_1.4s_ease-in-out_infinite]" /></div>;
  if (!detail) return <div className="p-8 text-red-700">Not found</div>;

  const successRate = detail.totalRuns > 0
    ? Math.round(((detail.totalRuns - detail.totalFailures) / detail.totalRuns) * 100)
    : 0;

  const instructionsLines = (detail.description ?? '').split('\n');
  const isLongInstructions = instructionsLines.length > 10;
  const truncatedInstructions = isLongInstructions && !showFullInstructions
    ? instructionsLines.slice(0, 10).join('\n') + '\n...'
    : detail.description ?? '';

  return (
    <div className="animate-[fadeIn_0.2s_ease-out_both]">
      <Link to={`/admin/subaccounts/${subaccountId}/scheduled-tasks`} className="text-[14px] text-indigo-600 hover:text-indigo-700 no-underline">&larr; Back to Scheduled Tasks</Link>

      {error && <div className="px-4 py-3 bg-red-50 border border-red-200 text-red-700 rounded-lg mt-3 mb-4 text-[14px]">{error}</div>}

      <div className="mt-3 mb-6 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-[24px] font-bold text-slate-900 m-0">{detail.title}</h1>
            {detail.isActive ? (
              <span className="bg-green-100 text-green-800 px-2.5 py-0.5 rounded text-[12px] font-semibold">Active</span>
            ) : (
              <span className="bg-red-100 text-red-800 px-2.5 py-0.5 rounded text-[12px] font-semibold">
                {detail.consecutiveFailures >= 3 ? 'Auto-Paused' : 'Paused'}
              </span>
            )}
          </div>
          {detail.brief && <p className="text-[14px] text-slate-500 mt-2 leading-relaxed">{detail.brief}</p>}
        </div>
        {!editing && canManageDataSources && (
          <button
            onClick={startEdit}
            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-700 rounded-lg text-[13px] font-medium"
          >
            Edit
          </button>
        )}
      </div>

      {editing && editForm && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 mb-6">
          <h2 className="text-[15px] font-semibold text-slate-800 mb-4">Edit scheduled task</h2>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-[13px] font-medium text-slate-700 mb-1">Title *</label>
              <input
                type="text"
                value={editForm.title}
                onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                className={inputCls}
              />
            </div>
            <div className="col-span-2">
              <label className="block text-[13px] font-medium text-slate-700 mb-1">Brief</label>
              <textarea
                value={editForm.brief}
                onChange={(e) => setEditForm({ ...editForm, brief: e.target.value })}
                rows={2}
                className={`${inputCls} resize-vertical`}
              />
            </div>
            <div className="col-span-2">
              <label className="block text-[13px] font-medium text-slate-700 mb-1">Instructions</label>
              <textarea
                value={editForm.description}
                onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                rows={12}
                className={`${inputCls} resize-vertical font-mono text-[12px]`}
              />
              <div className="text-[11px] text-slate-500 mt-1">
                Injected into the agent's system prompt as the Task Instructions layer for every run of this scheduled task.
              </div>
            </div>
            <div className="col-span-2">
              <label className="block text-[13px] font-medium text-slate-700 mb-1">Schedule</label>
              <RecurrencePicker
                value={{
                  rrule: editForm.rrule,
                  endsAt: editForm.endsAt,
                  endsAfterRuns: editForm.endsAfterRuns,
                }}
                onChange={(rv: RecurrenceValue) =>
                  setEditForm({
                    ...editForm,
                    rrule: rv.rrule,
                    endsAt: rv.endsAt ?? null,
                    endsAfterRuns: rv.endsAfterRuns ?? null,
                  })
                }
              />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1">Time</label>
              <input
                type="time"
                value={editForm.scheduleTime}
                onChange={(e) => setEditForm({ ...editForm, scheduleTime: e.target.value })}
                className={inputCls}
              />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1">Timezone</label>
              <select
                value={editForm.timezone}
                onChange={(e) => setEditForm({ ...editForm, timezone: e.target.value })}
                className={inputCls}
              >
                <option value="UTC">UTC</option>
                <option value="Pacific/Auckland">NZ (Auckland)</option>
                <option value="Australia/Sydney">AU (Sydney)</option>
                <option value="America/New_York">US East</option>
                <option value="America/Los_Angeles">US West</option>
                <option value="Europe/London">UK (London)</option>
              </select>
            </div>
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1">Priority</label>
              <select
                value={editForm.priority}
                onChange={(e) => setEditForm({ ...editForm, priority: e.target.value })}
                className={inputCls}
              >
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
          </div>
          <div className="flex gap-2 mt-5 justify-end">
            <button
              onClick={cancelEdit}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 rounded-lg text-[13px]"
            >
              Cancel
            </button>
            <button
              onClick={saveEdit}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-[13px] font-semibold"
            >
              Save Changes
            </button>
          </div>
        </div>
      )}

      <div className="flex gap-4 mb-6 flex-wrap">
        <StatCard label="Agent" value={detail.assignedAgentName ?? '—'} />
        <StatCard label="Schedule" value={`${detail.scheduleTime} ${detail.timezone}`} />
        <StatCard label="Total Runs" value={String(detail.totalRuns)} />
        <StatCard label="Success Rate" value={`${successRate}%`} colorCls={successRate >= 80 ? 'text-green-600' : successRate >= 50 ? 'text-amber-600' : 'text-red-600'} />
        <StatCard label="Token Budget" value={`${(detail.tokenBudgetPerRun / 1000).toFixed(0)}K`} />
      </div>

      {!editing && detail.description && (
        <section className="mb-6">
          <h2 className="text-[14px] font-semibold text-slate-800 mb-2">Instructions</h2>
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
            <pre className="text-[12px] text-slate-700 whitespace-pre-wrap font-mono m-0">
              {truncatedInstructions}
            </pre>
            {isLongInstructions && (
              <button
                onClick={() => setShowFullInstructions((v) => !v)}
                className="mt-2 text-[12px] text-indigo-600 hover:underline bg-transparent border-0 cursor-pointer p-0"
              >
                {showFullInstructions ? 'Show less' : 'Show all'}
              </button>
            )}
          </div>
        </section>
      )}

      {/* ── Data Sources panel (spec §11.3) ── */}
      <section className="mb-8">
        <h2 className="text-[14px] font-semibold text-slate-800 mb-2">Data Sources</h2>
        <p className="text-[12px] text-slate-500 mb-3">
          Reference files attached to this scheduled task. These are loaded into
          the agent's context every time this task runs, in addition to any
          data sources attached to the agent itself.
        </p>
        <DataSourceManager
          scope={{
            type: 'scheduled_task',
            subaccountId: subaccountId!,
            scheduledTaskId: stId!,
          }}
          canEdit={canManageDataSources}
        />
      </section>

      {detail.upcoming && detail.upcoming.length > 0 && (
        <div className="mb-6">
          <h2 className="text-[16px] font-semibold text-slate-800 mb-3">Upcoming</h2>
          <div className="flex gap-2 flex-wrap">
            {detail.upcoming.map((d, i) => (
              <span key={i} className="bg-slate-100 px-3 py-1.5 rounded-lg text-[13px] text-slate-600">
                {new Date(d).toLocaleString()}
              </span>
            ))}
          </div>
        </div>
      )}

      <h2 className="text-[16px] font-semibold text-slate-800 mb-3">Run History</h2>
      {detail.runs.length === 0 ? (
        <p className="text-[14px] text-slate-400">No runs yet.</p>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                {['#', 'Scheduled For', 'Status', 'Attempt', 'Duration', 'Error', 'Links'].map((h) => (
                  <th key={h} className="text-left px-3 py-2.5 text-[12px] font-semibold text-slate-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {detail.runs.map((run) => {
                const duration = run.startedAt && run.completedAt
                  ? Math.round((new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()) / 1000)
                  : null;
                const sc = STATUS_CLS[run.status] ?? STATUS_CLS.pending;
                return (
                  <tr key={run.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-3 py-2.5 text-[13px] text-slate-600">{run.occurrence}</td>
                    <td className="px-3 py-2.5 text-[13px] text-slate-600">{new Date(run.scheduledFor).toLocaleString()}</td>
                    <td className="px-3 py-2.5">
                      <span className={`px-2 py-0.5 rounded text-[12px] font-semibold ${sc}`}>{run.status}</span>
                    </td>
                    <td className="px-3 py-2.5 text-[13px] text-slate-600">{run.attempt}</td>
                    <td className="px-3 py-2.5 text-[13px] text-slate-600">{duration !== null ? `${duration}s` : '—'}</td>
                    <td className="px-3 py-2.5 text-[12px] text-red-600 max-w-[200px] overflow-hidden text-ellipsis whitespace-nowrap">{run.errorMessage ?? ''}</td>
                    <td className="px-3 py-2.5 flex gap-2">
                      {run.taskId && <Link to={`/admin/subaccounts/${subaccountId}/workspace`} className="text-indigo-600 text-[12px] no-underline hover:underline">Task</Link>}
                      {run.agentRunId && <Link to={`/admin/subaccounts/${subaccountId}/workspace`} className="text-indigo-600 text-[12px] no-underline hover:underline">Run</Link>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, colorCls }: { label: string; value: string; colorCls?: string }) {
  return (
    <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-2.5 min-w-[100px]">
      <div className="text-[11px] text-slate-400 font-medium mb-0.5">{label}</div>
      <div className={`text-[16px] font-semibold ${colorCls ?? 'text-slate-900'}`}>{value}</div>
    </div>
  );
}
