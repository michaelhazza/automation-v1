import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import {
  documentBundleAttachments,
  documentBundles,
  documentBundleMembers,
  referenceDocuments,
  referenceDocumentVersions,
  bundleResolutionSnapshots,
} from '../db/schema/index.js';
import { eq, and, isNull } from 'drizzle-orm';
import type { BundleResolutionSnapshot } from '../db/schema/bundleResolutionSnapshots.js';
import type { AttachmentSubjectType } from '../db/schema/documentBundleAttachments.js';
import { orderDocumentsDeterministically, buildSnapshotRow } from './bundleResolutionServicePure.js';
import { ASSEMBLY_VERSION } from './contextAssemblyEnginePure.js';

// ---------------------------------------------------------------------------
// bundleResolutionService — stateful run-start snapshotting (§6.3)
//
// Called exactly once per cached-context run, at the top of the orchestrator.
// Reads live bundle + member + version state and produces immutable snapshot rows.
// ---------------------------------------------------------------------------

export const CACHED_CONTEXT_NO_BUNDLES_ATTACHED      = 'CACHED_CONTEXT_NO_BUNDLES_ATTACHED';
export const CACHED_CONTEXT_DOC_TOKEN_COUNT_MISSING  = 'CACHED_CONTEXT_DOC_TOKEN_COUNT_MISSING';
export const CACHED_CONTEXT_SNAPSHOT_CONCURRENCY_LOST = 'CACHED_CONTEXT_SNAPSHOT_CONCURRENCY_LOST';

/**
 * Resolves every bundle attached to the given subject into persisted snapshot rows.
 * Deduplicates per (bundle_id, prefix_hash). Returns all snapshots + total estimated tokens.
 *
 * Transaction isolation: reads bundle.currentVersion, then reads members for that bundle.
 * If another transaction bumps currentVersion between our two reads, the version-lock
 * re-select loop (option c in §6.3) detects the divergence and retries.
 */
export async function resolveAtRunStart(input: {
  organisationId: string;
  subaccountId: string | null;
  subjectType: AttachmentSubjectType;
  subjectId: string;
  modelFamily: string;
}): Promise<{
  snapshots: BundleResolutionSnapshot[];
  totalEstimatedPrefixTokens: number;
}> {
  const db = getOrgScopedDb('bundleResolutionService.resolveAtRunStart');

  // 1. Load all live bundle attachments for this subject (scoped to the caller's org).
  const attachments = await db
    .select({ bundleId: documentBundleAttachments.bundleId })
    .from(documentBundleAttachments)
    .innerJoin(documentBundles, eq(documentBundleAttachments.bundleId, documentBundles.id))
    .where(
      and(
        eq(documentBundleAttachments.organisationId, input.organisationId),
        eq(documentBundles.organisationId, input.organisationId),
        eq(documentBundleAttachments.subjectType, input.subjectType),
        eq(documentBundleAttachments.subjectId, input.subjectId),
        isNull(documentBundleAttachments.deletedAt),
        isNull(documentBundles.deletedAt)
      )
    );

  if (attachments.length === 0) {
    throw { statusCode: 409, code: CACHED_CONTEXT_NO_BUNDLES_ATTACHED, message: 'No bundles attached to this subject' };
  }

  const resultSnapshots: BundleResolutionSnapshot[] = [];

  for (const { bundleId } of attachments) {
    const snapshot = await resolveOneBundle({
      organisationId: input.organisationId,
      subaccountId: input.subaccountId,
      bundleId,
      modelFamily: input.modelFamily,
    });
    resultSnapshots.push(snapshot);
  }

  const totalEstimatedPrefixTokens = resultSnapshots.reduce(
    (sum, s) => sum + s.estimatedPrefixTokens,
    0
  );

  return { snapshots: resultSnapshots, totalEstimatedPrefixTokens };
}

export async function getSnapshot(snapshotId: string, organisationId: string): Promise<BundleResolutionSnapshot | null> {
  const db = getOrgScopedDb('bundleResolutionService.getSnapshot');
  const [row] = await db
    .select()
    .from(bundleResolutionSnapshots)
    .where(and(
      eq(bundleResolutionSnapshots.id, snapshotId),
      eq(bundleResolutionSnapshots.organisationId, organisationId),
    ))
    .limit(1);
  return row ?? null;
}

