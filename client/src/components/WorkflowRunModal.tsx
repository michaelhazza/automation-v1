/**
 * WorkflowRunModal — four-step wizard to start a Workflow run from the
 * Workflow Studio (spec §9.1 / §9.2, also referenced by onboarding §10
 * flows that pre-fill subaccount).
 *
 * Steps:
 *   1. Subaccount — dropdown populated from GET /api/subaccounts.
 *      May be pre-filled and locked when the caller already knows the
 *      target workspace (e.g. onboarding tab).
 *   2. Initial input — JSON textarea. The stored definition strips Zod
 *      (initialInputSchema becomes `z.any()` on serialise), so a typed
 *      form is not possible without a second schema-publication path.
 *      JSON is the honest boundary for v1; bad shapes fail fast at the
 *      validator which raises a 400 back to the UI.
 *   3. Review plan — name + description + ordered step list from the
 *      stored definition. This is read-only; authoring stays in Studio.
 *   4. Run — supervised-mode toggle (§9.2) and Start button. On success
 *      we navigate to the subaccount run page for live progress (§9.3).
 *
 * The modal deliberately does NOT stream run progress in-place — the
 * WorkflowRunPage at /sub/:subaccountId/runs/:runId already provides the
 * authoritative WS-driven view, and duplicating that here would fork the
 * live-update code path.
 */

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import api from '../lib/api';
import Modal from './Modal';

// Mirror the shape returned by GET /api/subaccounts — only the fields we use.
interface SubaccountRow {
  id: string;
  name: string;
  status: string;
}

interface StepRow {
  id: string;
  name: string;
  description?: string;
  type: string;
  sideEffectType?: string;
  dependsOn?: string[];
}

interface SystemTemplate {
  slug: string;
  name: string;
  description: string | null;
}

interface SystemTemplateVersion {
  version: number;
  definitionJson: {
    name?: string;
    description?: string;
    steps?: StepRow[];
  };
}

interface WorkflowRunModalProps {
  slug: string;
  /** Pre-fill + lock the subaccount selector. Onboarding paths set this. */
  lockedSubaccountId?: string;
  onClose: () => void;
  /** Fired after a run is successfully started (before navigation). */
  onStarted?: (runId: string, subaccountId: string) => void;
}

type Step = 'subaccount' | 'input' | 'review' | 'run';
const STEPS: Step[] = ['subaccount', 'input', 'review', 'run'];
const STEP_LABELS: Record<Step, string> = {
  subaccount: 'Subaccount',
  input: 'Initial input',
  review: 'Review plan',
  run: 'Run',
};

const inputCls =
  'w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500';

