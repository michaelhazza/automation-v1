import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../lib/api';
import { User } from '../lib/auth';
import Modal from '../components/Modal';

// ─── Types ──────────────────────────────────────────────────────────────────

interface AgentLink {
  id: string;
  agentId: string;
  isActive: boolean;
  parentSubaccountAgentId: string | null;
  agentRole: string | null;
  agentTitle: string | null;
  agent: { id: string; name: string; slug: string; status: string };
}

interface TreeNode {
  id: string;
  agentId: string;
  parentSubaccountAgentId: string | null;
  agentRole: string | null;
  agentTitle: string | null;
  isActive: boolean;
  agent: { name: string; slug: string; status: string; isDraft?: boolean; requiresPrompt?: boolean };
  children: TreeNode[];
}

interface CompanyTemplate {
  id: string;
  name: string;
  description: string | null;
  agentCount: number;
  version: number;
}

interface SystemAgentOption {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  agentRole: string | null;
  agentTitle: string | null;
  isPublished: boolean;
}

interface LoadResult {
  templateName?: string;
  summary: {
    agentsLinked: number;
    agentsCreated: number;
    agentsReused: number;
    agentsDraft?: number;
    hierarchyUpdated?: number;
  };
}

type PageTab = 'list' | 'hierarchy';

// ─── Helpers ────────────────────────────────────────────────────────────────

const STATUS_CLS: Record<string, string> = {
  active: 'bg-green-100 text-green-800',
  inactive: 'bg-orange-50 text-orange-800',
  draft: 'bg-slate-100 text-slate-600',
};

const ROLE_CLS: Record<string, string> = {
  ceo: 'bg-amber-100 text-amber-800',
  orchestrator: 'bg-purple-100 text-purple-800',
  specialist: 'bg-blue-100 text-blue-800',
  worker: 'bg-slate-100 text-slate-700',
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-block px-2.5 py-0.5 rounded-full text-[11px] font-semibold capitalize ${STATUS_CLS[status] ?? STATUS_CLS.draft}`}>
      {status}
    </span>
  );
}

function RoleBadge({ role }: { role: string | null }) {
  if (!role) return null;
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium capitalize ${ROLE_CLS[role] ?? 'bg-slate-100 text-slate-600'}`}>
      {role}
    </span>
  );
}

function SubaccountTreeRow({ node, depth }: { node: TreeNode; depth: number }) {
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
            <span className="font-semibold text-slate-800 text-[14px]">{node.agent.name}</span>
            {node.agent.requiresPrompt && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-700">
                Requires prompt
              </span>
            )}
          </div>
        </td>
        <td className="px-4 py-2.5"><RoleBadge role={node.agentRole} /></td>
        <td className="px-4 py-2.5 text-[13px] text-slate-600">{node.agentTitle || '—'}</td>
        <td className="px-4 py-2.5"><StatusBadge status={node.agent.status} /></td>
        <td className="px-4 py-2.5">
          <span className={`inline-block w-2 h-2 rounded-full ${node.isActive ? 'bg-green-500' : 'bg-slate-300'}`} />
        </td>
      </tr>
      {expanded && hasChildren && node.children.map((child) => (
        <SubaccountTreeRow key={child.id} node={child} depth={depth + 1} />
      ))}
    </>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────

