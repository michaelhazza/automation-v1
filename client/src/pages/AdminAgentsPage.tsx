import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { User } from '../lib/auth';
import ConfirmDialog from '../components/ConfirmDialog';

interface Agent {
  id: string;
  name: string;
  description: string | null;
  status: string;
  modelId: string;
  systemAgentId: string | null;
  isSystemManaged: boolean;
  dataSources?: { id: string }[];
  dataSourceCount?: number;
  createdAt: string;
}

const STATUS_STYLES: Record<string, string> = {
  active:   'bg-green-100 text-green-800',
  inactive: 'bg-orange-50 text-orange-800',
  draft:    'bg-slate-100 text-slate-600',
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-block px-2.5 py-0.5 rounded-full text-[12px] font-semibold capitalize ${STATUS_STYLES[status] ?? STATUS_STYLES.draft}`}>
      {status}
    </span>
  );
}

export default function AdminAgentsPage({ user: _user }: { user: User }) {
  const navigate = useNavigate();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<Record<string, string>>({});

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/api/agents');
      setAgents(data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleActivate = async (id: string) => {
    setActionError((prev) => ({ ...prev, [id]: '' }));
    try {
      await api.post(`/api/agents/${id}/activate`);
      load();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setActionError((prev) => ({ ...prev, [id]: e.response?.data?.error ?? 'Failed to activate' }));
    }
  };

  const handleDeactivate = async (id: string) => {
    setActionError((prev) => ({ ...prev, [id]: '' }));
    try {
      await api.post(`/api/agents/${id}/deactivate`);
      load();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setActionError((prev) => ({ ...prev, [id]: e.response?.data?.error ?? 'Failed to deactivate' }));
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteId) return;
    try {
      await api.delete(`/api/agents/${deleteId}`);
      setDeleteId(null);
      load();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setActionError((prev) => ({ ...prev, [deleteId!]: e.response?.data?.error ?? 'Failed to delete' }));
      setDeleteId(null);
    }
  };

  if (loading) {
    return <div className="p-12 text-center text-sm text-slate-500">Loading agents...</div>;
  }

  return (
    <div className="animate-[fadeIn_0.2s_ease-out_both]">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-[28px] font-bold text-slate-800 m-0">Agents</h1>
          <p className="text-sm text-slate-500 mt-2">Create and manage AI agent configurations</p>
        </div>
        <button
          onClick={() => navigate('/admin/agents/new')}
          className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg transition-colors"
        >
          + New Agent
        </button>
      </div>

      {deleteId && (
        <ConfirmDialog
          title="Delete agent"
          message="Are you sure you want to delete this agent? This action cannot be undone."
          confirmLabel="Delete"
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeleteId(null)}
        />
      )}

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {agents.length === 0 ? (
          <div className="py-16 px-12 flex flex-col items-center text-center">
            <div className="text-4xl mb-4">🤖</div>
            <div className="text-[16px] font-semibold text-slate-800 mb-2">No agents yet</div>
            <div className="text-sm text-slate-500 mb-6">Create your first AI agent to get started.</div>
            <button
              onClick={() => navigate('/admin/agents/new')}
              className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg transition-colors"
            >
              + New Agent
            </button>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-4 py-3 text-left text-[13px] font-semibold text-slate-700">Name</th>
                <th className="px-4 py-3 text-left text-[13px] font-semibold text-slate-700">Status</th>
                <th className="px-4 py-3 text-left text-[13px] font-semibold text-slate-700">Model</th>
                <th className="px-4 py-3 text-left text-[13px] font-semibold text-slate-700">Data Sources</th>
                <th className="px-4 py-3 text-left text-[13px] font-semibold text-slate-700">Created</th>
                <th className="px-4 py-3 text-left text-[13px] font-semibold text-slate-700">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {agents.map((agent) => {
                const dsCount = agent.dataSourceCount ?? agent.dataSources?.length ?? 0;
                return (
                  <tr key={agent.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-800">{agent.name}</span>
                        {agent.isSystemManaged && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-violet-100 text-violet-700 tracking-wide">
                            System
                          </span>
                        )}
                      </div>
                      {agent.description && (
                        <div className="text-xs text-slate-500 mt-0.5 max-w-[280px] truncate">{agent.description}</div>
                      )}
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={agent.status} /></td>
                    <td className="px-4 py-3 text-[13px] text-slate-600">{agent.modelId ?? '—'}</td>
                    <td className="px-4 py-3 text-[13px] text-slate-600">
                      {dsCount} {dsCount === 1 ? 'source' : 'sources'}
                    </td>
                    <td className="px-4 py-3 text-[13px] text-slate-500">
                      {new Date(agent.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2 items-center flex-wrap">
                        <Link
                          to={`/admin/agents/${agent.id}`}
                          className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md text-xs font-medium no-underline transition-colors"
                        >
                          Edit
                        </Link>
                        {agent.status !== 'active' && (
                          <button
                            onClick={() => handleActivate(agent.id)}
                            className="px-2.5 py-1 bg-green-100 hover:bg-green-200 text-green-800 rounded-md text-xs font-medium transition-colors"
                          >
                            Activate
                          </button>
                        )}
                        {agent.status === 'active' && (
                          <button
                            onClick={() => handleDeactivate(agent.id)}
                            className="px-2.5 py-1 bg-orange-50 hover:bg-orange-100 text-orange-800 rounded-md text-xs font-medium transition-colors"
                          >
                            Deactivate
                          </button>
                        )}
                        <button
                          onClick={() => setDeleteId(agent.id)}
                          className="px-2.5 py-1 bg-red-50 hover:bg-red-100 text-red-600 rounded-md text-xs font-medium transition-colors"
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
      </div>
    </div>
  );
}
