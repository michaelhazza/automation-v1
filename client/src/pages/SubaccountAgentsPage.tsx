import { useEffect, useState, useRef } from 'react';
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

interface Template {
  id: string;
  name: string;
  version: number;
  slotCount: number;
  isDefaultForSubaccount: boolean;
}

interface ApplySummary {
  appliedTemplateVersion: number;
  summary: {
    agentsLinked: number;
    agentsCreated: number;
    agentsReused: number;
    agentsDraft: number;
    hierarchyUpdated: number;
    agentsRemovedFromHierarchy: number;
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

  // Template apply
  const [templates, setTemplates] = useState<Template[]>([]);
  const [showApply, setShowApply] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [applyMode, setApplyMode] = useState<'merge' | 'replace'>('merge');
  const [applying, setApplying] = useState(false);
  const [applyPreview, setApplyPreview] = useState<ApplySummary | null>(null);
  const [applyResult, setApplyResult] = useState<ApplySummary | null>(null);

  // Direct import
  const [showImport, setShowImport] = useState(false);
  const [importName, setImportName] = useState('');
  const [importManifest, setImportManifest] = useState<Record<string, unknown> | null>(null);
  const [importFileName, setImportFileName] = useState('');
  const [saveAsTemplate, setSaveAsTemplate] = useState(false);
  const [importError, setImportError] = useState('');
  const [importResult, setImportResult] = useState<Record<string, unknown> | null>(null);
  const [importProcessing, setImportProcessing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    if (!subaccountId) return;
    setLoading(true);
    try {
      const [linksRes, treeRes, templatesRes] = await Promise.all([
        api.get(`/api/subaccounts/${subaccountId}/agents`),
        api.get(`/api/subaccounts/${subaccountId}/agents/tree`),
        api.get('/api/hierarchy-templates'),
      ]);
      setAgentLinks(linksRes.data);
      setTreeData(treeRes.data);
      setTemplates(templatesRes.data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [subaccountId]);

  // Template apply flow
  const handlePreview = async () => {
    if (!selectedTemplateId || !subaccountId) return;
    setApplying(true);
    setApplyPreview(null);
    try {
      const { data } = await api.post(`/api/hierarchy-templates/${selectedTemplateId}/apply`, {
        subaccountId,
        mode: applyMode,
        preview: true,
      });
      setApplyPreview(data);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error ?? 'Preview failed');
    } finally {
      setApplying(false);
    }
  };

  const handleApplyConfirm = async () => {
    if (!selectedTemplateId || !subaccountId) return;
    setApplying(true);
    try {
      const { data } = await api.post(`/api/hierarchy-templates/${selectedTemplateId}/apply`, {
        subaccountId,
        mode: applyMode,
        preview: false,
      });
      setApplyResult(data);
      setSuccess(`Template applied: ${data.summary.agentsLinked} linked, ${data.summary.agentsCreated} created, ${data.summary.agentsReused} reused.`);
      load();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error ?? 'Apply failed');
    } finally {
      setApplying(false);
    }
  };

  const resetApplyModal = () => {
    setShowApply(false);
    setApplyPreview(null);
    setApplyResult(null);
    setSelectedTemplateId('');
  };

  // Direct import flow
  const handleImportFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setImportFileName(file.name);
    setImportError('');
    setImportResult(null);

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const manifest = JSON.parse(reader.result as string);
        setImportManifest(manifest);
        const company = manifest.company as Record<string, unknown> | undefined;
        setImportName((company?.name as string) || file.name.replace(/\.\w+$/, ''));
      } catch {
        setImportError('Invalid JSON file');
        setImportManifest(null);
      }
    };
    reader.readAsText(file);
  };

  const handleDirectImport = async () => {
    if (!importManifest || !importName.trim() || !subaccountId) return;
    setImportProcessing(true);
    setImportError('');
    try {
      const { data } = await api.post(`/api/subaccounts/${subaccountId}/agents/import`, {
        name: importName,
        manifest: importManifest,
        saveAsTemplate,
      });
      setImportResult(data);
      load();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setImportError(e.response?.data?.error ?? 'Import failed');
    } finally {
      setImportProcessing(false);
    }
  };

  const resetImportModal = () => {
    setShowImport(false);
    setImportManifest(null);
    setImportResult(null);
    setImportName('');
    setImportFileName('');
    setImportError('');
    setSaveAsTemplate(false);
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
            onClick={() => setShowImport(true)}
            className="px-4 py-2.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-lg text-[14px] font-medium cursor-pointer transition-colors"
          >
            Import from Paperclip
          </button>
          <button
            onClick={() => setShowApply(true)}
            className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white border-0 rounded-lg text-[14px] font-medium cursor-pointer transition-colors"
          >
            Load Template
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 px-4 py-2.5 rounded-lg text-[14px] bg-red-50 text-red-700 border border-red-200 flex justify-between items-center">
          <span>{error}</span>
          <button onClick={() => setError('')} className="bg-transparent border-0 cursor-pointer text-inherit text-[16px] px-1">×</button>
        </div>
      )}
      {success && (
        <div className="mb-4 px-4 py-2.5 rounded-lg text-[14px] bg-green-50 text-green-700 border border-green-200 flex justify-between items-center">
          <span>{success}</span>
          <button onClick={() => setSuccess('')} className="bg-transparent border-0 cursor-pointer text-inherit text-[16px] px-1">×</button>
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
              No hierarchy configured. Apply a template or set parent relationships manually.
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

      {/* Load Template Modal */}
      {showApply && (
        <Modal title="Load Template" onClose={resetApplyModal} maxWidth={560}>
          {!applyResult ? (
            <>
              <div className="mb-4">
                <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Template</label>
                <select
                  value={selectedTemplateId}
                  onChange={(e) => { setSelectedTemplateId(e.target.value); setApplyPreview(null); }}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px]"
                >
                  <option value="">Select a template...</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} (v{t.version}, {t.slotCount} agents){t.isDefaultForSubaccount ? ' — Default' : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div className="mb-4">
                <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Apply mode</label>
                <div className="flex gap-3">
                  <label className="flex items-center gap-2 text-[13px] text-slate-700 cursor-pointer">
                    <input
                      type="radio" name="mode" value="merge"
                      checked={applyMode === 'merge'}
                      onChange={() => { setApplyMode('merge'); setApplyPreview(null); }}
                      className="accent-indigo-600"
                    />
                    <div>
                      <span className="font-medium">Merge</span>
                      <span className="text-slate-500 ml-1">— keep existing agents</span>
                    </div>
                  </label>
                  <label className="flex items-center gap-2 text-[13px] text-slate-700 cursor-pointer">
                    <input
                      type="radio" name="mode" value="replace"
                      checked={applyMode === 'replace'}
                      onChange={() => { setApplyMode('replace'); setApplyPreview(null); }}
                      className="accent-indigo-600"
                    />
                    <div>
                      <span className="font-medium">Replace</span>
                      <span className="text-slate-500 ml-1">— clear existing hierarchy</span>
                    </div>
                  </label>
                </div>
              </div>

              {applyPreview && (
                <div className="mb-4 p-3 bg-slate-50 rounded-lg">
                  <div className="text-[13px] font-semibold text-slate-700 mb-2">Preview</div>
                  <div className="grid grid-cols-3 gap-2 text-[13px]">
                    <div><span className="text-slate-500">Linked:</span> {applyPreview.summary.agentsLinked}</div>
                    <div><span className="text-slate-500">Created:</span> {applyPreview.summary.agentsCreated}</div>
                    <div><span className="text-slate-500">Reused:</span> {applyPreview.summary.agentsReused}</div>
                    <div><span className="text-slate-500">Draft:</span> {applyPreview.summary.agentsDraft}</div>
                    <div><span className="text-slate-500">Hierarchy:</span> {applyPreview.summary.hierarchyUpdated}</div>
                    {applyPreview.summary.agentsRemovedFromHierarchy > 0 && (
                      <div><span className="text-slate-500">Cleared:</span> {applyPreview.summary.agentsRemovedFromHierarchy}</div>
                    )}
                  </div>
                  {applyPreview.summary.agentsDraft > 0 && (
                    <div className="mt-2 px-2.5 py-1.5 bg-amber-50 border border-amber-200 rounded text-[12px] text-amber-700">
                      {applyPreview.summary.agentsDraft} agent(s) will be created in draft status — prompts required before activation.
                    </div>
                  )}
                </div>
              )}

              <div className="flex gap-3">
                {!applyPreview ? (
                  <button
                    onClick={handlePreview}
                    disabled={applying || !selectedTemplateId}
                    className={`px-5 py-2 text-white border-0 rounded-lg text-[14px] font-medium transition-colors ${applying || !selectedTemplateId ? 'bg-slate-400 cursor-default' : 'bg-indigo-600 hover:bg-indigo-700 cursor-pointer'}`}
                  >
                    {applying ? 'Loading...' : 'Preview'}
                  </button>
                ) : (
                  <button
                    onClick={handleApplyConfirm}
                    disabled={applying}
                    className={`px-5 py-2 text-white border-0 rounded-lg text-[14px] font-medium transition-colors ${applying ? 'bg-slate-400 cursor-default' : 'bg-indigo-600 hover:bg-indigo-700 cursor-pointer'}`}
                  >
                    {applying ? 'Applying...' : 'Apply Template'}
                  </button>
                )}
                <button onClick={resetApplyModal} className="px-5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 border-0 rounded-lg text-[14px] font-medium cursor-pointer transition-colors">
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="mb-4">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-[16px]">✅</span>
                  <span className="font-semibold text-slate-800 text-[15px]">Template applied successfully</span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-[13px]">
                  <div><span className="text-slate-500">Linked:</span> {applyResult.summary.agentsLinked}</div>
                  <div><span className="text-slate-500">Created:</span> {applyResult.summary.agentsCreated}</div>
                  <div><span className="text-slate-500">Reused:</span> {applyResult.summary.agentsReused}</div>
                  <div><span className="text-slate-500">Draft:</span> {applyResult.summary.agentsDraft}</div>
                </div>
                {applyResult.summary.agentsDraft > 0 && (
                  <div className="mt-2 px-2.5 py-1.5 bg-amber-50 border border-amber-200 rounded text-[12px] text-amber-700">
                    {applyResult.summary.agentsDraft} agent(s) created in draft status.{' '}
                    <Link to="/admin/agents" className="text-amber-800 underline">Set up prompts</Link>
                  </div>
                )}
              </div>
              <button onClick={resetApplyModal} className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white border-0 rounded-lg text-[14px] font-medium cursor-pointer transition-colors">
                Done
              </button>
            </>
          )}
        </Modal>
      )}

      {/* Direct Import Modal */}
      {showImport && (
        <Modal title="Import from Paperclip" onClose={resetImportModal} maxWidth={560}>
          {!importResult ? (
            <>
              <div className="mb-4">
                <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Paperclip manifest</label>
                <input ref={fileInputRef} type="file" accept=".json,.zip" onChange={handleImportFileSelect} className="hidden" />
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="px-4 py-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-lg text-[13px] font-medium cursor-pointer transition-colors"
                  >
                    Choose file
                  </button>
                  <span className="text-[13px] text-slate-500">{importFileName || 'No file selected'}</span>
                </div>
              </div>
              {importManifest && (
                <>
                  <div className="mb-4">
                    <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Name</label>
                    <input
                      value={importName}
                      onChange={(e) => setImportName(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px]"
                    />
                  </div>
                  <label className="flex items-center gap-2 mb-4 text-[13px] text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={saveAsTemplate}
                      onChange={(e) => setSaveAsTemplate(e.target.checked)}
                      className="accent-indigo-600"
                    />
                    Save as org template for reuse
                  </label>
                </>
              )}
              {importError && (
                <div className="mb-4 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-[13px] text-red-700">{importError}</div>
              )}
              <div className="flex gap-3">
                <button
                  onClick={handleDirectImport}
                  disabled={importProcessing || !importManifest || !importName.trim()}
                  className={`px-5 py-2 text-white border-0 rounded-lg text-[14px] font-medium transition-colors ${importProcessing || !importManifest || !importName.trim() ? 'bg-slate-400 cursor-default' : 'bg-indigo-600 hover:bg-indigo-700 cursor-pointer'}`}
                >
                  {importProcessing ? 'Importing...' : 'Import & Apply'}
                </button>
                <button onClick={resetImportModal} className="px-5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 border-0 rounded-lg text-[14px] font-medium cursor-pointer transition-colors">
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="mb-4">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-[16px]">✅</span>
                  <span className="font-semibold text-slate-800 text-[15px]">Import complete</span>
                </div>
                <div className="text-[13px] text-slate-600">
                  Agents imported and hierarchy applied to this subaccount.
                  {saveAsTemplate && ' Template saved for reuse.'}
                </div>
              </div>
              <button onClick={resetImportModal} className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white border-0 rounded-lg text-[14px] font-medium cursor-pointer transition-colors">
                Done
              </button>
            </>
          )}
        </Modal>
      )}
    </div>
  );
}
