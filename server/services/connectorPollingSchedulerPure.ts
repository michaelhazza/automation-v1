export interface PollingConnection {
  id: string;
  syncPhase: 'backfill' | 'transition' | 'live';
  lastSuccessfulSyncAt: Date | null;
  pollIntervalMinutes: number;
}

export function selectConnectionsDue(
  connections: PollingConnection[],
  now: Date,
): string[] {
  return connections
    .filter((c) => {
      if (!['backfill', 'transition', 'live'].includes(c.syncPhase)) return false;
      if (!c.lastSuccessfulSyncAt) return true;
      const elapsed = now.getTime() - c.lastSuccessfulSyncAt.getTime();
      return elapsed >= c.pollIntervalMinutes * 60 * 1000;
    })
    .map((c) => c.id);
}
