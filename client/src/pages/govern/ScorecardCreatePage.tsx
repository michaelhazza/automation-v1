// client/src/pages/govern/ScorecardCreatePage.tsx
// Scorecard create page.
// Trust & Verification Layer spec §12.1, §14.

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageShell } from '../../components/PageShell';
import { createScorecard, type QualityCheck } from '../../lib/api/scorecards';
import { getUserRole } from '../../lib/auth';
import { QualityCheckValidatorSection, type QualityCheckValidatorConfig } from '../../components/verdicts/QualityCheckValidatorSection';

// Default pass mark applied when the operator does not override it.
// Mirrors DEFAULT_PASS_MARK in scorecardJudgeRunnerPure (spec §6.3).
const DEFAULT_PASS_MARK_PERCENT = 70;

interface QCDraft {
  slug: string;
  name: string;
  description: string;
  /** 0..100 percent in the form; converted to 0..1 on submit. */
  passMarkPercent: number;
  enabled: boolean;
  validatorConfig?: QualityCheckValidatorConfig;
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function clamp01(v: number): number {
  if (Number.isNaN(v) || !Number.isFinite(v)) return DEFAULT_PASS_MARK_PERCENT / 100;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

export default function ScorecardCreatePage() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [shareWithSubaccounts, setShareWithSubaccounts] = useState(false);
  const isStaff = getUserRole() === 'system_admin';
  const [checks, setChecks] = useState<QCDraft[]>([
    { slug: '', name: '', description: '', passMarkPercent: DEFAULT_PASS_MARK_PERCENT, enabled: true },
  ]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function addCheck() {
    setChecks((prev) => [
      ...prev,
      { slug: '', name: '', description: '', passMarkPercent: DEFAULT_PASS_MARK_PERCENT, enabled: true },
    ]);
  }

  function updateCheck<K extends keyof QCDraft>(index: number, field: K, value: QCDraft[K]) {
    setChecks((prev) => {
      const next = [...prev];
      next[index] = { ...next[index]!, [field]: value };
      if (field === 'name' && typeof value === 'string' && !next[index]!.slug) {
        next[index]!.slug = slugify(value);
      }
      return next;
    });
  }

  function removeCheck(index: number) {
    setChecks((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError('Scorecard name is required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const qualityChecks: QualityCheck[] = checks
        .filter((c) => c.name.trim())
        .map((c) => ({
          slug: c.slug || slugify(c.name),
          name: c.name.trim(),
          description: c.description.trim() || undefined,
          // Convert 0..100 form input to the 0..1 spec scale.
          passMark: clamp01(c.passMarkPercent / 100),
          enabled: c.enabled,
          ...(c.validatorConfig?.kind && c.validatorConfig.kind !== 'semantic'
            ? {
                kind: c.validatorConfig.kind,
                validatorSlug: c.validatorConfig.validatorSlug,
                validatorParameters: c.validatorConfig.validatorParameters,
                preconditionSlugs: c.validatorConfig.preconditionSlugs,
                preconditionParameters: c.validatorConfig.preconditionParameters,
                safetyClass: c.validatorConfig.safetyClass,
              }
            : {}),
        }));
      await createScorecard({ name: name.trim(), description: description.trim() || undefined, qualityChecks, shareWithSubaccounts });
      navigate('/quality?tab=scorecards');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create scorecard.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <PageShell
      header={
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => navigate('/quality?tab=scorecards')}
              className="text-slate-400 hover:text-slate-600 transition-colors"
            >
              &larr;
            </button>
            <h1 className="text-lg font-semibold text-slate-900">Create scorecard</h1>
          </div>
        </div>
      }
    >
      <div className="max-w-xl mx-auto px-6 py-8">
        {error && (
          <div className="mb-4 rounded bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3">
            {error}
          </div>
        )}
        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full border border-slate-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
              placeholder="e.g. Response Quality"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full border border-slate-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
              rows={2}
              placeholder="Optional description"
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              id="share"
              type="checkbox"
              checked={shareWithSubaccounts}
              onChange={(e) => setShareWithSubaccounts(e.target.checked)}
              className="rounded border-slate-300"
            />
            <label htmlFor="share" className="text-sm text-slate-700">Share with workspaces</label>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-slate-700">Quality checks</span>
              <button
                type="button"
                onClick={addCheck}
                className="text-xs text-indigo-600 hover:text-indigo-700 font-medium"
              >
                + Add check
              </button>
            </div>
            <div className="space-y-3">
              {checks.map((check, i) => (
                <div key={i} className="border border-slate-200 rounded p-3 space-y-2">
                  <input
                    type="text"
                    value={check.name}
                    onChange={(e) => updateCheck(i, 'name', e.target.value)}
                    className="w-full border border-slate-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                    placeholder="Check name, e.g. Helpful response"
                  />
                  <input
                    type="text"
                    value={check.description}
                    onChange={(e) => updateCheck(i, 'description', e.target.value)}
                    className="w-full border border-slate-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                    placeholder="Description (optional)"
                  />
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 text-xs text-slate-600">
                      <span>Pass mark</span>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step={1}
                        value={check.passMarkPercent}
                        onChange={(e) =>
                          updateCheck(
                            i,
                            'passMarkPercent',
                            Number.isFinite(Number(e.target.value))
                              ? Math.max(0, Math.min(100, Number(e.target.value)))
                              : DEFAULT_PASS_MARK_PERCENT,
                          )
                        }
                        className="w-16 border border-slate-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                      />
                      <span>%</span>
                    </label>
                    <label className="flex items-center gap-2 text-xs text-slate-600">
                      <input
                        type="checkbox"
                        checked={check.enabled}
                        onChange={(e) => updateCheck(i, 'enabled', e.target.checked)}
                        className="rounded border-slate-300"
                      />
                      Enabled
                    </label>
                  </div>
                  {isStaff && (
                    <QualityCheckValidatorSection
                      value={check.validatorConfig ?? {}}
                      onChange={(cfg) => updateCheck(i, 'validatorConfig', cfg)}
                    />
                  )}
                  {checks.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeCheck(i)}
                      className="text-xs text-red-500 hover:text-red-700"
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="flex gap-3 justify-end">
            <button
              type="button"
              onClick={() => navigate('/quality?tab=scorecards')}
              className="px-4 py-2 rounded text-sm text-slate-600 border border-slate-200 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded text-sm bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Creating...' : 'Create scorecard'}
            </button>
          </div>
        </form>
      </div>
    </PageShell>
  );
}
