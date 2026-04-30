/**
 * Runnable via: npx tsx server/services/__tests__/skillParserServicePure.test.ts
 */

import { expect, test } from 'vitest';
import {
  parseFromText,
  parseMarkdownFile,
  parseJsonFile,
  slugify,
  normalizeForHash,
  contentHash,
} from '../skillParserServicePure.js';

function assertEqual<T>(actual: T, expected: T, label: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ---------------------------------------------------------------------------
// slugify
// ---------------------------------------------------------------------------

test('slugify: lowercases and kebab-cases', () => {
  expect(slugify('My Skill Name'), 'slugify basic').toBe('my-skill-name');
});

test('slugify: strips special characters', () => {
  expect(slugify('Email (SMTP)'), 'slugify special chars').toBe('email-smtp');
});

test('slugify: collapses multiple spaces/dashes', () => {
  expect(slugify('My  Skill'), 'slugify multiple spaces').toBe('my-skill');
});

test('slugify: handles empty string', () => {
  expect(slugify(''), 'slugify empty').toBe('');
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
  expect(skill !== null, 'should parse successfully').toBeTruthy();
  expect(skill!.name, 'name').toBe('Web Search');
  expect(skill!.slug, 'slug').toBe('web-search');
  expect(skill!.description, 'description').toBe('Searches the web');
});

test('parseMarkdownFile: parses JSON definition from code block', () => {
  const skill = parseMarkdownFile('web-search.md', SAMPLE_MD);
  expect(skill !== null, 'should parse successfully').toBeTruthy();
  expect(skill!.definition !== null, 'definition should not be null').toBeTruthy();
  expect((skill!.definition as { name: string }).name === 'web_search', 'definition name').toBeTruthy();
});

test('parseMarkdownFile: parses instructions section', () => {
  const skill = parseMarkdownFile('web-search.md', SAMPLE_MD);
  expect(skill !== null, 'should parse successfully').toBeTruthy();
  expect(skill!.instructions !== null, 'should have instructions').toBeTruthy();
  expect(skill!.instructions!.includes('Step 1'), 'instructions content').toBeTruthy();
});

test('parseMarkdownFile: merges methodology into instructions', () => {
  const skill = parseMarkdownFile('web-search.md', SAMPLE_MD);
  expect(skill !== null, 'should parse successfully').toBeTruthy();
  expect(skill!.instructions !== null, 'should have instructions').toBeTruthy();
  expect(skill!.instructions!.includes('Phase 1'), 'methodology content merged into instructions').toBeTruthy();
  expect(skill!.instructions!.includes('Step 1'), 'original instructions preserved').toBeTruthy();
});

test('parseMarkdownFile: returns null if no name', () => {
  const noName = `---
slug: no-name
description: No name here
---
Content here.
`;
  const result = parseMarkdownFile('no-name.md', noName);
  expect(result === null, 'should return null without name').toBeTruthy();
});

test('parseMarkdownFile: generates slug from name if missing', () => {
  const noSlug = `---
name: My Special Skill
description: Does things
---
`;
  const result = parseMarkdownFile('no-slug.md', noSlug);
  expect(result !== null, 'should parse successfully').toBeTruthy();
  expect(result!.slug, 'generated slug').toBe('my-special-skill');
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
  expect(result !== null, 'should parse successfully').toBeTruthy();
  expect(result!.name, 'name').toBe('JSON Skill');
  expect(result!.slug, 'slug').toBe('json-skill');
});

test('parseJsonFile: returns null for invalid JSON', () => {
  const result = parseJsonFile('bad.json', 'not json');
  expect(result === null, 'should return null for invalid JSON').toBeTruthy();
});

test('parseJsonFile: returns null if no name field', () => {
  const result = parseJsonFile('bad.json', JSON.stringify({ description: 'No name' }));
  expect(result === null, 'should return null without name').toBeTruthy();
});

// ---------------------------------------------------------------------------
// parseFromText
// ---------------------------------------------------------------------------

test('parseFromText: parses single skill', () => {
  const skills = parseFromText(SAMPLE_MD);
  expect(skills.length >= 1, `expected at least 1 skill, got ${skills.length}`).toBeTruthy();
  expect(skills[0].name === 'Web Search', `expected "Web Search", got "${skills[0].name}"`).toBeTruthy();
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
  expect(skills.length === 2, `expected exactly 2 skills, got ${skills.length}`).toBeTruthy();
  expect(skills[0].name === 'Skill One', `expected first skill "Skill One", got "${skills[0].name}"`).toBeTruthy();
  expect(skills[1].name === 'Skill Two', `expected second skill "Skill Two", got "${skills[1].name}"`).toBeTruthy();
});

test('parseFromText: returns empty array for empty/short input', () => {
  const skills = parseFromText('   ');
  expect(skills.length, 'empty input').toBe(0);
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
  expect(norm1, 'rawSource should not affect hash').toEqual(norm2);
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
  expect(normalizeForHash(skill1), 'JSON key order should not matter').toEqual(normalizeForHash(skill2));
});

test('contentHash: returns 64-char hex string', () => {
  const hash = contentHash('some content');
  expect(hash.length === 64, `expected 64-char hex, got ${hash.length}`).toBeTruthy();
  expect(/^[a-f0-9]+$/.test(hash), 'hash should be hex').toBeTruthy();
});

test('contentHash: deterministic for same input', () => {
  const h1 = contentHash('hello world');
  const h2 = contentHash('hello world');
  expect(h1, 'same input should produce same hash').toEqual(h2);
});

test('contentHash: different for different inputs', () => {
  const h1 = contentHash('hello world');
  const h2 = contentHash('hello world!');
  expect(h1 !== h2, 'different inputs should produce different hashes').toBeTruthy();
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log('');
