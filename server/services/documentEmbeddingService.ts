import { env } from '../lib/env.js';
import { withBackoff } from '../lib/withBackoff.js';
import { logger } from '../lib/logger.js';

// ---------------------------------------------------------------------------
// documentEmbeddingService — I/O-only OpenAI embedding wrapper
//
// Pure I/O: returns embedding vectors only. Does NOT write to the database.
// Callers (documentChunkEmbedJob, documentReembedJob) own the persist step.
//
// Spec §3A, §5.3, §8 (queued embedding), §8.1 (idempotency contract lives in caller)
// Invariant §1.5 #9: embedding provider calls MUST run outside withOrgTx.
// Invariant §1.5 #14: cosine distance is the only embedding metric.
// ---------------------------------------------------------------------------

const OPENAI_EMBEDDINGS_URL = 'https://api.openai.com/v1/embeddings';
const EMBEDDING_DIMENSIONS = 1536;
const FETCH_TIMEOUT_MS = 60_000;
const BATCH_SIZE = 100;

export interface EmbedChunksInput {
  versionId: string;
  chunkIndex: number;
  content: string;
  embeddingModel: string;
}

export interface EmbedChunksResult {
  versionId: string;
  chunkIndex: number;
  embeddingModel: string;
  embedding: number[];
}

class EmbeddingHttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'EmbeddingHttpError';
  }
}

async function callEmbeddingApi(
  texts: string[],
  model: string,
  apiKey: string,
): Promise<number[][]> {
  const res = await fetch(OPENAI_EMBEDDINGS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      input: texts.map((t) => t.slice(0, 8192)),
      model,
      dimensions: EMBEDDING_DIMENSIONS,
    }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!res.ok) {
    let retryAfter: number | undefined;
    const retryHeader = res.headers.get('retry-after');
    if (retryHeader) {
      const parsed = Number(retryHeader);
      if (!Number.isNaN(parsed)) retryAfter = parsed;
    }
    const text = await res.text().catch(() => '');
    throw new EmbeddingHttpError(
      `openai.embeddings:${res.status}:${text.slice(0, 200)}`,
      res.status,
      retryAfter,
    );
  }

  const data = (await res.json()) as {
    data: Array<{ index: number; embedding: number[] }>;
  };

  const sorted = [...data.data].sort((a, b) => a.index - b.index);
  return sorted.map((d) => d.embedding);
}

/**
 * Embed an array of document chunks via OpenAI.
 *
 * Groups chunks by embeddingModel and issues one batch of API calls per model.
 * Each model's chunks are batched at BATCH_SIZE (100) texts per call.
 *
 * On permanent failure (withBackoff exhausted): throws
 *   { statusCode: 502, errorCode: 'EMBEDDING_PROVIDER_ERROR' }
 *
 * MUST be called outside any withOrgTx transaction (spec §1.5 #9).
 */
export async function embedChunks(
  chunks: EmbedChunksInput[],
): Promise<EmbedChunksResult[]> {
  if (chunks.length === 0) return [];

  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) {
    throw { statusCode: 502, errorCode: 'EMBEDDING_PROVIDER_ERROR' };
  }

  // Group by embeddingModel to support future multi-model scenarios.
  const byModel = new Map<string, EmbedChunksInput[]>();
  for (const chunk of chunks) {
    const list = byModel.get(chunk.embeddingModel) ?? [];
    list.push(chunk);
    byModel.set(chunk.embeddingModel, list);
  }

  const results: EmbedChunksResult[] = [];

  for (const [model, modelChunks] of byModel) {
    // Process in batches of BATCH_SIZE.
    for (let batchStart = 0; batchStart < modelChunks.length; batchStart += BATCH_SIZE) {
      const batch = modelChunks.slice(batchStart, batchStart + BATCH_SIZE);
      const texts = batch.map((c) => c.content);

      let embeddings: number[][];
      try {
        embeddings = await withBackoff(
          () => callEmbeddingApi(texts, model, apiKey),
          {
            label: 'openai.embeddings',
            correlationId: `embed-batch-${batchStart}`,
            runId: 'document-embedding',
            maxAttempts: 3,
            baseDelayMs: 1_000,
            maxDelayMs: 8_000,
            isRetryable: (err: unknown) => {
              if (err instanceof EmbeddingHttpError) {
                return err.status === 429 || err.status >= 500;
              }
              return true;
            },
            retryAfterMs: (err: unknown) => {
              if (err instanceof EmbeddingHttpError && err.retryAfterSeconds !== undefined) {
                return err.retryAfterSeconds * 1000;
              }
              return undefined;
            },
          },
        );
      } catch (err) {
        logger.error('documentEmbeddingService.permanent_failure', {
          model,
          batchStart,
          batchSize: batch.length,
          err,
        });
        throw { statusCode: 502, errorCode: 'EMBEDDING_PROVIDER_ERROR' };
      }

      for (let i = 0; i < batch.length; i++) {
        const chunk = batch[i];
        const embedding = embeddings[i];
        results.push({
          versionId: chunk.versionId,
          chunkIndex: chunk.chunkIndex,
          embeddingModel: chunk.embeddingModel,
          embedding,
        });
      }
    }
  }

  return results;
}
