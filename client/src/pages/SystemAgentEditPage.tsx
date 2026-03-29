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
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  border: '1px solid #d1d5db',
  borderRadius: 8,
  fontSize: 13,
  boxSizing: 'border-box',
  color: '#1e293b',
  background: '#fff',
  fontFamily: 'inherit',
};

const textareaStyle: React.CSSProperties = {
  ...inputStyle,
  minHeight: 120,
  resize: 'vertical' as const,
  lineHeight: 1.5,
};

const monoTextareaStyle: React.CSSProperties = {
  ...textareaStyle,
  fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
  fontSize: 12,
  minHeight: 160,
};

function SectionCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', marginBottom: 20 }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9' }}>
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: '#1e293b' }}>{title}</h2>
        {subtitle && <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>{subtitle}</div>}
      </div>
      <div style={{ padding: 20 }}>{children}</div>
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

  useEffect(() => {
    if (!isNew && id) loadAgent(id);
    loadSystemSkills();
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
    return <div style={{ padding: 48, textAlign: 'center', color: '#64748b', fontSize: 14 }}>Loading...</div>;
  }

  return (
    <>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <button
            onClick={() => navigate('/system/agents')}
            style={{ background: 'none', border: 'none', color: '#6366f1', cursor: 'pointer', fontSize: 13, padding: 0, marginBottom: 8, fontFamily: 'inherit' }}
          >
            &larr; Back to Agents
          </button>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: '#1e293b', margin: 0 }}>
            {isNew ? 'New System Agent' : form.name}
          </h1>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            padding: '10px 24px', background: saving ? '#94a3b8' : '#6366f1', color: '#fff',
            border: 'none', borderRadius: 8, fontSize: 14, cursor: saving ? 'default' : 'pointer', fontWeight: 500, fontFamily: 'inherit',
          }}
        >
          {saving ? 'Saving...' : isNew ? 'Create Agent' : 'Save Changes'}
        </button>
      </div>

      {/* Messages */}
      {saveSuccess && (
        <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '10px 14px', marginBottom: 16, color: '#166534', fontSize: 13 }}>
          {saveSuccess}
        </div>
      )}
      {saveError && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', marginBottom: 16, color: '#dc2626', fontSize: 13 }}>
          {saveError}
        </div>
      )}

      {/* Basic Information */}
      <SectionCard title="Basic Information">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <Field label="Name">
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              style={inputStyle}
              placeholder="e.g. Property Research Agent"
            />
          </Field>
          <Field label="Icon">
            <input
              value={form.icon}
              onChange={(e) => setForm({ ...form, icon: e.target.value })}
              style={inputStyle}
              placeholder="emoji or icon name"
            />
          </Field>
        </div>
        <Field label="Description">
          <textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            style={{ ...textareaStyle, minHeight: 60 }}
            rows={2}
            placeholder="Brief description of what this agent does..."
          />
        </Field>
      </SectionCard>

      {/* Master Prompt */}
      <SectionCard
        title="Master Prompt (Our IP)"
        subtitle="The system-level prompt that defines this agent's persona and capabilities. This is never exposed to organisation admins."
      >
        <Field label="Master Prompt">
          <textarea
            value={form.masterPrompt}
            onChange={(e) => setForm({ ...form, masterPrompt: e.target.value })}
            style={{ ...monoTextareaStyle, minHeight: 300 }}
            placeholder="You are a specialised agent that..."
          />
        </Field>
      </SectionCard>

      {/* Model Configuration */}
      <SectionCard title="Model Configuration">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <Field label="Model Provider">
            <input
              value={form.modelProvider}
              onChange={(e) => setForm({ ...form, modelProvider: e.target.value })}
              style={inputStyle}
              placeholder="anthropic"
            />
          </Field>
          <Field label="Model ID">
            <input
              value={form.modelId}
              onChange={(e) => setForm({ ...form, modelId: e.target.value })}
              style={inputStyle}
              placeholder="claude-sonnet-4-6"
            />
          </Field>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <Field label="Temperature">
            <input
              type="number"
              value={form.temperature}
              onChange={(e) => setForm({ ...form, temperature: parseFloat(e.target.value) || 0 })}
              style={inputStyle}
              step={0.1}
              min={0}
              max={2}
            />
          </Field>
          <Field label="Max Tokens">
            <input
              type="number"
              value={form.maxTokens}
              onChange={(e) => setForm({ ...form, maxTokens: parseInt(e.target.value) || 0 })}
              style={inputStyle}
            />
          </Field>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}>
          <label style={{ fontSize: 13, color: '#374151', fontWeight: 500 }}>Allow Model Override</label>
          <button
            onClick={() => setForm({ ...form, allowModelOverride: !form.allowModelOverride })}
            style={{
              width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer',
              background: form.allowModelOverride ? '#6366f1' : '#d1d5db',
              position: 'relative', transition: 'background 0.2s',
            }}
          >
            <div style={{
              width: 18, height: 18, borderRadius: 9, background: '#fff',
              position: 'absolute', top: 3,
              left: form.allowModelOverride ? 23 : 3, transition: 'left 0.2s',
              boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
            }} />
          </button>
          <span style={{ fontSize: 12, color: '#64748b' }}>
            {form.allowModelOverride ? 'Org admins can override model settings' : 'Model settings are locked'}
          </span>
        </div>
      </SectionCard>

      {/* System Skills */}
      <SectionCard title="System Skills" subtitle="Select which system skills are bundled with this agent.">
        {systemSkills.length === 0 ? (
          <div style={{ fontSize: 13, color: '#94a3b8', fontStyle: 'italic' }}>No system skills available.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {systemSkills.map(skill => (
              <label
                key={skill.id}
                title={skill.description ?? skill.name}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 13, color: '#1e293b',
                  cursor: 'pointer', padding: '8px 10px', borderRadius: 8,
                  background: form.defaultSystemSkillSlugs.includes(skill.slug) ? '#f5f3ff' : 'transparent',
                  border: form.defaultSystemSkillSlugs.includes(skill.slug) ? '1px solid #ddd6fe' : '1px solid transparent',
                  transition: 'background 0.15s, border-color 0.15s',
                }}
              >
                <input
                  type="checkbox"
                  checked={form.defaultSystemSkillSlugs.includes(skill.slug)}
                  onChange={() => toggleSkillSlug(skill.slug)}
                  style={{ width: 16, height: 16, accentColor: '#6366f1', marginTop: 2, flexShrink: 0 }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontWeight: 500 }}>{skill.name}</span>
                    <span style={{
                      fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: '#64748b',
                      background: '#f1f5f9', padding: '2px 6px', borderRadius: 4,
                    }}>
                      {skill.slug}
                    </span>
                  </div>
                  {skill.description && (
                    <div style={{ fontSize: 12, color: '#64748b', marginTop: 2, lineHeight: 1.4 }}>
                      {skill.description}
                    </div>
                  )}
                </div>
              </label>
            ))}
          </div>
        )}
      </SectionCard>

      {/* Default Org Skills */}
      <SectionCard title="Default Org Skills" subtitle="Org-visible skill slugs suggested when this agent is installed.">
        <Field label="Org Skill Slugs" hint="Comma-separated list of skill slugs">
          <textarea
            value={form.defaultOrgSkillSlugs}
            onChange={(e) => setForm({ ...form, defaultOrgSkillSlugs: e.target.value })}
            style={{ ...textareaStyle, minHeight: 60 }}
            placeholder="skill_one, skill_two, skill_three"
          />
        </Field>
      </SectionCard>

      {/* Scheduling Defaults */}
      <SectionCard title="Scheduling Defaults">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
          <Field label="Default Schedule Cron">
            <input
              value={form.defaultScheduleCron}
              onChange={(e) => setForm({ ...form, defaultScheduleCron: e.target.value })}
              style={inputStyle}
              placeholder="0 9 * * 1-5"
            />
          </Field>
          <Field label="Default Token Budget">
            <input
              type="number"
              value={form.defaultTokenBudget}
              onChange={(e) => setForm({ ...form, defaultTokenBudget: parseInt(e.target.value) || 0 })}
              style={inputStyle}
            />
          </Field>
          <Field label="Default Max Tool Calls">
            <input
              type="number"
              value={form.defaultMaxToolCalls}
              onChange={(e) => setForm({ ...form, defaultMaxToolCalls: parseInt(e.target.value) || 0 })}
              style={inputStyle}
            />
          </Field>
        </div>
      </SectionCard>

      {/* Publishing */}
      {!isNew && (
        <SectionCard title="Publishing">
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <span style={{
              display: 'inline-block', padding: '4px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600,
              background: form.isPublished ? '#f0fdf4' : '#f8fafc',
              color: form.isPublished ? '#166534' : '#64748b',
              border: form.isPublished ? '1px solid #bbf7d0' : '1px solid #e2e8f0',
            }}>
              {form.isPublished ? 'Published' : 'Draft'}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <label style={{ fontSize: 13, color: '#374151', fontWeight: 500 }}>Published</label>
              <button
                onClick={() => setForm({ ...form, isPublished: !form.isPublished })}
                style={{
                  width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer',
                  background: form.isPublished ? '#6366f1' : '#d1d5db',
                  position: 'relative', transition: 'background 0.2s',
                }}
              >
                <div style={{
                  width: 18, height: 18, borderRadius: 9, background: '#fff',
                  position: 'absolute', top: 3,
                  left: form.isPublished ? 23 : 3, transition: 'left 0.2s',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                }} />
              </button>
            </div>
            <button
              onClick={handlePublishToggle}
              disabled={publishing}
              style={{
                padding: '8px 16px', fontSize: 13, fontWeight: 500, borderRadius: 8, border: 'none', cursor: publishing ? 'default' : 'pointer',
                fontFamily: 'inherit',
                background: form.isPublished ? '#fef2f2' : '#f0fdf4',
                color: form.isPublished ? '#dc2626' : '#166534',
              }}
            >
              {publishing ? 'Updating...' : form.isPublished ? 'Unpublish' : 'Publish'}
            </button>
          </div>
        </SectionCard>
      )}

      {/* Bottom save button */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 8 }}>
        <button
          onClick={() => navigate('/system/agents')}
          style={{ padding: '10px 20px', background: '#f1f5f9', color: '#374151', border: 'none', borderRadius: 8, fontSize: 14, cursor: 'pointer', fontWeight: 500, fontFamily: 'inherit' }}
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            padding: '10px 24px', background: saving ? '#94a3b8' : '#6366f1', color: '#fff',
            border: 'none', borderRadius: 8, fontSize: 14, cursor: saving ? 'default' : 'pointer', fontWeight: 500, fontFamily: 'inherit',
          }}
        >
          {saving ? 'Saving...' : isNew ? 'Create Agent' : 'Save Changes'}
        </button>
      </div>
    </>
  );
}
