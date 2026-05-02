/**
 * SubaccountOnboardingPage — Memory & Briefings 9-step onboarding UI
 *
 * Simple step-driven UI that calls the backend onboarding routes. Renders
 * step-specific inputs including the DeliveryChannels component at Steps 6
 * and 7 and a portal-mode explainer at Step 8.
 *
 * Spec: docs/memory-and-briefings-spec.md §8 (S5)
 */

import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../lib/api';
import DeliveryChannels, {
  type DeliveryChannelConfig,
} from '../components/DeliveryChannels';

interface OnboardingStep {
  id: string;
  number: number;
  label: string;
  required: boolean;
}

interface OnboardingStatus {
  subaccountId: string;
  currentStep: OnboardingStep | null;
  answers: Record<string, unknown>;
  completedStepIds: string[];
  skipFulfilled: Record<string, boolean>;
  isReady: boolean;
}

export default function SubaccountOnboardingPage() {
  const { subaccountId } = useParams<{ subaccountId: string }>();
  const navigate = useNavigate();
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Local draft answers for the current step
  const [textAnswer, setTextAnswer] = useState('');
  const [deliveryConfig, setDeliveryConfig] = useState<DeliveryChannelConfig>({
    email: true,
    portal: true,
    slack: false,
  });

  const load = async () => {
    if (!subaccountId) return;
    try {
      const res = await api.get<{ status: OnboardingStatus }>(
        `/api/subaccounts/${subaccountId}/onboarding/next-step`,
      );
      setStatus(res.data.status);
      setError(null);
    } catch {
      setError('Failed to load onboarding state.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // reason: `load` is an inline async function that closes over state setters; only subaccountId is the intended trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subaccountId]);

  async function submit() {
    if (!status?.currentStep || !subaccountId) return;
    setSubmitting(true);
    try {
      const stepId = status.currentStep.id;
      const answers = buildAnswers(stepId, textAnswer, deliveryConfig);
      await api.post(`/api/subaccounts/${subaccountId}/onboarding/answer`, {
        stepId,
        answers,
      });
      setTextAnswer('');
      await load();
    } catch {
      setError('Submit failed.');
    } finally {
      setSubmitting(false);
    }
  }

  async function markReady() {
    if (!subaccountId) return;
    setSubmitting(true);
    try {
      await api.post(`/api/subaccounts/${subaccountId}/onboarding/mark-ready`, {});
      navigate(`/admin/subaccounts/${subaccountId}`);
    } catch (err) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        'Cannot mark ready yet.';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  const progress = useMemo(() => {
    if (!status) return 0;
    const total = 9;
    return Math.round((status.completedStepIds.length / total) * 100);
  }, [status]);

  if (loading) return <div className="p-6 text-sm text-slate-400">Loading…</div>;

  if (error) return <div className="p-6 text-sm text-red-600">{error}</div>;

  if (!status) return <div className="p-6 text-sm text-slate-400">No state.</div>;

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-xl font-semibold text-slate-800 mb-2">Subaccount Onboarding</h1>
      <div className="h-1 bg-slate-100 rounded mb-4 overflow-hidden">
        <div className="h-1 bg-indigo-500" style={{ width: `${progress}%` }} />
      </div>

      {status.currentStep ? (
        <div className="border border-slate-200 rounded-lg p-4 bg-white shadow-sm">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
            Step {status.currentStep.number} of 9
            {status.currentStep.required && (
              <span className="ml-2 text-[10px] text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">
                required
              </span>
            )}
          </p>
          <h2 className="text-base font-semibold text-slate-800 mb-3">
            {status.currentStep.label}
          </h2>

          <StepBody
            stepId={status.currentStep.id}
            textAnswer={textAnswer}
            onTextChange={setTextAnswer}
            deliveryConfig={deliveryConfig}
            onDeliveryChange={setDeliveryConfig}
            subaccountId={subaccountId!}
          />

          <div className="flex justify-end mt-4">
            <button
              type="button"
              className="px-4 py-1.5 rounded-md bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
              onClick={submit}
              disabled={submitting}
            >
              {submitting ? 'Saving…' : 'Save & continue'}
            </button>
          </div>
        </div>
      ) : (
        <div className="border border-slate-200 rounded-lg p-6 bg-white shadow-sm">
          <h2 className="text-base font-semibold text-slate-800 mb-2">All steps complete</h2>
          <p className="text-sm text-slate-600 mb-4">
            {status.isReady
              ? 'Ready to finalise the subaccount.'
              : 'Some required steps are still missing. Please complete them before continuing.'}
          </p>
          <button
            type="button"
            className="px-4 py-1.5 rounded-md bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
            onClick={markReady}
            disabled={submitting || !status.isReady}
          >
            {submitting ? 'Finalising…' : 'Mark subaccount ready'}
          </button>
        </div>
      )}
    </div>
  );
}

interface StepBodyProps {
  stepId: string;
  textAnswer: string;
  onTextChange: (v: string) => void;
  deliveryConfig: DeliveryChannelConfig;
  onDeliveryChange: (v: DeliveryChannelConfig) => void;
  subaccountId: string;
}

function StepBody({
  stepId,
  textAnswer,
  onTextChange,
  deliveryConfig,
  onDeliveryChange,
  subaccountId,
}: StepBodyProps) {
  switch (stepId) {
    case 'intelligence_briefing_config':
    case 'weekly_digest_config':
      return (
        <div>
          <p className="text-sm text-slate-600 mb-2">
            Choose where this artefact should be delivered. Email / Inbox is always on.
          </p>
          <DeliveryChannels
            subaccountId={subaccountId}
            value={deliveryConfig}
            onChange={onDeliveryChange}
          />
        </div>
      );
    case 'portal_mode':
      return (
        <div>
          <p className="text-sm text-slate-600 mb-2">Choose how much the client sees:</p>
          <ul className="text-sm text-slate-600 list-disc list-inside mb-2">
            <li><strong>Hidden</strong> — default. No portal.</li>
            <li><strong>Transparency</strong> — client sees read-only surfaces.</li>
            <li><strong>Collaborative</strong> — client can upload, answer, and interact.</li>
          </ul>
          <select
            value={textAnswer || 'hidden'}
            onChange={(e) => onTextChange(e.target.value)}
            className="text-sm border border-slate-200 rounded px-2 py-1"
          >
            <option value="hidden">Hidden</option>
            <option value="transparency">Transparency</option>
            <option value="collaborative">Collaborative</option>
          </select>
        </div>
      );
    default:
      return (
        <textarea
          className="w-full border border-slate-200 rounded p-2 text-sm"
          rows={3}
          placeholder="Your answer…"
          value={textAnswer}
          onChange={(e) => onTextChange(e.target.value)}
        />
      );
  }
}

function buildAnswers(
  stepId: string,
  textAnswer: string,
  deliveryConfig: DeliveryChannelConfig,
): Record<string, unknown> {
  switch (stepId) {
    case 'intelligence_briefing_config':
      return { 'intelligence_briefing_config.delivery_channels': deliveryConfig };
    case 'weekly_digest_config':
      return { 'weekly_digest_config.delivery_channels': deliveryConfig };
    case 'portal_mode':
      return { 'portal_mode.value': textAnswer || 'hidden' };
    default:
      return { [`${stepId}.value`]: textAnswer };
  }
}
