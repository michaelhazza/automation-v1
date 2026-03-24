import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import api from '../lib/api';
import { User } from '../lib/auth';
import ConfirmDialog from '../components/ConfirmDialog';

// ─── Interfaces ─────────────────────────────────────────────────────────────

interface AvailableSkill {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  skillType: 'built_in' | 'custom';
  methodology: string | null;
}

interface AgentForm {
  name: string;
  description: string;
  masterPrompt: string;
  modelProvider: string;
  modelId: string;
  temperature: number;
  maxTokens: number;
  defaultSkillSlugs: string[];
}

interface Agent extends AgentForm {
  id: string;
  status: string;
  createdAt: string;
  dataSources?: DataSource[];
}

interface DataSource {
  id: string;
  name: string;
  description: string | null;
  sourceType: string;
  sourcePath: string;
  contentType: string;
  syncMode: string;
  priority: number;
  maxTokenBudget: number;
  cacheMinutes: number;
  lastFetchStatus: string | null;
}

interface DataSourceForm {
  name: string;
  description: string;
  sourceType: string;
  sourcePath: string;
  contentType: string;
  syncMode: 'lazy' | 'proactive';
  priority: number;
  maxTokenBudget: number;
  cacheMinutes: number;
  googleApiKey: string; // stored as sourceHeaders['x-google-api-key'] on submit
}

// Pending data source for new-agent creation flow (not yet saved to backend)
interface PendingDataSource {
  tempId: string;
  form: DataSourceForm;
  pendingFile: File | null;
  fileName: string | null; // display name for file_upload
}

interface TestResult {
  tokenCount?: number;
  snippet?: string;
  error?: string;
  success?: boolean;
  message?: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const MODEL_OPTIONS = [
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { value: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
  { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
];

const SOURCE_TYPE_OPTIONS = [
  { value: 'r2', label: 'Cloudflare R2' },
  { value: 's3', label: 'AWS S3' },
  { value: 'http_url', label: 'HTTP URL' },
  { value: 'google_docs', label: 'Google Docs' },
  { value: 'dropbox', label: 'Dropbox' },
  { value: 'file_upload', label: 'File Upload (static)' },
];

const CONTENT_TYPE_OPTIONS = ['auto', 'json', 'csv', 'markdown', 'text'];

const STATUS_BADGE: Record<string, { bg: string; color: string }> = {
  active:   { bg: '#dcfce7', color: '#166534' },
  inactive: { bg: '#fff7ed', color: '#9a3412' },
  draft:    { bg: '#f1f5f9', color: '#475569' },
};

const SOURCE_TYPE_BADGE: Record<string, { bg: string; color: string }> = {
  r2:          { bg: '#eff6ff', color: '#1d4ed8' },
  s3:          { bg: '#f0fdf4', color: '#15803d' },
  http_url:    { bg: '#faf5ff', color: '#7e22ce' },
  google_docs: { bg: '#fef9c3', color: '#854d0e' },
  dropbox:     { bg: '#e0f2fe', color: '#0369a1' },
  file_upload: { bg: '#fdf2f8', color: '#9d174d' },
};

// Source types that support live sync (everything except file_upload)
const LIVE_SOURCE_TYPES = new Set(['r2', 's3', 'http_url', 'google_docs', 'dropbox']);

const EMPTY_DS_FORM: DataSourceForm = {
  name: '',
  description: '',
  sourceType: 'r2',
  sourcePath: '',
  contentType: 'auto',
  syncMode: 'lazy',
  priority: 0,
  maxTokenBudget: 8000,
  cacheMinutes: 60,
  googleApiKey: '',
};

const EMPTY_AGENT_FORM: AgentForm = {
  name: '',
  description: '',
  masterPrompt: '',
  modelProvider: 'anthropic',
  modelId: 'claude-sonnet-4-6',
  temperature: 0.7,
  maxTokens: 2048,
  defaultSkillSlugs: [],
};

// ─── Helper components ───────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_BADGE[status] ?? STATUS_BADGE.draft;
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 10px',
      borderRadius: 999,
      fontSize: 12,
      fontWeight: 600,
      background: s.bg,
      color: s.color,
      textTransform: 'capitalize',
    }}>
      {status}
    </span>
  );
}

function SourceTypeBadge({ type }: { type: string }) {
  const s = SOURCE_TYPE_BADGE[type] ?? { bg: '#f1f5f9', color: '#475569' };
  const label = SOURCE_TYPE_OPTIONS.find((o) => o.value === type)?.label ?? type;
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: 999,
      fontSize: 11,
      fontWeight: 600,
      background: s.bg,
      color: s.color,
    }}>
      {label}
    </span>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', marginBottom: 20 }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9' }}>
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: '#1e293b' }}>{title}</h2>
      </div>
      <div style={{ padding: '20px' }}>
        {children}
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 6 }}>{label}</label>
      {children}
      {hint && <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  border: '1px solid #d1d5db',
  borderRadius: 8,
  fontSize: 13,
  boxSizing: 'border-box',
  color: '#1e293b',
  background: '#fff',
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
};

