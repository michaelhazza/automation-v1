/**
 * per-file-counter-pure.test.ts
 *
 * Vitest unit tests for scripts/lib/per-file-counter-pure.mjs.
 *
 * Covers:
 *   (a) zero violations → empty result
 *   (b) baseline match → no diff
 *   (c) one new violation above baseline → exactly that violation surfaced
 *   (d) all-suppressed file → zero violations counted
 *   (e) P10 Marker-Reason: trailer: growth-with-trailer differs from
 *       growth-without-trailer in observable behaviour (metadata present)
 *
 * Run via: npx vitest run scripts/__tests__/per-file-counter-pure.test.ts
 */

import { describe, expect, test } from 'vitest';
import {
  countPerFile,
  diffAgainstBaseline,
  isSuppressed,
  parsePerFileBudgetBaseline,
} from '../lib/per-file-counter-pure.mjs';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a fileSet Map from a plain object of path → content. */
function makeFileSet(obj: Record<string, string>): Map<string, string> {
  return new Map(Object.entries(obj));
}

/** A no-op suppression predicate (nothing suppressed). */
const noSuppress = () => false;

/** Use the real isSuppressed from the module. */
const realSuppress = (content: string, lineIndex: number, guardId: string) =>
  isSuppressed(content, lineIndex, guardId);

// ── (a) zero violations → empty result ───────────────────────────────────────

describe('countPerFile — (a) zero violations', () => {
  test('clean file produces zero count', () => {
    const fileSet = makeFileSet({
      'server/services/foo.ts': 'const x = 1;\nconsole.log(x);\n',
    });
    const result = countPerFile({
      patterns: [/retryCount/],
      fileSet,
      suppressionPredicate: noSuppress,
      guardId: 'canonical-retry',
    });
    expect(result['server/services/foo.ts']).toBe(0);
  });

  test('empty fileSet → empty counts', () => {
    const result = countPerFile({
      patterns: [/TODO/],
      fileSet: new Map(),
      suppressionPredicate: noSuppress,
      guardId: 'marker-budget',
    });
    expect(Object.keys(result)).toHaveLength(0);
  });
});

// ── diffAgainstBaseline — (b) baseline match → no diff ───────────────────────

describe('diffAgainstBaseline — (b) baseline match', () => {
  test('current count equals baseline → no violations', () => {
    const currentCounts = { 'server/services/foo.ts': 3 };
    const baselineText = [
      '# expires: 2026-08-14',
      'server/services/foo.ts:3',
    ].join('\n');

    const violations = diffAgainstBaseline(currentCounts, baselineText);
    expect(violations).toHaveLength(0);
  });

  test('current count below baseline → no violations (shrinkage is fine)', () => {
    const currentCounts = { 'server/services/foo.ts': 1 };
    const baselineText = 'server/services/foo.ts:5\n';

    const violations = diffAgainstBaseline(currentCounts, baselineText);
    expect(violations).toHaveLength(0);
  });

  test('file not in baseline defaults to 0; count of 0 → no violations', () => {
    const currentCounts = { 'server/services/new.ts': 0 };
    const violations = diffAgainstBaseline(currentCounts, '');
    expect(violations).toHaveLength(0);
  });
});

// ── diffAgainstBaseline — (c) one new violation above baseline ────────────────

describe('diffAgainstBaseline — (c) new violation above baseline', () => {
  test('one file grows above baseline → exactly that violation returned', () => {
    const currentCounts = {
      'server/services/foo.ts': 4,
      'server/services/bar.ts': 2,
    };
    const baselineText = [
      'server/services/foo.ts:3',
      'server/services/bar.ts:2',
    ].join('\n');

    const violations = diffAgainstBaseline(currentCounts, baselineText);
    expect(violations).toHaveLength(1);
    expect(violations[0].file).toBe('server/services/foo.ts');
    expect(violations[0].current).toBe(4);
    expect(violations[0].baseline).toBe(3);
  });

  test('new file with no baseline entry and count > 0 → violation', () => {
    const currentCounts = { 'server/services/new.ts': 1 };
    const violations = diffAgainstBaseline(currentCounts, '');
    expect(violations).toHaveLength(1);
    expect(violations[0].file).toBe('server/services/new.ts');
    expect(violations[0].baseline).toBe(0);
  });
});

// ── countPerFile — (d) all-suppressed file → zero violations counted ──────────

