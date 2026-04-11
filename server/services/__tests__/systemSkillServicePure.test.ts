/**
 * systemSkillServicePure.test.ts — Phase 0 of skill-analyzer-v2.
 *
 * Pure unit tests for the markdown parser extracted from the legacy
 * file-based systemSkillService. Covers frontmatter parsing, CRLF
 * normalisation, the legacy `isVisible` fallback, and the parser's
 * null-on-malformed contract.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/systemSkillServicePure.test.ts
 */

import { parseSkillFile, extractSection } from '../systemSkillServicePure.js';

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

function assertEq<T>(actual: T, expected: T, label: string) {
  if (actual !== expected) {
    throw new Error(`${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ---------------------------------------------------------------------------
// Sample skill bodies
// ---------------------------------------------------------------------------

const HAPPY_PATH_MD = `---
name: Web Search
description: Search the web for current information
isActive: true
visibility: basic
---

## Parameters

- query: string (required) — The search query to run

## Instructions

Use this tool to find current information on the web.
`;

const LEGACY_IS_VISIBLE_MD = `---
name: Legacy Skill
description: An older skill using the isVisible boolean
isActive: true
isVisible: true
---

## Parameters

- input: string (required) — Anything

## Instructions

Legacy instructions.
`;

const LEGACY_JSON_BLOCK_MD = `---
name: JSON Block Skill
description: Pre-Parameters-section format
isActive: true
visibility: full
---

## Tool

\`\`\`json
{
  "name": "json_block_skill",
  "description": "Pre-Parameters format",
  "input_schema": {
    "type": "object",
    "properties": { "x": { "type": "string" } },
    "required": ["x"]
  }
}
\`\`\`

## Instructions

Some instructions.
`;

const CRLF_MD = HAPPY_PATH_MD.replace(/\n/g, '\r\n');

const NO_FRONTMATTER_MD = `# Just a markdown file
No frontmatter here.
`;

const MALFORMED_JSON_MD = `---
name: Bad JSON
description: ...
isActive: true
---

\`\`\`json
{ this is not valid json
\`\`\`
`;

// ---------------------------------------------------------------------------
// extractSection
// ---------------------------------------------------------------------------

test('extractSection: returns content between heading and next heading', () => {
  const body = `## A\nfirst\n\n## B\nsecond\n`;
  assertEq(extractSection(body, 'A'), 'first', 'A section');
  assertEq(extractSection(body, 'B'), 'second', 'B section');
});

test('extractSection: returns null for missing heading', () => {
  const body = `## A\nfirst\n`;
  assertEq(extractSection(body, 'Z'), null, 'Z section');
});

test('extractSection: returns content to end of body when last heading', () => {
  const body = `## A\nfirst\n\n## B\nsecond line one\nsecond line two\n`;
  assertEq(extractSection(body, 'B'), 'second line one\nsecond line two', 'tail section');
});

// ---------------------------------------------------------------------------
// parseSkillFile — happy path
// ---------------------------------------------------------------------------

test('parseSkillFile: happy-path .md file with Parameters section', () => {
  const seed = parseSkillFile('web_search', HAPPY_PATH_MD);
  if (!seed) throw new Error('expected non-null seed');
  assertEq(seed.slug, 'web_search', 'slug');
  assertEq(seed.name, 'Web Search', 'name');
  assertEq(seed.description, 'Search the web for current information', 'description');
  assertEq(seed.isActive, true, 'isActive');
  assertEq(seed.visibility, 'basic', 'visibility');
  assertEq(seed.definition.name, 'web_search', 'definition.name');
  assertEq(seed.instructions, 'Use this tool to find current information on the web.', 'instructions');
});

test('parseSkillFile: legacy isVisible: true → visibility = full', () => {
  const seed = parseSkillFile('legacy_skill', LEGACY_IS_VISIBLE_MD);
  if (!seed) throw new Error('expected non-null seed');
  assertEq(seed.visibility, 'full', 'visibility');
});

test('parseSkillFile: legacy JSON code block format', () => {
  const seed = parseSkillFile('json_block_skill', LEGACY_JSON_BLOCK_MD);
  if (!seed) throw new Error('expected non-null seed');
  assertEq(seed.definition.name, 'json_block_skill', 'definition.name');
  assertEq(seed.visibility, 'full', 'visibility');
});

test('parseSkillFile: CRLF normalisation', () => {
  const seed = parseSkillFile('web_search', CRLF_MD);
  if (!seed) throw new Error('expected non-null seed');
  assertEq(seed.name, 'Web Search', 'name');
  assertEq(seed.visibility, 'basic', 'visibility');
});

test('parseSkillFile: missing frontmatter → null', () => {
  const seed = parseSkillFile('no_frontmatter', NO_FRONTMATTER_MD);
  assertEq(seed, null, 'expected null for missing frontmatter');
});

test('parseSkillFile: malformed JSON code block → null', () => {
  const seed = parseSkillFile('bad_json', MALFORMED_JSON_MD);
  assertEq(seed, null, 'expected null for malformed JSON');
});

test('parseSkillFile: visibility defaults to none when frontmatter omits both keys', () => {
  const md = `---
name: No Visibility
description: Has neither visibility nor isVisible
isActive: true
---

## Parameters

- x: string (required) — anything

## Instructions

Hello.
`;
  const seed = parseSkillFile('no_vis', md);
  if (!seed) throw new Error('expected non-null seed');
  assertEq(seed.visibility, 'none', 'visibility default');
});

test('parseSkillFile: isActive: false respected', () => {
  const md = HAPPY_PATH_MD.replace('isActive: true', 'isActive: false');
  const seed = parseSkillFile('web_search', md);
  if (!seed) throw new Error('expected non-null seed');
  assertEq(seed.isActive, false, 'isActive');
});

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

console.log('');
console.log(`systemSkillServicePure: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
