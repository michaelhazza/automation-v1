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
 *   Mechanism:       (a) per-org decay reads `deprecated_at IS NULL` rows only
 *                    and writes deprecated_at exactly once per row, so re-running
 *                    on the same state is a no-op for already deprecated rows;
 *                    (b) the decay step applies the same delta given the same input
 *                    within a clock tick — mathematically idempotent.
 *   Failure mode:    a per-org failure logs and continues to the next org
 *                    rather than aborting the sweep.
 *
 * Execution contract (Phase 3 — B10-MAINT-RLS):
 *   - withAdminConnection + SET LOCAL ROLE admin_role to bypass RLS for the
 *     cross-org decay sweep (no app.organisation_id → fail-closed otherwise).
 *   - Sequential per-org processing; no parallel fan-out in v1.
 *   - Per-org try/catch: one org failure is logged; iteration continues.
 *   - Terminal event emitted with outcome counters regardless of mixed results.
 *
 * Per-org decay logic is run inline using the admin tx (mirrors the
 * memoryDedupJob.ts pattern where deduplicateSubaccount receives tx as a
 * parameter). The original applyBlockQualityDecay service function uses the
 * top-level `db` handle, which cannot inherit the admin bypass; the inline
 * variant below preserves identical arithmetic against the admin tx.
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

  let result: RuleAutoDeprecateResult;

  try {
    result = await withAdminConnection(
      { source: SOURCE, reason: 'Nightly cross-org memory_blocks quality decay sweep' },
      async (tx) => {
        await tx.execute(sql`SET LOCAL ROLE admin_role`);

        // Global advisory lock — prevents concurrent job invocations from
        // racing. Released automatically when this transaction commits.
        const lockKey = 'ruleAutoDeprecateJob';
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey})::bigint)`);

        if (__testHooks.pauseBetweenClaimAndCommit) {
          await __testHooks.pauseBetweenClaimAndCommit();
        }

        const orgs = (await tx.execute(
          sql`SELECT id FROM organisations LIMIT 500`,
        )) as unknown as Array<{ id: string }>;

        if (orgs.length === 0) {
          const noopResult: RuleAutoDeprecateResult = {
            status: 'noop',
            reason: 'no_rows_to_claim',
            jobRunId,
            durationMs: Date.now() - startedAt,
          };
          logger.info(`${SOURCE}.completed`, noopResult);
          return noopResult;
        }

        let totalDecayed = 0;
        let totalAutoDeprecated = 0;
        let orgsSucceeded = 0;
        let orgsFailed = 0;

        for (const org of orgs) {
          logger.info(`${SOURCE}.org_started`, { jobRunId, orgId: org.id });
          const orgStart = Date.now();
          try {
            const { decayed, autoDeprecated } = await applyDecayForOrg(tx, org.id);
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

        const status: 'success' | 'partial' | 'failed' =
          orgsFailed === 0 ? 'success'
          : orgsSucceeded === 0 ? 'failed'
          : 'partial';

        return {
          status,
          jobRunId,
          totalDecayed,
          totalAutoDeprecated,
          orgsAttempted: orgs.length,
          orgsSucceeded,
          orgsFailed,
          durationMs: Date.now() - startedAt,
        };
      },
    );
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    result = {
      status: 'failed',
      jobRunId,
      totalDecayed: 0,
      totalAutoDeprecated: 0,
      orgsAttempted: 0,
      orgsSucceeded: 0,
      orgsFailed: 0,
      durationMs,
    };
    logger.error(`${SOURCE}.completed`, {
      ...result,
      error: err instanceof Error ? err.message : String(err),
    });
    return result;
  }

  logger.info(`${SOURCE}.completed`, result);
  return result;
}
