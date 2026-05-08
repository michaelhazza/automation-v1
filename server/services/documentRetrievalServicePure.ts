// Pure document-chunk filtering and grouping — no DB, no I/O.
// Spec: tasks/builds/auto-knowledge-retrieval/spec.md §2C, §13.1, §1.5 #2

import type { RetrievalCandidate } from '../../shared/types/retrieval.js';
import type { ReferenceDocumentChunk } from '../db/schema/referenceDocumentChunks.js';
import type { ReferenceDocument, ReferenceDocumentMode } from '../db/schema/referenceDocuments.js';

export interface FilterDocumentChunksInput {
  chunks: ReferenceDocumentChunk[];
  documents: ReferenceDocument[];
  activeEmbeddingModelByDocId: Map<string, string>;
  retrievalVersionByDocId: Map<string, string>;
  expectedChunkCountByVersionId: Map<string, number>;
}

/**
 * Returns chunks eligible for retrieval:
 * - chunk's versionId === retrievalVersionByDocId for its document
 * - chunk's embeddingModel === activeEmbeddingModelByDocId for its document
 * - document mode is NOT 'reference_only'
 * - retrieval-version completeness: chunk count for (documentId, versionId, embeddingModel)
 *   meets the expectedChunkCountByVersionId total (spec §13.1 invariant, §1.5 #2)
 *
 * Programmer-error inputs (missing pointer mappings) cause the document to be filtered
 * out defensively — never throws.
 */
export function filterDocumentChunks(input: FilterDocumentChunksInput): ReferenceDocumentChunk[] {
  const { chunks, documents, activeEmbeddingModelByDocId, retrievalVersionByDocId, expectedChunkCountByVersionId } = input;

  // Build doc map for mode lookup
  const docById = new Map<string, ReferenceDocument>(documents.map(d => [d.id, d]));

  // Group chunks by (documentId, versionId, embeddingModel) for count verification
  const chunkCounts = new Map<string, number>();
  for (const chunk of chunks) {
    const key = `${chunk.documentId}:${chunk.versionId}:${chunk.embeddingModel}`;
    chunkCounts.set(key, (chunkCounts.get(key) ?? 0) + 1);
  }

  return chunks.filter(chunk => {
    const doc = docById.get(chunk.documentId);
    if (!doc) return false; // defensive — doc not in provided list

    // Mode exclusion
    if (doc.mode === 'reference_only') return false;

    // Version pinning
    const expectedVersionId = retrievalVersionByDocId.get(chunk.documentId);
    if (!expectedVersionId) return false; // no retrieval version set — not yet chunked
    if (chunk.versionId !== expectedVersionId) return false;

    // Active-model pinning
    const expectedModel = activeEmbeddingModelByDocId.get(chunk.documentId);
    if (!expectedModel) return false;
    if (chunk.embeddingModel !== expectedModel) return false;

    // Retrieval-version completeness check (spec §13.1, §1.5 #2)
    const expectedCount = expectedChunkCountByVersionId.get(chunk.versionId);
    if (expectedCount !== undefined) {
      const key = `${chunk.documentId}:${chunk.versionId}:${chunk.embeddingModel}`;
      const actualCount = chunkCounts.get(key) ?? 0;
      if (actualCount < expectedCount) return false; // incomplete generation — reject all chunks for this doc
    }

    return true;
  });
}

export interface GroupCandidatesInput {
  rankedCandidates: RetrievalCandidate[];
  allChunksByDocumentId: Map<string, ReferenceDocumentChunk[]>;
}

export interface DocumentLevelResult {
  documentId: string;
  bestChunkId: string;
  bestFinalScore: number;
  allChunkIds: string[];
  tokenCount: number;
  mode: ReferenceDocumentMode;
  scopeTier: number;
  content: string; // content of the best chunk
}

/**
 * Collapses chunk-level ranked candidates into document-level results.
 * Best-of-chunk: document.finalScore = MAX(chunk.finalScore for chunks of that doc).
 * All chunks of the document are listed in allChunkIds regardless of their individual scores.
 */
export function groupCandidatesByDocument(input: GroupCandidatesInput): DocumentLevelResult[] {
  const { rankedCandidates, allChunksByDocumentId } = input;

  // Only document_chunk candidates are grouped; memory_block candidates are passed through unchanged
  const seenDocIds = new Set<string>();
  const results: DocumentLevelResult[] = [];

  for (const candidate of rankedCandidates) {
    if (candidate.kind !== 'document_chunk' || !candidate.documentId) continue;
    if (seenDocIds.has(candidate.documentId)) continue;
    seenDocIds.add(candidate.documentId);

    const allChunks = allChunksByDocumentId.get(candidate.documentId) ?? [];

    results.push({
      documentId: candidate.documentId,
      bestChunkId: candidate.id,
      bestFinalScore: candidate.finalScore,
      allChunkIds: allChunks.map(c => c.id),
      tokenCount: allChunks.reduce((sum, c) => sum + c.tokenCount, 0),
      mode: candidate.mode,
      scopeTier: candidate.scopeTier,
      content: candidate.content,
    });
  }

  return results;
}
