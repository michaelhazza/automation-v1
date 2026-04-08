import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import api from '../lib/api';
import { User } from '../lib/auth';
import ConfirmDialog from '../components/ConfirmDialog';
import { RunActivityChart } from '../components/ActivityCharts';
import { SkillPickerSection } from '../components/SkillPickerSection';
import type { AvailableSkill } from '../components/SkillPickerSection';

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
  heartbeatOffsetMinutes: number;
  concurrencyPolicy: 'skip_if_active' | 'coalesce_if_active' | 'always_enqueue';
  catchUpPolicy: 'skip_missed' | 'enqueue_missed_with_cap';
  catchUpCap: number;
  maxConcurrentRuns: number;
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
  heartbeatOffsetHours: 9,
  heartbeatOffsetMinutes: 0,
  concurrencyPolicy: 'skip_if_active',
  catchUpPolicy: 'skip_missed',
  catchUpCap: 3,
  maxConcurrentRuns: 1,
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
function HeartbeatTimeline({ agentName, intervalHours, offsetHours, offsetMinutes = 0 }: { agentName: string; intervalHours: number; offsetHours: number; offsetMinutes?: number }) {
  const startMins = offsetHours * 60 + offsetMinutes;
  const runMins: number[] = [];
  for (let m = startMins; m < 24 * 60; m += intervalHours * 60) runMins.push(m);

  const fmtMin = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

  return (
    <div className="bg-slate-50 border border-slate-200 rounded-[10px] px-[18px] py-[14px]">
      <div className="flex items-center gap-3 mb-1">
        <span className="text-xs font-semibold text-gray-700 w-[130px] shrink-0 overflow-hidden text-ellipsis whitespace-nowrap">
          {agentName}
        </span>
        <span className="text-[11px] text-slate-400 w-[70px] shrink-0">every {intervalHours}h</span>
        {/* SVG timeline */}
        <svg width="100%" height="28" viewBox="0 0 480 28" preserveAspectRatio="none" className="flex-1 min-w-0">
          <line x1="0" y1="14" x2="480" y2="14" stroke="#d1d5db" strokeWidth="1.5" />
          {[0, 4, 8, 12, 16, 20, 24].map((h) => (
            <line key={h} x1={h / 24 * 480} y1="10" x2={h / 24 * 480} y2="18" stroke="#d1d5db" strokeWidth="1" />
          ))}
          {runMins.map((m) => (
            <circle key={m} cx={m / (24 * 60) * 480} cy="14" r="5" fill="#6366f1" />
          ))}
        </svg>
      </div>
      <div className="flex justify-between pl-[202px] text-[10px] text-slate-400 mt-0.5">
        {[0, 4, 8, 12, 16, 20, 24].map((h) => (
          <span key={h}>{h === 24 ? '' : `${h}h`}</span>
        ))}
      </div>
      <div className="mt-2.5 pl-[202px] text-xs text-indigo-500 font-medium">
        Runs at: {runMins.map(fmtMin).join('  ·  ')}
      </div>
    </div>
  );
}

