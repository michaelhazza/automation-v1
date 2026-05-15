import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../lib/api';
import { logAndSwallow } from '../lib/silentCatchHelper';
import { StepBar } from '../components/onboarding-wizard/StepBar';
import { Step1Connect } from '../components/onboarding-wizard/Step1Connect';
import { Step2Locations } from '../components/onboarding-wizard/Step2Locations';
import { Step3Sync } from '../components/onboarding-wizard/Step3Sync';
import { Step4Baseline } from '../components/onboarding-wizard/Step4Baseline';
import type { OnboardingStatus } from '../components/onboarding-wizard/types';

export default function OnboardingWizardPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedCount, setSelectedCount] = useState(0);
  // SPT onboarding gate: true when org has spending budgets but no stripe_agent connection.
  const [needsSptOnboarding, setNeedsSptOnboarding] = useState(false);
  // Baseline step gate: true when the user advances past Step4Baseline.
  const [baselineDone, setBaselineDone] = useState(false);

  useEffect(() => {
    api.get('/api/onboarding/status')
      .then(({ data }) => setStatus(data))
      .catch(() => setStatus({ needsOnboarding: true, ghlConnected: false, agentsProvisioned: false, firstRunComplete: false }))
      .finally(() => setLoading(false));
  }, []);

  // Check if org has spending budgets but no stripe_agent connection.
  // Non-blocking — failure falls through and skips the SPT step.
  useEffect(() => {
    Promise.all([
      api.get('/api/spending-budgets').catch(() => null),
      api.get('/api/org/connections?provider=stripe_agent').catch(() => null),
    ]).then(([budgetsRes, connectionsRes]) => {
      const budgets = budgetsRes?.data;
      const connections = connectionsRes?.data;
      const hasBudgets = Array.isArray(budgets) && budgets.length > 0;
      const hasStripeAgent = Array.isArray(connections) &&
        connections.some((c: { providerType: string; connectionStatus: string }) =>
          c.providerType === 'stripe_agent' && c.connectionStatus === 'active',
        );
      setNeedsSptOnboarding(hasBudgets && !hasStripeAgent);
    }).catch(logAndSwallow('OnboardingWizardPage: SPT onboarding check', { severity: 'critical' }));
  }, []);

  // Handle GHL OAuth callback errors
  useEffect(() => {
    const err = searchParams.get('error');
    if (err === 'oauth_denied') {
      navigate('/onboarding/connect-ghl?error=oauth_denied', { replace: true });
    }
  }, [searchParams, navigate]);

  const currentStep = !status
    ? 0
    : !status.ghlConnected
      ? 0
      : !status.agentsProvisioned
        ? 1
        : !status.firstRunComplete
          ? 2
          : 3;

  // Step bar uses 5 slots (0-4). When sync is done but baseline not yet complete:
  // show slot 3 ("Tell us"). When baseline done: show slot 4 ("Done").
  const stepBarIndex = currentStep < 3 ? currentStep : baselineDone ? 4 : 3;

  // Sync complete: advance to the baseline-artefacts step (step 3 in the bar).
  // Navigation to /onboarding/ready happens after the user completes or skips Step4Baseline.
  const handleSyncComplete = () => {
    setStatus((s) => s ? { ...s, firstRunComplete: true } : s);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="w-8 h-8 border-[3px] border-slate-200 border-t-indigo-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4 py-12 font-sans">
      <div className="w-full max-w-xl animate-[fadeIn_0.25s_ease-out_both]">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2.5 mb-4">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center shadow-md">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
              </svg>
            </div>
            <span className="text-lg font-bold text-slate-800">ClientPulse</span>
          </div>
          <h1 className="text-[28px] font-extrabold text-slate-900 tracking-tight">Set up your dashboard</h1>
          <p className="text-slate-500 text-[14px] mt-1.5">Complete these steps to start monitoring your portfolio.</p>
        </div>

        <StepBar current={stepBarIndex} />

        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 px-8 py-8">
          {currentStep === 0 && (
            <Step1Connect onConnected={() => setStatus((s) => s ? { ...s, ghlConnected: true } : s)} />
          )}
          {currentStep === 1 && (
            <Step2Locations onConfirm={(ids) => {
              setSelectedCount(ids.length);
              setStatus((s) => s ? { ...s, agentsProvisioned: true } : s);
            }} />
          )}
          {currentStep === 2 && (
            <Step3Sync onComplete={handleSyncComplete} totalAccounts={selectedCount} />
          )}
          {currentStep === 3 && !baselineDone && (
            <Step4Baseline onComplete={() => setBaselineDone(true)} />
          )}
          {currentStep === 3 && baselineDone && !needsSptOnboarding && (
            <div className="text-center">
              <p className="text-slate-600 text-[14px] mb-4">Setup complete. Redirecting to your dashboard...</p>
              <button
                onClick={async () => {
                  // Spec §7.3 / §7.4 — mark the wizard dismissed so the redirect
                  // doesn't auto-open again on subsequent sign-ins.
                  try {
                    await api.post('/api/onboarding/complete');
                  } catch {
                    // Non-fatal: the user still proceeds to the dashboard.
                  }
                  navigate('/');
                }}
                className="inline-flex items-center gap-2 px-5 py-3 bg-indigo-600 hover:bg-indigo-700 text-white text-[14px] font-semibold rounded-xl transition-colors"
              >
                View dashboard →
              </button>
            </div>
          )}
          {currentStep === 3 && baselineDone && needsSptOnboarding && (
            <div className="text-center">
              <div className="w-14 h-14 rounded-2xl bg-indigo-100 flex items-center justify-center mx-auto mb-4">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="1" y="4" width="22" height="16" rx="2" ry="2"/>
                  <line x1="1" y1="10" x2="23" y2="10"/>
                </svg>
              </div>
              <h2 className="text-xl font-bold text-slate-900 mb-2">Connect Stripe to enable agent payments</h2>
              <p className="text-slate-500 text-[13.5px] mb-6 max-w-xs mx-auto leading-relaxed">
                Your org has spending budgets configured. Connect Stripe so agents can make payments within your limits.
              </p>
              <div className="flex flex-col items-center gap-3">
                <button
                  onClick={() => navigate('/onboarding/connect-stripe')}
                  className="inline-flex items-center gap-2 px-5 py-3 bg-indigo-600 hover:bg-indigo-700 text-white text-[14px] font-semibold rounded-xl transition-colors"
                >
                  Connect Stripe →
                </button>
                <button
                  onClick={() => setNeedsSptOnboarding(false)}
                  className="text-[13px] text-slate-400 hover:text-slate-600 bg-transparent border-0 cursor-pointer"
                >
                  Skip for now
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
