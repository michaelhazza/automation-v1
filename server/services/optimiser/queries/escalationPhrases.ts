// ---------------------------------------------------------------------------
// Query module: optimiser.escalation.repeat_phrase
//
// Identifies repeated phrases across escalation payloads within the subaccount.
// Pulls up to 1000 recent review_items then aggregates in memory.
//
// Tokeniser: lowercase → strip punctuation → suffix-strip (-ing, -ed, -s)
// n-gram: unigram (single words after tokenisation)
//
// Authoritative timestamp: review_items.created_at
// ---------------------------------------------------------------------------

import { sql } from 'drizzle-orm';
import type { QueryModule, QueryRow } from './types.js';

export interface EscalationPhraseEvidence {
  phrase: string;
  count: number;
  sampleEscalationIds: string[];
  median_version: 0;
}

const CATEGORY = 'optimiser.escalation.repeat_phrase';

// ── Tokeniser ─────────────────────────────────────────────────────────────────

/**
 * Tokenises a text blob into normalised word tokens.
 * 1. Lowercase
 * 2. Strip non-alphanumeric (except spaces)
 * 3. Strip suffixes: -ing, -ed, -s (in that order)
 */
export function tokenise(text: string): string[] {
  const lower = text.toLowerCase();
  const stripped = lower.replace(/[^a-z0-9\s]/g, '');
  return stripped
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      let w = word;
      if (w.endsWith('ing') && w.length > 4) w = w.slice(0, -3);
      else if (w.endsWith('ed') && w.length > 3) w = w.slice(0, -2);
      else if (w.endsWith('s') && w.length > 2) w = w.slice(0, -1);
      return w;
    })
    .filter((w) => w.length > 1);
}

export const module: QueryModule<EscalationPhraseEvidence> = {
  category: CATEGORY,
  authoritativeTimestampColumn: 'review_items.created_at',
  readReplicaSafe: true,

  async run(tx, subaccountId): Promise<QueryRow<EscalationPhraseEvidence>[]> {
    await tx.execute(sql`SET LOCAL statement_timeout = '10000'`);

    const rows = await tx.execute<{
      id: string;
      review_payload_json: unknown;
      created_at: string;
    }>(sql`
      SELECT
        ri.id,
        ri.review_payload_json,
        ri.created_at::text AS created_at
      FROM review_items ri
      WHERE ri.subaccount_id = ${subaccountId}::uuid
        AND ri.created_at >= now() - interval '7 days'
      ORDER BY ri.created_at DESC
      LIMIT 1000
    `);

    // Aggregate phrases in memory
    const phraseCounts = new Map<string, { count: number; ids: string[] }>();

    for (const row of rows) {
      const payload = row.review_payload_json;
      // Extract text content from the payload (best-effort)
      const text = extractText(payload);
      if (!text) continue;

      const tokens = tokenise(text);
      for (const token of tokens) {
        const existing = phraseCounts.get(token);
        if (existing) {
          existing.count += 1;
          if (existing.ids.length < 5) {
            existing.ids.push(row.id);
          }
        } else {
          phraseCounts.set(token, { count: 1, ids: [row.id] });
        }
      }
    }

    const now = new Date();
    const result: QueryRow<EscalationPhraseEvidence>[] = [];

    for (const [phrase, { count, ids }] of phraseCounts) {
      if (count < 2) continue; // Only phrases with >= 2 occurrences are worth storing

      result.push({
        subaccountId,
        metricKey: phrase,
        metricValue: count,
        computedAt: now,
        evidence: {
          phrase,
          count,
          sampleEscalationIds: ids,
          median_version: 0,
        },
      });
    }

    // Sort deterministically by count desc then phrase asc
    result.sort((a, b) => {
      if (b.metricValue !== a.metricValue) return b.metricValue - a.metricValue;
      return a.metricKey.localeCompare(b.metricKey);
    });

    return result;
  },
};

/**
 * Best-effort text extractor from an unknown review payload shape.
 * Returns the concatenated string content of all string fields.
 */
function extractText(payload: unknown): string {
  if (typeof payload === 'string') return payload;
  if (payload === null || payload === undefined) return '';
  if (typeof payload === 'object') {
    return Object.values(payload as Record<string, unknown>)
      .map((v) => extractText(v))
      .join(' ');
  }
  return '';
}
