/**
 * loc-cap-pure.test.ts
 *
 * Vitest unit tests for scripts/lib/loc-cap-pure.mjs:
 *   applyCaps, isExcluded, isGeneratedContent, matchLayer
 *
 * Run via: npx vitest run scripts/__tests__/loc-cap-pure.test.ts
 *
 * Coverage assertions (from chunk 6 definition-of-done):
 *   (a) file under soft cap → no flag
 *   (b) file between soft and hard cap → soft warning
 *   (c) file over hard cap → hard error
 *   (e) generated file (AUTO-GENERATED header) → excluded
 *   (f) migrations/*.sql → excluded
 */

import { describe, expect, test } from 'vitest';
import {
  applyCaps,
  isExcluded,
  isGeneratedContent,
  matchLayer,
  LAYER_CAPS,
} from '../lib/loc-cap-pure.mjs';

// ── isGeneratedContent ────────────────────────────────────────────────────────

describe('isGeneratedContent', () => {
  test('returns true for AUTO-GENERATED header', () => {
    expect(isGeneratedContent('// AUTO-GENERATED — do not edit')).toBe(true);
  });

  test('returns true when header has leading whitespace', () => {
    expect(isGeneratedContent('  // AUTO-GENERATED')).toBe(true);
  });

  test('returns false for regular source file', () => {
    expect(isGeneratedContent('import { foo } from "./bar.js";')).toBe(false);
  });

  test('returns false for empty first line', () => {
    expect(isGeneratedContent('')).toBe(false);
  });
});

// ── isExcluded ────────────────────────────────────────────────────────────────

describe('isExcluded', () => {
  test('excludes server/db/schema/ files', () => {
    expect(isExcluded({ relPath: 'server/db/schema/users.ts', exclusions: [] })).toBe(true);
  });

  test('excludes rlsProtectedTables.ts', () => {
    expect(isExcluded({ relPath: 'server/config/rlsProtectedTables.ts', exclusions: [] })).toBe(true);
  });

  test('excludes *.generated.ts files', () => {
    expect(isExcluded({ relPath: 'server/services/foo.generated.ts', exclusions: [] })).toBe(true);
  });

  test('excludes migrations/*.sql', () => {
    expect(isExcluded({ relPath: 'migrations/0001_init.sql', exclusions: [] })).toBe(true);
  });

  test('excludes tasks/** files', () => {
    expect(isExcluded({ relPath: 'tasks/todo.md', exclusions: [] })).toBe(true);
  });

  test('excludes docs/** files', () => {
    expect(isExcluded({ relPath: 'docs/architecture.md', exclusions: [] })).toBe(true);
  });

  test('excludes caller-supplied paths', () => {
    expect(isExcluded({ relPath: 'server/services/foo.ts', exclusions: ['server/services/foo.ts'] })).toBe(true);
  });

  test('does NOT exclude regular service files', () => {
    expect(isExcluded({ relPath: 'server/services/agentService.ts', exclusions: [] })).toBe(false);
  });
});

// ── matchLayer ────────────────────────────────────────────────────────────────