// ─── Main component ──────────────────────────────────────────────────────────

export default function AdminAgentEditPage({ user }: { user: User }) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isNew = id === 'new';

  // Agent state
  const [agent, setAgent] = useState<Agent | null>(null);
  const [form, setForm] = useState<AgentForm>(EMPTY_AGENT_FORM);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState('');
  const [saveError, setSaveError] = useState('');

  // Status toggle state
  const [statusLoading, setStatusLoading] = useState(false);

  // Data sources state (existing agent)
  const [dataSources, setDataSources] = useState<DataSource[]>([]);
  const [showDsForm, setShowDsForm] = useState(false);
  const [editingDsId, setEditingDsId] = useState<string | null>(null);
  const [dsForm, setDsForm] = useState<DataSourceForm>(EMPTY_DS_FORM);
  const [dsFormError, setDsFormError] = useState('');
  const [dsSaving, setDsSaving] = useState(false);
  const [deleteDsId, setDeleteDsId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({});
  const [testingId, setTestingId] = useState<string | null>(null);

  // File upload state for data source form
  const [dsFormFile, setDsFormFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Pending data sources for new-agent creation flow
  const [pendingNewSources, setPendingNewSources] = useState<PendingDataSource[]>([]);
  const [editingTempId, setEditingTempId] = useState<string | null>(null);

  // Skills state
  const [availableSkills, setAvailableSkills] = useState<AvailableSkill[]>([]);

  // ── Load ──

  const loadAgent = async (agentId: string) => {
    try {
      const { data } = await api.get(`/api/agents/${agentId}`);
      setAgent(data);
      setForm({
        name: data.name ?? '',
        description: data.description ?? '',
        masterPrompt: data.masterPrompt ?? '',
        modelProvider: data.modelProvider ?? 'anthropic',
        modelId: data.modelId ?? 'claude-sonnet-4-6',
        temperature: data.temperature ?? 0.7,
        maxTokens: data.maxTokens ?? 2048,
        defaultSkillSlugs: data.defaultSkillSlugs ?? [],
      });
      setDataSources(data.dataSources ?? []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isNew && id) {
      loadAgent(id);
    }
    // Load available skills for the skills picker
    api.get('/api/skills').then(({ data }) => setAvailableSkills(data)).catch(() => {});
  }, [id, isNew]);

  // ── Save / Create ──

  const handleSave = async () => {
    setSaveError('');
    setSaveSuccess('');
    if (!form.name.trim()) {
      setSaveError('Name is required.');
      return;
    }
    setSaving(true);
    try {
      if (isNew) {
        // 1. Create the agent
        const { data } = await api.post('/api/agents', form);
        const agentId: string = data.id;

        // 2. Attach any pending data sources
        for (const pending of pendingNewSources) {
          let sourcePath = pending.form.sourcePath;

          // For file_upload: upload the file first
          if (pending.form.sourceType === 'file_upload' && pending.pendingFile) {
            const fd = new FormData();
            fd.append('file', pending.pendingFile);
            const { data: uploadData } = await api.post(
              `/api/agents/${agentId}/data-sources/upload`,
              fd,
              { headers: { 'Content-Type': 'multipart/form-data' } }
            );
            sourcePath = uploadData.storagePath;
          }

          const sourceHeaders = pending.form.googleApiKey
            ? { 'x-google-api-key': pending.form.googleApiKey }
            : undefined;

          await api.post(`/api/agents/${agentId}/data-sources`, {
            name: pending.form.name,
            description: pending.form.description || undefined,
            sourceType: pending.form.sourceType,
            sourcePath,
            sourceHeaders,
            contentType: pending.form.contentType,
            syncMode: pending.form.syncMode,
            priority: pending.form.priority,
            maxTokenBudget: pending.form.maxTokenBudget,
            cacheMinutes: pending.form.cacheMinutes,
          });
        }

        navigate(`/admin/agents/${agentId}`);
      } else {
        await api.patch(`/api/agents/${id}`, form);
        setSaveSuccess('Agent saved successfully.');
        if (id) loadAgent(id);
      }
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setSaveError(e.response?.data?.error ?? 'Failed to save agent.');
    } finally {
      setSaving(false);
    }
  };

  // ── Status toggles ──

  const handleActivate = async () => {
    if (!agent) return;
    setStatusLoading(true);
    try {
      await api.post(`/api/agents/${agent.id}/activate`);
      loadAgent(agent.id);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setSaveError(e.response?.data?.error ?? 'Failed to activate.');
    } finally {
      setStatusLoading(false);
    }
  };

  const handleDeactivate = async () => {
    if (!agent) return;
    setStatusLoading(true);
    try {
      await api.post(`/api/agents/${agent.id}/deactivate`);
      loadAgent(agent.id);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setSaveError(e.response?.data?.error ?? 'Failed to deactivate.');
    } finally {
      setStatusLoading(false);
    }
  };

  // ── Data source helpers ──

  const openAddDs = () => {
    setEditingDsId(null);
    setEditingTempId(null);
    setDsForm(EMPTY_DS_FORM);
    setDsFormFile(null);
    setDsFormError('');
    setShowDsForm(true);
  };

  const openEditDs = (ds: DataSource) => {
    setEditingDsId(ds.id);
    setEditingTempId(null);
    setDsForm({
      name: ds.name,
      description: ds.description ?? '',
      sourceType: ds.sourceType,
      sourcePath: ds.sourcePath,
      contentType: ds.contentType,
      syncMode: (ds.syncMode as 'lazy' | 'proactive') ?? 'lazy',
      priority: ds.priority,
      maxTokenBudget: ds.maxTokenBudget,
      cacheMinutes: ds.cacheMinutes,
      googleApiKey: '',
    });
    setDsFormFile(null);
    setDsFormError('');
    setShowDsForm(true);
  };

  const openEditPending = (pending: PendingDataSource) => {
    setEditingTempId(pending.tempId);
    setEditingDsId(null);
    setDsForm(pending.form);
    setDsFormFile(pending.pendingFile);
    setDsFormError('');
    setShowDsForm(true);
  };

  const cancelDsForm = () => {
    setShowDsForm(false);
    setEditingDsId(null);
    setEditingTempId(null);
    setDsForm(EMPTY_DS_FORM);
    setDsFormFile(null);
    setDsFormError('');
  };

  const handleSaveDs = async () => {
    if (!dsForm.name.trim()) {
      setDsFormError('Name is required.');
      return;
    }
    if (dsForm.sourceType === 'file_upload' && !dsFormFile && !editingDsId && !editingTempId) {
      setDsFormError('Please select a file to upload.');
      return;
    }
    if (dsForm.sourceType !== 'file_upload' && !dsForm.sourcePath.trim()) {
      setDsFormError('Source path / URL is required.');
      return;
    }

    // ── New agent: add to pending list ──
    if (isNew) {
      const tempId = editingTempId ?? crypto.randomUUID();
      const fileName = dsFormFile?.name ?? (editingTempId
        ? pendingNewSources.find((p) => p.tempId === editingTempId)?.fileName ?? null
        : null);
      const pendingEntry: PendingDataSource = {
        tempId,
        form: { ...dsForm },
        pendingFile: dsFormFile,
        fileName,
      };
      setPendingNewSources((prev) =>
        editingTempId
          ? prev.map((p) => (p.tempId === editingTempId ? pendingEntry : p))
          : [...prev, pendingEntry]
      );
      cancelDsForm();
      return;
    }

    // ── Existing agent: call API ──
    setDsSaving(true);
    setDsFormError('');
    try {
      let sourcePath = dsForm.sourcePath;

      // For file_upload with a new file: upload first
      if (dsForm.sourceType === 'file_upload' && dsFormFile) {
        const fd = new FormData();
        fd.append('file', dsFormFile);
        const { data: uploadData } = await api.post(
          `/api/agents/${id}/data-sources/upload`,
          fd,
          { headers: { 'Content-Type': 'multipart/form-data' } }
        );
        sourcePath = uploadData.storagePath;
      }

      const sourceHeaders = dsForm.googleApiKey
        ? { 'x-google-api-key': dsForm.googleApiKey }
        : undefined;

      const payload = {
        name: dsForm.name,
        description: dsForm.description || undefined,
        sourceType: dsForm.sourceType,
        sourcePath,
        sourceHeaders,
        contentType: dsForm.contentType,
        syncMode: dsForm.syncMode,
        priority: dsForm.priority,
        maxTokenBudget: dsForm.maxTokenBudget,
        cacheMinutes: dsForm.cacheMinutes,
      };

      if (editingDsId) {
        await api.patch(`/api/agents/${id}/data-sources/${editingDsId}`, payload);
      } else {
        await api.post(`/api/agents/${id}/data-sources`, payload);
      }
      cancelDsForm();
      if (id) loadAgent(id);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setDsFormError(e.response?.data?.error ?? 'Failed to save data source.');
    } finally {
      setDsSaving(false);
    }
  };

  const handleDeleteDs = async () => {
    if (!deleteDsId) return;
    try {
      await api.delete(`/api/agents/${id}/data-sources/${deleteDsId}`);
      setDeleteDsId(null);
      if (id) loadAgent(id);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setSaveError(e.response?.data?.error ?? 'Failed to delete data source.');
      setDeleteDsId(null);
    }
  };

  const handleTestDs = async (dsId: string) => {
    setTestingId(dsId);
    setTestResults((prev) => ({ ...prev, [dsId]: {} }));
    try {
      const { data } = await api.post(`/api/agents/${id}/data-sources/${dsId}/test`);
      setTestResults((prev) => ({ ...prev, [dsId]: data }));
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setTestResults((prev) => ({ ...prev, [dsId]: { error: e.response?.data?.error ?? 'Test failed' } }));
    } finally {
      setTestingId(null);
    }
  };

  const sourcePathHint = (type: string) => {
    if (type === 'http_url') return 'Full URL e.g. https://example.com/data.json';
    if (type === 'google_docs') return 'Google Docs URL e.g. https://docs.google.com/document/d/...';
    if (type === 'dropbox') return 'Dropbox public share URL e.g. https://www.dropbox.com/s/.../file.csv?dl=0';
    return 'S3/R2 object key e.g. data/report.json';
  };

  // ── Render ──

  if (loading) {
    return (
      <div style={{ padding: 48, textAlign: 'center', color: '#64748b', fontSize: 14 }}>
        Loading agent...
      </div>
    );
  }

  // Shared data source inline form
  const renderDsForm = () => (
    <div style={{ padding: '20px', borderBottom: '1px solid #e2e8f0', background: '#fafbff' }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: '#1e293b', marginBottom: 16 }}>
        {editingDsId || editingTempId ? 'Edit Data Source' : 'New Data Source'}
      </div>
      {dsFormError && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '8px 12px', marginBottom: 14, color: '#dc2626', fontSize: 13 }}>
          {dsFormError}
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div style={{ gridColumn: '1 / -1' }}>
          <Field label="Name *">
            <input
              value={dsForm.name}
              onChange={(e) => setDsForm({ ...dsForm, name: e.target.value })}
              style={inputStyle}
              placeholder="e.g. Product Catalog"
            />
          </Field>
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <Field label="Description">
            <input
              value={dsForm.description}
              onChange={(e) => setDsForm({ ...dsForm, description: e.target.value })}
              style={inputStyle}
              placeholder="Optional description"
            />
          </Field>
        </div>
        <Field label="Source Type">
          <select
            value={dsForm.sourceType}
            onChange={(e) => {
              setDsForm({ ...dsForm, sourceType: e.target.value, sourcePath: '' });
              setDsFormFile(null);
            }}
            style={selectStyle}
          >
            {SOURCE_TYPE_OPTIONS.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Content Type">
          <select
            value={dsForm.contentType}
            onChange={(e) => setDsForm({ ...dsForm, contentType: e.target.value })}
            style={selectStyle}
          >
            {CONTENT_TYPE_OPTIONS.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </Field>

        {/* Source path / file picker — conditional on type */}
        {dsForm.sourceType === 'file_upload' ? (
          <div style={{ gridColumn: '1 / -1' }}>
            <Field label="File *" hint="Upload a file (PDF, CSV, TXT, JSON, Markdown, DOCX, etc.)">
              <div
                style={{
                  border: '2px dashed #d1d5db',
                  borderRadius: 8,
                  padding: '16px',
                  textAlign: 'center',
                  cursor: 'pointer',
                  background: dsFormFile ? '#f0fdf4' : '#fafafa',
                  transition: 'background 0.15s',
                }}
                onClick={() => fileInputRef.current?.click()}
              >
                {dsFormFile ? (
                  <div style={{ fontSize: 13, color: '#16a34a', fontWeight: 500 }}>
                    {dsFormFile.name} ({(dsFormFile.size / 1024).toFixed(1)} KB)
                    <div style={{ fontSize: 12, color: '#64748b', marginTop: 4, fontWeight: 400 }}>Click to change file</div>
                  </div>
                ) : editingDsId && dataSources.find((ds) => ds.id === editingDsId)?.sourcePath ? (
                  <div style={{ fontSize: 13, color: '#64748b' }}>
                    <div style={{ fontWeight: 500, color: '#1e293b', marginBottom: 4 }}>
                      Current: {dataSources.find((ds) => ds.id === editingDsId)?.sourcePath.split('/').pop()}
                    </div>
                    Click to replace with a new file
                  </div>
                ) : (
                  <div style={{ fontSize: 13, color: '#64748b' }}>
                    <div style={{ fontSize: 20, marginBottom: 6 }}>📁</div>
                    Click to select a file
                  </div>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  style={{ display: 'none' }}
                  accept=".pdf,.csv,.txt,.json,.md,.markdown,.docx,.xlsx,.xml"
                  onChange={(e) => {
                    const file = e.target.files?.[0] ?? null;
                    setDsFormFile(file);
                  }}
                />
              </div>
            </Field>
          </div>
        ) : (
          <div style={{ gridColumn: '1 / -1' }}>
            <Field
              label={
                dsForm.sourceType === 'google_docs' ? 'Google Docs URL *'
                : dsForm.sourceType === 'dropbox' ? 'Dropbox Share URL *'
                : 'Source Path *'
              }
              hint={sourcePathHint(dsForm.sourceType)}
            >
              <input
                value={dsForm.sourcePath}
                onChange={(e) => setDsForm({ ...dsForm, sourcePath: e.target.value })}
                style={inputStyle}
                placeholder={
                  dsForm.sourceType === 'http_url' ? 'https://...'
                  : dsForm.sourceType === 'google_docs' ? 'https://docs.google.com/document/d/...'
                  : dsForm.sourceType === 'dropbox' ? 'https://www.dropbox.com/s/...?dl=0'
                  : 'data/file.json'
                }
              />
            </Field>
          </div>
        )}

        {/* Google Docs API key (optional) */}
        {dsForm.sourceType === 'google_docs' && (
          <div style={{ gridColumn: '1 / -1' }}>
            <Field
              label="Google Docs API Key (optional)"
              hint="Required for private documents. Leave empty for publicly published docs."
            >
              <input
                value={dsForm.googleApiKey}
                onChange={(e) => setDsForm({ ...dsForm, googleApiKey: e.target.value })}
                style={inputStyle}
                type="password"
                placeholder="AIza..."
              />
            </Field>
          </div>
        )}

        {/* Sync mode — only for live source types */}
        {LIVE_SOURCE_TYPES.has(dsForm.sourceType) && (
          <div style={{ gridColumn: '1 / -1' }}>
            <Field
              label="Sync Mode"
              hint={
                dsForm.syncMode === 'proactive'
                  ? 'Background job re-fetches this source on the refresh interval, keeping it always warm.'
                  : 'Source is re-fetched the first time the agent is used after the refresh interval expires.'
              }
            >
              <div style={{ display: 'flex', gap: 10 }}>
                {(['lazy', 'proactive'] as const).map((mode) => (
                  <label
                    key={mode}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '8px 14px',
                      border: `2px solid ${dsForm.syncMode === mode ? '#6366f1' : '#d1d5db'}`,
                      borderRadius: 8,
                      cursor: 'pointer',
                      background: dsForm.syncMode === mode ? '#eef2ff' : '#fff',
                      fontSize: 13,
                      fontWeight: dsForm.syncMode === mode ? 600 : 400,
                      color: dsForm.syncMode === mode ? '#4338ca' : '#374151',
                      transition: 'all 0.1s',
                    }}
                  >
                    <input
                      type="radio"
                      name="syncMode"
                      value={mode}
                      checked={dsForm.syncMode === mode}
                      onChange={() => setDsForm({ ...dsForm, syncMode: mode })}
                      style={{ display: 'none' }}
                    />
                    {mode === 'lazy' ? 'Lazy (on demand)' : 'Proactive (background sync)'}
                  </label>
                ))}
              </div>
            </Field>
          </div>
        )}

        {/* Refresh interval — hidden for file_upload */}
        {LIVE_SOURCE_TYPES.has(dsForm.sourceType) && (
          <Field
            label="Refresh Interval (minutes)"
            hint={dsForm.syncMode === 'proactive' ? 'How often the background job re-fetches this source' : 'How long to cache the fetched content before re-fetching'}
          >
            <input
              type="number"
              min={1}
              value={dsForm.cacheMinutes}
              onChange={(e) => setDsForm({ ...dsForm, cacheMinutes: parseInt(e.target.value) || 60 })}
              style={inputStyle}
            />
          </Field>
        )}

        <Field label="Priority" hint="0 = first, higher = later">
          <input
            type="number"
            value={dsForm.priority}
            onChange={(e) => setDsForm({ ...dsForm, priority: parseInt(e.target.value) || 0 })}
            style={inputStyle}
          />
        </Field>
        <Field label="Max Token Budget" hint="Max tokens this source contributes to context">
          <input
            type="number"
            value={dsForm.maxTokenBudget}
            onChange={(e) => setDsForm({ ...dsForm, maxTokenBudget: parseInt(e.target.value) || 1000 })}
            style={inputStyle}
          />
        </Field>
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
        <button
          onClick={handleSaveDs}
          disabled={dsSaving}
          style={{
            padding: '8px 20px',
            background: dsSaving ? '#a5b4fc' : '#6366f1',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 500,
            cursor: dsSaving ? 'not-allowed' : 'pointer',
          }}
        >
          {dsSaving ? 'Saving...' : editingDsId || editingTempId ? 'Update' : isNew ? 'Add to Agent' : 'Add Source'}
        </button>
        <button
          onClick={cancelDsForm}
          style={{ padding: '8px 20px', background: '#f1f5f9', color: '#374151', border: 'none', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}
        >
          Cancel
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Back link + header */}
      <div style={{ marginBottom: 16 }}>
        <Link to="/admin/agents" style={{ color: '#6366f1', fontSize: 13, textDecoration: 'none' }}>
          &larr; Back to agents
        </Link>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 700, color: '#1e293b', margin: 0 }}>
            {isNew ? 'New Agent' : `Edit Agent: ${agent?.name ?? ''}`}
          </h1>
          {!isNew && agent && (
            <p style={{ margin: '6px 0 0', color: '#64748b', fontSize: 13 }}>
              Created {new Date(agent.createdAt).toLocaleDateString()}
            </p>
          )}
        </div>
        {!isNew && agent && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <StatusBadge status={agent.status} />
            {agent.status !== 'active' && (
              <button
                onClick={handleActivate}
                disabled={statusLoading}
                style={{ padding: '6px 14px', background: '#dcfce7', color: '#166534', border: 'none', borderRadius: 6, fontSize: 13, cursor: statusLoading ? 'not-allowed' : 'pointer', fontWeight: 500 }}
              >
                Activate
              </button>
            )}
            {agent.status === 'active' && (
              <button
                onClick={handleDeactivate}
                disabled={statusLoading}
                style={{ padding: '6px 14px', background: '#fff7ed', color: '#9a3412', border: 'none', borderRadius: 6, fontSize: 13, cursor: statusLoading ? 'not-allowed' : 'pointer', fontWeight: 500 }}
              >
                Deactivate
              </button>
            )}
          </div>
        )}
      </div>

      {/* Global feedback */}
      {saveSuccess && (
        <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '10px 14px', marginBottom: 16, color: '#16a34a', fontSize: 13 }}>
          {saveSuccess}
        </div>
      )}
      {saveError && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', marginBottom: 16, color: '#dc2626', fontSize: 13 }}>
          {saveError}
        </div>
      )}

      {/* ── Section 1: Basic Info ── */}
      <SectionCard title="Basic Info">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div style={{ gridColumn: '1 / -1' }}>
            <Field label="Name *">
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Customer Support Agent"
                style={inputStyle}
              />
            </Field>
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <Field label="Description">
              <textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={2}
                placeholder="Brief description of this agent's purpose"
                style={{ ...inputStyle, resize: 'vertical' }}
              />
            </Field>
          </div>
        </div>
      </SectionCard>

      {/* ── Section 2: Agent Prompt ── */}
      <SectionCard title="Agent Prompt">
        <Field
          label="System Prompt"
          hint="Define this agent's persona, role, and instructions. This is sent to the AI as the system instruction for every conversation."
        >
          <textarea
            value={form.masterPrompt}
            onChange={(e) => setForm({ ...form, masterPrompt: e.target.value })}
            rows={10}
            placeholder="You are a helpful assistant that..."
            style={{ ...inputStyle, resize: 'vertical', minHeight: 200, fontFamily: 'monospace', fontSize: 13, lineHeight: 1.6 }}
          />
        </Field>
      </SectionCard>

      {/* ── Section 3: Model Settings ── */}
      <SectionCard title="Model Settings">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <Field label="Model Provider">
            <select
              value="anthropic"
              disabled
              style={{ ...selectStyle, background: '#f8fafc', color: '#64748b', cursor: 'not-allowed' }}
            >
              <option value="anthropic">Anthropic</option>
            </select>
          </Field>
          <Field label="Model ID">
            <select
              value={form.modelId}
              onChange={(e) => setForm({ ...form, modelId: e.target.value })}
              style={selectStyle}
            >
              {MODEL_OPTIONS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Temperature" hint="Higher = more creative, lower = more focused">
            <input
              type="number"
              min={0}
              max={1}
              step={0.1}
              value={form.temperature}
              onChange={(e) => setForm({ ...form, temperature: parseFloat(e.target.value) || 0 })}
              style={inputStyle}
            />
          </Field>
          <Field label="Max Response Tokens">
            <input
              type="number"
              min={256}
              max={8192}
              step={256}
              value={form.maxTokens}
              onChange={(e) => setForm({ ...form, maxTokens: parseInt(e.target.value) || 256 })}
              style={inputStyle}
            />
          </Field>
        </div>
      </SectionCard>

      {/* ── Section 4: Skills ── */}
      <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', marginBottom: 20 }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: '#1e293b', display: 'inline' }}>
              Skills
            </h2>
            {form.defaultSkillSlugs.length > 0 && (
              <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 500, color: '#64748b', background: '#f1f5f9', padding: '2px 8px', borderRadius: 999 }}>
                {form.defaultSkillSlugs.length} selected
              </span>
            )}
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
              Select which capabilities this agent has access to. Skills provide tools and structured methodology guidance.
            </div>
          </div>
          <Link
            to="/admin/skills"
            style={{ fontSize: 12, color: '#6366f1', textDecoration: 'none', fontWeight: 500, whiteSpace: 'nowrap' }}
          >
            Manage Skills
          </Link>
        </div>
        <div style={{ padding: 20 }}>
          {availableSkills.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '20px 0', color: '#64748b', fontSize: 13 }}>
              No skills available. <Link to="/admin/skills/new" style={{ color: '#6366f1' }}>Create one</Link>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
              {availableSkills.map((skill) => {
                const isSelected = form.defaultSkillSlugs.includes(skill.slug);
                return (
                  <button
                    key={skill.id}
                    onClick={() => {
                      const slugs = isSelected
                        ? form.defaultSkillSlugs.filter(s => s !== skill.slug)
                        : [...form.defaultSkillSlugs, skill.slug];
                      setForm({ ...form, defaultSkillSlugs: slugs });
                    }}
                    style={{
                      display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 14px',
                      background: isSelected ? '#eef2ff' : '#fafafa',
                      border: `1.5px solid ${isSelected ? '#6366f1' : '#e2e8f0'}`,
                      borderRadius: 10, cursor: 'pointer', textAlign: 'left',
                      transition: 'all 0.15s', fontFamily: 'inherit',
                    }}
                  >
                    {/* Checkbox */}
                    <div style={{
                      width: 20, height: 20, borderRadius: 6, flexShrink: 0, marginTop: 1,
                      background: isSelected ? '#6366f1' : '#fff',
                      border: `2px solid ${isSelected ? '#6366f1' : '#d1d5db'}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      transition: 'all 0.15s',
                    }}>
                      {isSelected && (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </div>
                    {/* Skill info */}
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: '#1e293b' }}>{skill.name}</span>
                        <span style={{
                          fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 999,
                          background: skill.skillType === 'built_in' ? '#ede9fe' : '#dbeafe',
                          color: skill.skillType === 'built_in' ? '#6d28d9' : '#1d4ed8',
                        }}>
                          {skill.skillType === 'built_in' ? 'Built-in' : 'Custom'}
                        </span>
                        {skill.methodology && (
                          <span style={{ fontSize: 10, fontWeight: 500, padding: '1px 6px', borderRadius: 999, background: '#dcfce7', color: '#166534' }}>
                            Methodology
                          </span>
                        )}
                      </div>
                      {skill.description && (
                        <div style={{ fontSize: 11, color: '#64748b', lineHeight: 1.4, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const }}>
                          {skill.description}
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Section 5: Data Sources ── */}
      {!isNew && deleteDsId && (
        <ConfirmDialog
          title="Delete data source"
          message="Are you sure you want to delete this data source? This action cannot be undone."
          confirmLabel="Delete"
          onConfirm={handleDeleteDs}
          onCancel={() => setDeleteDsId(null)}
        />
      )}

      <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', overflow: 'hidden', marginBottom: 20 }}>
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: '#1e293b', display: 'inline' }}>
              Data Sources
            </h2>
            {(isNew ? pendingNewSources.length : dataSources.length) > 0 && (
              <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 500, color: '#64748b', background: '#f1f5f9', padding: '2px 8px', borderRadius: 999 }}>
                {isNew ? pendingNewSources.length : dataSources.length}
              </span>
            )}
            {isNew && (
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
                Configure knowledge sources for this agent. Sources will be attached when you click "Create Agent".
              </div>
            )}
          </div>
          {!showDsForm && (
            <button
              onClick={openAddDs}
              style={{ padding: '6px 14px', background: '#6366f1', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, cursor: 'pointer', fontWeight: 500 }}
            >
              + Add Data Source
            </button>
          )}
        </div>

        {/* Inline add/edit form */}
        {showDsForm && renderDsForm()}

        {/* Source type legend */}
        {!showDsForm && (isNew ? pendingNewSources.length === 0 : dataSources.length === 0) && (
          <div style={{ padding: '32px 20px', textAlign: 'center' }}>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
              {SOURCE_TYPE_OPTIONS.map((t) => (
                <SourceTypeBadge key={t.value} type={t.value} />
              ))}
            </div>
            <div style={{ color: '#64748b', fontSize: 14, marginBottom: 8 }}>
              No data sources configured yet.
            </div>
            <button
              onClick={openAddDs}
              style={{ color: '#6366f1', background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, textDecoration: 'underline', padding: 0 }}
            >
              Add one
            </button>
          </div>
        )}

        {/* Pending data sources list (new agent mode) */}
        {isNew && pendingNewSources.length > 0 && !showDsForm && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: '#374151', fontSize: 12 }}>Name</th>
                <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: '#374151', fontSize: 12 }}>Type</th>
                <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: '#374151', fontSize: 12 }}>Source</th>
                <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: '#374151', fontSize: 12 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {pendingNewSources.map((pending) => (
                <tr key={pending.tempId} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '12px 16px' }}>
                    <div style={{ fontWeight: 500, color: '#1e293b', fontSize: 13 }}>{pending.form.name}</div>
                    {pending.form.description && (
                      <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{pending.form.description}</div>
                    )}
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <SourceTypeBadge type={pending.form.sourceType} />
                  </td>
                  <td style={{ padding: '12px 16px', color: '#475569', fontSize: 12, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {pending.form.sourceType === 'file_upload'
                      ? (pending.fileName ?? 'File selected')
                      : pending.form.sourcePath}
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        onClick={() => openEditPending(pending)}
                        style={{ padding: '4px 10px', background: '#f1f5f9', color: '#374151', border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer', fontWeight: 500 }}
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => setPendingNewSources((prev) => prev.filter((p) => p.tempId !== pending.tempId))}
                        style={{ padding: '4px 10px', background: '#fef2f2', color: '#dc2626', border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer', fontWeight: 500 }}
                      >
                        Remove
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Existing data sources list (edit mode) */}
        {!isNew && dataSources.length > 0 && !showDsForm && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: '#374151', fontSize: 12 }}>Name</th>
                <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: '#374151', fontSize: 12 }}>Type</th>
                <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: '#374151', fontSize: 12 }}>Sync</th>
                <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: '#374151', fontSize: 12 }}>Path</th>
                <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: '#374151', fontSize: 12 }}>Last Status</th>
                <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: '#374151', fontSize: 12 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {dataSources.map((ds) => (
                <tr key={ds.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '12px 16px' }}>
                    <div style={{ fontWeight: 500, color: '#1e293b', fontSize: 13 }}>{ds.name}</div>
                    {ds.description && (
                      <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{ds.description}</div>
                    )}
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <SourceTypeBadge type={ds.sourceType} />
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    {ds.sourceType === 'file_upload' ? (
                      <span style={{ fontSize: 11, color: '#64748b' }}>Static</span>
                    ) : (
                      <span style={{
                        fontSize: 11,
                        fontWeight: 500,
                        padding: '2px 8px',
                        borderRadius: 999,
                        background: ds.syncMode === 'proactive' ? '#ede9fe' : '#f1f5f9',
                        color: ds.syncMode === 'proactive' ? '#5b21b6' : '#475569',
                      }}>
                        {ds.syncMode === 'proactive' ? `Proactive · ${ds.cacheMinutes}m` : `Lazy · ${ds.cacheMinutes}m`}
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '12px 16px', color: '#475569', fontSize: 12, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {ds.sourceType === 'file_upload' ? ds.sourcePath.split('/').pop() : ds.sourcePath}
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    {ds.lastFetchStatus ? (
                      <span style={{
                        fontSize: 11,
                        fontWeight: 500,
                        color: ds.lastFetchStatus === 'ok' ? '#166534' : '#9a3412',
                        background: ds.lastFetchStatus === 'ok' ? '#dcfce7' : '#fff7ed',
                        padding: '2px 8px',
                        borderRadius: 999,
                      }}>
                        {ds.lastFetchStatus}
                      </span>
                    ) : (
                      <span style={{ fontSize: 11, color: '#94a3b8' }}>—</span>
                    )}
                    {testResults[ds.id] && (
                      <div style={{ marginTop: 6 }}>
                        {testResults[ds.id].error ? (
                          <div style={{ fontSize: 11, color: '#dc2626' }}>{testResults[ds.id].error}</div>
                        ) : (
                          <div style={{ fontSize: 11, color: '#475569' }}>
                            {testResults[ds.id].tokenCount != null && (
                              <span style={{ fontWeight: 500, color: '#166534' }}>{testResults[ds.id].tokenCount} tokens</span>
                            )}
                            {testResults[ds.id].snippet && (
                              <div style={{ marginTop: 4, fontFamily: 'monospace', fontSize: 10, color: '#64748b', background: '#f8fafc', padding: '4px 6px', borderRadius: 4, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {testResults[ds.id].snippet}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        onClick={() => openEditDs(ds)}
                        style={{ padding: '4px 10px', background: '#f1f5f9', color: '#374151', border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer', fontWeight: 500 }}
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleTestDs(ds.id)}
                        disabled={testingId === ds.id}
                        style={{ padding: '4px 10px', background: '#f0f9ff', color: '#0284c7', border: 'none', borderRadius: 6, fontSize: 12, cursor: testingId === ds.id ? 'not-allowed' : 'pointer', fontWeight: 500 }}
                      >
                        {testingId === ds.id ? 'Testing...' : 'Test'}
                      </button>
                      <button
                        onClick={() => setDeleteDsId(ds.id)}
                        style={{ padding: '4px 10px', background: '#fef2f2', color: '#dc2626', border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer', fontWeight: 500 }}
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

      {/* Save button */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 28 }}>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            padding: '10px 24px',
            background: saving ? '#a5b4fc' : '#6366f1',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            fontSize: 14,
            fontWeight: 600,
            cursor: saving ? 'not-allowed' : 'pointer',
          }}
        >
          {saving
            ? (isNew ? 'Creating...' : 'Saving...')
            : (isNew ? 'Create Agent' : 'Save Changes')}
        </button>
        <button
          onClick={() => navigate('/admin/agents')}
          style={{ padding: '10px 20px', background: '#f1f5f9', color: '#374151', border: 'none', borderRadius: 8, fontSize: 14, cursor: 'pointer' }}
        >
          Cancel
        </button>
      </div>
    </>
  );
}
