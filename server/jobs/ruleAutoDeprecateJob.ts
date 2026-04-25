// Phase 6 / W3.5 — nightly rule auto-deprecation job.
// Registered in queueService as 'maintenance:rule-auto-deprecate'.

import { db } from '../db/index.js';
import { organisations } from '../db/schema/index.js';
import { applyBlockQualityDecay } from '../services/memoryEntryQualityService.js';
import { logger } from '../lib/logger.js';

export async function runRuleAutoDeprecate(): Promise<void> {
  const allOrgs = await db
    .select({ id: organisations.id })
    .from(organisations)
    .limit(500);

  let totalDecayed = 0;
  let totalAutoDeprecated = 0;

  for (const org of allOrgs) {
    try {
      const summary = await applyBlockQualityDecay(org.id);
      totalDecayed += summary.decayed;
      totalAutoDeprecated += summary.autoDeprecated;
    } catch (err) {
      logger.error('ruleAutoDeprecateJob: org failed', { err, organisationId: org.id });
    }
  }

  logger.info('ruleAutoDeprecateJob: complete', {
    totalDecayed,
    totalAutoDeprecated,
    orgsProcessed: allOrgs.length,
  });
}
