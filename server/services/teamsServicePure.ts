/**
 * server/services/teamsServicePure.ts
 *
 * Pure helpers for the teams service. No I/O, no DB imports.
 */

// ─── assertTeamNameValid ──────────────────────────────────────────────────────

export type TeamNameValidResult =
  | { ok: true }
  | { ok: false; reason: 'too_short' | 'too_long' | 'invalid_chars' };

const MIN_LENGTH = 1;
const MAX_LENGTH = 64;

/**
 * Validates a team name:
 *   - 1..64 characters
 *   - no leading or trailing whitespace
 */
export function assertTeamNameValid(name: string): TeamNameValidResult {
  if (typeof name !== 'string') {
    return { ok: false, reason: 'too_short' };
  }

  // Leading or trailing whitespace is treated as invalid chars
  if (name !== name.trim()) {
    return { ok: false, reason: 'invalid_chars' };
  }

  if (name.length < MIN_LENGTH) {
    return { ok: false, reason: 'too_short' };
  }

  if (name.length > MAX_LENGTH) {
    return { ok: false, reason: 'too_long' };
  }

  return { ok: true };
}
