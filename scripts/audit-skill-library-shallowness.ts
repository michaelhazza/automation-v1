/**
 * audit-skill-library-shallowness.ts
 *
 * One-shot audit that runs the v7-B dedup classifier in library-vs-library
 * mode to find pairs of already-shipped system skills that, *today*, would
 * be flagged as shallow modules by:
 *   - Rule 6a (superset-by-union: discriminator-enum signal in the rationale)
 *   - The self-contradiction sweep (`rationaleArguesAgainstMerge`)
 *   - Any classifier output of PARTIAL_OVERLAP or IMPROVEMENT (review-worthy)
 *
 * Read-only: no DB writes, no skill mutations, no llmRouter ledger entries.
 * Direct Anthropic call so the audit doesn't pollute production ledgers
 * (matches the `code-graph-health-check.ts` precedent).
 *
 * Cost-shape: N active system skills × K=4 neighbours, deduped by slug pair
 * → roughly N×K/2 LLM calls. At ~50 active skills that's ~100 calls.
 *
 * Known limitation: the live classifier prompt is asymmetric (candidate vs.
 * library has different framing; cross-reference detection only fires on
 * candidate.description). The audit dedupes (A,B) ≡ (B,A) to halve cost,
 * which means a problem visible only in one direction may be missed. Good
 * enough for a first pass. Directional/asymmetric re-runs are not implemented
 * in this one-shot script; add a no-dedupe mode before relying on directional
 * coverage.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=… OPENAI_API_KEY=… DATABASE_URL=… \
 *     EXPECTED_ACTIVE_SYSTEM_SKILLS=159 \
 *     npx tsx scripts/audit-skill-library-shallowness.ts
 *
 * EXPECTED_ACTIVE_SYSTEM_SKILLS is required and guards against partial seeds
 * or stale DB state — the audit refuses to write findings if the live count
 * differs from the expected. Update the value when the library grows; the
 * abort message tells you the current count so the next run is a one-liner.
 *
 * Inherited env surface: this script imports server/lib/embeddings.ts, which
 * loads the full server env validator (JWT_SECRET, EMAIL_FROM, …). Run from
 * a shell that has the same .env as local dev. The Anthropic call is direct
 * (no ledger pollution); the embedding call is not — that's the trade-off.
 *
 * Output: tasks/builds/skill-shallowness-audit/findings-<ISO>.md
 */

import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { eq } from 'drizzle-orm';
import path from 'path';
import fs from 'fs/promises';
import pLimit from 'p-limit';

import { systemSkills } from '../server/db/schema/systemSkills.js';
import { generateEmbeddings } from '../server/lib/embeddings.js';
import * as skillAnalyzerServicePure from '../server/services/skillAnalyzerServicePure.js';
import * as skillParserServicePure from '../server/services/skillParserServicePure.js';
import type { ParsedSkill } from '../server/services/skillParserServicePure.js';
import type { LibrarySkillSummary } from '../server/services/skillAnalyzerServicePure.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const TOP_K_NEIGHBOURS = 4;
const CONCURRENCY = 4;
const ANTHROPIC_MODEL = 'claude-sonnet-4-6'; // matches live skill-analyzer job for fidelity
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_API_VERSION = '2023-06-01';
const ANTHROPIC_MAX_TOKENS = 8192; // matches live job (Sonnet 4.6 output ceiling)
const ANTHROPIC_TIMEOUT_MS = 90_000;

const OUTPUT_DIR = path.join(process.cwd(), 'tasks/builds/skill-shallowness-audit');

// Discriminator-enum heuristic — match the v7-B Rule 6a wording. Fires on
// the rationale when the LLM has already reached for an enum split.
const DISCRIMINATOR_ENUM_PATTERNS: RegExp[] = [
  /\b(discriminator|mode|task|action|phase)\s+(enum|switch|field|parameter)\b/i,
  /\benum\s+(field|parameter|value)\s+(distinguishes?|switches?|selects?)\b/i,
  /\badd(ing)?\s+(a\s+)?(mode|task|type|action|phase)\s+(field|parameter|enum)\b/i,
];

