// client/src/components/dashboard/FreshnessIndicator.tsx
import { useEffect, useRef, useState } from 'react';

const PULSE_DEBOUNCE_MS = 1_500;
const PULSE_DURATION_MS = 600;

export function formatAge(lastUpdatedAt: Date, now = new Date()): string {
  const seconds = Math.floor((now.getTime() - lastUpdatedAt.getTime()) / 1000);
  if (seconds < 10) return 'updated just now';
  if (seconds < 60) return `updated ${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `updated ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `updated ${hours}h ago`;
}

// Full component body added in Task 5.
export function FreshnessIndicator(_props: { lastUpdatedAt: Date }): null {
  return null;
}
