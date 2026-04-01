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

const STATUS_LABELS: Record<string, string> = { active: 'Active', completed: 'Completed', archived: 'Archived' };
const STATUS_CLS: Record<string, string> = {
  active:    'bg-green-100 text-green-700',
  completed: 'bg-indigo-100 text-indigo-700',
  archived:  'bg-slate-100 text-slate-500',
};

const PROJECT_COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f97316', '#eab308', '#22c55e', '#0ea5e9'];

const inputCls = 'w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500';

export default function ProjectsPage({ user: _user }: { user: User }) {
  const _navigate = useNavigate();
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
      .catch((err) => console.error('[ProjectsPage] Failed to load projects:', err))
      .finally(() => setLoading(false));
  }, [clientId]);

  const handleCreate = async () => {
    if (!newName.trim() || !clientId) return;
    setSaving(true);
    try {
      const { data } = await api.post(`/api/subaccounts/${clientId}/projects`, { name: newName.trim(), description: newDesc.trim() || null, color: newColor });
      setProjects((p) => [data, ...p]);
      setShowNew(false); setNewName(''); setNewDesc(''); setNewColor('#6366f1');
    } catch {
      // TODO: show error toast
    } finally { setSaving(false); }
  };

  const handleArchive = async (id: string) => {
    if (!clientId) return;
    await api.patch(`/api/subaccounts/${clientId}/projects/${id}`, { status: 'archived' });
    setProjects((p) => p.map((x) => x.id === id ? { ...x, status: 'archived' as const } : x));
  };

  const filtered = filter === 'all' ? projects : projects.filter((p) => p.status === filter);

  if (!clientId) {
    return (
      <div className="animate-[fadeIn_0.2s_ease-out_both] flex flex-col items-center justify-center py-20 text-center">
        <div className="text-4xl mb-4">📁</div>
        <div className="font-bold text-[18px] text-slate-900 mb-2">No client selected</div>
        <div className="text-[14px] text-slate-500">Select a client from the sidebar to view projects.</div>
      </div>
    );
  }

  return (
    <div className="animate-[fadeIn_0.2s_ease-out_both]">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[22px] font-bold text-slate-900 tracking-tight m-0">Projects</h1>
          {clientName && <div className="text-[13px] text-slate-500 mt-0.5">{clientName}</div>}
        </div>
        <button onClick={() => setShowNew(true)} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg transition-colors">
          + New Project
        </button>
      </div>

      <div className="flex gap-2 mb-6">
        {(['all', 'active', 'completed', 'archived'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3.5 py-1.5 rounded-full border text-[12px] font-semibold cursor-pointer transition-colors ${filter === f ? 'border-indigo-500 bg-indigo-50 text-indigo-600' : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'}`}
          >
            {f === 'all' ? `All (${projects.length})` : `${STATUS_LABELS[f]} (${projects.filter((p) => p.status === f).length})`}
          </button>
        ))}
      </div>

      {showNew && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 mb-5">
          <div className="font-semibold text-[14px] text-slate-900 mb-3.5">New Project</div>
          <div className="flex flex-col gap-3">
            <input className={inputCls} placeholder="Project name" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleCreate()} autoFocus />
            <input className={inputCls} placeholder="Description (optional)" value={newDesc} onChange={(e) => setNewDesc(e.target.value)} />
            <div>
              <div className="text-[12px] text-slate-500 font-medium mb-2">Colour</div>
              <div className="flex gap-2">
                {PROJECT_COLORS.map((c) => (
                  <button key={c} onClick={() => setNewColor(c)} className="w-6 h-6 rounded-md border-0 cursor-pointer transition-shadow" style={{ background: c, boxShadow: newColor === c ? `0 0 0 2px white, 0 0 0 4px ${c}` : 'none' }} />
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={handleCreate} disabled={!newName.trim() || saving} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-[13px] font-semibold rounded-lg transition-colors">
                {saving ? 'Creating…' : 'Create Project'}
              </button>
              <button onClick={() => { setShowNew(false); setNewName(''); setNewDesc(''); }} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-[13px] font-medium rounded-lg transition-colors">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {loading && (
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
          {[1, 2, 3].map((i) => <div key={i} className="h-28 rounded-xl bg-[linear-gradient(90deg,#f1f5f9_25%,#e2e8f0_50%,#f1f5f9_75%)] bg-[length:400%_100%] animate-[shimmer_1.4s_ease-in-out_infinite]" />)}
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="text-4xl mb-4">📁</div>
          <div className="font-bold text-[18px] text-slate-900 mb-2">
            {filter === 'all' ? 'No projects yet' : `No ${filter} projects`}
          </div>
          <div className="text-[14px] text-slate-500">
            {filter === 'all' ? 'Create your first project to organise work for this client.' : `No projects with ${filter} status.`}
          </div>
          {filter === 'all' && (
            <button onClick={() => setShowNew(true)} className="mt-3.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg transition-colors">
              + New Project
            </button>
          )}
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
          {filtered.map((project) => (
            <div key={project.id} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="h-1" style={{ background: project.color }} />
              <div className="p-[18px]">
                <div className="flex items-start justify-between gap-2">
                  <div className="font-semibold text-[14px] text-slate-900 leading-snug">{project.name}</div>
                  <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${STATUS_CLS[project.status]}`}>
                    {STATUS_LABELS[project.status]}
                  </span>
                </div>
                {project.description && <div className="text-[13px] text-slate-500 mt-1.5 leading-relaxed">{project.description}</div>}
                <div className="mt-3.5 flex items-center gap-2">
                  <div className="text-[11px] text-slate-400">Created {new Date(project.createdAt).toLocaleDateString()}</div>
                  <div className="flex-1" />
                  {project.status === 'active' && (
                    <button onClick={() => handleArchive(project.id)} className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-md text-[11px] font-medium border-0 cursor-pointer transition-colors">
                      Archive
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
