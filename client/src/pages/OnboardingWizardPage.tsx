import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import api from '../lib/api';
import { useSocket } from '../hooks/useSocket';

// ── Types ──────────────────────────────────────────────────────────────────

interface OnboardingStatus {
  // Session 1 (spec §7.4): sole gate for "should the wizard auto-open?".
  // Orthogonal to the three derivation fields below.
  needsOnboarding: boolean;
  ghlConnected: boolean;
  agentsProvisioned: boolean;
  firstRunComplete: boolean;
}

interface GhlLocation {
  id: string;
  name: string;
  city?: string;
  contactCount?: number;
}

interface SyncAccountStatus {
  accountId: string;
  displayName: string;
  status: 'pending' | 'syncing' | 'complete' | 'error';
  error?: string;
  preview?: {
    contactCount: number;
    opportunityCount: number;
    revenueTotal?: number;
  };
}

interface SyncStatus {
  phase: 'idle' | 'syncing' | 'complete' | 'error';
  totalAccounts: number;
  completedAccounts: number;
  accounts: SyncAccountStatus[];
}

// ── Step indicators ────────────────────────────────────────────────────────

const STEPS = ['Connect GHL', 'Select clients', 'Syncing', 'Done'];

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

// ── Step 1: Connect GHL ────────────────────────────────────────────────────

function Step1Connect({ onConnected }: { onConnected: () => void }) {
  return (
    <div className="text-center">
      <div className="w-16 h-16 rounded-2xl bg-orange-100 flex items-center justify-center mx-auto mb-5">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#f97316" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
          <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
        </svg>
      </div>
      <h2 className="text-2xl font-bold text-slate-900 mb-3">Connect Go High Level</h2>
      <p className="text-slate-500 text-[14px] mb-7 max-w-sm mx-auto leading-relaxed">
        Link your GHL agency account so ClientPulse can monitor your clients. Read-only access — we never modify your data.
      </p>
      <a
        href="/onboarding/connect-ghl"
        className="inline-flex items-center gap-2.5 px-6 py-3.5 bg-orange-500 hover:bg-orange-600 text-white text-[15px] font-semibold rounded-xl transition-colors shadow-sm no-underline"
      >
        Connect Go High Level →
      </a>
      <div className="mt-4">
        <button
          onClick={onConnected}
          className="text-[13px] text-slate-400 hover:text-slate-600 bg-transparent border-0 cursor-pointer"
        >
          Already connected? Skip →
        </button>
      </div>
    </div>
  );
}

// ── Step 2: Select locations ───────────────────────────────────────────────

