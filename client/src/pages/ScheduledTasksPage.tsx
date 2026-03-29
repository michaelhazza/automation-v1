import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../lib/api';
import RecurrencePicker, { type RecurrenceValue } from '../components/RecurrencePicker';

interface ScheduledTask {
  id: string;
  title: string;
  rrule: string;
  timezone: string;
  scheduleTime: string;
  isActive: boolean;
  assignedAgentName: string | null;
  assignedAgentId: string;
  nextRunAt: string | null;
  lastRunAt: string | null;
  totalRuns: number;
  totalFailures: number;
  consecutiveFailures: number;
  priority: string;
}

interface Agent {
  id: string;
  name: string;
}

interface Props { user: { id: string; role: string } }

const INITIAL_FORM = {
  title: '', description: '', brief: '', priority: 'normal',
  assignedAgentId: '', rrule: 'FREQ=WEEKLY;INTERVAL=1', timezone: 'UTC', scheduleTime: '09:00',
  endsAt: null as string | null, endsAfterRuns: null as number | null,
};

export default function ScheduledTasksPage({ user }: Props) {
  const { subaccountId } = useParams<{ subaccountId: string }>();
  const [items, setItems] = useState<ScheduledTask[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...INITIAL_FORM });

  useEffect(() => { load(); }, [subaccountId]);

  async function load() {
    try {
      setLoading(true);
      const [stRes, agentsRes] = await Promise.all([
        api.get(`/api/subaccounts/${subaccountId}/scheduled-tasks`),
        api.get(`/api/subaccounts/${subaccountId}/agents`),
      ]);
      setItems(stRes.data);
      setAgents(agentsRes.data?.agents ?? agentsRes.data ?? []);
    } catch { setError('Failed to load'); } finally { setLoading(false); }
  }

  async function handleCreate() {
    try {
      const payload: Record<string, unknown> = { ...form };
      // Only send end conditions if set
      if (!payload.endsAt) delete payload.endsAt;
      if (!payload.endsAfterRuns) delete payload.endsAfterRuns;
      await api.post(`/api/subaccounts/${subaccountId}/scheduled-tasks`, payload);
      setShowForm(false);
      setForm({ ...INITIAL_FORM });
      await load();
    } catch { setError('Failed to create'); }
  }

  async function handleToggle(id: string, isActive: boolean) {
    try {
      await api.post(`/api/subaccounts/${subaccountId}/scheduled-tasks/${id}/toggle`, { isActive });
      await load();
    } catch { setError('Failed to toggle'); }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this scheduled task?')) return;
    try {
      await api.delete(`/api/subaccounts/${subaccountId}/scheduled-tasks/${id}`);
      await load();
    } catch { setError('Failed to delete'); }
  }

  async function handleRunNow(id: string) {
    try {
      await api.post(`/api/subaccounts/${subaccountId}/scheduled-tasks/${id}/run-now`);
      await load();
    } catch { setError('Failed to trigger'); }
  }

  if (loading) return <div style={{ padding: 32 }}><div style={{ height: 200, background: '#e2e8f0', borderRadius: 8 }} /></div>;

  return (
    <div style={{ padding: 32, maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <Link to={`/admin/subaccounts/${subaccountId}`} style={{ color: '#6366f1', textDecoration: 'none', fontSize: 14 }}>&larr; Back</Link>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 700, color: '#0f172a', margin: 0 }}>Scheduled Tasks</h1>
            <p style={{ color: '#64748b', fontSize: 14, margin: '4px 0 0' }}>Recurring tasks that fire on a schedule and wake agents automatically.</p>
          </div>
          <button onClick={() => setShowForm(true)} style={{ padding: '10px 20px', background: '#6366f1', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}>
            + New Schedule
          </button>
        </div>
      </div>

      {error && <div style={{ padding: '12px 16px', background: '#fee2e2', color: '#991b1b', borderRadius: 8, marginBottom: 16, fontSize: 14 }}>{error}<button onClick={() => setError('')} style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer', color: '#991b1b' }}>&times;</button></div>}

      {/* Create form modal */}
      {showForm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 32, width: 520, maxHeight: '90vh', overflow: 'auto' }}>
            <h2 style={{ margin: '0 0 20px', fontSize: 18, fontWeight: 600 }}>New Scheduled Task</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4 }}>Title *</label>
                <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} style={{ width: '100%', padding: 10, border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 14 }} placeholder="e.g. Weekly Competitor Review" />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4 }}>Agent *</label>
                <select value={form.assignedAgentId} onChange={e => setForm({ ...form, assignedAgentId: e.target.value })} style={{ width: '100%', padding: 10, border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 14 }}>
                  <option value="">Select agent...</option>
                  {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4 }}>Brief / Instructions</label>
                <textarea value={form.brief} onChange={e => setForm({ ...form, brief: e.target.value })} rows={3} style={{ width: '100%', padding: 10, border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 14, resize: 'vertical' }} placeholder="What should the agent do each time?" />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Recurrence</label>
                <RecurrencePicker
                  value={{ rrule: form.rrule, endsAt: form.endsAt, endsAfterRuns: form.endsAfterRuns }}
                  onChange={(rv: RecurrenceValue) => setForm({ ...form, rrule: rv.rrule, endsAt: rv.endsAt ?? null, endsAfterRuns: rv.endsAfterRuns ?? null })}
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4 }}>Time</label>
                  <input type="time" value={form.scheduleTime} onChange={e => setForm({ ...form, scheduleTime: e.target.value })} style={{ width: '100%', padding: 10, border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 14 }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4 }}>Timezone</label>
                  <select value={form.timezone} onChange={e => setForm({ ...form, timezone: e.target.value })} style={{ width: '100%', padding: 10, border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 14 }}>
                    <option value="UTC">UTC</option>
                    <option value="Pacific/Auckland">NZ (Auckland)</option>
                    <option value="Australia/Sydney">AU (Sydney)</option>
                    <option value="America/New_York">US East</option>
                    <option value="America/Los_Angeles">US West</option>
                    <option value="Europe/London">UK (London)</option>
                  </select>
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
                <button onClick={() => setShowForm(false)} style={{ padding: '10px 20px', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 8, cursor: 'pointer', fontSize: 14 }}>Cancel</button>
                <button onClick={handleCreate} disabled={!form.title || !form.assignedAgentId} style={{ padding: '10px 20px', background: '#6366f1', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 14, opacity: (!form.title || !form.assignedAgentId) ? 0.5 : 1 }}>Create</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Table */}
      {items.length === 0 ? (
        <div style={{ padding: 60, textAlign: 'center', color: '#94a3b8' }}>
          <p style={{ fontSize: 16, marginBottom: 8 }}>No scheduled tasks yet</p>
          <p style={{ fontSize: 14 }}>Create one to start automating recurring work.</p>
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
              {['Task', 'Agent', 'Schedule', 'Next Run', 'Runs', 'Status', 'Actions'].map(h => (
                <th key={h} style={{ textAlign: 'left', padding: '10px 12px', fontSize: 12, fontWeight: 600, color: '#64748b', textTransform: 'uppercase' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map(item => (
              <tr key={item.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                <td style={{ padding: '12px' }}>
                  <Link to={`/admin/subaccounts/${subaccountId}/scheduled-tasks/${item.id}`} style={{ color: '#0f172a', textDecoration: 'none', fontWeight: 500 }}>{item.title}</Link>
                </td>
                <td style={{ padding: '12px', color: '#475569', fontSize: 14 }}>{item.assignedAgentName ?? '—'}</td>
                <td style={{ padding: '12px', fontSize: 13, color: '#475569', fontFamily: 'monospace' }}>{item.scheduleTime} {item.timezone}</td>
                <td style={{ padding: '12px', fontSize: 13, color: '#475569' }}>{item.nextRunAt ? new Date(item.nextRunAt).toLocaleString() : '—'}</td>
                <td style={{ padding: '12px', fontSize: 13 }}>
                  <span style={{ color: '#0f172a' }}>{item.totalRuns}</span>
                  {item.totalFailures > 0 && <span style={{ color: '#dc2626', marginLeft: 4 }}>({item.totalFailures} failed)</span>}
                </td>
                <td style={{ padding: '12px' }}>
                  {item.isActive ? (
                    <span style={{ background: '#dcfce7', color: '#166534', padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 600 }}>Active</span>
                  ) : item.consecutiveFailures >= 3 ? (
                    <span style={{ background: '#fee2e2', color: '#991b1b', padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 600 }}>Auto-Paused</span>
                  ) : (
                    <span style={{ background: '#f1f5f9', color: '#475569', padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 600 }}>Paused</span>
                  )}
                </td>
                <td style={{ padding: '12px' }}>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => handleToggle(item.id, !item.isActive)} style={{ padding: '4px 10px', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}>{item.isActive ? 'Pause' : 'Resume'}</button>
                    <button onClick={() => handleRunNow(item.id)} style={{ padding: '4px 10px', background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: 4, cursor: 'pointer', fontSize: 12, color: '#4f46e5' }}>Run Now</button>
                    <button onClick={() => handleDelete(item.id)} style={{ padding: '4px 10px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 4, cursor: 'pointer', fontSize: 12, color: '#dc2626' }}>Delete</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
