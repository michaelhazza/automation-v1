import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { User } from '../lib/auth';

interface SystemSkill {
  id: string;
  name: string;
  slug: string;
  description: string | null;
}

interface SystemAgentOption {
  id: string;
  name: string;
}

interface AgentForm {
  name: string;
  icon: string;
  description: string;
  masterPrompt: string;
  modelProvider: string;
  modelId: string;
  temperature: number;
  maxTokens: number;
  allowModelOverride: boolean;
  defaultSystemSkillSlugs: string[];
  defaultOrgSkillSlugs: string;
  // Schedule stored as friendly fields; cron generated on save
  scheduleHour: number;
  scheduleMinute: number;
  scheduleIntervalHours: number; // 0 = disabled
  defaultTokenBudget: number;
  defaultMaxToolCalls: number;
  isPublished: boolean;
  parentSystemAgentId: string;
  agentRole: string;
  agentTitle: string;
}

const EMPTY_FORM: AgentForm = {
  name: '',
  icon: '',
  description: '',
  masterPrompt: '',
  modelProvider: 'anthropic',
  modelId: 'claude-sonnet-4-6',
  temperature: 0,
  maxTokens: 0,
  allowModelOverride: false,
  defaultSystemSkillSlugs: [],
  defaultOrgSkillSlugs: '',
  scheduleHour: 9,
  scheduleMinute: 0,
  scheduleIntervalHours: 0,
  defaultTokenBudget: 0,
  defaultMaxToolCalls: 0,
  isPublished: false,
  parentSystemAgentId: '',
  agentRole: '',
  agentTitle: '',
};

// ── Schedule helpers ──────────────────────────────────────────────────────────

const SCHEDULE_INTERVALS = [1, 2, 3, 4, 6, 8, 12, 24];

/** Parse a simple cron like "30 9,13,17,21 * * *" or "0 9 * * *" → {hour,minute,interval} */
function parseCron(cron: string | null | undefined): { hour: number; minute: number; interval: number } {
  if (!cron) return { hour: 9, minute: 0, interval: 0 };
  const parts = cron.trim().split(/\s+/);
  if (parts.length < 2) return { hour: 9, minute: 0, interval: 0 };
  const minute = parseInt(parts[0]);
  const hourPart = parts[1];
  if (isNaN(minute)) return { hour: 9, minute: 0, interval: 0 };
  // Handle "9,13,17,21" or "9"
  const hours = hourPart.split(',').map(Number).filter(h => !isNaN(h));
  if (hours.length === 0) return { hour: 9, minute: 0, interval: 0 };
  const startHour = hours[0];
  const interval = hours.length > 1 ? hours[1] - hours[0] : 24;
  return { hour: startHour, minute: isNaN(minute) ? 0 : minute, interval };
}

/** Generate cron from friendly fields. Returns null if interval is 0 (disabled). */
function buildCron(hour: number, minute: number, intervalHours: number): string | null {
  if (intervalHours === 0) return null;
  if (intervalHours >= 24) return `${minute} ${hour} * * *`;
  const hours: number[] = [];
  for (let h = hour; h < 24; h += intervalHours) hours.push(h);
  return `${minute} ${hours.join(',')} * * *`;
}

const ICON_OPTIONS = [
  '\u{1F50D}', '\u{1F4CA}', '\u{1F4DD}', '\u{1F4E3}', '\u{1F916}', '\u2699\uFE0F',
  '\u{1F4AC}', '\u{1F4C8}', '\u2728', '\u{1F3AF}', '\u{1F4A1}', '\u{1F4CB}',
  '\u{1F4E7}', '\u{1F310}', '\u{1F4B0}', '\u{1F465}', '\u{1F4F1}', '\u{1F5A5}\uFE0F',
  '\u{1F4DA}', '\u{1F3E2}', '\u{1F6E0}\uFE0F', '\u{1F4CC}', '\u{1F4CE}', '\u{1F512}',
];

type AgentTab = 'identity' | 'prompt' | 'skills' | 'configuration';

