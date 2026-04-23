import { createHash } from 'node:crypto';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { referenceDocumentVersions, referenceDocuments } from '../db/schema/index.js';
import { eq, and, inArray } from 'drizzle-orm';
import type { ContextAssemblyResult, ResolvedExecutionBudget, PrefixHashComponents } from '../../shared/types/cachedContext.js';
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
//
// Scope: all DB reads go through getOrgScopedDb (Layer 1B) AND filter on
// organisationId (Layer 2). Callers must pass organisationId.
// ---------------------------------------------------------------------------

export const CACHED_CONTEXT_SNAPSHOT_INTEGRITY_VIOLATION = 'CACHED_CONTEXT_SNAPSHOT_INTEGRITY_VIOLATION';

export async function assembleAndValidate(input: {
  organisationId: string;
  snapshots: BundleResolutionSnapshot[];
  variableInput: string;
  instructions: string;
  resolvedBudget: ResolvedExecutionBudget;
}): Promise<ContextAssemblyResult> {
  const { organisationId, snapshots, variableInput, instructions, resolvedBudget } = input;
  const db = getOrgScopedDb('contextAssemblyEngine.assembleAndValidate');

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

  // Bulk-fetch all needed version rows (scoped to caller's org via the parent doc).
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
      .innerJoin(referenceDocuments, eq(referenceDocumentVersions.documentId, referenceDocuments.id))
      .where(
        and(
          eq(referenceDocumentVersions.documentId, dvKey.documentId),
          eq(referenceDocumentVersions.version, dvKey.documentVersion),
          eq(referenceDocuments.organisationId, organisationId),
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

  // Lookup document names for the HITL block payload (S6: render names, not UUIDs).
  const uniqueDocIds = Array.from(new Set(dvKeys.map((k) => k.documentId)));
  const nameRows = uniqueDocIds.length > 0
    ? await db
        .select({ id: referenceDocuments.id, name: referenceDocuments.name })
        .from(referenceDocuments)
        .where(and(
          inArray(referenceDocuments.id, uniqueDocIds),
          eq(referenceDocuments.organisationId, organisationId),
        ))
    : [];
  const nameByDocumentId = new Map<string, string>();
  for (const r of nameRows) nameByDocumentId.set(r.id, r.name);

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

  // 4. Build per-document token list for validation (using snapshot token counts).
  const perDocumentTopTokens: Array<{ documentId: string; documentName: string; tokens: number }> = [];
  for (const snap of snapshots) {
    for (const dv of snap.orderedDocumentVersions) {
      perDocumentTopTokens.push({
        documentId: dv.documentId,
        documentName: nameByDocumentId.get(dv.documentId) ?? dv.documentId,
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
    // B4: populate intendedPrefixHashComponents per spec §4.5 (the pure
    // validator leaves it null because it has no access to per-document
    // serializedBytesHashes — the stateful wrapper composes them from the
    // resolved snapshot rows).
    //
    // Per spec §4.4 the arrays are `document_id ascending` with
    // `documentSerializedBytesHashes` parallel to `orderedDocumentIds`, and
    // `includedFlags` has one entry per documentId (see example at §4.4
    // lines 582-590). When the same document is attached through multiple
    // bundles on one run, we collapse to a single entry per documentId —
    // matching the single-bundle PrefixHashComponents shape — and sort the
    // final list ascending by documentId so the diagnostic record round-
    // trips to the per-bundle hash shape.
    const byDocId = new Map<string, string>();
    for (const snap of sortedByBundleId) {
      for (const dv of snap.orderedDocumentVersions) {
        if (!byDocId.has(dv.documentId)) {
          byDocId.set(dv.documentId, dv.serializedBytesHash);
        }
      }
    }
    const orderedDocumentIds = Array.from(byDocId.keys()).sort((a, b) => a.localeCompare(b));
    const documentSerializedBytesHashes = orderedDocumentIds.map((id) => byDocId.get(id)!);
    const intendedPrefixHashComponents: PrefixHashComponents = {
      orderedDocumentIds,
      documentSerializedBytesHashes,
      includedFlags: orderedDocumentIds.map((documentId) => ({
        documentId,
        included: true as const,
        reason: 'attached_and_active' as const,
      })),
      modelFamily: resolvedBudget.modelFamily,
      assemblyVersion: ASSEMBLY_VERSION,
    };
    return {
      kind: 'budget_breach',
      blockPayload: { ...validationResult.payload, intendedPrefixHashComponents },
    };
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
