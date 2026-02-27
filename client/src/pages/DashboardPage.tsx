import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../lib/api';
import { User } from '../lib/auth';

interface Execution {
  id: string;
  taskId: string;
  status: string;
  createdAt: string;
  durationMs: number | null;
  isTestExecution: boolean;
}

interface Task {
  id: string;
  name: string;
  description: string;
  status: string;
}

interface DashboardPageProps {
  user: User;
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`badge badge-${status}`}>
      <span className="badge-dot" />
      {status}
    </span>
  );
}

function StatCard({
  label,
  value,
  sub,
  icon,
  gradient,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ReactNode;
  gradient: string;
}) {
  return (
    <div className="stat-card" style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
      <div style={{
        width: 44, height: 44, borderRadius: 12, flexShrink: 0,
        background: gradient,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#fff',
      }}>
        {icon}
      </div>
      <div>
        <div style={{ fontSize: 24, fontWeight: 800, color: '#0f172a', letterSpacing: '-0.03em', lineHeight: 1 }}>
          {value}
        </div>
        <div style={{ fontSize: 13, color: '#64748b', fontWeight: 500, marginTop: 4 }}>{label}</div>
        {sub && <div style={{ fontSize: 11.5, color: '#94a3b8', marginTop: 2 }}>{sub}</div>}
      </div>
    </div>
  );
}

export default function DashboardPage({ user }: DashboardPageProps) {
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const [execRes, taskRes] = await Promise.all([
          api.get('/api/executions', { params: { limit: 10 } }),
          api.get('/api/tasks', { params: { status: 'active', limit: 6 } }),
        ]);
        setExecutions(execRes.data);
        setTasks(taskRes.data);
      } catch {
        // silently handle
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  const completed = executions.filter((e) => e.status === 'completed').length;
  const failed = executions.filter((e) => e.status === 'failed').length;
  const running = executions.filter((e) => ['pending', 'running'].includes(e.status)).length;
  const successRate = executions.length > 0 ? Math.round((completed / executions.filter((e) => ['completed', 'failed'].includes(e.status)).length) * 100) : 0;

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div className="skeleton" style={{ height: 36, width: 280, marginBottom: 8 }} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="skeleton" style={{ height: 92, borderRadius: 14 }} />
          ))}
        </div>
        <div className="skeleton" style={{ height: 280, borderRadius: 14 }} />
      </div>
    );
  }

  return (
    <div className="page-enter">
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800, color: '#0f172a', letterSpacing: '-0.03em' }}>
              {greeting}, {user.firstName} 👋
            </h1>
            <p style={{ color: '#64748b', marginTop: 6, fontSize: 14 }}>
              Here's what's happening with your automations today.
            </p>
          </div>
          <Link to="/tasks" className="btn btn-primary" style={{ textDecoration: 'none' }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
            Run a Task
          </Link>
        </div>
      </div>

      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 28 }}>
        <StatCard
          label="Total Executions"
          value={executions.length}
          sub="Last 10 shown"
          gradient="linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)"
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
            </svg>
          }
        />
        <StatCard
          label="Success Rate"
          value={executions.filter((e) => ['completed', 'failed'].includes(e.status)).length === 0 ? '—' : `${successRate}%`}
          sub={`${completed} completed`}
          gradient="linear-gradient(135deg, #10b981 0%, #059669 100%)"
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          }
        />
        <StatCard
          label="Running Now"
          value={running}
          sub={running > 0 ? 'in progress' : 'all idle'}
          gradient={running > 0 ? 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)' : 'linear-gradient(135deg, #94a3b8 0%, #64748b 100%)'}
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><polygon points="10 8 16 12 10 16 10 8" />
            </svg>
          }
        />
        <StatCard
          label="Failed"
          value={failed}
          sub={failed > 0 ? 'need attention' : 'looking good'}
          gradient={failed > 0 ? 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)' : 'linear-gradient(135deg, #10b981 0%, #059669 100%)'}
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {failed > 0 ? (
                <><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></>
              ) : (
                <polyline points="20 6 9 17 4 12" />
              )}
            </svg>
          }
        />
      </div>

      {/* Quick access tasks */}
      {tasks.length > 0 && (
        <div style={{ marginBottom: 28 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <h2 style={{ fontSize: 17, fontWeight: 700, color: '#0f172a', margin: 0, letterSpacing: '-0.02em' }}>
              Available Tasks
            </h2>
            <Link to="/tasks" style={{ fontSize: 13, color: '#6366f1', textDecoration: 'none', fontWeight: 600 }}>
              View all →
            </Link>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 }}>
            {tasks.map((task) => (
              <Link key={task.id} to={`/tasks/${task.id}`} className="task-card" style={{ padding: '18px 20px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div style={{ fontWeight: 700, color: '#0f172a', fontSize: 14.5, letterSpacing: '-0.01em' }}>
                    {task.name}
                  </div>
                  <div
                    className="run-arrow"
                    style={{ fontSize: 13, color: '#6366f1', fontWeight: 700, flexShrink: 0, marginLeft: 8 }}
                  >
                    Run →
                  </div>
                </div>
                {task.description && (
                  <div style={{
                    fontSize: 12.5, color: '#64748b', lineHeight: 1.55,
                    overflow: 'hidden', display: '-webkit-box',
                    WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                  }}>
                    {task.description}
                  </div>
                )}
                <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{
                    width: 6, height: 6, borderRadius: '50%',
                    background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                  }} />
                  <span style={{ fontSize: 11.5, color: '#94a3b8', fontWeight: 500 }}>Active</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Recent executions */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h2 style={{ fontSize: 17, fontWeight: 700, color: '#0f172a', margin: 0, letterSpacing: '-0.02em' }}>
            Recent Executions
          </h2>
          <Link to="/executions" style={{ fontSize: 13, color: '#6366f1', textDecoration: 'none', fontWeight: 600 }}>
            View all →
          </Link>
        </div>

        {executions.length === 0 ? (
          <div className="card empty-state">
            <div style={{
              width: 56, height: 56, borderRadius: 16, marginBottom: 16,
              background: 'linear-gradient(135deg, #f5f3ff, #ede9fe)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><polygon points="10 8 16 12 10 16 10 8" />
              </svg>
            </div>
            <p style={{ margin: '0 0 6px', fontWeight: 700, fontSize: 16, color: '#0f172a' }}>No executions yet</p>
            <p style={{ margin: '0 0 20px', fontSize: 13.5, color: '#64748b' }}>
              Run your first task to get started.
            </p>
            <Link to="/tasks" className="btn btn-primary" style={{ textDecoration: 'none' }}>
              Browse Tasks
            </Link>
          </div>
        ) : (
          <div className="card" style={{ overflow: 'hidden' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Execution</th>
                  <th>Status</th>
                  <th>Duration</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {executions.map((exec) => (
                  <tr key={exec.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
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
                    <td><StatusBadge status={exec.status} /></td>
                    <td style={{ color: '#64748b', fontSize: 13 }}>
                      {exec.durationMs != null ? `${(exec.durationMs / 1000).toFixed(1)}s` : '—'}
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
    </div>
  );
}
