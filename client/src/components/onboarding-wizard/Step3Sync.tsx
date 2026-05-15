import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import api from '../../lib/api';
import { useSocket } from '../../hooks/useSocket';
import type { SyncStatus } from './types';

export function Step3Sync({ onComplete, totalAccounts }: { onComplete: () => void; totalAccounts: number }) {
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
