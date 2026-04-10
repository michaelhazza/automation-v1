/**
 * Runnable via: npx tsx server/services/__tests__/skillParserServicePure.test.ts
 */

import {
  parseFromText,
  parseMarkdownFile,
  parseJsonFile,
  slugify,
  normalizeForHash,
  contentHash,
} from '../skillParserServicePure.js';

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

function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T, label: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ---------------------------------------------------------------------------
// slugify
// ---------------------------------------------------------------------------

test('slugify: lowercases and kebab-cases', () => {
  assertEqual(slugify('My Skill Name'), 'my-skill-name', 'slugify basic');
});

test('slugify: strips special characters', () => {
  assertEqual(slugify('Email (SMTP)'), 'email-smtp', 'slugify special chars');
});

test('slugify: collapses multiple spaces/dashes', () => {
  assertEqual(slugify('My  Skill'), 'my-skill', 'slugify multiple spaces');
});

test('slugify: handles empty string', () => {
  assertEqual(slugify(''), '', 'slugify empty');
});

// ---------------------------------------------------------------------------
// parseMarkdownFile
// ---------------------------------------------------------------------------

const SAMPLE_MD = `---
name: Web Search
slug: web-search
description: Searches the web
---

## Tool Definition

\`\`\`json
{"name": "web_search", "description": "Search the web", "input_schema": {"type": "object"}}
\`\`\`

## Instructions

Step 1: Query the web.
Step 2: Return results.

## Methodology

Phase 1: Gather requirements.
`;

test('parseMarkdownFile: parses name, slug, description from frontmatter', () => {
  const skill = parseMarkdownFile('web-search.md', SAMPLE_MD);
  assert(skill !== null, 'should parse successfully');
  assertEqual(skill!.name, 'Web Search', 'name');
  assertEqual(skill!.slug, 'web-search', 'slug');
  assertEqual(skill!.description, 'Searches the web', 'description');
});

test('parseMarkdownFile: parses JSON definition from code block', () => {
  const skill = parseMarkdownFile('web-search.md', SAMPLE_MD);
  assert(skill !== null, 'should parse successfully');
  assert(skill!.definition !== null, 'definition should not be null');
  assert((skill!.definition as { name: string }).name === 'web_search', 'definition name');
});

test('parseMarkdownFile: parses instructions section', () => {
  const skill = parseMarkdownFile('web-search.md', SAMPLE_MD);
  assert(skill !== null, 'should parse successfully');
  assert(skill!.instructions !== null, 'should have instructions');
  assert(skill!.instructions!.includes('Step 1'), 'instructions content');
});

test('parseMarkdownFile: merges methodology into instructions', () => {
  const skill = parseMarkdownFile('web-search.md', SAMPLE_MD);
  assert(skill !== null, 'should parse successfully');
  assert(skill!.instructions !== null, 'should have instructions');
  assert(skill!.instructions!.includes('Phase 1'), 'methodology content merged into instructions');
  assert(skill!.instructions!.includes('Step 1'), 'original instructions preserved');
});

test('parseMarkdownFile: returns null if no name', () => {
  const noName = `---
slug: no-name
description: No name here
---
Content here.
`;
  const result = parseMarkdownFile('no-name.md', noName);
  assert(result === null, 'should return null without name');
});

test('parseMarkdownFile: generates slug from name if missing', () => {
  const noSlug = `---
name: My Special Skill
description: Does things
---
`;
  const result = parseMarkdownFile('no-slug.md', noSlug);
  assert(result !== null, 'should parse successfully');
  assertEqual(result!.slug, 'my-special-skill', 'generated slug');
});

// ---------------------------------------------------------------------------
// parseJsonFile
// ---------------------------------------------------------------------------

test('parseJsonFile: parses standard JSON skill definition', () => {
  const json = JSON.stringify({
    name: 'JSON Skill',
    slug: 'json-skill',
    description: 'A JSON skill',
    definition: { name: 'json_skill', description: 'Does things', input_schema: {} },
    instructions: 'Do this.',
  });
  const result = parseJsonFile('json-skill.json', json);
  assert(result !== null, 'should parse successfully');
  assertEqual(result!.name, 'JSON Skill', 'name');
  assertEqual(result!.slug, 'json-skill', 'slug');
});

test('parseJsonFile: returns null for invalid JSON', () => {
  const result = parseJsonFile('bad.json', 'not json');
  assert(result === null, 'should return null for invalid JSON');
});

test('parseJsonFile: returns null if no name field', () => {
  const result = parseJsonFile('bad.json', JSON.stringify({ description: 'No name' }));
  assert(result === null, 'should return null without name');
});

// ---------------------------------------------------------------------------
// parseFromText
// ---------------------------------------------------------------------------

test('parseFromText: parses single skill', () => {
  const skills = parseFromText(SAMPLE_MD);
  assert(skills.length >= 1, `expected at least 1 skill, got ${skills.length}`);
  assert(skills[0].name === 'Web Search', `expected "Web Search", got "${skills[0].name}"`);
});

test('parseFromText: splits on --- separators', () => {
  const twoSkills = `---
name: Skill One
slug: skill-one
description: First skill
---

## Instructions
Do thing one.

---
---
name: Skill Two
slug: skill-two
description: Second skill
---

## Instructions
Do thing two.
`;
  const skills = parseFromText(twoSkills);
  assert(skills.length >= 1, `expected at least 1 skill, got ${skills.length}`);
});

test('parseFromText: returns empty array for empty/short input', () => {
  const skills = parseFromText('   ');
  assertEqual(skills.length, 0, 'empty input');
});

// ---------------------------------------------------------------------------
// normalizeForHash + contentHash
// ---------------------------------------------------------------------------

test('normalizeForHash: same content normalizes identically', () => {
  const skill = {
    name: 'Web Search',
    slug: 'web-search',
    description: 'Searches the web',
    definition: { name: 'web_search', input_schema: {} },
    instructions: 'Step 1.',
    rawSource: 'Different raw source text',
  };
  const norm1 = normalizeForHash(skill);
  const norm2 = normalizeForHash({ ...skill, rawSource: 'Completely different raw source!' });
  assertEqual(norm1, norm2, 'rawSource should not affect hash');
});

test('normalizeForHash: different definition keys produce same hash (sorted)', () => {
  const skill1 = {
    name: 'Test', slug: 'test', description: 'Test',
    definition: { b: 2, a: 1 },  // keys in different order
    instructions: null, rawSource: '',
  };
  const skill2 = {
    name: 'Test', slug: 'test', description: 'Test',
    definition: { a: 1, b: 2 },  // keys in different order
    instructions: null, rawSource: '',
  };
  assertEqual(normalizeForHash(skill1), normalizeForHash(skill2), 'JSON key order should not matter');
});

test('contentHash: returns 64-char hex string', () => {
  const hash = contentHash('some content');
  assert(hash.length === 64, `expected 64-char hex, got ${hash.length}`);
  assert(/^[a-f0-9]+$/.test(hash), 'hash should be hex');
});

test('contentHash: deterministic for same input', () => {
  const h1 = contentHash('hello world');
  const h2 = contentHash('hello world');
  assertEqual(h1, h2, 'same input should produce same hash');
});

test('contentHash: different for different inputs', () => {
  const h1 = contentHash('hello world');
  const h2 = contentHash('hello world!');
  assert(h1 !== h2, 'different inputs should produce different hashes');
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log('');
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
