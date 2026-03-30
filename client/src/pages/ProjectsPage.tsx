import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { getActiveClientId, getActiveClientName } from '../lib/auth';
import { User } from '../lib/auth';

interface Project {
  id: string;
  name: string;
  description: string | null;
  status: 'active' | 'completed' | 'archived';
  color: string;
  createdAt: string;
  updatedAt: string;
}

const STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  completed: 'Completed',
  archived: 'Archived',
};

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  active: { bg: 'rgba(34,197,94,0.12)', text: '#16a34a' },
  completed: { bg: 'rgba(99,102,241,0.12)', text: '#6366f1' },
  archived: { bg: 'rgba(100,116,139,0.12)', text: '#64748b' },
};

const PROJECT_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e',
  '#f97316', '#eab308', '#22c55e', '#0ea5e9',
];

interface Props { user: User }

export default function ProjectsPage({ user: _user }: Props) {
  const navigate = useNavigate();
  const clientId = getActiveClientId();
  const clientName = getActiveClientName();

  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newColor, setNewColor] = useState('#6366f1');
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState<'all' | 'active' | 'completed' | 'archived'>('all');

  useEffect(() => {
    if (!clientId) { setLoading(false); return; }
    api.get(`/api/subaccounts/${clientId}/projects`)
      .then(({ data }) => setProjects(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [clientId]);

  const handleCreate = async () => {
    if (!newName.trim() || !clientId) return;
    setSaving(true);
    try {
      const { data } = await api.post(`/api/subaccounts/${clientId}/projects`, {
        name: newName.trim(),
        description: newDesc.trim() || null,
        color: newColor,
      });
      setProjects(p => [data, ...p]);
      setShowNew(false);
      setNewName('');
      setNewDesc('');
      setNewColor('#6366f1');
    } catch {
      // TODO: show error toast
    } finally {
      setSaving(false);
    }
  };

  const handleArchive = async (id: string) => {
    if (!clientId) return;
    await api.patch(`/api/subaccounts/${clientId}/projects/${id}`, { status: 'archived' });
    setProjects(p => p.map(x => x.id === id ? { ...x, status: 'archived' as const } : x));
  };

  const filtered = filter === 'all' ? projects : projects.filter(p => p.status === filter);
  const activeCount = projects.filter(p => p.status === 'active').length;

  if (!clientId) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">📁</div>
        <div className="empty-state-title">No client selected</div>
        <div className="empty-state-desc">Select a client from the sidebar to view projects.</div>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#0f172a', letterSpacing: '-0.02em' }}>
            Projects
          </h1>
          {clientName && (
            <div style={{ fontSize: 13, color: '#64748b', marginTop: 3 }}>{clientName}</div>
          )}
        </div>
        <button className="btn btn-primary" onClick={() => setShowNew(true)}>
          + New Project
        </button>
      </div>

      {/* Stats row */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
        {(['all', 'active', 'completed', 'archived'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              padding: '6px 14px', borderRadius: 20, border: '1px solid',
              fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
              transition: 'all 0.1s',
              borderColor: filter === f ? '#6366f1' : '#e2e8f0',
              background: filter === f ? 'rgba(99,102,241,0.08)' : 'white',
              color: filter === f ? '#6366f1' : '#64748b',
            }}
          >
            {f === 'all' ? `All (${projects.length})` : `${STATUS_LABELS[f]} (${projects.filter(p => p.status === f).length})`}
          </button>
        ))}
      </div>

      {/* New project form */}
      {showNew && (
        <div className="card" style={{ marginBottom: 20, padding: 20 }}>
          <div style={{ fontWeight: 600, fontSize: 14, color: '#0f172a', marginBottom: 14 }}>New Project</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <input
              className="form-input"
              placeholder="Project name"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreate()}
              autoFocus
            />
            <input
              className="form-input"
              placeholder="Description (optional)"
              value={newDesc}
              onChange={e => setNewDesc(e.target.value)}
            />
            <div>
              <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8, fontWeight: 500 }}>Colour</div>
              <div style={{ display: 'flex', gap: 8 }}>
                {PROJECT_COLORS.map(c => (
                  <button
                    key={c}
                    onClick={() => setNewColor(c)}
                    style={{
                      width: 24, height: 24, borderRadius: 6, background: c, border: 'none', cursor: 'pointer',
                      boxShadow: newColor === c ? `0 0 0 2px white, 0 0 0 4px ${c}` : 'none',
                      transition: 'box-shadow 0.15s',
                    }}
                  />
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-primary" onClick={handleCreate} disabled={!newName.trim() || saving}>
                {saving ? 'Creating…' : 'Create Project'}
              </button>
              <button className="btn" onClick={() => { setShowNew(false); setNewName(''); setNewDesc(''); }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
          {[1, 2, 3].map(i => (
            <div key={i} className="skeleton" style={{ height: 120, borderRadius: 10 }} />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && filtered.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-icon">📁</div>
          <div className="empty-state-title">
            {filter === 'all' ? 'No projects yet' : `No ${filter} projects`}
          </div>
          <div className="empty-state-desc">
            {filter === 'all' ? 'Create your first project to organise work for this client.' : `No projects with ${filter} status.`}
          </div>
          {filter === 'all' && (
            <button className="btn btn-primary" style={{ marginTop: 14 }} onClick={() => setShowNew(true)}>
              + New Project
            </button>
          )}
        </div>
      )}

      {/* Project grid */}
      {!loading && filtered.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
          {filtered.map(project => {
            const sc = STATUS_COLORS[project.status];
            return (
              <div
                key={project.id}
                className="card"
                style={{ padding: 0, overflow: 'hidden', cursor: 'default' }}
              >
                {/* Color band */}
                <div style={{ height: 4, background: project.color }} />
                <div style={{ padding: 18 }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, color: '#0f172a', lineHeight: 1.3 }}>
                      {project.name}
                    </div>
                    <span style={{
                      fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10,
                      background: sc.bg, color: sc.text, flexShrink: 0,
                    }}>
                      {STATUS_LABELS[project.status]}
                    </span>
                  </div>
                  {project.description && (
                    <div style={{ fontSize: 13, color: '#64748b', marginTop: 6, lineHeight: 1.5 }}>
                      {project.description}
                    </div>
                  )}
                  <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ fontSize: 11, color: '#94a3b8' }}>
                      Created {new Date(project.createdAt).toLocaleDateString()}
                    </div>
                    <div style={{ flex: 1 }} />
                    {project.status === 'active' && (
                      <button
                        className="btn btn-ghost"
                        style={{ padding: '3px 10px', fontSize: 11 }}
                        onClick={() => handleArchive(project.id)}
                      >
                        Archive
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
