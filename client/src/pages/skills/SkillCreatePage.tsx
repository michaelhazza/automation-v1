/**
 * client/src/pages/skills/SkillCreatePage.tsx
 *
 * Two-stage skill creation flow: Describe → Runtime check suggestion.
 * Spec: tasks/builds/trust-verification-layer/spec.md §11.3, §14.
 *
 * Stage 1 (Describe): name, slug (auto-derived), description (>=20 chars).
 *   On "Next": POST /api/skills to create the skill (verify: null),
 *   then advance to Stage 2.
 *
 * Stage 2 (Runtime check): fetches suggestion from
 *   POST /api/skills/:id/suggest-runtime-check, shows three radio options:
 *     - Use suggested: PATCH skill with the suggestedCheck as verify
 *     - Edit (Advanced disclosure): tweak kind+parameters JSON before saving
 *     - No deterministic check possible: PATCH with verifyNullJustification
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import { suggestRuntimeCheck } from '../../lib/api/runtimeChecks';

// ── Types ─────────────────────────────────────────────────────────────────────

interface CreatedSkill {
  id: string;
  name: string;
  slug: string;
}

interface SuggestionResult {
  name: string;
  blastRadius: string;
  reversible: boolean;
  suggestedCheck: { kind: string; parameters: Record<string, unknown> };
  plainEnglish: string;
  cacheHit: boolean;
}

type RadioChoice = 'use_suggested' | 'edit' | 'no_check';

// ── Slug derivation ───────────────────────────────────────────────────────────

function deriveSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
}

function extractApiErrorMessage(
  err: unknown,
  fallback: string,
): string {
  return (
    (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
    fallback
  );
}

// ── Stage 1: Describe ─────────────────────────────────────────────────────────

function DescribeStage({ onCreated }: { onCreated: (skill: CreatedSkill, description: string) => void }) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const derivedSlug = slugTouched ? slug : deriveSlug(name);

  function handleNameChange(v: string) {
    setName(v);
    if (!slugTouched) setSlug(deriveSlug(v));
  }

  function handleSlugChange(v: string) {
    setSlug(v);
    setSlugTouched(true);
  }

  async function handleNext() {
    setError(null);
    if (description.trim().length < 20) {
      setError('Description must be at least 20 characters.');
      return;
    }
    setSaving(true);
    try {
      const { data } = await api.post<CreatedSkill>('/api/skills', {
        name: name.trim(),
        slug: derivedSlug,
        description: description.trim(),
        verify: null,
      });
      onCreated(data, description.trim());
    } catch (err: unknown) {
      setError(extractApiErrorMessage(err, 'Failed to create skill. Please try again.'));
    } finally {
      setSaving(false);
    }
  }

  const canProceed =
    name.trim().length > 0 &&
    derivedSlug.length > 0 &&
    description.trim().length >= 20 &&
    !saving;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <label className="block text-[13px] font-medium text-slate-700 mb-1">Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => handleNameChange(e.target.value)}
          placeholder="e.g. Send customer SMS"
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      <div>
        <label className="block text-[13px] font-medium text-slate-700 mb-1">Slug</label>
        <input
          type="text"
          value={derivedSlug}
          onChange={(e) => handleSlugChange(e.target.value)}
          placeholder="send_customer_sms"
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] text-slate-800 font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <p className="mt-1 text-[11px] text-slate-400">Auto-derived from name. Edit to customise.</p>
      </div>

      <div>
        <label className="block text-[13px] font-medium text-slate-700 mb-1">Description</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={4}
          placeholder="Describe what this skill does (at least 20 characters)"
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] text-slate-800 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        {description.length > 0 && description.trim().length < 20 && (
          <p className="mt-1 text-[11px] text-red-500">
            At least 20 characters required ({description.trim().length}/20).
          </p>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-[12px] text-red-700">
          {error}
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleNext}
          disabled={!canProceed}
          className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-[13px] font-medium hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? 'Saving...' : 'Next: suggest runtime check'}
        </button>
      </div>
    </div>
  );
}

// ── Stage 2: Suggest ──────────────────────────────────────────────────────────

const VALID_CHECK_KINDS = ['api_status_2xx', 'row_exists', 'field_match', 'external_returns', 'custom_handler'] as const;

function SuggestStage({
  skill,
  description,
  onDone,
}: {
  skill: CreatedSkill;
  description: string;
  onDone: () => void;
}) {
  const [suggestion, setSuggestion] = useState<SuggestionResult | null>(null);
  const [loadingSuggestion, setLoadingSuggestion] = useState(true);
  const [suggestionError, setSuggestionError] = useState<string | null>(null);

  const [choice, setChoice] = useState<RadioChoice>('use_suggested');
  const [nullJustification, setNullJustification] = useState('');
  // Advanced disclosure: editable JSON for the verify payload (kind + parameters).
  const [editedVerifyJson, setEditedVerifyJson] = useState('');
  const [editJsonError, setEditJsonError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    suggestRuntimeCheck(skill.id, { description })
      .then((result) => {
        if (!cancelled) {
          setSuggestion(result);
          setEditedVerifyJson(JSON.stringify(result.suggestedCheck, null, 2));
          setLoadingSuggestion(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSuggestionError('Could not load a suggested runtime check. You can still save the skill.');
          setLoadingSuggestion(false);
          setChoice('no_check');
        }
      });
    return () => { cancelled = true; };
  // description and skill.id are stable across the lifecycle of this stage
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skill.id]);

  function handleChoiceChange(next: RadioChoice) {
    setChoice(next);
    // Seed the editor with the current suggestion when switching to edit mode.
    if (next === 'edit' && suggestion && editedVerifyJson === '') {
      setEditedVerifyJson(JSON.stringify(suggestion.suggestedCheck, null, 2));
    }
    setEditJsonError(null);
    setSaveError(null);
  }

  async function handleSave() {
    setSaveError(null);
    setEditJsonError(null);

    if (choice === 'no_check' && nullJustification.trim().length < 20) {
      setSaveError('Justification must be at least 20 characters.');
      return;
    }

    if (choice === 'edit') {
      let parsed: unknown;
      try {
        parsed = JSON.parse(editedVerifyJson);
      } catch {
        setEditJsonError('Invalid JSON. Fix the syntax before saving.');
        return;
      }
      const p = parsed as { kind?: unknown; parameters?: unknown };
      if (typeof p?.kind !== 'string' || !VALID_CHECK_KINDS.includes(p.kind as typeof VALID_CHECK_KINDS[number])) {
        setEditJsonError(`"kind" must be one of: ${VALID_CHECK_KINDS.join(', ')}.`);
        return;
      }
    }

    setSaving(true);
    try {
      if (choice === 'use_suggested' && suggestion) {
        await api.patch(`/api/skills/${skill.id}`, {
          verify: suggestion.suggestedCheck,
        });
      } else if (choice === 'edit') {
        await api.patch(`/api/skills/${skill.id}`, {
          verify: JSON.parse(editedVerifyJson),
        });
      } else if (choice === 'no_check') {
        await api.patch(`/api/skills/${skill.id}`, {
          verify: null,
          verifyNullJustification: nullJustification.trim(),
        });
      }
      onDone();
    } catch (err: unknown) {
      setSaveError(extractApiErrorMessage(err, 'Failed to save skill. Please try again.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="text-[13px] text-slate-600">
        Skill <span className="font-medium text-slate-800">{skill.name}</span> has been created.
        Choose how to verify its output at runtime.
      </p>

      {loadingSuggestion && (
        <div className="h-20 rounded-lg bg-[linear-gradient(90deg,#f1f5f9_25%,#e2e8f0_50%,#f1f5f9_75%)] bg-[length:400%_100%] animate-[shimmer_1.4s_ease-in-out_infinite]" />
      )}

      {suggestionError && !loadingSuggestion && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-[12px] text-amber-700">
          {suggestionError}
        </div>
      )}

      <div className="flex flex-col gap-3">
        {/* Option 1: Use suggested */}
        {suggestion && !loadingSuggestion && (
          <label className="flex items-start gap-3 p-3 border border-slate-200 rounded-lg cursor-pointer hover:bg-slate-50">
            <input
              type="radio"
              name="check_choice"
              value="use_suggested"
              checked={choice === 'use_suggested'}
              onChange={() => handleChoiceChange('use_suggested')}
              className="mt-0.5"
            />
            <div className="flex flex-col gap-1">
              <span className="text-[13px] font-medium text-slate-800">Use suggested</span>
              <span className="text-[12px] text-slate-500">{suggestion.plainEnglish}</span>
              <code className="text-[11px] text-slate-400 font-mono bg-slate-50 px-2 py-1 rounded">
                {suggestion.suggestedCheck.kind}
              </code>
            </div>
          </label>
        )}

        {/* Option 2: Edit (Advanced disclosure) */}
        {suggestion && !loadingSuggestion && (
          <label className="flex items-start gap-3 p-3 border border-slate-200 rounded-lg cursor-pointer hover:bg-slate-50">
            <input
              type="radio"
              name="check_choice"
              value="edit"
              checked={choice === 'edit'}
              onChange={() => handleChoiceChange('edit')}
              className="mt-0.5"
            />
            <div className="flex flex-col gap-1 flex-1">
              <span className="text-[13px] font-medium text-slate-800">Edit (Advanced)</span>
              <span className="text-[12px] text-slate-500">
                Tweak the suggested check kind and parameters before saving.
              </span>
              {choice === 'edit' && (
                <div className="mt-2 flex flex-col gap-2">
                  <label className="text-[11px] font-medium text-slate-600 uppercase tracking-wide">
                    Verify payload (JSON)
                  </label>
                  <textarea
                    value={editedVerifyJson}
                    onChange={(e) => { setEditedVerifyJson(e.target.value); setEditJsonError(null); }}
                    rows={6}
                    spellCheck={false}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[12px] text-slate-800 font-mono resize-y focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <p className="text-[11px] text-slate-400">
                    Valid kinds: {VALID_CHECK_KINDS.join(', ')}
                  </p>
                  {editJsonError && (
                    <p className="text-[11px] text-red-500">{editJsonError}</p>
                  )}
                </div>
              )}
            </div>
          </label>
        )}

        {/* Option 3: No deterministic check possible */}
        <label className="flex items-start gap-3 p-3 border border-slate-200 rounded-lg cursor-pointer hover:bg-slate-50">
          <input
            type="radio"
            name="check_choice"
            value="no_check"
            checked={choice === 'no_check'}
            onChange={() => handleChoiceChange('no_check')}
            className="mt-0.5"
          />
          <div className="flex flex-col gap-1 flex-1">
            <span className="text-[13px] font-medium text-slate-800">
              No deterministic check possible
            </span>
            <span className="text-[12px] text-slate-500">
              Provide a justification explaining why no runtime check applies.
            </span>
            {choice === 'no_check' && (
              <div className="mt-2">
                <textarea
                  value={nullJustification}
                  onChange={(e) => setNullJustification(e.target.value)}
                  rows={3}
                  placeholder="Explain why no deterministic runtime check is possible (at least 20 characters)"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[12px] text-slate-800 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                {nullJustification.length > 0 && nullJustification.trim().length < 20 && (
                  <p className="mt-1 text-[11px] text-red-500">
                    At least 20 characters required ({nullJustification.trim().length}/20).
                  </p>
                )}
              </div>
            )}
          </div>
        </label>
      </div>

      {saveError && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-[12px] text-red-700">
          {saveError}
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-[13px] font-medium hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? 'Saving...' : 'Save skill'}
        </button>
      </div>
    </div>
  );
}

