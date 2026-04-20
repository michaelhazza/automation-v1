import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import api from '../lib/api';
import { User } from '../lib/auth';
import ConfirmDialog from '../components/ConfirmDialog';
import SystemOrganisationTemplatesPage from './SystemOrganisationTemplatesPage';

interface SystemAgent {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  status: string;
  isPublished: boolean;
  defaultSystemSkillSlugs: string[] | null;
  parentSystemAgentId: string | null;
  agentRole: string | null;
  agentTitle: string | null;
  createdAt: string;
}


const STATUS_CLS: Record<string, string> = {
  active:   'bg-green-100 text-green-800',
  inactive: 'bg-orange-50 text-orange-800',
  draft:    'bg-slate-100 text-slate-600',
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-block px-2.5 py-0.5 rounded-full text-[12px] font-medium capitalize ${STATUS_CLS[status] ?? STATUS_CLS.draft}`}>
      {status}
    </span>
  );
}

function PublishedBadge({ published }: { published: boolean }) {
  return (
    <span className={`inline-block px-2.5 py-0.5 rounded-full text-[12px] font-medium ${published ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-600'}`}>
      {published ? 'Yes' : 'No'}
    </span>
  );
}

type ActiveTab = 'list' | 'team-templates';

const VALID_TABS = new Set<string>(['list', 'team-templates']);

