/**
 * InlineIntegrationCard — renders inside the agent conversation when a run is
 * blocked waiting for an OAuth integration connection.
 *
 * Four visual states derived from deriveCardState():
 *   active    → white card with Connect + Dismiss buttons
 *   pending   → white card with spinner (popup open, waiting for oauth_success)
 *   connected → green confirmation card (optimistic — server already resumed)
 *   expired   → grey card with expiry notice
 *   dismissed → compact 1-line stub with expand toggle
 */

import React, { useState } from 'react';
import type { IntegrationCardContent } from '../../../shared/types/integrationCardContent';
import { deriveCardState } from '../../../shared/types/integrationCardContent';
import { useOAuthPopup } from '../hooks/useOAuthPopup';

interface InlineIntegrationCardProps {
  card: IntegrationCardContent;
  runMetadata: { completedBlockSequences?: number[]; currentBlockSequence?: number } | null;
  messageId: string;
  onDismiss: (messageId: string) => void;
  onRetry?: () => void;
}

export function InlineIntegrationCard({
  card,
  runMetadata,
  messageId,
  onDismiss,
  onRetry,
}: InlineIntegrationCardProps) {
  const [dismissed, setDismissed] = useState(card.dismissed);
  const [expanded, setExpanded] = useState(false);
  const popup = useOAuthPopup();

  // Merge local dismissed state with card.dismissed (card.dismissed is initial
  // value from the server; local state reflects user actions in this session).
  const effectiveCard: IntegrationCardContent = { ...card, dismissed };

  const state = popup.status === 'success'
    ? 'connected'
    : popup.status === 'pending'
      ? 'pending' as const
      : deriveCardState(effectiveCard, runMetadata);

  const handleConnect = () => {
    popup.open(card.actionUrl);
  };

  const handleDismiss = () => {
    setDismissed(true);
    onDismiss(messageId);
    // TODO(v2): persist dismissed=true via PATCH /api/.../messages/:id/meta
  };

  // Dismissed stub
  if (state === 'dismissed' && !expanded) {
    return (
      <div className="self-start max-w-[70%] mt-0.5">
        <button
          onClick={() => setExpanded(true)}
          className="text-[12px] text-slate-400 hover:text-slate-600 transition-colors bg-transparent border-0 p-0 cursor-pointer"
        >
          Integration setup dismissed — click to expand
        </button>
      </div>
    );
  }

  return (
    <div className="self-start max-w-[70%] mt-1">
      {/* Connected state */}
      {state === 'connected' && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 flex items-center gap-2.5 shadow-sm">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-600 shrink-0">
            <path d="M20 6L9 17l-5-5" />
          </svg>
          <span className="text-[13px] font-medium text-emerald-800">
            Connected! Continuing execution…
          </span>
        </div>
      )}

      {/* Active / pending state */}
      {(state === 'active' || state === 'pending' || (state === 'dismissed' && expanded)) && (
        <div className="bg-white border border-slate-200 rounded-xl px-4 py-3.5 shadow-sm">
          {/* Header */}
          <div className="flex items-start justify-between gap-3 mb-1.5">
            <p className="text-[13.5px] font-semibold text-slate-800 leading-snug">
              {card.title}
            </p>
            {expanded && (
              <button
                onClick={() => setExpanded(false)}
                className="text-slate-400 hover:text-slate-600 bg-transparent border-0 cursor-pointer text-[18px] leading-none mt-[-2px] shrink-0"
                aria-label="Collapse"
              >
                ×
              </button>
            )}
          </div>
          <p className="text-[12.5px] text-slate-500 mb-3 leading-relaxed">
            {card.description}
          </p>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleConnect}
              disabled={popup.status === 'pending'}
              className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white text-[12.5px] font-semibold px-3.5 py-2 rounded-lg transition-colors cursor-pointer border-0"
            >
              {popup.status === 'pending' ? (
                <>
                  <svg className="animate-spin" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M21 12a9 9 0 11-6.219-8.56" />
                  </svg>
                  Connecting…
                </>
              ) : (
                card.actionLabel
              )}
            </button>
            {state !== 'dismissed' && (
              <button
                onClick={handleDismiss}
                className="text-[12px] text-slate-400 hover:text-slate-600 bg-transparent border-0 cursor-pointer px-2 py-2 transition-colors"
              >
                Dismiss
              </button>
            )}
          </div>

          {/* Expiry notice */}
          <p className="text-[11px] text-slate-400 mt-2">
            Expires {new Date(card.expiresAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>
      )}

      {/* Expired state */}
      {state === 'expired' && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 shadow-sm">
          <div className="flex items-center gap-2 mb-1">
            <span className="inline-flex items-center bg-slate-200 text-slate-600 text-[11px] font-semibold px-2 py-0.5 rounded-full">
              Expired
            </span>
            <p className="text-[13px] font-medium text-slate-600">{card.title}</p>
          </div>
          <p className="text-sm text-gray-500">Integration connection expired after 24 hours.</p>
          {onRetry && (
            <button
              onClick={onRetry}
              className="mt-2 px-3 py-1 text-sm bg-gray-100 hover:bg-gray-200 rounded border border-gray-300 text-gray-700"
            >
              Try again
            </button>
          )}
        </div>
      )}
    </div>
  );
}