function Step2Locations({
  onConfirm,
}: {
  onConfirm: (ids: string[]) => void;
}) {
  const [locations, setLocations] = useState<GhlLocation[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  // Infinity means no cap (null from API = unlimited plan)
  const [subLimit, setSubLimit] = useState<number>(Infinity);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    Promise.all([
      api.get('/api/ghl/locations'),
      api.get('/api/my-subscription'),
    ]).then(([locRes, subRes]) => {
      const locs: GhlLocation[] = locRes.data.locations ?? [];
      setLocations(locs);
      // null means unlimited (no cap); Infinity disables the over-limit checks below
      const rawLimit: number | null = subRes.data.subscription?.subaccountLimit ?? null;
      const limit: number = rawLimit ?? Infinity;
      setSubLimit(limit);
      // Pre-select up to the limit
      const preSelected = new Set(locs.slice(0, limit).map((l) => l.id));
      setSelected(preSelected);
    }).catch(() => {
      toast.error('Could not load locations. Please refresh.');
    }).finally(() => setLoading(false));
  }, []);

  const toggleLocation = (id: string, overLimit: boolean) => {
    if (overLimit && !selected.has(id)) return; // can't add over-limit locations
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const filtered = locations.filter(
    (l) =>
      l.name.toLowerCase().includes(search.toLowerCase()) ||
      (l.city ?? '').toLowerCase().includes(search.toLowerCase())
  );

  const handleConfirm = async () => {
    if (selected.size === 0) {
      toast.error('Select at least one client to monitor.');
      return;
    }
    setConfirming(true);
    try {
      await api.post('/api/onboarding/confirm-locations', { locationIds: [...selected] });
      onConfirm([...selected]);
    } catch {
      toast.error('Failed to confirm locations. Please try again.');
      setConfirming(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col gap-3">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-14 rounded-xl bg-[linear-gradient(90deg,#f1f5f9_25%,#e2e8f0_50%,#f1f5f9_75%)] bg-[length:400%_100%] animate-[shimmer_1.4s_ease-in-out_infinite]" />
        ))}
      </div>
    );
  }

  const overLimitCount = Math.max(0, locations.length - subLimit);

  return (
    <div>
      <h2 className="text-2xl font-bold text-slate-900 mb-2">Select clients to monitor</h2>
      <p className="text-slate-500 text-[14px] mb-5">
        We found <strong>{locations.length}</strong> client location{locations.length !== 1 ? 's' : ''} in your GHL account.
      </p>

      {overLimitCount > 0 && (
        <div className="flex items-center gap-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl mb-4 text-[13px]">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          <span className="text-amber-800">
            Your Starter plan monitors up to <strong>{subLimit} clients</strong>.{' '}
            <a href="/settings" className="underline text-amber-700 hover:text-amber-900">Upgrade to Growth →</a>
          </span>
        </div>
      )}

      {locations.length >= 20 && (
        <div className="relative mb-4">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or city..."
            className="w-full pl-9 pr-4 py-2.5 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
      )}

      <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
        {filtered.map((loc, idx) => {
          const isOverLimit = idx >= subLimit;
          const isSelected = selected.has(loc.id);
          return (
            <button
              key={loc.id}
              type="button"
              onClick={() => toggleLocation(loc.id, isOverLimit)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-colors ${
                isOverLimit
                  ? 'border-slate-100 bg-slate-50 opacity-50 cursor-not-allowed'
                  : isSelected
                    ? 'border-indigo-200 bg-indigo-50'
                    : 'border-slate-200 bg-white hover:border-indigo-200 hover:bg-indigo-50/50'
              }`}
            >
              <div className={`w-5 h-5 rounded flex items-center justify-center shrink-0 transition-colors ${
                isSelected ? 'bg-indigo-500 border-indigo-500' : 'border-2 border-slate-300'
              }`}>
                {isSelected && (
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                )}
                {isOverLimit && !isSelected && (
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                  </svg>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13.5px] font-medium text-slate-900 truncate">{loc.name}</p>
                {loc.city && <p className="text-[12px] text-slate-400">{loc.city}</p>}
              </div>
              {loc.contactCount !== undefined && (
                <span className="text-[11.5px] text-slate-400 shrink-0">{loc.contactCount.toLocaleString()} contacts</span>
              )}
            </button>
          );
        })}
        {filtered.length === 0 && (
          <p className="text-center text-slate-400 text-[13px] py-8">No locations match your search.</p>
        )}
      </div>

      <div className="mt-6">
        <button
          onClick={handleConfirm}
          disabled={confirming || selected.size === 0}
          className="w-full flex items-center justify-center gap-2 px-5 py-3.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white text-[15px] font-semibold rounded-xl transition-colors"
        >
          {confirming ? (
            <>
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Starting sync...
            </>
          ) : `Start monitoring ${selected.size} client${selected.size !== 1 ? 's' : ''}`}
        </button>
      </div>
    </div>
  );
}

// ── Step 3: Sync Progress ──────────────────────────────────────────────────

function Step3Sync({ onComplete, totalAccounts }: { onComplete: () => void; totalAccounts: number }) {
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({
    phase: 'syncing',
    totalAccounts,
    completedAccounts: 0,
    accounts: [],
  });
  const [emailMeRequested, setEmailMeRequested] = useState(false);
  const [notifPermission, setNotifPermission] = useState<NotificationPermission>('default');

  // Request notification permission when this step loads
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().then(setNotifPermission);
    } else if ('Notification' in window) {
      setNotifPermission(Notification.permission);
    }
  }, []);

  // Listen for WebSocket sync updates
  useSocket('sync:update', useCallback((rawData: unknown) => {
    const data = rawData as SyncStatus;
    setSyncStatus(data);
    if (data.phase === 'complete') {
      if (document.hidden && notifPermission === 'granted') {
        new Notification('ClientPulse is ready', {
          body: `${data.totalAccounts} clients monitored. View your dashboard.`,
          icon: '/logo-192.png',
        });
      }
      onComplete();
    }
  }, [notifPermission, onComplete]));

  // Poll as fallback for WebSocket
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const { data } = await api.get('/api/onboarding/sync-status');
        setSyncStatus(data);
        if (data.phase === 'complete') {
          clearInterval(interval);
          onComplete();
        }
      } catch { /* ignore */ }
    }, 3000);
    return () => clearInterval(interval);
  }, [onComplete]);

  const handleEmailMe = async () => {
    try {
      await api.post('/api/onboarding/notify-on-complete');
      setEmailMeRequested(true);
      toast.success('We\'ll email you when your dashboard is ready.');
    } catch {
      toast.error('Could not set up email notification.');
    }
  };

  const completed = syncStatus.accounts.filter((a) => a.status === 'complete').length;
  const total = syncStatus.totalAccounts || totalAccounts;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <div>
      <h2 className="text-2xl font-bold text-slate-900 mb-2">Syncing your clients</h2>
      <p className="text-slate-500 text-[14px] mb-6">
        Pulling data from Go High Level. This usually takes 1–3 minutes.
      </p>

      {/* Progress bar */}
      <div className="mb-5">
        <div className="flex justify-between text-[12px] text-slate-400 mb-1.5">
          <span>{completed} of {total} synced</span>
          <span>{pct}%</span>
        </div>
        <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-indigo-500 rounded-full transition-all duration-700"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Per-account status */}
      <div className="space-y-2 max-h-64 overflow-y-auto">
        {syncStatus.accounts.length === 0 ? (
          // Show skeleton placeholders while accounts load
          [1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3 bg-slate-50 rounded-xl">
              <div className="w-5 h-5 rounded-full bg-[linear-gradient(90deg,#f1f5f9_25%,#e2e8f0_50%,#f1f5f9_75%)] bg-[length:400%_100%] animate-[shimmer_1.4s_ease-in-out_infinite]" />
              <div className="flex-1 h-4 rounded bg-[linear-gradient(90deg,#f1f5f9_25%,#e2e8f0_50%,#f1f5f9_75%)] bg-[length:400%_100%] animate-[shimmer_1.4s_ease-in-out_infinite]" />
            </div>
          ))
        ) : (
          syncStatus.accounts.map((acc) => (
            <div key={acc.accountId} className="flex items-start gap-3 px-4 py-3 bg-white border border-slate-100 rounded-xl">
              <div className="shrink-0 mt-0.5">
                {acc.status === 'complete' && (
                  <div className="w-5 h-5 rounded-full bg-emerald-100 flex items-center justify-center">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                  </div>
                )}
                {acc.status === 'syncing' && (
                  <div className="w-5 h-5 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin" />
                )}
                {acc.status === 'pending' && (
                  <div className="w-5 h-5 rounded-full border-2 border-slate-200" />
                )}
                {acc.status === 'error' && (
                  <div className="w-5 h-5 rounded-full bg-red-100 flex items-center justify-center">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13.5px] font-medium text-slate-800 truncate">{acc.displayName}</p>
                {acc.status === 'complete' && acc.preview && (
                  <p className="text-[12px] text-slate-400 mt-0.5">
                    {acc.preview.contactCount.toLocaleString()} contacts
                    {acc.preview.opportunityCount > 0 && `, ${acc.preview.opportunityCount} active deals`}
                    {acc.preview.revenueTotal !== undefined && acc.preview.revenueTotal > 0 && `, $${(acc.preview.revenueTotal / 100).toLocaleString()} revenue`}
                  </p>
                )}
                {acc.status === 'error' && acc.error && (
                  <p className="text-[12px] text-red-500 mt-0.5">{acc.error}</p>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* "Email me when ready" */}
      {!emailMeRequested ? (
        <div className="mt-5 text-center">
          <button
            onClick={handleEmailMe}
            className="text-[13px] text-indigo-500 hover:text-indigo-700 bg-transparent border-0 cursor-pointer underline"
          >
            Email me when my dashboard is ready — I'll check back later
          </button>
        </div>
      ) : (
        <div className="mt-5 flex items-center justify-center gap-2 text-[13px] text-emerald-600">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
          We'll email you when it's ready.
        </div>
      )}
    </div>
  );
}

// ── Main OnboardingWizardPage ──────────────────────────────────────────────

export default function OnboardingWizardPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedCount, setSelectedCount] = useState(0);

  useEffect(() => {
    api.get('/api/onboarding/status')
      .then(({ data }) => setStatus(data))
      .catch(() => setStatus({ needsOnboarding: true, ghlConnected: false, agentsProvisioned: false, firstRunComplete: false }))
      .finally(() => setLoading(false));
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

  const handleSyncComplete = () => {
    navigate('/onboarding/ready');
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

        <StepBar current={currentStep} />

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
          {currentStep === 3 && (
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
        </div>
      </div>
    </div>
  );
}
