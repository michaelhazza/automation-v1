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

interface Props { user: { id: string; role: string } }

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  completed: { bg: '#dcfce7', text: '#166534' },
  running: { bg: '#dbeafe', text: '#1e40af' },
  pending: { bg: '#f1f5f9', text: '#475569' },
  failed: { bg: '#fee2e2', text: '#991b1b' },
  retrying: { bg: '#fef3c7', text: '#92400e' },
  skipped: { bg: '#f1f5f9', text: '#94a3b8' },
};

export default function ScheduledTaskDetailPage({ user }: Props) {
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

  if (loading) return <div style={{ padding: 32 }}><div style={{ height: 300, background: '#e2e8f0', borderRadius: 8 }} /></div>;
  if (!detail) return <div style={{ padding: 32, color: '#991b1b' }}>Not found</div>;

  const successRate = detail.totalRuns > 0
    ? Math.round(((detail.totalRuns - detail.totalFailures) / detail.totalRuns) * 100)
    : 0;

  return (
    <div style={{ padding: 32, maxWidth: 1000, margin: '0 auto' }}>
      <Link to={`/admin/subaccounts/${subaccountId}/scheduled-tasks`} style={{ color: '#6366f1', textDecoration: 'none', fontSize: 14 }}>&larr; Back to Scheduled Tasks</Link>

      {error && <div style={{ padding: '12px 16px', background: '#fee2e2', color: '#991b1b', borderRadius: 8, marginBottom: 16, marginTop: 12, fontSize: 14 }}>{error}</div>}

      {/* Header */}
      <div style={{ marginTop: 12, marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#0f172a', margin: 0 }}>{detail.title}</h1>
          {detail.isActive ? (
            <span style={{ background: '#dcfce7', color: '#166534', padding: '2px 10px', borderRadius: 4, fontSize: 12, fontWeight: 600 }}>Active</span>
          ) : (
            <span style={{ background: '#fee2e2', color: '#991b1b', padding: '2px 10px', borderRadius: 4, fontSize: 12, fontWeight: 600 }}>
              {detail.consecutiveFailures >= 3 ? 'Auto-Paused' : 'Paused'}
            </span>
          )}
        </div>
        {detail.brief && <p style={{ color: '#64748b', fontSize: 14, margin: '8px 0 0', lineHeight: 1.5 }}>{detail.brief}</p>}
      </div>

      {/* Stats */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
        <StatCard label="Agent" value={detail.assignedAgentName ?? '—'} />
        <StatCard label="Schedule" value={`${detail.scheduleTime} ${detail.timezone}`} />
        <StatCard label="Total Runs" value={String(detail.totalRuns)} />
        <StatCard label="Success Rate" value={`${successRate}%`} color={successRate >= 80 ? '#16a34a' : successRate >= 50 ? '#d97706' : '#dc2626'} />
        <StatCard label="Token Budget" value={`${(detail.tokenBudgetPerRun / 1000).toFixed(0)}K`} />
      </div>

      {/* Upcoming Occurrences */}
      {detail.upcoming && detail.upcoming.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: '#0f172a', margin: '0 0 12px' }}>Upcoming</h2>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {detail.upcoming.map((d, i) => (
              <span key={i} style={{ background: '#f1f5f9', padding: '6px 12px', borderRadius: 6, fontSize: 13, color: '#475569' }}>
                {new Date(d).toLocaleString()}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Run History */}
      <h2 style={{ fontSize: 16, fontWeight: 600, color: '#0f172a', margin: '0 0 12px' }}>Run History</h2>
      {detail.runs.length === 0 ? (
        <p style={{ color: '#94a3b8', fontSize: 14 }}>No runs yet.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
              {['#', 'Scheduled For', 'Status', 'Attempt', 'Duration', 'Error', 'Links'].map(h => (
                <th key={h} style={{ textAlign: 'left', padding: '8px 10px', fontSize: 12, fontWeight: 600, color: '#64748b', textTransform: 'uppercase' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {detail.runs.map(run => {
              const duration = run.startedAt && run.completedAt
                ? Math.round((new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()) / 1000)
                : null;
              const sc = STATUS_COLORS[run.status] ?? STATUS_COLORS.pending;
              return (
                <tr key={run.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '10px', fontSize: 13, color: '#475569' }}>{run.occurrence}</td>
                  <td style={{ padding: '10px', fontSize: 13, color: '#475569' }}>{new Date(run.scheduledFor).toLocaleString()}</td>
                  <td style={{ padding: '10px' }}>
                    <span style={{ background: sc.bg, color: sc.text, padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 600 }}>{run.status}</span>
                  </td>
                  <td style={{ padding: '10px', fontSize: 13, color: '#475569' }}>{run.attempt}</td>
                  <td style={{ padding: '10px', fontSize: 13, color: '#475569' }}>{duration !== null ? `${duration}s` : '—'}</td>
                  <td style={{ padding: '10px', fontSize: 12, color: '#dc2626', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{run.errorMessage ?? ''}</td>
                  <td style={{ padding: '10px', display: 'flex', gap: 8 }}>
                    {run.taskId && <Link to={`/admin/subaccounts/${subaccountId}/workspace`} style={{ color: '#6366f1', fontSize: 12 }}>Task</Link>}
                    {run.agentRunId && <Link to={`/admin/subaccounts/${subaccountId}/workspace`} style={{ color: '#6366f1', fontSize: 12 }}>Run</Link>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 16px', minWidth: 100 }}>
      <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 500, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 600, color: color ?? '#0f172a' }}>{value}</div>
    </div>
  );
}
