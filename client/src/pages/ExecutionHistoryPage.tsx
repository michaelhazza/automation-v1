import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../lib/api';
import { User } from '../lib/auth';

interface Execution {
  id: string;
  taskId: string;
  userId: string;
  status: string;
  isTestExecution: boolean;
  durationMs: number | null;
  createdAt: string;
}

interface Task {
  id: string;
  name: string;
}

function StatusBadge({ status }: { status: string }) {
  return <span className={`badge badge-${status}`}><span className="badge-dot" />{status}</span>;
}

export default function ExecutionHistoryPage({ user }: { user: User }) {
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [filterTaskId, setFilterTaskId] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [loading, setLoading] = useState(true);
  const isAdmin = user.role === 'org_admin' || user.role === 'system_admin';

  const load = async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = { limit: '50' };
      if (filterTaskId) params.taskId = filterTaskId;
      if (filterStatus) params.status = filterStatus;
      if (from) params.from = from;
      if (to) params.to = to;
      const [execRes, taskRes] = await Promise.all([
        api.get('/api/executions', { params }),
        api.get('/api/tasks'),
      ]);
      setExecutions(execRes.data);
      setTasks(taskRes.data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleExport = async () => {
    const params: Record<string, string> = {};
    if (filterTaskId) params.taskId = filterTaskId;
    if (from) params.from = from;
    if (to) params.to = to;
    const res = await api.get('/api/executions/export', { params, responseType: 'blob' });
    const url = URL.createObjectURL(new Blob([res.data]));
    const a = document.createElement('a');
    a.href = url; a.download = 'executions.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  const handleClearFilters = () => {
    setFilterTaskId(''); setFilterStatus(''); setFrom(''); setTo('');
  };

  const hasFilters = filterTaskId || filterStatus || from || to;
  const taskMap = Object.fromEntries(tasks.map((t) => [t.id, t.name]));

  const statuses = ['pending', 'running', 'completed', 'failed', 'timeout', 'cancelled'];

  return (
    <div className="page-enter">
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 800, color: '#0f172a', margin: '0 0 6px', letterSpacing: '-0.03em' }}>
            Execution History
          </h1>
          <p style={{ color: '#64748b', margin: 0, fontSize: 14 }}>
            Audit trail of all automation runs
          </p>
        </div>
        {isAdmin && (
          <button onClick={handleExport} className="btn btn-success" style={{ fontSize: 13.5 }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Export CSV
          </button>
        )}
      </div>

      {/* Filter bar */}
      <div className="card" style={{ padding: '16px 20px', marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          {/* Task filter */}
          <div style={{ flex: '1 1 180px', minWidth: 160 }}>
            <label style={{ display: 'block', fontSize: 11.5, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>
              Task
            </label>
            <select
              value={filterTaskId}
              onChange={(e) => setFilterTaskId(e.target.value)}
              className="form-select"
            >
              <option value="">All tasks</option>
              {tasks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>

          {/* Status filter */}
          <div style={{ flex: '1 1 160px', minWidth: 140 }}>
            <label style={{ display: 'block', fontSize: 11.5, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>
              Status
            </label>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="form-select"
            >
              <option value="">All statuses</option>
              {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          {/* From date */}
          <div style={{ flex: '1 1 148px', minWidth: 130 }}>
            <label style={{ display: 'block', fontSize: 11.5, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>
              From
            </label>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="form-input"
              style={{ fontSize: 13 }}
            />
          </div>

          {/* To date */}
          <div style={{ flex: '1 1 148px', minWidth: 130 }}>
            <label style={{ display: 'block', fontSize: 11.5, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>
              To
            </label>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="form-input"
              style={{ fontSize: 13 }}
            />
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', paddingBottom: 0 }}>
            <button onClick={load} className="btn btn-primary" style={{ fontSize: 13.5 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              Apply
            </button>
            {hasFilters && (
              <button onClick={handleClearFilters} className="btn btn-ghost" style={{ fontSize: 13 }}>
                Clear
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Results summary */}
      {!loading && (
        <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 13, color: '#64748b' }}>
            <strong style={{ color: '#0f172a' }}>{executions.length}</strong> execution{executions.length !== 1 ? 's' : ''} found
            {hasFilters && (
              <span style={{ marginLeft: 8, fontSize: 12, color: '#6366f1', fontWeight: 500 }}>
                (filtered)
              </span>
            )}
          </div>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="skeleton" style={{ height: 52, borderRadius: 8 }} />
          ))}
        </div>
      ) : executions.length === 0 ? (
        <div className="card empty-state">
          <div style={{
            width: 56, height: 56, borderRadius: 16, marginBottom: 16,
            background: 'linear-gradient(135deg, #f5f3ff, #ede9fe)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
            </svg>
          </div>
          <p style={{ margin: '0 0 6px', fontWeight: 700, fontSize: 16, color: '#0f172a' }}>No executions found</p>
          <p style={{ margin: '0 0 20px', fontSize: 13.5, color: '#64748b' }}>
            {hasFilters ? 'Try adjusting your filters.' : 'Run a task to start your execution history.'}
          </p>
          {hasFilters ? (
            <button className="btn btn-secondary" onClick={handleClearFilters}>Clear filters</button>
          ) : (
            <Link to="/tasks" className="btn btn-primary" style={{ textDecoration: 'none' }}>Browse Tasks</Link>
          )}
        </div>
      ) : (
        <div className="card" style={{ overflow: 'hidden' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Execution</th>
                <th>Task</th>
                <th>Status</th>
                <th>Duration</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {executions.map((exec) => (
                <tr key={exec.id}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <Link
                        to={`/executions/${exec.id}`}
                        style={{
                          color: '#6366f1', fontFamily: 'ui-monospace, monospace',
                          fontSize: 12, fontWeight: 600, textDecoration: 'none',
                        }}
                      >
                        {exec.id.substring(0, 8)}…
                      </Link>
                      {exec.isTestExecution && (
                        <span style={{
                          fontSize: 10.5, background: '#f0f9ff', color: '#0284c7',
                          padding: '2px 7px', borderRadius: 9999, fontWeight: 600,
                          border: '1px solid #bae6fd',
                        }}>
                          TEST
                        </span>
                      )}
                    </div>
                  </td>
                  <td style={{ color: '#374151', fontSize: 13.5, fontWeight: 500 }}>
                    {taskMap[exec.taskId] ?? (
                      <span style={{ color: '#94a3b8', fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>
                        {exec.taskId.substring(0, 8)}…
                      </span>
                    )}
                  </td>
                  <td><StatusBadge status={exec.status} /></td>
                  <td style={{ color: '#64748b', fontSize: 13 }}>
                    {exec.durationMs != null ? (
                      <span style={{ fontWeight: 500 }}>{(exec.durationMs / 1000).toFixed(1)}s</span>
                    ) : '—'}
                  </td>
                  <td style={{ color: '#64748b', fontSize: 13 }}>
                    {new Date(exec.createdAt).toLocaleString(undefined, {
                      month: 'short', day: 'numeric',
                      hour: '2-digit', minute: '2-digit',
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
