import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import api from '../../lib/api';
import { TIER_BY_SLUG } from '../../../../shared/constants/baselineArtefacts';
import type { BaselineSlug } from '../../../../shared/constants/baselineArtefacts';

// ---------------------------------------------------------------------------
// Form state helpers
// Arrays are stored as newline-delimited strings in the form state.
// Complex objects (pricing_tiers, uploads) are stored as pretty-printed JSON.
// ---------------------------------------------------------------------------

type FormState = Record<string, string>;

function arr(v: unknown): string {
  return Array.isArray(v) ? (v as string[]).join('\n') : '';
}

function json(v: unknown): string {
  try { return JSON.stringify(v, null, 2); } catch { return '[]'; }
}

function contentToFormState(slug: BaselineSlug, raw: unknown): FormState {
  const c = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  switch (slug) {
    case 'baseline.brand_identity':
      return {
        name:           String(c.name ?? ''),
        oneLiner:       String(c.oneLiner ?? ''),
        industry:       String(c.industry ?? ''),
        targetCustomer: String(c.targetCustomer ?? ''),
        geography:      String(c.geography ?? ''),
        stage:          String(c.stage ?? ''),
      };
    case 'baseline.voice_tone':
      return {
        descriptors:       arr(c.descriptors),
        example_sentences: arr(c.example_sentences),
        prohibited_phrases: arr(c.prohibited_phrases),
        formality_level:   String(c.formality_level ?? 'neutral'),
      };
    case 'baseline.offer_positioning':
      return {
        services:       arr(c.services),
        value_prop:     String(c.value_prop ?? ''),
        differentiators: arr(c.differentiators),
        pricing_tiers:  json(c.pricing_tiers ?? []),
      };
    case 'baseline.audience_icp':
      return {
        primary_buyer:    String(c.primary_buyer ?? ''),
        pain_points:      arr(c.pain_points),
        objections:       arr(c.objections),
        success_criteria: arr(c.success_criteria),
      };
    case 'baseline.operating_constraints':
      return {
        hours:                       String(c.hours ?? ''),
        response_time_commitments:   String(c.response_time_commitments ?? ''),
        escalation_paths:            arr(c.escalation_paths),
        compliance:                  arr(c.compliance),
        languages:                   arr(c.languages),
      };
    case 'baseline.proof_library':
      return { uploads: json(c.uploads ?? []) };
  }
}

function formStateToPayload(slug: BaselineSlug, state: FormState): Record<string, unknown> {
  const lines = (field: string) =>
    (state[field] ?? '').split('\n').map(s => s.trim()).filter(Boolean);
  const parseJson = (field: string): unknown => {
    try { return JSON.parse(state[field] ?? '[]'); } catch { return []; }
  };

  switch (slug) {
    case 'baseline.brand_identity':
      return {
        name:           state.name?.trim() ?? '',
        oneLiner:       state.oneLiner?.trim() ?? '',
        industry:       state.industry?.trim() ?? '',
        targetCustomer: state.targetCustomer?.trim() ?? '',
        geography:      state.geography?.trim() ?? '',
        stage:          state.stage?.trim() ?? '',
      };
    case 'baseline.voice_tone':
      return {
        descriptors:        lines('descriptors'),
        example_sentences:  lines('example_sentences'),
        prohibited_phrases: lines('prohibited_phrases'),
        formality_level:    state.formality_level ?? 'neutral',
      };
    case 'baseline.offer_positioning':
      return {
        services:        lines('services'),
        value_prop:      state.value_prop?.trim() ?? '',
        differentiators: lines('differentiators'),
        pricing_tiers:   parseJson('pricing_tiers'),
      };
    case 'baseline.audience_icp':
      return {
        primary_buyer:    state.primary_buyer?.trim() ?? '',
        pain_points:      lines('pain_points'),
        objections:       lines('objections'),
        success_criteria: lines('success_criteria'),
      };
    case 'baseline.operating_constraints':
      return {
        hours:                       state.hours?.trim() ?? '',
        response_time_commitments:   state.response_time_commitments?.trim() ?? '',
        escalation_paths:            lines('escalation_paths'),
        compliance:                  lines('compliance'),
        languages:                   lines('languages'),
      };
    case 'baseline.proof_library':
      return { uploads: parseJson('uploads') };
  }
}

// ---------------------------------------------------------------------------
// Fetch current content
// ---------------------------------------------------------------------------

