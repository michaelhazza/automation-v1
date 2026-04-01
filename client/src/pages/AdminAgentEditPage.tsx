import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import api from '../lib/api';
import { User } from '../lib/auth';
import ConfirmDialog from '../components/ConfirmDialog';
import { RunActivityChart } from '../components/ActivityCharts';

// ─── Interfaces ─────────────────────────────────────────────────────────────

interface AvailableSkill {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  skillType: 'built_in' | 'custom';
  methodology: string | null;
}

interface OrgAgentOption {
  id: string;
  name: string;
}

interface AgentForm {
  name: string;
  description: string;
  icon: string;
  masterPrompt: string;
  additionalPrompt: string;
  modelProvider: string;
  modelId: string;
  temperature: number;
  maxTokens: number;
  responseMode: string;
  outputSize: string;
  allowModelOverride: number;
  defaultSkillSlugs: string[];
  heartbeatEnabled: boolean;
  heartbeatIntervalHours: number | null;
  heartbeatOffsetHours: number;
  parentAgentId: string;
  agentRole: string;
  agentTitle: string;
}

interface Agent extends AgentForm {
  id: string;
  status: string;
  systemAgentId: string | null;
  isSystemManaged: boolean;
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
  { value: 'claude-opus-4-20250514', label: 'Claude Opus 4' },
  { value: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4' },
];

const RESPONSE_MODE_OPTIONS = [
  { value: 'balanced', label: 'Balanced (Default)', description: 'Consistent and clear responses' },
  { value: 'precise', label: 'Precise', description: 'Fully deterministic — same input always produces the same output. Best for data extraction and analysis' },
  { value: 'expressive', label: 'Expressive', description: 'More varied, natural language — good for insights and summaries' },
  { value: 'highly_creative', label: 'Highly Creative', description: 'Maximises variation — only for open-ended creative tasks' },
];

const OUTPUT_SIZE_OPTIONS = [
  { value: 'standard', label: 'Standard (Default)', description: 'Suitable for most tasks' },
  { value: 'extended', label: 'Extended', description: 'Longer outputs — use when responses may include large tables or detailed summaries' },
  { value: 'maximum', label: 'Maximum', description: 'For processing multiple large files where output may otherwise be truncated' },
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

const ICON_OPTIONS = [
  '\u{1F50D}', '\u{1F4CA}', '\u{1F4DD}', '\u{1F4E3}', '\u{1F916}', '\u{2699}\uFE0F}',
  '\u{1F4AC}', '\u{1F4C8}', '\u{2728}', '\u{1F3AF}', '\u{1F4A1}', '\u{1F4CB}',
  '\u{1F4E7}', '\u{1F310}', '\u{1F4B0}', '\u{1F465}', '\u{1F4F1}', '\u{1F5A5}\uFE0F',
  '\u{1F4DA}', '\u{1F3E2}', '\u{1F6E0}\uFE0F', '\u{1F4CC}', '\u{1F4CE}', '\u{1F512}',
];

const EMPTY_AGENT_FORM: AgentForm = {
  name: '',
  description: '',
  icon: '',
  masterPrompt: '',
  additionalPrompt: '',
  modelProvider: 'anthropic',
  modelId: 'claude-sonnet-4-6',
  temperature: 0.7,
  maxTokens: 4096,
  responseMode: 'balanced',
  outputSize: 'standard',
  allowModelOverride: 1,
  defaultSkillSlugs: [],
  heartbeatEnabled: false,
  heartbeatIntervalHours: null,
  heartbeatOffsetHours: 0,
  parentAgentId: '',
  agentRole: '',
  agentTitle: '',
};

// ─── Helper components ───────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const cls: Record<string, string> = {
    active:   'bg-green-100 text-green-800',
    inactive: 'bg-orange-50 text-orange-800',
    draft:    'bg-slate-100 text-slate-600',
  };
  return (
    <span className={`inline-block px-[10px] py-[2px] rounded-full text-xs font-semibold capitalize ${cls[status] ?? cls.draft}`}>
      {status}
    </span>
  );
}

function SourceTypeBadge({ type }: { type: string }) {
  const cls: Record<string, string> = {
    r2:          'bg-blue-50 text-blue-700',
    s3:          'bg-green-50 text-green-700',
    http_url:    'bg-violet-50 text-violet-700',
    google_docs: 'bg-yellow-50 text-yellow-800',
    dropbox:     'bg-sky-100 text-sky-700',
    file_upload: 'bg-pink-50 text-pink-800',
  };
  const label = SOURCE_TYPE_OPTIONS.find((o) => o.value === type)?.label ?? type;
  return (
    <span className={`inline-block px-2 py-[2px] rounded-full text-[11px] font-semibold ${cls[type] ?? 'bg-slate-100 text-slate-600'}`}>
      {label}
    </span>
  );
}

