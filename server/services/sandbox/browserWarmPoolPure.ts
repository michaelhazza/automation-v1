import type { BrowserWarmSession } from '../../db/schema/browserWarmSessions.js';
import type { SubaccountIeeBrowserSettings } from '../../db/schema/subaccountIeeBrowserSettings.js';

/**
 * True if the session has been alive longer than maxAgeMinutes without being leased.
 * Default maxAge is 30 minutes.
 */
export function isStaleSession(
  session: Pick<BrowserWarmSession, 'createdAt' | 'status'>,
  nowMs: number,
  maxAgeMinutes = 30,
): boolean {
  if (session.status !== 'available') return false;
  return nowMs - session.createdAt.getTime() > maxAgeMinutes * 60 * 1000;
}

/**
 * True if the subaccount settings allow the warm pool to be maintained.
 * Both status='on' AND rolloutApproved=true must hold.
 */
export function isRefillEligible(
  settings: Pick<SubaccountIeeBrowserSettings, 'status' | 'rolloutApproved'> | null,
): boolean {
  return settings?.status === 'on' && settings?.rolloutApproved === true;
}

/**
 * Compute idle cost cents for a warm session.
 * Formula: Math.round((terminatedAtMs - createdAtMs) / 1000 * ratePerSecond)
 * Returns 0 for negative/zero durations.
 */
export function computeIdleCostCents(
  createdAtMs: number,
  terminatedAtMs: number,
  ratePerSecond: number,
): number {
  const elapsedMs = terminatedAtMs - createdAtMs;
  if (elapsedMs <= 0) return 0;
  return Math.round((elapsedMs / 1000) * ratePerSecond);
}

/**
 * Decide whether a session should be destroyed or returned to the pool on task completion.
 * Proxy-aligned sessions are destroyed (not reset) to prevent locale/timezone bleed
 * between tenants that may configure different proxy regions.
 * Standard (non-proxy) sessions follow the existing return-to-pool path.
 */
export function shouldDestroyOnReturn(
  sessionHadProxyAlignment: boolean,
): 'destroy' | 'return_to_pool' {
  return sessionHadProxyAlignment ? 'destroy' : 'return_to_pool';
}
