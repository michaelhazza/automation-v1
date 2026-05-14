/**
 * bundleUtilizationJob (queue: maintenance:bundle-utilization)
 *
 * Concurrency model: per-org pg advisory lock
 *   Mechanism:       pg_advisory_xact_lock(hashtext('<orgId>::bundleUtilization')::bigint)
 *                    inside the admin transaction. The lock is released
 *                    automatically when the transaction commits or rolls back.
 *   Key/lock space:  per-(organisationId, 'bundleUtilization'). Distinct orgs
 *                    proceed in parallel; two runners targeting the same org
 *                    serialise — the second waits for the first to commit and
 *                    then re-reads current state, which is harmless because
 *                    the work is replay-safe.
 *
 * Idempotency model: replay-safe — recompute the rollup deterministically
 *                    from current state and write via UPDATE on the
 *                    document_bundles row. Retries converge to the same
 *                    final shape because (a) the inputs (live members,
 *                    snapshots, policies) are deterministic at any point in
 *                    time, and (b) the write replaces the entire
 *                    utilizationByModelFamily JSONB blob — never appends.
 *   Failure mode:    a mid-execution crash inside the admin transaction
 *                    rolls back via Drizzle's transaction wrapper — partial
 *                    utilization writes for one org never persist.
 *
 * For every live named bundle x every model family in model_tier_budget_policies:
 *   1. Reads the latest bundle_resolution_snapshots row for (bundle_id, model_family).
 *   2. If the snapshot's bundleVersion < bundle.currentVersion (bundle edited since last
 *      resolution), computes estimatedPrefixTokens live from current member tokenCounts.
 *   3. If no snapshot exists, derives estimatedPrefixTokens from live members.
 *   4. Computes utilizationRatio = estimatedPrefixTokens / maxInputTokens.
 *   5. Writes the result to document_bundles.utilizationByModelFamily (JSONB).
 *
 * Uses withAdminConnection so the cross-org read is not blocked by tenant RLS.
 *
 * Schedule: disabled until Phase 6 (pilot validation). The worker is registered
 * in queueService.ts so jobs can be triggered manually during development.
 *
 * __testHooks production safety: the hook is undefined by default; the call
 * site uses the canonical `if (!__testHooks.<name>) return;` short-circuit so
 * an unset hook is dead code in production. The hook is exported only to
 * allow race-window control inside idempotency tests.
 */

import { sql, eq, and, isNull, desc } from 'drizzle-orm';
import { withAdminConnection } from '../lib/adminDbConnection.js';
import {
  documentBundles,
  documentBundleMembers,
  bundleResolutionSnapshots,
  referenceDocumentVersions,
  modelTierBudgetPolicies,
} from '../db/schema/index.js';
import { logger } from '../lib/logger.js';

const JOB_NAME = 'bundleUtilizationJob' as const;

export type BundleUtilizationResult =
  | { status: 'noop'; reason: 'no_rows_to_claim' | 'predicate_filtered'; jobName: typeof JOB_NAME }
  | { status: 'ok'; jobName: typeof JOB_NAME; bundlesProcessed: number };

/**
 * Test-only seam for race-window control. Production behaviour is unchanged
 * when this hook is unset (see header production-safety contract).
 */
export const __testHooks: { pauseBetweenClaimAndCommit?: () => Promise<void> } = {};

