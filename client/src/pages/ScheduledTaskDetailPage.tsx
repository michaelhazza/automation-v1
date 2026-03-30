import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../lib/api';

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

const STATUS_CLS: Record<string, string> = {
  completed: 'bg-green-100 text-green-800',
  running:   'bg-blue-100 text-blue-800',
  pending:   'bg-slate-100 text-slate-600',
  failed:    'bg-red-100 text-red-800',
  retrying:  'bg-amber-100 text-amber-800',
  skipped:   'bg-slate-100 text-slate-400',
};

export default function ScheduledTaskDetailPage({ user: _user }: { user: { id: string; role: string } }) {
  const { subaccountId, stId } = useParams<{ subaccountId: string; stId: string }>();
  const [detail, setDetail] = useState<ScheduledTaskDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => { load(); }, [stId]);

  async function load() {
    try {
      setLoading(true);
      const res = await api.get(`/api/subaccounts/${subaccountId}/scheduled-tasks/${stId}`);
      setDetail(res.data);
    } catch { setError('Failed to load'); } finally { setLoading(false); }
  }

  if (loading) return <div className="p-8"><div className="skeleton h-72 rounded-xl" /></div>;
  if (!detail) return <div className="p-8 text-red-700">Not found</div>;

  const successRate = detail.totalRuns > 0
    ? Math.round(((detail.totalRuns - detail.totalFailures) / detail.totalRuns) * 100)
    : 0;

  return (
    <div className="page-enter">
      <Link to={`/admin/subaccounts/${subaccountId}/scheduled-tasks`} className="text-[14px] text-indigo-600 hover:text-indigo-700 no-underline">&larr; Back to Scheduled Tasks</Link>

      {error && <div className="px-4 py-3 bg-red-50 border border-red-200 text-red-700 rounded-lg mt-3 mb-4 text-[14px]">{error}</div>}

      <div className="mt-3 mb-6">
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

      <div className="flex gap-4 mb-6 flex-wrap">
        <StatCard label="Agent" value={detail.assignedAgentName ?? '—'} />
        <StatCard label="Schedule" value={`${detail.scheduleTime} ${detail.timezone}`} />
        <StatCard label="Total Runs" value={String(detail.totalRuns)} />
        <StatCard label="Success Rate" value={`${successRate}%`} colorCls={successRate >= 80 ? 'text-green-600' : successRate >= 50 ? 'text-amber-600' : 'text-red-600'} />
        <StatCard label="Token Budget" value={`${(detail.tokenBudgetPerRun / 1000).toFixed(0)}K`} />
      </div>

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
