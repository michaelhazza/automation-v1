/**
 * escalationPhrases.ts — Optimiser telemetry query + phrase tokeniser (Chunk 2)
 *
 * Reads review_items.review_payload_json over 7 days, extracts all string
 * values, tokenises them, counts n-grams, and returns frequent phrases
 * (>= minOccurrences threshold).
 *
 * The tokeniser is fully pure (no I/O). The DB query wraps it.
 *
 * Query cost guardrail: WHERE review_items.created_at >= now() - interval '7 days'.
 * Called by the evaluator in Chunk 3; this module returns raw data only.
 *
 * Pure exports (testable without DB):
 *   tokenisePhrase(payload: string): string[]
 *   countNGrams(tokens: string[], n: number): Map<string, number>
 *   extractFrequentPhrases(payloads, opts): Array<{phrase, count, sample_escalation_ids}>
 */

import { sql } from 'drizzle-orm';
import { withAdminConnection } from '../../../lib/adminDbConnection.js';
import { logger } from '../../../lib/logger.js';

// ---------------------------------------------------------------------------
// Stop-word list — common English words excluded from phrase extraction
// ---------------------------------------------------------------------------
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'be',
  'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
  'would', 'could', 'should', 'may', 'might', 'shall', 'can', 'not',
  'no', 'nor', 'so', 'yet', 'both', 'either', 'neither', 'each', 'every',
  'all', 'any', 'few', 'more', 'most', 'other', 'some', 'such', 'than',
  'too', 'very', 'just', 'this', 'that', 'these', 'those', 'it', 'its',
  'i', 'you', 'he', 'she', 'we', 'they', 'me', 'him', 'her', 'us', 'them',
  'my', 'your', 'his', 'our', 'their', 'what', 'which', 'who', 'whom',
  'when', 'where', 'why', 'how', 'if', 'then', 'there', 'here', 'up',
  'about', 'into', 'through', 'during', 'before', 'after', 'above',
  'below', 'between', 'out', 'off', 'over', 'under', 'again', 'further',
]);

// ---------------------------------------------------------------------------
// Pure: tokenisePhrase
// ---------------------------------------------------------------------------

/**
 * Tokenises a free-text string (or JSON payload stringified value) into
 * normalised tokens:
 *   1. Lowercase
 *   2. Strip punctuation (keep letters, digits, internal hyphens)
 *   3. Suffix-strip: remove trailing -ing, -ed, -s (in that priority order)
 *   4. Filter stop words and tokens shorter than 3 characters
 *
 * When `payload` looks like a JSON object/array, all string leaf values are
 * extracted first, then tokenised together.
 */
export function tokenisePhrase(payload: string): string[] {
  // If it looks like JSON, extract all string values
  let text = payload;
  if (payload.trim().startsWith('{') || payload.trim().startsWith('[')) {
    try {
      const parsed = JSON.parse(payload);
      text = extractStringValues(parsed).join(' ');
    } catch {
      // not valid JSON, treat as plain text
    }
  }

  return text
    .toLowerCase()
    .replace(/[\r\n\t]+/g, ' ')         // normalise whitespace
    .split(/\s+/)
    .map((token) => {
      // Strip leading/trailing punctuation but keep internal hyphens
      const cleaned = token.replace(/^[^a-z0-9-]+|[^a-z0-9-]+$/g, '');
      return stemToken(cleaned);
    })
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
}

function extractStringValues(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(extractStringValues);
  if (value !== null && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).flatMap(extractStringValues);
  }
  return [];
}

function stemToken(token: string): string {
  if (token.endsWith('ing') && token.length > 5) {
    return token.slice(0, -3);
  }
  if (token.endsWith('ed') && token.length > 4) {
    return token.slice(0, -2);
  }
  if (token.endsWith('s') && token.length > 3 && !token.endsWith('ss')) {
    return token.slice(0, -1);
  }
  return token;
}

// ---------------------------------------------------------------------------
// Pure: countNGrams
// ---------------------------------------------------------------------------

/**
 * Counts all n-grams (contiguous sequences of n tokens) in a token array.
 * Returns a Map from the n-gram string (space-joined) to its count.
 */
