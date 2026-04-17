/**
 * staleConnectorDetectorPure.ts — Canonical Data Platform P1 detector (pure).
 *
 * Pure function that computes staleness for a single integration connection
 * based on its last successful sync, poll interval, and error state.
 * No database access — the impure wrapper feeds pre-fetched rows.
 */

export interface ConnectorHealth {
  connectionId: string;
  connectionLabel: string;
  lastSuccessfulSyncAt: Date | null;
  lastSyncError: string | null;
  lastSyncErrorAt: Date | null;
  pollIntervalMinutes: number;
  createdAt: Date;
}

export type StaleSeverity = 'none' | 'warning' | 'error';

export interface StaleResult {
  severity: StaleSeverity;
  reason: string;
}

const WARNING_MULTIPLIER = 2;
const ERROR_MULTIPLIER = 5;
const RECENT_ERROR_WINDOW_HOURS = 24;
const NEVER_SYNCED_GRACE_HOURS = 24;

export function computeStaleness(
  connection: ConnectorHealth,
  now: Date,
): StaleResult {
  const intervalMs = connection.pollIntervalMinutes * 60 * 1000;

  // Never synced
  if (!connection.lastSuccessfulSyncAt) {
    const ageMs = now.getTime() - connection.createdAt.getTime();
    if (ageMs > NEVER_SYNCED_GRACE_HOURS * 60 * 60 * 1000) {
      return { severity: 'error', reason: `Never synced, created ${Math.round(ageMs / 3600000)}h ago` };
    }
    return { severity: 'none', reason: 'Within grace period' };
  }

  const elapsed = now.getTime() - connection.lastSuccessfulSyncAt.getTime();

  // Recent error check
  if (connection.lastSyncErrorAt) {
    const errorAge = now.getTime() - connection.lastSyncErrorAt.getTime();
    if (errorAge < RECENT_ERROR_WINDOW_HOURS * 60 * 60 * 1000 && elapsed > ERROR_MULTIPLIER * intervalMs) {
      return { severity: 'error', reason: `Last sync error within 24h and ${Math.round(elapsed / intervalMs)}× overdue` };
    }
  }

  if (elapsed > ERROR_MULTIPLIER * intervalMs) {
    return { severity: 'error', reason: `${Math.round(elapsed / intervalMs)}× overdue` };
  }

  if (elapsed > WARNING_MULTIPLIER * intervalMs) {
    return { severity: 'warning', reason: `${Math.round(elapsed / intervalMs)}× overdue` };
  }

  return { severity: 'none', reason: 'Healthy' };
}
