/**
 * artefactFilenameSanitiserPure.ts — Pure filename sanitiser for S3 artefact uploads.
 *
 * Spec §8.4 (SANDBOX-ADV-4.2).
 *
 * No imports — this is a pure function over a string.
 */

export type SanitisedFilename =
  | { ok: true; sanitisedName: string }
  | { ok: false; reason: 'contains_path_traversal' | 'absolute_path' | 'disallowed_chars' | 'empty' };

/** Allow-list: alphanum, dot, dash, underscore, space. */
const ALLOWED_CHARS_RE = /^[A-Za-z0-9 ._-]+$/;

/**
 * Validates that the given filename is safe to use as a flat S3 object key
 * under /workspace/artefacts/. Returns a discriminated union — never throws.
 *
 * Checks (in order):
 *   1. empty string
 *   2. absolute path (leading /)
 *   3. path traversal or nested path (.. or / after backslash→slash normalisation)
 *   4. disallowed characters (anything outside alphanum, dot, dash, underscore, space)
 */
export function sanitiseArtefactFilename(raw: string): SanitisedFilename {
  if (raw === '') {
    return { ok: false, reason: 'empty' };
  }

  if (raw.startsWith('/')) {
    return { ok: false, reason: 'absolute_path' };
  }

  // Normalise backslashes to forward slashes before traversal checks.
  const normalised = raw.replace(/\\/g, '/');

  if (normalised.includes('..') || normalised.includes('/')) {
    return { ok: false, reason: 'contains_path_traversal' };
  }

  if (!ALLOWED_CHARS_RE.test(raw)) {
    return { ok: false, reason: 'disallowed_chars' };
  }

  return { ok: true, sanitisedName: raw };
}
