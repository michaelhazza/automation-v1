import { useEffect, useState } from 'react';
import api from '../lib/api';
import { User } from '../lib/auth';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';

interface Template {
  id: string;
  name: string;
  description: string | null;
  sourceType: string;
  version: number;
  isDefaultForSubaccount: boolean;
  slotCount: number;
  createdAt: string;
}

interface CompanyTemplate {
  id: string;
  name: string;
  description: string | null;
  agentCount: number;
  version: number;
}

interface CompanyTemplateDetail {
  id: string;
  name: string;
  description: string | null;
  agentCount: number;
  slots: Array<{
    id: string;
    blueprintSlug: string;
    blueprintName: string | null;
    blueprintRole: string | null;
    blueprintTitle: string | null;
    systemAgentId: string | null;
    parentSlotId: string | null;
  }>;
  tree: unknown[];
}

const ROLE_CLS: Record<string, string> = {
  orchestrator: 'bg-purple-100 text-purple-800',
  specialist: 'bg-blue-100 text-blue-800',
  worker: 'bg-slate-100 text-slate-700',
};

interface SlotNode {
  id: string;
  blueprintSlug: string;
  blueprintName: string | null;
  blueprintRole: string | null;
  blueprintTitle: string | null;
  systemAgentId: string | null;
  children?: SlotNode[];
}