export default function WorkflowRunModal({
  slug,
  lockedSubaccountId,
  onClose,
  onStarted,
}: WorkflowRunModalProps) {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>(lockedSubaccountId ? 'input' : 'subaccount');
  const [subaccounts, setSubaccounts] = useState<SubaccountRow[]>([]);
  const [subaccountId, setSubaccountId] = useState<string>(lockedSubaccountId ?? '');
  const [template, setTemplate] = useState<SystemTemplate | null>(null);
  const [latestVersion, setLatestVersion] = useState<SystemTemplateVersion | null>(null);
  const [loading, setLoading] = useState(true);
  const [inputJson, setInputJson] = useState('{}');
  const [inputError, setInputError] = useState<string | null>(null);
  const [supervised, setSupervised] = useState(false);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [subsRes, tplRes] = await Promise.all([
          lockedSubaccountId
            ? Promise.resolve({ data: [] as SubaccountRow[] })
            : api.get('/api/subaccounts'),
          api.get(`/api/system/Workflow-templates/${slug}`),
        ]);
        if (cancelled) return;
        if (!lockedSubaccountId) {
          setSubaccounts(subsRes.data ?? []);
        }
        setTemplate(tplRes.data?.template ?? null);
        setLatestVersion(tplRes.data?.latestVersion ?? null);
      } catch (err: unknown) {
        const msg =
          (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
          'Failed to load Workflow';
        toast.error(msg);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [slug, lockedSubaccountId]);

  const parsedInput = useMemo(() => {
    try {
      const parsed = JSON.parse(inputJson || '{}');
      return { ok: true as const, value: parsed as Record<string, unknown> };
    } catch (err) {
      return {
        ok: false as const,
        error: err instanceof Error ? err.message : 'Invalid JSON',
      };
    }
  }, [inputJson]);

  function canAdvance(): boolean {
    if (step === 'subaccount') return Boolean(subaccountId);
    if (step === 'input') return parsedInput.ok;
    return true;
  }

  function goNext() {
    if (!canAdvance()) {
      if (step === 'input' && !parsedInput.ok) {
        setInputError(parsedInput.error);
      }
      return;
    }
    setInputError(null);
    const idx = STEPS.indexOf(step);
    if (idx < STEPS.length - 1) setStep(STEPS[idx + 1]);
  }

  function goBack() {
    const idx = STEPS.indexOf(step);
    if (idx > 0) setStep(STEPS[idx - 1]);
  }

  async function handleStart() {
    if (!subaccountId) return;
    if (!parsedInput.ok) {
      setInputError(parsedInput.error);
      setStep('input');
      return;
    }
    setStarting(true);
    try {
      const res = await api.post(`/api/subaccounts/${subaccountId}/Workflow-runs`, {
        systemTemplateSlug: slug,
        input: parsedInput.value,
        runMode: supervised ? 'supervised' : 'auto',
      });
      // startRun shape varies: some paths return { runId }, others wrap it in { run }.
      const runId =
        (res.data as { runId?: string; run?: { id?: string } })?.runId ??
        (res.data as { runId?: string; run?: { id?: string } })?.run?.id;
      if (!runId) {
        toast.error('Run started but no ID returned');
        return;
      }
      toast.success('Workflow run started');
      onStarted?.(runId, subaccountId);
      onClose();
      navigate(`/sub/${subaccountId}/runs/${runId}`);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        'Failed to start run';
      toast.error(msg);
    } finally {
      setStarting(false);
    }
  }

  const definition = latestVersion?.definitionJson;
  const steps: StepRow[] = Array.isArray(definition?.steps) ? (definition!.steps as StepRow[]) : [];

  return (
    <Modal
      title={`Run Workflow${template?.name ? ` — ${template.name}` : ''}`}
      onClose={onClose}
      maxWidth={640}
      disableBackdropClose={starting}
    >
      <div className="flex flex-col gap-4">
        <StepHeader step={step} />

        {loading ? (
          <div className="py-10 text-center text-slate-400 text-[13px]">Loading…</div>
        ) : (
          <>
            {step === 'subaccount' && (
              <div>
                <label className="block text-[13px] font-medium text-slate-700 mb-1">
                  Target subaccount *
                </label>
                {subaccounts.length === 0 ? (
                  <div className="text-[13px] text-slate-500 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg">
                    No subaccounts available. You need SUBACCOUNTS_VIEW permission to start runs.
                  </div>
                ) : (
                  <select
                    value={subaccountId}
                    onChange={(e) => setSubaccountId(e.target.value)}
                    className={inputCls}
                  >
                    <option value="">Select a subaccount…</option>
                    {subaccounts.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                        {s.status === 'archived' ? ' (archived)' : ''}
                      </option>
                    ))}
                  </select>
                )}
                <p className="text-[12px] text-slate-500 mt-2">
                  The run will execute in this subaccount's context — its agents, memory, and
                  connectors.
                </p>
              </div>
            )}

            {step === 'input' && (
              <div>
                <label className="block text-[13px] font-medium text-slate-700 mb-1">
                  Initial input (JSON)
                </label>
                <textarea
                  value={inputJson}
                  onChange={(e) => {
                    setInputJson(e.target.value);
                    setInputError(null);
                  }}
                  rows={10}
                  spellCheck={false}
                  className={`${inputCls} font-mono text-[12px] resize-vertical`}
                  placeholder={'{\n  "eventName": "Spring launch"\n}'}
                />
                {inputError && (
                  <div className="mt-1.5 text-[12px] text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">
                    {inputError}
                  </div>
                )}
                <p className="text-[12px] text-slate-500 mt-2">
                  Matches the Workflow's <code>initialInputSchema</code>. Invalid shapes fail at the
                  server validator.
                </p>
              </div>
            )}

            {step === 'review' && (
              <div className="flex flex-col gap-3">
                {template?.description && (
                  <p className="text-[13px] text-slate-700 m-0">{template.description}</p>
                )}
                <div className="text-[12px] uppercase tracking-wider text-slate-500">
                  Steps ({steps.length})
                </div>
                <ol className="bg-slate-50 border border-slate-200 rounded-lg divide-y divide-slate-200 max-h-60 overflow-auto m-0 p-0 list-none">
                  {steps.length === 0 ? (
                    <li className="p-3 text-[13px] text-slate-500">
                      No steps found in the stored definition.
                    </li>
                  ) : (
                    steps.map((s, i) => (
                      <li key={s.id} className="p-3 flex items-start gap-3">
                        <span className="text-[11px] text-slate-400 font-mono mt-0.5">
                          {String(i + 1).padStart(2, '0')}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="text-[13px] font-medium text-slate-800 truncate">
                            {s.name || s.id}
                          </div>
                          <div className="text-[11px] text-slate-500 mt-0.5 flex flex-wrap gap-1">
                            <span className="px-1.5 py-0.5 bg-white border border-slate-200 rounded">
                              {s.type}
                            </span>
                            {s.sideEffectType && s.sideEffectType !== 'none' && (
                              <span className="px-1.5 py-0.5 bg-amber-50 text-amber-700 border border-amber-200 rounded">
                                {s.sideEffectType}
                              </span>
                            )}
                            {s.dependsOn && s.dependsOn.length > 0 && (
                              <span className="text-slate-400">
                                depends on {s.dependsOn.join(', ')}
                              </span>
                            )}
                          </div>
                        </div>
                      </li>
                    ))
                  )}
                </ol>
              </div>
            )}

            {step === 'run' && (
              <div className="flex flex-col gap-3">
                <div className="text-[13px] text-slate-700">
                  Ready to start <strong>{template?.name ?? slug}</strong> on{' '}
                  <strong>
                    {subaccounts.find((s) => s.id === subaccountId)?.name ??
                      (lockedSubaccountId ? 'selected subaccount' : 'unknown')}
                  </strong>
                  .
                </div>
                <label className="flex items-start gap-2 text-[13px] text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={supervised}
                    onChange={(e) => setSupervised(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="font-medium">Supervised mode</span>
                    <span className="block text-[12px] text-slate-500 mt-0.5">
                      Pauses before every side-effecting step for explicit approval. Use for
                      first-time runs or high-stakes Workflows.
                    </span>
                  </span>
                </label>
              </div>
            )}
          </>
        )}

        <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-4">
          <button
            onClick={step === 'subaccount' ? onClose : goBack}
            disabled={starting}
            className="px-4 py-2 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 rounded-lg text-[13px] font-medium cursor-pointer disabled:opacity-50"
          >
            {step === 'subaccount' ? 'Cancel' : 'Back'}
          </button>
          {step !== 'run' ? (
            <button
              onClick={goNext}
              disabled={!canAdvance() || loading}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg text-[13px] font-semibold cursor-pointer"
            >
              Next
            </button>
          ) : (
            <button
              onClick={handleStart}
              disabled={starting || !subaccountId}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg text-[13px] font-semibold cursor-pointer"
            >
              {starting ? 'Starting…' : supervised ? 'Start (supervised)' : 'Start run'}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}

function StepHeader({ step }: { step: Step }) {
  const idx = STEPS.indexOf(step);
  return (
    <div className="flex items-center gap-2">
      {STEPS.map((s, i) => (
        <div key={s} className="flex items-center gap-2 flex-1">
          <div
            className={`flex items-center gap-1.5 text-[12px] font-medium ${
              i === idx
                ? 'text-indigo-700'
                : i < idx
                  ? 'text-emerald-600'
                  : 'text-slate-400'
            }`}
          >
            <span
              className={`inline-flex w-5 h-5 rounded-full items-center justify-center text-[10px] font-semibold ${
                i === idx
                  ? 'bg-indigo-100 text-indigo-700'
                  : i < idx
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-slate-100 text-slate-500'
              }`}
            >
              {i < idx ? '✓' : i + 1}
            </span>
            <span>{STEP_LABELS[s]}</span>
          </div>
          {i < STEPS.length - 1 && (
            <div
              className={`flex-1 h-px ${i < idx ? 'bg-emerald-200' : 'bg-slate-200'}`}
            />
          )}
        </div>
      ))}
    </div>
  );
}
