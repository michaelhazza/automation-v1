// client/src/pages/govern/components/ModelAccessSection.tsx
// Spec: tasks/builds/operator-session-identity/spec.md §Chunk 10
// Read-only display of an agent's allowed AI Subscriptions.

import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import type { AiSubscriptionConnection } from '../../../../../shared/types/govern.js';
import { getAgentAllowedSubscriptions } from '../../../api/governApi';
import { StatusPill, TierBadge } from './_aiSubscriptionPills';

// ── Skeleton ─────────────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-slate-100 last:border-0 animate-pulse">
      <div className="h-3.5 bg-slate-100 rounded w-1/3" />
      <div className="h-3.5 bg-slate-100 rounded w-16" />
      <div className="h-3.5 bg-slate-100 rounded w-20 ml-auto" />
    </div>
  );
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  agentId: string;
  subaccountId: string;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ModelAccessSection({ agentId, subaccountId }: Props) {
  const [rows, setRows] = useState<AiSubscriptionConnection[] | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [fetchKey, setFetchKey] = useState(0);

  const reload = useCallback(() => setFetchKey((k) => k + 1), []);

  useEffect(() => {
    setRows(null);
    setError(null);
    getAgentAllowedSubscriptions(subaccountId, agentId)
      .then(setRows)
      .catch((e: unknown) => {
        setError(e instanceof Error ? e : new Error(String(e)));
      });
  }, [subaccountId, agentId, fetchKey]);

  // Sort: Default-first, then alphabetical by label
  const sorted = rows
    ? [...rows].sort((a, b) => {
        if (a.isDefault && !b.isDefault) return -1;
        if (!a.isDefault && b.isDefault) return 1;
        return (a.label ?? '').localeCompare(b.label ?? '');
      })
    : null;

  const isLoading = rows === null && !error;

  return (
    <div className="bg-white rounded-[10px] border border-slate-200 mb-5">
      {/* Section header */}
      <div className="px-5 py-4 border-b border-slate-100">
        <h2 className="m-0 text-[15px] font-semibold text-slate-900">Model Access</h2>
      </div>

      <div className="p-5">
        {/* Explainer note */}
        <div className="flex items-start gap-2.5 p-3 mb-5 bg-slate-50 border border-slate-200 rounded-lg text-[12.5px] text-slate-500 leading-relaxed">
          <svg className="flex-shrink-0 mt-0.5 text-slate-400" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" />
          </svg>
          <span>This shows where this agent gets its intelligence. Set permissions on the Connections page.</span>
        </div>

        {/* Sub-section 1: Standard runs */}
        <div className="mb-5">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[13px] font-semibold text-slate-700">Standard runs</span>
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-500 bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded">
              <svg width="9" height="9" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              Always
            </span>
          </div>
          <p className="text-[12.5px] text-slate-500 m-0">
            Standard runs use platform-managed model providers. No configuration available.
          </p>
        </div>

        {/* Divider */}
        <div className="border-t border-slate-100 mb-5" />

        {/* Sub-section 2: Autonomous runs */}
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[13px] font-semibold text-slate-700">Autonomous runs</span>
            {sorted && sorted.length > 0 && sorted.some(r => r.usabilityState === 'connected_usable') ? (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-green-700 bg-green-50 border border-green-200 px-1.5 py-0.5 rounded">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                Active
              </span>
            ) : sorted && sorted.length > 0 ? (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                Needs attention
              </span>
            ) : (
              <span className="inline-flex items-center text-[10px] font-semibold text-slate-500 bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded">
                No subscription
              </span>
            )}
          </div>
          <p className="text-[12px] text-slate-400 mb-3">Allowed AI Subscriptions for this agent:</p>

          {/* Error state */}
          {error && (
            <div className="flex items-center gap-3 p-3 bg-red-50 border border-red-200 rounded-lg text-[12.5px] text-red-700 mb-3">
              <span className="flex-1">Could not load Model Access</span>
              <button
                type="button"
                onClick={reload}
                className="text-xs font-semibold text-red-700 underline cursor-pointer bg-transparent border-0 font-[inherit]"
              >
                Retry
              </button>
            </div>
          )}

          {/* Loading state */}
          {isLoading && !error && (
            <div className="border border-slate-200 rounded-lg px-4 py-2">
              <SkeletonRow />
              <SkeletonRow />
            </div>
          )}

          {/* Empty state */}
          {sorted && sorted.length === 0 && (
            <p className="text-[12.5px] text-slate-400 italic">
              No AI Subscriptions are available to this agent. Edit availability in Connections.
            </p>
          )}

          {/* List */}
          {sorted && sorted.length > 0 && (
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              {sorted.map((row) => (
                <div
                  key={row.id}
                  className={`flex items-center gap-3 px-4 py-3 border-b border-slate-100 last:border-0 ${
                    row.isDefault ? 'bg-indigo-50/50' : 'bg-white'
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 text-[13px] font-medium text-slate-800 truncate">
                      {row.label ?? `${row.provider} ${row.planTier}`}
                      {row.isDefault && (
                        <span className="inline-flex items-center text-[10px] font-extrabold text-indigo-700 bg-indigo-100 border border-indigo-300 px-1.5 py-0.5 rounded tracking-tight">
                          Default
                        </span>
                      )}
                    </div>
                  </div>
                  <TierBadge tier={row.planTier} />
                  <StatusPill row={row} />
                </div>
              ))}
            </div>
          )}

          {/* Footer link */}
          {!error && (
            <div className="mt-3">
              <Link
                to="/connections?tab=ai-subscriptions"
                className="text-[12.5px] text-indigo-600 hover:text-indigo-800 no-underline hover:underline"
              >
                Edit availability →
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
