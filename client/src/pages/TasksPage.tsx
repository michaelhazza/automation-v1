import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../lib/api';
import { User } from '../lib/auth';

interface Process {
  id: string;
  name: string;
  description: string;
  orgCategoryId: string | null;
  inputSchema: string | null;
}

interface Category {
  id: string;
  name: string;
  colour: string | null;
}

export default function TasksPage({ user }: { user: User }) {
  const [processes, setProcesses] = useState<Process[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const [processRes, catRes] = await Promise.all([
          api.get('/api/processes', { params: { status: 'active' } }),
          api.get('/api/categories'),
        ]);
        setProcesses(processRes.data);
        setCategories(catRes.data);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const filtered = processes.filter((t) => {
    const matchSearch = !search || t.name.toLowerCase().includes(search.toLowerCase()) || (t.description ?? '').toLowerCase().includes(search.toLowerCase());
    const matchCat = !selectedCategory || t.orgCategoryId === selectedCategory;
    return matchSearch && matchCat;
  });

  const getCategoryForProcess = (process: Process) =>
    process.orgCategoryId ? categories.find((c) => c.id === process.orgCategoryId) : null;

  if (loading) {
    return (
      <div className="page-enter">
        <div className="skeleton" style={{ height: 36, width: 200, marginBottom: 8 }} />
        <div className="skeleton" style={{ height: 20, width: 300, marginBottom: 28 }} />
        <div className="skeleton" style={{ height: 44, marginBottom: 20, borderRadius: 10 }} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="skeleton" style={{ height: 140, borderRadius: 14 }} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="page-enter">
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, color: '#0f172a', margin: '0 0 6px', letterSpacing: '-0.03em' }}>
          Automations
        </h1>
        <p style={{ color: '#64748b', margin: 0, fontSize: 14 }}>
          {processes.length} automation{processes.length !== 1 ? 's' : ''} available to run
        </p>
      </div>

      {/* Search bar */}
      <div style={{ position: 'relative', marginBottom: 16 }}>
        <div style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', pointerEvents: 'none' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </div>
        <input
          type="text"
          placeholder="Search automations by name or description..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="form-input"
          style={{ paddingLeft: 40, fontSize: 14 }}
        />
        {search && (
          <button
            onClick={() => setSearch('')}
            style={{
              position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
              background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8',
              display: 'flex', alignItems: 'center', padding: 4,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>

      {/* Category filter pills */}
      {categories.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 24 }}>
          <button
            className={`cat-pill${!selectedCategory ? ' active' : ''}`}
            onClick={() => setSelectedCategory('')}
          >
            All
            <span style={{
              background: !selectedCategory ? '#c7d2fe' : '#e2e8f0',
              color: !selectedCategory ? '#4f46e5' : '#64748b',
              padding: '1px 7px', borderRadius: 9999, fontSize: 11, fontWeight: 700, marginLeft: 2,
            }}>
              {processes.length}
            </span>
          </button>
          {categories.map((cat) => {
            const count = processes.filter((t) => t.orgCategoryId === cat.id).length;
            const isActive = selectedCategory === cat.id;
            return (
              <button
                key={cat.id}
                className={`cat-pill${isActive ? ' active' : ''}`}
                onClick={() => setSelectedCategory(cat.id)}
              >
                {cat.colour && (
                  <span style={{
                    width: 8, height: 8, borderRadius: '50%',
                    background: cat.colour, flexShrink: 0,
                  }} />
                )}
                {cat.name}
                <span style={{
                  background: isActive ? '#c7d2fe' : '#e2e8f0',
                  color: isActive ? '#4f46e5' : '#64748b',
                  padding: '1px 7px', borderRadius: 9999, fontSize: 11, fontWeight: 700, marginLeft: 2,
                }}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Process grid */}
      {filtered.length === 0 ? (
        <div className="card empty-state">
          <div style={{
            width: 56, height: 56, borderRadius: 16, marginBottom: 16,
            background: 'linear-gradient(135deg, #f5f3ff, #ede9fe)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </div>
          <p style={{ margin: '0 0 6px', fontWeight: 700, fontSize: 16, color: '#0f172a' }}>
            {search ? 'No automations match your search' : 'No automations available'}
          </p>
          <p style={{ margin: '0 0 20px', fontSize: 13.5, color: '#64748b' }}>
            {search ? 'Try a different search term or clear the filters.' : 'Automations will appear here once they are activated.'}
          </p>
          {search && (
            <button className="btn btn-secondary" onClick={() => { setSearch(''); setSelectedCategory(''); }}>
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
          {filtered.map((process) => {
            const cat = getCategoryForProcess(process);
            return (
              <Link key={process.id} to={`/processes/${process.id}`} className="task-card" style={{ padding: '20px 22px', display: 'block' }}>
                {/* Category badge */}
                {cat && (
                  <div style={{ marginBottom: 10 }}>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: 5,
                      padding: '3px 9px', borderRadius: 9999,
                      background: cat.colour ? `${cat.colour}18` : '#f5f3ff',
                      border: `1px solid ${cat.colour ? `${cat.colour}40` : '#c7d2fe'}`,
                      fontSize: 11, fontWeight: 600,
                      color: cat.colour ?? '#6366f1',
                    }}>
                      {cat.colour && <span style={{ width: 6, height: 6, borderRadius: '50%', background: cat.colour, flexShrink: 0 }} />}
                      {cat.name}
                    </span>
                  </div>
                )}

                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                  <div style={{ fontWeight: 700, color: '#0f172a', fontSize: 15, letterSpacing: '-0.01em', lineHeight: 1.3 }}>
                    {process.name}
                  </div>
                  <div className="run-arrow" style={{ color: '#6366f1', fontSize: 13, fontWeight: 700, flexShrink: 0, marginTop: 2 }}>
                    Run →
                  </div>
                </div>

                {process.description && (
                  <div style={{
                    marginTop: 8, fontSize: 13, color: '#64748b', lineHeight: 1.55,
                    overflow: 'hidden', display: '-webkit-box',
                    WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                  }}>
                    {process.description}
                  </div>
                )}

                {process.inputSchema && (
                  <div style={{
                    marginTop: 12, padding: '8px 10px',
                    background: '#f8faff', border: '1px solid #e8ecf7',
                    borderRadius: 8, fontSize: 11.5, color: '#6366f1',
                    fontFamily: 'ui-monospace, monospace',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {process.inputSchema.substring(0, 90)}{process.inputSchema.length > 90 ? '…' : ''}
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