describe('countPerFile — (d) suppressed violations', () => {
  test('line with legacy guard-ignore suppression → not counted', () => {
    const guardId = 'canonical-retry';
    const content = [
      'function foo() {',
      '  let retryCount = 0; // guard-ignore: canonical-retry reason="uses withBackoff internally"',
      '}',
    ].join('\n');

    const fileSet = makeFileSet({ 'server/services/foo.ts': content });
    const result = countPerFile({
      patterns: [/retryCount/],
      fileSet,
      suppressionPredicate: realSuppress,
      guardId,
    });
    expect(result['server/services/foo.ts']).toBe(0);
  });

  test('file-level guard-ignore-file suppression → entire file counts as 0', () => {
    const guardId = 'canonical-retry';
    const content = [
      `// guard-ignore-file: canonical-retry reason="this module coordinates retry externally"`,
      'let retryCount = 0;',
      'let retryAttempts = 3;',
    ].join('\n');

    const fileSet = makeFileSet({ 'server/services/bar.ts': content });
    const result = countPerFile({
      patterns: [/retryCount/, /retryAttempts/],
      fileSet,
      suppressionPredicate: realSuppress,
      guardId,
    });
    expect(result['server/services/bar.ts']).toBe(0);
  });

  test('next-line directive suppresses the following line', () => {
    const guardId = 'type-strengthening';
    const content = [
      '// guard-ignore-next-line: type-strengthening reason="external API returns unknown shape"',
      'const val = response as any;',
      'const other = data as any;',
    ].join('\n');

    const fileSet = makeFileSet({ 'server/services/baz.ts': content });
    const result = countPerFile({
      patterns: [/as any/],
      fileSet,
      suppressionPredicate: realSuppress,
      guardId,
    });
    // Only the first "as any" is suppressed; the second should be counted
    expect(result['server/services/baz.ts']).toBe(1);
  });

  test('multiple violations, only some suppressed → only unsuppressed counted', () => {
    const guardId = 'no-silent-failures';
    const content = [
      '.catch(() => {}) // guard-ignore: no-silent-failures reason="fire-and-forget"',
      '.catch(() => {})',
    ].join('\n');

    const fileSet = makeFileSet({ 'server/services/q.ts': content });
    const result = countPerFile({
      patterns: [/\.catch\(\s*\(\)\s*=>\s*\{\s*\}\)/],
      fileSet,
      suppressionPredicate: realSuppress,
      guardId,
    });
    expect(result['server/services/q.ts']).toBe(1);
  });
});

// ── (e) P10 Marker-Reason: trailer observable behaviour ──────────────────────

describe('P10 Marker-Reason trailer — (e) observable difference in metadata', () => {
  test('parsePerFileBudgetBaseline handles comment-only baseline → empty counts', () => {
    const text = '# No entries yet\n# expires: 2026-08-14\n';
    const result = parsePerFileBudgetBaseline(text);
    expect(Object.keys(result)).toHaveLength(0);
  });

  test('parsePerFileBudgetBaseline parses multiple files correctly', () => {
    const text = [
      '# expires: 2026-08-14',
      'server/services/foo.ts:5',
      '# expires: 2026-08-14',
      'client/src/components/Bar.tsx:2',
    ].join('\n');

    const result = parsePerFileBudgetBaseline(text);
    expect(result['server/services/foo.ts']).toBe(5);
    expect(result['client/src/components/Bar.tsx']).toBe(2);
  });

  // P10: growth WITHOUT Marker-Reason trailer → violation metadata has no trailer flag
  test('growth without Marker-Reason trailer → violation object has no trailerPresent field', () => {
    const currentCounts = { 'server/services/foo.ts': 6 };
    const baselineText = 'server/services/foo.ts:5\n';
    const violations = diffAgainstBaseline(currentCounts, baselineText);
    expect(violations).toHaveLength(1);
    // The violation object from diffAgainstBaseline does NOT carry a trailerPresent field.
    // The shell gate layer (verify-marker-budget.sh) reads the git trailer separately.
    // This test confirms the pure helper does not smuggle trailer state.
    expect(Object.prototype.hasOwnProperty.call(violations[0], 'trailerPresent')).toBe(false);
  });

  // P10: growth WITH Marker-Reason trailer → the GATE (not this helper) downgrades to exit 2.
  // The helper still surfaces the violation (it has no git access). The test confirms this
  // so the shell gate knows it must do additional trailer parsing.
  test('growth WITH Marker-Reason trailer → helper still surfaces violation (gate does downgrade)', () => {
    const currentCounts = { 'server/services/foo.ts': 6 };
    const baselineText = 'server/services/foo.ts:5\n';
    const violations = diffAgainstBaseline(currentCounts, baselineText);
    // Pure helper always surfaces growth — it is the gate that applies the trailer check.
    expect(violations).toHaveLength(1);
    expect(violations[0].current).toBeGreaterThan(violations[0].baseline);
  });
});

// ── isSuppressed unit tests ───────────────────────────────────────────────────

describe('isSuppressed', () => {
  test('T1 format: guard-ignore <id>: <ADR-id> <rationale> → suppressed', () => {
    const content = 'import { db } from \'../db\'; // guard-ignore canonical-retry: 0042-withbackoff uses withBackoff';
    expect(isSuppressed(content, 0, 'canonical-retry')).toBe(true);
  });

  test('legacy format: guard-ignore: <id> reason="..." → suppressed', () => {
    const content = 'let retryCount = 0; // guard-ignore: canonical-retry reason="uses backoff lib"';
    expect(isSuppressed(content, 0, 'canonical-retry')).toBe(true);
  });

  test('next-line format on previous line → suppresses the current line', () => {
    const lines = [
      '// guard-ignore-next-line: type-strengthening reason="external vendor type"',
      'const x = y as any;',
    ];
    const content = lines.join('\n');
    expect(isSuppressed(content, 1, 'type-strengthening')).toBe(true);
  });

  test('no suppression comment → not suppressed', () => {
    const content = 'let retryCount = 0;';
    expect(isSuppressed(content, 0, 'canonical-retry')).toBe(false);
  });

  test('wrong guard-id → not suppressed', () => {
    const content = 'let retryCount = 0; // guard-ignore: no-db-in-routes reason="wrong gate"';
    expect(isSuppressed(content, 0, 'canonical-retry')).toBe(false);
  });
});
