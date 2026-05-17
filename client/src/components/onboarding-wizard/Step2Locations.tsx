import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import api from '../../lib/api';
import type { GhlLocation } from './types';

export function Step2Locations({
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
