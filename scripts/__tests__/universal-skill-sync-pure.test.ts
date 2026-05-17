/**
 * universal-skill-sync-pure.test.ts
 *
 * Vitest unit tests for scripts/lib/universal-skill-sync-pure.mjs:
 *   - parseUniversalSkillNames
 *   - parseRegistryFileForUniversal
 *   - diffUniversalSkills
 *
 * Run via: npx vitest run scripts/__tests__/universal-skill-sync-pure.test.ts
 */

import { describe, expect, test } from 'vitest';
import {
  parseUniversalSkillNames,
  parseRegistryFileForUniversal,
  diffUniversalSkills,
} from '../lib/universal-skill-sync-pure.mjs';

// ── parseUniversalSkillNames ──────────────────────────────────────────────────

describe('parseUniversalSkillNames', () => {
  test('(a) clean fixture — extracts all names from the array literal', () => {
    const text = `
export const UNIVERSAL_SKILL_NAMES: readonly string[] = [
  'ask_clarifying_question',
  'read_workspace',
  'web_search',
];
`;
    const names = parseUniversalSkillNames(text);
    expect(names).toEqual(['ask_clarifying_question', 'read_workspace', 'web_search']);
  });

  test('(b) handles double-quoted strings', () => {
    const text = `
export const UNIVERSAL_SKILL_NAMES: readonly string[] = [
  "foo_skill",
  "bar_skill",
];
`;
    const names = parseUniversalSkillNames(text);
    expect(names).toEqual(['foo_skill', 'bar_skill']);
  });

  test('(c) malformed input (no array) — returns empty array, no silent pass', () => {
    const text = `// no array here`;
    const names = parseUniversalSkillNames(text);
    expect(names).toEqual([]);
  });

  test('(d) empty array — returns empty array', () => {
    const text = `export const UNIVERSAL_SKILL_NAMES: readonly string[] = [];`;
    const names = parseUniversalSkillNames(text);
    expect(names).toEqual([]);
  });
});

// ── parseRegistryFileForUniversal ─────────────────────────────────────────────

describe('parseRegistryFileForUniversal', () => {
  test('(a) clean fixture — finds entries with isUniversal: true', () => {
    const text = `
export const actions = {
  ask_clarifying_question: {
    actionType: 'ask_clarifying_question',
    isUniversal: true,
    description: 'asks',
  },
  read_file: {
    actionType: 'read_file',
    description: 'reads a file',
  },
};
`;
    const result = parseRegistryFileForUniversal(text);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('ask_clarifying_question');
    expect(result[0].isUniversal).toBe(true);
  });

  test('(b) intentional drift fixture — two entries with isUniversal: true', () => {
    const text = `
export const actions = {
  skill_a: {
    actionType: 'skill_a',
    isUniversal: true,
  },
  skill_b: {
    actionType: 'skill_b',
    isUniversal: true,
  },
  skill_c: {
    actionType: 'skill_c',
  },
};
`;
    const result = parseRegistryFileForUniversal(text);
    expect(result).toHaveLength(2);
    const names = result.map(r => r.name);
    expect(names).toContain('skill_a');
    expect(names).toContain('skill_b');
  });

  test('(c) malformed input — no export object, returns empty array', () => {
    const text = `// just a comment, no registry object`;
    const result = parseRegistryFileForUniversal(text);
    expect(result).toEqual([]);
  });

  test('(d) defineXxx pattern — extracts slug from slug: property', () => {
    const text = `
export const actions = {
  search_agent_history: defineInternalRead({
    slug: 'search_agent_history',
    description: 'searches',
    isUniversal: true,
  }),
};
`;
    const result = parseRegistryFileForUniversal(text);
    expect(result.length).toBeGreaterThanOrEqual(1);
    const found = result.find(r => r.name === 'search_agent_history');
    expect(found).toBeDefined();
    expect(found?.isUniversal).toBe(true);
  });
});

// ── diffUniversalSkills ───────────────────────────────────────────────────────

describe('diffUniversalSkills', () => {
  test('(a) clean fixture — no drift → empty diff', () => {
    const names = ['skill_a', 'skill_b'];
    const registry = [
      { name: 'skill_a', isUniversal: true },
      { name: 'skill_b', isUniversal: true },
    ];
    const { onlyInNames, onlyInRegistry } = diffUniversalSkills({ names, registry });
    expect(onlyInNames).toEqual([]);
    expect(onlyInRegistry).toEqual([]);
  });

  test('(b) intentional drift — skill missing from registry → appears in onlyInNames', () => {
    const names = ['skill_a', 'skill_b', 'skill_missing'];
    const registry = [
      { name: 'skill_a', isUniversal: true },
      { name: 'skill_b', isUniversal: true },
    ];
    const { onlyInNames, onlyInRegistry } = diffUniversalSkills({ names, registry });
    expect(onlyInNames).toEqual(['skill_missing']);
    expect(onlyInRegistry).toEqual([]);
  });

  test('(b) intentional drift — skill in registry but not in names → appears in onlyInRegistry', () => {
    const names = ['skill_a'];
    const registry = [
      { name: 'skill_a', isUniversal: true },
      { name: 'skill_extra', isUniversal: true },
    ];
    const { onlyInNames, onlyInRegistry } = diffUniversalSkills({ names, registry });
    expect(onlyInNames).toEqual([]);
    expect(onlyInRegistry).toEqual(['skill_extra']);
  });

  test('(b) bidirectional drift — both sides have unique entries', () => {
    const names = ['in_names_only', 'shared'];
    const registry = [
      { name: 'in_registry_only', isUniversal: true },
      { name: 'shared', isUniversal: true },
    ];
    const { onlyInNames, onlyInRegistry } = diffUniversalSkills({ names, registry });
    expect(onlyInNames).toEqual(['in_names_only']);
    expect(onlyInRegistry).toEqual(['in_registry_only']);
  });

  test('(c) non-universal registry entries are not counted', () => {
    const names = ['skill_a'];
    const registry = [
      { name: 'skill_a', isUniversal: true },
      { name: 'skill_not_universal', isUniversal: false },
    ];
    const { onlyInNames, onlyInRegistry } = diffUniversalSkills({ names, registry });
    expect(onlyInNames).toEqual([]);
    expect(onlyInRegistry).toEqual([]);
  });

  test('(c) empty inputs — no violations', () => {
    const { onlyInNames, onlyInRegistry } = diffUniversalSkills({ names: [], registry: [] });
    expect(onlyInNames).toEqual([]);
    expect(onlyInRegistry).toEqual([]);
  });
});
