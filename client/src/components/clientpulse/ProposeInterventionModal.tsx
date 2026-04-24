import { useState, useEffect } from 'react';
import Modal from '../Modal';
import api from '../../lib/api';
import { toast } from 'sonner';
import FireAutomationEditor from './FireAutomationEditor';
import EmailAuthoringEditor from './EmailAuthoringEditor';
import SendSmsEditor from './SendSmsEditor';
import CreateTaskEditor from './CreateTaskEditor';
import OperatorAlertEditor from './OperatorAlertEditor';
import SparklineChart from './SparklineChart';

export type InterventionActionType =
  | 'crm.fire_automation'
  | 'crm.send_email'
  | 'crm.send_sms'
  | 'crm.create_task'
  | 'notify_operator';

export interface InterventionContext {
  subaccount: { id: string; name: string };
  band: 'healthy' | 'watch' | 'atRisk' | 'critical' | null;
  healthScore: number | null;
  healthScoreDelta7d: number | null;
  topSignals: Array<{ signal: string; contribution: number }>;
  recentInterventions: Array<{
    id: string;
    actionType: string;
    status: string;
    occurredAt: string;
    templateSlug: string | null;
  }>;
  cooldownState: { blocked: boolean; reason?: string };
  recommendedActionType: InterventionActionType | null;
  recommendedReason: 'outcome_weighted' | 'priority_fallback' | 'no_candidates' | null;
}

interface Props {
  subaccountId: string;
  subaccountName: string;
  onClose: () => void;
  onSubmitted: (action: { id: string; actionType: string }) => void;
}

const BAND_SCORES: Record<string, number> = {
  healthy: 80,
  watch: 60,
  at_risk: 35,
  atRisk: 35,
  critical: 10,
};

const ACTION_OPTIONS: Array<{ type: InterventionActionType; label: string; description: string }> = [
  { type: 'crm.fire_automation', label: 'Fire automation', description: "Trigger an existing CRM workflow on a contact." },
  { type: 'crm.send_email', label: 'Send email', description: "Author + send an email to a contact." },
  { type: 'crm.send_sms', label: 'Send SMS', description: "Send a direct SMS to a contact." },
  { type: 'crm.create_task', label: 'Create task', description: "Assign a task to a CRM user." },
  { type: 'notify_operator', label: 'Operator alert', description: "Notify agency operators internally." },
];

