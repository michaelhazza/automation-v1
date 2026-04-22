import type { ChallengeAssumptionsPayload, ChallengeItem } from '../../../shared/types/briefSkills.js';

const MAX_ITEMS = 5;
const MAX_CONCERN_LENGTH = 140;

export interface ChallengeAssumptionsValidationResult {
  valid: boolean;
  errors: string[];
}

function computeOverallRisk(items: ChallengeItem[]): 'low' | 'medium' | 'high' {
  if (items.some((i) => i.severity === 'high')) return 'high';
  if (items.some((i) => i.severity === 'medium')) return 'medium';
  return 'low';
}

/**
 * Validates parsed LLM output for the challenge_assumptions skill.
 * Also checks that overallRisk rolls up consistently from item severities.
 * Pure function — no I/O.
 */
export function validateChallengeAssumptionsOutput(
  payload: unknown,
): ChallengeAssumptionsValidationResult {
  const errors: string[] = [];

  if (!payload || typeof payload !== 'object') {
    return { valid: false, errors: ['payload is not an object'] };
  }

  const p = payload as Record<string, unknown>;
  const validDimensions = ['irreversibility', 'cost', 'scope', 'assumption', 'evidence', 'timing', 'compliance', 'other'];
  const validSeverities = ['low', 'medium', 'high'];

  if (!Array.isArray(p['items'])) {
    errors.push('items must be an array');
  } else {
    if (p['items'].length > MAX_ITEMS) {
      errors.push(`items.length must be ≤ ${MAX_ITEMS}, got ${p['items'].length}`);
    }
    for (let i = 0; i < p['items'].length; i++) {
      const item = p['items'][i] as Record<string, unknown>;
      if (!item['concern'] || typeof item['concern'] !== 'string') {
        errors.push(`items[${i}].concern must be a string`);
      } else if (item['concern'].length > MAX_CONCERN_LENGTH) {
        errors.push(`items[${i}].concern must be ≤ ${MAX_CONCERN_LENGTH} chars`);
      }
      if (!validSeverities.includes(item['severity'] as string)) {
        errors.push(`items[${i}].severity must be one of ${validSeverities.join(', ')}`);
      }
      if (!validDimensions.includes(item['dimension'] as string)) {
        errors.push(`items[${i}].dimension must be one of ${validDimensions.join(', ')}`);
      }
    }

    // Verify overallRisk rolls up consistently
    if (!errors.some((e) => e.startsWith('items['))) {
      const items = p['items'] as ChallengeItem[];
      const expected = computeOverallRisk(items);
      if (p['overallRisk'] !== expected) {
        errors.push(`overallRisk mismatch: items imply '${expected}' but got '${String(p['overallRisk'])}'`);
      }
    }
  }

  if (!validSeverities.includes(p['overallRisk'] as string)) {
    errors.push(`overallRisk must be one of ${validSeverities.join(', ')}`);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Assembles the system prompt for the challenge_assumptions LLM call.
 * Tone: trusted colleague pushing back, not pedantic.
 */
export function assembleChallengeAssumptionsPrompt(context: {
  briefText: string;
  actionSummary: string;
  runtimeConfidence: number;
  stakesDimensions: string[];
}): string {
  return `You are a trusted colleague reviewing a proposed action before it's executed.

Brief request: "${context.briefText}"
Proposed action: "${context.actionSummary}"
Confidence: ${(context.runtimeConfidence * 100).toFixed(0)}%
Stakes dimensions flagged: ${context.stakesDimensions.join(', ')}

Identify up to 5 potential concerns with this action. Use "potential concerns" framing, never "problems with your plan."
Be brief, constructive, and concrete. Tone: advisor, not critic.

Respond with JSON only:
{
  "items": [
    {
      "concern": "...",  // ≤ 140 chars
      "severity": "low|medium|high",
      "dimension": "irreversibility|cost|scope|assumption|evidence|timing|compliance|other",
      "evidenceRef": "...",  // optional
      "recommendedAction": "proceed_with_awareness|defer|narrow_scope|gather_evidence|reject"  // optional
    }
  ],
  "overallRisk": "low|medium|high"  // must roll up from items: high if any high; medium if any medium; else low
}`;
}

/**
 * Parses raw LLM output into a ChallengeAssumptionsPayload.
 * Throws if output fails validation.
 */
export function parseChallengeAssumptionsOutput(raw: string): ChallengeAssumptionsPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`challenge_assumptions: LLM output is not valid JSON`);
  }

  const validation = validateChallengeAssumptionsOutput(parsed);
  if (!validation.valid) {
    throw new Error(`challenge_assumptions: invalid output — ${validation.errors.join('; ')}`);
  }

  return parsed as ChallengeAssumptionsPayload;
}

export { computeOverallRisk };
