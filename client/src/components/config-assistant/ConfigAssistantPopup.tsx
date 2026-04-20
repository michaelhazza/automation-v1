/**
 * ConfigAssistantPopup — modal wrapper that surfaces the full Configuration
 * Assistant page inside a popup so operators can work the assistant from
 * any surface (nav button, contextual triggers, deep-links) without leaving
 * their current page.
 *
 * Session 1 / spec §5. Replaces the Phase 4.5 direct-patch
 * `ConfigAssistantChatPopup` (deleted in this chunk).
 *
 * Implementation note (Session 1 minimum viable): the popup renders the
 * full Configuration Assistant page inside an iframe. The full page is
 * session-cookie-authenticated on the same origin so the iframe loads
 * cleanly without additional cross-origin plumbing. The pragmatic trade-off
 * versus a true extracted <ConfigAssistantPanel> component is accepted for
 * Session 1; the extraction is queued for a follow-up session. Plan
 * preview, session resume, and background execution all work because the
 * iframe hosts the real page.
 */

import { useMemo } from 'react';
import { useConfigAssistantPopup } from '../../hooks/useConfigAssistantPopup';

export default function ConfigAssistantPopup() {
  const { open, initialPrompt, closeConfigAssistant } = useConfigAssistantPopup();

  // Build the iframe src with the deep-link prompt on fresh conversation
  // per spec §5.5. The full page parses the same query params.
  const iframeSrc = useMemo(() => {
    const params = new URLSearchParams();
    params.set('config-assistant', 'open');
    params.set('popup', '1');
    if (initialPrompt) params.set('prompt', initialPrompt);
    return `/admin/config-assistant?${params.toString()}`;
  }, [initialPrompt]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Configuration Assistant"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm"
      onClick={(e) => {
        // Click on the backdrop (not the card) closes the popup. Closing
        // does NOT cancel the server-side agent run — that persists.
        if (e.target === e.currentTarget) closeConfigAssistant();
      }}
    >
      <div className="relative w-[min(900px,95vw)] h-[min(85vh,800px)] bg-white rounded-xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200 bg-slate-50">
          <div className="flex items-center gap-2">
            <span aria-hidden="true">🤖</span>
            <h2 className="text-[14px] font-semibold text-slate-900">Configuration Assistant</h2>
          </div>
          <div className="flex items-center gap-2">
            <a
              href="/admin/config-assistant"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[12px] text-indigo-600 hover:text-indigo-700 hover:underline"
            >
              Open full page ↗
            </a>
            <button
              type="button"
              onClick={closeConfigAssistant}
              className="w-7 h-7 rounded hover:bg-slate-200 flex items-center justify-center text-slate-500 hover:text-slate-700"
              aria-label="Close"
            >
              ×
            </button>
          </div>
        </div>
        <iframe
          key={iframeSrc}
          src={iframeSrc}
          className="flex-1 w-full border-0"
          title="Configuration Assistant"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        />
      </div>
    </div>
  );
}
