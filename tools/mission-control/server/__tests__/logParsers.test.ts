/**
 * logParsers.test.ts
 *
 * Pure-function tests for Mission Control's log parsers.
 * Run via: npx tsx tools/mission-control/server/__tests__/logParsers.test.ts
 */

import {
  convertFilenameTimestampToIso,
  extractActiveBuildSlugFromProse,
  parseCurrentFocusBlock,
  parseProgressMd,
  parseReviewLogFilename,
  parseVerdictFromLog,
  pickLatestLogForSlug,
} from '../lib/logParsers.js';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err instanceof Error ? err.message : err}`);
  }
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function eq<T>(actual: T, expected: T, label: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  assert(a === e, `${label}: expected ${e}, got ${a}`);
}

// --- parseReviewLogFilename ---

test('parseReviewLogFilename parses spec-conformance log', () => {
  const m = parseReviewLogFilename('spec-conformance-log-audit-remediation-2026-04-25T11-00-13Z.md');
  assert(m !== null, 'not null');
  eq(m!.kind, 'spec-conformance', 'kind');
  eq(m!.slug, 'audit-remediation', 'slug');
  eq(m!.timestampIso, '2026-04-25T11:00:13Z', 'iso');
});

test('parseReviewLogFilename parses pr-review log', () => {
  const m = parseReviewLogFilename('pr-review-log-feature-foo-2026-04-22T07-08-30Z.md');
  assert(m !== null, 'not null');
  eq(m!.kind, 'pr-review', 'kind');
  eq(m!.slug, 'feature-foo', 'slug');
});

test('parseReviewLogFilename parses spec-review-final before spec-review', () => {
  const m = parseReviewLogFilename(
    'spec-review-final-mission-control-2026-04-28T12-00-00Z.md',
  );
  assert(m !== null, 'not null');
  eq(m!.kind, 'spec-review-final', 'kind');
  eq(m!.slug, 'mission-control', 'slug');
});

test('parseReviewLogFilename parses chatgpt-pr-review log with mixed-case slug', () => {
  const m = parseReviewLogFilename(
    'chatgpt-pr-review-claude-add-system-monitoring-BgLlY-2026-04-27T08-01-07Z.md',
  );
  assert(m !== null, 'not null');
  eq(m!.kind, 'chatgpt-pr-review', 'kind');
  eq(m!.slug, 'claude-add-system-monitoring-BgLlY', 'slug');
});

test('parseReviewLogFilename parses adversarial-review log', () => {
  const m = parseReviewLogFilename('adversarial-review-log-feature-foo-2026-04-30T08-00-00Z.md');
  assert(m !== null, 'not null');
  eq(m!.kind, 'adversarial-review', 'kind');
  eq(m!.slug, 'feature-foo', 'slug');
  eq(m!.timestampIso, '2026-04-30T08:00:00Z', 'iso');
});

test('parseReviewLogFilename parses adversarial-review log with hyphenated slug', () => {
  const m = parseReviewLogFilename(
    'adversarial-review-log-agentic-engineering-notes-2026-04-30T09-15-22Z.md',
  );
  assert(m !== null, 'not null');
  eq(m!.kind, 'adversarial-review', 'kind');
  eq(m!.slug, 'agentic-engineering-notes', 'slug');
  eq(m!.timestampIso, '2026-04-30T09:15:22Z', 'iso');
});

test('parseReviewLogFilename returns null for non-conforming names', () => {
  assert(parseReviewLogFilename('readme.md') === null, 'readme');
  assert(parseReviewLogFilename('pr-review-log-2026-04-25T11-00-13Z.md') === null, 'no slug');
  assert(parseReviewLogFilename('weird-log-foo-2026-04-25T11-00-13Z.md') === null, 'unknown kind');
});

// --- convertFilenameTimestampToIso ---

test('convertFilenameTimestampToIso converts hyphenated time to ISO', () => {
  eq(convertFilenameTimestampToIso('2026-04-25T11-00-13Z'), '2026-04-25T11:00:13Z', 'iso');
});

// --- parseVerdictFromLog ---

test('parseVerdictFromLog extracts simple verdict line', () => {
  const log = 'header\n\n**Verdict:** APPROVED\n\nbody';
  eq(parseVerdictFromLog(log), 'APPROVED', 'verdict');
});

test('parseVerdictFromLog extracts verdict with trailing prose', () => {
  const log = '**Verdict:** CONFORMANT_AFTER_FIXES (1 mechanical gap closed; 4 directional items routed)\n';
  eq(parseVerdictFromLog(log), 'CONFORMANT_AFTER_FIXES', 'verdict');
});

test('parseVerdictFromLog returns null when absent', () => {
  eq(parseVerdictFromLog('no verdict here\nat all'), null, 'verdict');
});

test('parseVerdictFromLog ignores verdict line beyond first 30 lines', () => {
  const log = Array(31).fill('filler').join('\n') + '\n**Verdict:** APPROVED\n';
  eq(parseVerdictFromLog(log), null, 'verdict');
});

// --- parseCurrentFocusBlock ---

test('parseCurrentFocusBlock extracts all known fields', () => {
  const md = `<!-- mission-control