export default function ProposeInterventionModal({ subaccountId, subaccountName, onClose, onSubmitted }: Props) {
  const [context, setContext] = useState<InterventionContext | null>(null);
  const [contextError, setContextError] = useState<string | null>(null);
  const [picked, setPicked] = useState<InterventionActionType | null>(null);
  const [bandHistory, setBandHistory] = useState<number[]>([]);

  useEffect(() => {
    let cancelled = false;
    api.get(`/api/clientpulse/subaccounts/${subaccountId}/intervention-context`)
      .then((res) => { if (!cancelled) setContext(res.data); })
      .catch((err) => {
        console.error('intervention-context failed', err);
        if (!cancelled) setContextError(err?.response?.data?.message ?? 'Unable to load context');
      });
    return () => { cancelled = true; };
  }, [subaccountId]);

  useEffect(() => {
    let cancelled = false;
    api.get(`/api/clientpulse/subaccounts/${subaccountId}/band-transitions?windowDays=90`)
      .then((res) => {
        if (cancelled) return;
        const transitions = (res.data as { transitions: Array<{ fromBand: string; toBand: string; changedAt: string }> }).transitions;
        if (!transitions?.length) return;
        const scores: number[] = [];
        if (transitions[0]) {
          const first = BAND_SCORES[transitions[0].fromBand];
          if (first != null) scores.push(first);
        }
        for (const t of transitions) {
          const score = BAND_SCORES[t.toBand];
          if (score != null) scores.push(score);
        }
        setBandHistory(scores.slice(-12));
      })
      .catch(() => {
        // silent — chart is optional
      });
    return () => { cancelled = true; };
  }, [subaccountId]);

  const handleSubmit = async (actionType: InterventionActionType, payload: Record<string, unknown>, rationale: string, extras?: { templateSlug?: string; scheduleHint?: 'immediate' | 'delay_24h' | 'scheduled' }) => {
    try {
      const res = await api.post(
        `/api/clientpulse/subaccounts/${subaccountId}/interventions/propose`,
        {
          actionType,
          payload,
          rationale,
          templateSlug: extras?.templateSlug,
          scheduleHint: extras?.scheduleHint ?? 'immediate',
        },
      );
      toast.success(`Intervention queued for review (#${res.data.id.slice(0, 8)})`);
      onSubmitted(res.data);
      onClose();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string; errorCode?: string } } };
      const message = e?.response?.data?.message ?? 'Submission failed';
      toast.error(message);
    }
  };

  const renderRightPane = () => {
    if (picked === 'crm.fire_automation' && context) return <FireAutomationEditor subaccountId={subaccountId} context={context} onCancel={() => setPicked(null)} onSubmit={(payload, rationale, extras) => handleSubmit('crm.fire_automation', payload, rationale, extras)} />;
    if (picked === 'crm.send_email' && context) return <EmailAuthoringEditor subaccountId={subaccountId} context={context} onCancel={() => setPicked(null)} onSubmit={(payload, rationale, extras) => handleSubmit('crm.send_email', payload, rationale, extras)} />;
    if (picked === 'crm.send_sms' && context) return <SendSmsEditor subaccountId={subaccountId} context={context} onCancel={() => setPicked(null)} onSubmit={(payload, rationale, extras) => handleSubmit('crm.send_sms', payload, rationale, extras)} />;
    if (picked === 'crm.create_task' && context) return <CreateTaskEditor subaccountId={subaccountId} context={context} onCancel={() => setPicked(null)} onSubmit={(payload, rationale, extras) => handleSubmit('crm.create_task', payload, rationale, extras)} />;
    if (picked === 'notify_operator' && context) return <OperatorAlertEditor context={context} onCancel={() => setPicked(null)} onSubmit={(payload, rationale) => handleSubmit('notify_operator', payload, rationale)} />;
    return (
      <div className="space-y-3">
        <p className="text-[13px] text-slate-500">Choose an intervention type for <strong>{subaccountName}</strong>.</p>
        <div className="space-y-2">
          {ACTION_OPTIONS.map((opt) => {
            const recommended = context?.recommendedActionType === opt.type;
            return (
              <button
                key={opt.type}
                onClick={() => setPicked(opt.type)}
                className={`w-full text-left px-4 py-3 rounded-lg border transition ${
                  recommended ? 'border-indigo-300 bg-indigo-50/50' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[13.5px] font-semibold text-slate-900">{opt.label}</span>
                  {recommended && (
                    <span
                      className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 font-semibold uppercase"
                      title={
                        context?.recommendedReason === 'outcome_weighted'
                          ? 'Picked because it produced the best outcomes on similar at-risk clients.'
                          : context?.recommendedReason === 'priority_fallback'
                          ? 'Not enough outcome data yet — falling back to configured priority.'
                          : 'Recommended'
                      }
                    >
                      {context?.recommendedReason === 'outcome_weighted'
                        ? 'Recommended · outcome-weighted'
                        : context?.recommendedReason === 'priority_fallback'
                        ? 'Recommended · priority fallback'
                        : 'Recommended'}
                    </span>
                  )}
                </div>
                <p className="text-[12px] text-slate-500 mt-0.5">{opt.description}</p>
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  const renderContextPane = () => {
    if (contextError) {
      return <div className="text-[12px] text-red-600">Unable to load context — {contextError}</div>;
    }
    if (!context) return <div className="text-[12px] text-slate-400">Loading context…</div>;
    const bandColour =
      context.band === 'healthy' ? 'text-emerald-500'
      : context.band === 'watch' ? 'text-amber-500'
      : context.band === 'atRisk' ? 'text-rose-500'
      : context.band === 'critical' ? 'text-red-600'
      : 'text-slate-400';

    return (
      <div className="space-y-4 text-[12.5px]">
        <div>
          <div className="text-slate-500 uppercase tracking-wide text-[10px] font-bold">Current state</div>
          <div className="mt-1 flex items-baseline gap-3">
            <span className="text-2xl font-bold text-slate-900">{context.healthScore ?? '—'}</span>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
              context.band === 'critical' ? 'bg-red-100 text-red-700'
              : context.band === 'atRisk' ? 'bg-amber-100 text-amber-700'
              : context.band === 'watch' ? 'bg-yellow-100 text-yellow-700'
              : 'bg-emerald-100 text-emerald-700'
            }`}>{context.band ?? 'unknown'}</span>
            {context.healthScoreDelta7d != null && (
              <span className={`text-[11px] font-semibold ${context.healthScoreDelta7d >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                {context.healthScoreDelta7d >= 0 ? '+' : ''}{context.healthScoreDelta7d} 7d
              </span>
            )}
          </div>
          {bandHistory.length > 0 && (
            <div className="mt-2">
              <SparklineChart values={bandHistory} colour={bandColour} width={80} height={20} terminalDot={false} />
            </div>
          )}
        </div>

        {context.cooldownState.blocked && (
          <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-[11.5px] text-red-700">
            Cooldown active — {context.cooldownState.reason ?? 'recently intervened'}
          </div>
        )}

        {context.topSignals.length > 0 && (
          <div>
            <div className="text-slate-500 uppercase tracking-wide text-[10px] font-bold">Top drivers</div>
            <ul className="mt-1 space-y-1">
              {context.topSignals.map((s) => (
                <li key={s.signal}>
                  <span className="text-slate-700">{s.signal}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {context.recentInterventions.length > 0 && (
          <div>
            <div className="text-slate-500 uppercase tracking-wide text-[10px] font-bold">Recent interventions</div>
            <ul className="mt-1 space-y-1">
              {context.recentInterventions.slice(0, 4).map((i) => (
                <li key={i.id} className="flex justify-between">
                  <span className="text-slate-700 truncate">{i.actionType}</span>
                  <span className="text-slate-400 text-[11px]">{new Date(i.occurredAt).toLocaleDateString()}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  };

  return (
    <Modal title={`Propose intervention · ${subaccountName}`} onClose={onClose} maxWidth={960}>
      <div className="grid grid-cols-[260px_1fr] gap-6">
        <aside className="border-r border-slate-100 pr-5">{renderContextPane()}</aside>
        <section>{renderRightPane()}</section>
      </div>
    </Modal>
  );
}
