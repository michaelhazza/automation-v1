/**
 * client/src/components/recommendations/AgentRecommendationsList.tsx
 *
 * Generic component for rendering open agent recommendations.
 * Used by DashboardPage (Chunk 4) and SubaccountDetailPage.
 *
 * Spec: docs/sub-account-optimiser-spec.md §6.3
 */

import React, { useState, useEffect, useCallback } from 'react';
import api from '../../lib/api.js';
import { useAgentRecommendations } from '../../hooks/useAgentRecommendations.js';
import { applyCollapsedView, type RecommendationRowShape, sortRows } from './AgentRecommendationsListPure.js';

// ── Props ─────────────────────────────────────────────────────────────────────

export type AgentRecommendationsListProps = {
  scope: { type: 'org'; orgId: string } | { type: 'subaccount'; subaccountId: string };
  includeDescendantSubaccounts?: boolean;
  mode?: 'collapsed' | 'expanded';
  limit?: number;
  emptyState?: 'hide' | 'show';
  collapsedDistinctScopeId?: boolean;
  onTotalChange?: (total: number) => void;
  onLatestUpdatedAtChange?: (latest: Date | null) => void;
  onExpandRequest?: () => void;
  onDismiss?: (recId: string) => void;
};

// ── Severity UI helpers ───────────────────────────────────────────────────────

function SeverityDot({ severity }: { severity: 'info' | 'warn' | 'critical' }) {
  const colorClass =
    severity === 'critical'
      ? 'bg-red-500'
      : severity === 'warn'
        ? 'bg-yellow-400'
        : 'bg-blue-400';
  return <span className={`inline-block w-2 h-2 rounded-full flex-shrink-0 mt-1.5 ${colorClass}`} />;
}

// ── Main component ────────────────────────────────────────────────────────────

export function AgentRecommendationsList({
  scope,
  includeDescendantSubaccounts = false,
  mode = 'collapsed',
  limit = 3,
  emptyState = 'hide',
  collapsedDistinctScopeId,
  onTotalChange,
  onLatestUpdatedAtChange,
  onExpandRequest,
  onDismiss,
}: AgentRecommendationsListProps) {
  // Compute effective collapsedDistinctScopeId per spec §6.3 default rule
  const effectiveCollapsedDistinctScopeId =
    collapsedDistinctScopeId !== undefined
      ? collapsedDistinctScopeId
      : scope.type === 'org' && includeDescendantSubaccounts && mode === 'collapsed';

  const scopeType = scope.type;
  const scopeId = scope.type === 'org' ? scope.orgId : scope.subaccountId;

  const { rows: allRows, total, latestUpdatedAt } = useAgentRecommendations({
    scopeType,
    scopeId,
    includeDescendantSubaccounts,
    limit: mode === 'expanded' ? 100 : undefined,
  });

  // Notify parent of total and latestUpdatedAt
  useEffect(() => {
    onTotalChange?.(total);
  }, [total, onTotalChange]);

  useEffect(() => {
    onLatestUpdatedAtChange?.(latestUpdatedAt ?? null);
  }, [latestUpdatedAt, onLatestUpdatedAtChange]);

  // Apply view logic (dedupe + sort + limit for collapsed mode)
  const displayRows = applyCollapsedView(allRows as RecommendationRowShape[], {
    limit,
    collapsedDistinctScopeId: effectiveCollapsedDistinctScopeId,
    mode,
    scopeType,
    includeDescendantSubaccounts,
  });

  const [ackInFlight, setAckInFlight] = useState<Set<string>>(new Set());
  const [ackBeat, setAckBeat] = useState<Set<string>>(new Set());
  const [dismissTarget, setDismissTarget] = useState<string | null>(null);
  const [dismissReason, setDismissReason] = useState('');

  const handleAck = useCallback(
    async (recId: string) => {
      if (ackInFlight.has(recId) || ackBeat.has(recId)) return;

      // Click-feedback beat: 250ms visual feedback before navigation
      setAckBeat((prev) => new Set([...prev, recId]));

      // Fire-and-forget acknowledge
      api.post(`/api/recommendations/${recId}/acknowledge`, {}).catch(() => {});

      setTimeout(() => {
        setAckBeat((prev) => {
          const next = new Set(prev);
          next.delete(recId);
          return next;
        });
        setAckInFlight((prev) => {
          const next = new Set(prev);
          next.delete(recId);
          return next;
        });
      }, 250);

      setAckInFlight((prev) => new Set([...prev, recId]));
    },
    [ackInFlight, ackBeat],
  );

  const handleDismissSubmit = useCallback(
    async (recId: string) => {
      if (!dismissReason.trim()) return;
      try {
        await api.post(`/api/recommendations/${recId}/dismiss`, { reason: dismissReason });
        onDismiss?.(recId);
      } catch {
        // Swallow — the hook will refetch on the socket event
      } finally {
        setDismissTarget(null);
        setDismissReason('');
      }
    },
    [dismissReason, onDismiss],
  );

  if (displayRows.length === 0) {
    if (emptyState === 'hide') return null;
    return (
      <div className="text-sm text-slate-400">No open recommendations.</div>
    );
  }

  return (
    <div className="space-y-2">
      {displayRows.map((row) => (
        <div
          key={row.id}
          className={`flex items-start gap-2.5 p-3 rounded-lg border border-slate-100 bg-white transition-opacity ${ackBeat.has(row.id) ? 'opacity-50' : ''}`}
        >
          <SeverityDot severity={row.severity} />
          <div className="flex-1 min-w-0">
            {/* Org-rollup label */}
            {scope.type === 'org' && includeDescendantSubaccounts && row.subaccount_display_name && (
              <span className="text-[11px] text-slate-500 font-medium mr-1">
                {row.subaccount_display_name} &middot;{' '}
              </span>
            )}
            <p className="text-sm font-medium text-slate-900 leading-snug">
              {ackBeat.has(row.id) ? 'Marked as resolved' : row.title}
            </p>
            <p className="text-xs text-slate-500 mt-0.5 leading-snug">{row.body}</p>
            <div className="flex items-center gap-3 mt-1.5">
              {row.action_hint && (
                <a
                  href={`#action:${row.action_hint}`}
                  className="text-xs font-medium text-blue-600 hover:text-blue-700"
                  onClick={(e) => {
                    e.preventDefault();
                    handleAck(row.id);
                    // Navigate after beat
                    setTimeout(() => {
                      window.location.href = row.action_hint!;
                    }, 260);
                  }}
                >
                  Help me fix this &rarr;
                </a>
              )}
              <button
                type="button"
                className="text-xs text-slate-400 hover:text-slate-600"
                onClick={() => setDismissTarget(row.id)}
              >
                Dismiss
              </button>
            </div>

            {/* Inline dismiss form */}
            {dismissTarget === row.id && (
              <div className="mt-2 flex items-center gap-2">
                <input
                  type="text"
                  className="flex-1 text-xs border border-slate-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  placeholder="Why are you dismissing this?"
                  value={dismissReason}
                  onChange={(e) => setDismissReason(e.target.value)}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleDismissSubmit(row.id);
                    if (e.key === 'Escape') {
                      setDismissTarget(null);
                      setDismissReason('');
                    }
                  }}
                />
                <button
                  type="button"
                  className="text-xs font-medium text-red-600 hover:text-red-700"
                  onClick={() => handleDismissSubmit(row.id)}
                >
                  Dismiss
                </button>
                <button
                  type="button"
                  className="text-xs text-slate-400 hover:text-slate-600"
                  onClick={() => {
                    setDismissTarget(null);
                    setDismissReason('');
                  }}
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export default AgentRecommendationsList;
