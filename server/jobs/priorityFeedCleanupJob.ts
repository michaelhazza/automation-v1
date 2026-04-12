/**
 * Priority Feed Cleanup Job — Feature 2
 *
 * Runs daily to clean up expired priority feed claims.
 * Expired claims are no longer blocking other agents from picking up items.
 */

import { cleanupExpiredClaims } from '../services/priorityFeedService.js';

export async function runPriorityFeedCleanup(): Promise<void> {
  const count = await cleanupExpiredClaims();
  console.info(`[PriorityFeedCleanup] Cleaned ${count} expired claims`);
}
