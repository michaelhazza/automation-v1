/**
 * maintenance:bundle-utilization — hourly bundle utilization metric computation.
 *
 * For every live named bundle × every model family in model_tier_budget_policies:
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

export async function runBundleUtilization(): Promise<void> {
  await withAdminConnection({ source: 'bundle_utilization_job' }, async (adminDb) => {
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

    if (allBundles.length === 0 || allPolicies.length === 0) return;

    for (const bundle of allBundles) {
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

      // 3. Write to the bundle row
      await adminDb
        .update(documentBundles)
        .set({
          utilizationByModelFamily: utilizationByModelFamily as any,
          updatedAt: new Date(),
        })
        .where(eq(documentBundles.id, bundle.id));
    }
  });
}
