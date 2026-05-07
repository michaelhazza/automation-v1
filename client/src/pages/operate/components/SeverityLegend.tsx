// client/src/pages/operate/components/SeverityLegend.tsx
//
// Sticky-dismissible severity legend for the Activity page.
// Reads/writes localStorage key `activitySeverityLegendSeen:{userId}`.
// "Got it" sets the flag so it is never shown again for that user.

import React, { useState } from 'react';

interface SeverityLegendProps {
  /** The current user's ID. Used to namespace the localStorage key. */
  userId: string;
}

const SEVERITY_ITEMS: Array<{ level: 'critical' | 'warning' | 'info'; label: string; description: string; color: string }> = [
  {
    level: 'critical',
    label: 'Critical',
    description: 'Requires immediate attention. Failures or blocking issues.',
    color: '#ef4444',
  },
  {
    level: 'warning',
    label: 'Warning',
    description: 'Potential problems worth investigating soon.',
    color: '#f59e0b',
  },
  {
    level: 'info',
    label: 'Info',
    description: 'Informational events with no action required.',
    color: '#3b82f6',
  },
];

function storageKey(userId: string): string {
  return `activitySeverityLegendSeen:${userId}`;
}

function hasBeenSeen(userId: string): boolean {
  try {
    return localStorage.getItem(storageKey(userId)) === 'true';
  } catch {
    return false;
  }
}

function markSeen(userId: string): void {
  try {
    localStorage.setItem(storageKey(userId), 'true');
  } catch {
    // localStorage unavailable — silently ignore
  }
}

export function SeverityLegend({ userId }: SeverityLegendProps): React.ReactElement | null {
  const [dismissed, setDismissed] = useState(() => hasBeenSeen(userId));

  if (dismissed) return null;

  const handleDismiss = () => {
    markSeen(userId);
    setDismissed(true);
  };

  return (
    <div
      className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3"
      role="note"
      aria-label="Severity level legend"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide shrink-0">
            Severity
          </span>
          {SEVERITY_ITEMS.map(({ level, label, description, color }) => (
            <div key={level} className="flex items-center gap-1.5" title={description}>
              <span
                style={{
                  display: 'inline-block',
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: color,
                  flexShrink: 0,
                }}
                aria-hidden="true"
              />
              <span className="text-xs text-slate-700">
                <span className="font-medium">{label}</span>
                <span className="text-slate-500 ml-1 hidden sm:inline">— {description}</span>
              </span>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={handleDismiss}
          className="shrink-0 text-xs text-indigo-600 hover:text-indigo-800 hover:underline focus:outline-none"
        >
          Got it
        </button>
      </div>
    </div>
  );
}

export default SeverityLegend;
