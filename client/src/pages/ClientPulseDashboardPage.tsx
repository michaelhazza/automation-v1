import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { User } from '../lib/auth';
import api from '../lib/api';
import { useSocket } from '../hooks/useSocket';
import GuidedTour from '../components/GuidedTour';
import { DashboardSkeleton } from '../components/SkeletonLoader';
import NeedsAttentionRow from '../components/clientpulse/NeedsAttentionRow';
import { DashboardErrorBanner } from '../components/DashboardErrorBanner';
import { useConfigAssistantPopup } from '../hooks/useConfigAssistantPopup';

type ClientPulseErrorMap = {
  summary: boolean;
  prioritised: boolean;
};

interface Props { user: User; }

interface HealthSummary {
  totalClients: number;
  healthy: number;
  attention: number;
  atRisk: number;
}

interface HighRiskClient {
  subaccountId: string;
  subaccountName: string;
  healthScore: number;
  healthBand: 'critical' | 'at_risk' | 'watch' | 'healthy';
  healthScoreDelta7d: number;
  sparklineWeekly: number[];
  lastActionText: string | null;
  hasPendingIntervention: boolean;
  drilldownUrl: string;
}

interface LatestReport {
  id: string;
  title: string;
  generatedAt: string;
  totalClients: number;
  healthyCount: number;
  attentionCount: number;
  atRiskCount: number;
}

interface OrgSubscription {
  status: 'trialing' | 'active' | 'cancelled' | 'past_due';
  trialEndsAt?: string;
}

