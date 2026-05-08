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
 *     - No deterministic check possible: PATCH with verifyNullJustification
 *     - Skip for now: navigate away without patching
 */

import { useEffect, useState } from 'react';
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

type RadioChoice = 'use_suggested' | 'no_check' | 'skip';

// ── Slug derivation ───────────────────────────────────────────────────────────

function deriveSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
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
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        'Failed to create skill. Please try again.';
      setError(msg);
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
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    suggestRuntimeCheck(skill.id, { description })
      .then((result) => {
        if (!cancelled) {
          setSuggestion(result);
          setLoadingSuggestion(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSuggestionError('Could not load a suggested runtime check. You can still save the skill.');
          setLoadingSuggestion(false);
          setChoice('skip');
        }
      });
    return () => { cancelled = true; };
  // description and skill.id are stable across the lifecycle of this stage
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skill.id]);

  async function handleSave() {
    setSaveError(null);

    if (choice === 'no_check' && nullJustification.trim().length < 20) {
      setSaveError('Justification must be at least 20 characters.');
      return;
    }

    if (choice === 'skip') {
      onDone();
      return;
    }

    setSaving(true);
    try {
      if (choice === 'use_suggested' && suggestion) {
        await api.patch(`/api/skills/${skill.id}`, {
          verify: suggestion.suggestedCheck,
        });
      } else if (choice === 'no_check') {
        await api.patch(`/api/skills/${skill.id}`, {
          verify: null,
          verifyNullJustification: nullJustification.trim(),
        });
      }
      onDone();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        'Failed to save skill. Please try again.';
      setSaveError(msg);
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
        {suggestion && !loadingSuggestion && (
          <label className="flex items-start gap-3 p-3 border border-slate-200 rounded-lg cursor-pointer hover:bg-slate-50">
            <input
              type="radio"
              name="check_choice"
              value="use_suggested"
              checked={choice === 'use_suggested'}
              onChange={() => setChoice('use_suggested')}
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

        <label className="flex items-start gap-3 p-3 border border-slate-200 rounded-lg cursor-pointer hover:bg-slate-50">
          <input
            type="radio"
            name="check_choice"
            value="no_check"
            checked={choice === 'no_check'}
            onChange={() => setChoice('no_check')}
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

        <label className="flex items-start gap-3 p-3 border border-slate-200 rounded-lg cursor-pointer hover:bg-slate-50">
          <input
            type="radio"
            name="check_choice"
            value="skip"
            checked={choice === 'skip'}
            onChange={() => setChoice('skip')}
            className="mt-0.5"
          />
          <div className="flex flex-col gap-1">
            <span className="text-[13px] font-medium text-slate-800">Skip for now</span>
            <span className="text-[12px] text-slate-500">
              Save without a runtime check. You can add one later from the skill settings.
            </span>
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
  const [stage, setStage] = useState<'describe' | 'suggest'>('describe');
  const [createdSkill, setCreatedSkill] = useState<CreatedSkill | null>(null);
  const [descriptionForSuggestion, setDescriptionForSuggestion] = useState('');
  const [done, setDone] = useState(false);

  function handleSkillCreated(skill: CreatedSkill, description: string) {
    setCreatedSkill(skill);
    setDescriptionForSuggestion(description);
    setStage('suggest');
  }

  if (done) {
    return (
      <div className="max-w-lg mx-auto py-12 px-4">
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-6 text-center">
          <p className="text-[14px] font-medium text-emerald-700">Skill saved successfully.</p>
          <a href="/skills" className="mt-3 inline-block text-[13px] text-indigo-600 hover:underline">
            Back to skills
          </a>
        </div>
      </div>
    );
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
            onDone={() => setDone(true)}
          />
        )}
      </div>
    </div>
  );
}
