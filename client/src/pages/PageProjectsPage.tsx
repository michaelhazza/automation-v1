import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { getActiveClientId, getActiveClientName } from '../lib/auth';
import { User } from '../lib/auth';
import ConfirmDialog from '../components/ConfirmDialog';
import { toast } from 'sonner';

// Matches PAGES_BASE_DOMAIN on the backend. Change here if the domain changes.
const PAGES_BASE_DOMAIN = 'synthetos.ai';

interface PageProject {
  id: string;
  name: string;
  slug: string;
  theme: { primaryColor?: string } | null;
  customDomain: string | null;
  createdAt: string;
  updatedAt: string;
}

const inputCls = 'w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500';

function slugify(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

function relativeDate(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffDay > 30) return new Date(dateStr).toLocaleDateString();
  if (diffDay >= 1) return `${diffDay}d ago`;
  if (diffHr >= 1) return `${diffHr}h ago`;
  if (diffMin >= 1) return `${diffMin}m ago`;
  return 'just now';
}

export default function PageProjectsPage({ user: _user }: { user: User }) {
  const navigate = useNavigate();
  const clientId = getActiveClientId();
  const clientName = getActiveClientName();

  const [projects, setProjects] = useState<PageProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [newSlug, setNewSlug] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!clientId) { setLoading(false); return; }
    api.get(`/api/subaccounts/${clientId}/page-projects`)
      .then(({ data }) => setProjects(data))
      .catch((err) => console.error('[PageProjectsPage] Failed to load page projects:', err))
      .finally(() => setLoading(false));
  }, [clientId]);

  const handleNameChange = (value: string) => {
    setNewName(value);
    setNewSlug(slugify(value));
  };

  const handleCreate = async () => {
    if (!newName.trim() || !newSlug.trim() || !clientId) return;
    setSaving(true);
    try {
      const { data } = await api.post(`/api/subaccounts/${clientId}/page-projects`, { name: newName.trim(), slug: newSlug.trim() });
      setProjects((p) => [data, ...p]);
      setShowNew(false); setNewName(''); setNewSlug('');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: { message?: string }; message?: string } } })?.response?.data?.error?.message
        ?? (err as { response?: { data?: { message?: string } } })?.response?.data?.message
        ?? 'Failed to create site';
      setError(msg);
    } finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    if (!clientId) return;
    setDeleting(id);
    try {
      await api.delete(`/api/subaccounts/${clientId}/page-projects/${id}`);
      setProjects((p) => p.filter((x) => x.id !== id));
      toast.success('Site deleted');
    } catch {
      toast.error('Failed to delete site');
    } finally {
      setDeleting(null);
      setConfirmDeleteId(null);
    }
  };

  if (!clientId) {
    return (
      <div className="animate-[fadeIn_0.2s_ease-out_both] flex flex-col items-center justify-center py-20 text-center">
        <div className="text-4xl mb-4">🌐</div>
        <div className="font-bold text-[18px] text-slate-900 mb-2">No client selected</div>
        <div className="text-[14px] text-slate-500">Select a client from the sidebar to view sites.</div>
      </div>
    );
  }

  return (
    <div className="animate-[fadeIn_0.2s_ease-out_both]">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[22px] font-bold text-slate-900 tracking-tight m-0">Sites</h1>
          {clientName && <div className="text-[13px] text-slate-500 mt-0.5">{clientName}</div>}
        </div>
        <button onClick={() => setShowNew(true)} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg transition-colors">
          + New Site
        </button>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-[13px] text-red-700 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600 bg-transparent border-0 cursor-pointer text-[16px] leading-none">&times;</button>
        </div>
      )}

      {showNew && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 mb-5">
          <div className="font-semibold text-[14px] text-slate-900 mb-3.5">New Site</div>
          <div className="flex flex-col gap-3">
            <input className={inputCls} placeholder="Site name" value={newName} onChange={(e) => handleNameChange(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleCreate()} autoFocus />
            <div>
              <input className={inputCls} placeholder="slug" value={newSlug} onChange={(e) => setNewSlug(slugify(e.target.value))} />
              {newSlug && (
                <div className="text-[12px] text-slate-400 mt-1.5">Your site will be available at <span className="font-medium text-slate-600">{newSlug}.{PAGES_BASE_DOMAIN}</span></div>
              )}
            </div>
            <div className="flex gap-2">
              <button onClick={handleCreate} disabled={!newName.trim() || !newSlug.trim() || saving} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-[13px] font-semibold rounded-lg transition-colors">
                {saving ? 'Creating…' : 'Create Site'}
              </button>
              <button onClick={() => { setShowNew(false); setNewName(''); setNewSlug(''); }} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-[13px] font-medium rounded-lg transition-colors">
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

      {!loading && projects.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="text-4xl mb-4">🌐</div>
          <div className="font-bold text-[18px] text-slate-900 mb-2">No sites yet</div>
          <div className="text-[14px] text-slate-500">Create your first site to get started.</div>
          <button onClick={() => setShowNew(true)} className="mt-3.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg transition-colors">
            + New Site
          </button>
        </div>
      )}

      {!loading && projects.length > 0 && (
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
          {projects.map((project) => (
            <div
              key={project.id}
              onClick={() => navigate(`/admin/subaccounts/${clientId}/page-projects/${project.id}`)}
              className="bg-white border border-slate-200 rounded-xl overflow-hidden cursor-pointer hover:border-slate-300 transition-colors"
            >
              <div className="h-1" style={{ background: project.theme?.primaryColor || '#6366f1' }} />
              <div className="p-[18px]">
                <div className="flex items-start justify-between gap-2">
                  <div className="font-semibold text-[14px] text-slate-900 leading-snug">{project.name}</div>
                </div>
                <div className="text-[13px] text-slate-500 mt-1.5 leading-relaxed">{project.slug}.{PAGES_BASE_DOMAIN}</div>
                <div className="mt-3.5 flex items-center gap-2">
                  <div className="text-[11px] text-slate-400">{relativeDate(project.createdAt)}</div>
                  <div className="flex-1" />
                  <button
                    onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(project.id); }}
                    disabled={deleting === project.id}
                    className="px-2.5 py-1 bg-slate-100 hover:bg-red-50 text-slate-600 hover:text-red-600 rounded-md text-[11px] font-medium border-0 cursor-pointer transition-colors disabled:opacity-50"
                  >
                    {deleting === project.id ? 'Deleting…' : 'Delete'}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {confirmDeleteId && (
        <ConfirmDialog
          title="Delete Site"
          message="Are you sure you want to delete this site? This action cannot be undone."
          confirmLabel="Delete"
          onConfirm={() => handleDelete(confirmDeleteId)}
          onCancel={() => setConfirmDeleteId(null)}
        />
      )}
    </div>
  );
}
