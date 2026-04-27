// Pure decision helpers for synthetic checks.
// All functions are deterministic on their inputs — no DB access, no side effects.

/** Returns true if the queue has stalled (pending jobs but no recent completion). */
export function isQueueStalled(
  pending: number,
  lastCompletedAt: Date | null,
  now: Date,
  thresholdMinutes: number,
): boolean {
  if (pending <= 0) return false;
  const cutoff = new Date(now.getTime() - thresholdMinutes * 60 * 1000);
  return !lastCompletedAt || lastCompletedAt < cutoff;
}

/** Returns true if the agent has not run within the inactivity threshold. */
export function isAgentInactive(
  lastRunAt: Date | null,
  now: Date,
  thresholdMinutes: number,
): boolean {
  const cutoff = new Date(now.getTime() - thresholdMinutes * 60 * 1000);
  return !lastRunAt || lastRunAt < cutoff;
}

/** Returns true if the connector's last successful sync is older than interval × multiplier. */
export function isConnectorPollStale(
  lastSyncAt: Date | null,
  pollIntervalMinutes: number,
  multiplier: number,
  now: Date,
): boolean {
  const cutoff = new Date(now.getTime() - pollIntervalMinutes * multiplier * 60 * 1000);
  return !lastSyncAt || lastSyncAt < cutoff;
}

/** Returns true if the DLQ has stale failed jobs (count > 0). */
export function isDlqStale(staleCount: number): boolean {
  return staleCount > 0;
}

/** Returns true if the heartbeat is stale (older than staleTicks × tickIntervalSeconds). */
export function isHeartbeatStale(
  priorHeartbeat: Date | null,
  now: Date,
  staleTicks: number,
  tickIntervalSeconds: number,
): boolean {
  if (priorHeartbeat === null) return false; // first tick after start — healthy
  const thresholdMs = staleTicks * tickIntervalSeconds * 1000;
  return now.getTime() - priorHeartbeat.getTime() > thresholdMs;
}

/** Returns true if the connector has been in error status longer than the error window. */
export function isConnectorErrorRateElevated(
  status: string,
  updatedAt: Date,
  errorWindowMs: number,
  now: Date,
): boolean {
  if (status !== 'error') return false;
  return updatedAt.getTime() < now.getTime() - errorWindowMs;
}

/** Returns true if the agent's current success rate is below baseline p50 minus the drop threshold. */
export function isSuccessRateLow(
  currentRate: number,
  baselineP50: number,
  dropThreshold: number,
): boolean {
  return currentRate < baselineP50 - dropThreshold;
}
