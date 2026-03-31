import { useEffect, useState, lazy, Suspense } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import api from '../lib/api';
import { User } from '../lib/auth';
import ConfirmDialog from '../components/ConfirmDialog';
import HeartbeatEditor from '../components/HeartbeatEditor';

const AdminAgentTemplatesPage = lazy(() => import('./AdminAgentTemplatesPage'));

// Live run counts per agent (polled from subaccount live-status isn't per-agent,
// so we use a simple org-level stat to show the total running count in the header)


interface Agent {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  status: string;
  modelId: string;
  systemAgentId: string | null;
  isSystemManaged: boolean;
  heartbeatEnabled: boolean;
  heartbeatIntervalHours: number | null;
  heartbeatOffsetHours: number;
  dataSources?: { id: string }[];
  dataSourceCount?: number;
  parentAgentId: string | null;
  agentRole: string | null;
  agentTitle: string | null;
  createdAt: string;
}

interface TreeNode extends Agent {
  children: TreeNode[];
}

type PageTab = 'list' | 'team-templates' | 'heartbeat';

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

const ROLE_CLS: Record<string, string> = {
  ceo: 'bg-amber-100 text-amber-800',
  orchestrator: 'bg-purple-100 text-purple-800',
  specialist: 'bg-blue-100 text-blue-800',
  worker: 'bg-slate-100 text-slate-700',
};