function rationaleMentionsDiscriminator(reasoning: string | null | undefined): boolean {
  if (!reasoning) return false;
  return DISCRIMINATOR_ENUM_PATTERNS.some((re) => re.test(reasoning));
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PairResult {
  aSlug: string;
  bSlug: string;
  aName: string;
  bName: string;
  similarity: number;
  band: 'likely_duplicate' | 'ambiguous';
  classification: 'DUPLICATE' | 'IMPROVEMENT' | 'PARTIAL_OVERLAP' | 'DISTINCT' | 'PARSE_FAILURE' | 'API_ERROR';
  confidence: number | null;
  reasoning: string;
  triggers: string[]; // which heuristics fired
  rawError?: string;
}

// ---------------------------------------------------------------------------
// Anthropic call (direct — no ledger)
// ---------------------------------------------------------------------------

interface AnthropicOk { ok: true; content: string }
interface AnthropicErr { ok: false; reason: string }

async function callAnthropic(system: string, user: string, apiKey: string): Promise<AnthropicOk | AnthropicErr> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ANTHROPIC_TIMEOUT_MS);
  try {
    const res = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_API_VERSION,
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: ANTHROPIC_MAX_TOKENS,
        temperature: 0.1, // matches live job
        system,
        messages: [{ role: 'user', content: user }],
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { ok: false, reason: `HTTP ${res.status}: ${body.slice(0, 300)}` };
    }
    const json = await res.json() as { content?: Array<{ type?: string; text?: string }> };
    const block = json?.content?.find?.((b) => b?.type === 'text');
    const text = typeof block?.text === 'string' ? block.text : '';
    if (!text) return { ok: false, reason: 'response had no text content' };
    return { ok: true, content: text };
  } catch (err) {
    const e = err as { name?: string; message?: string };
    return { ok: false, reason: e?.name === 'AbortError' ? `timeout after ${ANTHROPIC_TIMEOUT_MS}ms` : (e?.message ?? 'unknown error') };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    console.error('ANTHROPIC_API_KEY not set — required for the classifier sweep.');
    process.exit(1);
  }
  if (!process.env.OPENAI_API_KEY) {
    console.error('OPENAI_API_KEY not set — required for embedding-based neighbour selection.');
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL not set.');
    process.exit(1);
  }

  const EXPECTED_COUNT_ENV = 'EXPECTED_ACTIVE_SYSTEM_SKILLS';
  const expectedCountRaw = process.env[EXPECTED_COUNT_ENV];
  if (!expectedCountRaw) {
    console.error(
      `${EXPECTED_COUNT_ENV} not set. Set it to the expected count of active ` +
      `system skills (e.g. ${EXPECTED_COUNT_ENV}=159) so the audit refuses to ` +
      `write findings from a partial or drifted library.`,
    );
    process.exit(1);
  }
  const expectedCount = Number(expectedCountRaw);
  if (!Number.isInteger(expectedCount) || expectedCount < 2) {
    console.error(
      `${EXPECTED_COUNT_ENV} must be a positive integer >= 2; got ${JSON.stringify(expectedCountRaw)}.`,
    );
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);

  console.error('[audit-shallowness] loading active system skills…');
  const rows = await db
    .select({
      id: systemSkills.id,
      slug: systemSkills.slug,
      name: systemSkills.name,
      description: systemSkills.description,
      definition: systemSkills.definition,
      instructions: systemSkills.instructions,
    })
    .from(systemSkills)
    .where(eq(systemSkills.isActive, true));

  console.error(`[audit-shallowness] loaded ${rows.length} active system skills.`);
  if (rows.length !== expectedCount) {
    console.error(
      `[audit-shallowness] expected ${expectedCount} active system skills, got ${rows.length}. ` +
      `Refusing to write findings from a partial or drifted library. ` +
      `If ${rows.length} is the correct count, re-run with ${EXPECTED_COUNT_ENV}=${rows.length}.`,
    );
    await pool.end();
    process.exit(1);
  }
  if (rows.length < 2) {
    console.error('[audit-shallowness] need at least 2 skills to compare. Exiting.');
    await pool.end();
    return;
  }

  // ── 1. Embed every skill ─────────────────────────────────────────────────
  type SkillRow = (typeof rows)[number];
  const asParsed = (s: SkillRow): ParsedSkill => ({
    name: s.name,
    slug: s.slug,
    description: s.description ?? '',
    definition: (s.definition as object | null) ?? null,
    instructions: s.instructions ?? null,
    rawSource: '',
  });

  const normalised = rows.map(asParsed).map((p) => skillParserServicePure.normalizeForHash(p));

  console.error(`[audit-shallowness] generating embeddings for ${normalised.length} skills…`);
  const embeddings = await generateEmbeddings(normalised);
  if (!embeddings) {
    console.error('[audit-shallowness] embedding API returned null — aborting.');
    await pool.end();
    process.exit(1);
  }

  // ── 2. For each skill, find top-K neighbours in ambiguous/likely-duplicate bands
  type Neighbour = {
    aIdx: number;
    bIdx: number;
    similarity: number;
    band: 'likely_duplicate' | 'ambiguous';
  };

  const seen = new Set<string>();
  const pairs: Neighbour[] = [];

  for (let i = 0; i < rows.length; i++) {
    const sims: Array<{ j: number; sim: number }> = [];
    for (let j = 0; j < rows.length; j++) {
      if (i === j) continue;
      const sim = skillAnalyzerServicePure.cosineSimilarity(embeddings[i], embeddings[j]);
      if (sim < 0.60) continue; // drop the "distinct" band — would not have hit the LLM live
      sims.push({ j, sim });
    }
    sims.sort((a, b) => b.sim - a.sim);
    for (const { j, sim } of sims.slice(0, TOP_K_NEIGHBOURS)) {
      // dedupe (i,j) ≡ (j,i) by sorting indices
      const lo = Math.min(i, j);
      const hi = Math.max(i, j);
      const key = `${lo}:${hi}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const band = sim > 0.92 ? 'likely_duplicate' as const : 'ambiguous' as const;
      pairs.push({ aIdx: lo, bIdx: hi, similarity: sim, band });
    }
  }

  console.error(`[audit-shallowness] ${pairs.length} unique pairs to classify (top-${TOP_K_NEIGHBOURS} per skill, deduped).`);

  // ── 3. Classify every pair through the live v7-B prompt ─────────────────
  const limit = pLimit(CONCURRENCY);
  const results: PairResult[] = [];
  let done = 0;

  await Promise.all(pairs.map((pair) => limit(async () => {
    const a = rows[pair.aIdx];
    const b = rows[pair.bIdx];
    const candidate = asParsed(a);
    const library: LibrarySkillSummary = {
      id: b.id,
      slug: b.slug,
      name: b.name,
      description: b.description ?? '',
      definition: (b.definition as object | null) ?? null,
      instructions: b.instructions ?? null,
      isSystem: true,
    };

    const { system, userMessage } = skillAnalyzerServicePure.buildClassifyPromptWithMerge(
      candidate,
      library,
      pair.band,
    );

    const apiResult = await callAnthropic(system, userMessage, anthropicKey);
    done++;
    if (done % 10 === 0 || done === pairs.length) {
      console.error(`[audit-shallowness] classified ${done}/${pairs.length}…`);
    }

    if (!apiResult.ok) {
      results.push({
        aSlug: a.slug, bSlug: b.slug,
        aName: a.name, bName: b.name,
        similarity: pair.similarity,
        band: pair.band,
        classification: 'API_ERROR',
        confidence: null,
        reasoning: '',
        triggers: [],
        rawError: apiResult.reason,
      });
      return;
    }

    const parsed = skillAnalyzerServicePure.parseClassificationResponseWithMerge(apiResult.content);
    if (!parsed) {
      results.push({
        aSlug: a.slug, bSlug: b.slug,
        aName: a.name, bName: b.name,
        similarity: pair.similarity,
        band: pair.band,
        classification: 'PARSE_FAILURE',
        confidence: null,
        reasoning: apiResult.content.slice(0, 800),
        triggers: [],
      });
      return;
    }

    const triggers: string[] = [];
    if (
      (parsed.classification === 'PARTIAL_OVERLAP' || parsed.classification === 'IMPROVEMENT') &&
      skillAnalyzerServicePure.rationaleArguesAgainstMerge(parsed.reasoning)
    ) {
      triggers.push('SELF_CONTRADICTION');
    }
    if (rationaleMentionsDiscriminator(parsed.reasoning)) {
      triggers.push('DISCRIMINATOR_ENUM_HINT');
    }
    if (parsed.classification === 'PARTIAL_OVERLAP' || parsed.classification === 'IMPROVEMENT' || parsed.classification === 'DUPLICATE') {
      triggers.push('REVIEW_WORTHY_CLASSIFICATION');
    }

    results.push({
      aSlug: a.slug, bSlug: b.slug,
      aName: a.name, bName: b.name,
      similarity: pair.similarity,
      band: pair.band,
      classification: parsed.classification,
      confidence: parsed.confidence,
      reasoning: parsed.reasoning,
      triggers,
    });
  })));

  // ── 4. Write report ─────────────────────────────────────────────────────
  const flagged = results.filter((r) => r.triggers.length > 0 || r.classification === 'PARSE_FAILURE' || r.classification === 'API_ERROR');
  flagged.sort((x, y) => {
    // High-signal triggers first
    const xPri = x.triggers.includes('SELF_CONTRADICTION') ? 0
      : x.triggers.includes('DISCRIMINATOR_ENUM_HINT') ? 1
      : x.classification === 'API_ERROR' || x.classification === 'PARSE_FAILURE' ? 3
      : 2;
    const yPri = y.triggers.includes('SELF_CONTRADICTION') ? 0
      : y.triggers.includes('DISCRIMINATOR_ENUM_HINT') ? 1
      : y.classification === 'API_ERROR' || y.classification === 'PARSE_FAILURE' ? 3
      : 2;
    if (xPri !== yPri) return xPri - yPri;
    return y.similarity - x.similarity;
  });

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = path.join(OUTPUT_DIR, `findings-${ts}.md`);
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const lines: string[] = [];
  lines.push(`# Skill library shallowness audit — findings`);
  lines.push(``);
  lines.push(`Run: ${ts}`);
  lines.push(`Model: ${ANTHROPIC_MODEL}, temp 0.1, max_tokens ${ANTHROPIC_MAX_TOKENS}`);
  lines.push(`Population: ${rows.length} active system skills`);
  lines.push(`Pairs classified: ${pairs.length} (top-${TOP_K_NEIGHBOURS} neighbours per skill, deduped, sim≥0.60)`);
  lines.push(`Pairs flagged: ${flagged.length}`);
  lines.push(``);
  lines.push(`## Trigger summary`);
  lines.push(``);
  lines.push(`| Trigger | Count |`);
  lines.push(`|---|---|`);
  const tally = (t: string) => results.filter((r) => r.triggers.includes(t)).length;
  lines.push(`| SELF_CONTRADICTION (rationale argues against its own merge) | ${tally('SELF_CONTRADICTION')} |`);
  lines.push(`| DISCRIMINATOR_ENUM_HINT (rationale reaches for an enum split) | ${tally('DISCRIMINATOR_ENUM_HINT')} |`);
  lines.push(`| REVIEW_WORTHY_CLASSIFICATION (DUPLICATE / IMPROVEMENT / PARTIAL_OVERLAP) | ${tally('REVIEW_WORTHY_CLASSIFICATION')} |`);
  lines.push(`| PARSE_FAILURE | ${results.filter((r) => r.classification === 'PARSE_FAILURE').length} |`);
  lines.push(`| API_ERROR | ${results.filter((r) => r.classification === 'API_ERROR').length} |`);
  lines.push(``);

  if (flagged.length === 0) {
    lines.push(`No pairs flagged. The shipped library is clean against the v7-B sweep.`);
  } else {
    lines.push(`## Flagged pairs`);
    lines.push(``);
    for (const r of flagged) {
      lines.push(`### ${r.aSlug}  vs  ${r.bSlug}`);
      lines.push(``);
      lines.push(`- **Names:** "${r.aName}" vs "${r.bName}"`);
      lines.push(`- **Similarity:** ${(r.similarity * 100).toFixed(1)}% (${r.band})`);
      lines.push(`- **Classification:** ${r.classification}${r.confidence !== null ? ` (confidence ${r.confidence.toFixed(2)})` : ''}`);
      lines.push(`- **Triggers:** ${r.triggers.length > 0 ? r.triggers.join(', ') : '(none — diagnostic only)'}`);
      if (r.rawError) {
        lines.push(`- **Error:** ${r.rawError}`);
      }
      if (r.reasoning) {
        lines.push(``);
        lines.push(`**Rationale:**`);
        lines.push(``);
        lines.push(`> ${r.reasoning.replace(/\n/g, '\n> ')}`);
      }
      lines.push(``);
    }
  }

  lines.push(`## Full pair list`);
  lines.push(``);
  lines.push(`| a | b | sim | band | classification | triggers |`);
  lines.push(`|---|---|---|---|---|---|`);
  for (const r of results) {
    lines.push(`| ${r.aSlug} | ${r.bSlug} | ${(r.similarity * 100).toFixed(1)}% | ${r.band} | ${r.classification} | ${r.triggers.join(', ') || '-'} |`);
  }
  lines.push(``);

  await fs.writeFile(outPath, lines.join('\n'), 'utf8');
  console.error(`[audit-shallowness] wrote ${outPath}`);
  console.error(`[audit-shallowness] ${flagged.length} flagged / ${results.length} total.`);

  await pool.end();
}

main().catch((err) => {
  console.error('[audit-shallowness] fatal:', err?.stack ?? err);
  process.exit(1);
});
