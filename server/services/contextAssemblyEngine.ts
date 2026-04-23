import { createHash } from 'node:crypto';
import { db } from '../db/index.js';
import { referenceDocumentVersions } from '../db/schema/index.js';
import { eq, and } from 'drizzle-orm';
import type { ContextAssemblyResult, ResolvedExecutionBudget } from '../../shared/types/cachedContext.js';
import type { BundleResolutionSnapshot } from '../db/schema/bundleResolutionSnapshots.js';
import {
  ASSEMBLY_VERSION,
  assemblePrefix,
  computeAssembledPrefixHash,
  estimateTokenCount,
  validateAssembly,
  serializeDocument,
} from './contextAssemblyEnginePure.js';

// ---------------------------------------------------------------------------
// contextAssemblyEngine — stateful wrapper (§6.4)
//
// Flow: load pinned version rows → integrity check → assemblePrefix →
//       validate → return ContextAssemblyResult
// ---------------------------------------------------------------------------

export const CACHED_CONTEXT_SNAPSHOT_INTEGRITY_VIOLATION = 'CACHED_CONTEXT_SNAPSHOT_INTEGRITY_VIOLATION';

export async function assembleAndValidate(input: {
  snapshots: BundleResolutionSnapshot[];
  variableInput: string;
  instructions: string;
  resolvedBudget: ResolvedExecutionBudget;
}): Promise<ContextAssemblyResult> {
  const { snapshots, variableInput, instructions, resolvedBudget } = input;

  // 1. Load all pinned reference_document_versions rows
  const dvKeys: Array<{ documentId: string; documentVersion: number; snapshotSerializedBytesHash: string }> = [];
  for (const snap of snapshots) {
    for (const dv of snap.orderedDocumentVersions) {
      dvKeys.push({
        documentId: dv.documentId,
        documentVersion: dv.documentVersion,
        snapshotSerializedBytesHash: dv.serializedBytesHash,
      });
    }
  }

  // Bulk-fetch all needed version rows
  const versionMap = new Map<string, { content: string; serializedBytesHash: string }>();
  for (const dvKey of dvKeys) {
    const [row] = await db
      .select({
        content: referenceDocumentVersions.content,
        serializedBytesHash: referenceDocumentVersions.serializedBytesHash,
        documentId: referenceDocumentVersions.documentId,
        version: referenceDocumentVersions.version,
      })
      .from(referenceDocumentVersions)
      .where(
        and(
          eq(referenceDocumentVersions.documentId, dvKey.documentId),
          eq(referenceDocumentVersions.version, dvKey.documentVersion)
        )
      )
      .limit(1);

    if (!row) {
      throw { statusCode: 500, code: CACHED_CONTEXT_SNAPSHOT_INTEGRITY_VIOLATION, message: `Missing version row for documentId=${dvKey.documentId} version=${dvKey.documentVersion}` };
    }

    // Integrity check: re-hash the serialized form and compare to snapshot
    const reserialized = serializeDocument({ documentId: row.documentId, version: row.version, content: row.content });
    const freshHash = createHash('sha256').update(reserialized, 'utf8').digest('hex');
    if (freshHash !== dvKey.snapshotSerializedBytesHash) {
      throw { statusCode: 500, code: CACHED_CONTEXT_SNAPSHOT_INTEGRITY_VIOLATION, message: `Integrity violation: documentId=${row.documentId} version=${row.version} hash mismatch` };
    }

    versionMap.set(`${dvKey.documentId}:${dvKey.documentVersion}`, { content: row.content, serializedBytesHash: row.serializedBytesHash });
  }

  // 2. Assemble the prefix
  const assembledPrefix = assemblePrefix({
    snapshots: snapshots.map((s) => ({
      bundleId: s.bundleId,
      orderedDocumentVersions: s.orderedDocumentVersions,
    })),
    versionsByDocumentVersionKey: versionMap,
  });

  // 3. Estimate variable-input tokens
  const variableInputTokens = estimateTokenCount(variableInput);

  // 4. Build per-document token list for validation (using snapshot token counts)
  const perDocumentTopTokens: Array<{ documentId: string; documentName: string; tokens: number }> = [];
  for (const snap of snapshots) {
    for (const dv of snap.orderedDocumentVersions) {
      perDocumentTopTokens.push({
        documentId: dv.documentId,
        documentName: dv.documentId, // name not in snapshot; documentId is sufficient for block payload
        tokens: dv.tokenCount,
      });
    }
  }

  // 5. Compute call-level assembled prefix hash
  const sortedByBundleId = [...snapshots].sort((a, b) => a.bundleId.localeCompare(b.bundleId));
  const snapshotPrefixHashesByBundleIdAsc = sortedByBundleId.map((s) => s.prefixHash);
  const assembledPrefixHash = computeAssembledPrefixHash({
    snapshotPrefixHashesByBundleIdAsc,
    modelFamily: resolvedBudget.modelFamily,
    assemblyVersion: ASSEMBLY_VERSION,
  });

  // 6. Total estimated prefix tokens (sum of all snapshot estimatedPrefixTokens)
  const assembledPrefixTokens = snapshots.reduce((sum, s) => sum + s.estimatedPrefixTokens, 0);

  // 7. Validate
  const validationResult = validateAssembly({
    assembledPrefixTokens,
    variableInputTokens,
    perDocumentTopTokens,
    resolvedBudget,
  });

  if (validationResult.kind === 'breach') {
    return { kind: 'budget_breach', blockPayload: validationResult.payload };
  }

  // 8. Hash variable input
  const variableInputHash = createHash('sha256').update(variableInput, 'utf8').digest('hex');

  const estimatedContextTokens = assembledPrefixTokens + variableInputTokens
    + resolvedBudget.reserveOutputTokens + 100; // fixed overhead

  return {
    kind: 'ok',
    routerPayload: {
      system: {
        stablePrefix: assembledPrefix,
        dynamicSuffix: `${instructions}\n\n${variableInput}`,
      },
      messages: [],
      estimatedContextTokens,
    },
    prefixHash: assembledPrefixHash,
    variableInputHash,
    bundleSnapshotIds: snapshots.map((s) => s.id),
    softWarnTripped: validationResult.softWarnTripped,
    assemblyVersion: ASSEMBLY_VERSION,
  };
}
