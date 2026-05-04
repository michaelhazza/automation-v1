/**
 * StudioChatPanel — docked bottom-left pill / left side-panel for Studio AI.
 *
 * Spec: tasks/builds/workflows-v1-phase-2/plan.md Chunk 14b.
 *
 * Pill mode: fixed bottom-left small button. Click to expand.
 * Side-panel mode: fixed left-0 full-height panel.
 *
 * Orchestrator integration comes in Chunk 15.
 */

import { useState } from 'react';

export default function StudioChatPanel() {
  const [expanded, setExpanded] = useState(false);

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="fixed bottom-6 left-6 z-40 flex items-center gap-2 rounded-full bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-lg hover:bg-indigo-700 transition-colors"
        aria-label="Open Studio AI"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          className="w-4 h-4"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M10 2a8 8 0 100 16A8 8 0 0010 2zm0 3a1 1 0 011 1v3h3a1 1 0 110 2h-3v3a1 1 0 11-2 0v-3H6a1 1 0 110-2h3V6a1 1 0 011-1z"
            clipRule="evenodd"
          />
        </svg>
        Studio AI
      </button>
    );
  }

  return (
    <div className="fixed left-0 top-0 bottom-0 w-80 bg-white border-r border-slate-200 shadow-lg flex flex-col z-40">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <span className="text-sm font-medium text-slate-700">Studio AI</span>
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="text-slate-400 hover:text-slate-600 text-lg leading-none"
          aria-label="Close Studio AI"
        >
          ×
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        <p className="text-sm text-slate-500">
          AI workflow suggestions appear here. The orchestrator can propose changes as draft cards.
        </p>
      </div>
      <div className="border-t border-slate-200 px-4 py-3">
        <p className="text-xs text-slate-400">
          Suggestions from the orchestrator will appear as cards you can Apply or Discard.
        </p>
      </div>
    </div>
  );
}
