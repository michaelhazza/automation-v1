import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import api from '../lib/api';
import { useOAuthPopup } from '../hooks/useOAuthPopup';

// ── Types ──────────────────────────────────────────────────────────────────

interface SptConnection {
  id: string;
  providerType: string;
  connectionStatus: string;
  displayName: string | null;
  createdAt: string;
}

// ── Step indicators ────────────────────────────────────────────────────────

const STEPS = ['Connect Stripe', 'Confirm'];

function StepBar({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-0 mb-10">
      {STEPS.map((label, i) => (
        <div key={label} className="flex items-center gap-0 flex-1 last:flex-none">
          <div className="flex flex-col items-center gap-1.5">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
              i < current
                ? 'bg-indigo-500 text-white'
                : i === current
                  ? 'bg-indigo-600 text-white ring-2 ring-indigo-200'
                  : 'bg-slate-200 text-slate-400'
            }`}>
              {i < current ? (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              ) : i + 1}
            </div>
            <span className={`text-[11px] font-medium whitespace-nowrap ${
              i === current ? 'text-indigo-600' : i < current ? 'text-slate-500' : 'text-slate-400'
            }`}>{label}</span>
          </div>
          {i < STEPS.length - 1 && (
            <div className={`flex-1 h-0.5 mx-2 mb-[18px] ${i < current ? 'bg-indigo-400' : 'bg-slate-200'}`} />
          )}
        </div>
      ))}
    </div>
  );
}

// ── Step 1: Connect Stripe ─────────────────────────────────────────────────

function StepConnect({
  onConnected,
}: {
  onConnected: () => void;
}) {
  const popup = useOAuthPopup();
  const [loadingUrl, setLoadingUrl] = useState(false);

  const handleConnect = async () => {
    setLoadingUrl(true);
    try {
      const { data } = await api.get('/api/org/spt/oauth-url');
      popup.open(data.url as string);
    } catch {
      toast.error('Could not start Stripe connection. Please try again.');
    } finally {
      setLoadingUrl(false);
    }
  };

  useEffect(() => {
    if (popup.status === 'success') {
      onConnected();
    }
  }, [popup.status, onConnected]);

  return (
    <div className="text-center">
      <div className="w-16 h-16 rounded-2xl bg-indigo-100 flex items-center justify-center mx-auto mb-5">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="1" y="4" width="22" height="16" rx="2" ry="2"/>
          <line x1="1" y1="10" x2="23" y2="10"/>
        </svg>
      </div>
      <h2 className="text-2xl font-bold text-slate-900 mb-3">Connect Stripe</h2>
      <p className="text-slate-500 text-[14px] mb-7 max-w-sm mx-auto leading-relaxed">
        Link your Stripe account so agents can make payments on your behalf. You control all spending limits and policies.
      </p>

      {popup.status === 'error' && (
        <p className="text-sm text-red-600 mb-4">
          Connection failed. Please try again.
        </p>
      )}

      <button
        onClick={handleConnect}
        disabled={loadingUrl || popup.status === 'pending'}
        className="inline-flex items-center gap-2.5 px-6 py-3.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white text-[15px] font-semibold rounded-xl transition-colors shadow-sm disabled:cursor-not-allowed"
      >
        {popup.status === 'pending' ? (
          <>
            <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
              <path d="M21 12a9 9 0 11-6.219-8.56"/>
            </svg>
            Connecting…
          </>
        ) : loadingUrl ? (
          'Loading…'
        ) : (
          'Connect Stripe'
        )}
      </button>

      {popup.status === 'pending' && (
        <p className="mt-4 text-xs text-slate-400">
          Complete the Stripe authorisation in the popup window.
        </p>
      )}

      {popup.status === 'error' || popup.status === 'idle' ? (
        <div className="mt-4">
          <button
            onClick={onConnected}
            className="text-[13px] text-slate-400 hover:text-slate-600 bg-transparent border-0 cursor-pointer"
          >
            Already connected? Skip
          </button>
        </div>
      ) : null}
    </div>
  );
}

// ── Step 2: Confirm ────────────────────────────────────────────────────────

function StepConfirm({
  connection,
  onDone,
}: {
  connection: SptConnection | null;
  onDone: () => void;
}) {
  return (
    <div className="text-center">
      <div className="w-16 h-16 rounded-2xl bg-emerald-100 flex items-center justify-center mx-auto mb-5">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6L9 17l-5-5"/>
        </svg>
      </div>
      <h2 className="text-2xl font-bold text-slate-900 mb-3">Stripe connected</h2>
      <p className="text-slate-500 text-[14px] mb-2 max-w-sm mx-auto leading-relaxed">
        Your Stripe account is connected. Agents can now make payments within your configured spending limits.
      </p>
      {connection && (
        <p className="text-xs text-slate-400 mb-7">
          Connection: {connection.displayName ?? connection.id}
        </p>
      )}
      <button
        onClick={onDone}
        className="inline-flex items-center gap-2.5 px-6 py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white text-[15px] font-semibold rounded-xl transition-colors shadow-sm"
      >
        Go to Spending Budgets
      </button>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

/**
 * SPT onboarding wizard.
 * Primary task: walk the operator from "no Stripe connection" to an active
 * integration_connections row with providerType = 'stripe_agent'.
 *
 * Spec: tasks/builds/agentic-commerce/spec.md §7.7, Plan Chunk 16.
 */
export default function SptOnboardingPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [connection, setConnection] = useState<SptConnection | null>(null);
  const [checkingExisting, setCheckingExisting] = useState(true);

  // Check for an existing stripe_agent connection on mount.
  useEffect(() => {
    api.get('/api/org/connections?provider=stripe_agent')
      .then(({ data }) => {
        const connections: SptConnection[] = Array.isArray(data) ? data : [];
        const active = connections.find(
          (c) => c.connectionStatus === 'active' && c.providerType === 'stripe_agent',
        );
        if (active) {
          setConnection(active);
          setStep(1); // skip directly to confirmation
        }
      })
      .catch(() => {
        // Non-blocking — operator can proceed through the flow
      })
      .finally(() => setCheckingExisting(false));
  }, []);

  const handleConnected = () => {
    // Fetch the newly created stripe_agent connection so we can display it
    api.get('/api/org/connections?provider=stripe_agent')
      .then(({ data }) => {
        const connections: SptConnection[] = Array.isArray(data) ? data : [];
        const active = connections.find(
          (c) => c.connectionStatus === 'active' && c.providerType === 'stripe_agent',
        );
        setConnection(active ?? null);
      })
      .catch(() => {})
      .finally(() => setStep(1));
  };

  if (checkingExisting) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-slate-400 text-sm">Loading…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-start justify-center pt-16 px-4">
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 w-full max-w-md p-8">
        <StepBar current={step} />

        {step === 0 && (
          <StepConnect onConnected={handleConnected} />
        )}

        {step === 1 && (
          <StepConfirm
            connection={connection}
            onDone={() => navigate('/spending-budgets')}
          />
        )}
      </div>
    </div>
  );
}
