import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
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

interface ImportSummary {
  template: { id: string; name: string; version: number };
  summary: {
    total: number;
    matchedSystemAgent: number;
    matchedOrgAgent: number;
    blueprint: number;
    blueprintsRequiringPrompt: number;
    slugsRenamed: Array<{ final: string; original: string }>;
    updateConflicts: Array<{ agentName: string; field: string; reason: string }>;
    unresolvedParents: string[];
    depthWarning: number | null;
  };
}

const SOURCE_BADGE: Record<string, { cls: string; label: string }> = {
  manual: { cls: 'bg-slate-100 text-slate-600', label: 'Manual' },
  paperclip_import: { cls: 'bg-blue-100 text-blue-700', label: 'Paperclip' },
  from_system: { cls: 'bg-violet-100 text-violet-700', label: 'System' },
};

export default function AdminAgentTemplatesPage({ user: _user }: { user: User }) {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [error, setError] = useState('');

  // Create modal
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createDesc, setCreateDesc] = useState('');
  const [creating, setCreating] = useState(false);

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
        // Pre-fill name from manifest
        const company = manifest.company as Record<string, unknown> | undefined;
        const companyName = company?.name as string | undefined;
        setImportName(companyName || file.name.replace(/\.\w+$/, ''));
        // Count agents
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
      const { data } = await api.post('/api/hierarchy-templates/import', {
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
    return <div className="py-12 text-center text-slate-500 text-[14px]">Loading templates...</div>;
  }

  return (
    <div className="animate-[fadeIn_0.2s_ease-out_both]">
      <div className="flex justify-between items-start mb-6">
        <div>
          <h1 className="text-[28px] font-bold text-slate-800 m-0">Agent Templates</h1>
          <p className="text-sm text-slate-500 mt-1.5">Reusable agent organisation blueprints for subaccounts</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowImport(true)}
            className="px-4 py-2.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-lg text-[14px] font-medium cursor-pointer transition-colors"
          >
            Import from Paperclip
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white border-0 rounded-lg text-[14px] font-medium cursor-pointer transition-colors"
          >
            + New Template
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 px-4 py-2.5 rounded-lg text-[14px] bg-red-50 text-red-700 border border-red-200 flex justify-between items-center">
          <span>{error}</span>
          <button onClick={() => setError('')} className="bg-transparent border-0 cursor-pointer text-inherit text-[16px] px-1">×</button>
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
            <div className="text-sm text-slate-500 mb-6">Create a template manually or import from a Paperclip manifest.</div>
            <div className="flex gap-2">
              <button
                onClick={() => setShowImport(true)}
                className="px-4 py-2.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-lg text-[14px] font-medium cursor-pointer transition-colors"
              >
                Import from Paperclip
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
                <th className="px-4 py-3 text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider">Source</th>
                <th className="px-4 py-3 text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider">Agents</th>
                <th className="px-4 py-3 text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider">Version</th>
                <th className="px-4 py-3 text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider">Created</th>
                <th className="px-4 py-3 text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {templates.map((t) => {
                const badge = SOURCE_BADGE[t.sourceType] ?? SOURCE_BADGE.manual;
                return (
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
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2.5 py-0.5 rounded-full text-[11px] font-medium ${badge.cls}`}>
                        {badge.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[13px] text-slate-600">{t.slotCount}</td>
                    <td className="px-4 py-3 text-[13px] text-slate-600">v{t.version}</td>
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
                );
              })}
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

      {/* Paperclip import modal */}
      {showImport && (
        <Modal title="Import from Paperclip" onClose={handleImportDone} maxWidth={640}>
          {!importPreview ? (
            <>
              {/* Upload step */}
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
                    placeholder="Template name"
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
              {/* Preview/result step */}
              <div className="mb-4">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-[16px]">✅</span>
                  <span className="font-semibold text-slate-800 text-[15px]">
                    Template "{importPreview.template.name}" created
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div className="bg-slate-50 rounded-lg px-3 py-2.5">
                    <div className="text-[12px] text-slate-500">Total agents</div>
                    <div className="text-[18px] font-bold text-slate-800">{importPreview.summary.total}</div>
                  </div>
                  <div className="bg-slate-50 rounded-lg px-3 py-2.5">
                    <div className="text-[12px] text-slate-500">Matched (system)</div>
                    <div className="text-[18px] font-bold text-slate-800">{importPreview.summary.matchedSystemAgent}</div>
                  </div>
                  <div className="bg-slate-50 rounded-lg px-3 py-2.5">
                    <div className="text-[12px] text-slate-500">Matched (org)</div>
                    <div className="text-[18px] font-bold text-slate-800">{importPreview.summary.matchedOrgAgent}</div>
                  </div>
                  <div className="bg-slate-50 rounded-lg px-3 py-2.5">
                    <div className="text-[12px] text-slate-500">New blueprints</div>
                    <div className="text-[18px] font-bold text-slate-800">{importPreview.summary.blueprint}</div>
                  </div>
                </div>
                {importPreview.summary.blueprintsRequiringPrompt > 0 && (
                  <div className="px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-[13px] text-amber-700 mb-3">
                    {importPreview.summary.blueprintsRequiringPrompt} agent(s) have no prompt — they will be created in <strong>draft</strong> status when applied. Prompts must be added before activation.
                  </div>
                )}
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
                {importPreview.summary.updateConflicts.length > 0 && (
                  <div className="mb-3">
                    <div className="text-[12px] font-semibold text-slate-600 mb-1">Update conflicts (non-blocking):</div>
                    {importPreview.summary.updateConflicts.map((c, i) => (
                      <div key={i} className="text-[12px] text-slate-500">
                        {c.agentName}: {c.field} — {c.reason}
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
              <div className="flex gap-3">
                <button
                  onClick={handleImportDone}
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white border-0 rounded-lg text-[14px] font-medium cursor-pointer transition-colors"
                >
                  Done
                </button>
              </div>
            </>
          )}
        </Modal>
      )}
    </div>
  );
}
