// client/src/pages/govern/components/AiSubscriptionsTab.tsx
// Spec: tasks/builds/operator-session-identity/spec.md §Chunk 7

import { useState, useEffect, useCallback } from 'react';
import type { AiSubscriptionConnection } from '../../../../../shared/types/govern.js';
import { listAiSubscriptions } from '../../../api/governApi';
import { AiSubscriptionDetailModal } from './AiSubscriptionDetailModal';
import { ConnectAiSubscriptionModal } from './ConnectAiSubscriptionModal';
import { formatRelative } from './_utils';
import { StatusPill, TierBadge } from './_aiSubscriptionPills';

interface Props {
  subaccountId: string;
}

// ── Skeleton loader ──────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <tr>
      {[32, 18, 17, 13, 8, 12].map((w, i) => (
        <td key={i} className="px-4 py-3" style={{ width: `${w}%` }}>
          <div className="h-4 bg-slate-100 rounded animate-pulse" style={{ width: i === 0 ? '70%' : '80%' }} />
        </td>
      ))}
    </tr>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function AiSubscriptionsTab({ subaccountId }: Props) {
  const [rows, setRows] = useState<AiSubscriptionConnection[] | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [is501, setIs501] = useState(false);
  const [fetchKey, setFetchKey] = useState(0);
  const [selectedRow, setSelectedRow] = useState<AiSubscriptionConnection | null>(null);
  const [showConnect, setShowConnect] = useState(false);
  const [explainerVisible, setExplainerVisible] = useState(true);

  const reload = useCallback(() => setFetchKey((k) => k + 1), []);

  useEffect(() => {
    setRows(null);
    setError(null);
    setIs501(false);
    listAiSubscriptions(subaccountId)
      .then(setRows)
      .catch((e: unknown) => {
        const status = (e as { response?: { status?: number } }).response?.status;
        if (status === 501) {
          setIs501(true);
        } else {
          setError(e instanceof Error ? e : new Error(String(e)));
        }
      });
  }, [subaccountId, fetchKey]);

  // Sort: default first, then alphabetical
  const sorted = rows
    ? [...rows].sort((a, b) => {
        if (a.isDefault && !b.isDefault) return -1;
        if (!a.isDefault && b.isDefault) return 1;
        return (a.label ?? '').localeCompare(b.label ?? '');
      })
    : null;

  const isLoading = rows === null && !error && !is501;

  return (
    <div>
      {/* Tab subtitle */}
      <p className="text-xs text-slate-400 mb-3 mt-1">
        AI plans your autonomous agents can use to think, like ChatGPT
      </p>

      {/* Explainer banner */}
      {explainerVisible && !is501 && (
        <div className="flex items-start gap-3 p-3.5 mb-3 bg-blue-50 border border-blue-200 rounded-lg text-[13px] text-blue-800 leading-relaxed relative">
          <svg className="flex-shrink-0 mt-0.5 text-blue-500" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" />
          </svg>
          <span>
            When autonomous agent runs ship, the system uses your Default first, then other allowed AI Subscriptions, then platform model providers as a fallback.
          </span>
          <button
            type="button"
            onClick={() => setExplainerVisible(false)}
            className="absolute top-2.5 right-3 text-blue-300 hover:text-blue-700 bg-transparent border-0 cursor-pointer text-base leading-none p-0.5 rounded font-[inherit]"
            aria-label="Dismiss"
          >
            &times;
          </button>
        </div>
      )}

      {/* 501 state: provider verification pending */}
      {is501 && (
        <div className="flex items-start gap-3 p-3 mb-3 bg-sky-50 border border-sky-200 rounded-lg text-[12.5px] text-sky-800">
          <svg className="flex-shrink-0 mt-0.5" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" />
          </svg>
          <span>Provider verification pending. AI Subscriptions will become available soon.</span>
        </div>
      )}

      {/* Inline error banner */}
      {error && (
        <div className="flex items-center gap-3 p-3 mb-3 bg-red-50 border border-red-200 rounded-lg text-[12.5px] text-red-700">
          <span className="flex-1">Failed to load AI Subscriptions: {error.message}</span>
          <button
            type="button"
            onClick={reload}
            className="text-xs font-semibold text-red-700 underline cursor-pointer bg-transparent border-0 font-[inherit]"
          >
            Retry
          </button>
        </div>
      )}

      {/* TODO(chunk-10): Gate Connect, Make default, Edit availability, Disconnect buttons
          on OPERATOR_SESSION_CONNECT / OPERATOR_SESSION_DISCONNECT / OPERATOR_SESSION_ALLOW_AGENT_USE
          permissions from the /api/subaccounts/:id/my-permissions endpoint. */}
      {/* Toolbar: Connect button */}
      <div className="flex justify-end mb-3">
        {is501 ? (
          <button
            type="button"
            disabled
            title="Verifying OpenAI provider support. This will become available soon."
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-200 text-slate-400 text-[13px] font-semibold cursor-not-allowed border-0"
          >
            <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>
            Connect AI Subscription
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setShowConnect(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-[13px] font-semibold border-0 cursor-pointer transition-colors duration-150"
          >
            <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>
            Connect AI Subscription
          </button>
        )}
      </div>

      {/* Suspended banner (r11): shown when any connected subscription is not usable.
          "Suspended" label only — provider name not shown in customer-facing copy per
          open question 6 resolution in the plan. */}
      {sorted && sorted.some(r => r.usabilityState !== 'connected_usable' && r.usabilityState !== 'connected_unverified') && (
        <div className="flex items-start gap-3 p-3.5 mb-3 bg-red-50 border border-red-200 rounded-lg text-[13px] text-red-800">
          <svg className="flex-shrink-0 mt-0.5 text-red-500" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" />
          </svg>
          <div className="flex-1">
            <span className="font-semibold">Suspended</span>
            <span className="mx-1">—</span>
            <span>One or more AI Subscriptions are unavailable. Sign back in to restore access.</span>
          </div>
          <button
            type="button"
            onClick={() => {
              const suspended = sorted.find(r => r.usabilityState !== 'connected_usable' && r.usabilityState !== 'connected_unverified');
              if (suspended) setSelectedRow(suspended);
            }}
            className="shrink-0 px-3 py-1 text-[12px] font-semibold text-red-700 border border-red-300 bg-white hover:bg-red-50 rounded cursor-pointer"
          >
            Reconnect
          </button>
        </div>
      )}

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        {isLoading ? (
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b-2 border-slate-200">
                <th className="px-4 py-2.5 text-left text-[10.5px] font-bold uppercase tracking-wide text-slate-500 w-[32%]">Name</th>
                <th className="px-4 py-2.5 text-left text-[10.5px] font-bold uppercase tracking-wide text-slate-500 w-[18%]">Provider / Plan</th>
                <th className="px-4 py-2.5 text-left text-[10.5px] font-bold uppercase tracking-wide text-slate-500 w-[17%]">Status</th>
                <th className="px-4 py-2.5 text-left text-[10.5px] font-bold uppercase tracking-wide text-slate-500 w-[13%]">Last sync</th>
                <th className="px-4 py-2.5 text-left text-[10.5px] font-bold uppercase tracking-wide text-slate-500 w-[8%]">Owner</th>
                <th className="px-4 py-2.5 w-[12%]" />
              </tr>
            </thead>
            <tbody>
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonRow />
            </tbody>
          </table>
        ) : sorted && sorted.length === 0 ? (
          <div className="text-center py-14 px-8">
            <div className="w-12 h-12 rounded-xl bg-indigo-50 mx-auto mb-4 flex items-center justify-center text-2xl">
              <svg width="24" height="24" fill="none" stroke="#6366f1" strokeWidth="1.5" viewBox="0 0 24 24">
                <circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
              </svg>
            </div>
            <p className="text-[15px] font-bold text-slate-900 mb-2">No AI Subscriptions connected yet.</p>
            <p className="text-[13px] text-slate-500 leading-relaxed max-w-sm mx-auto mb-5">
              Connect a ChatGPT plan to let your autonomous agents (Available soon) think on a subscription instead of platform model providers.
            </p>
            <button
              type="button"
              onClick={() => setShowConnect(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-[13px] font-semibold border-0 cursor-pointer transition-colors duration-150"
            >
              <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>
              Connect AI Subscription
            </button>
          </div>
        ) : sorted && sorted.length > 0 ? (
          <table className={`w-full border-collapse ${is501 ? 'opacity-60 pointer-events-none' : ''}`}>
            <thead>
              <tr className="bg-slate-50 border-b-2 border-slate-200">
                <th className="px-4 py-2.5 text-left text-[10.5px] font-bold uppercase tracking-wide text-slate-500 w-[32%]">Name</th>
                <th className="px-4 py-2.5 text-left text-[10.5px] font-bold uppercase tracking-wide text-slate-500 w-[18%]">Provider / Plan</th>
                <th className="px-4 py-2.5 text-left text-[10.5px] font-bold uppercase tracking-wide text-slate-500 w-[17%]">Status</th>
                <th className="px-4 py-2.5 text-left text-[10.5px] font-bold uppercase tracking-wide text-slate-500 w-[13%]">Last sync</th>
                <th className="px-4 py-2.5 text-left text-[10.5px] font-bold uppercase tracking-wide text-slate-500 w-[8%]">Owner</th>
                <th className="px-4 py-2.5 w-[12%]" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => (
                <AiSubRow
                  key={row.id}
                  row={row}
                  onClick={() => setSelectedRow(row)}
                />
              ))}
            </tbody>
          </table>
        ) : null}
      </div>

      {/* Detail modal */}
      {selectedRow && (
        <AiSubscriptionDetailModal
          subaccountId={subaccountId}
          connection={selectedRow}
          onClose={() => setSelectedRow(null)}
          onUpdated={() => { setSelectedRow(null); reload(); }}
        />
      )}

      {/* Connect modal */}
      {showConnect && (
        <ConnectAiSubscriptionModal
          subaccountId={subaccountId}
          onClose={() => setShowConnect(false)}
          onConnected={() => { setShowConnect(false); reload(); }}
        />
      )}
    </div>
  );
}

// ── Row component ─────────────────────────────────────────────────────────────

function AiSubRow({
  row,
  onClick,
}: {
  row: AiSubscriptionConnection;
  onClick: () => void;
}) {
  const isDefault = row.isDefault;
  const rowClass = isDefault
    ? 'border-b border-slate-100 cursor-pointer bg-indigo-50/60 border-l-4 border-l-indigo-400 hover:bg-indigo-100/60 transition-colors'
    : 'border-b border-slate-100 cursor-pointer bg-white hover:bg-slate-50 transition-colors';

  const ownerName = row.user.displayName ?? 'Unknown';

  return (
    <tr className={rowClass} onClick={onClick}>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div
            className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
              isDefault ? 'bg-indigo-100' : 'bg-indigo-50 opacity-75'
            }`}
          >
            <svg width="16" height="16" fill="none" stroke="#6366f1" strokeWidth="1.5" viewBox="0 0 24 24">
              <circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
            </svg>
          </div>
          <div>
            <div className={`text-[13px] flex items-center gap-1.5 ${isDefault ? 'font-bold text-indigo-950' : 'font-medium text-slate-500'}`}>
              {row.label ?? `${row.provider} ${row.planTier}`}
              {isDefault && (
                <span className="inline-flex items-center text-[10px] font-extrabold text-indigo-700 bg-indigo-100 border border-indigo-300 px-2 py-0.5 rounded tracking-tight">
                  Default
                </span>
              )}
            </div>
            {!isDefault && (
              <div className="text-[10.5px] text-slate-400 italic mt-0.5">Also allowed</div>
            )}
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-1.5 text-[13px] text-slate-600">
          {row.provider}
          <TierBadge tier={row.planTier} />
        </div>
      </td>
      <td className="px-4 py-3">
        <StatusPill row={row} />
      </td>
      <td className="px-4 py-3 text-[12px] text-slate-400">
        {formatRelative(row.lastRefreshedAt)}
      </td>
      <td className="px-4 py-3">
        <span className="inline-flex text-[10.5px] font-medium text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
          {ownerName}
        </span>
      </td>
      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
        {/* Row click opens detail modal; no overflow menu needed since detail modal has all actions */}
      </td>
    </tr>
  );
}