function SlotTreeRow({ slot, depth }: { slot: SlotNode; depth: number }) {
  const [expanded, setExpanded] = useState(true);
  const children = slot.children ?? [];
  const hasChildren = children.length > 0;

  return (
    <>
      <tr className="hover:bg-slate-50 transition-colors">
        <td className="px-4 py-2">
          <div className="flex items-center gap-1.5" style={{ paddingLeft: `${depth * 20}px` }}>
            {hasChildren ? (
              <button
                onClick={() => setExpanded(!expanded)}
                className="w-4 h-4 flex items-center justify-center bg-transparent border-0 cursor-pointer text-slate-400 hover:text-slate-700 text-[11px] transition-transform"
                style={{ transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
              >
                &#9654;
              </button>
            ) : <span className="w-4" />}
            <span className="font-medium text-slate-800 text-[13px]">
              {slot.blueprintName || slot.blueprintSlug}
            </span>
            {slot.systemAgentId && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-100 text-green-700">System</span>
            )}
          </div>
        </td>
        <td className="px-4 py-2">
          {slot.blueprintRole && (
            <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-medium capitalize ${ROLE_CLS[slot.blueprintRole] ?? 'bg-slate-100 text-slate-600'}`}>
              {slot.blueprintRole}
            </span>
          )}
        </td>
        <td className="px-4 py-2 text-[12px] text-slate-500">
          {slot.blueprintTitle || '—'}
        </td>
      </tr>
      {expanded && children.map((child) => (
        <SlotTreeRow key={child.id} slot={child} depth={depth + 1} />
      ))}
    </>
  );
}

export default function SubaccountBlueprintsPage({ user: _user, embedded = false }: { user: User; embedded?: boolean }) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [error, setError] = useState('');

  // Create modal
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createDesc, setCreateDesc] = useState('');
  const [creating, setCreating] = useState(false);

  // Browse shared library
  const [showLibrary, setShowLibrary] = useState(false);
  const [companyTemplates, setCompanyTemplates] = useState<CompanyTemplate[]>([]);
  const [loadingLibrary, setLoadingLibrary] = useState(false);
  const [previewDetail, setPreviewDetail] = useState<CompanyTemplateDetail | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/api/hierarchy-templates');
      setTemplates(data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async () => {
    if (!createName.trim()) return;
    setCreating(true);
    try {
      await api.post('/api/hierarchy-templates', { name: createName, description: createDesc || undefined });
      setShowCreate(false);
      setCreateName('');
      setCreateDesc('');
      load();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error ?? 'Failed to create template');
    } finally {
      setCreating(false);
    }
  };

  const handleSetDefault = async (id: string) => {
    try {
      await api.patch(`/api/hierarchy-templates/${id}`, { isDefaultForSubaccount: true });
      load();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error ?? 'Failed to set default');
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteId) return;
    try {
      await api.delete(`/api/hierarchy-templates/${deleteId}`);
      setDeleteId(null);
      load();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error ?? 'Failed to delete');
      setDeleteId(null);
    }
  };

  // Browse shared library
  const openLibrary = async () => {
    setShowLibrary(true);
    setLoadingLibrary(true);
    setPreviewDetail(null);
    try {
      const { data } = await api.get('/api/company-templates');
      setCompanyTemplates(data);
    } catch {
      setError('Failed to load shared library');
      setShowLibrary(false);
    } finally {
      setLoadingLibrary(false);
    }
  };

  const handlePreviewTemplate = async (id: string) => {
    try {
      const { data } = await api.get(`/api/company-templates/${id}`);
      setPreviewDetail(data);
    } catch {
      setError('Failed to load template details');
    }
  };

  if (loading) {
    return <div className="py-12 text-center text-slate-500 text-[14px]">Loading templates...</div>;
  }

  return (
    <div className="animate-[fadeIn_0.2s_ease-out_both]">
      <div className="flex justify-between items-start mb-6">
        {!embedded && (
          <div>
            <h1 className="text-[28px] font-bold text-slate-800 m-0">Team Templates</h1>
            <p className="text-sm text-slate-500 mt-1.5">Reusable agent organisation blueprints for subaccounts</p>
          </div>
        )}
        <button
          onClick={() => setShowCreate(true)}
          className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white border-0 rounded-lg text-[14px] font-medium cursor-pointer transition-colors"
        >
          + New Template
        </button>
      </div>

      {error && (
        <div className="mb-4 px-4 py-2.5 rounded-lg text-[14px] bg-red-50 text-red-700 border border-red-200 flex justify-between items-center">
          <span>{error}</span>
          <button onClick={() => setError('')} className="bg-transparent border-0 cursor-pointer text-inherit text-[16px] px-1">x</button>
        </div>
      )}

      {deleteId && (
        <ConfirmDialog
          title="Delete template"
          message="Are you sure you want to delete this template? This will not affect agents already created from it."
          confirmLabel="Delete"
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeleteId(null)}
        />
      )}

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {templates.length === 0 ? (
          <div className="py-16 px-12 flex flex-col items-center text-center">
            <div className="text-4xl mb-4">📋</div>
            <div className="text-[16px] font-semibold text-slate-800 mb-2">No templates yet</div>
            <div className="text-sm text-slate-500 mb-6">Create a template manually or browse the shared company template library.</div>
            <div className="flex gap-2">
              <button
                onClick={openLibrary}
                className="px-4 py-2.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-lg text-[14px] font-medium cursor-pointer transition-colors"
              >
                Browse Shared Library
              </button>
              <button
                onClick={() => setShowCreate(true)}
                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white border-0 rounded-lg text-[14px] font-medium cursor-pointer transition-colors"
              >
                + New Template
              </button>
            </div>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-4 py-3 text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider">Name</th>
                <th className="px-4 py-3 text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider">Agents</th>
                <th className="px-4 py-3 text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider">Created</th>
                <th className="px-4 py-3 text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {templates.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-800">{t.name}</span>
                        {t.isDefaultForSubaccount && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-100 text-indigo-700">Default</span>
                        )}
                      </div>
                      {t.description && (
                        <div className="text-xs text-slate-500 mt-0.5 max-w-[280px] truncate">{t.description}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-[13px] text-slate-600">{t.slotCount}</td>
                    <td className="px-4 py-3 text-[13px] text-slate-500">
                      {new Date(t.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2 items-center flex-wrap">
                        {!t.isDefaultForSubaccount && (
                          <button
                            onClick={() => handleSetDefault(t.id)}
                            className="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border-0 rounded-md text-xs font-medium cursor-pointer transition-colors"
                          >
                            Set Default
                          </button>
                        )}
                        <button
                          onClick={() => setDeleteId(t.id)}
                          className="px-2.5 py-1 bg-red-50 hover:bg-red-100 text-red-600 border-0 rounded-md text-xs font-medium cursor-pointer transition-colors"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Create template modal */}
      {showCreate && (
        <Modal title="Create Template" onClose={() => setShowCreate(false)}>
          <div className="grid gap-3.5 mb-5">
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Name *</label>
              <input
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px]"
                placeholder="e.g. Research Team"
              />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Description</label>
              <textarea
                value={createDesc}
                onChange={(e) => setCreateDesc(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] min-h-[60px] resize-y"
                placeholder="Optional description..."
              />
            </div>
          </div>
          <div className="flex gap-3">
            <button
              onClick={handleCreate}
              disabled={creating || !createName.trim()}
              className={`px-5 py-2 text-white border-0 rounded-lg text-[14px] font-medium transition-colors ${creating || !createName.trim() ? 'bg-slate-400 cursor-default' : 'bg-indigo-600 hover:bg-indigo-700 cursor-pointer'}`}
            >
              {creating ? 'Creating...' : 'Create'}
            </button>
            <button onClick={() => setShowCreate(false)} className="px-5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 border-0 rounded-lg text-[14px] font-medium cursor-pointer transition-colors">
              Cancel
            </button>
          </div>
        </Modal>
      )}

      {/* Browse Shared Library modal */}
      {showLibrary && (
        <Modal title={previewDetail ? `Preview: ${previewDetail.name}` : 'Shared Company Template Library'} onClose={() => { setShowLibrary(false); setPreviewDetail(null); }} maxWidth={700}>
          {loadingLibrary ? (
            <div className="py-8 text-center text-slate-500 text-[14px]">Loading...</div>
          ) : previewDetail ? (
            <>
              {previewDetail.description && (
                <p className="text-[13px] text-slate-500 mt-0 mb-4">{previewDetail.description}</p>
              )}
              <div className="text-[13px] text-slate-600 mb-3">{previewDetail.agentCount} agents in this template</div>
              {(previewDetail.tree as SlotNode[]).length > 0 && (
                <div className="border border-slate-200 rounded-lg overflow-hidden mb-4">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200">
                        <th className="px-4 py-2 text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider">Agent</th>
                        <th className="px-4 py-2 text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider">Role</th>
                        <th className="px-4 py-2 text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider">Title</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {(previewDetail.tree as SlotNode[]).map((slot) => (
                        <SlotTreeRow key={slot.id} slot={slot} depth={0} />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <button
                onClick={() => setPreviewDetail(null)}
                className="px-5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 border-0 rounded-lg text-[14px] font-medium cursor-pointer transition-colors"
              >
                Back to Library
              </button>
            </>
          ) : (
            <>
              <p className="text-[13px] text-slate-500 m-0 mb-4">
                Browse company templates available from the platform. These can be loaded into subaccounts when managing their agents.
              </p>
              {companyTemplates.length === 0 ? (
                <div className="py-8 text-center text-slate-500 text-[14px]">
                  No company templates available yet. Ask a system admin to import templates.
                </div>
              ) : (
                <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg overflow-hidden">
                  {companyTemplates.map((t) => (
                    <div key={t.id} className="flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors">
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-slate-800 text-[14px]">{t.name}</div>
                        {t.description && (
                          <div className="text-[12px] text-slate-500 mt-0.5 truncate max-w-[400px]">{t.description}</div>
                        )}
                        <div className="text-[12px] text-slate-400 mt-0.5">{t.agentCount} agents</div>
                      </div>
                      <button
                        onClick={() => handlePreviewTemplate(t.id)}
                        className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 border-0 rounded-md text-[12px] font-medium cursor-pointer transition-colors ml-3"
                      >
                        Preview
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-4 flex justify-end">
                <button
                  onClick={() => setShowLibrary(false)}
                  className="px-5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 border-0 rounded-lg text-[14px] font-medium cursor-pointer transition-colors"
                >
                  Close
                </button>
              </div>
            </>
          )}
        </Modal>
      )}
    </div>
  );
}
