/**
 * portfolioRollupJob — scheduled pg-boss worker for weekly rollups (§11.7)
 *
 * Iterates organisations and invokes runPortfolioRollup(briefing | digest)
 * for each. Individual failures log + continue.
 *
 * Scheduled via pg-boss:
 *   - Mon 08:00 → Portfolio Briefing
 *   - Fri 18:00 → Portfolio Digest
 */

import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { runPortfolioRollup } from '../services/portfolioRollupService.js';
import { logger } from '../lib/logger.js';

export interface PortfolioRollupJobData {
  kind: 'briefing' | 'digest';
}

export interface PortfolioRollupJobSummary {
  organisationsProcessed: number;
  inboxItemsCreated: number;
  skipped: number;
  failed: number;
  durationMs: number;
}

export async function runPortfolioRollupSweep(
  data: PortfolioRollupJobData,
): Promise<PortfolioRollupJobSummary> {
  const started = Date.now();
  let organisationsProcessed = 0;
  let inboxItemsCreated = 0;
  let skipped = 0;
  let failed = 0;

  const rows = (await db.execute(sql`
    SELECT id FROM organisations
    WHERE deleted_at IS NULL
    ORDER BY id
  `)) as unknown as Array<{ id: string }> | { rows?: Array<{ id: string }> };

  const orgIds = (Array.isArray(rows) ? rows : rows.rows ?? []).map((r) => r.id);

  for (const orgId of orgIds) {
    try {
      const result = await runPortfolioRollup({
        organisationId: orgId,
        kind: data.kind,
      });
      organisationsProcessed += 1;
      if (result.taskId) {
        inboxItemsCreated += 1;
      } else {
        skipped += 1;
      }
    } catch (err) {
      failed += 1;
      logger.error('portfolioRollupJob.org_failed', {
        orgId,
        kind: data.kind,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const summary: PortfolioRollupJobSummary = {
    organisationsProcessed,
    inboxItemsCreated,
    skipped,
    failed,
    durationMs: Date.now() - started,
  };

  logger.info('portfolioRollupJob.tick_complete', { kind: data.kind, ...summary });
  return summary;
}
