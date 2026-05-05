import type { ClarifyingQuestionsPayload } from '../../../shared/types/briefSkills.js';

const MAX_QUESTIONS = 5;
const MAX_QUESTION_LENGTH = 140;

export interface AskClarifyingQuestionsValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validates parsed LLM output for the ask_clarifying_questions skill.
 * Pure function — no I/O.
 */
export function validateClarifyingQuestionsOutput(
  payload: unknown,
): AskClarifyingQuestionsValidationResult {
  const errors: string[] = [];

  if (!payload || typeof payload !== 'object') {
    return { valid: false, errors: ['payload is not an object'] };
  }

  const p = payload as Record<string, unknown>;

  if (!Array.isArray(p['questions'])) {
    errors.push('questions must be an array');
  } else {
    if (p['questions'].length > MAX_QUESTIONS) {
      errors.push(`questions.length must be ≤ ${MAX_QUESTIONS}, got ${p['questions'].length}`);
    }
    for (let i = 0; i < p['questions'].length; i++) {
      const q = p['questions'][i] as Record<string, unknown>;
      if (!q['question'] || typeof q['question'] !== 'string') {
        errors.push(`questions[${i}].question must be a string`);
      } else if (q['question'].length > MAX_QUESTION_LENGTH) {
        errors.push(`questions[${i}].question must be ≤ ${MAX_QUESTION_LENGTH} chars`);
      }
      if (!q['rationale'] || typeof q['rationale'] !== 'string') {
        errors.push(`questions[${i}].rationale must be a string`);
      }
      const validDimensions = ['scope', 'target', 'action', 'timing', 'content', 'other'];
      if (!validDimensions.includes(q['ambiguityDimension'] as string)) {
        errors.push(`questions[${i}].ambiguityDimension must be one of ${validDimensions.join(', ')}`);
      }
    }
  }

  const confidenceBefore = p['confidenceBefore'];
  const expectedConfidenceAfter = p['expectedConfidenceAfter'];

  if (typeof confidenceBefore !== 'number' || confidenceBefore < 0 || confidenceBefore > 1) {
    errors.push('confidenceBefore must be a number 0.0–1.0');
  }
  if (typeof expectedConfidenceAfter !== 'number' || expectedConfidenceAfter < 0 || expectedConfidenceAfter > 1) {
    errors.push('expectedConfidenceAfter must be a number 0.0–1.0');
  }
  if (
    typeof confidenceBefore === 'number' &&
    typeof expectedConfidenceAfter === 'number' &&
    expectedConfidenceAfter <= confidenceBefore
  ) {
    errors.push('expectedConfidenceAfter must be > confidenceBefore');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Assembles the system prompt for the clarifying questions LLM call.
 * Returns the complete prompt string ready for `routeCall({ system })`.
 */
export function assembleClarifyingQuestionsPrompt(context: {
  briefText: string;
  orchestratorConfidence: number;
  ambiguityDimensions: string[];
  conversationContext?: Array<{ role: 'user' | 'assistant'; content: string }>;
}): string {
  const priorTurns = context.conversationContext
    ? context.conversationContext.map((t) => `${t.role}: ${t.content}`).join('\n')
    : '';

  return `You are a trusted assistant helping clarify an ambiguous user request before acting on it.

Current confidence in understanding the request: ${(context.orchestratorConfidence * 100).toFixed(0)}%.
Dimensions that need clarification: ${context.ambiguityDimensions.join(', ')}.

${priorTurns ? `Prior conversation:\n${priorTurns}\n\n` : ''}User's request: "${context.briefText}"

Draft up to 5 ranked questions that would most reduce ambiguity. Prioritise by impact.
Questions must be respectful, not gatekeeping — they signal genuine uncertainty.

Respond with JSON only:
{
  "questions": [
    {
      "question": "...",  // ≤ 140 chars
      "rationale": "...",
      "ambiguityDimension": "scope|target|action|timing|content|other",
      "suggestedAnswers": ["..."]  // optional
    }
  ],
  "confidenceBefore": ${context.orchestratorConfidence},
  "expectedConfidenceAfter": <float 0.0-1.0, must be > confidenceBefore>
}`;
}

/**
 * Parses raw LLM output into a ClarifyingQuestionsPayload.
 * Throws if output is invalid after validation.
 */
export function parseClarifyingQuestionsOutput(raw: string): ClarifyingQuestionsPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`ask_clarifying_questions: LLM output is not valid JSON`);
  }

  const validation = validateClarifyingQuestionsOutput(parsed);
  if (!validation.valid) {
    throw new Error(`ask_clarifying_questions: invalid output — ${validation.errors.join('; ')}`);
  }

  return parsed as ClarifyingQuestionsPayload;
}
