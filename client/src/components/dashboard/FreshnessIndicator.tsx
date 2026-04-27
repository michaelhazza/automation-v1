// client/src/components/dashboard/FreshnessIndicator.tsx
import { useEffect, useRef, useState } from 'react';

const PULSE_DEBOUNCE_MS = 1_500;
const PULSE_DURATION_MS = 600;

export function formatAge(lastUpdatedAt: Date, now = new Date()): string {
  const seconds = Math.max(0, Math.floor((now.getTime() - lastUpdatedAt.getTime()) / 1000));
  if (seconds < 10) return 'updated just now';
  if (seconds < 60) return `updated ${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `updated ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `updated ${hours}h ago`;
}

interface FreshnessIndicatorProps {
  lastUpdatedAt: Date;
}

export function FreshnessIndicator({ lastUpdatedAt }: FreshnessIndicatorProps): JSX.Element {
  const [displayText, setDisplayText] = useState(() => formatAge(lastUpdatedAt));
  const [pulsing, setPulsing] = useState(false);
  const pulseDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Refresh the displayed text every 5 seconds.
  useEffect(() => {
    setDisplayText(formatAge(lastUpdatedAt));
    const interval = setInterval(() => {
      setDisplayText(formatAge(lastUpdatedAt));
    }, 5_000);
    return () => clearInterval(interval);
  }, [lastUpdatedAt]);

  // Debounced pulse animation: fires 1500ms after the last prop change.
  useEffect(() => {
    if (pulseDebounce.current) clearTimeout(pulseDebounce.current);
    pulseDebounce.current = setTimeout(() => {
      setPulsing(true);
      setTimeout(() => setPulsing(false), PULSE_DURATION_MS);
    }, PULSE_DEBOUNCE_MS);
    return () => {
      if (pulseDebounce.current) clearTimeout(pulseDebounce.current);
    };
  }, [lastUpdatedAt]);

  return (
    <p className={`text-xs text-muted-foreground${pulsing ? ' freshness-pulse' : ''}`}>
      {displayText}
    </p>
  );
}
