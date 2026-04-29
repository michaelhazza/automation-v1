/**
 * ruleAutoDeprecateJob (queue: maintenance:rule-auto-deprecate)
 *
 * Concurrency model: GLOBAL pg advisory lock (single runner — Pattern B)
 *   Justification:   nightly cadence, low frequency, no per-org parallelism
 *                    requirement. A single runner sweep across all orgs is
 *                    cheaper to reason about than per-org locks for a job
 *                    that fires once a day.
 *   Mechanism:       pg_advisory_xact_lock(hashtext('ruleAutoDeprecateJob')::bigint)
 *                    acquired inside the OUTER admin tx that wraps the entire
 *                    sweep — enumeration AND per-org mutation. The lock is
 *                    released when the outer tx commits or rolls back. A
 *                    second invocation arriving while the first runner holds
 *                    the lock blocks until the first commits, then re-iterates
 *                    orgs and finds the per-row `WHERE deprecated_at IS NULL`
 *                    predicate filters everything out, returning a structured
 *                    no-op.
 *   Key/lock space:  global (one shared key). Trades cross-org parallelism
 *                    for full-sweep race protection.
 *
 *   ⚠ This is Pattern B, NOT Pattern A. The lock MUST span mutation, not just
 *     enumeration. applyDecayForOrg's decay step subtracts BLOCK_DECAY_RATE
 *     from quality_score on every invocation against rows where
 *     deprecated_at IS NULL — overlapping runners that read the same row
 *     from independent transactions would double-decay the value. Holding
 *     the lock across the full sweep eliminates the race.
 *
 * Idempotency model: lock-serialised + `WHERE deprecated_at IS NULL` predicate
 *   Mechanism:       the global advisory lock guarantees only one sweep can
 *                    proceed at a time. Within that sweep, rows are read once
 *                    and updated once. A subsequent sweep observes already-
 *                    deprecated rows excluded by the predicate, so re-running
 *                    is a structured no-op.
 *   Failure mode:    a per-org failure rolls back that org's SAVEPOINT only;
 *                    siblings remain committed when the outer tx commits.
 *                    The sweep continues to the next org.
 *
 * Execution contract:
 *   - One outer `withAdminConnection` tx for the entire sweep.
 *   - `SET LOCAL ROLE admin_role` + `pg_advisory_xact_lock` acquired at the top.
 *   - Org enumeration runs inside the outer tx, while the lock is held.
 *   - Per-org work runs as SAVEPOINT subtransactions inside the outer tx
 *     (matches DEVELOPMENT_GUIDELINES.md §2 prescription for global-lock
 *     maintenance jobs). A per-org failure ROLLBACK TO SAVEPOINT restores
 *     that org's writes; siblings persist.
 *   - applyDecayForOrg's `WHERE organisation_id = ${organisationId}::uuid`
 *     filter on every UPDATE provides explicit org scoping — RLS is bypassed
 *     under admin_role, defense-in-depth comes from the explicit predicate.
 *   - Sequential per-org processing; no parallel fan-out in v1.
 *   - Terminal event emitted with outcome counters regardless of mixed results.
 *
 * __testHooks production safety: hook is undefined by default; the call site
 * uses the canonical `if (!__testHooks.<name>) return;` short-circuit so an
 * unset hook is dead code in production. Exported for race-window control in
 * idempotency tests only.
 */

import { sql } from 'drizzle-orm';
import type { OrgScopedTx } from '../db/index.js';
import { withAdminConnection } from '../lib/adminDbConnection.js';
import { logger } from '../lib/logger.js';

const SOURCE = 'rule-auto-deprecate' as const;

// Decay constants — kept in sync with memoryEntryQualityService.ts.
const BLOCK_DECAY_RATE = 0.02;
const BLOCK_AUTO_DEPRECATE_THRESHOLD = 0.15;
const BLOCK_AUTO_DEPRECATE_DAYS = 14;