active_spec: docs/superpowers/specs/2026-04-28-spec.md
active_plan: tasks/builds/dev-mission-control/plan.md
build_slug: dev-mission-control
branch: claude/review-feature-workflow-c7Zij
status: BUILDING
last_updated: 2026-04-28
-->

# Current Focus
...`;
  const block = parseCurrentFocusBlock(md);
  assert(block !== null, 'not null');
  eq(block!.build_slug, 'dev-mission-control', 'slug');
  eq(block!.status, 'BUILDING', 'status');
  eq(block!.branch, 'claude/review-feature-workflow-c7Zij', 'branch');
  eq(block!.active_spec, 'docs/superpowers/specs/2026-04-28-spec.md', 'spec');
});

test('parseCurrentFocusBlock returns null when block missing', () => {
  eq(parseCurrentFocusBlock('# Current Focus\n\nProse only.'), null, 'block');
});

test('parseCurrentFocusBlock falls back to NONE for unknown status', () => {
  const md = `<!-- mission-control
build_slug: foo
status: GIBBERISH
-->`;
  const block = parseCurrentFocusBlock(md);
  assert(block !== null, 'not null');
  eq(block!.status, 'NONE', 'status default');
});

test('parseCurrentFocusBlock tolerates whitespace and partial fields', () => {
  const md = `<!-- mission-control
build_slug:    foo
branch:bar
-->`;
  const block = parseCurrentFocusBlock(md);
  assert(block !== null, 'not null');
  eq(block!.build_slug, 'foo', 'slug');
  eq(block!.branch, 'bar', 'branch');
  eq(block!.active_spec, null, 'spec absent');
});

// --- parseProgressMd ---

test('parseProgressMd counts checkbox completion and reads last_updated', () => {
  const md = `# Progress

**Status:** in flight
**Last updated:** 2026-04-26 (final-review close-out)

| Chunk | Status |
|---|---|
| Chunk 1 | [x] complete |
| Chunk 2 | [x] complete |
| Chunk 3 | [ ] pending |
`;
  const result = parseProgressMd(md, 'dev-mission-control');
  eq(result.build_slug, 'dev-mission-control', 'slug');
  eq(result.completed_chunks, 2, 'completed');
  eq(result.total_chunks, 3, 'total');
  eq(result.last_updated, '2026-04-26 (final-review close-out)', 'last_updated');
});

test('parseProgressMd returns null counts when no checkboxes', () => {
  const md = '**Last updated:** 2026-04-28';
  const result = parseProgressMd(md, 'foo');
  eq(result.completed_chunks, null, 'completed');
  eq(result.total_chunks, null, 'total');
  eq(result.last_updated, '2026-04-28', 'last_updated');
});

// --- extractActiveBuildSlugFromProse ---

test('extractActiveBuildSlugFromProse pulls slug from prose body', () => {
  const md = `# Current Focus

Some prose...

**Active build slug:** my-build-slug-foo

More prose.`;
  eq(extractActiveBuildSlugFromProse(md), 'my-build-slug-foo', 'slug');
});

test('extractActiveBuildSlugFromProse ignores the machine block build_slug', () => {
  const md = `<!-- mission-control
build_slug: block-slug
-->

# Current Focus

**Active build slug:** prose-slug`;
  eq(extractActiveBuildSlugFromProse(md), 'prose-slug', 'slug');
});

test('extractActiveBuildSlugFromProse returns null when no prose marker', () => {
  const md = `<!-- mission-control
build_slug: block-only
-->

# Current Focus

Just prose with no slug marker.`;
  eq(extractActiveBuildSlugFromProse(md), null, 'no prose slug');
});

// --- pickLatestLogForSlug ---

test('pickLatestLogForSlug picks the most recent across kinds', () => {
  const filenames = [
    'pr-review-log-foo-2026-04-25T11-00-13Z.md',
    'spec-conformance-log-foo-2026-04-26T11-00-13Z.md',
    'pr-review-log-bar-2026-04-27T11-00-13Z.md',
  ];
  const result = pickLatestLogForSlug(filenames, 'foo');
  assert(result !== null, 'not null');
  eq(result!.kind, 'spec-conformance', 'kind');
  eq(result!.timestampIso, '2026-04-26T11:00:13Z', 'iso');
});

test('pickLatestLogForSlug recognises chunk-slug suffix', () => {
  const filenames = [
    'pr-review-log-foo-chunk-a-2026-04-25T11-00-13Z.md',
    'pr-review-log-foo-2026-04-26T11-00-13Z.md',
  ];
  const result = pickLatestLogForSlug(filenames, 'foo');
  assert(result !== null, 'not null');
  eq(result!.timestampIso, '2026-04-26T11:00:13Z', 'picks newer');
});

test('pickLatestLogForSlug returns null when no slug match', () => {
  const filenames = ['pr-review-log-other-2026-04-25T11-00-13Z.md'];
  eq(pickLatestLogForSlug(filenames, 'foo'), null, 'null');
});

// --- summary ---

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
