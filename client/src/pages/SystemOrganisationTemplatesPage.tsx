import { useEffect, useState, useRef } from 'react';
import api from '../lib/api';
import { User } from '../lib/auth';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';

interface SystemTemplate {
  id: string;
  name: string;
  description: string | null;
  sourceType: string;
  agentCount: number;
  isPublished: boolean;
  version: number;
  createdAt: string;
}

interface ImportSummary {
  template: { id: string; name: string; version: number };
  summary: {
    total: number;
    matchedSystemAgent: number;
    blueprint: number;
    blueprintsRequiringPrompt: number;
    slugsRenamed: Array<{ final: string; original: string }>;
    unresolvedParents: string[];
    depthWarning: number | null;
  };
}

interface TemplateSlot {
  id: string;
  blueprintSlug: string;
  blueprintName: string | null;
  blueprintDescription: string | null;
  blueprintRole: string | null;
  blueprintTitle: string | null;
  systemAgentId: string | null;
  parentSlotId: string | null;
  sortOrder: number;
  children?: TemplateSlot[];
}

const ROLE_CLS: Record<string, string> = {
  orchestrator: 'bg-purple-100 text-purple-800',
  specialist: 'bg-blue-100 text-blue-800',
  worker: 'bg-slate-100 text-slate-700',
};

