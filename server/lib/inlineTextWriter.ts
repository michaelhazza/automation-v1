/**
 * Inline text writer with hard byte ceilings + UTF-8-safe truncation.
 *
 * Spec v3.4 §6.7.3 / T12. Used by `add_deliverable`, `transcribe_audio`, and
 * any other code path that persists user-/LLM-generated text into a
 * jsonb/text DB column.
 *
 * Rules:
 *  - Truncation NEVER silently fails: it always writes the truncated body,
 *    sets the `*_truncated` flag (caller's responsibility — surfaced via the
 *    `wasTruncated` return value), and emits a logger warning.
 *  - Truncation is UTF-8 safe: cuts at a byte boundary then backtracks to the
 *    last valid character boundary so multi-byte chars (emoji, accented
 *    letters, CJK) are never split mid-codepoint.
 *  - A short marker is appended after truncation (`\n\n…[truncated]`) which
 *    fits inside the reserved 100-byte headroom.
 *
 * The two known callers and their ceilings:
 *  - `execution_artifacts.inline_text` → 1 MB (1,048,576 bytes)
 *  - `task_deliverables.body_text`     → 2 MB (2,097,152 bytes)
 */

import { logger } from './logger.js';

export interface WriteWithLimitResult {
  /** The (possibly truncated) text safe to persist. Always valid UTF-8. */
  stored: string;
  /** True iff truncation occurred. Caller must set the `*_truncated` flag. */
  wasTruncated: boolean;
  /** Original UTF-8 byte length before truncation. */
  originalBytes: number;
  /** Final UTF-8 byte length after truncation. */
  storedBytes: number;
}

/**
 * Hard ceilings — exported for use in zod validation and tests so the
 * thresholds live in exactly one place.
 */
export const INLINE_TEXT_LIMITS = {
  ARTIFACT_INLINE_TEXT: 1 * 1024 * 1024,    // 1 MB
  DELIVERABLE_BODY_TEXT: 2 * 1024 * 1024,   // 2 MB
} as const;

const TRUNCATION_MARKER = '\n\n…[truncated]';
const TRUNCATION_MARKER_BYTES = Buffer.byteLength(TRUNCATION_MARKER, 'utf8');
const TRUNCATION_HEADROOM = 100; // bytes reserved for the marker + a margin

/**
 * Truncate `text` so its UTF-8 byte length is ≤ `maxBytes`. If truncation is
 * needed, the result is followed by `TRUNCATION_MARKER`. The cut is performed
 * on byte boundaries and then backtracked to the nearest valid UTF-8
 * character boundary so the output is always valid UTF-8.
 */
export function writeWithLimit(
  label: string,
  text: string,
  maxBytes: number,
): WriteWithLimitResult {
  const buf = Buffer.from(text, 'utf8');
  const originalBytes = buf.length;
  if (originalBytes <= maxBytes) {
    return { stored: text, wasTruncated: false, originalBytes, storedBytes: originalBytes };
  }

  // Cut at maxBytes - headroom, then backtrack to a UTF-8 char boundary.
  const targetBytes = Math.max(0, maxBytes - TRUNCATION_HEADROOM);
  let cut = targetBytes;
  // A UTF-8 continuation byte starts with bits 10xxxxxx (0x80..0xBF).
  // Backtrack while we're inside a multi-byte sequence.
  while (cut > 0 && (buf[cut] & 0xc0) === 0x80) {
    cut--;
  }
  const truncated = buf.subarray(0, cut).toString('utf8');
  const stored = truncated + TRUNCATION_MARKER;
  const storedBytes = Buffer.byteLength(stored, 'utf8');

  logger.warn(`inlineTextWriter.truncated`, {
    label,
    originalBytes,
    storedBytes,
    maxBytes,
  });

  return { stored, wasTruncated: true, originalBytes, storedBytes };
}
