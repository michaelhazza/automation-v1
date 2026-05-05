import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { User } from '../lib/auth';
import ParameterBuilder from '../components/ParameterBuilder';

interface SkillForm {
  name: string; slug: string; description: string;
  instructions: string; definition: string; isActive: boolean;
}

const EMPTY_FORM: SkillForm = {
  name: '', slug: '', description: '', instructions: '',
  definition: JSON.stringify({ name: '', description: '', input_schema: { type: 'object', properties: {}, required: [] } }, null, 2),
  isActive: true,
};

function SectionCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl mb-5">
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

const inputCls = 'w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-slate-50 disabled:text-slate-400';
const textareaCls = `${inputCls} resize-vertical min-h-[120px]`;
const monoCls = `${textareaCls} font-mono text-[12px] min-h-[160px]`;

export default function AdminSkillEditPage({ user: _user }: { user: User }) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isNew = id === 'new';

  const [form, setForm] = useState<SkillForm>(EMPTY_FORM);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState('');
  const [saveError, setSaveError] = useState('');
  const [isBuiltIn, setIsBuiltIn] = useState(false);

  const loadSkill = async (skillId: string) => {
    try {
      const { data } = await api.get(`/api/skills/${skillId}`);
      setIsBuiltIn(data.skillType === 'built_in');
      setForm({
        name: data.name ?? '', slug: data.slug ?? '', description: data.description ?? '',
        instructions: data.instructions ?? '',
        definition: JSON.stringify(data.definition, null, 2), isActive: data.isActive,
      });
    } finally { setLoading(false); }
  };

  useEffect(() => { if (!isNew && id) loadSkill(id); }, [id, isNew]);

  const handleSave = async () => {
    setSaveError(''); setSaveSuccess('');
    if (!form.name.trim()) { setSaveError('Name is required.'); return; }
    if (!form.slug.trim()) { setSaveError('Slug is required.'); return; }
    let definition: Record<string, unknown>;
    try { definition = JSON.parse(form.definition); } catch { setSaveError('Tool definition must be valid JSON.'); return; }
    // Keep name/description in sync with the form fields
    definition.name = form.slug;
    definition.description = form.description;
    setSaving(true);
    try {
      const payload = { name: form.name, slug: form.slug, description: form.description || null, instructions: form.instructions || null, definition, isActive: form.isActive };
      if (isNew) {
        const { data } = await api.post('/api/skills', payload);
        navigate(`/admin/skills/${data.id}`, { replace: true });
      } else {
        await api.patch(`/api/skills/${id}`, payload);
        setSaveSuccess('Skill saved successfully.'); loadSkill(id!);
      }
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setSaveError(e.response?.data?.error ?? 'Failed to save.');
    } finally { setSaving(false); }
  };

  const autoSlug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

  if (loading) return <div className="p-12 text-center text-sm text-slate-500">Loading...</div>;

  return (
    <div className="animate-[fadeIn_0.2s_ease-out_both]">
      <div className="flex justify-between items-center mb-6">
        <div>
          <button onClick={() => navigate('/admin/skills')} className="text-[13px] text-indigo-600 hover:text-indigo-700 bg-transparent border-0 cursor-pointer p-0 mb-2">
            ← Back to Skills
          </button>
          <h1 className="text-[28px] font-bold text-slate-800 m-0">
            {isNew ? 'New Custom Skill' : isBuiltIn ? `${form.name} (Built-in)` : form.name}
          </h1>
          {isBuiltIn && (
            <p className="text-[13px] text-slate-500 mt-2">
              Built-in skills are read-only. View the tool definition and instructions to understand what this skill does.
            </p>
          )}
        </div>
        {!isBuiltIn && (
          <button onClick={handleSave} disabled={saving} className="btn btn-primary disabled:bg-slate-400">
            {saving ? 'Saving...' : isNew ? 'Create Skill' : 'Save Changes'}
          </button>
        )}
      </div>

      {saveSuccess && <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-2.5 mb-4 text-[13px] text-green-700">{saveSuccess}</div>}
      {saveError && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2.5 mb-4 text-[13px] text-red-600">{saveError}</div>}

      <SectionCard title="Basic Information">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Name" hint="Human-readable name for this skill">
            <input value={form.name} onChange={(e) => { const name = e.target.value; setForm({ ...form, name, ...(isNew ? { slug: autoSlug(name) } : {}) }); }} className={inputCls} disabled={isBuiltIn} placeholder="e.g. Real Estate Listing Analysis" />
          </Field>
          <Field label="Slug" hint="Unique identifier used in agent configuration">
            <input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} className={`${inputCls} font-mono text-[12px]`} disabled={isBuiltIn || !isNew} placeholder="e.g. real_estate_listing_analysis" />
          </Field>
        </div>
        <Field label="Description" hint="Brief description shown in the skills library">
          <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={`${textareaCls} min-h-[60px]`} disabled={isBuiltIn} placeholder="Describe what this skill enables an agent to do..." />
        </Field>
      </SectionCard>

      <SectionCard title="Parameters" subtitle="Define the input parameters this skill accepts. The tool definition JSON is auto-generated from the slug, description, and parameters below.">
        <ParameterBuilder
          definitionJson={form.definition}
          slug={form.slug}
          description={form.description}
          onChange={(definitionJson) => setForm({ ...form, definition: definitionJson })}
          disabled={isBuiltIn}
        />
      </SectionCard>

      <SectionCard title="Instructions" subtitle="All guidance for the agent: when to use this skill, workflow phases, decision rules, quality criteria. Written in Markdown.">
        <Field label="Instructions (Markdown)" hint="This is injected into the agent's system prompt alongside the tool definition. Include everything the agent needs to use this skill well.">
          <textarea value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })} className={`${monoCls} min-h-[300px]`} disabled={isBuiltIn} placeholder={`When to use this skill, workflow phases, decision rules, quality criteria, common mistakes to avoid...`} />
        </Field>
      </SectionCard>

      {!isNew && !isBuiltIn && (
        <SectionCard title="Status">
          <div className="flex items-center gap-3">
            <label className="text-[13px] font-medium text-slate-700">Active</label>
            <button onClick={() => setForm({ ...form, isActive: !form.isActive })} className={`relative w-11 h-6 rounded-full border-0 cursor-pointer transition-colors ${form.isActive ? 'bg-indigo-600' : 'bg-slate-300'}`}>
              <div className={`absolute top-[3px] w-[18px] h-[18px] rounded-full bg-white shadow transition-all ${form.isActive ? 'left-[23px]' : 'left-[3px]'}`} />
            </button>
            <span className="text-[12px] text-slate-500">{form.isActive ? 'Skill is available for agents to use' : 'Skill is disabled and will not be available'}</span>
          </div>
        </SectionCard>
      )}

      {!isBuiltIn && (
        <div className="flex justify-end gap-3 mt-2">
          <button onClick={() => navigate('/admin/skills')} className="btn btn-ghost">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="btn btn-primary disabled:bg-slate-400">
            {saving ? 'Saving...' : isNew ? 'Create Skill' : 'Save Changes'}
          </button>
        </div>
      )}
    </div>
  );
}