function RoleBadge({ role }: { role: string | null }) {
  if (!role) return null;
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium capitalize ${ROLE_CLS[role] ?? 'bg-slate-100 text-slate-600'}`}>
      {role}
    </span>
  );
}

function OrgHierarchyRow({ node, depth, onNavigate }: { node: TreeNode; depth: number; onNavigate: (id: string) => void }) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = node.children.length > 0;

  return (
    <>
      <tr className="hover:bg-slate-50 transition-colors">
        <td className="px-4 py-2.5">
          <div className="flex items-center gap-1.5" style={{ paddingLeft: `${depth * 24}px` }}>
            {hasChildren ? (
              <button
                onClick={() => setExpanded(!expanded)}
                className="w-5 h-5 flex items-center justify-center bg-transparent border-0 cursor-pointer text-slate-400 hover:text-slate-700 text-[12px] transition-transform"
                style={{ transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
              >
                &#9654;
              </button>
            ) : <span className="w-5" />}
            <span className="font-semibold text-slate-800 text-[14px]">{node.name}</span>
            {node.isSystemManaged && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-violet-100 text-violet-700">System</span>
            )}
          </div>
        </td>
        <td className="px-4 py-2.5"><RoleBadge role={node.agentRole} /></td>
        <td className="px-4 py-2.5 text-[13px] text-slate-600">{node.agentTitle || '—'}</td>
        <td className="px-4 py-2.5"><StatusBadge status={node.status} /></td>
        <td className="px-4 py-2.5">
          <button
            onClick={() => onNavigate(node.id)}
            className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 border-0 rounded-md text-[12px] font-medium cursor-pointer transition-colors"
          >
            Edit
          </button>
        </td>
      </tr>
      {expanded && hasChildren && node.children.map((child) => (
        <OrgHierarchyRow key={child.id} node={child} depth={depth + 1} onNavigate={onNavigate} />
      ))}
    </>
  );
}

export default function AdminAgentsPage({ user }: { user: User }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const pageTab: PageTab = tabParam === 'team-templates' ? 'team-templates' : tabParam === 'heartbeat' ? 'heartbeat' : 'list';
  const switchTab = (tab: PageTab) => setSearchParams(tab === 'list' ? {} : { tab });
  const [agents, setAgents] = useState<Agent[]>([]);
  const [treeData, setTreeData] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<Record<string, string>>({});
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive' | 'draft'>('all');
  const [liveRunCount, setLiveRunCount] = useState(0);

  const load = async () => {
    setLoading(true);
    try {
      const [agentsRes, treeRes] = await Promise.all([
        api.get('/api/agents'),
        api.get('/api/agents/tree'),
      ]);
      setAgents(agentsRes.data);
      setTreeData(treeRes.data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // Poll for live running agent count (org-wide, status=running)
  useEffect(() => {
    const fetchLive = () => api.get('/api/agent-activity', { params: { status: 'running', limit: 100 } })
      .then(({ data }) => setLiveRunCount(Array.isArray(data) ? data.length : 0))
      .catch(() => {});
    fetchLive();
    const t = setInterval(fetchLive, 15_000);
    return () => clearInterval(t);
  }, []);

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
    return (
      <div className="flex flex-col gap-4 animate-[fadeIn_0.2s_ease-out_both]">
        <div className="h-9 w-48 rounded-lg bg-[linear-gradient(90deg,#f1f5f9_25%,#e2e8f0_50%,#f1f5f9_75%)] bg-[length:400%_100%] animate-[shimmer_1.4s_ease-in-out_infinite]" />
        <div className="h-[300px] rounded-xl bg-[linear-gradient(90deg,#f1f5f9_25%,#e2e8f0_50%,#f1f5f9_75%)] bg-[length:400%_100%] animate-[shimmer_1.4s_ease-in-out_infinite]" />
      </div>
    );
  }

  const activeCount   = agents.filter(a => a.status === 'active').length;
  const inactiveCount = agents.filter(a => a.status === 'inactive').length;
  const draftCount    = agents.filter(a => a.status === 'draft').length;

  const filtered = statusFilter === 'all' ? agents :
    agents.filter(a => a.status === statusFilter);

  return (
    <div className="animate-[fadeIn_0.2s_ease-out_both]">
      <div className="flex justify-between items-start mb-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-[28px] font-bold text-slate-800 m-0">Agents</h1>
            {liveRunCount > 0 && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-blue-50 border border-blue-200 rounded-full text-[12px] font-semibold text-blue-700">
                <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                {liveRunCount} running
              </span>
            )}
          </div>
          <p className="text-sm text-slate-500 mt-1.5">Create and manage AI agent configurations</p>
        </div>
        <button
          onClick={() => navigate('/admin/agents/new')}
          className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg transition-colors"
        >
          + New Agent
        </button>
      </div>


      {/* Tabs */}
      <div className="border-b border-slate-200 mb-6 flex gap-1">
        {([['list', 'Agents'], ['team-templates', 'Team Templates'], ['heartbeat', 'Heartbeat']] as const).map(([tab, label]) => (
          <button
            key={tab}
            onClick={() => switchTab(tab as PageTab)}
            className={`px-4 py-2 text-[14px] font-medium border-b-2 transition-colors bg-transparent border-t-0 border-l-0 border-r-0 cursor-pointer ${
              pageTab === tab
                ? 'border-indigo-600 text-indigo-600 font-semibold'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Team Templates Tab */}
      {pageTab === 'team-templates' && (
        <Suspense fallback={<div className="py-8 text-sm text-slate-500">Loading templates...</div>}>
          <AdminAgentTemplatesPage user={user} embedded />
        </Suspense>
      )}

      {/* Heartbeat Tab */}
      {pageTab === 'heartbeat' && (
        <HeartbeatEditor
          levelLabel="agent"
          agents={agents.map(a => ({
            id: a.id, name: a.name, icon: a.icon,
            heartbeatEnabled: a.heartbeatEnabled,
            heartbeatIntervalHours: a.heartbeatIntervalHours,
            heartbeatOffsetHours: a.heartbeatOffsetHours,
          }))}
          onUpdate={async (agentId, config) => {
            await api.patch(`/api/agents/${agentId}`, config);
            load();
          }}
        />
      )}

      {/* List Tab */}
      {pageTab === 'list' && <>
      {/* Status filter tabs */}
      {agents.length > 0 && (
        <div className="flex gap-1 mb-4">
          {([
            { id: 'all',      label: `All (${agents.length})` },
            { id: 'active',   label: `Active (${activeCount})` },
            { id: 'inactive', label: `Inactive (${inactiveCount})` },
            { id: 'draft',    label: `Draft (${draftCount})` },
          ] as const).map(f => (
            <button
              key={f.id}
              onClick={() => setStatusFilter(f.id)}
              className={`px-3.5 py-1.5 rounded-lg text-[12px] font-semibold border-0 cursor-pointer transition-colors [font-family:inherit] ${
                statusFilter === f.id
                  ? 'bg-indigo-100 text-indigo-700'
                  : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

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
                <th className="px-4 py-3 text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider">Name</th>
                <th className="px-4 py-3 text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider">Model</th>
                <th className="px-4 py-3 text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider">Data Sources</th>
                <th className="px-4 py-3 text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider">Created</th>
                <th className="px-4 py-3 text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filtered.length === 0 ? (
                <tr><td colSpan={6} className="py-10 text-center text-sm text-slate-400">No agents match this filter</td></tr>
              ) : filtered.map((agent) => {
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
      </>}
    </div>
  );
}