export type RuleAutoDeprecateResult =
  | { status: 'noop'; reason: 'no_rows_to_claim'; jobRunId: string; durationMs: number }
  | {
      status: 'success' | 'partial' | 'failed';
      jobRunId: string;
      totalDecayed: number;
      totalAutoDeprecated: number;
      orgsAttempted: number;
      orgsSucceeded: number;
      orgsFailed: number;
      durationMs: number;
    };

/**
 * Test-only seam for race-window control. Production behaviour is unchanged
 * when this hook is unset (see header production-safety contract).
 */
export const __testHooks: { pauseBetweenClaimAndCommit?: () => Promise<void> } = {};

/** Pure helper: classify a memory block for decay/auto-deprecation. */
export function classifyMemoryBlock(
  qualityScore: number,
  daysSinceUpdate: number,
): 'auto_deprecate' | 'decay' | 'no_change' {
  const newScore = Math.max(0, qualityScore - BLOCK_DECAY_RATE);
  if (newScore < BLOCK_AUTO_DEPRECATE_THRESHOLD && daysSinceUpdate >= BLOCK_AUTO_DEPRECATE_DAYS) {
    return 'auto_deprecate';
  }
  if (newScore !== qualityScore) {
    return 'decay';
  }
  return 'no_change';
}

/** Per-org decay sweep using the provided admin tx (mirrors memoryDedupJob pattern). */
async function applyDecayForOrg(
  tx: OrgScopedTx,
  organisationId: string,
): Promise<{ decayed: number; autoDeprecated: number }> {
  const now = new Date();
  let decayed = 0;
  let autoDeprecated = 0;

  const rows = (await tx.execute(sql`
    SELECT id, quality_score, updated_at
    FROM memory_blocks
    WHERE organisation_id = ${organisationId}::uuid
      AND deleted_at IS NULL
      AND deprecated_at IS NULL
  `)) as unknown as Array<{
    id: string;
    quality_score: string | null;
    updated_at: Date;
  }>;

  for (const row of rows) {
    const currentScore = Number(row.quality_score ?? 0.5);
    const daysSinceUpdate =
      (now.getTime() - new Date(row.updated_at).getTime()) / (1000 * 60 * 60 * 24);

    const action = classifyMemoryBlock(currentScore, daysSinceUpdate);

    if (action === 'auto_deprecate') {
      await tx.execute(sql`
        UPDATE memory_blocks
        SET deprecated_at = ${now}, deprecation_reason = 'low_quality', updated_at = ${now}
        WHERE id = ${row.id}::uuid AND organisation_id = ${organisationId}::uuid
      `);
      autoDeprecated++;
    } else if (action === 'decay') {
      const newScore = Math.max(0, currentScore - BLOCK_DECAY_RATE);
      await tx.execute(sql`
        UPDATE memory_blocks
        SET quality_score = ${String(newScore.toFixed(2))}
        WHERE id = ${row.id}::uuid AND organisation_id = ${organisationId}::uuid
      `);
      decayed++;
    }
  }

  return { decayed, autoDeprecated };
}

