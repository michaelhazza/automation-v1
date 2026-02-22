import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Layout from '../components/Layout';
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

const STATUS_COLORS: Record<string, string> = {
  completed: '#16a34a',
  failed: '#dc2626',
  running: '#2563eb',
  pending: '#d97706',
  timeout: '#ea580c',
  cancelled: '#6b7280',
};

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

  if (loading) return <Layout user={user}><div>Loading...</div></Layout>;

  return (
    <Layout user={user}>
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700, color: '#1e293b' }}>
          Welcome back, {user.firstName}
        </h1>
        <p style={{ color: '#64748b', marginTop: 8 }}>Here's an overview of your automation activity.</p>
      </div>

      {/* Quick access tasks */}
      {tasks.length > 0 && (
        <div style={{ marginBottom: 32 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, color: '#1e293b', marginBottom: 16 }}>Available Tasks</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
            {tasks.map((task) => (
              <Link key={task.id} to={`/tasks/${task.id}`} style={{ textDecoration: 'none' }}>
                <div style={{ background: '#fff', borderRadius: 10, padding: '20px 24px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', border: '1px solid #e2e8f0', cursor: 'pointer', transition: 'box-shadow 0.2s' }}>
                  <div style={{ fontWeight: 600, color: '#1e293b', marginBottom: 6 }}>{task.name}</div>
                  {task.description && <div style={{ fontSize: 13, color: '#64748b', lineHeight: 1.4 }}>{task.description}</div>}
                  <div style={{ marginTop: 12, fontSize: 12, color: '#2563eb', fontWeight: 500 }}>Run task →</div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Recent executions */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, color: '#1e293b', margin: 0 }}>Recent Executions</h2>
          <Link to="/executions" style={{ fontSize: 13, color: '#2563eb', textDecoration: 'none' }}>View all →</Link>
        </div>
        {executions.length === 0 ? (
          <div style={{ background: '#fff', borderRadius: 10, padding: '32px', textAlign: 'center', color: '#64748b', border: '1px solid #e2e8f0' }}>
            No executions yet. <Link to="/tasks" style={{ color: '#2563eb' }}>Run a task</Link> to get started.
          </div>
        ) : (
          <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#374151' }}>Execution ID</th>
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
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{ color: STATUS_COLORS[exec.status] ?? '#6b7280', fontWeight: 500 }}>{exec.status}</span>
                    </td>
                    <td style={{ padding: '12px 16px', color: '#64748b' }}>
                      {exec.durationMs != null ? `${(exec.durationMs / 1000).toFixed(1)}s` : '-'}
                    </td>
                    <td style={{ padding: '12px 16px', color: '#64748b' }}>
                      {new Date(exec.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Layout>
  );
}
