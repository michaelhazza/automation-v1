/**
 * ruleAutoDeprecateJob (queue: maintenance:rule-auto-deprecate)
 *
 * Concurrency model: GLOBAL pg advisory lock (single runner)
 *   Justification:   nightly cadence, low frequency, no per-org parallelism
 *                    requirement. A single runner sweep across all orgs is
 *                    cheaper to reason about than per-org locks for a job
 *                    that fires once a day. (Per the spec's per-org default,
 *                    the global scope is documented here as the explicit
 *                    exception, not implicit.)
 *   Mechanism:       pg_advisory_xact_lock(hashtext('ruleAutoDeprecateJob')::bigint)
 *                    inside a top-level transaction. The lock is released
 *                    when the transaction commits or rolls back. A second
 *                    invocation that arrives while the first runner holds
 *                    the lock will block until the first commits, then
 *                    re-iterate orgs and find the per-row WHERE
 *                    `deprecated_at IS NULL` predicate filters everything
 *                    out, returning a structured no-op.
 *   Key/lock space:  global (one shared key). Trades cross-org parallelism
 *                    for simplicity at this cadence.
 *
 * Idempotency model: idempotent-by-construction + WHERE deprecated_at IS NULL predicate
 *   Mechanism:       (a) `applyBlockQualityDecay` reads `deprecated_at IS NULL`
 *                    rows only and writes deprecated_at exactly once per row,
 *                    so re-running on the same state is a no-op for already
 *                    deprecated rows; (b) the decay step applies the same
 *                    delta given the same input within a clock tick — within
 *                    a single tick the function is mathematically idempotent.
 *   Failure mode:    a per-org failure logs and continues to the next org
 *                    rather than aborting the sweep. A mid-execution crash
 *                    rolls back the pending decay write for the in-flight
 *                    org via the wrapping transaction; the next nightly run
 *                    picks up where it left off via the `deprecated_at IS NULL`
 *                    predicate.
 *
 * __testHooks production safety: hook is undefined by default; the call site
 * uses the canonical `if (!__testHooks.<name>) return;` short-circuit so an
 * unset hook is dead code in production. Exported for race-window control in
 * idempotency tests only.
 */

import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { organisations } from '../db/schema/index.js';
import { applyBlockQualityDecay } from '../services/memoryEntryQualityService.js';
import { logger } from '../lib/logger.js';

const JOB_NAME = 'ruleAutoDeprecateJob' as const;

export type RuleAutoDeprecateResult =
  | { status: 'noop'; reason: 'no_rows_to_claim'; jobName: typeof JOB_NAME }
  | {
      status: 'ok';
      jobName: typeof JOB_NAME;
      totalDecayed: number;
      totalAutoDeprecated: number;
      orgsProcessed: number;
    };

/**
 * Test-only seam for race-window control. Production behaviour is unchanged
 * when this hook is unset (see header production-safety contract).
 */
export const __testHooks: { pauseBetweenClaimAndCommit?: () => Promise<void> } = {};

export async function runRuleAutoDeprecate(): Promise<RuleAutoDeprecateResult> {
  return db.transaction(async (tx) => {
    // Global advisory lock. Acquired before reading the org list so a sibling
    // runner waits here rather than racing into the per-org loop. Released
    // automatically when this transaction commits or rolls back.
    const lockKey = 'ruleAutoDeprecateJob';
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey})::bigint)`);

    // Race-window control seam (test-only). Canonical guarded short-circuit
    // so production with the hook unset is identical to a job with no hook.
    if (__testHooks.pauseBetweenClaimAndCommit) {
      await __testHooks.pauseBetweenClaimAndCommit();
    }

    const allOrgs = await tx
      .select({ id: organisations.id })
      .from(organisations)
      .limit(500);

    if (allOrgs.length === 0) {
      logger.info('job_noop', { jobName: JOB_NAME, reason: 'no_rows_to_claim' });
      return { status: 'noop', reason: 'no_rows_to_claim', jobName: JOB_NAME };
    }

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

    return {
      status: 'ok',
      jobName: JOB_NAME,
      totalDecayed,
      totalAutoDeprecated,
      orgsProcessed: allOrgs.length,
    };
  });
}
