/**
 * maintenance:fast-path-decisions-prune
 * Prunes fast_path_decisions rows older than 90 days.
 * Scheduled daily at 03:30 UTC in queueService.ts.
 */

import { db } from '../db/index.js';
import { fastPathDecisions } from '../db/schema/index.js';
import { lt } from 'drizzle-orm';
import { logger } from '../lib/logger.js';

const RETENTION_DAYS = 90;

export async function pruneFastPathDecisions(): Promise<void> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);

  const result = await db
    .delete(fastPathDecisions)
    .where(lt(fastPathDecisions.decidedAt, cutoff))
    .returning({ id: fastPathDecisions.id });

  if (result.length > 0) {
    logger.info('maintenance:fast-path-decisions-prune', { rows_deleted: result.length, cutoff: cutoff.toISOString() });
  }
}
