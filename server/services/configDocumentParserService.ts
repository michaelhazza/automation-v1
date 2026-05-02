/**
 * configDocumentParserService — Configuration Document ingestion (§9.4)
 *
 * Pipeline:
 *   1. extractText(buffer, mimeType) — DOCX / PDF OCR / plain
 *   2. parseWithLLM(schemas, text) → ParsedConfigField[]
 *   3. validateParsedField() + computeOutcome() (pure module)
 *
 * Confidence gating at PARSE_CONFIDENCE_THRESHOLD; fields below it become
 * gaps surfaced in the follow-up conversation.
 *
 * Spec: docs/memory-and-briefings-spec.md §9.4 (S21)
 */

import type { ConfigQuestion, ConfigDocumentSummary, ParsedConfigField } from '../types/configSchema.js';
import {
  validateParsedField,
  computeOutcome,
} from './configDocumentParserServicePure.js';
import { routeCall } from './llmRouter.js';
import { logger } from '../lib/logger.js';

export interface ParseDocumentInput {
  /** Raw buffer bytes of the uploaded document. */
  buffer: Buffer;
  /** Content type / mime hint for text extraction. */
  mimeType: string;
  /** Bundle schema the LLM maps answers onto. */
  schema: ConfigQuestion[];
  /** Org + run context for the LLM router. */
  organisationId: string;
  subaccountId: string;
  correlationId: string;
}

export async function parseDocument(input: ParseDocumentInput): Promise<ConfigDocumentSummary> {
  // 1. Extract text
  const text = await extractText(input.buffer, input.mimeType);
  if (!text || text.trim().length === 0) {
    return {
      parsed: [],
      autoApplyFields: [],
      gaps: input.schema.filter((q) => q.required).map((q) => ({
        fieldId: q.id,
        answer: null,
        confidence: 0,
      })),
      outcome: 'rejected',
      rejectionReason: 'Could not extract any text from the uploaded document.',
    };
  }

  // 2. LLM parse
  const raw = await parseWithLLM({
    schema: input.schema,
    documentText: text,
    organisationId: input.organisationId,
    subaccountId: input.subaccountId,
    correlationId: input.correlationId,
  });

  // 3. Validate every field against its schema
  const byId = new Map(input.schema.map((q) => [q.id, q]));
  const validated = raw.map((p) => validateParsedField(p, byId.get(p.fieldId)));

  // 4. Route outcome (pure)
  const summary = computeOutcome({ parsed: validated, schema: input.schema });

  logger.info('configDocumentParserService.parsed', {
    subaccountId: input.subaccountId,
    organisationId: input.organisationId,
    outcome: summary.outcome,
    autoApplyCount: summary.autoApplyFields.length,
    gapCount: summary.gaps.length,
  });

  return summary;
}

// ---------------------------------------------------------------------------
// Text extraction
// ---------------------------------------------------------------------------

async function extractText(buffer: Buffer, mimeType: string): Promise<string> {
  const normalised = mimeType.toLowerCase();

  if (
    normalised.includes('plain') ||
    normalised.includes('markdown') ||
    normalised.includes('text/')
  ) {
    return buffer.toString('utf-8');
  }

  if (
    normalised.includes('officedocument.wordprocessingml') ||
    normalised.endsWith('docx')
  ) {
    // Dynamic import to avoid hard dependency at test time
     
    // @ts-expect-error — optional peer dep, not declared in this project's deps
    const mammoth = await (import('mammoth') as Promise<any>).catch(() => null) as {
      extractRawText: (opts: { buffer: Buffer }) => Promise<{ value: string }>;
    } | null;
    if (!mammoth) {
      throw { statusCode: 500, message: 'mammoth package not available for DOCX parsing', errorCode: 'MAMMOTH_UNAVAILABLE' };
    }
    const result = await mammoth.extractRawText({ buffer });
    return result.value ?? '';
  }

  if (normalised.includes('pdf')) {
    // PDF OCR path — relies on an external OCR service wired in prod.
    // Phase 3: log and return empty → parser routes to 'rejected'.
    logger.warn('configDocumentParserService.pdf_ocr_not_wired', {
      message: 'PDF OCR path not yet wired in Phase 3 — returning empty text',
    });
    return '';
  }

  // Unknown mime type — best-effort UTF-8 decode
  return buffer.toString('utf-8');
}

// ---------------------------------------------------------------------------
// LLM parse pass
// ---------------------------------------------------------------------------

interface LlmParseInput {
  schema: ConfigQuestion[];
  documentText: string;
  organisationId: string;
  subaccountId: string;
  correlationId: string;
}

async function parseWithLLM(input: LlmParseInput): Promise<ParsedConfigField[]> {
  const schemaSummary = input.schema.map((q) => ({
    id: q.id,
    section: q.section,
    question: q.question,
    type: q.type,
    options: q.options,
    required: q.required,
  }));

  const systemPrompt = [
    'You are a Configuration Document parser. You receive:',
    '  1. A Configuration Schema (array of questions with IDs + types).',
    '  2. The text of a filled-out Configuration Document.',
    '',
    'Your job: map the document text to a JSON array of ParsedConfigField records.',
    '',
    'Output shape (strict):',
    '[',
    '  {',
    '    "fieldId": "<matches a schema question id>",',
    '    "answer": <string | string[] | boolean | null, typed per schema.type>,',
    '    "confidence": <number in [0,1]>,',
    '    "sourceExcerpt": "<the raw text fragment the answer was derived from, ≤ 240 chars>"',
    '  },',
    '  ...',
    ']',
    '',
    'Rules:',
    '  - Emit one record per schema question. If the answer is missing in the document, emit `answer: null` and `confidence: 0`.',
    '  - For `multiselect` questions, `answer` is an array of strings from the `options` list.',
    '  - For `boolean`, use literal `true` / `false`.',
    '  - For `deliveryChannels`, return a string[] of enabled channels (e.g. ["email", "portal"]).',
    '  - Assign confidence honestly — use values below 0.7 when the mapping is uncertain.',
    '  - Return STRICT JSON with no preamble.',
  ].join('\n');

  const userMessage = [
    'SCHEMA:',
    JSON.stringify(schemaSummary, null, 2),
    '',
    'DOCUMENT:',
    input.documentText.slice(0, 60_000),
  ].join('\n');

  const response = await routeCall({
    messages: [
      { role: 'user', content: userMessage },
    ],
    system: systemPrompt,
    maxTokens: 4000,
    temperature: 0,
    context: {
      organisationId: input.organisationId,
      subaccountId: input.subaccountId,
      correlationId: input.correlationId,
      sourceType: 'system',
      taskType: 'general',
    } as Parameters<typeof routeCall>[0]['context'],
  });

  const contentBlocks = response?.content ?? [];
  const rawText = Array.isArray(contentBlocks)
    ? contentBlocks
        .map((b) => (typeof b === 'object' && b !== null && 'text' in b ? String((b as { text: string }).text) : ''))
        .join('\n')
    : String(contentBlocks);

  const cleaned = rawText.trim().replace(/^```(?:json)?\n?/i, '').replace(/```$/, '');

  try {
    const parsed = JSON.parse(cleaned) as ParsedConfigField[];
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch (err) {
    logger.warn('configDocumentParserService.llm_parse_failed', {
      error: err instanceof Error ? err.message : String(err),
      rawSnippet: cleaned.slice(0, 500),
    });
    return [];
  }
}
