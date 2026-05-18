import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';

interface HealthSummary {
  totalClients: number;
  healthy: number;
  attention: number;
  atRisk: number;
}

export default function OnboardingCelebrationPage() {
  const navigate = useNavigate();
  const [summary, setSummary] = useState<HealthSummary | null>(null);
  const [loading, setLoading] = useState(true);

  // Spec §7.3 / §7.4: mark onboarding_completed_at on mount so the
  // needsOnboarding guard clears. Without this call operators land here once
  // then get permanently redirected back to the wizard on the next load.
  // Fire-and-forget: idempotent on the server side (no-op if already set).
  useEffect(() => {
    api.post('/api/onboarding/complete').catch(() => {
      // Swallow — server is idempotent; a transient failure here should not
      // block the celebration UI. Next session load will retry via the same
      // mount effect if needsOnboarding is still true.
    });
  }, []);

  useEffect(() => {
    api.get('/api/reports/latest')
      .then(({ data }) => {
        setSummary({
          totalClients: data.totalClients ?? 0,
          healthy: data.healthyCount ?? 0,
          attention: data.attentionCount ?? 0,
          atRisk: data.atRiskCount ?? 0,
        });
      })
      .catch(() => setSummary(null))
      .finally(() => setLoading(false));
  }, []);

  const handleContinue = useCallback(() => {
    navigate('/clientpulse');
  }, [navigate]);

  return (
    <div className="min-h-screen bg-[linear-gradient(160deg,#0f172a_0%,#1e1b4b_60%,#0f172a_100%)] flex items-center justify-center px-4 py-12 font-sans relative overflow-hidden">
      {/* Decorative blobs */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[400px] rounded-full pointer-events-none bg-[radial-gradient(circle,rgba(99,102,241,0.2)_0%,transparent_70%)]" />
      <div className="absolute bottom-0 right-0 w-96 h-96 rounded-full pointer-events-none bg-[radial-gradient(circle,rgba(139,92,246,0.15)_0%,transparent_70%)]" />

      <div className="relative z-10 w-full max-w-lg text-center animate-[fadeIn_0.35s_ease-out_both]">
        {/* Success icon */}
        <div className="w-20 h-20 rounded-full bg-emerald-500/20 border-2 border-emerald-400/30 flex items-center justify-center mx-auto mb-6">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        </div>

        <h1 className="text-[36px] font-extrabold text-white tracking-tight leading-tight mb-3">
          Your agency dashboard is ready
        </h1>

        {!loading && summary && (
          <p className="text-[15px] text-slate-400 mb-8">
            <span className="text-slate-200 font-semibold">{summary.totalClients} clients</span> monitored and analysed.
          </p>
        )}

        {/* Health summary badges */}
        {!loading && summary && (
          <div className="flex justify-center gap-4 mb-10">
            <div className="flex flex-col items-center gap-1.5 px-5 py-4 rounded-2xl bg-white/5 border border-emerald-500/20">
              <span className="text-[32px] font-extrabold text-emerald-400">{summary.healthy}</span>
              <span className="text-[12px] font-semibold text-emerald-400/80 uppercase tracking-wider">Healthy</span>
            </div>
            <div className="flex flex-col items-center gap-1.5 px-5 py-4 rounded-2xl bg-white/5 border border-amber-500/20">
              <span className="text-[32px] font-extrabold text-amber-400">{summary.attention}</span>
              <span className="text-[12px] font-semibold text-amber-400/80 uppercase tracking-wider">Needs Attention</span>
            </div>
            <div className="flex flex-col items-center gap-1.5 px-5 py-4 rounded-2xl bg-white/5 border border-red-500/20">
              <span className="text-[32px] font-extrabold text-red-400">{summary.atRisk}</span>
              <span className="text-[12px] font-semibold text-red-400/80 uppercase tracking-wider">At Risk</span>
            </div>
          </div>
        )}

        {loading && (
          <div className="flex justify-center gap-4 mb-10">
            {[1, 2, 3].map((i) => (
              <div key={i} className="w-28 h-24 rounded-2xl bg-white/5 animate-pulse" />
            ))}
          </div>
        )}

        {/* CTA */}
        <button
          onClick={handleContinue}
          className="inline-flex items-center gap-2.5 px-8 py-4 bg-indigo-600 hover:bg-indigo-500 text-white text-[16px] font-semibold rounded-xl transition-colors shadow-lg shadow-indigo-900/30 mb-4"
        >
          View your dashboard →
        </button>

        <p className="text-[13px] text-slate-500">
          Check your inbox — your first report just arrived
        </p>
      </div>
    </div>
  );
}