// ---------------------------------------------------------------------------
// Internal: resolve one bundle with version-lock retry (§6.3 option c)
// ---------------------------------------------------------------------------
async function resolveOneBundle(input: {
  organisationId: string;
  subaccountId: string | null;
  bundleId: string;
  modelFamily: string;
}): Promise<BundleResolutionSnapshot> {
  const MAX_VERSION_RETRIES = 3;
  const db = getOrgScopedDb('bundleResolutionService.resolveOneBundle');

  for (let attempt = 0; attempt <= MAX_VERSION_RETRIES; attempt++) {
    // Read bundle + currentVersion (scoped to the caller's org).
    const [bundle] = await db
      .select({
        id: documentBundles.id,
        organisationId: documentBundles.organisationId,
        subaccountId: documentBundles.subaccountId,
        currentVersion: documentBundles.currentVersion,
      })
      .from(documentBundles)
      .where(and(
        eq(documentBundles.id, input.bundleId),
        eq(documentBundles.organisationId, input.organisationId),
      ))
      .limit(1);

    if (!bundle) {
      throw { statusCode: 404, code: 'CACHED_CONTEXT_BUNDLE_NOT_FOUND', message: 'Bundle not found during resolution' };
    }

    const capturedVersion = bundle.currentVersion;

    // Read live members + their current version rows
    const membersWithVersions = await db
      .select({
        documentId: documentBundleMembers.documentId,
        memberDeletedAt: documentBundleMembers.deletedAt,
        docPausedAt: referenceDocuments.pausedAt,
        docDeprecatedAt: referenceDocuments.deprecatedAt,
        docDeletedAt: referenceDocuments.deletedAt,
        versionNum: referenceDocumentVersions.version,
        serializedBytesHash: referenceDocumentVersions.serializedBytesHash,
        tokenCounts: referenceDocumentVersions.tokenCounts,
      })
      .from(documentBundleMembers)
      .innerJoin(referenceDocuments, eq(documentBundleMembers.documentId, referenceDocuments.id))
      .innerJoin(
        referenceDocumentVersions,
        and(
          eq(referenceDocumentVersions.documentId, referenceDocuments.id),
          eq(referenceDocumentVersions.version, referenceDocuments.currentVersion)
        )
      )
      .where(
        and(
          eq(documentBundleMembers.bundleId, input.bundleId),
          isNull(documentBundleMembers.deletedAt)
        )
      );

    // Version-lock check (option c): re-read currentVersion and compare
    const [bundleRecheck] = await db
      .select({ currentVersion: documentBundles.currentVersion })
      .from(documentBundles)
      .where(and(
        eq(documentBundles.id, input.bundleId),
        eq(documentBundles.organisationId, input.organisationId),
      ))
      .limit(1);

    if (bundleRecheck?.currentVersion !== capturedVersion) {
      // Bundle was edited between our two reads — retry
      if (attempt < MAX_VERSION_RETRIES) continue;
      throw { statusCode: 500, code: 'CACHED_CONTEXT_SNAPSHOT_CONCURRENCY_LOST', message: 'Bundle version changed during resolution; could not capture consistent snapshot after retries' };
    }

    // 4. Token-count presence check
    for (const m of membersWithVersions) {
      if (m.memberDeletedAt || m.docDeletedAt) continue;
      const counts = m.tokenCounts as Record<string, number> | null;
      if (!counts || counts[input.modelFamily] === undefined) {
        throw { statusCode: 500, code: CACHED_CONTEXT_DOC_TOKEN_COUNT_MISSING, message: `Document ${m.documentId} missing tokenCounts for model family ${input.modelFamily}` };
      }
    }

    // 5. Order deterministically (excludes paused/deprecated/deleted)
    const ordered = orderDocumentsDeterministically(
      membersWithVersions
        .filter((m) => !m.memberDeletedAt)
        .map((m) => {
          const counts = m.tokenCounts as Record<string, number>;
          return {
            documentId: m.documentId,
            documentVersion: m.versionNum,
            serializedBytesHash: m.serializedBytesHash,
            tokenCount: counts[input.modelFamily] ?? 0,
            pausedAt: m.docPausedAt,
            deprecatedAt: m.docDeprecatedAt,
            deletedAt: m.docDeletedAt,
          };
        })
    );

    // 6+7. Build snapshot row and insert with ON CONFLICT DO NOTHING
    const candidate = buildSnapshotRow({
      organisationId: input.organisationId,
      subaccountId: input.subaccountId,
      bundleId: input.bundleId,
      bundleVersion: capturedVersion,
      modelFamily: input.modelFamily,
      assemblyVersion: ASSEMBLY_VERSION,
      orderedDocumentVersions: ordered,
    });

    const MAX_INSERT_RETRIES = 3;
    for (let insertAttempt = 0; insertAttempt < MAX_INSERT_RETRIES; insertAttempt++) {
      const [inserted] = await db
        .insert(bundleResolutionSnapshots)
        .values({
          organisationId: candidate.organisationId,
          subaccountId: candidate.subaccountId,
          bundleId: candidate.bundleId,
          bundleVersion: candidate.bundleVersion,
          modelFamily: candidate.modelFamily,
          assemblyVersion: candidate.assemblyVersion,
          orderedDocumentVersions: candidate.orderedDocumentVersions as any,
          prefixHash: candidate.prefixHash,
          prefixHashComponents: candidate.prefixHashComponents as any,
          estimatedPrefixTokens: candidate.estimatedPrefixTokens,
        })
        .onConflictDoNothing()
        .returning();

      if (inserted) return inserted;

      // Conflict fired — re-select the winning row (scoped to org).
      const [winner] = await db
        .select()
        .from(bundleResolutionSnapshots)
        .where(
          and(
            eq(bundleResolutionSnapshots.organisationId, input.organisationId),
            eq(bundleResolutionSnapshots.bundleId, candidate.bundleId),
            eq(bundleResolutionSnapshots.prefixHash, candidate.prefixHash)
          )
        )
        .limit(1);

      if (winner) return winner;
      // Winner not visible yet (snapshot isolation edge case) — retry insert
    }

    throw { statusCode: 500, code: CACHED_CONTEXT_SNAPSHOT_CONCURRENCY_LOST, message: `INSERT ON CONFLICT retries exhausted for bundle ${input.bundleId}` };
  }

  // Should never reach here
  throw { statusCode: 500, code: CACHED_CONTEXT_SNAPSHOT_CONCURRENCY_LOST, message: 'Exhausted all resolution retries' };
}
