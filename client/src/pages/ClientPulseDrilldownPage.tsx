import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import api from '../lib/api';
import type { User } from '../lib/auth';
import SignalPanel from '../components/clientpulse/drilldown/SignalPanel';
import BandTransitionsTable from '../components/clientpulse/drilldown/BandTransitionsTable';
import InterventionHistoryTable, { type InterventionRow } from '../components/clientpulse/drilldown/InterventionHistoryTable';
import ProposeInterventionModal from '../components/clientpulse/ProposeInterventionModal';
import PendingHero from '../components/clientpulse/PendingHero';
import { useConfigAssistantPopup } from '../hooks/useConfigAssistantPopup';
import { usePendingIntervention } from '../hooks/usePendingIntervention';

interface Props {
  user: User;
}

type PendingIntervention = {
  reviewItemId: string;
  actionTitle: string;
  proposedAt: string;
  rationale: string;
};

type Summary = {
  subaccount: { id: string; name: string };
  band: string | null;
  healthScore: number | null;
  healthScoreDelta7d: number | null;
  lastAssessmentAt: string | null;
  pendingIntervention: PendingIntervention | null;
};

type SignalsResponse = {
  signals: Array<{ slug: string; contribution: number; label: string | null; lastSeenAt: string | null }>;
  lastUpdatedAt: string | null;
};

type TransitionsResponse = {
  transitions: Array<{ fromBand: string; toBand: string; changedAt: string; triggerReason: string | null }>;
};

const BAND_CLASS: Record<string, string> = {
  healthy: 'bg-emerald-100 text-emerald-700',
  watch: 'bg-yellow-100 text-yellow-700',
  atRisk: 'bg-amber-100 text-amber-700',
  critical: 'bg-red-100 text-red-700',
};

const WINDOW_DAYS = 90;

export default function ClientPulseDrilldownPage(_: Props) {
  const { subaccountId } = useParams<{ subaccountId: string }>();
  const { openConfigAssistant } = useConfigAssistantPopup();

  const [summary, setSummary] = useState<Summary | null>(null);
  const [signals, setSignals] = useState<SignalsResponse | null>(null);
  const [transitions, setTransitions] = useState<TransitionsResponse | null>(null);
  const [interventions, setInterventions] = useState<InterventionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showPropose, setShowPropose] = useState(false);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [showAllSignals, setShowAllSignals] = useState(false);

  const load = useCallback(async () => {
    if (!subaccountId) return;
    setLoading(true);
    setError(null);
    try {
      const [sRes, sigRes, trRes, intRes] = await Promise.all([
        api.get(`/api/clientpulse/subaccounts/${subaccountId}/drilldown-summary`),
        api.get(`/api/clientpulse/subaccounts/${subaccountId}/signals`),
        api.get(`/api/clientpulse/subaccounts/${subaccountId}/band-transitions?windowDays=${WINDOW_DAYS}`),
        api.get(`/api/clientpulse/subaccounts/${subaccountId}/interventions?limit=50`),
      ]);
      setSummary({ ...(sRes.data as Summary), pendingIntervention: (sRes.data as { pendingIntervention?: PendingIntervention | null }).pendingIntervention ?? null });
      setSignals(sigRes.data as SignalsResponse);
      setTransitions(trRes.data as TransitionsResponse);
      setInterventions((intRes.data as { interventions: InterventionRow[] }).interventions);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } }; message?: string };
      setError(e?.response?.data?.message ?? e?.message ?? 'Failed to load drilldown');
    } finally {
      setLoading(false);
    }
  }, [subaccountId]);

  const { approve, reject, conflict: interventionConflict, error: interventionError } = usePendingIntervention({
    onApproved: load,
    onRejected: load,
    onConflict: load,
  });

  useEffect(() => {
    load();
  }, [load]);

  const handleOpenConfigAssistant = () => {
    if (!summary) return;
    const prompt = `I'm looking at ${summary.subaccount.name}. Their current band is ${summary.band ?? 'unknown'} and health score is ${summary.healthScore ?? 'unknown'}. What operational-config adjustments should I consider?`;
    openConfigAssistant(prompt);
  };

  if (loading) return <div className="p-6 text-slate-500">Loading client drilldown…</div>;
  if (error) return <div className="p-6 text-red-600">{error}</div>;
  if (!summary || !signals || !transitions) return null;

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-4">
      <PendingHero
        pendingIntervention={summary.pendingIntervention}
        onApprove={approve}
        onReject={(id) => reject(id, '')}
        conflict={interventionConflict}
        error={interventionError}
      />

      <header className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{summary.subaccount.name}</h1>
            <div className="mt-2 flex items-baseline gap-3">
              <span className="text-3xl font-bold text-slate-900">{summary.healthScore ?? '—'}</span>
              {summary.band && (
                <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold uppercase ${BAND_CLASS[summary.band] ?? 'bg-slate-100 text-slate-600'}`}>
                  {summary.band}
                </span>
              )}
              {summary.healthScoreDelta7d != null && (
                <span className={`text-[12px] font-semibold ${summary.healthScoreDelta7d >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                  {summary.healthScoreDelta7d >= 0 ? '+' : ''}{summary.healthScoreDelta7d} in 7d
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <button
              onClick={() => setShowPropose(true)}
              className="px-4 py-2 rounded-md text-[13px] font-semibold bg-indigo-600 text-white hover:bg-indigo-700"
            >
              Propose intervention
            </button>
          </div>
        </div>
      </header>

      <div>
        <SignalPanel
          signals={showAllSignals ? signals.signals : signals.signals.slice(0, 5)}
          lastUpdatedAt={signals.lastUpdatedAt}
        />
        {signals.signals.length > 5 && (
          <button
            onClick={() => setShowAllSignals(s => !s)}
            className="mt-2 text-[12px] text-indigo-600 hover:underline"
          >
            {showAllSignals ? 'Show less' : `Show more (${signals.signals.length - 5} more)`}
          </button>
        )}
      </div>

      <div>
        <BandTransitionsTable
          transitions={historyExpanded ? transitions.transitions : transitions.transitions.slice(-3)}
          windowDays={WINDOW_DAYS}
        />
        {transitions.transitions.length > 3 && (
          <button
            onClick={() => setHistoryExpanded(e => !e)}
            className="mt-2 text-[12px] text-indigo-600 hover:underline"
          >
            {historyExpanded ? 'Hide history' : `Show history (${transitions.transitions.length - 3} more)`}
          </button>
        )}
      </div>

      <InterventionHistoryTable rows={interventions} />

      <p className="text-[12px] text-slate-500">
        Need help interpreting this data?{' '}
        <button onClick={handleOpenConfigAssistant} className="text-indigo-600 hover:underline">
          Open Configuration Assistant
        </button>
      </p>

      {showPropose && (
        <ProposeInterventionModal
          subaccountId={summary.subaccount.id}
          subaccountName={summary.subaccount.name}
          onClose={() => setShowPropose(false)}
          onSubmitted={() => {
            setShowPropose(false);
            load();
          }}
        />
      )}
    </div>
  );
}