function SlotTreeRow({ slot, depth }: { slot: TemplateSlot; depth: number }) {
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
              <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-100 text-green-700">
                System
              </span>
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

export default function SystemOrganisationTemplatesPage({ user: _user }: { user: User }) {
  const [templates, setTemplates] = useState<SystemTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [error, setError] = useState('');

  // Import flow
  const [showImport, setShowImport] = useState(false);
  const [importName, setImportName] = useState('');
  const [importManifest, setImportManifest] = useState<Record<string, unknown> | null>(null);
  const [importFileName, setImportFileName] = useState('');
  const [importPreview, setImportPreview] = useState<ImportSummary | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const [agentCount, setAgentCount] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Preview
  const [previewTemplate, setPreviewTemplate] = useState<{ name: string; tree: TemplateSlot[] } | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/api/system/company-templates');
      setTemplates(data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleTogglePublish = async (id: string, isPublished: boolean) => {
    try {
      await api.patch(`/api/system/company-templates/${id}`, { isPublished: !isPublished });
      load();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error ?? 'Failed to update');
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteId) return;
    try {
      await api.delete(`/api/system/company-templates/${deleteId}`);
      setDeleteId(null);
      load();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error ?? 'Failed to delete');
      setDeleteId(null);
    }
  };

  const handlePreview = async (id: string, name: string) => {
    try {
      const { data } = await api.get(`/api/system/company-templates/${id}`);
      setPreviewTemplate({ name, tree: data.tree });
    } catch {
      setError('Failed to load template preview');
    }
  };

  // Import flow handlers
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setImportFileName(file.name);
    setImportError('');
    setImportPreview(null);

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const manifest = JSON.parse(reader.result as string);
        setImportManifest(manifest);
        const company = manifest.company as Record<string, unknown> | undefined;
        const companyName = company?.name as string | undefined;
        setImportName(companyName || file.name.replace(/\.\w+$/, ''));
        const agents = (company?.agents ?? manifest.agents ?? []) as unknown[];
        setAgentCount(agents.length);
      } catch {
        setImportError('Invalid JSON file. Please upload a valid Paperclip manifest.');
        setImportManifest(null);
      }
    };
    reader.readAsText(file);
  };

  const handleImportConfirm = async () => {
    if (!importManifest || !importName.trim()) return;
    setImporting(true);
    setImportError('');
    try {
      const { data } = await api.post('/api/system/company-templates/import', {
        name: importName,
        manifest: importManifest,
      });
      setImportPreview(data);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setImportError(e.response?.data?.error ?? 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  const handleImportDone = () => {
    setShowImport(false);
    setImportManifest(null);
    setImportPreview(null);
    setImportName('');
    setImportFileName('');
    setImportError('');
    load();
  };

  if (loading) {
    return <div className="py-12 text-center text-slate-500 text-[14px]">Loading company templates...</div>;
  }

  return (
    <div>
      <div className="flex justify-between items-start mb-6">
        <div>
          <p className="text-[14px] text-slate-500 m-0">
            Import company templates from Paperclip. Published templates are available to all organisations.
          </p>
        </div>
        <button
          onClick={() => setShowImport(true)}
          className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white border-0 rounded-lg text-[14px] font-medium cursor-pointer transition-colors whitespace-nowrap"
        >
          + Import from Paperclip
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
          message="Are you sure you want to delete this company template? Organisations will no longer be able to load it."
          confirmLabel="Delete"
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeleteId(null)}
        />
      )}

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {templates.length === 0 ? (
          <div className="py-16 px-12 flex flex-col items-center text-center">
            <div className="text-4xl mb-4">🏢</div>
            <div className="text-[16px] font-semibold text-slate-800 mb-2">No company templates yet</div>
            <div className="text-sm text-slate-500 mb-6">Import a Paperclip manifest to add company templates to the shared library.</div>
            <button
              onClick={() => setShowImport(true)}
              className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white border-0 rounded-lg text-[14px] font-medium cursor-pointer transition-colors"
            >
              + Import from Paperclip
            </button>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-4 py-3 text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider">Name</th>
                <th className="px-4 py-3 text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider">Published</th>
                <th className="px-4 py-3 text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider">Created</th>
                <th className="px-4 py-3 text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {templates.map((t) => (
                <tr key={t.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-semibold text-slate-800">{t.name}</div>
                    {t.description && (
                      <div className="text-xs text-slate-500 mt-0.5 max-w-[280px] truncate">{t.description}</div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-block px-2.5 py-0.5 rounded-full text-[11px] font-medium ${t.isPublished ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-600'}`}>
                      {t.isPublished ? 'Published' : 'Draft'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[13px] text-slate-500">
                    {new Date(t.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2 items-center flex-wrap">
                      <button
                        onClick={() => handlePreview(t.id, t.name)}
                        className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 border-0 rounded-md text-xs font-medium cursor-pointer transition-colors"
                      >
                        Preview
                      </button>
                      <button
                        onClick={() => handleTogglePublish(t.id, t.isPublished)}
                        className={`px-2.5 py-1 border-0 rounded-md text-xs font-medium cursor-pointer transition-colors ${
                          t.isPublished
                            ? 'bg-orange-50 hover:bg-orange-100 text-orange-800'
                            : 'bg-green-100 hover:bg-green-200 text-green-800'
                        }`}
                      >
                        {t.isPublished ? 'Unpublish' : 'Publish'}
                      </button>
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

      {/* Import from Paperclip modal */}
      {showImport && (
        <Modal title="Import from Paperclip" onClose={handleImportDone} maxWidth={640}>
          {!importPreview ? (
            <>
              <div className="mb-5">
                <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Paperclip manifest file</label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json"
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="px-4 py-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-lg text-[13px] font-medium cursor-pointer transition-colors"
                  >
                    Choose file
                  </button>
                  <span className="text-[13px] text-slate-500">
                    {importFileName || 'No file selected'}
                  </span>
                </div>
                {agentCount > 100 && (
                  <div className="mt-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-[13px] text-amber-700">
                    This manifest contains {agentCount} agents. Large imports may take longer to process.
                  </div>
                )}
              </div>
              {importManifest && (
                <div className="mb-5">
                  <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Template name</label>
                  <input
                    value={importName}
                    onChange={(e) => setImportName(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px]"
                    placeholder="Company name"
                  />
                </div>
              )}
              {importError && (
                <div className="mb-4 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-[13px] text-red-700">{importError}</div>
              )}
              <div className="flex gap-3">
                <button
                  onClick={handleImportConfirm}
                  disabled={importing || !importManifest || !importName.trim()}
                  className={`px-5 py-2 text-white border-0 rounded-lg text-[14px] font-medium transition-colors ${importing || !importManifest || !importName.trim() ? 'bg-slate-400 cursor-default' : 'bg-indigo-600 hover:bg-indigo-700 cursor-pointer'}`}
                >
                  {importing ? 'Importing...' : 'Import'}
                </button>
                <button onClick={handleImportDone} className="px-5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 border-0 rounded-lg text-[14px] font-medium cursor-pointer transition-colors">
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
                    Template "{importPreview.template.name}" imported
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div className="bg-slate-50 rounded-lg px-3 py-2.5">
                    <div className="text-[12px] text-slate-500">Total agents</div>
                    <div className="text-[18px] font-bold text-slate-800">{importPreview.summary.total}</div>
                  </div>
                  <div className="bg-slate-50 rounded-lg px-3 py-2.5">
                    <div className="text-[12px] text-slate-500">Matched system agents</div>
                    <div className="text-[18px] font-bold text-slate-800">{importPreview.summary.matchedSystemAgent}</div>
                  </div>
                  <div className="bg-slate-50 rounded-lg px-3 py-2.5">
                    <div className="text-[12px] text-slate-500">New blueprints</div>
                    <div className="text-[18px] font-bold text-slate-800">{importPreview.summary.blueprint}</div>
                  </div>
                  <div className="bg-slate-50 rounded-lg px-3 py-2.5">
                    <div className="text-[12px] text-slate-500">Require prompt</div>
                    <div className="text-[18px] font-bold text-slate-800">{importPreview.summary.blueprintsRequiringPrompt}</div>
                  </div>
                </div>
                {importPreview.summary.slugsRenamed.length > 0 && (
                  <div className="mb-3">
                    <div className="text-[12px] font-semibold text-slate-600 mb-1">Renamed slugs:</div>
                    {importPreview.summary.slugsRenamed.map((s, i) => (
                      <div key={i} className="text-[12px] text-slate-500">
                        <code className="bg-slate-100 px-1 rounded">{s.original}</code> → <code className="bg-slate-100 px-1 rounded">{s.final}</code>
                      </div>
                    ))}
                  </div>
                )}
                {importPreview.summary.unresolvedParents.length > 0 && (
                  <div className="px-3 py-2 bg-orange-50 border border-orange-200 rounded-lg text-[13px] text-orange-700 mb-3">
                    Unresolved parent references: {importPreview.summary.unresolvedParents.join(', ')}. These agents will be root nodes.
                  </div>
                )}
                {importPreview.summary.depthWarning && (
                  <div className="px-3 py-2 bg-orange-50 border border-orange-200 rounded-lg text-[13px] text-orange-700 mb-3">
                    Maximum hierarchy depth: {importPreview.summary.depthWarning} levels (advisory warning at 7+)
                  </div>
                )}
              </div>
              <button
                onClick={handleImportDone}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white border-0 rounded-lg text-[14px] font-medium cursor-pointer transition-colors"
              >
                Done
              </button>
            </>
          )}
        </Modal>
      )}

      {/* Template preview modal */}
      {previewTemplate && (
        <Modal title={`Preview: ${previewTemplate.name}`} onClose={() => setPreviewTemplate(null)} maxWidth={700}>
          {previewTemplate.tree.length === 0 ? (
            <div className="py-8 text-center text-slate-500 text-[14px]">No agents in this template.</div>
          ) : (
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="px-4 py-2 text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider">Agent</th>
                    <th className="px-4 py-2 text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider">Role</th>
                    <th className="px-4 py-2 text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider">Title</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {previewTemplate.tree.map((slot) => (
                    <SlotTreeRow key={slot.id} slot={slot} depth={0} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="mt-4 flex justify-end">
            <button
              onClick={() => setPreviewTemplate(null)}
              className="px-5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 border-0 rounded-lg text-[14px] font-medium cursor-pointer transition-colors"
            >
              Close
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