// ── Heartbeat Timeline ───────────────────────────────────────────────────────
function HeartbeatTimeline({ agentName, intervalHours, offsetHours }: { agentName: string; intervalHours: number; offsetHours: number }) {
  const runHours: number[] = [];
  for (let h = offsetHours; h < 24; h += intervalHours) runHours.push(h);

  return (
    <div className="bg-slate-50 border border-slate-200 rounded-[10px] px-[18px] py-[14px]">
      <div className="flex items-center gap-3 mb-1">
        <span className="text-xs font-semibold text-gray-700 w-[130px] shrink-0 overflow-hidden text-ellipsis whitespace-nowrap">
          {agentName}
        </span>
        <span className="text-[11px] text-slate-400 w-[70px] shrink-0">every {intervalHours}h</span>
        {/* SVG timeline */}
        <svg width="100%" height="28" viewBox="0 0 480 28" preserveAspectRatio="none" className="flex-1 min-w-0">
          {/* Base line */}
          <line x1="0" y1="14" x2="480" y2="14" stroke="#d1d5db" strokeWidth="1.5" />
          {/* Hour ticks */}
          {[0, 4, 8, 12, 16, 20, 24].map((h) => (
            <line key={h} x1={h / 24 * 480} y1="10" x2={h / 24 * 480} y2="18" stroke="#d1d5db" strokeWidth="1" />
          ))}
          {/* Run dots */}
          {runHours.map((h) => (
            <circle key={h} cx={h / 24 * 480} cy="14" r="5" fill="#6366f1" />
          ))}
        </svg>
      </div>
      {/* Hour labels */}
      <div className="flex justify-between pl-[202px] text-[10px] text-slate-400 mt-0.5">
        {[0, 4, 8, 12, 16, 20, 24].map((h) => (
          <span key={h}>{h === 24 ? '' : `${h}h`}</span>
        ))}
      </div>
      {/* Run times list */}
      <div className="mt-2.5 pl-[202px] text-xs text-indigo-500 font-medium">
        Runs at: {runHours.map(h => `${String(h).padStart(2, '0')}:00`).join('  ·  ')} UTC
      </div>
    </div>
  );
}

function SectionCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-[10px] border border-slate-200 mb-5">
      <div className="px-5 py-4 border-b border-slate-100">
        <h2 className="m-0 text-[15px] font-semibold text-slate-900">{title}</h2>
        {subtitle && <p className="m-0 mt-1 text-xs text-slate-500">{subtitle}</p>}
      </div>
      <div className="p-5">
        {children}
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <label className="block text-[13px] font-medium text-gray-700 mb-1.5">{label}</label>
      {children}
      {hint && <div className="text-xs text-slate-400 mt-1">{hint}</div>}
    </div>
  );
}