export default function SystemAgentsPage({ user }: { user: User }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const initialTab = tabParam && VALID_TABS.has(tabParam) ? (tabParam as ActiveTab) : 'list';
  const [agents, setAgents] = useState<SystemAgent[]>([]);
  const [activeTab, setActiveTab] = useState<ActiveTab>(initialTab);

  const switchTab = (tab: ActiveTab) => {
    setActiveTab(tab);
    setSearchParams(tab === 'list' ? {} : { tab });
  };
  const [loading, setLoading] = useState(true);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<Record<string, string>>({});
  const [importStatus, setImportStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true);
    try {
      const agentsRes = await api.get('/api/system/agents');
      setAgents(agentsRes.data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handlePublish = async (id: string) => {
    setActionError((prev) => ({ ...prev, [id]: '' }));
    try {
      await api.post(`/api/system/agents/${id}/publish`);
      load();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setActionError((prev) => ({ ...prev, [id]: e.response?.data?.error ?? 'Failed to publish' }));
    }
  };

  const handleUnpublish = async (id: string) => {
    setActionError((prev) => ({ ...prev, [id]: '' }));
    try {
      await api.post(`/api/system/agents/${id}/unpublish`);
      load();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setActionError((prev) => ({ ...prev, [id]: e.response?.data?.error ?? 'Failed to unpublish' }));
    }
  };

  const handleExport = async () => {
    const response = await api.get('/api/system/agents/export', { responseType: 'blob' });
    const url = URL.createObjectURL(response.data as Blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'system-agents.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    setImporting(true);
    setImportStatus(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const { data } = await api.post('/api/system/agents/import', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setImportStatus({ type: 'success', message: `${data.message}${data.errors?.length ? ` (${data.errors.length} skipped)` : ''}` });
      load();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setImportStatus({ type: 'error', message: e.response?.data?.error ?? 'Import failed' });
    } finally {
      setImporting(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteId) return;
    try {
      await api.delete(`/api/system/agents/${deleteId}`);
      setDeleteId(null);
      load();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setActionError((prev) => ({ ...prev, [deleteId]: e.response?.data?.error ?? 'Failed to delete' }));
      setDeleteId(null);
    }
  };

  if (loading) {
    return <div className="py-12 text-center text-slate-500 text-[14px]">Loading system agents...</div>;
  }

  return (
    <>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-[28px] font-bold text-slate-800 m-0">System Agents</h1>
          <p className="text-slate-500 mt-2 mb-0 text-[14px]">
            Manage platform-level agent definitions available across all organizations.
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={handleImportFile}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            className={`px-4 py-2.5 bg-white text-slate-700 border border-slate-200 rounded-lg text-[14px] font-medium whitespace-nowrap transition-colors ${importing ? 'opacity-60 cursor-not-allowed' : 'hover:bg-slate-50 cursor-pointer'}`}
          >
            {importing ? 'Importing…' : '↑ Import CSV'}
          </button>
          <button
            onClick={handleExport}
            className="px-4 py-2.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-lg text-[14px] font-medium whitespace-nowrap cursor-pointer transition-colors"
          >
            ↓ Export CSV
          </button>
          <button
            onClick={() => navigate('/system/agents/new')}
            className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white border-0 rounded-lg text-[14px] font-medium whitespace-nowrap cursor-pointer transition-colors"
          >
            + New System Agent
          </button>
        </div>
      </div>

      {importStatus && (
        <div className={`mb-4 px-4 py-2.5 rounded-lg text-[14px] flex justify-between items-center ${importStatus.type === 'success' ? 'bg-green-100 text-green-800 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
          <span>{importStatus.message}</span>
          <button onClick={() => setImportStatus(null)} className="bg-transparent border-0 cursor-pointer text-inherit text-[16px] px-1">×</button>
        </div>
      )}

      {deleteId && (
        <ConfirmDialog
          title="Delete system agent"
          message="Are you sure you want to delete this system agent? This action cannot be undone."
          confirmLabel="Delete"
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeleteId(null)}
        />
      )}

      {/* Tabs */}
      <div className="border-b border-slate-200 mb-6 flex gap-1">
        {([['list', 'Agents'], ['team-templates', 'Team Templates']] as const).map(([tab, label]) => (
          <button
            key={tab}
            onClick={() => switchTab(tab as ActiveTab)}
            className={`px-4 py-2 text-[14px] font-medium border-b-2 transition-colors bg-transparent border-t-0 border-l-0 border-r-0 cursor-pointer ${
              activeTab === tab
                ? 'border-indigo-600 text-indigo-600 font-semibold'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Team Templates Tab */}
      {activeTab === 'team-templates' && <SystemOrganisationTemplatesPage user={user} />}

      {/* List Tab */}
      {activeTab === 'list' && <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {agents.length === 0 ? (
          <div className="py-16 px-12 text-center">
            <div className="text-[40px] mb-4">🤖</div>
            <div className="text-[16px] font-semibold text-slate-800 mb-2">No system agents yet</div>
            <div className="text-[14px] text-slate-500 mb-6">Create your first system agent to get started.</div>
            <button
              onClick={() => navigate('/system/agents/new')}
              className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white border-0 rounded-lg text-[14px] font-medium cursor-pointer transition-colors"
            >
              + New System Agent
            </button>
          </div>
        ) : (
          <table className="w-full border-collapse text-[14px]">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-4 py-3 text-left font-semibold text-slate-700 text-[13px]">Name</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700 text-[13px]">Slug</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700 text-[13px]">Status</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700 text-[13px]">Published</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700 text-[13px]">System Skills</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700 text-[13px]">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {agents.map((agent) => {
                const skillCount = agent.defaultSystemSkillSlugs?.length ?? 0;
                return (
                  <tr key={agent.id}>
                    <td className="px-4 py-3">
                      <Link to={`/system/agents/${agent.id}`} className="font-semibold text-slate-800 hover:text-indigo-600 no-underline transition-colors">{agent.name}</Link>
                      {agent.description && (
                        <div className="text-[12px] text-slate-500 mt-0.5 max-w-[280px] overflow-hidden text-ellipsis whitespace-nowrap">
                          {agent.description}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <code className="text-[12px] bg-slate-100 px-1.5 py-0.5 rounded text-slate-600">{agent.slug}</code>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={agent.status} />
                    </td>
                    <td className="px-4 py-3">
                      <PublishedBadge published={agent.isPublished} />
                    </td>
                    <td className="px-4 py-3 text-slate-600 text-[13px]">
                      {skillCount} {skillCount === 1 ? 'skill' : 'skills'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2 items-center flex-wrap">
                        <Link
                          to={`/system/agents/${agent.id}`}
                          className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md text-[12px] font-medium no-underline transition-colors"
                        >
                          Edit
                        </Link>
                        {!agent.isPublished && (
                          <button
                            onClick={() => handlePublish(agent.id)}
                            className="px-2.5 py-1 bg-green-100 hover:bg-green-200 text-green-800 border-0 rounded-md text-[12px] font-medium cursor-pointer transition-colors"
                          >
                            Publish
                          </button>
                        )}
                        {agent.isPublished && (
                          <button
                            onClick={() => handleUnpublish(agent.id)}
                            className="px-2.5 py-1 bg-orange-50 hover:bg-orange-100 text-orange-800 border-0 rounded-md text-[12px] font-medium cursor-pointer transition-colors"
                          >
                            Unpublish
                          </button>
                        )}
                        <button
                          onClick={() => setDeleteId(agent.id)}
                          className="px-2.5 py-1 bg-red-50 hover:bg-red-100 text-red-600 border-0 rounded-md text-[12px] font-medium cursor-pointer transition-colors"
                        >
                          Delete
                        </button>
                      </div>
                      {actionError[agent.id] && (
                        <div className="text-[11px] text-red-600 mt-1">{actionError[agent.id]}</div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>}
    </>
  );
}
