import { env } from './env.js';

// ---------------------------------------------------------------------------
// Embeddings — wraps OpenAI text-embedding-3-small (1536 dims)
// Non-fatal on failure: caller should handle null gracefully.
// ---------------------------------------------------------------------------

const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMENSIONS = 1536;
const OPENAI_EMBEDDINGS_URL = 'https://api.openai.com/v1/embeddings';

/**
 * Generate an embedding vector for the given text.
 * Returns null if the API key is not configured or the call fails.
 */
export async function generateEmbedding(text: string): Promise<number[] | null> {
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) return null;

  try {
    const response = await fetch(OPENAI_EMBEDDINGS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        input: text.slice(0, 8192), // respect token limits
        model: EMBEDDING_MODEL,
        dimensions: EMBEDDING_DIMENSIONS,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      console.warn(`[Embeddings] OpenAI API error ${response.status}: ${body.slice(0, 200)}`);
      return null;
    }

    const data = await response.json() as {
      data: Array<{ embedding: number[] }>;
    };

    return data.data[0]?.embedding ?? null;
  } catch (err) {
    console.warn('[Embeddings] Failed to generate embedding:', err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Format a number[] embedding for PostgreSQL vector literal.
 * e.g. [0.1, 0.2, ...] → '[0.1,0.2,...]'
 */
export function formatVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}