// ── SkillCreatePage ───────────────────────────────────────────────────────────

export default function SkillCreatePage() {
  const navigate = useNavigate();
  const [stage, setStage] = useState<'describe' | 'suggest'>('describe');
  const [createdSkill, setCreatedSkill] = useState<CreatedSkill | null>(null);
  const [descriptionForSuggestion, setDescriptionForSuggestion] = useState('');

  function handleSkillCreated(skill: CreatedSkill, description: string) {
    setCreatedSkill(skill);
    setDescriptionForSuggestion(description);
    setStage('suggest');
  }

  return (
    <div className="max-w-lg mx-auto py-10 px-4">
      <div className="mb-6">
        <h1 className="text-[18px] font-semibold text-slate-800">Create skill</h1>
        <div className="flex items-center gap-2 mt-2">
          <span
            className={`text-[12px] font-medium px-2 py-0.5 rounded-full ${
              stage === 'describe'
                ? 'bg-indigo-100 text-indigo-700'
                : 'bg-slate-100 text-slate-500'
            }`}
          >
            1. Describe
          </span>
          <span className="text-slate-300 text-[12px]">→</span>
          <span
            className={`text-[12px] font-medium px-2 py-0.5 rounded-full ${
              stage === 'suggest'
                ? 'bg-indigo-100 text-indigo-700'
                : 'bg-slate-100 text-slate-500'
            }`}
          >
            2. Runtime check
          </span>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-6">
        {stage === 'describe' && (
          <DescribeStage onCreated={handleSkillCreated} />
        )}
        {stage === 'suggest' && createdSkill && (
          <SuggestStage
            skill={createdSkill}
            description={descriptionForSuggestion}
            onDone={() => navigate('/skills')}
          />
        )}
      </div>
    </div>
  );
}