function SectionCard({ title, subtitle, headerAction, children }: { title: string; subtitle?: string; headerAction?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-[10px] border border-slate-200 mb-5">
      <div className="px-5 py-4 border-b border-slate-100 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="m-0 text-[15px] font-semibold text-slate-900">{title}</h2>
          {subtitle && <p className="m-0 mt-1 text-xs text-slate-500">{subtitle}</p>}
        </div>
        {headerAction && <div className="shrink-0">{headerAction}</div>}
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
  const [agentTab, setAgentTab] = useState<'config' | 'behaviour' | 'capabilities' | 'scheduling' | 'runs' | 'budget'>('config');
  const [showPromptHistory, setShowPromptHistory] = useState(false);

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
        heartbeatOffsetHours: data.heartbeatOffsetHours ?? 9,
        heartbeatOffsetMinutes: data.heartbeatOffsetMinutes ?? 0,
        concurrencyPolicy: data.concurrencyPolicy ?? 'skip_if_active',
        catchUpPolicy: data.catchUpPolicy ?? 'skip_missed',
        catchUpCap: data.catchUpCap ?? 3,
        maxConcurrentRuns: data.maxConcurrentRuns ?? 1,
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
    api.get('/api/skills/all').then(({ data }) => setAvailableSkills(data)).catch((err) => console.error('[AdminAgentEdit] Failed to fetch skills:', err));
    // Load all org agents for the parent dropdown
    api.get('/api/agents').then(({ data }) => setAllOrgAgents(data.map((a: { id: string; name: string }) => ({ id: a.id, name: a.name })))).catch((err) => console.error('[AdminAgentEdit] Failed to fetch agents:', err));
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

  const agentInitial = agent?.name ? agent.name[0].toUpperCase() : (form.name ? form.name[0].toUpperCase() : '?');

  return (
    <>
      {/* ── Breadcrumb ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1.5 text-[13px] text-slate-400 mb-5">
        <Link to="/admin/agents" className="text-slate-400 no-underline hover:text-indigo-600 transition-colors">
          Agents
        </Link>
        <span>›</span>
        <span className="text-slate-600 font-medium">{isNew ? 'New Agent' : (agent?.name ?? '')}</span>
        {!isNew && (
          <>
            <span>›</span>
            <span className="text-slate-500 capitalize">{agentTab === 'config' ? 'Configuration' : agentTab}</span>
          </>
        )}
      </div>

      {/* ── Agent header ───────────────────────────────────────────────── */}
      <div className="flex items-start justify-between pb-5 border-b border-slate-200 mb-0">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-xl bg-indigo-100 flex items-center justify-center text-2xl shrink-0 border border-indigo-200">
            {form.icon || <span className="text-indigo-500 font-bold text-[22px]">{agentInitial}</span>}
          </div>
          <div>
            <div className="flex items-center gap-2.5 mb-0.5">
              <h1 className="m-0 text-[22px] font-bold text-slate-900 leading-tight">
                {isNew ? 'New Agent' : (agent?.name ?? '')}
              </h1>
              {!isNew && agent?.agentRole && (
                <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium capitalize ${
                  agent.agentRole === 'orchestrator' ? 'bg-purple-100 text-purple-700' :
                  agent.agentRole === 'specialist' ? 'bg-blue-100 text-blue-700' :
                  'bg-slate-100 text-slate-600'
                }`}>{agent.agentRole}</span>
              )}
              {!isNew && agent && <StatusBadge status={agent.status} />}
            </div>
            {!isNew && agent && (
              <p className="m-0 text-[13px] text-slate-500">
                {form.description || `Created ${new Date(agent.createdAt).toLocaleDateString()}`}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {!isNew && agent && agent.status !== 'active' && (
            <button
              onClick={handleActivate}
              disabled={statusLoading}
              className="px-4 py-2 bg-white border border-slate-200 text-slate-700 hover:bg-green-50 hover:border-green-200 hover:text-green-700 rounded-lg text-[13px] font-medium cursor-pointer transition-colors disabled:opacity-60 border-solid"
            >
              Activate
            </button>
          )}
          {!isNew && agent && agent.status === 'active' && (
            <button
              onClick={handleDeactivate}
              disabled={statusLoading}
              className="px-4 py-2 bg-white border border-slate-200 text-slate-700 hover:bg-orange-50 hover:border-orange-200 hover:text-orange-700 rounded-lg text-[13px] font-medium cursor-pointer transition-colors disabled:opacity-60 border-solid"
            >
              Deactivate
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={saving}
            className={`px-5 py-2 text-white border-0 rounded-lg text-[13px] font-medium transition-colors ${saving ? 'bg-slate-400 cursor-default' : 'bg-indigo-600 hover:bg-indigo-700 cursor-pointer'}`}
          >
            {saving ? 'Saving...' : isNew ? 'Create Agent' : 'Save Changes'}
          </button>
        </div>
      </div>

      {/* ── Tab bar ────────────────────────────────────────────────────── */}
      {!isNew && (
        <div className="flex gap-0 border-b border-slate-200 mt-5 mb-6">
          {([
            ['config', 'Configuration'],
            ['behaviour', 'Behaviour'],
            ['capabilities', 'Capabilities'],
            ['scheduling', 'Scheduling'],
            ['runs', 'Runs'],
            ['budget', 'Budget'],
          ] as const).map(([t, label]) => (
            <button
              key={t}
              onClick={() => setAgentTab(t)}
              className={`px-4 py-2.5 text-[13px] font-medium border-0 bg-transparent cursor-pointer transition-colors border-b-2 -mb-px [font-family:inherit] ${
                agentTab === t
                  ? 'text-indigo-600 border-indigo-500'
                  : 'text-slate-500 border-transparent hover:text-slate-800'
              }`}
            >
              {label}
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

      {/* ── Section 1: Basic Info (incl. Hierarchy) ── */}
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
          {/* Hierarchy fields — small, identity-related, folded in here */}
          {!isNew && <>
            <Field label="Reports to" hint="Position this agent in your organisation's agent hierarchy.">
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
            <Field label="Title">
              <input
                value={form.agentTitle}
                onChange={(e) => setForm({ ...form, agentTitle: e.target.value })}
                className={inputCls}
                placeholder="e.g. Head of Research"
              />
            </Field>
          </>}
        </div>
      </SectionCard>

      {/* ── Section 2: Agent Prompt ── */}
      {agent?.isSystemManaged ? (
        <SectionCard
          title="Agent Prompt"
          headerAction={!isNew && id ? (
            <button
              type="button"
              onClick={() => setShowPromptHistory(true)}
              className="px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg text-[12px] font-medium cursor-pointer transition-colors [font-family:inherit]"
            >
              View History
            </button>
          ) : undefined}
        >
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
        <SectionCard
          title="Agent Prompt"
          headerAction={!isNew && id ? (
            <button
              type="button"
              onClick={() => setShowPromptHistory(true)}
              className="px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg text-[12px] font-medium cursor-pointer transition-colors [font-family:inherit]"
            >
              View History
            </button>
          ) : undefined}
        >
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

      </> /* end Configuration tab */}

      {/* ── Behaviour tab ───────────────────────────────────────────────── */}
      {!isNew && agentTab === 'behaviour' && <>
      {/* ── Section: Model Configuration ── */}
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
      </> /* end Behaviour tab */}

      {/* ── Capabilities tab ────────────────────────────────────────────── */}
      {!isNew && agentTab === 'capabilities' && <>
      {/* ── Section: Skills ── */}
      <SkillPickerSection
        selectedSlugs={form.defaultSkillSlugs}
        availableSkills={availableSkills}
        onChange={(slugs) => setForm({ ...form, defaultSkillSlugs: slugs })}
      />

      {/* ── Section: Data Sources ── */}
      {deleteDsId && (
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
      </> /* end Capabilities tab */}

      {/* ── Scheduling tab ──────────────────────────────────────────────── */}
      {!isNew && agentTab === 'scheduling' && <>
      {/* ── Section: Schedule & Concurrency (combined) ── */}
      <SectionCard
        title="Schedule & Concurrency"
        subtitle="When the agent runs, how often, and how overlapping or missed runs are handled. The schedule runs in the company's timezone."
      >
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
          <div className="flex flex-wrap items-end gap-5">
            {/* Start time */}
            <div>
              <div className="text-[13px] font-semibold text-gray-700 mb-1.5">Start time</div>
              <div className="flex items-center gap-1.5">
                <select
                  value={form.heartbeatOffsetHours}
                  onChange={(e) => setForm({ ...form, heartbeatOffsetHours: Number(e.target.value) })}
                  className={`${inputCls} w-[80px]`}
                >
                  {Array.from({ length: 24 }, (_, i) => (
                    <option key={i} value={i}>{String(i).padStart(2, '0')}</option>
                  ))}
                </select>
                <span className="text-slate-400">:</span>
                <select
                  value={form.heartbeatOffsetMinutes}
                  onChange={(e) => setForm({ ...form, heartbeatOffsetMinutes: Number(e.target.value) })}
                  className={`${inputCls} w-[80px]`}
                >
                  {[0, 15, 30, 45].map((m) => (
                    <option key={m} value={m}>{String(m).padStart(2, '0')}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Interval */}
            <div>
              <div className="text-[13px] font-semibold text-gray-700 mb-1.5">Repeat every</div>
              <div className="flex gap-2 flex-wrap">
                {([1, 2, 3, 4, 6, 8, 12, 24] as const).map((h) => (
                  <button
                    key={h}
                    type="button"
                    onClick={() => setForm({ ...form, heartbeatIntervalHours: h })}
                    className={`px-3 py-1.5 rounded-lg border text-[13px] font-medium cursor-pointer transition-all duration-100 ${
                      form.heartbeatIntervalHours === h
                        ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                        : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
                    }`}
                  >
                    {h === 24 ? '1 day' : `${h}h`}
                  </button>
                ))}
              </div>
            </div>

            {/* Timeline preview */}
            {form.heartbeatIntervalHours && (
              <div className="w-full">
                <div className="text-[13px] font-semibold text-gray-700 mb-2.5">Schedule preview (24h)</div>
                <HeartbeatTimeline
                  agentName={form.name || 'This agent'}
                  intervalHours={form.heartbeatIntervalHours}
                  offsetHours={form.heartbeatOffsetHours}
                  offsetMinutes={form.heartbeatOffsetMinutes}
                />
              </div>
            )}
          </div>
        )}

        {/* Divider before concurrency controls */}
        <div className="border-t border-slate-100 my-6" />
        <div className="text-[13px] font-semibold text-slate-700 mb-1">Concurrency</div>
        <div className="text-xs text-slate-500 mb-4">Control how overlapping and missed runs are handled.</div>

        <div className="flex flex-wrap gap-5">
          {/* Concurrency Policy */}
          <div className="min-w-[220px]">
            <div className="text-[13px] font-semibold text-gray-700 mb-1.5">Concurrency Policy</div>
            <select
              value={form.concurrencyPolicy}
              onChange={(e) => setForm({ ...form, concurrencyPolicy: e.target.value as AgentForm['concurrencyPolicy'] })}
              className={`${inputCls} w-full`}
            >
              <option value="skip_if_active">Skip if active</option>
              <option value="coalesce_if_active">Queue one (coalesce)</option>
              <option value="always_enqueue">Queue all</option>
            </select>
            <div className="text-xs text-slate-400 mt-1">
              {form.concurrencyPolicy === 'skip_if_active' && 'New runs are dropped while the agent is already running.'}
              {form.concurrencyPolicy === 'coalesce_if_active' && 'At most one run is queued while the agent is active.'}
              {form.concurrencyPolicy === 'always_enqueue' && 'Every triggered run is queued and executed in order.'}
            </div>
          </div>

          {/* Catch-up Policy */}
          <div className="min-w-[220px]">
            <div className="text-[13px] font-semibold text-gray-700 mb-1.5">Catch-up Policy</div>
            <select
              value={form.catchUpPolicy}
              onChange={(e) => setForm({ ...form, catchUpPolicy: e.target.value as AgentForm['catchUpPolicy'] })}
              className={`${inputCls} w-full`}
            >
              <option value="skip_missed">Skip missed</option>
              <option value="enqueue_missed_with_cap">Catch up with cap</option>
            </select>
            <div className="text-xs text-slate-400 mt-1">
              {form.catchUpPolicy === 'skip_missed' && 'Missed heartbeats are skipped — the next run starts at the next scheduled time.'}
              {form.catchUpPolicy === 'enqueue_missed_with_cap' && `Up to ${form.catchUpCap} missed runs will be queued and executed.`}
            </div>
          </div>

          {/* Catch-up Cap (only shown when catch-up policy is enqueue_missed_with_cap) */}
          {form.catchUpPolicy === 'enqueue_missed_with_cap' && (
            <div className="min-w-[140px]">
              <div className="text-[13px] font-semibold text-gray-700 mb-1.5">Catch-up Cap</div>
              <input
                type="number"
                min={1}
                max={100}
                value={form.catchUpCap}
                onChange={(e) => setForm({ ...form, catchUpCap: Math.max(1, Math.min(100, Number(e.target.value) || 1)) })}
                className={`${inputCls} w-[100px]`}
              />
              <div className="text-xs text-slate-400 mt-1">Max missed runs to catch up on.</div>
            </div>
          )}

          {/* Max Concurrent Runs */}
          <div className="min-w-[140px]">
            <div className="text-[13px] font-semibold text-gray-700 mb-1.5">Max Concurrent Runs</div>
            <input
              type="number"
              min={1}
              max={10}
              value={form.maxConcurrentRuns}
              onChange={(e) => setForm({ ...form, maxConcurrentRuns: Math.max(1, Math.min(10, Number(e.target.value) || 1)) })}
              className={`${inputCls} w-[100px]`}
            />
            <div className="text-xs text-slate-400 mt-1">How many runs can execute simultaneously (1–10).</div>
          </div>
        </div>
      </SectionCard>
      </> /* end Scheduling tab */}

      {/* For new agents, show a Create button under the form (no tabs) */}
      {isNew && (
        <div className="flex gap-3 mb-7">
          <button
            onClick={handleSave}
            disabled={saving}
            className={`px-6 py-2.5 text-white border-none rounded-lg text-[14px] font-semibold transition-colors ${saving ? 'bg-indigo-300 cursor-not-allowed' : 'bg-indigo-500 cursor-pointer'}`}
          >
            {saving ? 'Creating...' : 'Create Agent'}
          </button>
          <button
            onClick={() => navigate('/admin/agents')}
            className="px-5 py-2.5 bg-slate-100 text-gray-700 border-none rounded-lg text-[14px] cursor-pointer"
          >
            Cancel
          </button>
        </div>
      )}

      {/* ── Runs tab ────────────────────────────────────────────────────── */}
      {!isNew && agentTab === 'runs' && id && <AgentRunsTab agentId={id} />}

      {/* ── Budget tab ──────────────────────────────────────────────────── */}
      {!isNew && agentTab === 'budget' && id && <AgentBudgetTab agentId={id} />}

      {/* ── Prompt history dialog (opened from the Agent Prompt section) ── */}
      {!isNew && id && showPromptHistory && (
        <PromptHistoryDialog
          agentId={id}
          onClose={() => setShowPromptHistory(false)}
          onRollback={() => loadAgent(id)}
        />
      )}

    </>
  );
}

// ─── Agent Runs Tab ──────────────────────────────────────────────────────────

interface RunRow {
  id: string; agentName: string; subaccountName: string; runType: string;
  status: string; totalTokens: number; inputTokens: number; outputTokens: number;
  totalToolCalls: number; durationMs: number | null; createdAt: string;
  subaccountId: string; startedAt: string | null; completedAt: string | null;
  tasksCreated: number; tasksUpdated: number; summary: string | null;
  tokenBudget: number;
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

function fmtTokens(n: number | null | undefined) {
  if (n == null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function fmtDuration(ms: number | null | undefined) {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s % 60);
  return `${m}m ${rem}s`;
}

function fmtTime(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function AgentRunsTab({ agentId }: { agentId: string }) {
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [daily, setDaily] = useState<{ date: string; completed: number; failed: number; timeout: number; other: number; total: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [runCosts, setRunCosts] = useState<Record<string, number>>({});

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

  // Fetch cost for expanded run
  useEffect(() => {
    if (!expandedId || runCosts[expandedId] !== undefined) return;
    api.get(`/api/runs/${expandedId}/cost`)
      .then(r => setRunCosts(prev => ({ ...prev, [expandedId]: r.data.totalCostCents ?? 0 })))
      .catch(() => setRunCosts(prev => ({ ...prev, [expandedId]: 0 })));
  }, [expandedId, runCosts]);

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

      {/* Runs list */}
      <div className="space-y-2">
        {loading ? (
          [...Array(5)].map((_, i) => <div key={i} className={`h-16 ${shimmer}`} />)
        ) : filtered.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl px-4 py-10 text-center text-slate-400 text-sm">No runs yet</div>
        ) : (
          filtered.map(run => {
            const isExpanded = expandedId === run.id;
            const costCents = runCosts[run.id];
            return (
              <div key={run.id} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                {/* Run summary row */}
                <button
                  onClick={() => setExpandedId(isExpanded ? null : run.id)}
                  className="w-full flex items-center gap-4 px-4 py-3 bg-transparent border-0 cursor-pointer hover:bg-slate-50 transition-colors text-left [font-family:inherit]"
                >
                  <Link
                    to={`/admin/subaccounts/${run.subaccountId}/runs/${run.id}`}
                    onClick={e => e.stopPropagation()}
                    className="font-mono text-[12px] text-indigo-600 hover:text-indigo-700 no-underline min-w-[70px]"
                  >
                    {run.id.substring(0, 8)}
                  </Link>
                  <span className="text-[11px] text-slate-400 capitalize min-w-[65px]">{run.runType}</span>
                  <RunStatusBadge status={run.status} />
                  <span className="text-[12px] text-slate-500 ml-auto">{fmtTokens(run.totalTokens)} tok</span>
                  <span className="text-[12px] text-slate-500 min-w-[55px] text-right">{fmtDuration(run.durationMs)}</span>
                  <span className="text-[11px] text-slate-400 min-w-[100px] text-right">
                    {new Date(run.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                    className={`text-slate-300 transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="border-t border-slate-100 px-4 py-4 bg-slate-50/50">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                      <div>
                        <div className="text-[11px] text-slate-400 uppercase tracking-wider mb-1">Status</div>
                        <RunStatusBadge status={run.status} />
                      </div>
                      <div>
                        <div className="text-[11px] text-slate-400 uppercase tracking-wider mb-1">Duration</div>
                        <div className="text-[13px] text-slate-700 font-medium">{fmtDuration(run.durationMs)}</div>
                        <div className="text-[11px] text-slate-400">
                          {fmtTime(run.startedAt)} → {fmtTime(run.completedAt)}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] text-slate-400 uppercase tracking-wider mb-1">Cost</div>
                        <div className="text-[13px] text-slate-700 font-medium">
                          {costCents !== undefined ? `$${(costCents / 100).toFixed(4)}` : '...'}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] text-slate-400 uppercase tracking-wider mb-1">Tool Calls</div>
                        <div className="text-[13px] text-slate-700 font-medium">{run.totalToolCalls}</div>
                      </div>
                    </div>

                    {/* Token breakdown */}
                    <div className="grid grid-cols-3 gap-4 mb-4">
                      <div className="bg-white rounded-lg border border-slate-200 p-3">
                        <div className="text-[11px] text-slate-400 uppercase tracking-wider">Input</div>
                        <div className="text-[15px] font-semibold text-slate-800">{fmtTokens(run.inputTokens)}</div>
                      </div>
                      <div className="bg-white rounded-lg border border-slate-200 p-3">
                        <div className="text-[11px] text-slate-400 uppercase tracking-wider">Output</div>
                        <div className="text-[15px] font-semibold text-slate-800">{fmtTokens(run.outputTokens)}</div>
                      </div>
                      <div className="bg-white rounded-lg border border-slate-200 p-3">
                        <div className="text-[11px] text-slate-400 uppercase tracking-wider">Budget</div>
                        <div className="text-[15px] font-semibold text-slate-800">{fmtTokens(run.tokenBudget)}</div>
                      </div>
                    </div>

                    {/* Issues touched */}
                    {(run.tasksCreated > 0 || run.tasksUpdated > 0) && (
                      <div className="mb-3">
                        <div className="text-[11px] text-slate-400 uppercase tracking-wider mb-1">Issues Touched</div>
                        <div className="text-[13px] text-slate-600">
                          {run.tasksCreated > 0 && <span className="mr-3">{run.tasksCreated} created</span>}
                          {run.tasksUpdated > 0 && <span>{run.tasksUpdated} updated</span>}
                        </div>
                      </div>
                    )}

                    {/* Summary */}
                    {run.summary && (
                      <div>
                        <div className="text-[11px] text-slate-400 uppercase tracking-wider mb-1">Summary</div>
                        <div className="text-[13px] text-slate-600 leading-relaxed">{run.summary}</div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ─── Agent Budget Tab ────────────────────────────────────────────────────────

interface AgentBudgetData {
  period: string;
  spend: {
    totalCostCents: number;
    requestCount: number;
    totalTokensIn: number;
    totalTokensOut: number;
    errorCount: number;
  };
  config: {
    maxCostPerRunCents: number | null;
    maxLlmCallsPerRun: number | null;
    tokenBudgetPerRun: number;
  };
  limits: {
    monthlyCostLimitCents: number | null;
    dailyCostLimitCents: number | null;
    alertThresholdPct: number | null;
  } | null;
}

function AgentBudgetTab({ agentId }: { agentId: string }) {
  const { subaccountId } = useParams();
  const thisMonth = new Date().toISOString().slice(0, 7);
  const [month, setMonth] = useState(thisMonth);
  const [data, setData] = useState<AgentBudgetData | null>(null);
  const [loading, setLoading] = useState(true);
  const [budgetInput, setBudgetInput] = useState('');
  const [saving, setSaving] = useState(false);

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
  const fmtCost = (c: number | null | undefined) => {
    if (c == null || c === 0) return '$0.00';
    return `$${(c / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  // Find first subaccount from runs (the budget endpoint needs subaccountId)
  const [resolvedSubaccountId, setResolvedSubaccountId] = useState<string | null>(subaccountId || null);

  useEffect(() => {
    if (resolvedSubaccountId) return;
    api.get('/api/agent-activity', { params: { agentId, limit: 1 } })
      .then(r => {
        if (r.data.length > 0) setResolvedSubaccountId(r.data[0].subaccountId);
      })
      .catch(() => {});
  }, [agentId, resolvedSubaccountId]);

  useEffect(() => {
    if (!resolvedSubaccountId) { setLoading(false); return; }
    setLoading(true);
    api.get(`/api/subaccounts/${resolvedSubaccountId}/agents/${agentId}/budget`, { params: { month } })
      .then(r => {
        setData(r.data);
        setBudgetInput(r.data.config.maxCostPerRunCents ? String(r.data.config.maxCostPerRunCents / 100) : '');
      })
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [agentId, resolvedSubaccountId, month]);

  const handleSaveBudget = async () => {
    if (!resolvedSubaccountId) return;
    setSaving(true);
    try {
      const cents = budgetInput ? Math.round(parseFloat(budgetInput) * 100) : null;
      await api.put(`/api/subaccounts/${resolvedSubaccountId}/agents/${agentId}/budget`, {
        maxCostPerRunCents: cents,
      });
      // Refresh
      const r = await api.get(`/api/subaccounts/${resolvedSubaccountId}/agents/${agentId}/budget`, { params: { month } });
      setData(r.data);
    } catch { /* ignore */ }
    finally { setSaving(false); }
  };

  const shimmer = 'bg-[linear-gradient(90deg,#f1f5f9_25%,#e2e8f0_50%,#f1f5f9_75%)] bg-[length:400%_100%] animate-[shimmer_1.4s_ease-in-out_infinite] rounded';

  if (!resolvedSubaccountId && !loading) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-6 text-center text-slate-400 text-[13px]">
        This agent is not linked to any client yet. Link it to a client to view budget data.
      </div>
    );
  }

  const spend = data?.spend;
  const config = data?.config;
  const limits = data?.limits;
  const monthlyLimit = limits?.monthlyCostLimitCents;
  const spentCents = spend?.totalCostCents ?? 0;
  const budgetPct = monthlyLimit ? Math.min((spentCents / monthlyLimit) * 100, 100) : 0;
  const isHealthy = !monthlyLimit || spentCents < monthlyLimit * (limits?.alertThresholdPct ?? 80) / 100;

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

      {loading ? (
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => <div key={i} className={`h-24 ${shimmer}`} />)}
        </div>
      ) : (
        <>
          {/* Health status + observed spend */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="text-[11px] text-slate-400 uppercase tracking-wider font-bold">Observed</div>
                <div className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${isHealthy ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                  {isHealthy ? 'HEALTHY' : 'WARNING'}
                </div>
              </div>
              <div className="text-[28px] font-bold text-slate-900">{fmtCost(spentCents)}</div>
              <div className="text-[12px] text-slate-400 mt-1">
                {spend?.requestCount ?? 0} requests / {spend?.errorCount ?? 0} errors
              </div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="text-[11px] text-slate-400 uppercase tracking-wider font-bold mb-3">Budget</div>
              <div className="text-[28px] font-bold text-slate-900">
                {monthlyLimit ? fmtCost(monthlyLimit) : 'Disabled'}
              </div>
              <div className="text-[12px] text-slate-400 mt-1">
                {monthlyLimit ? `Soft alert at ${limits?.alertThresholdPct ?? 80}%` : 'No cap configured'}
              </div>
            </div>
          </div>

          {/* Progress bar */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 mb-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[12px] text-slate-500">Remaining</span>
              <span className="text-[12px] text-slate-500">
                {monthlyLimit ? fmtCost(Math.max(0, monthlyLimit - spentCents)) : 'Unlimited'}
              </span>
            </div>
            <div className="w-full bg-slate-100 rounded-full h-2.5">
              <div
                className={`h-2.5 rounded-full transition-all ${budgetPct > 80 ? 'bg-amber-500' : 'bg-indigo-500'}`}
                style={{ width: monthlyLimit ? `${budgetPct}%` : '0%' }}
              />
            </div>
          </div>

          {/* Token breakdown */}
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="text-[11px] text-slate-400 uppercase tracking-wider">Input Tokens</div>
              <div className="text-[18px] font-semibold text-slate-800 mt-1">{fmtTokens(spend?.totalTokensIn)}</div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="text-[11px] text-slate-400 uppercase tracking-wider">Output Tokens</div>
              <div className="text-[18px] font-semibold text-slate-800 mt-1">{fmtTokens(spend?.totalTokensOut)}</div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="text-[11px] text-slate-400 uppercase tracking-wider">Per-Run Budget</div>
              <div className="text-[18px] font-semibold text-slate-800 mt-1">{fmtTokens(config?.tokenBudgetPerRun)}</div>
            </div>
          </div>

          {/* Set budget */}
          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="text-[11px] text-slate-400 uppercase tracking-wider font-bold mb-3">Max Cost Per Run (USD)</div>
            <div className="flex gap-3 items-center">
              <input
                type="number"
                step="0.01"
                min="0"
                value={budgetInput}
                onChange={e => setBudgetInput(e.target.value)}
                placeholder="0.00"
                className="w-48 px-3 py-2 rounded-lg border border-slate-200 text-[13px] text-slate-700 [font-family:inherit] focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400"
              />
              <button
                onClick={handleSaveBudget}
                disabled={saving}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-[13px] font-semibold border-0 cursor-pointer hover:bg-indigo-700 transition-colors disabled:opacity-50 [font-family:inherit]"
              >
                {saving ? 'Saving...' : 'Set budget'}
              </button>
            </div>
            <p className="text-[12px] text-slate-400 mt-2">
              Leave empty to disable per-run cost cap. Monthly limits are configured at the workspace level.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Prompt History Tab ──────────────────────────────────────────────────────

interface PromptRevision {
  id: string;
  revisionNumber: number;
  masterPrompt: string;
  additionalPrompt: string;
  changeDescription: string | null;
  changedBy: string | null;
  createdAt: string;
}

// Modal wrapper around PromptHistoryTab — opened from the Agent Prompt section.
function PromptHistoryDialog({ agentId, onClose, onRollback }: { agentId: string; onClose: () => void; onRollback: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-6"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl border border-slate-200 shadow-xl w-full max-w-[900px] max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
          <h2 className="m-0 text-[15px] font-semibold text-slate-900">Prompt History</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 border-0 bg-transparent cursor-pointer text-[18px] leading-none"
          >
            ×
          </button>
        </div>
        <div className="p-5 overflow-auto">
          <PromptHistoryTab agentId={agentId} onRollback={onRollback} />
        </div>
      </div>
    </div>
  );
}

function PromptHistoryTab({ agentId, onRollback }: { agentId: string; onRollback: () => void }) {
  const [revisions, setRevisions] = useState<PromptRevision[]>([]);
  const [loading, setLoading] = useState(true);
  const [rollingBack, setRollingBack] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/api/agents/${agentId}/prompt-revisions`, { params: { limit: 50 } });
      setRevisions(data);
    } catch {
      setError('Failed to load prompt revisions.');
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => { load(); }, [load]);

  const handleRollback = async (revisionId: string, revisionNumber: number) => {
    if (!confirm(`Roll back to revision #${revisionNumber}? This will update the agent's prompts and create a new revision.`)) return;
    setRollingBack(revisionId);
    setError('');
    setSuccess('');
    try {
      await api.post(`/api/agents/${agentId}/prompt-revisions/${revisionId}/rollback`);
      setSuccess(`Rolled back to revision #${revisionNumber}.`);
      load();
      onRollback();
    } catch {
      setError('Failed to rollback.');
    } finally {
      setRollingBack(null);
    }
  };

  const shimmer = 'bg-[linear-gradient(90deg,#f1f5f9_25%,#e2e8f0_50%,#f1f5f9_75%)] bg-[length:400%_100%] animate-[shimmer_1.4s_ease-in-out_infinite] rounded';

  if (loading) {
    return (
      <div className="space-y-3">
        {[...Array(4)].map((_, i) => <div key={i} className={`h-14 ${shimmer}`} />)}
      </div>
    );
  }

  return (
    <div>
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-3.5 py-2.5 mb-4 text-red-700 text-[13px] flex justify-between items-center">
          {error}
          <button onClick={() => setError('')} className="bg-transparent border-0 cursor-pointer text-red-700 text-lg">&times;</button>
        </div>
      )}
      {success && (
        <div className="bg-green-50 border border-green-200 rounded-lg px-3.5 py-2.5 mb-4 text-green-700 text-[13px]">
          {success}
        </div>
      )}

      {revisions.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-slate-400 text-[13px]">
          No prompt revisions recorded yet. Revisions are created automatically when the agent's prompts are updated.
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="text-left px-4 py-3 text-[11px] text-slate-500 uppercase tracking-wider font-semibold">#</th>
                <th className="text-left px-4 py-3 text-[11px] text-slate-500 uppercase tracking-wider font-semibold">Timestamp</th>
                <th className="text-left px-4 py-3 text-[11px] text-slate-500 uppercase tracking-wider font-semibold">Description</th>
                <th className="text-right px-4 py-3 text-[11px] text-slate-500 uppercase tracking-wider font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {revisions.map((rev) => (
                <tr key={rev.id} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 font-mono text-slate-600">{rev.revisionNumber}</td>
                  <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                    {new Date(rev.createdAt).toLocaleString(undefined, {
                      year: 'numeric', month: 'short', day: 'numeric',
                      hour: '2-digit', minute: '2-digit',
                    })}
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    <div>{rev.changeDescription || '—'}</div>
                    <button
                      onClick={() => setExpandedId(expandedId === rev.id ? null : rev.id)}
                      className="text-[11px] text-indigo-500 bg-transparent border-0 cursor-pointer p-0 mt-1 hover:underline [font-family:inherit]"
                    >
                      {expandedId === rev.id ? 'Hide prompts' : 'Show prompts'}
                    </button>
                    {expandedId === rev.id && (
                      <div className="mt-2 space-y-2">
                        {rev.masterPrompt && (
                          <div>
                            <div className="text-[11px] font-semibold text-slate-500 mb-0.5">Master Prompt</div>
                            <pre className="bg-slate-50 border border-slate-200 rounded-md p-2.5 text-[12px] text-slate-700 whitespace-pre-wrap m-0 max-h-[200px] overflow-auto">{rev.masterPrompt}</pre>
                          </div>
                        )}
                        {rev.additionalPrompt && (
                          <div>
                            <div className="text-[11px] font-semibold text-slate-500 mb-0.5">Additional Prompt</div>
                            <pre className="bg-slate-50 border border-slate-200 rounded-md p-2.5 text-[12px] text-slate-700 whitespace-pre-wrap m-0 max-h-[200px] overflow-auto">{rev.additionalPrompt}</pre>
                          </div>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => handleRollback(rev.id, rev.revisionNumber)}
                      disabled={rollingBack === rev.id}
                      className={`px-3 py-1.5 rounded-md text-[12px] font-medium border transition-colors [font-family:inherit] ${
                        rollingBack === rev.id
                          ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
                          : 'bg-white text-indigo-600 border-indigo-200 cursor-pointer hover:bg-indigo-50'
                      }`}
                    >
                      {rollingBack === rev.id ? 'Rolling back...' : 'Rollback'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
