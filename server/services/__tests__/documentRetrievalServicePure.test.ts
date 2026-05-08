// documentRetrievalServicePure.test.ts — Pure filtering and grouping tests for Chunk 2C.
// Spec: tasks/builds/auto-knowledge-retrieval/spec.md §2C contracts

import { describe, it, expect } from 'vitest';
import {
  filterDocumentChunks,
  groupCandidatesByDocument,
  type FilterDocumentChunksInput,
  type GroupCandidatesInput,
} from '../documentRetrievalServicePure.js';
import type { ReferenceDocumentChunk } from '../../db/schema/referenceDocumentChunks.js';
import type { ReferenceDocument } from '../../db/schema/referenceDocuments.js';
import type { RetrievalCandidate } from '../../../shared/types/retrieval.js';

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

const NOW = new Date('2026-01-01T00:00:00Z');

function makeChunk(overrides: Partial<ReferenceDocumentChunk> & { id: string; documentId: string; versionId: string }): ReferenceDocumentChunk {
  return {
    organisationId: 'org-1',
    chunkIndex: 0,
    embeddingModel: 'text-embedding-3-small',
    embedding: null,
    content: 'chunk content',
    tokenCount: 100,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    ...overrides,
  };
}

function makeDoc(overrides: Partial<ReferenceDocument> & { id: string }): ReferenceDocument {
  return {
    organisationId: 'org-1',
    subaccountId: null,
    name: 'Test Document',
    description: null,
    currentVersionId: null,
    currentVersion: 1,
    sourceType: 'manual',
    sourceRef: null,
    lastSyncedAt: null,
    pausedAt: null,
    deprecatedAt: null,
    deprecationReason: null,
    externalProvider: null,
    externalConnectionId: null,
    externalFileId: null,
    externalFileName: null,
    externalFileMimeType: null,
    attachedByUserId: null,
    attachmentOrder: 0,
    attachmentState: null,
    mode: 'auto',
    summary: null,
    summaryStale: false,
    summaryGeneratedAt: null,
    lastChunkedAt: null,
    activeEmbeddingModel: null,
    retrievalVersionId: null,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    ...overrides,
  };
}

