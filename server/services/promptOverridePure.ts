const MAX_PROMPT_OVERRIDE_LENGTH = 500;
const FORBIDDEN_TOKENS_RE = /\{\{(inject|system|override|ignore|disregard)\}\}/i;

export function validatePromptOverride(override: string): { valid: true } | { valid: false; reason: string } {
  if (override.length > MAX_PROMPT_OVERRIDE_LENGTH) {
    return { valid: false, reason: `Prompt override exceeds ${MAX_PROMPT_OVERRIDE_LENGTH} character limit` };
  }
  if (FORBIDDEN_TOKENS_RE.test(override)) {
    return { valid: false, reason: 'Prompt override contains a forbidden injection token' };
  }
  return { valid: true };
}
