/**
 * PortalPage — subaccount member's task browser.
 *
 * Displays tasks available in the selected subaccount, grouped by category.
 * Subaccount members execute tasks via the portal execution endpoint.
 */
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import api from '../lib/api';
import { User } from '../lib/auth';

interface PortalTask {
  id: string;
  name: string;
  description: string | null;
  inputSchema: string | null;
  outputSchema: string | null;
  category: { id: string; name: string; colour: string | null } | null;
  source: 'linked' | 'native';
}

interface Category {
  id: string;
  name: string;
  colour: string | null;
}

interface SubaccountInfo {
  id: string;
  name: string;
}

export default function PortalPage({ user }: { user: User }) {
  const { subaccountId } = useParams<{ subaccountId: string }>();
  const [subaccount, setSubaccount] = useState<SubaccountInfo | null>(null);
  const [tasks, setTasks] = useState<PortalTask[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!subaccountId) return;
    api.get(`/api/portal/${subaccountId}/tasks`)
      .then(({ data }) => {
        setSubaccount(data.subaccount);
        setTasks(data.tasks ?? []);
        setCategories(data.categories ?? []);
      })
      .catch((err) => {
        const e = err as { response?: { data?: { error?: string } } };
        setError(e.response?.data?.error ?? 'Failed to load tasks');
      })
      .finally(() => setLoading(false));
  }, [subaccountId]);

  const filtered = tasks.filter((t) => {
    const matchSearch =
      !search ||
      t.name.toLowerCase().includes(search.toLowerCase()) ||
      (t.description ?? '').toLowerCase().includes(search.toLowerCase());
    const matchCat = !selectedCategory || t.category?.id === selectedCategory;
    return matchSearch && matchCat;
  });

  if (loading) return <div>Loading...</div>;
  if (error) return <div style={{ color: '#dc2626', padding: 32 }}>{error}</div>;

  return (
    <>
      <h1 style={{ fontSize: 28, fontWeight: 700, color: '#1e293b', marginBottom: 4 }}>
        {subaccount?.name ?? 'Portal'}
      </h1>
      <p style={{ color: '#64748b', marginBottom: 28 }}>Select a task to run an automation.</p>

      <div style={{ display: 'flex', gap: 24 }}>
        {/* Sidebar filters */}
        <div style={{ width: 200, flexShrink: 0 }}>
          <div style={{ marginBottom: 12 }}>
            <input
              type="text"
              placeholder="Search tasks..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }}
            />
          </div>
          {categories.length > 0 && (
            <>
              <div style={{ fontWeight: 600, color: '#374151', fontSize: 13, marginBottom: 8 }}>Categories</div>
              <div
                onClick={() => setSelectedCategory('')}
                style={{ padding: '8px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 13, background: !selectedCategory ? '#dbeafe' : 'transparent', color: !selectedCategory ? '#1d4ed8' : '#374151', marginBottom: 4 }}
              >
                All
              </div>
              {categories.map((cat) => (
                <div
                  key={cat.id}
                  onClick={() => setSelectedCategory(cat.id)}
                  style={{ padding: '8px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 13, background: selectedCategory === cat.id ? '#dbeafe' : 'transparent', color: selectedCategory === cat.id ? '#1d4ed8' : '#374151', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}
                >
                  {cat.colour && <span style={{ width: 10, height: 10, borderRadius: '50%', background: cat.colour, flexShrink: 0 }} />}
                  {cat.name}
                </div>
              ))}
            </>
          )}
          <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid #e2e8f0' }}>
            <Link
              to={`/portal/${subaccountId}/executions`}
              style={{ display: 'block', fontSize: 13, color: '#2563eb', textDecoration: 'none', padding: '8px 0' }}
            >
              View my executions →
            </Link>
          </div>
        </div>

        {/* Task grid */}
        <div style={{ flex: 1 }}>
          {filtered.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px', color: '#64748b', background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0' }}>
              No tasks found. {search && 'Try a different search term.'}
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
              {filtered.map((task) => (
                <Link key={task.id} to={`/portal/${subaccountId}/tasks/${task.id}`} style={{ textDecoration: 'none' }}>
                  <div style={{ background: '#fff', borderRadius: 10, padding: '20px 24px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', border: '1px solid #e2e8f0', height: '100%', boxSizing: 'border-box' }}>
                    {task.category && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                        {task.category.colour && <span style={{ width: 8, height: 8, borderRadius: '50%', background: task.category.colour }} />}
                        <span style={{ fontSize: 11, color: '#64748b' }}>{task.category.name}</span>
                      </div>
                    )}
                    <div style={{ fontWeight: 600, color: '#1e293b', marginBottom: 8, fontSize: 16 }}>{task.name}</div>
                    {task.description && (
                      <div style={{ fontSize: 13, color: '#64748b', lineHeight: 1.5, marginBottom: 12 }}>{task.description}</div>
                    )}
                    {task.inputSchema && (
                      <div style={{ fontSize: 12, color: '#0284c7', background: '#f0f9ff', padding: '6px 10px', borderRadius: 6 }}>
                        {task.inputSchema.substring(0, 80)}{task.inputSchema.length > 80 ? '...' : ''}
                      </div>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