const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] text-slate-900 bg-white';

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

  // Tab
  const [agentTab, setAgentTab] = useState<'config' | 'runs' | 'usage'>('config');

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
  const [allOrgAgents, setAllOrgAgents] = useState<OrgAgentOption[]>([]);

  // ── Load ──

  const loadAgent = async (agentId: string) => {
    try {
      const { data } = await api.get(`/api/agents/${agentId}`);
      setAgent(data);
      setForm({
        name: data.name ?? '',
        description: data.description ?? '',
        icon: data.icon ?? '',
        masterPrompt: data.masterPrompt ?? '',
        additionalPrompt: data.additionalPrompt ?? '',
        modelProvider: data.modelProvider ?? 'anthropic',
        modelId: data.modelId ?? 'claude-sonnet-4-6',
        temperature: data.temperature ?? 0.7,
        maxTokens: data.maxTokens ?? 4096,
        responseMode: data.responseMode ?? 'balanced',
        outputSize: data.outputSize ?? 'standard',
        allowModelOverride: data.allowModelOverride ?? 1,
        defaultSkillSlugs: data.defaultSkillSlugs ?? [],
        heartbeatEnabled: data.heartbeatEnabled ?? false,
        heartbeatIntervalHours: data.heartbeatIntervalHours ?? null,
        heartbeatOffsetHours: data.heartbeatOffsetHours ?? 0,
        parentAgentId: data.parentAgentId ?? '',
        agentRole: data.agentRole ?? '',
        agentTitle: data.agentTitle ?? '',
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
    // Load all org agents for the parent dropdown
    api.get('/api/agents').then(({ data }) => setAllOrgAgents(data.map((a: { id: string; name: string }) => ({ id: a.id, name: a.name })))).catch(() => {});
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
      // Transform hierarchy fields: empty string → null for API
      const payload = {
        ...form,
        parentAgentId: form.parentAgentId || null,
        agentRole: form.agentRole || null,
        agentTitle: form.agentTitle || null,
      };

      if (isNew) {
        // 1. Create the agent
        const { data } = await api.post('/api/agents', payload);
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
        await api.patch(`/api/agents/${id}`, payload);
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
      <div className="py-12 text-center text-slate-500 text-[14px]">
        Loading agent...
      </div>
    );
  }

  // Shared data source inline form
  const renderDsForm = () => (
    <div className="p-5 border-b border-slate-200 bg-[#fafbff]">
      <div className="text-[14px] font-semibold text-slate-900 mb-4">
        {editingDsId || editingTempId ? 'Edit Data Source' : 'New Data Source'}
      </div>
      {dsFormError && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3.5 text-red-600 text-[13px]">
          {dsFormError}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3.5">
        <div className="col-span-2">
          <Field label="Name *">
            <input
              value={dsForm.name}
              onChange={(e) => setDsForm({ ...dsForm, name: e.target.value })}
              className={inputCls}
              placeholder="e.g. Product Catalog"
            />
          </Field>
        </div>
        <div className="col-span-2">
          <Field label="Description">
            <input
              value={dsForm.description}
              onChange={(e) => setDsForm({ ...dsForm, description: e.target.value })}
              className={inputCls}
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
            className={inputCls}
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
            className={inputCls}
          >
            {CONTENT_TYPE_OPTIONS.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </Field>

        {/* Source path / file picker — conditional on type */}
        {dsForm.sourceType === 'file_upload' ? (
          <div className="col-span-2">
            <Field label="File *" hint="Upload a file (PDF, CSV, TXT, JSON, Markdown, DOCX, etc.)">
              <div
                className={`border-2 border-dashed border-gray-300 rounded-lg p-4 text-center cursor-pointer transition-colors duration-150 ${dsFormFile ? 'bg-green-50' : 'bg-gray-50'}`}
                onClick={() => fileInputRef.current?.click()}
              >
                {dsFormFile ? (
                  <div className="text-[13px] text-green-600 font-medium">
                    {dsFormFile.name} ({(dsFormFile.size / 1024).toFixed(1)} KB)
                    <div className="text-xs text-slate-500 mt-1 font-normal">Click to change file</div>
                  </div>
                ) : editingDsId && dataSources.find((ds) => ds.id === editingDsId)?.sourcePath ? (
                  <div className="text-[13px] text-slate-500">
                    <div className="font-medium text-slate-900 mb-1">
                      Current: {dataSources.find((ds) => ds.id === editingDsId)?.sourcePath.split('/').pop()}
                    </div>
                    Click to replace with a new file
                  </div>
                ) : (
                  <div className="text-[13px] text-slate-500">
                    <div className="text-xl mb-1.5">📁</div>
                    Click to select a file
                  </div>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
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
          <div className="col-span-2">
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
                className={inputCls}
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
          <div className="col-span-2">
            <Field
              label="Google Docs API Key (optional)"
              hint="Required for private documents. Leave empty for publicly published docs."
            >
              <input
                value={dsForm.googleApiKey}
                onChange={(e) => setDsForm({ ...dsForm, googleApiKey: e.target.value })}
                className={inputCls}
                type="password"
                placeholder="AIza..."
              />
            </Field>
          </div>
        )}

        {/* Sync mode — only for live source types */}
        {LIVE_SOURCE_TYPES.has(dsForm.sourceType) && (
          <div className="col-span-2">
            <Field
              label="Sync Mode"
              hint={
                dsForm.syncMode === 'proactive'
                  ? 'Background job re-fetches this source on the refresh interval, keeping it always warm.'
                  : 'Source is re-fetched the first time the agent is used after the refresh interval expires.'
              }
            >
              <div className="flex gap-2.5">
                {(['lazy', 'proactive'] as const).map((mode) => (
                  <label
                    key={mode}
                    className={`flex items-center gap-2 px-3.5 py-2 border-2 rounded-lg cursor-pointer text-[13px] transition-all duration-100 ${
                      dsForm.syncMode === mode
                        ? 'border-indigo-500 bg-indigo-50 font-semibold text-indigo-700'
                        : 'border-gray-300 bg-white font-normal text-gray-700'
                    }`}
                  >
                    <input
                      type="radio"
                      name="syncMode"
                      value={mode}
                      checked={dsForm.syncMode === mode}
                      onChange={() => setDsForm({ ...dsForm, syncMode: mode })}
                      className="hidden"
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
              className={inputCls}
            />
          </Field>
        )}

        <Field label="Priority" hint="0 = first, higher = later">
          <input
            type="number"
            value={dsForm.priority}
            onChange={(e) => setDsForm({ ...dsForm, priority: parseInt(e.target.value) || 0 })}
            className={inputCls}
          />
        </Field>
        <Field label="Max Token Budget" hint="Max tokens this source contributes to context">
          <input
            type="number"
            value={dsForm.maxTokenBudget}
            onChange={(e) => setDsForm({ ...dsForm, maxTokenBudget: parseInt(e.target.value) || 1000 })}
            className={inputCls}
          />
        </Field>
      </div>
      <div className="flex gap-2.5 mt-1">
        <button
          onClick={handleSaveDs}
          disabled={dsSaving}
          className={`px-5 py-2 text-white border-none rounded-lg text-[13px] font-medium transition-colors ${dsSaving ? 'bg-indigo-300 cursor-not-allowed' : 'bg-indigo-500 cursor-pointer'}`}
        >
          {dsSaving ? 'Saving...' : editingDsId || editingTempId ? 'Update' : isNew ? 'Add to Agent' : 'Add Source'}
        </button>
        <button
          onClick={cancelDsForm}
          className="px-5 py-2 bg-slate-100 text-gray-700 border-none rounded-lg text-[13px] cursor-pointer"
        >
          Cancel
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Back link + header */}
      <div className="mb-4">
        <Link to="/admin/agents" className="text-indigo-500 text-[13px] no-underline">
          &larr; Back to agents
        </Link>
      </div>

      <div className="flex justify-between items-start mb-6">
        <div>
          <h1 className="text-[26px] font-bold text-slate-900 m-0">
            {isNew ? 'New Agent' : `Edit Agent: ${agent?.name ?? ''}`}
          </h1>
          {!isNew && agent && (
            <p className="mt-1.5 mb-0 text-slate-500 text-[13px]">
              Created {new Date(agent.createdAt).toLocaleDateString()}
            </p>
          )}
        </div>
        {!isNew && agent && (
          <div className="flex items-center gap-2.5">
            <StatusBadge status={agent.status} />
            {agent.status !== 'active' && (
              <button
                onClick={handleActivate}
                disabled={statusLoading}
                className={`px-3.5 py-1.5 bg-green-100 text-green-800 border-none rounded-md text-[13px] font-medium ${statusLoading ? 'cursor-not-allowed' : 'cursor-pointer'}`}
              >
                Activate
              </button>
            )}
            {agent.status === 'active' && (
              <button
                onClick={handleDeactivate}
                disabled={statusLoading}
                className={`px-3.5 py-1.5 bg-orange-50 text-orange-800 border-none rounded-md text-[13px] font-medium ${statusLoading ? 'cursor-not-allowed' : 'cursor-pointer'}`}
              >
                Deactivate
              </button>
            )}
          </div>
        )}
      </div>

      {/* Tab bar — only for existing agents */}
      {!isNew && (
        <div className="flex gap-0.5 border-b border-slate-200 mb-6">
          {(['config', 'runs', 'usage'] as const).map(t => (
            <button
              key={t}
              onClick={() => setAgentTab(t)}
              className={`px-4 py-2.5 text-[13px] font-semibold border-0 bg-transparent cursor-pointer transition-colors border-b-2 -mb-px [font-family:inherit] capitalize ${
                agentTab === t
                  ? 'text-indigo-600 border-indigo-500'
                  : 'text-slate-500 border-transparent hover:text-slate-800'
              }`}
            >
              {t === 'config' ? 'Configuration' : t === 'runs' ? 'Run History' : 'Usage & Costs'}
            </button>
          ))}
        </div>
      )}

      {/* ── Config tab (existing form) ──────────────────────────────────── */}
      {(isNew || agentTab === 'config') && <>

      {/* Global feedback */}
      {saveSuccess && (
        <div className="bg-green-50 border border-green-200 rounded-lg px-3.5 py-2.5 mb-4 text-green-700 text-[13px]">
          {saveSuccess}
        </div>
      )}
      {saveError && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-3.5 py-2.5 mb-4 text-red-600 text-[13px]">
          {saveError}
        </div>
      )}

      {/* ── Section 1: Basic Info ── */}
      <SectionCard title="Basic Info">
        <div className="grid grid-cols-2 gap-4">
          {/* Icon picker */}
          <div className="col-span-2">
            <Field label="Icon" hint="Choose an icon that represents this agent's role">
              <div className="flex flex-wrap gap-1.5">
                {ICON_OPTIONS.map((ico) => (
                  <button
                    key={ico}
                    type="button"
                    onClick={() => setForm({ ...form, icon: form.icon === ico ? '' : ico })}
                    className={`w-10 h-10 rounded-[10px] border-2 cursor-pointer text-xl flex items-center justify-center transition-all duration-100 ${
                      form.icon === ico
                        ? 'border-indigo-500 bg-indigo-50'
                        : 'border-slate-200 bg-gray-50'
                    }`}
                  >
                    {ico}
                  </button>
                ))}
              </div>
            </Field>
          </div>
          <div className="col-span-2">
            <Field label="Name *">
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Customer Support Agent"
                className={inputCls}
              />
            </Field>
          </div>
          <div className="col-span-2">
            <Field label="Description" hint="Describe what this agent does in first person, e.g. 'I research your competitors and report weekly'">
              <textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={2}
                placeholder="e.g. I research your competitors and deliver weekly insight reports"
                className={`${inputCls} resize-y`}
              />
            </Field>
          </div>
        </div>
      </SectionCard>

      {/* ── Section 2: Agent Prompt ── */}
      {agent?.isSystemManaged ? (
        <SectionCard title="Agent Prompt">
          <div className="px-4 py-3 bg-violet-50 border border-violet-200 rounded-lg mb-4 text-[13px] text-violet-800">
            This agent&apos;s core system prompt is managed at the platform level and cannot be edited here.
            You can add additional instructions below that will be layered on top of the system prompt.
          </div>
          <Field
            label="Additional Prompt"
            hint="Your organisation-level instructions appended to the system prompt. Add your branding, workflows, or extra context here."
          >
            <textarea
              value={form.additionalPrompt}
              onChange={(e) => setForm({ ...form, additionalPrompt: e.target.value })}
              rows={10}
              placeholder="Add your organisation-specific instructions here..."
              className={`${inputCls} resize-y min-h-[200px] font-mono leading-relaxed`}
            />
          </Field>
        </SectionCard>
      ) : (
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
              className={`${inputCls} resize-y min-h-[200px] font-mono leading-relaxed`}
            />
          </Field>
        </SectionCard>
      )}

      {/* ── Hierarchy ── */}
      <SectionCard title="Hierarchy" subtitle="Position this agent in your organisation's agent hierarchy. Phase 1 is structural/visual only.">
        <div className="grid grid-cols-3 gap-4">
          <Field label="Reports to">
            <select
              value={form.parentAgentId}
              onChange={(e) => setForm({ ...form, parentAgentId: e.target.value })}
              className={inputCls}
            >
              <option value="">None (root agent)</option>
              {allOrgAgents
                .filter((a) => a.id !== id)
                .map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
            </select>
          </Field>
          <Field label="Role">
            <select
              value={form.agentRole}
              onChange={(e) => setForm({ ...form, agentRole: e.target.value })}
              className={inputCls}
            >
              <option value="">None</option>
              <option value="orchestrator">Orchestrator</option>
              <option value="specialist">Specialist</option>
              <option value="worker">Worker</option>
            </select>
          </Field>
          <Field label="Title">
            <input
              value={form.agentTitle}
              onChange={(e) => setForm({ ...form, agentTitle: e.target.value })}
              className={inputCls}
              placeholder="e.g. Head of Research"
            />
          </Field>
        </div>
      </SectionCard>

      {/* ── Section 3: Model Configuration ── */}
      <SectionCard title="Model Configuration">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Model Provider">
            <select
              value="anthropic"
              disabled
              className={`${inputCls} bg-slate-50 text-slate-500 cursor-not-allowed`}
            >
              <option value="anthropic">Anthropic</option>
            </select>
          </Field>
          <Field label="Model ID">
            <select
              value={form.modelId}
              onChange={(e) => setForm({ ...form, modelId: e.target.value })}
              className={inputCls}
            >
              {MODEL_OPTIONS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4 mt-4">
          <Field label="Response Mode" hint={RESPONSE_MODE_OPTIONS.find((o) => o.value === form.responseMode)?.description}>
            <select
              value={form.responseMode}
              onChange={(e) => setForm({ ...form, responseMode: e.target.value })}
              className={inputCls}
            >
              {RESPONSE_MODE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Output Size" hint={OUTPUT_SIZE_OPTIONS.find((o) => o.value === form.outputSize)?.description}>
            <select
              value={form.outputSize}
              onChange={(e) => setForm({ ...form, outputSize: e.target.value })}
              className={inputCls}
            >
              {OUTPUT_SIZE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </Field>
        </div>

        <div className="mt-4 flex items-center gap-2.5">
          <label className="flex items-center gap-2 cursor-pointer text-[13px] font-medium text-gray-700">
            <input
              type="checkbox"
              checked={form.allowModelOverride === 1}
              onChange={(e) => setForm({ ...form, allowModelOverride: e.target.checked ? 1 : 0 })}
              className="w-4 h-4 cursor-pointer"
            />
            Allow Model Override
          </label>
          <span className="text-xs text-slate-400">
            {form.allowModelOverride === 1
              ? 'Sub-accounts can override the model for this agent'
              : 'Model settings are locked — sub-accounts cannot change them'}
          </span>
        </div>
      </SectionCard>

      {/* ── Section 4: Skills ── */}
      <div className="bg-white rounded-[10px] border border-slate-200 mb-5">
        <div className="px-5 py-4 border-b border-slate-100 flex justify-between items-center">
          <div>
            <h2 className="m-0 text-[15px] font-semibold text-slate-900 inline">Skills</h2>
            {form.defaultSkillSlugs.length > 0 && (
              <span className="ml-2 text-xs font-medium text-slate-500 bg-slate-100 px-2 py-[2px] rounded-full">
                {form.defaultSkillSlugs.length} selected
              </span>
            )}
            <div className="text-xs text-slate-500 mt-1">
              Select which capabilities this agent has access to. Skills provide tools and structured methodology guidance.
            </div>
          </div>
          <Link to="/admin/skills" className="text-xs text-indigo-500 no-underline font-medium whitespace-nowrap">
            Manage Skills
          </Link>
        </div>
        <div className="p-5">
          {availableSkills.length === 0 ? (
            <div className="text-center py-5 text-slate-500 text-[13px]">
              No skills available. <Link to="/admin/skills/new" className="text-indigo-500">Create one</Link>
            </div>
          ) : (
            <div className="grid gap-2.5 grid-cols-[repeat(auto-fill,minmax(280px,1fr))]">
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
                    className={`flex items-start gap-2.5 px-3.5 py-3 rounded-[10px] cursor-pointer text-left transition-all duration-150 font-[inherit] border-[1.5px] ${
                      isSelected ? 'bg-indigo-50 border-indigo-500' : 'bg-gray-50 border-slate-200'
                    }`}
                  >
                    {/* Checkbox */}
                    <div className={`w-5 h-5 rounded-md shrink-0 mt-px border-2 flex items-center justify-center transition-all duration-150 ${
                      isSelected ? 'bg-indigo-500 border-indigo-500' : 'bg-white border-gray-300'
                    }`}>
                      {isSelected && (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </div>
                    {/* Skill info */}
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className="text-[13px] font-semibold text-slate-900">{skill.name}</span>
                        <span className={`text-[10px] font-semibold px-1.5 py-[1px] rounded-full ${
                          skill.skillType === 'built_in' ? 'bg-violet-100 text-violet-700' : 'bg-blue-100 text-blue-700'
                        }`}>
                          {skill.skillType === 'built_in' ? 'Built-in' : 'Custom'}
                        </span>
                        {skill.methodology && (
                          <span className="text-[10px] font-medium px-1.5 py-[1px] rounded-full bg-green-100 text-green-800">
                            Methodology
                          </span>
                        )}
                      </div>
                      {skill.description && (
                        <div className="text-[11px] text-slate-500 line-clamp-2">
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

      <div className="bg-white rounded-[10px] border border-slate-200 overflow-hidden mb-5">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 flex justify-between items-center">
          <div>
            <h2 className="m-0 text-[15px] font-semibold text-slate-900 inline">Data Sources</h2>
            {(isNew ? pendingNewSources.length : dataSources.length) > 0 && (
              <span className="ml-2 text-xs font-medium text-slate-500 bg-slate-100 px-2 py-[2px] rounded-full">
                {isNew ? pendingNewSources.length : dataSources.length}
              </span>
            )}
            {isNew && (
              <div className="text-xs text-slate-500 mt-1">
                Configure knowledge sources for this agent. Sources will be attached when you click "Create Agent".
              </div>
            )}
          </div>
          {!showDsForm && (
            <button
              onClick={openAddDs}
              className="px-3.5 py-1.5 bg-indigo-500 text-white border-none rounded-md text-[13px] cursor-pointer font-medium"
            >
              + Add Data Source
            </button>
          )}
        </div>

        {/* Inline add/edit form */}
        {showDsForm && renderDsForm()}

        {/* Source type legend */}
        {!showDsForm && (isNew ? pendingNewSources.length === 0 : dataSources.length === 0) && (
          <div className="py-8 px-5 text-center">
            <div className="flex justify-center gap-2.5 flex-wrap mb-4">
              {SOURCE_TYPE_OPTIONS.map((t) => (
                <SourceTypeBadge key={t.value} type={t.value} />
              ))}
            </div>
            <div className="text-slate-500 text-[14px] mb-2">No data sources configured yet.</div>
            <button
              onClick={openAddDs}
              className="text-indigo-500 bg-transparent border-none cursor-pointer text-[14px] underline p-0"
            >
              Add one
            </button>
          </div>
        )}

        {/* Pending data sources list (new agent mode) */}
        {isNew && pendingNewSources.length > 0 && !showDsForm && (
          <table className="w-full border-collapse text-[14px]">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-4 py-2.5 text-left font-semibold text-gray-700 text-xs">Name</th>
                <th className="px-4 py-2.5 text-left font-semibold text-gray-700 text-xs">Type</th>
                <th className="px-4 py-2.5 text-left font-semibold text-gray-700 text-xs">Source</th>
                <th className="px-4 py-2.5 text-left font-semibold text-gray-700 text-xs">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pendingNewSources.map((pending) => (
                <tr key={pending.tempId} className="border-b border-slate-100">
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900 text-[13px]">{pending.form.name}</div>
                    {pending.form.description && (
                      <div className="text-[11px] text-slate-400 mt-0.5">{pending.form.description}</div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <SourceTypeBadge type={pending.form.sourceType} />
                  </td>
                  <td className="px-4 py-3 text-slate-600 text-xs max-w-[220px] overflow-hidden text-ellipsis whitespace-nowrap">
                    {pending.form.sourceType === 'file_upload'
                      ? (pending.fileName ?? 'File selected')
                      : pending.form.sourcePath}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1.5">
                      <button onClick={() => openEditPending(pending)} className="px-2.5 py-1 bg-slate-100 text-gray-700 border-none rounded-md text-xs cursor-pointer font-medium">Edit</button>
                      <button
                        onClick={() => setPendingNewSources((prev) => prev.filter((p) => p.tempId !== pending.tempId))}
                        className="px-2.5 py-1 bg-red-50 text-red-600 border-none rounded-md text-xs cursor-pointer font-medium"
                      >Remove</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Existing data sources list (edit mode) */}
        {!isNew && dataSources.length > 0 && !showDsForm && (
          <table className="w-full border-collapse text-[14px]">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-4 py-2.5 text-left font-semibold text-gray-700 text-xs">Name</th>
                <th className="px-4 py-2.5 text-left font-semibold text-gray-700 text-xs">Type</th>
                <th className="px-4 py-2.5 text-left font-semibold text-gray-700 text-xs">Sync</th>
                <th className="px-4 py-2.5 text-left font-semibold text-gray-700 text-xs">Path</th>
                <th className="px-4 py-2.5 text-left font-semibold text-gray-700 text-xs">Last Status</th>
                <th className="px-4 py-2.5 text-left font-semibold text-gray-700 text-xs">Actions</th>
              </tr>
            </thead>
            <tbody>
              {dataSources.map((ds) => (
                <tr key={ds.id} className="border-b border-slate-100">
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900 text-[13px]">{ds.name}</div>
                    {ds.description && (
                      <div className="text-[11px] text-slate-400 mt-0.5">{ds.description}</div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <SourceTypeBadge type={ds.sourceType} />
                  </td>
                  <td className="px-4 py-3">
                    {ds.sourceType === 'file_upload' ? (
                      <span className="text-[11px] text-slate-500">Static</span>
                    ) : (
                      <span className={`text-[11px] font-medium px-2 py-[2px] rounded-full ${
                        ds.syncMode === 'proactive' ? 'bg-violet-100 text-violet-700' : 'bg-slate-100 text-slate-600'
                      }`}>
                        {ds.syncMode === 'proactive' ? `Proactive · ${ds.cacheMinutes}m` : `Lazy · ${ds.cacheMinutes}m`}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600 text-xs max-w-[180px] overflow-hidden text-ellipsis whitespace-nowrap">
                    {ds.sourceType === 'file_upload' ? ds.sourcePath.split('/').pop() : ds.sourcePath}
                  </td>
                  <td className="px-4 py-3">
                    {ds.lastFetchStatus ? (
                      <span className={`text-[11px] font-medium px-2 py-[2px] rounded-full ${
                        ds.lastFetchStatus === 'ok' ? 'bg-green-100 text-green-800' : 'bg-orange-50 text-orange-800'
                      }`}>
                        {ds.lastFetchStatus}
                      </span>
                    ) : (
                      <span className="text-[11px] text-slate-400">—</span>
                    )}
                    {testResults[ds.id] && (
                      <div className="mt-1.5">
                        {testResults[ds.id].error ? (
                          <div className="text-[11px] text-red-600">{testResults[ds.id].error}</div>
                        ) : (
                          <div className="text-[11px] text-slate-600">
                            {testResults[ds.id].tokenCount != null && (
                              <span className="font-medium text-green-700">{testResults[ds.id].tokenCount} tokens</span>
                            )}
                            {testResults[ds.id].snippet && (
                              <div className="mt-1 font-mono text-[10px] text-slate-500 bg-slate-50 px-1.5 py-1 rounded max-w-[200px] overflow-hidden text-ellipsis whitespace-nowrap">
                                {testResults[ds.id].snippet}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1.5">
                      <button onClick={() => openEditDs(ds)} className="px-2.5 py-1 bg-slate-100 text-gray-700 border-none rounded-md text-xs cursor-pointer font-medium">Edit</button>
                      <button
                        onClick={() => handleTestDs(ds.id)}
                        disabled={testingId === ds.id}
                        className={`px-2.5 py-1 bg-sky-50 text-sky-600 border-none rounded-md text-xs font-medium ${testingId === ds.id ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                      >
                        {testingId === ds.id ? 'Testing...' : 'Test'}
                      </button>
                      <button onClick={() => setDeleteDsId(ds.id)} className="px-2.5 py-1 bg-red-50 text-red-600 border-none rounded-md text-xs cursor-pointer font-medium">Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Section 6: Heartbeat ── */}
      <SectionCard title="Heartbeat">
        <p className="m-0 mb-[18px] text-[13.5px] text-slate-500 leading-relaxed">
          Heartbeats keep your agent active — it wakes up on a schedule, checks its tasks, and acts autonomously.
        </p>

        {/* Enable toggle */}
        <label className="flex items-center gap-2.5 cursor-pointer mb-5">
          <div
            onClick={() => setForm({ ...form, heartbeatEnabled: !form.heartbeatEnabled })}
            className={`w-10 h-[22px] rounded-[11px] relative cursor-pointer shrink-0 transition-colors duration-150 ${form.heartbeatEnabled ? 'bg-indigo-500' : 'bg-slate-200'}`}
          >
            <div className={`absolute top-[3px] w-4 h-4 rounded-full bg-white shadow-sm transition-[left] duration-150 ${form.heartbeatEnabled ? 'left-[21px]' : 'left-[3px]'}`} />
          </div>
          <span className="text-[14px] font-semibold text-slate-900">Enable heartbeat</span>
        </label>

        {form.heartbeatEnabled && (
          <div className="flex flex-col gap-5">
            {/* Frequency */}
            <div>
              <div className="text-[13px] font-semibold text-gray-700 mb-2">Frequency</div>
              <div className="flex gap-2">
                {([4, 8, 12, 24] as const).map((h) => (
                  <button
                    key={h}
                    type="button"
                    onClick={() => setForm({ ...form, heartbeatIntervalHours: h })}
                    className={`px-[18px] py-[7px] rounded-lg border-2 text-[13px] font-semibold cursor-pointer transition-all duration-100 ${
                      form.heartbeatIntervalHours === h
                        ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                        : 'border-slate-200 bg-white text-slate-500'
                    }`}
                  >
                    Every {h}h
                  </button>
                ))}
              </div>
            </div>

            {/* Offset */}
            <div>
              <div className="text-[13px] font-semibold text-gray-700 mb-1">Start offset</div>
              <div className="text-xs text-slate-400 mb-2">
                Stagger agents to spread load — e.g. Content Writer at 0h, SEO Agent at 2h, Social Manager at 4h
              </div>
              <div className="flex items-center gap-2.5">
                <select
                  value={form.heartbeatOffsetHours}
                  onChange={(e) => setForm({ ...form, heartbeatOffsetHours: Number(e.target.value) })}
                  className={`${inputCls} w-[120px]`}
                >
                  {Array.from({ length: 24 }, (_, i) => (
                    <option key={i} value={i}>{i === 0 ? 'No offset' : `+${i}h offset`}</option>
                  ))}
                </select>
                <span className="text-[13px] text-slate-500">within each cycle</span>
              </div>
            </div>

            {/* Timeline preview */}
            {form.heartbeatIntervalHours && (
              <div>
                <div className="text-[13px] font-semibold text-gray-700 mb-2.5">Schedule preview (24h)</div>
                <HeartbeatTimeline
                  agentName={form.name || 'This agent'}
                  intervalHours={form.heartbeatIntervalHours}
                  offsetHours={form.heartbeatOffsetHours}
                />
              </div>
            )}
          </div>
        )}
      </SectionCard>

      {/* Save button */}
      <div className="flex gap-3 mb-7">
        <button
          onClick={handleSave}
          disabled={saving}
          className={`px-6 py-2.5 text-white border-none rounded-lg text-[14px] font-semibold transition-colors ${saving ? 'bg-indigo-300 cursor-not-allowed' : 'bg-indigo-500 cursor-pointer'}`}
        >
          {saving
            ? (isNew ? 'Creating...' : 'Saving...')
            : (isNew ? 'Create Agent' : 'Save Changes')}
        </button>
        <button
          onClick={() => navigate('/admin/agents')}
          className="px-5 py-2.5 bg-slate-100 text-gray-700 border-none rounded-lg text-[14px] cursor-pointer"
        >
          Cancel
        </button>
      </div>
      </> /* end config tab */}

      {/* ── Runs tab ────────────────────────────────────────────────────── */}
      {!isNew && agentTab === 'runs' && id && <AgentRunsTab agentId={id} />}

      {/* ── Usage tab ───────────────────────────────────────────────────── */}
      {!isNew && agentTab === 'usage' && id && <AgentUsageTab agentId={id} />}

    </>
  );
}

// ─── Agent Runs Tab ──────────────────────────────────────────────────────────

interface RunRow {
  id: string; agentName: string; subaccountName: string; runType: string;
  status: string; totalTokens: number; totalToolCalls: number;
  durationMs: number | null; createdAt: string; subaccountId: string;
}

const RUN_STATUS_STYLES: Record<string, string> = {
  completed:       'bg-emerald-50 text-emerald-700 border-emerald-200',
  failed:          'bg-red-50 text-red-700 border-red-200',
  running:         'bg-blue-50 text-blue-700 border-blue-200',
  pending:         'bg-slate-100 text-slate-600 border-slate-200',
  timeout:         'bg-amber-50 text-amber-700 border-amber-200',
  cancelled:       'bg-slate-100 text-slate-400 border-slate-200',
  budget_exceeded: 'bg-amber-100 text-amber-800 border-amber-200',
  loop_detected:   'bg-amber-100 text-amber-800 border-amber-200',
};

function RunStatusBadge({ status }: { status: string }) {
  const cls = RUN_STATUS_STYLES[status] ?? RUN_STATUS_STYLES.pending;
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold border ${cls}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

function AgentRunsTab({ agentId }: { agentId: string }) {
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [daily, setDaily] = useState<{ date: string; completed: number; failed: number; timeout: number; other: number; total: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r, d] = await Promise.all([
        api.get('/api/agent-activity', { params: { agentId, limit: 50 } }),
        api.get('/api/agent-activity/daily', { params: { sinceDays: 14 } }),
      ]);
      setRuns(r.data);
      setDaily(d.data);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [agentId]);

  useEffect(() => { load(); }, [load]);

  const filtered = statusFilter === 'all' ? runs : runs.filter(r => r.status === statusFilter);
  const shimmer = 'bg-[linear-gradient(90deg,#f1f5f9_25%,#e2e8f0_50%,#f1f5f9_75%)] bg-[length:400%_100%] animate-[shimmer_1.4s_ease-in-out_infinite] rounded';

  return (
    <div>
      {/* Mini activity chart */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 mb-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[14px] font-bold text-slate-900 m-0">Run Activity (14 days)</h3>
          <span className="text-[12px] text-slate-400">{daily.reduce((s, d) => s + d.total, 0)} total</span>
        </div>
        {loading
          ? <div className={`h-[100px] ${shimmer}`} />
          : <RunActivityChart data={daily} height={100} />
        }
      </div>

      {/* Status filter tabs */}
      <div className="flex gap-1 mb-4">
        {['all', 'completed', 'failed', 'running', 'timeout'].map(s => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold border-0 cursor-pointer transition-colors [font-family:inherit] capitalize ${
              statusFilter === s
                ? 'bg-indigo-100 text-indigo-700'
                : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
            }`}
          >
            {s === 'all' ? `All (${runs.length})` : s.replace(/_/g, ' ')}
          </button>
        ))}
      </div>

      {/* Runs table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/50">
              <th className="text-left px-4 py-3 text-[11px] font-bold text-slate-400 uppercase tracking-wider">Run</th>
              <th className="text-left px-4 py-3 text-[11px] font-bold text-slate-400 uppercase tracking-wider">Client</th>
              <th className="text-left px-4 py-3 text-[11px] font-bold text-slate-400 uppercase tracking-wider">Status</th>
              <th className="text-right px-4 py-3 text-[11px] font-bold text-slate-400 uppercase tracking-wider">Tokens</th>
              <th className="text-right px-4 py-3 text-[11px] font-bold text-slate-400 uppercase tracking-wider">Duration</th>
              <th className="text-right px-4 py-3 text-[11px] font-bold text-slate-400 uppercase tracking-wider">When</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {loading ? (
              [...Array(5)].map((_, i) => (
                <tr key={i}>
                  {[...Array(6)].map((_, j) => (
                    <td key={j} className="px-4 py-3">
                      <div className={`h-4 ${shimmer}`} style={{ width: j === 0 ? '80px' : j === 1 ? '100px' : '70px' }} />
                    </td>
                  ))}
                </tr>
              ))
            ) : filtered.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400 text-sm">No runs yet</td></tr>
            ) : (
              filtered.map(run => (
                <tr key={run.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3">
                    <Link
                      to={`/admin/subaccounts/${run.subaccountId}/runs/${run.id}`}
                      className="font-mono text-[12px] text-indigo-600 hover:text-indigo-700 no-underline"
                    >
                      {run.id.substring(0, 8)}
                    </Link>
                    <div className="text-[11px] text-slate-400 capitalize">{run.runType}</div>
                  </td>
                  <td className="px-4 py-3 text-[13px] text-slate-600">{run.subaccountName}</td>
                  <td className="px-4 py-3"><RunStatusBadge status={run.status} /></td>
                  <td className="px-4 py-3 text-right text-[13px] text-slate-500">{run.totalTokens.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right text-[13px] text-slate-500">
                    {run.durationMs != null ? `${(run.durationMs / 1000).toFixed(1)}s` : '—'}
                  </td>
                  <td className="px-4 py-3 text-right text-[12px] text-slate-400">
                    {new Date(run.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Agent Usage Tab ─────────────────────────────────────────────────────────

interface AgentMonthlyUsage {
  entityId: string;
  totalCostCents: number;
  requestCount: number;
  tokensIn?: number;
  tokensOut?: number;
}

function AgentUsageTab({ agentId }: { agentId: string }) {
  const thisMonth = new Date().toISOString().slice(0, 7);
  const [month, setMonth] = useState(thisMonth);
  const [usage, setUsage] = useState<AgentMonthlyUsage | null>(null);
  const [loading, setLoading] = useState(true);

  const prevMonth = (ym: string) => {
    const [y, m] = ym.split('-').map(Number);
    const d = new Date(y, m - 2, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  };
  const nextMonth = (ym: string) => {
    const [y, m] = ym.split('-').map(Number);
    const d = new Date(y, m, 1);
    const now = new Date();
    const nowStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const next = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    return next > nowStr ? nowStr : next;
  };
  const monthLabel = (ym: string) => {
    const [y, m] = ym.split('-');
    return new Date(Number(y), Number(m) - 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  };
  const fmt = (c: number | null | undefined) => {
    if (c == null) return '—';
    return `$${(c / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };
  const fmtTok = (n: number | null | undefined) => {
    if (n == null) return '—';
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
    return String(n);
  };

  useEffect(() => {
    setLoading(true);
    // Agent aggregates are keyed as "orgId:agentId" — fetch via org usage agents endpoint
    // and find this agent's row
    api.get('/api/agent-activity/stats', { params: { sinceDays: 30 } })
      .then(() => {})
      .catch(() => {});

    // Use the cost aggregates scoped to this agent via the invoice-style query
    // We'll query the org usage/agents list and look for matching agentId pattern
    // Since agent cost aggregates use entityId = "orgId:agentId", we use the subaccount billing
    // endpoint isn't ideal here — instead surface what we can via stats
    setUsage(null);
    setLoading(false);
  }, [agentId, month]);

  const shimmer = 'bg-[linear-gradient(90deg,#f1f5f9_25%,#e2e8f0_50%,#f1f5f9_75%)] bg-[length:400%_100%] animate-[shimmer_1.4s_ease-in-out_infinite] rounded';

  return (
    <div>
      {/* Month navigator */}
      <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-3 py-2 mb-6 w-fit">
        <button onClick={() => setMonth(m => prevMonth(m))}
          className="text-slate-400 hover:text-slate-700 bg-transparent border-0 cursor-pointer p-0.5">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <span className="text-[13px] font-semibold text-slate-700 min-w-[130px] text-center">{monthLabel(month)}</span>
        <button onClick={() => setMonth(m => nextMonth(m))} disabled={month >= thisMonth}
          className="text-slate-400 hover:text-slate-700 bg-transparent border-0 cursor-pointer p-0.5 disabled:opacity-30">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <p className="text-[13px] text-slate-500 mb-4">
          Agent-level cost data is aggregated across all clients. To see a breakdown by client, go to the client's
          {' '}<strong>Usage & Costs</strong> page and filter by this agent.
        </p>
        {loading ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => <div key={i} className={`h-5 ${shimmer}`} />)}
          </div>
        ) : (
          <div className="text-[13px] text-slate-400 italic">
            Detailed per-agent cost breakdown coming soon. Use the client Usage pages for now.
          </div>
        )}
      </div>
    </div>
  );
}
