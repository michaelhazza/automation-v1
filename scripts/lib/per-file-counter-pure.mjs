/**
 * per-file-counter-pure.mjs
 *
 * Shared pure helper for per-file-count grep gates (P4, P5, P9, P10).
 *
 * Public API:
 *   countPerFile({ patterns, fileSet, suppressionPredicate })
 *     → Record<string, number>
 *
 *   diffAgainstBaseline(currentCounts, baselineText)
 *     → Violation[]
 *
 * No filesystem I/O in this module — callers pass file content and paths.
 * Used by verify-*.sh scripts via Node --input-type=module inline scripts.
 */

/**
 * @typedef {{ file: string, current: number, baseline: number }} Violation
 */

/**
 * Count regex pattern hits per file, after applying a suppression predicate.
 *
 * @param {{
 *   patterns: RegExp[],
 *   fileSet: Map<string, string>,
 *   suppressionPredicate: (fileContent: string, lineIndex: number, guardId: string) => boolean,
 *   guardId: string,
 * }} opts
 * @returns {Record<string, number>}
 */
export function countPerFile({ patterns, fileSet, suppressionPredicate, guardId }) {
  /** @type {Record<string, number>} */
  const counts = {};

  for (const [filePath, content] of fileSet) {
    const lines = content.split('\n');
    let count = 0;

    // Check file-level suppression: first line of file contains guard-ignore-file
    const firstLine = lines[0] ?? '';
    const fileSuppressionRe = new RegExp(
      `guard-ignore-file:\\s*${escapeRegex(guardId)}\\s+reason="[^"]+"`,
    );
    if (fileSuppressionRe.test(firstLine)) {
      counts[filePath] = 0;
      continue;
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const matches = patterns.some((p) => p.test(line));
      if (!matches) continue;

      // Check line-level suppression
      if (suppressionPredicate(content, i, guardId)) continue;

      count++;
    }

    counts[filePath] = count;
  }

  return counts;
}

/**
 * Diff current per-file counts against a baseline text (same format as
 * scripts/.gate-baselines/*.txt per-file budget files).
 *
 * Per-file budget baseline format (one entry per file with a count):
 *   # expires: YYYY-MM-DD
 *   <relative-path>:<count>
 *
 * A file whose current count EXCEEDS its baseline count is a violation.
 * Files not in the baseline default to 0 (no existing allowance).
 * Files in the baseline but not in currentCounts are ignored (shrinkage is fine).
 *
 * @param {Record<string, number>} currentCounts
 * @param {string} baselineText
 * @returns {Violation[]}
 */
export function diffAgainstBaseline(currentCounts, baselineText) {
  const baselineCounts = parsePerFileBudgetBaseline(baselineText);
  /** @type {Violation[]} */
  const violations = [];

  for (const [file, current] of Object.entries(currentCounts)) {
    const baseline = baselineCounts[file] ?? 0;
    if (current > baseline) {
      violations.push({ file, current, baseline });
    }
  }

  return violations;
}

/**
 * Parse a per-file budget baseline file.
 * Format per line (ignoring comment lines):
 *   <relative-path>:<count>
 *
 * @param {string} text
 * @returns {Record<string, number>}
 */
export function parsePerFileBudgetBaseline(text) {
  /** @type {Record<string, number>} */
  const result = {};

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;

    // Format: path/to/file.ts:42
    const colonIdx = line.lastIndexOf(':');
    if (colonIdx === -1) continue;

    const filePath = line.slice(0, colonIdx);
    const countStr = line.slice(colonIdx + 1);
    const count = parseInt(countStr, 10);
    if (filePath && !isNaN(count)) {
      result[filePath] = count;
    }
  }

  return result;
}

/**
 * Pure JS suppression predicate mirroring guard-utils.sh is_suppressed().
 *
 * Checks:
 *   1. Same line: T1 format  guard-ignore <id>: <ADR-dddd-slug> <rationale>
 *   2. Same line: legacy format  guard-ignore: <id> reason="..."
 *   3. Previous line: guard-ignore-next-line: <id> reason="..."
 *
 * @param {string} fileContent  Full file content (newline-separated)
 * @param {number} lineIndex    0-based line index of the violation line
 * @param {string} guardId      Guard identifier, e.g. "no-silent-failures"
 * @returns {boolean}
 */
export function isSuppressed(fileContent, lineIndex, guardId) {
  const lines = fileContent.split('\n');
  const currentLine = lines[lineIndex] ?? '';
  const id = escapeRegex(guardId);

  // T1 format: guard-ignore <guard-id>: <ADR-id matching \d{4}-[a-z0-9-]+> <rationale>
  if (new RegExp(`guard-ignore\\s+${id}:\\s+\\d{4}-[a-z0-9-]+\\s+\\S`).test(currentLine)) {
    return true;
  }

  // Legacy same-line format: guard-ignore: <id> reason="..."
  if (new RegExp(`guard-ignore:\\s*${id}\\s+reason="[^"]+"`) .test(currentLine)) {
    return true;
  }

  // Previous-line next-line directive
  if (lineIndex > 0) {
    const prevLine = lines[lineIndex - 1] ?? '';
    if (new RegExp(`guard-ignore-next-line:\\s*${id}\\s+reason="[^"]+"`) .test(prevLine)) {
      return true;
    }
  }

  return false;
}

/**
 * Escape a string for use in a RegExp.
 * @param {string} s
 * @returns {string}
 */
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
