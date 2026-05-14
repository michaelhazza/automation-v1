// Collapsible group header rendered in Run Trace when attempt_number > 1
// (mockup r17). Each fresh-profile restart is shown as a collapsed group.

import { useState } from 'react';

interface AttemptGroupProps {
  attemptNumber: number;
  children: React.ReactNode;
}

export function AttemptGroup({ attemptNumber, children }: AttemptGroupProps) {
  const [open, setOpen] = useState(attemptNumber === 1);

  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden mb-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-2.5 bg-slate-50 hover:bg-slate-100 transition-colors text-left"
      >
        <svg
          className={`w-4 h-4 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
        <span className="text-[12px] font-semibold text-slate-700">
          Attempt {attemptNumber}
        </span>
        {attemptNumber > 1 && (
          <span className="text-[11px] text-amber-600 font-medium bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
            Fresh profile restart
          </span>
        )}
      </button>
      {open && (
        <div className="px-2 py-2 flex flex-col gap-1">{children}</div>
      )}
    </div>
  );
}