function makeCandidate(overrides: Partial<RetrievalCandidate> & { id: string; documentId: string }): RetrievalCandidate {
  return {
    organisationId: 'org-1',
    kind: 'document_chunk',
    mode: 'auto',
    scopeTier: 1,
    finalScore: 0.8,
    updatedAt: NOW,
    tokenCount: 100,
    content: 'chunk content',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// filterDocumentChunks
// ---------------------------------------------------------------------------

describe('filterDocumentChunks', () => {
  it('includes chunks for auto and always_available documents, excludes reference_only', () => {
    const autoDoc = makeDoc({ id: 'doc-auto', mode: 'auto' });
    const alwaysDoc = makeDoc({ id: 'doc-always', mode: 'always_available' });
    const refOnlyDoc = makeDoc({ id: 'doc-ref', mode: 'reference_only' });

    const autoChunk = makeChunk({ id: 'c-auto', documentId: 'doc-auto', versionId: 'v-auto' });
    const alwaysChunk = makeChunk({ id: 'c-always', documentId: 'doc-always', versionId: 'v-always' });
    const refChunk = makeChunk({ id: 'c-ref', documentId: 'doc-ref', versionId: 'v-ref' });

    const input: FilterDocumentChunksInput = {
      chunks: [autoChunk, alwaysChunk, refChunk],
      documents: [autoDoc, alwaysDoc, refOnlyDoc],
      activeEmbeddingModelByDocId: new Map([
        ['doc-auto', 'text-embedding-3-small'],
        ['doc-always', 'text-embedding-3-small'],
        ['doc-ref', 'text-embedding-3-small'],
      ]),
      retrievalVersionByDocId: new Map([
        ['doc-auto', 'v-auto'],
        ['doc-always', 'v-always'],
        ['doc-ref', 'v-ref'],
      ]),
      expectedChunkCountByVersionId: new Map(),
    };

    const result = filterDocumentChunks(input);
    const ids = result.map(c => c.id);
    expect(ids).toContain('c-auto');
    expect(ids).toContain('c-always');
    expect(ids).not.toContain('c-ref');
  });

  it('drops chunk whose versionId does not match retrievalVersionByDocId', () => {
    const doc = makeDoc({ id: 'doc-1', mode: 'auto' });
    const staleChunk = makeChunk({ id: 'c-stale', documentId: 'doc-1', versionId: 'v-old' });
    const currentChunk = makeChunk({ id: 'c-current', documentId: 'doc-1', versionId: 'v-new' });

    const input: FilterDocumentChunksInput = {
      chunks: [staleChunk, currentChunk],
      documents: [doc],
      activeEmbeddingModelByDocId: new Map([['doc-1', 'text-embedding-3-small']]),
      retrievalVersionByDocId: new Map([['doc-1', 'v-new']]),
      expectedChunkCountByVersionId: new Map(),
    };

    const result = filterDocumentChunks(input);
    const ids = result.map(c => c.id);
    expect(ids).not.toContain('c-stale');
    expect(ids).toContain('c-current');
  });

  it('drops chunk whose embeddingModel does not match activeEmbeddingModelByDocId', () => {
    const doc = makeDoc({ id: 'doc-1', mode: 'auto' });
    const wrongModelChunk = makeChunk({ id: 'c-wrong', documentId: 'doc-1', versionId: 'v-1', embeddingModel: 'old-model' });
    const correctModelChunk = makeChunk({ id: 'c-correct', documentId: 'doc-1', versionId: 'v-1', embeddingModel: 'text-embedding-3-small', chunkIndex: 1 });

    const input: FilterDocumentChunksInput = {
      chunks: [wrongModelChunk, correctModelChunk],
      documents: [doc],
      activeEmbeddingModelByDocId: new Map([['doc-1', 'text-embedding-3-small']]),
      retrievalVersionByDocId: new Map([['doc-1', 'v-1']]),
      expectedChunkCountByVersionId: new Map(),
    };

    const result = filterDocumentChunks(input);
    const ids = result.map(c => c.id);
    expect(ids).not.toContain('c-wrong');
    expect(ids).toContain('c-correct');
  });

  it('spec §13.1 completeness invariant: drops all chunks when actualCount < expectedCount', () => {
    // Expected 3 chunks but only 2 provided — entire document is rejected
    const doc = makeDoc({ id: 'doc-1', mode: 'auto' });
    const chunk1 = makeChunk({ id: 'c-1', documentId: 'doc-1', versionId: 'v-1', chunkIndex: 0 });
    const chunk2 = makeChunk({ id: 'c-2', documentId: 'doc-1', versionId: 'v-1', chunkIndex: 1 });

    const input: FilterDocumentChunksInput = {
      chunks: [chunk1, chunk2],
      documents: [doc],
      activeEmbeddingModelByDocId: new Map([['doc-1', 'text-embedding-3-small']]),
      retrievalVersionByDocId: new Map([['doc-1', 'v-1']]),
      expectedChunkCountByVersionId: new Map([['v-1', 3]]), // expects 3, only 2 present
    };

    const result = filterDocumentChunks(input);
    expect(result).toHaveLength(0);
  });

  it('spec §13.1 completeness invariant: includes all chunks when actualCount meets expectedCount', () => {
    const doc = makeDoc({ id: 'doc-1', mode: 'auto' });
    const chunk1 = makeChunk({ id: 'c-1', documentId: 'doc-1', versionId: 'v-1', chunkIndex: 0 });
    const chunk2 = makeChunk({ id: 'c-2', documentId: 'doc-1', versionId: 'v-1', chunkIndex: 1 });
    const chunk3 = makeChunk({ id: 'c-3', documentId: 'doc-1', versionId: 'v-1', chunkIndex: 2 });

    const input: FilterDocumentChunksInput = {
      chunks: [chunk1, chunk2, chunk3],
      documents: [doc],
      activeEmbeddingModelByDocId: new Map([['doc-1', 'text-embedding-3-small']]),
      retrievalVersionByDocId: new Map([['doc-1', 'v-1']]),
      expectedChunkCountByVersionId: new Map([['v-1', 3]]),
    };

    const result = filterDocumentChunks(input);
    expect(result).toHaveLength(3);
  });

  it('drops document defensively when it has no entry in retrievalVersionByDocId', () => {
    const doc = makeDoc({ id: 'doc-1', mode: 'auto' });
    const chunk = makeChunk({ id: 'c-1', documentId: 'doc-1', versionId: 'v-1' });

    const input: FilterDocumentChunksInput = {
      chunks: [chunk],
      documents: [doc],
      activeEmbeddingModelByDocId: new Map([['doc-1', 'text-embedding-3-small']]),
      retrievalVersionByDocId: new Map(), // no entry for doc-1
      expectedChunkCountByVersionId: new Map(),
    };

    const result = filterDocumentChunks(input);
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// groupCandidatesByDocument
// ---------------------------------------------------------------------------

describe('groupCandidatesByDocument', () => {
  it('best-of-chunk: document with three candidates scores MAX and includes all chunk ids', () => {
    const docId = 'doc-1';
    const candidate1 = makeCandidate({ id: 'chunk-a', documentId: docId, finalScore: 0.8 });
    const candidate2 = makeCandidate({ id: 'chunk-b', documentId: docId, finalScore: 0.7 });
    const candidate3 = makeCandidate({ id: 'chunk-c', documentId: docId, finalScore: 0.6 });

    // rankedCandidates must be ordered by descending finalScore (as returned by rankCandidates)
    const rankedCandidates = [candidate1, candidate2, candidate3];

    const chunkB = makeChunk({ id: 'chunk-b', documentId: docId, versionId: 'v-1', chunkIndex: 1 });
    const chunkC = makeChunk({ id: 'chunk-c', documentId: docId, versionId: 'v-1', chunkIndex: 2 });
    const chunkA = makeChunk({ id: 'chunk-a', documentId: docId, versionId: 'v-1', chunkIndex: 0 });

    const allChunksByDocumentId = new Map([[docId, [chunkA, chunkB, chunkC]]]);

    const input: GroupCandidatesInput = { rankedCandidates, allChunksByDocumentId };
    const results = groupCandidatesByDocument(input);

    expect(results).toHaveLength(1);
    const result = results[0];
    expect(result.documentId).toBe(docId);
    expect(result.bestFinalScore).toBe(0.8);
    expect(result.bestChunkId).toBe('chunk-a');
    expect(result.allChunkIds).toHaveLength(3);
    expect(result.allChunkIds).toContain('chunk-a');
    expect(result.allChunkIds).toContain('chunk-b');
    expect(result.allChunkIds).toContain('chunk-c');
  });

  it('skips memory_block candidates — only document_chunk candidates are grouped', () => {
    const memBlock: RetrievalCandidate = {
      id: 'mem-1',
      organisationId: 'org-1',
      kind: 'memory_block',
      mode: 'auto',
      scopeTier: 1,
      finalScore: 0.9,
      updatedAt: NOW,
      tokenCount: 50,
      content: 'memory content',
    };

    const input: GroupCandidatesInput = {
      rankedCandidates: [memBlock],
      allChunksByDocumentId: new Map(),
    };

    const results = groupCandidatesByDocument(input);
    expect(results).toHaveLength(0);
  });

  it('deduplicates: second occurrence of same documentId is skipped', () => {
    const docId = 'doc-1';
    const candidate1 = makeCandidate({ id: 'chunk-a', documentId: docId, finalScore: 0.8 });
    const candidate2 = makeCandidate({ id: 'chunk-b', documentId: docId, finalScore: 0.7 });

    const chunkA = makeChunk({ id: 'chunk-a', documentId: docId, versionId: 'v-1', chunkIndex: 0 });
    const chunkB = makeChunk({ id: 'chunk-b', documentId: docId, versionId: 'v-1', chunkIndex: 1 });

    const input: GroupCandidatesInput = {
      rankedCandidates: [candidate1, candidate2],
      allChunksByDocumentId: new Map([[docId, [chunkA, chunkB]]]),
    };

    const results = groupCandidatesByDocument(input);
    expect(results).toHaveLength(1);
    expect(results[0].bestChunkId).toBe('chunk-a'); // first (highest score) wins
  });

  it('tokenCount is sum of all chunks for the document', () => {
    const docId = 'doc-1';
    const candidate = makeCandidate({ id: 'chunk-a', documentId: docId, finalScore: 0.9 });

    const chunkA = makeChunk({ id: 'chunk-a', documentId: docId, versionId: 'v-1', chunkIndex: 0, tokenCount: 200 });
    const chunkB = makeChunk({ id: 'chunk-b', documentId: docId, versionId: 'v-1', chunkIndex: 1, tokenCount: 150 });

    const input: GroupCandidatesInput = {
      rankedCandidates: [candidate],
      allChunksByDocumentId: new Map([[docId, [chunkA, chunkB]]]),
    };

    const results = groupCandidatesByDocument(input);
    expect(results[0].tokenCount).toBe(350);
  });
});