export default function ClientPulseDashboardPage({ user }: Props) {
  const [loading, setLoading] = useState(true);
  const [health, setHealth] = useState<HealthSummary | null>(null);
  const [highRisk, setHighRisk] = useState<HighRiskClient[]>([]);
  const [latestReport, setLatestReport] = useState<LatestReport | null>(null);
  const [subscription, setSubscription] = useState<OrgSubscription | null>(null);
  const [ghlConnected, setGhlConnected] = useState<boolean | null>(null);
  const [errors, setErrors] = useState<ClientPulseErrorMap>({ summary: false, prioritised: false });
  const { openConfigAssistant } = useConfigAssistantPopup();

  async function fetchData() {
    const cycleErrors: ClientPulseErrorMap = { summary: false, prioritised: false };

    const [healthRes, riskRes, reportRes, subRes, onboardingRes] = await Promise.all([
      api.get('/api/clientpulse/health-summary').catch((e) => {
        console.warn('health-summary failed', e);
        cycleErrors.summary = true;
        return null;
      }),
      api.get('/api/clientpulse/high-risk').catch((e) => {
        console.warn('high-risk failed', e);
        cycleErrors.prioritised = true;
        return null;
      }),
      api.get('/api/reports/latest').catch((e) => { console.warn('reports/latest failed', e); return null; }),
      api.get('/api/my-subscription').catch((e) => { console.warn('my-subscription failed', e); return null; }),
      api.get('/api/onboarding/status').catch((e) => { console.warn('onboarding/status failed', e); return null; }),
    ]);

    setErrors(cycleErrors);

    if (healthRes?.data?.data) setHealth(healthRes.data.data);
    if (riskRes?.data?.clients) setHighRisk(riskRes.data.clients);
    if (reportRes?.data) setLatestReport(reportRes.data);
    if (subRes?.data) setSubscription(subRes.data);
    if (onboardingRes?.data) setGhlConnected(onboardingRes.data.ghlConnected);
  }

  useEffect(() => {
    void fetchData().finally(() => setLoading(false));
  }, []);

  // Live dashboard updates
  useSocket('dashboard:update', useCallback((data: unknown) => {
    if (!data || typeof data !== 'object') return;
    const update = data as Partial<HealthSummary>;
    setHealth((prev) => prev ? { ...prev, ...update } : prev);
  }, []));

  if (loading) return <DashboardSkeleton />;

  const trialBanner = subscription?.status === 'cancelled' || subscription?.status === 'past_due';

  return (
    <div className="animate-[fadeIn_0.2s_ease-out_both]">
      <DashboardErrorBanner errors={errors} onRetry={() => { void fetchData(); }} />

      <GuidedTour />

      {/* Trial expired banner */}
      {trialBanner && (
        <div className="flex items-center gap-3 px-5 py-3 mb-6 bg-red-500 text-white rounded-xl text-[13.5px]">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <span className="flex-1 font-medium">
            Your trial has ended. Upgrade to keep monitoring your clients.
          </span>
          <a href="/settings" className="text-white font-semibold underline whitespace-nowrap">
            Choose a plan →
          </a>
        </div>
      )}

      {/* Greeting */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-extrabold text-slate-900 tracking-tight m-0">
            Portfolio Health
          </h1>
          <p className="text-sm text-slate-500 mt-1.5">
            {health
              ? `${health.totalClients} clients monitored. Last updated just now.`
              : 'Connect your Go High Level account to start monitoring.'}
          </p>
        </div>
        <button
          onClick={() => openConfigAssistant()}
          className="shrink-0 px-3 py-1.5 rounded-md text-[12.5px] font-semibold bg-white border border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50"
        >
          Configuration Assistant
        </button>
      </div>

      {/* GHL not connected empty state */}
      {ghlConnected === false && (
        <div className="bg-white rounded-xl border border-slate-200 p-10 text-center mb-6">
          <div className="w-14 h-14 rounded-2xl bg-orange-100 flex items-center justify-center mx-auto mb-4">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#f97316" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
              <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
          </div>
          <h2 className="text-[18px] font-bold text-slate-900 mb-2">Connect Go High Level to get started</h2>
          <p className="text-[14px] text-slate-500 max-w-sm mx-auto mb-6 leading-relaxed">
            Link your GHL agency account to start monitoring your clients' portfolio health automatically.
          </p>
          <Link
            to="/onboarding/connect-ghl"
            className="inline-flex items-center gap-2 px-5 py-3 bg-orange-500 hover:bg-orange-600 text-white text-[14px] font-semibold rounded-xl transition-colors no-underline"
          >
            Connect Go High Level →
          </Link>
        </div>
      )}

      {/* Health summary cards */}
      {health && (
        <div id="tour-health-widget" className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(160px,1fr))] mb-6">
          <HealthCard
            label="Total Clients"
            value={health.totalClients}
            color="slate"
          />
          <HealthCard
            label="Healthy"
            value={health.healthy}
            color="green"
            pct={health.totalClients > 0 ? Math.round((health.healthy / health.totalClients) * 100) : 0}
          />
          <HealthCard
            label="Needs Attention"
            value={health.attention}
            color="amber"
            pct={health.totalClients > 0 ? Math.round((health.attention / health.totalClients) * 100) : 0}
          />
          <HealthCard
            label="At Risk"
            value={health.atRisk}
            color="red"
            pct={health.totalClients > 0 ? Math.round((health.atRisk / health.totalClients) * 100) : 0}
          />
        </div>
      )}

      <div className="grid gap-6 [grid-template-columns:1fr_1fr]">
        {/* Needs Attention */}
        <div id="tour-high-risk-widget" className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[14px] font-bold text-slate-900">Needs Attention</h2>
            <Link to="/clientpulse/clients" className="text-[12px] text-indigo-600 font-semibold hover:text-indigo-700 no-underline">
              View all →
            </Link>
          </div>
          {highRisk.length === 0 ? (
            <p className="text-[13px] text-slate-400 text-center py-6">
              {ghlConnected ? 'No clients need attention this week.' : 'Connect GHL to see client health.'}
            </p>
          ) : (
            <div className="flex flex-col divide-y divide-slate-50">
              {highRisk.slice(0, 7).map((client) => (
                <NeedsAttentionRow key={client.subaccountId} client={client} />
              ))}
            </div>
          )}
        </div>

        {/* Latest report */}
        <div id="tour-latest-report-widget" className="bg-white rounded-xl border border-slate-200 p-5">
          <h2 className="text-[14px] font-bold text-slate-900 mb-4">Latest Report</h2>
          {latestReport ? (
            <div>
              <p className="text-[13px] font-semibold text-slate-700 mb-1">{latestReport.title}</p>
              <p className="text-[12px] text-slate-400 mb-4">
                {new Date(latestReport.generatedAt).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
              </p>
              <div className="flex gap-3 mb-5">
                <div className="flex-1 text-center py-2 px-1 bg-emerald-50 rounded-lg">
                  <p className="text-[20px] font-extrabold text-emerald-600">{latestReport.healthyCount}</p>
                  <p className="text-[11px] text-emerald-600 font-medium">Healthy</p>
                </div>
                <div className="flex-1 text-center py-2 px-1 bg-amber-50 rounded-lg">
                  <p className="text-[20px] font-extrabold text-amber-600">{latestReport.attentionCount}</p>
                  <p className="text-[11px] text-amber-600 font-medium">Attention</p>
                </div>
                <div className="flex-1 text-center py-2 px-1 bg-red-50 rounded-lg">
                  <p className="text-[20px] font-extrabold text-red-600">{latestReport.atRiskCount}</p>
                  <p className="text-[11px] text-red-600 font-medium">At Risk</p>
                </div>
              </div>
              <Link
                to={`/reports/${latestReport.id}`}
                className="block text-center text-[13px] text-indigo-600 font-semibold hover:text-indigo-700 no-underline py-2 border border-indigo-200 rounded-lg hover:bg-indigo-50 transition-colors"
              >
                View full report →
              </Link>
            </div>
          ) : (
            <div className="text-center py-6">
              <p className="text-[13px] text-slate-400">
                {ghlConnected ? 'Your first report is being generated...' : 'Connect GHL to generate reports.'}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* View all reports link */}
      <div className="mt-4 text-right">
        <Link
          id="tour-reports-nav"
          to="/reports"
          className="text-[13px] text-indigo-600 font-semibold hover:text-indigo-700 no-underline"
        >
          View all reports →
        </Link>
      </div>
    </div>
  );
}

function HealthCard({
  label, value, color, pct,
}: {
  label: string;
  value: number;
  color: 'slate' | 'green' | 'amber' | 'red';
  pct?: number;
}) {
  const colorMap = {
    slate: { bg: 'bg-slate-50', border: 'border-slate-200', text: 'text-slate-900', sub: 'text-slate-400' },
    green: { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700', sub: 'text-emerald-500' },
    amber: { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700', sub: 'text-amber-500' },
    red: { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700', sub: 'text-red-500' },
  };
  const c = colorMap[color];
  return (
    <div className={`${c.bg} border ${c.border} rounded-xl p-4`}>
      <p className={`text-[28px] font-extrabold ${c.text} leading-none mb-1`}>{value}</p>
      <p className="text-[12px] text-slate-500 font-medium">{label}</p>
      {pct !== undefined && (
        <p className={`text-[11px] font-semibold ${c.sub} mt-1`}>{pct}%</p>
      )}
    </div>
  );
}