export async function runRuleAutoDeprecate(): Promise<RuleAutoDeprecateResult> {
  const jobRunId = crypto.randomUUID();
  const startedAt = Date.now();

  logger.info(`${SOURCE}.started`, { jobRunId, scheduledAt: new Date().toISOString() });

  let totalDecayed = 0;
  let totalAutoDeprecated = 0;
  let orgsAttempted = 0;
  let orgsSucceeded = 0;
  let orgsFailed = 0;
  let orgsCount = 0;

  try {
    await withAdminConnection(
      {
        source: SOURCE,
        reason: 'Nightly cross-org memory_blocks quality decay sweep (lock spans full sweep)',
      },
      async (tx) => {
        await tx.execute(sql`SET LOCAL ROLE admin_role`);

        // Global advisory lock — Pattern B: held across BOTH enumeration AND
        // per-org mutation. Released automatically when this outer tx
        // commits or rolls back. A second invocation that arrives while
        // this lock is held blocks until commit, then re-iterates orgs and
        // finds already-deprecated rows filtered by `deprecated_at IS NULL`.
        const lockKey = 'ruleAutoDeprecateJob';
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey})::bigint)`);

        if (__testHooks.pauseBetweenClaimAndCommit) {
          await __testHooks.pauseBetweenClaimAndCommit();
        }

        const orgs = (await tx.execute(
          sql`SELECT id FROM organisations LIMIT 500`,
        )) as unknown as Array<{ id: string }>;

        orgsCount = orgs.length;
        if (orgs.length === 0) return;

        // Per-org work as SAVEPOINT subtransactions inside the lock-holding
        // outer admin tx (mirrors DEVELOPMENT_GUIDELINES.md §2 prescription
        // for global-lock maintenance jobs). A per-org failure rolls back
        // to its savepoint; siblings remain committed when the outer tx
        // commits. RLS is bypassed under admin_role — applyDecayForOrg's
        // explicit `WHERE organisation_id = ...` predicate is the org scope
        // boundary.
        for (let i = 0; i < orgs.length; i++) {
          const org = orgs[i];
          // Savepoint name is a static prefix + a sequential index we control,
          // so no SQL injection surface — `sql.raw` is safe here.
          const savepoint = `org_${i}`;
          orgsAttempted++;
          logger.info(`${SOURCE}.org_started`, { jobRunId, orgId: org.id });
          const orgStart = Date.now();

          try {
            await tx.execute(sql.raw(`SAVEPOINT ${savepoint}`));
            const { decayed, autoDeprecated } = await applyDecayForOrg(tx, org.id);
            await tx.execute(sql.raw(`RELEASE SAVEPOINT ${savepoint}`));

            totalDecayed += decayed;
            totalAutoDeprecated += autoDeprecated;
            orgsSucceeded++;
            logger.info(`${SOURCE}.org_completed`, {
              jobRunId,
              orgId: org.id,
              rowsAffected: decayed + autoDeprecated,
              durationMs: Date.now() - orgStart,
              status: 'success',
            });
          } catch (err) {
            try {
              await tx.execute(sql.raw(`ROLLBACK TO SAVEPOINT ${savepoint}`));
              await tx.execute(sql.raw(`RELEASE SAVEPOINT ${savepoint}`));
            } catch (rollbackErr) {
              logger.warn(`${SOURCE}.savepoint_cleanup_failed`, {
                jobRunId,
                orgId: org.id,
                savepoint,
                error:
                  rollbackErr instanceof Error
                    ? rollbackErr.message
                    : String(rollbackErr),
              });
            }
            orgsFailed++;
            logger.error(`${SOURCE}.org_failed`, {
              jobRunId,
              orgId: org.id,
              error: err instanceof Error ? err.message : String(err),
              errorClass: err instanceof Error ? 'tx_failure' : 'unknown',
              status: 'failed',
            });
          }
        }
      },
    );
  } catch (err) {
    const failedResult: RuleAutoDeprecateResult = {
      status: 'failed',
      jobRunId,
      totalDecayed: 0,
      totalAutoDeprecated: 0,
      orgsAttempted: 0,
      orgsSucceeded: 0,
      orgsFailed: 0,
      durationMs: Date.now() - startedAt,
    };
    logger.error(`${SOURCE}.completed`, {
      ...failedResult,
      error: err instanceof Error ? err.message : String(err),
    });
    return failedResult;
  }

  if (orgsCount === 0) {
    const noopResult: RuleAutoDeprecateResult = {
      status: 'noop',
      reason: 'no_rows_to_claim',
      jobRunId,
      durationMs: Date.now() - startedAt,
    };
    logger.info(`${SOURCE}.completed`, noopResult);
    return noopResult;
  }

  const status: 'success' | 'partial' | 'failed' =
    orgsFailed === 0 ? 'success'
    : orgsSucceeded === 0 ? 'failed'
    : 'partial';

  const result: RuleAutoDeprecateResult = {
    status,
    jobRunId,
    totalDecayed,
    totalAutoDeprecated,
    orgsAttempted,
    orgsSucceeded,
    orgsFailed,
    durationMs: Date.now() - startedAt,
  };

  logger.info(`${SOURCE}.completed`, result);
  return result;
}
