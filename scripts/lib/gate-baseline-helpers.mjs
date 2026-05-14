/**
 * gate-baseline-helpers.mjs
 *
 * Pure-logic helpers for per-gate expiring baseline files.
 * Imported by check_expiring_baseline in scripts/lib/guard-utils.sh (via Node)
 * and by the Vitest harness at scripts/__tests__/gate-baseline-helpers.test.ts.
 *
 * All date comparisons use ISO 8601 string lexicographic ordering (YYYY-MM-DD)
 * which is valid for date-only strings and avoids timezone pitfalls.
 */

/**
 * @typedef {{ key: string, expires: string | null, error?: never }} BaselineEntry
 * @typedef {{ error: string, key?: never, expires?: never }} BaselineError
 */

/**
 * Parse a baseline file's text into an array of entries.
 *
 * Format:
 *   # expires: YYYY-MM-DD        ← preceding comment line (required per entry)
 *   <relative-path>:<line>:<msg> ← violation key line
 *   # any other comment is ignored
 *
 * Returns one result object per non-comment, non-blank line:
 *   { key: string, expires: string | null }  — valid entry
 *   { error: string }                         — malformed entry
 *
 * @param {string} text
 * @returns {Array<BaselineEntry | BaselineError>}
 */
export function parseBaselineFile(text) {
  const lines = text.split('\n');
  const results = [];
  let pendingExpiry = null;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();

    if (line === '') {
      // blank lines reset pending expiry to avoid associating it with the next entry
      pendingExpiry = null;
      continue;
    }

    if (line.startsWith('#')) {
      const expiryMatch = line.match(/^#\s*expires:\s*(\d{4}-\d{2}-\d{2})\s*$/);
      if (expiryMatch) {
        pendingExpiry = expiryMatch[1];
      }
      // other comment lines are ignored; pendingExpiry unchanged
      continue;
    }

    // Non-comment, non-blank line: treat as a violation key.
    // Must match <path>:<line-number>:<message>
    if (!/^[^:]+:\d+:.+$/.test(line)) {
      results.push({ error: `line ${i + 1}: expected "<path>:<lineno>:<msg>", got: ${JSON.stringify(line)}` });
      pendingExpiry = null;
      continue;
    }

    results.push({ key: line, expires: pendingExpiry });
    pendingExpiry = null;
  }

  return results;
}

/**
 * Returns true when the expiry date is today or in the past.
 *
 * @param {string} expiryDate  ISO date string "YYYY-MM-DD"
 * @param {string} today       ISO date string "YYYY-MM-DD"
 * @returns {boolean}
 */
export function isExpired(expiryDate, today) {
  return expiryDate <= today;
}

/**
 * Returns true when the expiry date is more than graceDays before today
 * (i.e. the entry has been expired long enough to promote from warning to error).
 *
 * @param {string} expiryDate  ISO date string "YYYY-MM-DD"
 * @param {string} today       ISO date string "YYYY-MM-DD"
 * @param {number} graceDays   number of days past expiry before promotion (default 30)
 * @returns {boolean}
 */
export function isPastGracePeriod(expiryDate, today, graceDays = 30) {
  // Compute the date that is graceDays after expiryDate using UTC arithmetic.
  const expiry = new Date(expiryDate + 'T00:00:00Z');
  const graceEnd = new Date(expiry.getTime() + graceDays * 86_400_000);
  const todayDate = new Date(today + 'T00:00:00Z');
  return todayDate > graceEnd;
}