describe('matchLayer', () => {
  test('matches server/services/*.ts', () => {
    const result = matchLayer({ relPath: 'server/services/agentService.ts', caps: LAYER_CAPS });
    expect(result).not.toBeNull();
    expect(result!.soft).toBe(1500);
    expect(result!.hard).toBe(2500);
  });

  test('matches server/routes/*.ts', () => {
    const result = matchLayer({ relPath: 'server/routes/agents.ts', caps: LAYER_CAPS });
    expect(result).not.toBeNull();
    expect(result!.soft).toBe(800);
    expect(result!.hard).toBe(1500);
  });

  test('matches client/src/pages/*.tsx', () => {
    const result = matchLayer({ relPath: 'client/src/pages/HomePage.tsx', caps: LAYER_CAPS });
    expect(result).not.toBeNull();
    expect(result!.soft).toBe(600);
    expect(result!.hard).toBe(1200);
  });

  test('matches client/src/components/*.tsx', () => {
    const result = matchLayer({ relPath: 'client/src/components/Button.tsx', caps: LAYER_CAPS });
    expect(result).not.toBeNull();
    expect(result!.soft).toBe(400);
    expect(result!.hard).toBe(800);
  });

  test('matches shared/**/*.ts', () => {
    const result = matchLayer({ relPath: 'shared/types/agentExecution.ts', caps: LAYER_CAPS });
    expect(result).not.toBeNull();
    expect(result!.soft).toBe(500);
    expect(result!.hard).toBe(1000);
  });

  test('returns null for unmatched path', () => {
    const result = matchLayer({ relPath: 'scripts/lib/foo.mjs', caps: LAYER_CAPS });
    expect(result).toBeNull();
  });

  test('does NOT match nested paths for server/services (only top-level)', () => {
    // server/services/subdir/foo.ts — the pattern only matches one level deep
    const result = matchLayer({ relPath: 'server/services/subdir/foo.ts', caps: LAYER_CAPS });
    expect(result).toBeNull();
  });
});

// ── applyCaps ─────────────────────────────────────────────────────────────────

describe('applyCaps', () => {
  // (a) file under soft cap → no flag
  test('(a) file under soft cap is not flagged', () => {
    const files = new Map([['server/services/tinyService.ts', 100]]);
    const { soft, hard } = applyCaps({ files });
    expect(soft).toHaveLength(0);
    expect(hard).toHaveLength(0);
  });

  // (b) file between soft and hard → soft warning
  test('(b) file between soft and hard cap appears in soft list', () => {
    const files = new Map([['server/services/mediumService.ts', 2000]]);
    const { soft, hard } = applyCaps({ files });
    expect(soft).toContain('server/services/mediumService.ts');
    expect(hard).toHaveLength(0);
  });

  // (c) file over hard cap → hard error
  test('(c) file over hard cap appears in hard list', () => {
    const files = new Map([['server/services/godService.ts', 5000]]);
    const { soft, hard } = applyCaps({ files });
    expect(hard).toContain('server/services/godService.ts');
    expect(soft).toHaveLength(0);
  });

  // (e) generated file excluded
  test('(e) generated file in exclusions is skipped', () => {
    const files = new Map([['server/services/foo.generated.ts', 9999]]);
    const { soft, hard } = applyCaps({ files });
    // isExcluded detects .generated.ts by filename — excluded automatically
    expect(soft).toHaveLength(0);
    expect(hard).toHaveLength(0);
  });

  // (f) migrations/*.sql excluded
  test('(f) migrations file is excluded', () => {
    const files = new Map([['migrations/0001_init.sql', 9999]]);
    const { soft, hard } = applyCaps({ files });
    expect(soft).toHaveLength(0);
    expect(hard).toHaveLength(0);
  });

  test('caller-supplied exclusions are respected', () => {
    const files = new Map([['server/services/bigService.ts', 5000]]);
    const { soft, hard } = applyCaps({ files, exclusions: ['server/services/bigService.ts'] });
    expect(soft).toHaveLength(0);
    expect(hard).toHaveLength(0);
  });

  test('exactly at soft cap is not flagged', () => {
    // soft cap for server/services is 1500; 1500 is NOT > 1500
    const files = new Map([['server/services/edgeService.ts', 1500]]);
    const { soft, hard } = applyCaps({ files });
    expect(soft).toHaveLength(0);
    expect(hard).toHaveLength(0);
  });

  test('one over soft cap is flagged as soft', () => {
    const files = new Map([['server/services/edgeService.ts', 1501]]);
    const { soft, hard } = applyCaps({ files });
    expect(soft).toContain('server/services/edgeService.ts');
    expect(hard).toHaveLength(0);
  });
});
