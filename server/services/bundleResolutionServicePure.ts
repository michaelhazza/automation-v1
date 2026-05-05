import type { PrefixHashComponents } from '../../shared/types/cachedContext.js';
import { computePrefixHash } from './contextAssemblyEnginePure.js';

// ---------------------------------------------------------------------------
// bundleResolutionServicePure — pure helpers for bundleResolutionService (§6.3)
// ---------------------------------------------------------------------------

export interface OrderedDocumentVersionEntry {
  documentId: string;
  documentVersion: number;
  serializedBytesHash: string;
  tokenCount: number;
}

export interface MemberRow {
  documentId: string;
  documentVersion: number;
  serializedBytesHash: string;
  tokenCount: number;
  pausedAt: Date | null;
  deprecatedAt: Date | null;
  deletedAt: Date | null;
}

/**
 * Filters out paused, deprecated, or deleted documents then sorts the
 * remaining set by documentId ascending — the deterministic ordering
 * used across all resolution paths.
 */
export function orderDocumentsDeterministically(members: MemberRow[]): OrderedDocumentVersionEntry[] {
  return members
    .filter((m) => !m.pausedAt && !m.deprecatedAt && !m.deletedAt)
    .sort((a, b) => a.documentId.localeCompare(b.documentId))
    .map(({ documentId, documentVersion, serializedBytesHash, tokenCount }) => ({
      documentId,
      documentVersion,
      serializedBytesHash,
      tokenCount,
    }));
}

/**
 * Builds the snapshot candidate row (all fields except DB-generated id + createdAt).
 * Delegates hash computation to contextAssemblyEnginePure.computePrefixHash.
 */
export function buildSnapshotRow(input: {
  organisationId: string;
  subaccountId: string | null;
  bundleId: string;
  bundleVersion: number;
  modelFamily: string;
  assemblyVersion: number;
  orderedDocumentVersions: OrderedDocumentVersionEntry[];
}): {
  organisationId: string;
  subaccountId: string | null;
  bundleId: string;
  bundleVersion: number;
  modelFamily: string;
  assemblyVersion: number;
  orderedDocumentVersions: OrderedDocumentVersionEntry[];
  prefixHash: string;
  prefixHashComponents: PrefixHashComponents;
  estimatedPrefixTokens: number;
} {
  const components: PrefixHashComponents = {
    orderedDocumentIds: input.orderedDocumentVersions.map((d) => d.documentId),
    documentSerializedBytesHashes: input.orderedDocumentVersions.map((d) => d.serializedBytesHash),
    includedFlags: input.orderedDocumentVersions.map((d) => ({
      documentId: d.documentId,
      included: true as const,
      reason: 'attached_and_active' as const,
    })),
    modelFamily: input.modelFamily,
    assemblyVersion: input.assemblyVersion,
  };

  const prefixHash = computePrefixHash(components);
  const estimatedPrefixTokens = input.orderedDocumentVersions.reduce((sum, d) => sum + d.tokenCount, 0);

  return {
    ...input,
    prefixHash,
    prefixHashComponents: components,
    estimatedPrefixTokens,
  };
}