async function fetchCurrentContent(
  subaccountId: string,
  slug: BaselineSlug,
): Promise<unknown> {
  const tier = TIER_BY_SLUG[slug];
  const shortKey = slug.split('.')[1];

  if (tier === 1 || tier === 2) {
    const { data } = await api.get<{ memoryBlocks: { name: string; content: string }[] }>(
      `/api/subaccounts/${subaccountId}/knowledge`,
    );
    const block = (data.memoryBlocks ?? []).find(b => b.name === slug);
    if (!block) return {};
    try { return JSON.parse(block.content); } catch { return {}; }
  }

  // Tier 3: workspace memory entries (domain=baseline)
  const { data } = await api.get<{ insights: { content: string; topic: string | null }[] }>(
    `/api/subaccounts/${subaccountId}/knowledge/insights?domain=baseline&topic=${shortKey}`,
  );
  const insight = (data.insights ?? []).find(i => i.topic === shortKey);
  if (!insight) return {};
  try { return JSON.parse(insight.content); } catch { return {}; }
}

// ---------------------------------------------------------------------------
// Form field components
// ---------------------------------------------------------------------------

const inputCls =
  'w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500';
const labelCls = 'block text-[12px] font-semibold text-slate-600 mb-1';
const helpCls  = 'text-[11px] text-slate-400 mt-1';

function TextField({ label, field, state, setState, required }: {
  label: string; field: string;
  state: FormState; setState: (s: FormState) => void;
  required?: boolean;
}) {
  return (
    <div>
      <label className={labelCls}>{label}</label>
      <input
        type="text"
        value={state[field] ?? ''}
        onChange={e => setState({ ...state, [field]: e.target.value })}
        className={inputCls}
        required={required}
      />
    </div>
  );
}

function TextAreaField({ label, field, state, setState, help, rows = 3 }: {
  label: string; field: string;
  state: FormState; setState: (s: FormState) => void;
  help?: string; rows?: number;
}) {
  return (
    <div>
      <label className={labelCls}>{label}</label>
      <textarea
        value={state[field] ?? ''}
        onChange={e => setState({ ...state, [field]: e.target.value })}
        className={inputCls}
        rows={rows}
      />
      {help && <p className={helpCls}>{help}</p>}
    </div>
  );
}

