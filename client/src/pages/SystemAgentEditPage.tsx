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
  defaultScheduleCron: string;
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
  defaultScheduleCron: '',
  defaultTokenBudget: 0,
  defaultMaxToolCalls: 0,
  isPublished: false,
  parentSystemAgentId: '',
  agentRole: '',
  agentTitle: '',
};

const inputCls = 'w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500';
const textareaCls = `${inputCls} min-h-[120px] resize-y leading-relaxed`;
const monoTextareaCls = `${inputCls} min-h-[160px] resize-y font-mono text-[12px]`;

function SectionCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 mb-5">
      <div className="px-5 py-4 border-b border-slate-100">
        <h2 className="m-0 text-[15px] font-semibold text-slate-800">{title}</h2>
        {subtitle && <div className="text-[12px] text-slate-500 mt-1">{subtitle}</div>}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <label className="block text-[13px] font-medium text-slate-700 mb-1.5">{label}</label>
      {children}
      {hint && <div className="text-[12px] text-slate-400 mt-1">{hint}</div>}
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      className={`relative w-11 h-6 rounded-full border-0 cursor-pointer transition-colors ${checked ? 'bg-indigo-600' : 'bg-slate-300'}`}
    >
      <div className={`absolute w-[18px] h-[18px] rounded-full bg-white top-[3px] transition-all shadow-sm ${checked ? 'left-[23px]' : 'left-[3px]'}`} />
    </button>
  );
}

