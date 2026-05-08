import { useState, useEffect, useRef } from 'react';
import type { AgentPresenceState } from '../../../../shared/types/agentPresence';

const STATE_LABELS: Record<AgentPresenceState, string> = {
  idle: 'Idle',
  running: 'Running',
  waiting_on_human: 'Waiting',
  waiting_on_dependency: 'Waiting',
  scheduled: 'Scheduled',
  degraded: 'Degraded',
  failed: 'Failed',
};

const STATE_COLORS: Record<AgentPresenceState, string> = {
  idle: 'bg-slate-100 text-slate-600',
  running: 'bg-emerald-100 text-emerald-700',
  waiting_on_human: 'bg-amber-100 text-amber-700',
  waiting_on_dependency: 'bg-amber-100 text-amber-700',
  scheduled: 'bg-blue-100 text-blue-700',
  degraded: 'bg-orange-100 text-orange-700',
  failed: 'bg-red-100 text-red-700',
};

interface Props {
  presence: {
    state: AgentPresenceState;
    subtitle: string | null;
    currentFocus: { text: string } | null;
    elapsedSinceRunStartMs: number | null;
    serverNow: string;
  };
  agentId: string;
}

export default function PresenceHero({ presence, agentId: _agentId }: Props) {
  const { state, subtitle, currentFocus, elapsedSinceRunStartMs } = presence;

  // Client-side elapsed ticker — display only, resets from server value
  const [localElapsedMs, setLocalElapsedMs] = useState<number | null>(elapsedSinceRunStartMs);
  const serverElapsedRef = useRef(elapsedSinceRunStartMs);

  useEffect(() => {
    // Reset to server-authoritative value whenever it changes
    serverElapsedRef.current = elapsedSinceRunStartMs;
    setLocalElapsedMs(elapsedSinceRunStartMs);
  }, [elapsedSinceRunStartMs]);

  useEffect(() => {
    if (state !== 'running' || elapsedSinceRunStartMs === null) {
      setLocalElapsedMs(elapsedSinceRunStartMs);
      return;
    }
    const interval = setInterval(() => {
      setLocalElapsedMs(prev => (prev !== null ? prev + 1000 : null));
    }, 1000);
    return () => clearInterval(interval);
  }, [state, elapsedSinceRunStartMs]);

  const elapsedLabel = localElapsedMs !== null
    ? `${Math.floor(localElapsedMs / 60000)}m ${Math.floor((localElapsedMs % 60000) / 1000)}s`
    : null;

  return (
    <div className="bg-white rounded-lg border border-slate-100 p-4">
      <div className="flex items-center gap-3">
        {/* Fixed-width pill — same width for all 7 states per §13.8 */}
        <span
          aria-live="polite"
          className={`inline-flex items-center justify-center w-28 px-2 py-0.5 rounded-full text-xs font-medium ${STATE_COLORS[state]}`}
        >
          {STATE_LABELS[state]}
        </span>
        {elapsedLabel && state === 'running' && (
          <span className="text-xs text-slate-400">{elapsedLabel}</span>
        )}
      </div>
      {subtitle && (
        <p className="text-sm text-slate-500 mt-2">{subtitle}</p>
      )}
      {currentFocus?.text && (
        <p className="text-sm text-slate-700 mt-1 truncate">{currentFocus.text}</p>
      )}
    </div>
  );
}
