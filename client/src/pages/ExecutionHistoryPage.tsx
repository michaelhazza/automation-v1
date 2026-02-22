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

const STATUS_COLORS: Record<string, string> = {
  completed: '#16a34a',
  failed: '#dc2626',
  running: '#2563eb',
  pending: '#d97706',
  timeout: '#ea580c',
  cancelled: '#6b7280',
};

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
    a.href = url;
    a.download = 'executions.csv';
    a.click();
  };

  const taskMap = Object.fromEntries(tasks.map((t) => [t.id, t.name]));

  if (loading) return <div>Loading...</div>;

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: '#1e293b', margin: 0 }}>Execution History</h1>
          <p style={{ color: '#64748b', margin: '8px 0 0' }}>All automation runs</p>
        </div>
        {isAdmin && (
          <button onClick={handleExport} style={{ padding: '10px 20px', background: '#059669', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, cursor: 'pointer', fontWeight: 500 }}>
            Export CSV
          </button>
        )}
      </div>

      {/* Filters */}
      <div style={{ background: '#fff', borderRadius: 10, padding: 20, border: '1px solid #e2e8f0', marginBottom: 20, display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: '#374151', marginBottom: 4 }}>Task</label>
          <select value={filterTaskId} onChange={(e) => setFilterTaskId(e.target.value)} style={{ padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13 }}>
            <option value="">All tasks</option>
            {tasks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: '#374151', marginBottom: 4 }}>Status</label>
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} style={{ padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13 }}>
            <option value="">All statuses</option>
            {['pending', 'running', 'completed', 'failed', 'timeout', 'cancelled'].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: '#374151', marginBottom: 4 }}>From</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13 }} />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: '#374151', marginBottom: 4 }}>To</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13 }} />
        </div>
        <button onClick={load} style={{ padding: '8px 16px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>Apply</button>
      </div>

      <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
        {executions.length === 0 ? (
          <div style={{ padding: '48px', textAlign: 'center', color: '#64748b' }}>No executions found.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#374151' }}>ID</th>
                <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#374151' }}>Task</th>
                <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#374151' }}>Status</th>
                <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#374151' }}>Duration</th>
                <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#374151' }}>Created</th>
              </tr>
            </thead>
            <tbody>
              {executions.map((exec) => (
                <tr key={exec.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '12px 16px' }}>
                    <Link to={`/executions/${exec.id}`} style={{ color: '#2563eb', fontFamily: 'monospace', fontSize: 12 }}>
                      {exec.id.substring(0, 8)}...
                    </Link>
                    {exec.isTestExecution && <span style={{ marginLeft: 8, fontSize: 11, background: '#f0f9ff', color: '#0284c7', padding: '2px 6px', borderRadius: 4 }}>TEST</span>}
                  </td>
                  <td style={{ padding: '12px 16px', color: '#374151' }}>{taskMap[exec.taskId] ?? exec.taskId.substring(0, 8)}</td>
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{ color: STATUS_COLORS[exec.status] ?? '#6b7280', fontWeight: 500 }}>{exec.status}</span>
                  </td>
                  <td style={{ padding: '12px 16px', color: '#64748b' }}>{exec.durationMs != null ? `${(exec.durationMs / 1000).toFixed(1)}s` : '-'}</td>
                  <td style={{ padding: '12px 16px', color: '#64748b' }}>{new Date(exec.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
