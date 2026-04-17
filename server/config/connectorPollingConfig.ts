export const POLLING_TICK_CRON = '* * * * *'; // every minute
export const MAX_CONCURRENT_SYNCS = 5;
export const DEFAULT_POLL_INTERVAL_MINUTES = 15;
export const SYNC_LEASE_SAFETY_MULTIPLIER = 2;

export const STALE_THRESHOLDS = {
  warningMultiplier: 2,
  errorMultiplier: 5,
  recentErrorWindowHours: 24,
  neverSyncedGraceHours: 24,
} as const;