export default function SubaccountAgentsPage({ user: _user }: { user: User }) {
  const { subaccountId } = useParams<{ subaccountId: string }>();
  const [agentLinks, setAgentLinks] = useState<AgentLink[]>([]);
  const [treeData, setTreeData] = useState<TreeNode[]>([]);
  const [pageTab, setPageTab] = useState<PageTab>('list');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Load System Agents modal
  const [showLoadAgents, setShowLoadAgents] = useState(false);
  const [systemAgents, setSystemAgents] = useState<SystemAgentOption[]>([]);
  const [selectedAgentIds, setSelectedAgentIds] = useState<Set<string>>(new Set());
  const [loadingAgents, setLoadingAgents] = useState(false);
  const [loadAgentsResult, setLoadAgentsResult] = useState<LoadResult | null>(null);

  // Load Company Template modal
  const [showLoadTemplate, setShowLoadTemplate] = useState(false);
  const [companyTemplates, setCompanyTemplates] = useState<CompanyTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [parentAgentId, setParentAgentId] = useState('');
  const [loadingTemplate, setLoadingTemplate] = useState(false);
  const [loadTemplateResult, setLoadTemplateResult] = useState<LoadResult | null>(null);

  const load = async () => {
    if (!subaccountId) return;
    setLoading(true);
    try {
      const [linksRes, treeRes] = await Promise.all([
        api.get(`/api/subaccounts/${subaccountId}/agents`),
        api.get(`/api/subaccounts/${subaccountId}/agents/tree`),
      ]);
      setAgentLinks(linksRes.data);
      setTreeData(treeRes.data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [subaccountId]);

  // ── Load System Agents ──────────────────────────────────────────────────

  const openLoadAgents = async () => {
    setShowLoadAgents(true);
    setSelectedAgentIds(new Set());
    setLoadAgentsResult(null);
    try {
      const { data } = await api.get('/api/system-agents');
      setSystemAgents(data);
    } catch {
      setError('Failed to load system agents');
      setShowLoadAgents(false);
    }
  };

  const toggleAgentSelection = (id: string) => {
    setSelectedAgentIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllAgents = () => {
    if (selectedAgentIds.size === systemAgents.length) {
      setSelectedAgentIds(new Set());
    } else {
      setSelectedAgentIds(new Set(systemAgents.map(a => a.id)));
    }
  };

  const handleLoadAgents = async () => {
    if (!subaccountId || selectedAgentIds.size === 0) return;
    setLoadingAgents(true);
    try {
      const { data } = await api.post('/api/system-agents/load', {
        systemAgentIds: Array.from(selectedAgentIds),
        subaccountId,
      });
      setLoadAgentsResult(data);
      setSuccess(`Loaded ${data.agentsLinked} system agent(s) into subaccount.`);
      load();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error ?? 'Failed to load agents');
    } finally {
      setLoadingAgents(false);
    }
  };

  const resetLoadAgents = () => {
    setShowLoadAgents(false);
    setLoadAgentsResult(null);
    setSelectedAgentIds(new Set());
  };

  // ── Load Company Template ───────────────────────────────────────────────

  const openLoadTemplate = async () => {
    setShowLoadTemplate(true);
    setSelectedTemplateId('');
    setParentAgentId('');
    setLoadTemplateResult(null);
    try {
      const { data } = await api.get('/api/company-templates');
      setCompanyTemplates(data);
    } catch {
      setError('Failed to load company templates');
      setShowLoadTemplate(false);
    }
  };

  const handleLoadTemplate = async () => {
    if (!subaccountId || !selectedTemplateId) return;
    setLoadingTemplate(true);
    try {
      const { data } = await api.post(`/api/company-templates/${selectedTemplateId}/load`, {
        subaccountId,
        parentSubaccountAgentId: parentAgentId || null,
      });
      setLoadTemplateResult(data);
      setSuccess(`Company template "${data.templateName}" loaded: ${data.summary.agentsLinked} linked, ${data.summary.agentsCreated} created.`);
      load();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error ?? 'Failed to load template');
    } finally {
      setLoadingTemplate(false);
    }
  };

  const resetLoadTemplate = () => {
    setShowLoadTemplate(false);
    setLoadTemplateResult(null);
    setSelectedTemplateId('');
    setParentAgentId('');
  };

  if (loading) {
    return <div className="py-12 text-center text-slate-500 text-[14px]">Loading agents...</div>;
  }

  return (
    <div className="animate-[fadeIn_0.2s_ease-out_both]">
      <div className="flex justify-between items-start mb-6">
        <div>
          <Link to={`/admin/subaccounts/${subaccountId}`} className="text-indigo-500 text-[13px] no-underline">
            ← Back to subaccount
          </Link>
          <h1 className="text-[28px] font-bold text-slate-800 m-0 mt-1">Subaccount Agents</h1>
          <p className="text-sm text-slate-500 mt-1">Manage agents linked to this subaccount</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={openLoadAgents}
            className="px-4 py-2.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-lg text-[14px] font-medium cursor-pointer transition-colors"
          >
            Load System Agents
          </button>
          <button
            onClick={openLoadTemplate}
            className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white border-0 rounded-lg text-[14px] font-medium cursor-pointer transition-colors"
          >
            Load Company Template
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 px-4 py-2.5 rounded-lg text-[14px] bg-red-50 text-red-700 border border-red-200 flex justify-between items-center">
          <span>{error}</span>
          <button onClick={() => setError('')} className="bg-transparent border-0 cursor-pointer text-inherit text-[16px] px-1">x</button>
        </div>
      )}
      {success && (
        <div className="mb-4 px-4 py-2.5 rounded-lg text-[14px] bg-green-50 text-green-700 border border-green-200 flex justify-between items-center">
          <span>{success}</span>
          <button onClick={() => setSuccess('')} className="bg-transparent border-0 cursor-pointer text-inherit text-[16px] px-1">x</button>
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-slate-200 mb-6 flex gap-1">
        {(['list', 'hierarchy'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setPageTab(tab)}
            className={`px-4 py-2 text-[14px] font-medium border-b-2 transition-colors bg-transparent border-t-0 border-l-0 border-r-0 cursor-pointer ${
              pageTab === tab
                ? 'border-indigo-600 text-indigo-600 font-semibold'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {tab === 'list' ? `Agents (${agentLinks.length})` : 'Hierarchy'}
          </button>
        ))}
      </div>

      {/* Hierarchy Tab */}
      {pageTab === 'hierarchy' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          {treeData.length === 0 ? (
            <div className="py-12 text-center text-slate-500 text-[14px]">
              No hierarchy configured. Load agents or a company template to get started.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-4 py-3 text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider">Agent</th>
                  <th className="px-4 py-3 text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider">Role</th>
                  <th className="px-4 py-3 text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider">Title</th>
                  <th className="px-4 py-3 text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider">Active</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {treeData.map((node) => (
                  <SubaccountTreeRow key={node.id} node={node} depth={0} />
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* List Tab */}
      {pageTab === 'list' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          {agentLinks.length === 0 ? (
            <div className="py-12 text-center text-slate-500 text-[14px]">
              No agents linked to this subaccount yet.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-4 py-3 text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider">Agent</th>
                  <th className="px-4 py-3 text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider">Role</th>
                  <th className="px-4 py-3 text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider">Active</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {agentLinks.map((link) => (
                  <tr key={link.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3">
                      <span className="font-semibold text-slate-800">{link.agent.name}</span>
                      {link.agent.status === 'draft' && (
                        <span className="ml-2 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-700">
                          Requires setup
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={link.agent.status} /></td>
                    <td className="px-4 py-3"><RoleBadge role={link.agentRole} /></td>
                    <td className="px-4 py-3">
                      <span className={`inline-block w-2 h-2 rounded-full ${link.isActive ? 'bg-green-500' : 'bg-slate-300'}`} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── Load System Agents Modal ─────────────────────────────────────── */}
      {showLoadAgents && (
        <Modal title="Load System Agents" onClose={resetLoadAgents} maxWidth={600}>
          {!loadAgentsResult ? (
            <>
              <p className="text-[13px] text-slate-500 m-0 mb-4">
                Select which platform agents to load into this subaccount. Already-linked agents will be skipped.
              </p>
              {systemAgents.length === 0 ? (
                <div className="py-8 text-center text-slate-500 text-[14px]">No published system agents available.</div>
              ) : (
                <>
                  <div className="mb-3">
                    <label className="flex items-center gap-2 text-[13px] text-slate-600 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedAgentIds.size === systemAgents.length}
                        onChange={selectAllAgents}
                        className="accent-indigo-600"
                      />
                      Select all ({systemAgents.length})
                    </label>
                  </div>
                  <div className="max-h-[320px] overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
                    {systemAgents.map((agent) => (
                      <label
                        key={agent.id}
                        className="flex items-start gap-3 px-3 py-2.5 cursor-pointer hover:bg-slate-50 transition-colors"
                      >
                        <input
                          type="checkbox"
                          checked={selectedAgentIds.has(agent.id)}
                          onChange={() => toggleAgentSelection(agent.id)}
                          className="accent-indigo-600 mt-0.5"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-slate-800 text-[13px]">{agent.name}</div>
                          {agent.description && (
                            <div className="text-[12px] text-slate-500 mt-0.5 truncate">{agent.description}</div>
                          )}
                        </div>
                        {agent.agentRole && (
                          <RoleBadge role={agent.agentRole} />
                        )}
                      </label>
                    ))}
                  </div>
                </>
              )}
              <div className="flex gap-3 mt-4">
                <button
                  onClick={handleLoadAgents}
                  disabled={loadingAgents || selectedAgentIds.size === 0}
                  className={`px-5 py-2 text-white border-0 rounded-lg text-[14px] font-medium transition-colors ${loadingAgents || selectedAgentIds.size === 0 ? 'bg-slate-400 cursor-default' : 'bg-indigo-600 hover:bg-indigo-700 cursor-pointer'}`}
                >
                  {loadingAgents ? 'Loading...' : `Load ${selectedAgentIds.size} Agent${selectedAgentIds.size !== 1 ? 's' : ''}`}
                </button>
                <button onClick={resetLoadAgents} className="px-5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 border-0 rounded-lg text-[14px] font-medium cursor-pointer transition-colors">
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="mb-4">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-[16px]">✅</span>
                  <span className="font-semibold text-slate-800 text-[15px]">System agents loaded</span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-[13px]">
                  <div><span className="text-slate-500">Linked:</span> {loadAgentsResult.summary.agentsLinked}</div>
                  <div><span className="text-slate-500">Created:</span> {loadAgentsResult.summary.agentsCreated}</div>
                  <div><span className="text-slate-500">Reused:</span> {loadAgentsResult.summary.agentsReused}</div>
                </div>
              </div>
              <button onClick={resetLoadAgents} className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white border-0 rounded-lg text-[14px] font-medium cursor-pointer transition-colors">
                Done
              </button>
            </>
          )}
        </Modal>
      )}

      {/* ── Load Company Template Modal ──────────────────────────────────── */}
      {showLoadTemplate && (
        <Modal title="Load Company Template" onClose={resetLoadTemplate} maxWidth={600}>
          {!loadTemplateResult ? (
            <>
              <p className="text-[13px] text-slate-500 m-0 mb-4">
                Browse the shared template library and load a company into this subaccount.
                Optionally choose a manager agent to nest the company under.
              </p>

              <div className="mb-4">
                <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Company template</label>
                <select
                  value={selectedTemplateId}
                  onChange={(e) => setSelectedTemplateId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px]"
                >
                  <option value="">Select a template...</option>
                  {companyTemplates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.agentCount} agents)
                    </option>
                  ))}
                </select>
                {selectedTemplateId && (() => {
                  const selected = companyTemplates.find(t => t.id === selectedTemplateId);
                  return selected?.description ? (
                    <div className="text-[12px] text-slate-500 mt-1.5">{selected.description}</div>
                  ) : null;
                })()}
              </div>

              {agentLinks.length > 0 && (
                <div className="mb-4">
                  <label className="block text-[13px] font-medium text-slate-700 mb-1.5">
                    Load under manager <span className="text-slate-400 font-normal">(optional)</span>
                  </label>
                  <select
                    value={parentAgentId}
                    onChange={(e) => setParentAgentId(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px]"
                  >
                    <option value="">No parent — top level</option>
                    {agentLinks.map((link) => (
                      <option key={link.id} value={link.id}>
                        {link.agent.name}{link.agentRole ? ` (${link.agentRole})` : ''}
                      </option>
                    ))}
                  </select>
                  <div className="text-[12px] text-slate-400 mt-1">
                    The company's top-level agents will report to this manager.
                  </div>
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={handleLoadTemplate}
                  disabled={loadingTemplate || !selectedTemplateId}
                  className={`px-5 py-2 text-white border-0 rounded-lg text-[14px] font-medium transition-colors ${loadingTemplate || !selectedTemplateId ? 'bg-slate-400 cursor-default' : 'bg-indigo-600 hover:bg-indigo-700 cursor-pointer'}`}
                >
                  {loadingTemplate ? 'Loading...' : 'Load Template'}
                </button>
                <button onClick={resetLoadTemplate} className="px-5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 border-0 rounded-lg text-[14px] font-medium cursor-pointer transition-colors">
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="mb-4">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-[16px]">✅</span>
                  <span className="font-semibold text-slate-800 text-[15px]">
                    Company template "{loadTemplateResult.templateName}" loaded
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-[13px]">
                  <div><span className="text-slate-500">Linked:</span> {loadTemplateResult.summary.agentsLinked}</div>
                  <div><span className="text-slate-500">Created:</span> {loadTemplateResult.summary.agentsCreated}</div>
                  <div><span className="text-slate-500">Reused:</span> {loadTemplateResult.summary.agentsReused}</div>
                  {loadTemplateResult.summary.agentsDraft !== undefined && loadTemplateResult.summary.agentsDraft > 0 && (
                    <div><span className="text-slate-500">Draft:</span> {loadTemplateResult.summary.agentsDraft}</div>
                  )}
                </div>
                {loadTemplateResult.summary.agentsDraft !== undefined && loadTemplateResult.summary.agentsDraft > 0 && (
                  <div className="mt-2 px-2.5 py-1.5 bg-amber-50 border border-amber-200 rounded text-[12px] text-amber-700">
                    {loadTemplateResult.summary.agentsDraft} agent(s) created in draft status.{' '}
                    <Link to="/admin/agents" className="text-amber-800 underline">Set up prompts</Link>
                  </div>
                )}
              </div>
              <button onClick={resetLoadTemplate} className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white border-0 rounded-lg text-[14px] font-medium cursor-pointer transition-colors">
                Done
              </button>
            </>
          )}
        </Modal>
      )}
    </div>
  );
}
