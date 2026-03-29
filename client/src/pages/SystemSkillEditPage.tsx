import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { User } from '../lib/auth';

interface SkillForm {
  name: string;
  slug: string;
  description: string;
  instructions: string;
  methodology: string;
  definition: string; // JSON string
  isActive: boolean;
}

const EMPTY_FORM: SkillForm = {
  name: '',
  slug: '',
  description: '',
  instructions: '',
  methodology: '',
  definition: JSON.stringify({
    name: '',
    description: '',
    input_schema: { type: 'object', properties: {}, required: [] },
  }, null, 2),
  isActive: true,
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

export default function SystemSkillEditPage({ user }: { user: User }) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isNew = id === 'new';

  const [form, setForm] = useState<SkillForm>(EMPTY_FORM);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState('');
  const [saveError, setSaveError] = useState('');
  const [methodologyPreview, setMethodologyPreview] = useState(false);

  const loadSkill = async (skillId: string) => {
    try {
      const { data } = await api.get(`/api/system/skills/${skillId}`);
      setForm({
        name: data.name ?? '',
        slug: data.slug ?? '',
        description: data.description ?? '',
        instructions: data.instructions ?? '',
        methodology: data.methodology ?? '',
        definition: JSON.stringify(data.definition, null, 2),
        isActive: data.isActive,
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isNew && id) loadSkill(id);
  }, [id, isNew]);

  const handleSave = async () => {
    setSaveError('');
    setSaveSuccess('');

    if (!form.name.trim()) { setSaveError('Name is required.'); return; }
    if (!form.slug.trim()) { setSaveError('Slug is required.'); return; }

    let definition: object;
    try {
      definition = JSON.parse(form.definition);
    } catch {
      setSaveError('Tool definition must be valid JSON.');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: form.name,
        slug: form.slug,
        description: form.description || null,
        instructions: form.instructions || null,
        methodology: form.methodology || null,
        definition,
        isActive: form.isActive,
      };

      if (isNew) {
        const { data } = await api.post('/api/system/skills', payload);
        navigate(`/system/skills/${data.id}`, { replace: true });
      } else {
        await api.patch(`/api/system/skills/${id}`, payload);
        setSaveSuccess('Skill saved successfully.');
        loadSkill(id!);
      }
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setSaveError(e.response?.data?.error ?? 'Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  const autoSlug = (name: string) => {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
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
            onClick={() => navigate('/system/skills')}
            style={{ background: 'none', border: 'none', color: '#6366f1', cursor: 'pointer', fontSize: 13, padding: 0, marginBottom: 8, fontFamily: 'inherit' }}
          >
            &larr; Back to Skills
          </button>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: '#1e293b', margin: 0 }}>
            {isNew ? 'New System Skill' : form.name}
          </h1>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            padding: '10px 24px', background: saving ? '#94a3b8' : '#6366f1', color: '#fff',
            border: 'none', borderRadius: 8, fontSize: 14, cursor: saving ? 'default' : 'pointer', fontWeight: 500,
          }}
        >
          {saving ? 'Saving...' : isNew ? 'Create Skill' : 'Save Changes'}
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

      {/* Basic Info */}
      <SectionCard title="Basic Information">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <Field label="Name" hint="Human-readable name for this skill">
            <input
              value={form.name}
              onChange={(e) => {
                const name = e.target.value;
                setForm({ ...form, name, ...(isNew ? { slug: autoSlug(name) } : {}) });
              }}
              style={inputStyle}
              placeholder="e.g. Real Estate Listing Analysis"
            />
          </Field>
          <Field label="Slug" hint="Unique identifier used in agent configuration">
            <input
              value={form.slug}
              onChange={(e) => setForm({ ...form, slug: e.target.value })}
              style={{ ...inputStyle, fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}
              disabled={!isNew}
              placeholder="e.g. real_estate_listing_analysis"
            />
          </Field>
        </div>
        <Field label="Description" hint="Brief description shown in the skills library">
          <textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            style={{ ...textareaStyle, minHeight: 60 }}
            placeholder="Describe what this skill enables an agent to do..."
          />
        </Field>
      </SectionCard>

      {/* Tool Definition */}
      <SectionCard title="Tool Definition" subtitle="The Anthropic tool schema that defines the function the agent can call. Must include name, description, and input_schema.">
        <Field label="Definition (JSON)" hint="Follows the Anthropic tool_use format: { name, description, input_schema }">
          <textarea
            value={form.definition}
            onChange={(e) => setForm({ ...form, definition: e.target.value })}
            style={{ ...monoTextareaStyle, minHeight: 200 }}
            placeholder='{ "name": "...", "description": "...", "input_schema": { "type": "object", "properties": {}, "required": [] } }'
          />
        </Field>
      </SectionCard>

      {/* Instructions */}
      <SectionCard title="Instructions" subtitle="Short guidance injected into the agent's system prompt. Tells the agent when and why to use this skill.">
        <Field label="Instructions" hint="One or two sentences. This appears alongside the tool definition in the prompt.">
          <textarea
            value={form.instructions}
            onChange={(e) => setForm({ ...form, instructions: e.target.value })}
            style={{ ...textareaStyle, minHeight: 80 }}
            placeholder="e.g. Use this skill to analyse property listings and identify pricing opportunities..."
          />
        </Field>
      </SectionCard>

      {/* Methodology */}
      <SectionCard
        title="Methodology"
        subtitle="The structured workflow document that guides how the agent uses this skill. Include phases, decision rules, quality criteria, and common mistakes. Written in Markdown."
      >
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <button
            onClick={() => setMethodologyPreview(false)}
            style={{
              padding: '4px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12, cursor: 'pointer',
              background: !methodologyPreview ? '#1e293b' : '#fff', color: !methodologyPreview ? '#fff' : '#374151',
              fontFamily: 'inherit', fontWeight: 500,
            }}
          >
            Edit
          </button>
          <button
            onClick={() => setMethodologyPreview(true)}
            style={{
              padding: '4px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12, cursor: 'pointer',
              background: methodologyPreview ? '#1e293b' : '#fff', color: methodologyPreview ? '#fff' : '#374151',
              fontFamily: 'inherit', fontWeight: 500,
            }}
          >
            Preview
          </button>
        </div>

        {!methodologyPreview ? (
          <Field label="Methodology (Markdown)" hint="Write the full workflow: phases, decision trees, quality criteria, common mistakes. This is what makes the skill powerful.">
            <textarea
              value={form.methodology}
              onChange={(e) => setForm({ ...form, methodology: e.target.value })}
              style={{ ...monoTextareaStyle, minHeight: 300 }}
              placeholder={`## Skill Methodology

### Phase 1: ...
Describe the first phase of the workflow.

### Phase 2: ...
Describe the second phase.

### Decision Rules
- **When to use**: ...
- **When not to use**: ...

### Quality Bar
- What does "good" look like?

### Common Mistakes
- What to avoid...`}
            />
          </Field>
        ) : (
          <div style={{
            background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8,
            padding: 20, fontSize: 13, lineHeight: 1.7, color: '#1e293b',
            minHeight: 200, whiteSpace: 'pre-wrap', fontFamily: 'inherit',
          }}>
            {form.methodology || <span style={{ color: '#94a3b8', fontStyle: 'italic' }}>No methodology written yet.</span>}
          </div>
        )}

        {!form.methodology && (
          <div style={{
            marginTop: 12, padding: '12px 16px', background: '#fffbeb', border: '1px solid #fef3c7',
            borderRadius: 8, fontSize: 12, color: '#92400e', lineHeight: 1.5,
          }}>
            <strong>Tip:</strong> Skills without a methodology still work, but agents won&apos;t have structured guidance on <em>how</em> to use the tool effectively.
            A good methodology includes workflow phases, decision rules for when to use the skill, quality criteria, and common mistakes to avoid.
          </div>
        )}
      </SectionCard>

      {/* Status */}
      {!isNew && (
        <SectionCard title="Status">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <label style={{ fontSize: 13, color: '#374151', fontWeight: 500 }}>Active</label>
            <button
              onClick={() => setForm({ ...form, isActive: !form.isActive })}
              style={{
                width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer',
                background: form.isActive ? '#6366f1' : '#d1d5db',
                position: 'relative', transition: 'background 0.2s',
              }}
            >
              <div style={{
                width: 18, height: 18, borderRadius: 9, background: '#fff',
                position: 'absolute', top: 3,
                left: form.isActive ? 23 : 3, transition: 'left 0.2s',
                boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
              }} />
            </button>
            <span style={{ fontSize: 12, color: '#64748b' }}>
              {form.isActive ? 'Skill is available for agents to use' : 'Skill is disabled and will not be available'}
            </span>
          </div>
        </SectionCard>
      )}

      {/* Bottom save button */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 8 }}>
        <button
          onClick={() => navigate('/system/skills')}
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
          {saving ? 'Saving...' : isNew ? 'Create Skill' : 'Save Changes'}
        </button>
      </div>
    </>
  );
}
