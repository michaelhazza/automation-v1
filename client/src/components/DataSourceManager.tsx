import { useState, useEffect, useCallback } from 'react';
import api from '../lib/api';

// ---------------------------------------------------------------------------
// DataSourceManager — reusable data source CRUD panel (spec §11.1)
//
// Supports two scopes:
//   - agent           → /api/agents/:agentId/data-sources...
//   - scheduled_task  → /api/subaccounts/:subaccountId/scheduled-tasks/:stId/data-sources...
//
// Renders a list of existing sources with upload / create / edit / test /
// delete controls, plus an inline form for adding or editing a source.
// Caller passes the scope descriptor and canEdit flag; the component
// handles all its own state and HTTP.
//
// NOTE: this component is NEW. The existing AdminAgentEditPage still uses
// its inline data source UI (a larger, more feature-rich version). A
// follow-up ticket will extract that UI into this component to remove the
// duplication — see spec §11.1 and the "UI refactor" deferred item.
// ---------------------------------------------------------------------------

export interface DataSource {
  id: string;
  name: string;
  description: string | null;
  sourceType: 'r2' | 's3' | 'http_url' | 'google_docs' | 'dropbox' | 'file_upload';
  sourcePath: string;
  contentType: 'auto' | 'json' | 'csv' | 'markdown' | 'text';
  syncMode: 'lazy' | 'proactive';
  loadingMode: 'eager' | 'lazy';
  priority: number;
  maxTokenBudget: number;
  cacheMinutes: number;
  lastFetchStatus: 'ok' | 'error' | 'pending' | null;
}

export type DataSourceScope =
  | { type: 'agent'; agentId: string }
  | { type: 'scheduled_task'; subaccountId: string; scheduledTaskId: string };

interface Props {
  scope: DataSourceScope;
  canEdit: boolean;
}

interface FormState {
  name: string;
  description: string;
  sourceType: DataSource['sourceType'];
  sourcePath: string;
  contentType: DataSource['contentType'];
  priority: number;
  maxTokenBudget: number;
  cacheMinutes: number;
  loadingMode: 'eager' | 'lazy';
}

const EMPTY_FORM: FormState = {
  name: '',
  description: '',
  sourceType: 'http_url',
  sourcePath: '',
  contentType: 'auto',
  priority: 0,
  maxTokenBudget: 8000,
  cacheMinutes: 60,
  loadingMode: 'eager',
};

const SOURCE_TYPE_OPTIONS: Array<{ value: DataSource['sourceType']; label: string }> = [
  { value: 'http_url', label: 'HTTP URL' },
  { value: 'google_docs', label: 'Google Docs' },
  { value: 'dropbox', label: 'Dropbox' },
  { value: 'r2', label: 'Cloudflare R2' },
  { value: 's3', label: 'AWS S3' },
  { value: 'file_upload', label: 'File Upload (static)' },
];

const CONTENT_TYPE_OPTIONS: Array<DataSource['contentType']> = ['auto', 'json', 'csv', 'markdown', 'text'];

const inputCls =
  'w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500';

function baseUrlFor(scope: DataSourceScope): string {
  if (scope.type === 'agent') {
    return `/api/agents/${scope.agentId}/data-sources`;
  }
  return `/api/subaccounts/${scope.subaccountId}/scheduled-tasks/${scope.scheduledTaskId}/data-sources`;
}

