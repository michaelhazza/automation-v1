/**
 * configDocumentParserServicePure — validation, confidence gating, gap analysis
 *
 * Pure decision layer over `ParsedConfigField[]`. Consumed by the impure
 * parser service after the LLM pass produces the canonical shape.
 *
 * Pipeline (§9.4):
 *   1. Validate each parsed field against its matching ConfigQuestion.
 *   2. Confidence-gate: fields ≥ PARSE_CONFIDENCE_THRESHOLD auto-apply.
 *   3. Gap analysis: required fields with answer=null OR below threshold.
 *   4. Outcome routing:
 *        - All required answered AND all high confidence → 'auto_apply'
 *        - Some missing / low confidence              → 'gaps'
 *        - Document mostly empty or unrecognisable    → 'rejected'
 *
 * Spec: docs/memory-and-briefings-spec.md §9.4 (S21)
 */

import type {
  ConfigQuestion,
  ParsedConfigField,
  ConfigDocumentSummary,
  ConfigDocumentOutcome,
} from '../types/configSchema.js';

export const PARSE_CONFIDENCE_THRESHOLD = 0.7;

/** Below this fraction of fields answered at all → outright reject. */
export const PARSE_REJECTION_ANSWERED_FRACTION = 0.2;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate a parsed field against its schema. Mutates the field with
 * `invalid: true` + `invalidReason` on failure; leaves valid fields alone.
 * Returns the field (new object — never mutates input).
 */
export function validateParsedField(
  parsed: ParsedConfigField,
  question: ConfigQuestion | undefined,
): ParsedConfigField {
  if (!question) {
    return { ...parsed, invalid: true, invalidReason: 'Unknown fieldId' };
  }

  const { answer, confidence } = parsed;

  // Null answer is not an invalidation — it's captured via gap analysis.
  if (answer === null || answer === undefined) {
    return { ...parsed };
  }

  // Invalid confidence range
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    return { ...parsed, invalid: true, invalidReason: `confidence out of [0,1]: ${confidence}` };
  }

  switch (question.type) {
    case 'text':
    case 'url':
    case 'email':
    case 'datetime':
      if (typeof answer !== 'string') {
        return { ...parsed, invalid: true, invalidReason: `expected string for type=${question.type}` };
      }
      if (question.type === 'email' && typeof answer === 'string' && !/^[^@]+@[^@]+\.[^@]+$/.test(answer)) {
        return { ...parsed, invalid: true, invalidReason: 'not a valid email address' };
      }
      if (question.type === 'url' && typeof answer === 'string' && !/^https?:\/\//.test(answer)) {
        return { ...parsed, invalid: true, invalidReason: 'URL must begin with http(s)://' };
      }
      break;
    case 'boolean':
      if (typeof answer !== 'boolean') {
        return { ...parsed, invalid: true, invalidReason: 'expected boolean' };
      }
      break;
    case 'select':
      if (typeof answer !== 'string') {
        return { ...parsed, invalid: true, invalidReason: 'expected string (select option)' };
      }
      if (question.options && !question.options.includes(answer)) {
        return {
          ...parsed,
          invalid: true,
          invalidReason: `value '${answer}' not in allowed options`,
        };
      }
      break;
    case 'multiselect':
      if (!Array.isArray(answer)) {
        return { ...parsed, invalid: true, invalidReason: 'expected string[]' };
      }
      if (question.options) {
        const bad = answer.find((v) => !question.options!.includes(v as string));
        if (bad !== undefined) {
          return {
            ...parsed,
            invalid: true,
            invalidReason: `value '${bad}' not in allowed options`,
          };
        }
      }
      break;
    case 'deliveryChannels':
      // Async path decomposes this into named sub-fields; as a top-level field
      // it's represented as a string[] of enabled channels ('email', 'portal', 'slack').
      if (!Array.isArray(answer) && typeof answer !== 'string') {
        return {
          ...parsed,
          invalid: true,
          invalidReason: 'expected string[] of channel names',
        };
      }
      break;
  }

  return { ...parsed };
}

// ---------------------------------------------------------------------------
// Confidence gating + gap analysis
// ---------------------------------------------------------------------------

export interface OutcomeParams {
  /** Parsed fields after validation has run. */
  parsed: ParsedConfigField[];
  /** Workflow(s) Configuration Schema flattened. */
  schema: ConfigQuestion[];
  /** Confidence floor. Defaults to PARSE_CONFIDENCE_THRESHOLD. */
  threshold?: number;
}

/**
 * Compute auto-apply set + gap set + outcome routing. Pure — callers persist
 * or follow up on the results.
 */
export function computeOutcome(params: OutcomeParams): ConfigDocumentSummary {
  const threshold = params.threshold ?? PARSE_CONFIDENCE_THRESHOLD;
  const byId = new Map(params.schema.map((q) => [q.id, q]));
  const autoApply: ParsedConfigField[] = [];
  const gaps: ParsedConfigField[] = [];

  // Build map of parsed fields keyed by fieldId
  const parsedById = new Map(params.parsed.map((p) => [p.fieldId, p]));

  // Walk the schema so every required question is evaluated even when absent
  // from the parsed output.
  for (const q of params.schema) {
    const p = parsedById.get(q.id);
    if (!p) {
      // Not in the parsed output at all
      if (q.required) {
        gaps.push({ fieldId: q.id, answer: null, confidence: 0 });
      }
      continue;
    }

    const invalid = p.invalid === true;
    const hasAnswer = p.answer !== null && p.answer !== undefined;
    const highConfidence = !invalid && hasAnswer && p.confidence >= threshold;

    if (highConfidence) {
      autoApply.push(p);
      continue;
    }

    // Required but missing / low-confidence / invalid → gap
    if (q.required) {
      gaps.push(p);
    }
  }

  const outcome = decideOutcome(params.schema, params.parsed, gaps);

  const summary: ConfigDocumentSummary = {
    parsed: params.parsed,
    autoApplyFields: autoApply,
    gaps,
    outcome,
  };
  if (outcome === 'rejected') {
    summary.rejectionReason =
      'Could not parse this document. Please use the generated template or contact support.';
  }
  return summary;
}

function decideOutcome(
  schema: ConfigQuestion[],
  parsed: ParsedConfigField[],
  gaps: ParsedConfigField[],
): ConfigDocumentOutcome {
  if (schema.length === 0) return 'rejected';

  // Count how many schema questions had a non-null answer produced by the parser
  const parsedById = new Map(parsed.map((p) => [p.fieldId, p]));
  let answered = 0;
  for (const q of schema) {
    const p = parsedById.get(q.id);
    if (p && p.answer !== null && p.answer !== undefined && !p.invalid) {
      answered += 1;
    }
  }
  const answeredFraction = answered / schema.length;

  if (answeredFraction < PARSE_REJECTION_ANSWERED_FRACTION) return 'rejected';
  if (gaps.length === 0) return 'auto_apply';
  return 'gaps';
}