export async function runBundleUtilization(): Promise<BundleUtilizationResult> {
  return withAdminConnection({ source: 'bundle_utilization_job' }, async (adminDb) => {
    // 1. Fetch all live named bundles and all platform-default policies
    const [allBundles, allPolicies] = await Promise.all([
      adminDb
        .select({
          id: documentBundles.id,
          organisationId: documentBundles.organisationId,
          currentVersion: documentBundles.currentVersion,
        })
        .from(documentBundles)
        .where(and(eq(documentBundles.isAutoCreated, false), isNull(documentBundles.deletedAt))),

      adminDb
        .select({
          modelFamily: modelTierBudgetPolicies.modelFamily,
          maxInputTokens: modelTierBudgetPolicies.maxInputTokens,
        })
        .from(modelTierBudgetPolicies)
        .where(isNull(modelTierBudgetPolicies.organisationId)),
    ]);

    if (allBundles.length === 0 || allPolicies.length === 0) {
      logger.info('job_noop', { jobName: JOB_NAME, reason: 'no_rows_to_claim' });
      return { status: 'noop', reason: 'no_rows_to_claim', jobName: JOB_NAME };
    }

    // Race-window control seam (test-only). Canonical guarded short-circuit
    // so production with the hook unset is identical to a job with no hook.
    if (__testHooks.pauseBetweenClaimAndCommit) {
      await __testHooks.pauseBetweenClaimAndCommit();
    }

    let bundlesProcessed = 0;

    for (const bundle of allBundles) {
      // Per-org advisory lock. Two runners scheduled for the same tick
      // serialise per-org but proceed in parallel across orgs. The lock is
      // released when the wrapping admin transaction commits / rolls back.
      const lockKey = `${bundle.organisationId}::bundleUtilization`;
      await adminDb.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey})::bigint)`);

      const utilizationByModelFamily: Record<
        string,
        { utilizationRatio: number; estimatedPrefixTokens: number; computedAt: string }
      > = {};

      for (const policy of allPolicies) {
        // 2. Find the latest snapshot for (bundle, modelFamily)
        const [latestSnapshot] = await adminDb
          .select({
            bundleVersion: bundleResolutionSnapshots.bundleVersion,
            estimatedPrefixTokens: bundleResolutionSnapshots.estimatedPrefixTokens,
          })
          .from(bundleResolutionSnapshots)
          .where(
            and(
              eq(bundleResolutionSnapshots.bundleId, bundle.id),
              eq(bundleResolutionSnapshots.modelFamily, policy.modelFamily)
            )
          )
          .orderBy(desc(bundleResolutionSnapshots.createdAt))
          .limit(1);

        let estimatedPrefixTokens: number;

        if (latestSnapshot && latestSnapshot.bundleVersion >= bundle.currentVersion) {
          // Snapshot is current
          estimatedPrefixTokens = latestSnapshot.estimatedPrefixTokens;
        } else {
          // Bundle edited since last snapshot OR no snapshot exists — compute live
          const liveMembers = await adminDb
            .select({
              tokenCounts: referenceDocumentVersions.tokenCounts,
            })
            .from(documentBundleMembers)
            .innerJoin(
              referenceDocumentVersions,
              and(
                eq(documentBundleMembers.documentId, referenceDocumentVersions.documentId),
                sql`${referenceDocumentVersions.version} = (
                  SELECT MAX(v2.version) FROM reference_document_versions v2
                  WHERE v2.document_id = ${documentBundleMembers.documentId}
                )`
              )
            )
            .where(
              and(
                eq(documentBundleMembers.bundleId, bundle.id),
                isNull(documentBundleMembers.deletedAt)
              )
            );

          estimatedPrefixTokens = liveMembers.reduce((sum, m) => {
            const counts = m.tokenCounts as Record<string, number> | null;
            return sum + (counts?.[policy.modelFamily] ?? 0);
          }, 0);
        }

        const utilizationRatio = policy.maxInputTokens > 0
          ? estimatedPrefixTokens / policy.maxInputTokens
          : 0;

        utilizationByModelFamily[policy.modelFamily] = {
          utilizationRatio,
          estimatedPrefixTokens,
          computedAt: new Date().toISOString(),
        };
      }

      // 3. Write to the bundle row. The whole utilizationByModelFamily blob
      // is replaced (not merged) — replay-safe because the same inputs
      // produce the same blob.
      await adminDb
        .update(documentBundles)
        .set({
          utilizationByModelFamily: utilizationByModelFamily as any,
          updatedAt: new Date(),
        })
        .where(eq(documentBundles.id, bundle.id));

      bundlesProcessed += 1;
    }

    return { status: 'ok', jobName: JOB_NAME, bundlesProcessed };
  });
}
