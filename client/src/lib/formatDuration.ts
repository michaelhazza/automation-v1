/**
 * formatDuration.ts
 *
 * Shared duration formatter used across ClientPulse and run-trace surfaces.
 *
 * Contract:
 *   null          → '—'
 *   0–999 ms      → '0s'
 *   1 000–59 999  → 'Ns'       (Math.floor seconds)
 *   60 000–3 599 999 → 'Nm Ns' (Math.floor minutes + floor remaining seconds)
 *   ≥ 3 600 000   → 'Nh Nm'   (Math.floor hours + floor remaining minutes)
 */

export function formatDuration(ms: number | null): string {
  if (ms == null) return '—';

  const totalSeconds = Math.floor(ms / 1000);

  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }

  const totalMinutes = Math.floor(totalSeconds / 60);

  if (totalMinutes < 60) {
    const remainingSeconds = totalSeconds % 60;
    return `${totalMinutes}m ${remainingSeconds}s`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const remainingMinutes = totalMinutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}
