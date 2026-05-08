/** Patterns that indicate fake/vague progress copy — must be rejected */
const FORBIDDEN_PATTERNS = [
  /\bthinking\b/i,
  /\banalysing\s+data\b/i,
  /\banalyzing\s+data\b/i,
  /\bworking\s+on\s+task\b/i,
  /\breasoning\s+about\b/i,
  /\bpreparing\b/i,
  /\bprocessing\b/i,
];

export interface ValidateCurrentFocusResult {
  ok: boolean;
  reason?: string;
}

/**
 * Validates current focus text against the anti-fake-progress rules.
 * Rejects:
 * - Explicit forbidden patterns (Thinking, Analysing data, etc.)
 * - Empty strings
 */
export function validateCurrentFocus(text: string): ValidateCurrentFocusResult {
  if (!text || text.trim().length === 0) {
    return { ok: false, reason: 'focus text is empty' };
  }

  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(text)) {
      return { ok: false, reason: `forbidden pattern matched: ${pattern.source}` };
    }
  }

  return { ok: true };
}

/**
 * Returns the stale-state fallback copy for the focus line when the current
 * focus cannot be determined or is too old.
 */
export function buildStaleFallbackFocus(ageMs: number): string {
  const ageMinutes = Math.floor(ageMs / 60_000);
  if (ageMinutes < 1) return 'No recent activity (last event <1m ago)';
  return `No recent activity (last event ${ageMinutes}m ago)`;
}
