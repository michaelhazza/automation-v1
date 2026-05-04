// Pure validation helper for investigate_prompt text.
// Per spec §9.8 — all rules are stateless so this module is trivially testable.

const MIN_LENGTH = 200;
const MAX_LENGTH = 6_000;

// Required headings must be present, in this order.
const REQUIRED_HEADINGS = [
  '## Protocol',
  '## Incident',
  '## Problem statement',
  '## Evidence',
  '## Hypothesis',
  '## Investigation steps',
  '## Scope',
  '## Expected output',
  '## Approval gate',
];

// Forbidden instruction patterns — any match rejects the prompt.
const FORBIDDEN_PATTERNS = [
  /git push/i,
  /merge to main/i,
  /auto-deploy/i,
];

export interface ValidationError {
  code: 'TOO_SHORT' | 'TOO_LONG' | 'MISSING_SECTION' | 'FORBIDDEN_PATTERN';
  detail: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

export function validateInvestigatePrompt(text: string): ValidationResult {
  const errors: ValidationError[] = [];

  if (text.length < MIN_LENGTH) {
    errors.push({ code: 'TOO_SHORT', detail: `Prompt is ${text.length} chars; minimum is ${MIN_LENGTH}.` });
  }

  if (text.length > MAX_LENGTH) {
    errors.push({ code: 'TOO_LONG', detail: `Prompt is ${text.length} chars; maximum is ${MAX_LENGTH}.` });
  }

  // Verify each required heading is present and appears in order.
  let searchFrom = 0;
  for (const heading of REQUIRED_HEADINGS) {
    const idx = text.indexOf(heading, searchFrom);
    if (idx === -1) {
      errors.push({ code: 'MISSING_SECTION', detail: `Required section '${heading}' is absent or out of order.` });
    } else {
      searchFrom = idx + heading.length;
    }
  }

  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(text)) {
      errors.push({ code: 'FORBIDDEN_PATTERN', detail: `Prompt contains forbidden pattern: ${pattern.source}` });
    }
  }

  return { valid: errors.length === 0, errors };
}