export default function SystemAgentEditPage({ user }: { user: User }) {
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

  const loadAgent = async (agentId: string) => {
    try {
      const { data } = await api.get(`/api/system/agents/${agentId}`);
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
        defaultScheduleCron: data.defaultScheduleCron ?? '',
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
        defaultScheduleCron: form.defaultScheduleCron || null,
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
        setSaveSuccess('Agent saved successfully.');
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

  return (
    <>
      <div className="flex justify-between items-center mb-6">
        <div>
          <button
            onClick={() => navigate('/system/agents')}
            className="bg-transparent border-0 text-indigo-600 cursor-pointer text-[13px] p-0 mb-2 hover:text-indigo-800 transition-colors"
          >
            ← Back to Agents
          </button>
          <h1 className="text-[28px] font-bold text-slate-800 m-0">
            {isNew ? 'New System Agent' : form.name}
          </h1>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className={`px-6 py-2.5 text-white border-0 rounded-lg text-[14px] font-medium transition-colors ${saving ? 'bg-slate-400 cursor-default' : 'bg-indigo-600 hover:bg-indigo-700 cursor-pointer'}`}
        >
          {saving ? 'Saving...' : isNew ? 'Create Agent' : 'Save Changes'}
        </button>
      </div>

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

      <SectionCard title="Basic Information">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Name">
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} placeholder="e.g. Property Research Agent" />
          </Field>
          <Field label="Icon">
            <input value={form.icon} onChange={(e) => setForm({ ...form, icon: e.target.value })} className={inputCls} placeholder="emoji or icon name" />
          </Field>
        </div>
        <Field label="Description">
          <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={`${textareaCls} min-h-[60px]`} rows={2} placeholder="Brief description of what this agent does..." />
        </Field>
      </SectionCard>

      <SectionCard title="Hierarchy" subtitle="Configure this agent's position in the agent hierarchy. Phase 1 is structural/visual only.">
        <div className="grid grid-cols-3 gap-4">
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
            <input value={form.agentTitle} onChange={(e) => setForm({ ...form, agentTitle: e.target.value })} className={inputCls} placeholder="e.g. Head of Research" />
          </Field>
        </div>
      </SectionCard>

      <SectionCard
        title="Master Prompt (Our IP)"
        subtitle="The system-level prompt that defines this agent's persona and capabilities. This is never exposed to organisation admins."
      >
        <Field label="Master Prompt">
          <textarea value={form.masterPrompt} onChange={(e) => setForm({ ...form, masterPrompt: e.target.value })} className={`${monoTextareaCls} min-h-[300px]`} placeholder="You are a specialised agent that..." />
        </Field>
      </SectionCard>

      <SectionCard title="Model Configuration">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Model Provider">
            <input value={form.modelProvider} onChange={(e) => setForm({ ...form, modelProvider: e.target.value })} className={inputCls} placeholder="anthropic" />
          </Field>
          <Field label="Model ID">
            <input value={form.modelId} onChange={(e) => setForm({ ...form, modelId: e.target.value })} className={inputCls} placeholder="claude-sonnet-4-6" />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Temperature">
            <input type="number" value={form.temperature} onChange={(e) => setForm({ ...form, temperature: parseFloat(e.target.value) || 0 })} className={inputCls} step={0.1} min={0} max={2} />
          </Field>
          <Field label="Max Tokens">
            <input type="number" value={form.maxTokens} onChange={(e) => setForm({ ...form, maxTokens: parseInt(e.target.value) || 0 })} className={inputCls} />
          </Field>
        </div>
        <div className="flex items-center gap-3 mt-1">
          <label className="text-[13px] text-slate-700 font-medium">Allow Model Override</label>
          <Toggle checked={form.allowModelOverride} onChange={() => setForm({ ...form, allowModelOverride: !form.allowModelOverride })} />
          <span className="text-[12px] text-slate-500">
            {form.allowModelOverride ? 'Org admins can override model settings' : 'Model settings are locked'}
          </span>
        </div>
      </SectionCard>

      <SectionCard title="System Skills" subtitle="Select which system skills are bundled with this agent.">
        {systemSkills.length === 0 ? (
          <div className="text-[13px] text-slate-400 italic">No system skills available.</div>
        ) : (
          <div className="flex flex-col gap-1">
            {systemSkills.map(skill => (
              <label
                key={skill.id}
                title={skill.description ?? skill.name}
                className={`flex items-start gap-2.5 text-[13px] text-slate-800 cursor-pointer px-2.5 py-2 rounded-lg border transition-colors ${form.defaultSystemSkillSlugs.includes(skill.slug) ? 'bg-violet-50 border-violet-200' : 'bg-transparent border-transparent hover:bg-slate-50'}`}
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
                    <div className="text-[12px] text-slate-500 mt-0.5 leading-snug">{skill.description}</div>
                  )}
                </div>
              </label>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard title="Default Org Skills" subtitle="Org-visible skill slugs suggested when this agent is installed.">
        <Field label="Org Skill Slugs" hint="Comma-separated list of skill slugs">
          <textarea value={form.defaultOrgSkillSlugs} onChange={(e) => setForm({ ...form, defaultOrgSkillSlugs: e.target.value })} className={`${textareaCls} min-h-[60px]`} placeholder="skill_one, skill_two, skill_three" />
        </Field>
      </SectionCard>

      <SectionCard title="Scheduling Defaults">
        <div className="grid grid-cols-3 gap-4">
          <Field label="Default Schedule Cron">
            <input value={form.defaultScheduleCron} onChange={(e) => setForm({ ...form, defaultScheduleCron: e.target.value })} className={inputCls} placeholder="0 9 * * 1-5" />
          </Field>
          <Field label="Default Token Budget">
            <input type="number" value={form.defaultTokenBudget} onChange={(e) => setForm({ ...form, defaultTokenBudget: parseInt(e.target.value) || 0 })} className={inputCls} />
          </Field>
          <Field label="Default Max Tool Calls">
            <input type="number" value={form.defaultMaxToolCalls} onChange={(e) => setForm({ ...form, defaultMaxToolCalls: parseInt(e.target.value) || 0 })} className={inputCls} />
          </Field>
        </div>
      </SectionCard>

      {!isNew && (
        <SectionCard title="Publishing">
          <div className="flex items-center gap-4">
            <span className={`inline-block px-2.5 py-1 rounded-md text-[12px] font-semibold border ${form.isPublished ? 'bg-green-50 text-green-700 border-green-200' : 'bg-slate-50 text-slate-500 border-slate-200'}`}>
              {form.isPublished ? 'Published' : 'Draft'}
            </span>
            <div className="flex items-center gap-3">
              <label className="text-[13px] text-slate-700 font-medium">Published</label>
              <Toggle checked={form.isPublished} onChange={() => setForm({ ...form, isPublished: !form.isPublished })} />
            </div>
            <button
              onClick={handlePublishToggle}
              disabled={publishing}
              className={`px-4 py-2 text-[13px] font-medium border-0 rounded-lg cursor-pointer transition-colors ${publishing ? 'opacity-60 cursor-default' : ''} ${form.isPublished ? 'bg-red-50 hover:bg-red-100 text-red-700' : 'bg-green-50 hover:bg-green-100 text-green-700'}`}
            >
              {publishing ? 'Updating...' : form.isPublished ? 'Unpublish' : 'Publish'}
            </button>
          </div>
        </SectionCard>
      )}

      <div className="flex justify-end gap-3 mt-2">
        <button
          onClick={() => navigate('/system/agents')}
          className="px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 border-0 rounded-lg text-[14px] font-medium cursor-pointer transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className={`px-6 py-2.5 text-white border-0 rounded-lg text-[14px] font-medium transition-colors ${saving ? 'bg-slate-400 cursor-default' : 'bg-indigo-600 hover:bg-indigo-700 cursor-pointer'}`}
        >
          {saving ? 'Saving...' : isNew ? 'Create Agent' : 'Save Changes'}
        </button>
      </div>
    </>
  );
}
