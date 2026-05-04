/**
 * chatgpt-reviewPure.test.ts
 *
 * Pure-function tests for the ChatGPT review CLI helpers.
 * Run via: npx tsx scripts/__tests__/chatgpt-reviewPure.test.ts
 */

import { expect, test } from 'vitest';
import {
  buildInputSummary,
  countFilesChangedInDiff,
  deriveVerdictFromFindings,
  normaliseFinding,
  parseModelOutput,
  stripJsonFence,
  type Finding,
} from '../chatgpt-reviewPure.js';

function eq<T>(actual: T, expected: T, label: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  expect(a === e, `${label}: expected ${e}, got ${a}`).toBeTruthy();
}

// --- countFilesChangedInDiff ---

test('countFilesChangedInDiff returns 0 for empty input', () => {
  eq(countFilesChangedInDiff(''), 0, 'count');
});

test('countFilesChangedInDiff counts a single-file diff', () => {
  const diff =
    'diff --git a/src/foo.ts b/src/foo.ts\nindex 1234..5678 100644\n--- a/src/foo.ts\n+++ b/src/foo.ts\n@@ -1 +1 @@\n-old\n+new';
  eq(countFilesChangedInDiff(diff), 1, 'count');
});

test('countFilesChangedInDiff counts multiple files', () => {
  const diff =
    'diff --git a/src/a.ts b/src/a.ts\n@@ -1 +1 @@\n-x\n+y\n' +
    'diff --git a/src/b.ts b/src/b.ts\n@@ -1 +1 @@\n-x\n+y\n' +
    'diff --git a/README.md b/README.md\n@@ -1 +1 @@\n-x\n+y\n';
  eq(countFilesChangedInDiff(diff), 3, 'count');
});

test('countFilesChangedInDiff handles paths with spaces and dashes', () => {
  const diff =
    'diff --git a/path with-spaces/x.ts b/path with-spaces/x.ts\n@@ -1 +1 @@\n-x\n+y\n';
  eq(countFilesChangedInDiff(diff), 1, 'count');
});

// --- buildInputSummary ---

test('buildInputSummary pr mode populates files_changed and nulls spec_path', () => {
  const diff = 'diff --git a/x b/x\n';
  const summary = buildInputSummary('pr', diff, { branch: 'feature/foo' });
  eq(summary, { branch: 'feature/foo', spec_path: null, files_changed: 1 }, 'summary');
});

test('buildInputSummary spec mode populates spec_path and nulls files_changed', () => {
  const summary = buildInputSummary('spec', '# Spec', {
    branch: 'feature/foo',
    specPath: 'docs/x.md',
  });
  eq(
    summary,
    { branch: 'feature/foo', spec_path: 'docs/x.md', files_changed: null },
    'summary',
  );
});

test('buildInputSummary defaults branch and spec_path to null when omitted', () => {
  const summary = buildInputSummary('pr', '', {});
  eq(summary, { branch: null, spec_path: null, files_changed: 0 }, 'summary');
});

// --- normaliseFinding ---

test('normaliseFinding returns null for non-objects', () => {
  expect(normaliseFinding(null, 0) === null, 'null').toBeTruthy();
  expect(normaliseFinding('string', 0) === null, 'string').toBeTruthy();
  expect(normaliseFinding(42, 0) === null, 'number').toBeTruthy();
});

test('normaliseFinding drops findings without a title', () => {
  expect(normaliseFinding({ title: '' }, 0) === null, 'empty title').toBeTruthy();
  expect(normaliseFinding({}, 0) === null, 'no title').toBeTruthy();
});

test('normaliseFinding accepts a fully-valid finding verbatim', () => {
  const raw = {
    id: 'f-007',
    title: 'NPE risk on user.email',
    severity: 'high',
    category: 'bug',
    finding_type: 'null_check',
    rationale: 'No guard before access',
    evidence: 'server/services/userService.ts:42',
  };
  const f = normaliseFinding(raw, 6);
  expect(f !== null, 'not null').toBeTruthy();
  eq(f as Finding, raw as Finding, 'finding');
});

