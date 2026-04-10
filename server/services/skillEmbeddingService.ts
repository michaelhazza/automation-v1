import { eq, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import { skillEmbeddings } from '../db/schema/index.js';

// ---------------------------------------------------------------------------
// Skill Embedding Service — content-addressed embedding cache CRUD
// ---------------------------------------------------------------------------

export const skillEmbeddingService = {
  /** Get cached embedding by content hash. Returns null if not cached. */
  async getByContentHash(contentHash: string): Promise<{ embedding: number[] } | null> {
    const rows = await db
      .select({ embedding: skillEmbeddings.embedding })
      .from(skillEmbeddings)
      .where(eq(skillEmbeddings.contentHash, contentHash))
      .limit(1);

    const row = rows[0];
    if (!row) return null;
    return { embedding: row.embedding };
  },

  /** Store an embedding. Upserts on content_hash conflict. */
  async store(params: {
    contentHash: string;
    sourceType: 'system' | 'org' | 'candidate';
    sourceIdentifier: string;
    embedding: number[];
  }): Promise<void> {
    await db
      .insert(skillEmbeddings)
      .values({
        contentHash: params.contentHash,
        sourceType: params.sourceType,
        sourceIdentifier: params.sourceIdentifier,
        embedding: params.embedding,
      })
      .onConflictDoUpdate({
        target: skillEmbeddings.contentHash,
        set: {
          sourceType: params.sourceType,
          sourceIdentifier: params.sourceIdentifier,
        },
      });
  },

  /** Batch get embeddings by content hashes. Returns Map<hash, embedding>. */
  async getByContentHashes(hashes: string[]): Promise<Map<string, number[]>> {
    if (hashes.length === 0) return new Map();

    const rows = await db
      .select({
        contentHash: skillEmbeddings.contentHash,
        embedding: skillEmbeddings.embedding,
      })
      .from(skillEmbeddings)
      .where(inArray(skillEmbeddings.contentHash, hashes));

    const result = new Map<string, number[]>();
    for (const row of rows) {
      result.set(row.contentHash, row.embedding);
    }
    return result;
  },

  /** Batch store embeddings. Uses upsert on content_hash conflict. */
  async storeBatch(
    entries: Array<{
      contentHash: string;
      sourceType: 'system' | 'org' | 'candidate';
      sourceIdentifier: string;
      embedding: number[];
    }>
  ): Promise<void> {
    if (entries.length === 0) return;

    await db
      .insert(skillEmbeddings)
      .values(entries)
      .onConflictDoUpdate({
        target: skillEmbeddings.contentHash,
        set: {
          sourceType: skillEmbeddings.sourceType,
          sourceIdentifier: skillEmbeddings.sourceIdentifier,
        },
      });
  },
};
