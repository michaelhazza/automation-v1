import type { ClassificationResult } from '../similarity.js';
import { isValidClassification } from '../similarity.js';
import type { ProposedMerge } from '../mergeWarnings/types.js';

/** Result returned by parseClassificationResponseWithMerge. The classification
 *  + confidence + reasoning fields match the base classifier; proposedMerge
 *  is non-null only when the LLM returned a valid merged version on a
 *  PARTIAL_OVERLAP / IMPROVEMENT classification. */
export interface ClassificationResultWithMerge {
  classification: 'DUPLICATE' | 'IMPROVEMENT' | 'PARTIAL_OVERLAP' | 'DISTINCT';
  confidence: number;
  reasoning: string;
  proposedMerge: ProposedMerge | null;
}

/** Validate that an unknown value matches the ProposedMerge shape. Pure —
 *  no library-row dependency. Per spec §9 edge case: a malformed merge is
 *  treated as missing (returns null), the row falls through to the existing
 *  null-fallback path, and execute rejects with "merge proposal unavailable
 *  — re-run analysis". The parser does NOT attempt field-level repair. */
function isValidProposedMerge(value: unknown): value is ProposedMerge {
  if (value === null || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (typeof v.name !== 'string' || v.name.length === 0) return false;
  if (typeof v.description !== 'string') return false;
  if (v.definition === null || typeof v.definition !== 'object') return false;
  // instructions may be null or string
  if (v.instructions !== null && typeof v.instructions !== 'string') return false;
  return true;
}

/** Parse LLM classification response. Validates with Zod.
 *  Returns null if response is unparseable. */
export function parseClassificationResponse(response: string): ClassificationResult | null {
  // Use brace extraction, not code-block regex — same reasoning as
  // parseClassificationResponseWithMerge. Non-greedy regex breaks on
  // responses whose string values contain triple backticks.
  let jsonStr = response.trim();
  const start = jsonStr.indexOf('{');
  const end = jsonStr.lastIndexOf('}');
  if (start !== -1 && end > start) {
    jsonStr = jsonStr.slice(start, end + 1);
  }

  try {
    const parsed = JSON.parse(jsonStr);
    if (!parsed || typeof parsed !== 'object') return null;
    if (!isValidClassification(parsed.classification)) return null;
    if (typeof parsed.confidence !== 'number' || parsed.confidence < 0 || parsed.confidence > 1) return null;
    if (typeof parsed.reasoning !== 'string') return null;
    return {
      classification: parsed.classification,
      confidence: parsed.confidence,
      reasoning: parsed.reasoning,
    };
  } catch {
    return null;
  }
}

/** Parse the merge-aware LLM classification response. Returns null on
 *  unparseable output. When classification is PARTIAL_OVERLAP or IMPROVEMENT
 *  the parser tries to validate proposedMerge — if missing or malformed,
 *  proposedMerge is set to null and the row follows the §6.3 LLM-fallback
 *  path on execute. For DUPLICATE / DISTINCT, proposedMerge is always null
 *  regardless of what the LLM returned. */
export function parseClassificationResponseWithMerge(
  response: string,
): ClassificationResultWithMerge | null {
  // Extract JSON from response using brace matching, not code-block regex.
  // The code-block regex approach (non-greedy [\s\S]*?) breaks when
  // proposedMerge.instructions contains triple backticks (markdown code
  // examples), causing the regex to stop at the first ``` inside the
  // string and extract truncated JSON. Brace extraction is robust to
  // wrapping, preamble/postamble, and any content inside string values.
  let jsonStr = response.trim();
  const start = jsonStr.indexOf('{');
  const end = jsonStr.lastIndexOf('}');
  if (start !== -1 && end > start) {
    jsonStr = jsonStr.slice(start, end + 1);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const p = parsed as Record<string, unknown>;
  if (!isValidClassification(p.classification)) return null;
  // Normalise confidence: Sonnet occasionally returns a percentage integer (e.g. 85)
  // instead of a decimal (0.85). Only normalise when raw >= 2 (clearly a percentage
  // integer) — values in (1, 2) are genuinely out of range and should return null.
  if (typeof p.confidence !== 'number') return null;
  const raw = p.confidence;
  const confidence = raw >= 2 ? raw / 100 : raw;
  if (confidence < 0 || confidence > 1) return null;
  if (typeof p.reasoning !== 'string') return null;

  const classification = p.classification;
  let proposedMerge: ProposedMerge | null = null;
  if (classification === 'PARTIAL_OVERLAP' || classification === 'IMPROVEMENT') {
    if (p.proposedMerge !== undefined && p.proposedMerge !== null) {
      if (isValidProposedMerge(p.proposedMerge)) {
        proposedMerge = {
          ...p.proposedMerge,
          mergeRationale: typeof p.proposedMerge.mergeRationale === 'string'
            ? p.proposedMerge.mergeRationale
            : undefined,
        };
      }
      // Otherwise leave as null — null-fallback path on execute.
    }
  }

  return {
    classification,
    confidence,
    reasoning: p.reasoning,
    proposedMerge,
  };
}
