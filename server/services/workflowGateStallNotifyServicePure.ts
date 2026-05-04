export type StallCadence = '24h' | '72h' | '7d';

export const CADENCE_SECONDS: Record<StallCadence, number> = {
  '24h': 24 * 60 * 60,
  '72h': 72 * 60 * 60,
  '7d': 7 * 24 * 60 * 60,
};

export const STALL_CADENCES: StallCadence[] = ['24h', '72h', '7d'];

export function buildStallJobName(gateId: string, cadence: StallCadence): string {
  return `stall-notify-${gateId}-${cadence}`;
}

export function isStallFireStale(
  resolvedAt: Date | null,
  gateCreatedAt: Date,
  expectedCreatedAt: string,
): boolean {
  if (resolvedAt !== null) return true;
  return gateCreatedAt.toISOString() !== expectedCreatedAt;
}
