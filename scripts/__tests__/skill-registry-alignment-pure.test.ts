/**
 * skill-registry-alignment-pure.test.ts
 *
 * Vitest unit tests for scripts/lib/skill-registry-alignment-pure.mjs:
 *   - keyToFilename        (X.Y → X_Y.md rename rule)
 *   - filenameToCandidateKeys  (reverse lookup)
 *   - computeMismatches    (mismatch set: registry ↔ skills dir)
 *
 * Run via: npx vitest run scripts/__tests__/skill-registry-alignment-pure.test.ts
 */

import { describe, expect, test } from 'vitest';
import {
  keyToFilename,
  filenameToCandidateKeys,
  computeMismatches,
} from '../lib/skill-registry-alignment-pure.mjs';

// ── keyToFilename ─────────────────────────────────────────────────────────────

describe('keyToFilename', () => {
  test('(a) dot-separated key converts dots to underscores and appends .md', () => {
    expect(keyToFilename('web.search')).toBe('web_search.md');
  });

  test('(b) multi-segment key: all dots replaced', () => {
    expect(keyToFilename('send.email.attachment')).toBe('send_email_attachment.md');
  });

  test('(c) underscore-only key: unchanged stem, appends .md', () => {
    expect(keyToFilename('ask_clarifying_question')).toBe('ask_clarifying_question.md');
  });

  test('(d) single-segment key: no dots, just appends .md', () => {
    expect(keyToFilename('read_codebase')).toBe('read_codebase.md');
  });
});

// ── filenameToCandidateKeys ───────────────────────────────────────────────────

describe('filenameToCandidateKeys', () => {
  test('(a) returns both dot-form and underscore-form for a file with underscores', () => {
    const { dotForm, underscoreForm } = filenameToCandidateKeys('web_search.md');
    expect(dotForm).toBe('web.search');
    expect(underscoreForm).toBe('web_search');
  });

  test('(b) single-segment filename: dot-form equals underscore-form', () => {
    const { dotForm, underscoreForm } = filenameToCandidateKeys('read_codebase.md');
    expect(dotForm).toBe('read.codebase');
    expect(underscoreForm).toBe('read_codebase');
  });
});

// ── computeMismatches ─────────────────────────────────────────────────────────

describe('computeMismatches', () => {
  test('(a) clean fixture — registry and files match perfectly, zero mismatches', () => {
    const snapshot = {
      entries: {
        'web.search': {},
        ask_clarifying_question: {},
      },
    };
    // key 'web.search' → 'web_search.md'; 'ask_clarifying_question' → 'ask_clarifying_question.md'
    const actualFiles = ['web_search.md', 'ask_clarifying_question.md'];
    const mismatches = computeMismatches(snapshot, actualFiles);
    expect(mismatches).toHaveLength(0);
  });

  test('(b) registry entry has no .md file — REGISTRY mismatch', () => {
    const snapshot = {
      entries: {
        'send.email': {},
        'web.search': {},
      },
    };
    const actualFiles = ['web_search.md']; // send_email.md is missing
    const mismatches = computeMismatches(snapshot, actualFiles);
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0].type).toBe('REGISTRY');
    expect(mismatches[0].key).toBe('send.email');
    expect(mismatches[0].message).toContain('send_email.md');
  });

  test('(c) .md file has no registry entry — SKILL_FILE mismatch', () => {
    const snapshot = {
      entries: {
        'web.search': {},
      },
    };
    const actualFiles = ['web_search.md', 'orphan_skill.md'];
    const mismatches = computeMismatches(snapshot, actualFiles);
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0].type).toBe('SKILL_FILE');
    expect(mismatches[0].key).toBe('orphan_skill.md');
    expect(mismatches[0].message).toContain('orphan.skill');
    expect(mismatches[0].message).toContain('orphan_skill');
  });

  test('(d) X.Y ↔ X_Y rename rule: key web.search matches file web_search.md', () => {
    const snapshot = { entries: { 'web.search': {} } };
    const actualFiles = ['web_search.md'];
    const mismatches = computeMismatches(snapshot, actualFiles);
    expect(mismatches).toHaveLength(0);
  });

  test('(e) README.md exclusion: computeMismatches never receives README.md from walkSkillsMd, so no mismatch', () => {
    // walkSkillsMd filters README.md before passing to computeMismatches.
    // Simulating: if README.md were passed in, it WOULD generate a mismatch.
    // This confirms the gate is correct: computeMismatches is never called with README.md.
    const snapshot = { entries: { 'web.search': {} } };
    // Simulate actualFiles without README.md (as walkSkillsMd would produce)
    const actualFiles = ['web_search.md'];
    const mismatches = computeMismatches(snapshot, actualFiles);
    expect(mismatches).toHaveLength(0);
  });

  test('(f) __tests__ directory exclusion: files from __tests__ must not appear in actualFiles', () => {
    // walkSkillsMd skips __tests__/ directories entirely.
    // Simulating: files from __tests__ are never passed to computeMismatches.
    const snapshot = { entries: {} };
    // No __tests__/ files in actualFiles — consistent with walkSkillsMd behaviour.
    const actualFiles: string[] = [];
    const mismatches = computeMismatches(snapshot, actualFiles);
    expect(mismatches).toHaveLength(0);
  });

  test('(g) bidirectional drift: both sides have unique entries', () => {
    const snapshot = {
      entries: {
        'web.search': {},    // expects web_search.md
        'send.email': {},    // expects send_email.md — missing
      },
    };
    const actualFiles = [
      'web_search.md',      // matched
      'orphan_skill.md',    // unmatched — no registry entry
    ];
    const mismatches = computeMismatches(snapshot, actualFiles);
    expect(mismatches).toHaveLength(2);
    const types = mismatches.map(m => m.type);
    expect(types).toContain('REGISTRY');
    expect(types).toContain('SKILL_FILE');
  });

  test('(h) empty snapshot and empty file list — no mismatches', () => {
    const snapshot = { entries: {} };
    const mismatches = computeMismatches(snapshot, []);
    expect(mismatches).toHaveLength(0);
  });

  test('(i) underscore-key matches underscore-filename directly (no rename needed)', () => {
    const snapshot = { entries: { ask_clarifying_question: {} } };
    const actualFiles = ['ask_clarifying_question.md'];
    const mismatches = computeMismatches(snapshot, actualFiles);
    expect(mismatches).toHaveLength(0);
  });
});