export default function DataSourceManager({ scope, canEdit }: Props) {
  const [sources, setSources] = useState<DataSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; tokenCount?: number; preview?: string; error?: string }>>({});
  const [testingId, setTestingId] = useState<string | null>(null);

  const baseUrl = baseUrlFor(scope);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const res = await api.get(baseUrl);
      setSources(res.data ?? []);
    } catch {
      setError('Failed to load data sources');
    } finally {
      setLoading(false);
    }
  }, [baseUrl]);

  useEffect(() => {
    load();
  }, [load]);

  function openAdd() {
    setForm(EMPTY_FORM);
    setPendingFile(null);
    setEditingId(null);
    setShowForm(true);
  }

  function openEdit(ds: DataSource) {
    setForm({
      name: ds.name,
      description: ds.description ?? '',
      sourceType: ds.sourceType,
      sourcePath: ds.sourcePath,
      contentType: ds.contentType,
      priority: ds.priority,
      maxTokenBudget: ds.maxTokenBudget,
      cacheMinutes: ds.cacheMinutes,
      loadingMode: ds.loadingMode,
    });
    setPendingFile(null);
    setEditingId(ds.id);
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
    setPendingFile(null);
  }

  async function handleSave() {
    try {
      setError('');
      if (!form.name.trim()) {
        setError('Name is required');
        return;
      }

      if (editingId) {
        // Update existing
        await api.patch(`${baseUrl}/${editingId}`, {
          name: form.name,
          description: form.description || null,
          sourcePath: form.sourcePath,
          contentType: form.contentType,
          priority: form.priority,
          maxTokenBudget: form.maxTokenBudget,
          cacheMinutes: form.cacheMinutes,
          loadingMode: form.loadingMode,
        });
      } else if (form.sourceType === 'file_upload') {
        // Atomic upload + create in one request — the server-side service
        // method handles best-effort cleanup if the DB insert fails after
        // the S3 upload succeeds. (pr-reviewer Major 4.)
        if (!pendingFile) {
          setError('Select a file to upload');
          return;
        }
        const fd = new FormData();
        fd.append('file', pendingFile);
        fd.append('name', form.name);
        if (form.description) fd.append('description', form.description);
        fd.append('contentType', form.contentType);
        fd.append('loadingMode', form.loadingMode);
        fd.append('priority', String(form.priority));
        fd.append('maxTokenBudget', String(form.maxTokenBudget));
        await api.post(`${baseUrl}/upload`, fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
      } else {
        // New URL-based source
        if (!form.sourcePath.trim()) {
          setError('Source path / URL is required');
          return;
        }
        await api.post(baseUrl, {
          name: form.name,
          description: form.description || undefined,
          sourceType: form.sourceType,
          sourcePath: form.sourcePath,
          contentType: form.contentType,
          priority: form.priority,
          maxTokenBudget: form.maxTokenBudget,
          cacheMinutes: form.cacheMinutes,
          loadingMode: form.loadingMode,
        });
      }
      closeForm();
      await load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Save failed';
      setError(msg);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this data source? This cannot be undone.')) return;
    try {
      await api.delete(`${baseUrl}/${id}`);
      await load();
    } catch {
      setError('Failed to delete data source');
    }
  }

  async function handleTest(id: string) {
    try {
      setTestingId(id);
      const res = await api.post(`${baseUrl}/${id}/test`);
      setTestResults((prev) => ({ ...prev, [id]: res.data }));
    } catch {
      setTestResults((prev) => ({ ...prev, [id]: { ok: false, error: 'Test request failed' } }));
    } finally {
      setTestingId(null);
    }
  }

  if (loading) {
    return (
      <div className="bg-slate-50 border border-slate-200 rounded-lg p-6 text-[13px] text-slate-400">
        Loading data sources...
      </div>
    );
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-200 flex justify-between items-center">
        <div>
          <span className="text-[13px] font-semibold text-slate-700">
            {sources.length} source{sources.length === 1 ? '' : 's'}
          </span>
        </div>
        {canEdit && !showForm && (
          <button
            onClick={openAdd}
            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-[12px] font-semibold"
          >
            + Add Source
          </button>
        )}
      </div>

      {error && (
        <div className="px-4 py-2 bg-red-50 border-b border-red-200 text-red-700 text-[13px]">
          {error}
        </div>
      )}

      {showForm && (
        <div className="px-4 py-4 bg-slate-50 border-b border-slate-200">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-[12px] font-semibold text-slate-600 mb-1">Name *</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className={inputCls}
                placeholder="e.g. 42 Macro Glossary"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-[12px] font-semibold text-slate-600 mb-1">Description</label>
              <input
                type="text"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                className={inputCls}
                placeholder="Short hint shown alongside the source"
              />
            </div>
            <div>
              <label className="block text-[12px] font-semibold text-slate-600 mb-1">Source Type</label>
              <select
                value={form.sourceType}
                onChange={(e) =>
                  setForm({
                    ...form,
                    sourceType: e.target.value as DataSource['sourceType'],
                  })
                }
                className={inputCls}
                disabled={editingId !== null}
              >
                {SOURCE_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[12px] font-semibold text-slate-600 mb-1">Content Type</label>
              <select
                value={form.contentType}
                onChange={(e) =>
                  setForm({
                    ...form,
                    contentType: e.target.value as DataSource['contentType'],
                  })
                }
                className={inputCls}
              >
                {CONTENT_TYPE_OPTIONS.map((ct) => (
                  <option key={ct} value={ct}>
                    {ct}
                  </option>
                ))}
              </select>
            </div>
            {form.sourceType === 'file_upload' && !editingId ? (
              <div className="col-span-2">
                <label className="block text-[12px] font-semibold text-slate-600 mb-1">File *</label>
                <input
                  type="file"
                  onChange={(e) => setPendingFile(e.target.files?.[0] ?? null)}
                  className="text-[13px]"
                />
                {pendingFile && (
                  <div className="text-[12px] text-slate-500 mt-1">{pendingFile.name}</div>
                )}
              </div>
            ) : (
              <div className="col-span-2">
                <label className="block text-[12px] font-semibold text-slate-600 mb-1">
                  {form.sourceType === 'file_upload' ? 'Storage Key' : 'Source URL / Path *'}
                </label>
                <input
                  type="text"
                  value={form.sourcePath}
                  onChange={(e) => setForm({ ...form, sourcePath: e.target.value })}
                  className={inputCls}
                  placeholder="https://... or bucket/key"
                />
              </div>
            )}
            <div>
              <label className="block text-[12px] font-semibold text-slate-600 mb-1">Loading Mode</label>
              <select
                value={form.loadingMode}
                onChange={(e) =>
                  setForm({ ...form, loadingMode: e.target.value as 'eager' | 'lazy' })
                }
                className={inputCls}
              >
                <option value="eager">Eager (always loaded into prompt)</option>
                <option value="lazy">Lazy (on-demand via read skill)</option>
              </select>
              <div className="text-[11px] text-slate-500 mt-1">
                Eager sources are injected into every run. Lazy sources appear in
                the manifest and load only when the agent requests them.
              </div>
            </div>
            <div>
              <label className="block text-[12px] font-semibold text-slate-600 mb-1">Priority</label>
              <input
                type="number"
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })}
                className={inputCls}
              />
            </div>
            <div>
              <label className="block text-[12px] font-semibold text-slate-600 mb-1">
                Max Tokens
              </label>
              <input
                type="number"
                value={form.maxTokenBudget}
                onChange={(e) =>
                  setForm({ ...form, maxTokenBudget: Number(e.target.value) })
                }
                className={inputCls}
              />
            </div>
            <div>
              <label className="block text-[12px] font-semibold text-slate-600 mb-1">
                Cache (min)
              </label>
              <input
                type="number"
                value={form.cacheMinutes}
                onChange={(e) =>
                  setForm({ ...form, cacheMinutes: Number(e.target.value) })
                }
                className={inputCls}
              />
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <button
              onClick={handleSave}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-[13px] font-semibold"
            >
              {editingId ? 'Save Changes' : 'Add Source'}
            </button>
            <button
              onClick={closeForm}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 rounded text-[13px]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {sources.length === 0 && !showForm ? (
        <div className="px-4 py-8 text-center text-[13px] text-slate-400">
          No data sources attached yet.
          {canEdit && (
            <button
              onClick={openAdd}
              className="ml-2 text-indigo-600 hover:underline cursor-pointer"
            >
              Add one
            </button>
          )}
        </div>
      ) : (
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="text-left px-3 py-2 text-[11px] font-semibold text-slate-500 uppercase">Name</th>
              <th className="text-left px-3 py-2 text-[11px] font-semibold text-slate-500 uppercase">Type</th>
              <th className="text-left px-3 py-2 text-[11px] font-semibold text-slate-500 uppercase">Mode</th>
              <th className="text-left px-3 py-2 text-[11px] font-semibold text-slate-500 uppercase">Status</th>
              {canEdit && (
                <th className="text-left px-3 py-2 text-[11px] font-semibold text-slate-500 uppercase">
                  Actions
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sources.map((ds) => (
              <tr key={ds.id} className="hover:bg-slate-50">
                <td className="px-3 py-2">
                  <div className="font-medium text-slate-800">{ds.name}</div>
                  {ds.description && (
                    <div className="text-[11px] text-slate-400 mt-0.5">{ds.description}</div>
                  )}
                </td>
                <td className="px-3 py-2 text-[12px] text-slate-600">{ds.sourceType}</td>
                <td className="px-3 py-2">
                  <span
                    className={`text-[11px] px-2 py-0.5 rounded font-semibold ${
                      ds.loadingMode === 'eager'
                        ? 'bg-indigo-100 text-indigo-700'
                        : 'bg-amber-100 text-amber-700'
                    }`}
                  >
                    {ds.loadingMode}
                  </span>
                </td>
                <td className="px-3 py-2">
                  {ds.lastFetchStatus === 'ok' && (
                    <span className="text-green-700 text-[11px]">ok</span>
                  )}
                  {ds.lastFetchStatus === 'error' && (
                    <span className="text-red-600 text-[11px]">error</span>
                  )}
                  {ds.lastFetchStatus === 'pending' && (
                    <span className="text-slate-500 text-[11px]">pending</span>
                  )}
                  {!ds.lastFetchStatus && <span className="text-slate-400 text-[11px]">—</span>}
                  {testResults[ds.id] && (
                    <div className="mt-0.5 text-[11px]">
                      {testResults[ds.id].ok ? (
                        <span className="text-green-700">
                          {testResults[ds.id].tokenCount ?? 0} tokens
                        </span>
                      ) : (
                        <span className="text-red-600">{testResults[ds.id].error}</span>
                      )}
                    </div>
                  )}
                </td>
                {canEdit && (
                  <td className="px-3 py-2">
                    <div className="flex gap-1">
                      <button
                        onClick={() => openEdit(ds)}
                        className="px-2 py-1 bg-slate-100 hover:bg-slate-200 rounded text-[11px]"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleTest(ds.id)}
                        disabled={testingId === ds.id}
                        className="px-2 py-1 bg-sky-50 hover:bg-sky-100 text-sky-700 rounded text-[11px] disabled:opacity-50"
                      >
                        {testingId === ds.id ? '...' : 'Test'}
                      </button>
                      <button
                        onClick={() => handleDelete(ds.id)}
                        className="px-2 py-1 bg-red-50 hover:bg-red-100 text-red-600 rounded text-[11px]"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