export function countNGrams(tokens: string[], n: number): Map<string, number> {
  if (n <= 0 || tokens.length < n) return new Map();
  const counts = new Map<string, number>();
  for (let i = 0; i <= tokens.length - n; i++) {
    const ngram = tokens.slice(i, i + n).join(' ');
    counts.set(ngram, (counts.get(ngram) ?? 0) + 1);
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Pure: extractFrequentPhrases
// ---------------------------------------------------------------------------

export interface FrequentPhrase {
  phrase: string;
  count: number;
  sample_escalation_ids: string[];  // sorted ascending
}

/**
 * Given review payloads, tokenises each, counts n-grams from 1..maxNgram,
 * and returns phrases that appear in at least minOccurrences payloads.
 * sample_escalation_ids is the list of escalation review item IDs containing
 * the phrase, sorted ascending.
 */
export function extractFrequentPhrases(
  reviewPayloads: Array<{ id: string; payload: string }>,
  opts: { minOccurrences: number; maxNgram: number },
): FrequentPhrase[] {
  const { minOccurrences, maxNgram } = opts;

  // phrase -> { count, ids }
  const phraseMap = new Map<string, { count: number; ids: Set<string> }>();

  for (const { id, payload } of reviewPayloads) {
    const tokens = tokenisePhrase(payload);
    const phrasesInDoc = new Set<string>();

    for (let n = 1; n <= maxNgram; n++) {
      const ngrams = countNGrams(tokens, n);
      for (const phrase of ngrams.keys()) {
        phrasesInDoc.add(phrase);
      }
    }

    for (const phrase of phrasesInDoc) {
      const existing = phraseMap.get(phrase);
      if (existing) {
        existing.count += 1;
        existing.ids.add(id);
      } else {
        phraseMap.set(phrase, { count: 1, ids: new Set([id]) });
      }
    }
  }

  return Array.from(phraseMap.entries())
    .filter(([, { count }]) => count >= minOccurrences)
    .map(([phrase, { count, ids }]) => ({
      phrase,
      count,
      sample_escalation_ids: [...ids].sort(),
    }))
    .sort((a, b) => b.count - a.count || a.phrase.localeCompare(b.phrase));
}

// ---------------------------------------------------------------------------
// DB-backed row type
// ---------------------------------------------------------------------------

export interface EscalationPhrasesRow {
  phrase: string;
  count: number;
  sample_escalation_ids: string[];  // sorted ascending
}

const SOURCE = 'optimiser.escalationPhrases';
const DEFAULT_MIN_OCCURRENCES = 3;
const DEFAULT_MAX_NGRAM = 3;

export async function queryEscalationPhrases(input: {
  subaccountId: string;
  organisationId: string;
}): Promise<EscalationPhrasesRow[]> {
  const { subaccountId, organisationId } = input;

  try {
    return await withAdminConnection(
      { source: SOURCE, reason: 'optimiser scan: escalation phrases', skipAudit: true },
      async (tx) => {
        await tx.execute(sql`SET LOCAL ROLE admin_role`);

        const result = await tx.execute(sql`
          SELECT
            ri.id::text                      AS id,
            ri.review_payload_json::text     AS payload
          FROM review_items ri
          WHERE ri.subaccount_id = ${subaccountId}
            AND ri.organisation_id = ${organisationId}
            AND ri.review_status IN ('pending', 'approved', 'rejected', 'completed')
            AND ri.created_at >= now() - INTERVAL '7 days'
        `);

        const rawRows = result as unknown as Array<{ id: string; payload: string }>;

        return extractFrequentPhrases(rawRows, {
          minOccurrences: DEFAULT_MIN_OCCURRENCES,
          maxNgram: DEFAULT_MAX_NGRAM,
        });
      },
    );
  } catch (err) {
    logger.error(`${SOURCE}.failed`, {
      subaccountId,
      error: err instanceof Error ? err.message : String(err),
    });
    throw Object.assign(new Error('optimiser query failed'), {
      statusCode: 500,
      errorCode: 'escalation_phrases_failed',
    });
  }
}