const inputCls = 'w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500';
const textareaCls = `${inputCls} min-h-[120px] resize-y leading-relaxed`;
const monoTextareaCls = `${inputCls} min-h-[160px] resize-y font-mono text-[12px]`;

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-white rounded-xl border border-slate-200 ${className}`}>
      {children}
    </div>
  );
}

function CardHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="px-5 py-4 border-b border-slate-100">
      <h2 className="m-0 text-[14px] font-semibold text-slate-800">{title}</h2>
      {subtitle && <p className="m-0 mt-1 text-[12px] text-slate-500">{subtitle}</p>}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="mb-4 last:mb-0">
      <label className="block text-[13px] font-medium text-slate-700 mb-1.5">{label}</label>
      {children}
      {hint && <p className="m-0 mt-1 text-[12px] text-slate-400">{hint}</p>}
    </div>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: () => void; label?: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <button
        type="button"
        onClick={onChange}
        className={`relative w-10 h-[22px] rounded-full border-0 cursor-pointer transition-colors ${checked ? 'bg-indigo-600' : 'bg-slate-300'}`}
      >
        <div className={`absolute w-[16px] h-[16px] rounded-full bg-white top-[3px] transition-all shadow-sm ${checked ? 'left-[21px]' : 'left-[3px]'}`} />
      </button>
      {label && <span className="text-[13px] text-slate-600">{label}</span>}
    </div>
  );
}

function RoleBadge({ role }: { role: string }) {
  if (!role) return null;
  const cls: Record<string, string> = {
    orchestrator: 'bg-purple-100 text-purple-700',
    specialist: 'bg-blue-100 text-blue-700',
    worker: 'bg-slate-100 text-slate-600',
  };
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium capitalize ${cls[role] ?? 'bg-slate-100 text-slate-600'}`}>
      {role}
    </span>
  );
}

