import { recordIncident } from '../../incidentIngestor.js';
import { logger } from '../../../lib/logger.js';
import { baselineReader } from '../baselines/baselineReader.js';
import { SYNTHETIC_CHECKS } from './index.js';
import { runStaleTriageSweep } from '../triage/staleTriageSweep.js';
import type { HeuristicContext } from '../heuristics/types.js';

export async function runSyntheticChecksTick(): Promise<void> {
  if (process.env.SYNTHETIC_CHECKS_ENABLED === 'false') {
    logger.info('synthetic_checks_disabled');
    return;
  }

  const now = new Date();
  const ctx: HeuristicContext = {
    now,
    baselines: baselineReader,
    logger,
  };

  logger.info('synthetic_checks_tick_start', { checkCount: SYNTHETIC_CHECKS.length });

  try {
    await runStaleTriageSweep(now);
  } catch (err) {
    logger.error('stale_triage_sweep_error', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  for (const check of SYNTHETIC_CHECKS) {
    try {
      const result = await check.run(ctx);

      if (!result.fired) continue;

      await recordIncident({
        source: 'synthetic',
        severity: result.severity,
        classification: 'system_fault',
        summary: result.summary,
        affectedResourceKind: result.resourceKind,
        affectedResourceId: result.resourceId,
        fingerprintOverride: `synthetic:${check.id}:${result.resourceKind}:${result.resourceId}`,
        idempotencyKey: `synthetic:${check.id}:${result.resourceKind}:${result.resourceId}:${result.bucketKey}`,
        errorDetail: result.metadata,
      });

      logger.info('synthetic_check_fired', {
        checkId: check.id,
        resourceKind: result.resourceKind,
        resourceId: result.resourceId,
        severity: result.severity,
      });
    } catch (err) {
      logger.error('synthetic_check_error', {
        checkId: check.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.info('synthetic_checks_tick_complete', { checkCount: SYNTHETIC_CHECKS.length });
}