test('normaliseFinding regenerates id when missing', () => {
  const f = normaliseFinding({ title: 'x' }, 4);
  expect(f !== null, 'not null').toBeTruthy();
  eq((f as Finding).id, 'f-005', 'id');
});

test('normaliseFinding falls back unknown enums to safe defaults', () => {
  const f = normaliseFinding(
    {
      title: 'x',
      severity: 'extreme',
      category: 'cosmic',
      finding_type: 'gibberish',
      rationale: '',
      evidence: '',
    },
    0,
  );
  expect(f !== null, 'not null').toBeTruthy();
  eq((f as Finding).severity, 'medium', 'severity default');
  eq((f as Finding).category, 'improvement', 'category default');
  eq((f as Finding).finding_type, 'other', 'finding_type default');
});

// --- parseModelOutput ---

test('parseModelOutput throws on non-objects', () => {
  let threw = false;
  try {
    parseModelOutput(null);
  } catch {
    threw = true;
  }
  expect(threw, 'should throw').toBeTruthy();
});

test('parseModelOutput accepts well-formed model JSON', () => {
  const raw = {
    findings: [
      {
        id: 'f-001',
        title: 'oops',
        severity: 'critical',
        category: 'bug',
        finding_type: 'security',
        rationale: 'leak',
        evidence: 'server/x.ts:1',
      },
    ],
    verdict: 'CHANGES_REQUESTED',
  };
  const result = parseModelOutput(raw);
  eq(result.findings.length, 1, 'findings count');
  eq(result.verdict, 'CHANGES_REQUESTED', 'verdict');
});

test('parseModelOutput drops malformed findings without aborting', () => {
  const raw = {
    findings: [
      { title: 'good' },
      null,
      { title: '' },
      'string',
      { title: 'also-good', severity: 'low' },
    ],
    verdict: 'APPROVED',
  };
  const result = parseModelOutput(raw);
  eq(result.findings.length, 2, 'findings kept');
  eq(result.findings[0].id, 'f-001', 'first id');
  eq(result.findings[1].id, 'f-005', 'second id keeps original index');
});

test('parseModelOutput derives verdict when missing', () => {
  const raw = {
    findings: [{ title: 'x', severity: 'high' }],
  };
  const result = parseModelOutput(raw);
  eq(result.verdict, 'CHANGES_REQUESTED', 'derived verdict');
});

test('parseModelOutput derives APPROVED for low/medium-only findings', () => {
  const raw = {
    findings: [{ title: 'x', severity: 'medium' }, { title: 'y', severity: 'low' }],
    verdict: 'NOT_VALID',
  };
  const result = parseModelOutput(raw);
  eq(result.verdict, 'APPROVED', 'derived verdict');
});

// --- deriveVerdictFromFindings ---

test('deriveVerdictFromFindings APPROVED for empty list', () => {
  eq(deriveVerdictFromFindings([]), 'APPROVED', 'empty');
});

test('deriveVerdictFromFindings CHANGES_REQUESTED for any high/critical', () => {
  const findings: Finding[] = [
    {
      id: 'f-001',
      title: 'x',
      severity: 'high',
      category: 'bug',
      finding_type: 'other',
      rationale: '',
      evidence: '',
    },
  ];
  eq(deriveVerdictFromFindings(findings), 'CHANGES_REQUESTED', 'high');
});

// --- stripJsonFence ---

test('stripJsonFence returns input unchanged when no fence', () => {
  eq(stripJsonFence('{"a": 1}'), '{"a": 1}', 'no fence');
});

test('stripJsonFence strips ```json fences', () => {
  eq(stripJsonFence('```json\n{"a": 1}\n```'), '{"a": 1}', 'json fence');
});

test('stripJsonFence strips bare ``` fences', () => {
  eq(stripJsonFence('```\n{"a": 1}\n```'), '{"a": 1}', 'bare fence');
});

test('stripJsonFence trims surrounding whitespace', () => {
  eq(stripJsonFence('   \n```json\n{"a": 1}\n```\n  '), '{"a": 1}', 'trim');
});

// --- summary ---