export default function SystemAgentEditPage({ user: _user }: { user: User }) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isNew = id === 'new';

  const [form, setForm] = useState<AgentForm>(EMPTY_FORM);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState('');
  const [saveError, setSaveError] = useState('');
  const [systemSkills, setSystemSkills] = useState<SystemSkill[]>([]);
  const [allAgents, setAllAgents] = useState<SystemAgentOption[]>([]);
  const [publishing, setPublishing] = useState(false);
  const [activeTab, setActiveTab] = useState<AgentTab>('identity');

  const loadAgent = async (agentId: string) => {
    try {
      const { data } = await api.get(`/api/system/agents/${agentId}`);
      const { hour, minute, interval } = parseCron(data.defaultScheduleCron);
      setForm({
        name: data.name ?? '',
        icon: data.icon ?? '',
        description: data.description ?? '',
        masterPrompt: data.masterPrompt ?? '',
        modelProvider: data.modelProvider ?? 'anthropic',
        modelId: data.modelId ?? 'claude-sonnet-4-6',
        temperature: data.temperature ?? 0,
        maxTokens: data.maxTokens ?? 0,
        allowModelOverride: data.allowModelOverride ?? false,
        defaultSystemSkillSlugs: data.defaultSystemSkillSlugs ?? [],
        defaultOrgSkillSlugs: Array.isArray(data.defaultOrgSkillSlugs)
          ? data.defaultOrgSkillSlugs.join(', ')
          : data.defaultOrgSkillSlugs ?? '',
        scheduleHour: hour,
        scheduleMinute: minute,
        scheduleIntervalHours: interval,
        defaultTokenBudget: data.defaultTokenBudget ?? 0,
        defaultMaxToolCalls: data.defaultMaxToolCalls ?? 0,
        isPublished: data.isPublished ?? false,
        parentSystemAgentId: data.parentSystemAgentId ?? '',
        agentRole: data.agentRole ?? '',
        agentTitle: data.agentTitle ?? '',
      });
    } finally {
      setLoading(false);
    }
  };

  const loadSystemSkills = async () => {
    try {
      const { data } = await api.get('/api/system/skills');
      setSystemSkills(Array.isArray(data) ? data : data.skills ?? data.data ?? []);
    } catch {
      // Skills may not be available yet
    }
  };

  const loadAllAgents = async () => {
    try {
      const { data } = await api.get('/api/system/agents');
      setAllAgents(data.map((a: { id: string; name: string }) => ({ id: a.id, name: a.name })));
    } catch {
      // non-critical
    }
  };

  useEffect(() => {
    if (!isNew && id) loadAgent(id);
    loadSystemSkills();
    loadAllAgents();
  }, [id, isNew]);

  const handleSave = async () => {
    setSaveError('');
    setSaveSuccess('');

    if (!form.name.trim()) { setSaveError('Name is required.'); return; }

    setSaving(true);
    try {
      const orgSlugs = form.defaultOrgSkillSlugs
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);

      const payload = {
        name: form.name,
        icon: form.icon || null,
        description: form.description || null,
        masterPrompt: form.masterPrompt || null,
        modelProvider: form.modelProvider || 'anthropic',
        modelId: form.modelId || 'claude-sonnet-4-6',
        temperature: form.temperature,
        maxTokens: form.maxTokens || null,
        allowModelOverride: form.allowModelOverride,
        defaultSystemSkillSlugs: form.defaultSystemSkillSlugs,
        defaultOrgSkillSlugs: orgSlugs.length > 0 ? orgSlugs : null,
        defaultScheduleCron: buildCron(form.scheduleHour, form.scheduleMinute, form.scheduleIntervalHours),
        defaultTokenBudget: form.defaultTokenBudget || null,
        defaultMaxToolCalls: form.defaultMaxToolCalls || null,
        parentSystemAgentId: form.parentSystemAgentId || null,
        agentRole: form.agentRole || null,
        agentTitle: form.agentTitle || null,
      };

      if (isNew) {
        const { data } = await api.post('/api/system/agents', payload);
        navigate(`/system/agents/${data.id}`, { replace: true });
      } else {
        await api.patch(`/api/system/agents/${id}`, payload);
        setSaveSuccess('Agent saved.');
        loadAgent(id!);
      }
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setSaveError(e.response?.data?.error ?? 'Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  const handlePublishToggle = async () => {
    setPublishing(true);
    setSaveError('');
    setSaveSuccess('');
    try {
      if (form.isPublished) {
        await api.post(`/api/system/agents/${id}/unpublish`);
        setSaveSuccess('Agent unpublished.');
      } else {
        await api.post(`/api/system/agents/${id}/publish`);
        setSaveSuccess('Agent published.');
      }
      loadAgent(id!);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setSaveError(e.response?.data?.error ?? 'Failed to update publish status.');
    } finally {
      setPublishing(false);
    }
  };

  const toggleSkillSlug = (slug: string) => {
    setForm(prev => {
      const slugs = prev.defaultSystemSkillSlugs.includes(slug)
        ? prev.defaultSystemSkillSlugs.filter(s => s !== slug)
        : [...prev.defaultSystemSkillSlugs, slug];
      return { ...prev, defaultSystemSkillSlugs: slugs };
    });
  };

  if (loading) {
    return <div className="py-12 text-center text-slate-500 text-[14px]">Loading...</div>;
  }

  const agentInitial = form.name ? form.name[0].toUpperCase() : '?';
  const tabs: { key: AgentTab; label: string }[] = isNew
    ? [{ key: 'identity', label: 'Identity' }]
    : [
        { key: 'identity', label: 'Identity' },
        { key: 'prompt', label: 'Prompt' },
        { key: 'skills', label: 'Skills' },
        { key: 'configuration', label: 'Configuration' },
      ];

  return (
    <>
      {/* ── Breadcrumb ───────────────────────────────────────────────── */}
      <div className="flex items-center gap-1.5 text-[13px] text-slate-400 mb-5">
        <button
          onClick={() => navigate('/system/agents')}
          className="bg-transparent border-0 p-0 cursor-pointer text-slate-400 hover:text-indigo-600 transition-colors"
        >
          System Agents
        </button>
        <span>›</span>
        <span className="text-slate-600 font-medium">{form.name || 'New Agent'}</span>
        {!isNew && (
          <>
            <span>›</span>
            <span className="text-slate-500 capitalize">{activeTab}</span>
          </>
        )}
      </div>

      {/* ── Agent header ─────────────────────────────────────────────── */}
      <div className="flex items-start justify-between mb-0 pb-5 border-b border-slate-200">
        <div className="flex items-center gap-4">
          {/* Avatar */}
          <div className="w-14 h-14 rounded-xl bg-indigo-100 flex items-center justify-center text-2xl shrink-0 border border-indigo-200">
            {form.icon || <span className="text-indigo-500 font-bold text-[22px]">{agentInitial}</span>}
          </div>
          <div>
            <div className="flex items-center gap-2.5 mb-0.5">
              <h1 className="m-0 text-[22px] font-bold text-slate-900 leading-tight">
                {isNew ? 'New System Agent' : form.name}
              </h1>
              {!isNew && form.agentRole && <RoleBadge role={form.agentRole} />}
              {!isNew && (
                <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold ${form.isPublished ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                  {form.isPublished ? 'Published' : 'Draft'}
                </span>
              )}
            </div>
            {form.description && (
              <p className="m-0 text-[13px] text-slate-500 leading-snug max-w-lg">{form.description}</p>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 shrink-0">
          {!isNew && (
            <button
              onClick={handlePublishToggle}
              disabled={publishing}
              className={`px-4 py-2 text-[13px] font-medium border rounded-lg cursor-pointer transition-colors disabled:opacity-60 ${
                form.isPublished
                  ? 'bg-white border-slate-200 text-slate-700 hover:bg-red-50 hover:border-red-200 hover:text-red-700'
                  : 'bg-white border-slate-200 text-slate-700 hover:bg-green-50 hover:border-green-200 hover:text-green-700'
              }`}
            >
              {publishing ? 'Updating...' : form.isPublished ? 'Unpublish' : 'Publish'}
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

      {/* ── Feedback banners ─────────────────────────────────────────── */}
      {saveSuccess && (
        <div className="bg-green-50 border border-green-200 rounded-lg px-3.5 py-2.5 mt-4 text-green-700 text-[13px]">
          {saveSuccess}
        </div>
      )}
      {saveError && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-3.5 py-2.5 mt-4 text-red-600 text-[13px]">
          {saveError}
        </div>
      )}

      {/* ── Tab bar ──────────────────────────────────────────────────── */}
      <div className="flex gap-0 border-b border-slate-200 mt-5 mb-6">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2.5 text-[13px] font-medium border-0 bg-transparent cursor-pointer transition-colors border-b-2 -mb-px [font-family:inherit] ${
              activeTab === tab.key
                ? 'text-indigo-600 border-indigo-500'
                : 'text-slate-500 border-transparent hover:text-slate-800'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Identity tab ─────────────────────────────────────────────── */}
      {activeTab === 'identity' && (
        <div className="space-y-5">
          <Card>
            <CardHeader title="Basic Information" />
            <div className="p-5">
              <Field label="Icon" hint="Choose an icon that represents this agent's role">
                <div className="flex flex-wrap gap-1.5">
                  {ICON_OPTIONS.map((ico) => (
                    <button
                      key={ico}
                      type="button"
                      onClick={() => setForm({ ...form, icon: form.icon === ico ? '' : ico })}
                      className={`w-9 h-9 rounded-lg border-2 cursor-pointer text-lg flex items-center justify-center transition-all duration-100 ${
                        form.icon === ico
                          ? 'border-indigo-500 bg-indigo-50'
                          : 'border-slate-200 bg-slate-50 hover:border-slate-300'
                      }`}
                    >
                      {ico}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="Name *">
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className={inputCls}
                  placeholder="e.g. Research Analyst"
                />
              </Field>
              <Field label="Description" hint="Describe what this agent does">
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className={`${textareaCls} min-h-[72px]`}
                  rows={2}
                  placeholder="Brief description of this agent's purpose..."
                />
              </Field>
            </div>
          </Card>

          {(isNew || !isNew) && (
            <Card>
              <CardHeader title="Hierarchy" subtitle="Define this agent's position in the team structure." />
              <div className="p-5">
                <div className="grid grid-cols-2 gap-4">
                  {!isNew && (
                    <Field label="Reports to">
                      <select
                        value={form.parentSystemAgentId}
                        onChange={(e) => setForm({ ...form, parentSystemAgentId: e.target.value })}
                        className={inputCls}
                      >
                        <option value="">None (root agent)</option>
                        {allAgents
                          .filter((a) => a.id !== id)
                          .map((a) => (
                            <option key={a.id} value={a.id}>{a.name}</option>
                          ))}
                      </select>
                    </Field>
                  )}
                  {!isNew && (
                    <Field label="Title">
                      <input
                        value={form.agentTitle}
                        onChange={(e) => setForm({ ...form, agentTitle: e.target.value })}
                        className={inputCls}
                        placeholder="e.g. Head of Research"
                      />
                    </Field>
                  )}
                </div>
              </div>
            </Card>
          )}
        </div>
      )}

      {/* ── Prompt tab ───────────────────────────────────────────────── */}
      {activeTab === 'prompt' && !isNew && (
        <Card>
          <CardHeader
            title="Master Prompt"
            subtitle="The system-level prompt that defines this agent's persona and capabilities. Not exposed to organisation admins."
          />
          <div className="p-5">
            <textarea
              value={form.masterPrompt}
              onChange={(e) => setForm({ ...form, masterPrompt: e.target.value })}
              className={`${monoTextareaCls} min-h-[400px]`}
              placeholder="You are a specialised agent that..."
            />
          </div>
        </Card>
      )}

      {/* ── Skills tab ───────────────────────────────────────────────── */}
      {activeTab === 'skills' && !isNew && (
        <div className="space-y-5">
          <Card>
            <CardHeader title="System Skills" subtitle="Select which system skills are bundled with this agent by default." />
            <div className="p-5">
              {systemSkills.length === 0 ? (
                <p className="m-0 text-[13px] text-slate-400 italic">No system skills available.</p>
              ) : (
                <div className="flex flex-col gap-1">
                  {systemSkills.map(skill => (
                    <label
                      key={skill.id}
                      title={skill.description ?? skill.name}
                      className={`flex items-start gap-2.5 text-[13px] cursor-pointer px-3 py-2.5 rounded-lg border transition-colors ${
                        form.defaultSystemSkillSlugs.includes(skill.slug)
                          ? 'bg-violet-50 border-violet-200 text-slate-800'
                          : 'bg-transparent border-transparent hover:bg-slate-50 text-slate-700'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={form.defaultSystemSkillSlugs.includes(skill.slug)}
                        onChange={() => toggleSkillSlug(skill.slug)}
                        className="w-4 h-4 mt-0.5 shrink-0 accent-indigo-600"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{skill.name}</span>
                          <span className="font-mono text-[11px] text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                            {skill.slug}
                          </span>
                        </div>
                        {skill.description && (
                          <p className="m-0 mt-0.5 text-[12px] text-slate-500 leading-snug">{skill.description}</p>
                        )}
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Default Org Skills"
              subtitle="Org-visible skill slugs suggested when this agent is installed into an organisation."
            />
            <div className="p-5">
              <Field label="Skill Slugs" hint="Comma-separated list of skill slugs">
                <textarea
                  value={form.defaultOrgSkillSlugs}
                  onChange={(e) => setForm({ ...form, defaultOrgSkillSlugs: e.target.value })}
                  className={`${textareaCls} min-h-[72px]`}
                  placeholder="skill_one, skill_two, skill_three"
                />
              </Field>
            </div>
          </Card>
        </div>
      )}

      {/* ── Configuration tab ────────────────────────────────────────── */}
      {activeTab === 'configuration' && !isNew && (
        <div className="space-y-5">
          <Card>
            <CardHeader title="Model" />
            <div className="p-5">
              <div className="grid grid-cols-2 gap-4">
                <Field label="Model Provider">
                  <input
                    value={form.modelProvider}
                    onChange={(e) => setForm({ ...form, modelProvider: e.target.value })}
                    className={inputCls}
                    placeholder="anthropic"
                  />
                </Field>
                <Field label="Model ID">
                  <input
                    value={form.modelId}
                    onChange={(e) => setForm({ ...form, modelId: e.target.value })}
                    className={inputCls}
                    placeholder="claude-sonnet-4-6"
                  />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Temperature">
                  <input
                    type="number"
                    value={form.temperature}
                    onChange={(e) => setForm({ ...form, temperature: parseFloat(e.target.value) || 0 })}
                    className={inputCls}
                    step={0.1} min={0} max={2}
                  />
                </Field>
                <Field label="Max Tokens">
                  <input
                    type="number"
                    value={form.maxTokens}
                    onChange={(e) => setForm({ ...form, maxTokens: parseInt(e.target.value) || 0 })}
                    className={inputCls}
                  />
                </Field>
              </div>
              <Toggle
                checked={form.allowModelOverride}
                onChange={() => setForm({ ...form, allowModelOverride: !form.allowModelOverride })}
                label={form.allowModelOverride ? 'Org admins can override model settings' : 'Model settings are locked for org admins'}
              />
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Scheduling Defaults"
              subtitle="Default heartbeat configuration applied when this agent is installed into a subaccount."
            />
            <div className="p-5">
              {/* Schedule enable toggle */}
              <div className="mb-5">
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, scheduleIntervalHours: form.scheduleIntervalHours === 0 ? 8 : 0 })}
                    className={`relative w-10 h-[22px] rounded-full border-0 cursor-pointer transition-colors ${form.scheduleIntervalHours > 0 ? 'bg-indigo-600' : 'bg-slate-300'}`}
                  >
                    <div className={`absolute w-[16px] h-[16px] rounded-full bg-white top-[3px] transition-all shadow-sm ${form.scheduleIntervalHours > 0 ? 'left-[21px]' : 'left-[3px]'}`} />
                  </button>
                  <span className="text-[13px] font-medium text-slate-700">Enable default heartbeat schedule</span>
                </label>
              </div>

              {form.scheduleIntervalHours > 0 && (
                <div className="mb-5 flex flex-wrap items-end gap-5">
                  {/* Start time */}
                  <div>
                    <div className="text-[12px] font-medium text-slate-600 mb-1.5">Start time (subaccount timezone)</div>
                    <div className="flex items-center gap-1.5">
                      <select
                        value={form.scheduleHour}
                        onChange={(e) => setForm({ ...form, scheduleHour: Number(e.target.value) })}
                        className={`${inputCls} w-[80px]`}
                      >
                        {Array.from({ length: 24 }, (_, i) => (
                          <option key={i} value={i}>{String(i).padStart(2, '0')}</option>
                        ))}
                      </select>
                      <span className="text-slate-400">:</span>
                      <select
                        value={form.scheduleMinute}
                        onChange={(e) => setForm({ ...form, scheduleMinute: Number(e.target.value) })}
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
                    <div className="text-[12px] font-medium text-slate-600 mb-1.5">Repeat every</div>
                    <div className="flex gap-1.5 flex-wrap">
                      {SCHEDULE_INTERVALS.map((iv) => (
                        <button
                          key={iv}
                          type="button"
                          onClick={() => setForm({ ...form, scheduleIntervalHours: iv })}
                          className={`px-3 py-1.5 rounded-lg border text-[12px] font-medium cursor-pointer transition-colors ${
                            form.scheduleIntervalHours === iv
                              ? 'bg-indigo-600 text-white border-indigo-600'
                              : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                          }`}
                        >
                          {iv === 24 ? '1 day' : `${iv}h`}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Preview */}
                  <div className="text-[12px] text-slate-400 self-end pb-0.5">
                    Cron: <code className="bg-slate-100 px-1.5 py-0.5 rounded text-slate-600">
                      {buildCron(form.scheduleHour, form.scheduleMinute, form.scheduleIntervalHours) ?? '—'}
                    </code>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <Field label="Default Token Budget">
                  <input
                    type="number"
                    value={form.defaultTokenBudget}
                    onChange={(e) => setForm({ ...form, defaultTokenBudget: parseInt(e.target.value) || 0 })}
                    className={inputCls}
                  />
                </Field>
                <Field label="Default Max Tool Calls">
                  <input
                    type="number"
                    value={form.defaultMaxToolCalls}
                    onChange={(e) => setForm({ ...form, defaultMaxToolCalls: parseInt(e.target.value) || 0 })}
                    className={inputCls}
                  />
                </Field>
              </div>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