function SelectField({ label, field, state, setState, options }: {
  label: string; field: string;
  state: FormState; setState: (s: FormState) => void;
  options: string[];
}) {
  return (
    <div>
      <label className={labelCls}>{label}</label>
      <select
        value={state[field] ?? options[0]}
        onChange={e => setState({ ...state, [field]: e.target.value })}
        className={inputCls}
      >
        {options.map(o => (
          <option key={o} value={o}>{o.charAt(0).toUpperCase() + o.slice(1)}</option>
        ))}
      </select>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-slug form renderer
// ---------------------------------------------------------------------------

function ArtefactForm({ slug, state, setState }: {
  slug: BaselineSlug; state: FormState; setState: (s: FormState) => void;
}) {
  switch (slug) {
    case 'baseline.brand_identity':
      return (
        <div className="space-y-4">
          <TextField label="Client name" field="name" state={state} setState={setState} required />
          <TextField label="One-line description" field="oneLiner" state={state} setState={setState} />
          <TextField label="Industry" field="industry" state={state} setState={setState} required />
          <TextField label="Target customer" field="targetCustomer" state={state} setState={setState} required />
          <TextField label="Geography" field="geography" state={state} setState={setState} required />
          <TextField label="Business stage" field="stage" state={state} setState={setState} required />
        </div>
      );

    case 'baseline.voice_tone':
      return (
        <div className="space-y-4">
          <TextAreaField
            label="Tone descriptors"
            field="descriptors"
            state={state} setState={setState}
            help="One descriptor per line. Minimum 3, maximum 5."
            rows={4}
          />
          <TextAreaField
            label="Example sentences"
            field="example_sentences"
            state={state} setState={setState}
            help="One example per line. Minimum 2, maximum 3."
            rows={4}
          />
          <TextAreaField
            label="Prohibited phrases"
            field="prohibited_phrases"
            state={state} setState={setState}
            help="One phrase per line."
            rows={3}
          />
          <SelectField
            label="Formality level"
            field="formality_level"
            state={state} setState={setState}
            options={['casual', 'neutral', 'formal']}
          />
        </div>
      );

    case 'baseline.offer_positioning':
      return (
        <div className="space-y-4">
          <TextAreaField
            label="Services offered"
            field="services"
            state={state} setState={setState}
            help="One service per line."
            rows={4}
          />
          <TextAreaField
            label="Value proposition"
            field="value_prop"
            state={state} setState={setState}
            rows={3}
          />
          <TextAreaField
            label="Differentiators"
            field="differentiators"
            state={state} setState={setState}
            help="One differentiator per line."
            rows={4}
          />
          <TextAreaField
            label="Pricing tiers (JSON)"
            field="pricing_tiers"
            state={state} setState={setState}
            help={'Array of { "name": "...", "description": "..." } objects.'}
            rows={5}
          />
        </div>
      );

    case 'baseline.audience_icp':
      return (
        <div className="space-y-4">
          <TextField label="Primary buyer" field="primary_buyer" state={state} setState={setState} required />
          <TextAreaField
            label="Pain points"
            field="pain_points"
            state={state} setState={setState}
            help="One per line."
            rows={4}
          />
          <TextAreaField
            label="Objections"
            field="objections"
            state={state} setState={setState}
            help="One per line."
            rows={4}
          />
          <TextAreaField
            label="Success criteria"
            field="success_criteria"
            state={state} setState={setState}
            help="One per line."
            rows={4}
          />
        </div>
      );

    case 'baseline.operating_constraints':
      return (
        <div className="space-y-4">
          <TextField label="Business hours" field="hours" state={state} setState={setState} required />
          <TextField label="Response time commitments" field="response_time_commitments" state={state} setState={setState} required />
          <TextAreaField
            label="Escalation paths"
            field="escalation_paths"
            state={state} setState={setState}
            help="One per line."
            rows={3}
          />
          <TextAreaField
            label="Compliance requirements"
            field="compliance"
            state={state} setState={setState}
            help="One per line."
            rows={3}
          />
          <TextAreaField
            label="Languages supported"
            field="languages"
            state={state} setState={setState}
            help="One per line."
            rows={3}
          />
        </div>
      );

    case 'baseline.proof_library':
      return (
        <div className="space-y-4">
          <p className="text-[12px] text-slate-500">
            Proof library documents are linked by their reference IDs.
            Edit the JSON below to update document associations and tags.
          </p>
          <TextAreaField
            label="Uploads (JSON)"
            field="uploads"
            state={state} setState={setState}
            help={'Array of { "referenceDocumentId": "uuid", "tags": ["tag1"] } objects.'}
            rows={8}
          />
        </div>
      );
  }
}

// ---------------------------------------------------------------------------
// Drawer
// ---------------------------------------------------------------------------

export interface EditArtefactDrawerProps {
  artefactSlug: string;
  subaccountId: string;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

function slugLabel(slug: string): string {
  const short = slug.split('.')[1] ?? slug;
  return short.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
}

export default function EditArtefactDrawer({
  artefactSlug,
  subaccountId,
  open,
  onClose,
  onSaved,
}: EditArtefactDrawerProps) {
  const [formState, setFormState] = useState<FormState>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const slug = artefactSlug as BaselineSlug;

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetchCurrentContent(subaccountId, slug)
      .then(content => setFormState(contentToFormState(slug, content)))
      .catch(() => setFormState(contentToFormState(slug, {})))
      .finally(() => setLoading(false));
  }, [open, subaccountId, slug]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      const payload = formStateToPayload(slug, formState);
      await api.patch(`/api/subaccounts/${subaccountId}/baseline-artefacts/${encodeURIComponent(artefactSlug)}`, { payload });
      toast.success(`${slugLabel(artefactSlug)} updated`);
      onSaved();
      onClose();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string; details?: string } } };
      const msg = e?.response?.data?.error ?? 'Failed to save changes';
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-900/40"
      onClick={onClose}
    >
      <aside
        className="w-full max-w-[480px] h-full bg-white flex flex-col shadow-2xl"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Edit ${slugLabel(artefactSlug)}`}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">Baseline artefact</div>
            <div className="text-[14.5px] font-semibold text-slate-900 mt-0.5">{slugLabel(artefactSlug)}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close drawer"
            className="w-7 h-7 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center text-base leading-none border-0 cursor-pointer font-[inherit]"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-10 rounded-lg bg-slate-100 animate-pulse" />
              ))}
            </div>
          ) : (
            <form id="artefact-edit-form" onSubmit={handleSubmit}>
              <ArtefactForm slug={slug} state={formState} setState={setFormState} />
            </form>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-slate-100 flex justify-end gap-3 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-[13px] text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg border-0 cursor-pointer font-[inherit]"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="artefact-edit-form"
            disabled={saving || loading}
            className="px-4 py-2 text-[13px] text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded-lg border-0 cursor-pointer font-[inherit]"
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </aside>
    </div>,
    document.body,
  );
}
