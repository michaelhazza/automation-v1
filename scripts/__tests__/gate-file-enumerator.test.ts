/**
 * gate-file-enumerator.test.ts
 *
 * Vitest unit tests for enumerateGateFiles in
 * scripts/lib/gate-file-enumerator.mjs.
 *
 * Contracts verified:
 *   1. Paths returned are absolute (start with the resolved root or a drive letter on Windows)
 *   2. Default excludes work: *.test.ts files are omitted
 *   3. GATE_ROOT env override is honoured
 *   4. Results are sorted and deduped
 *   5. Caller-supplied excludes are applied
 *
 * Run via: npx vitest run scripts/__tests__/gate-file-enumerator.test.ts
 */

import { describe, expect, test, vi, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { enumerateGateFiles } from '../lib/gate-file-enumerator.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, 'fixtures', 'gate-file-enumerator');

afterAll(() => {
  vi.unstubAllEnvs();
});

describe('enumerateGateFiles — absolute paths', () => {
  test('returned paths are absolute for the current OS', () => {
    const files = enumerateGateFiles({
      root: FIXTURES_DIR,
      includes: ['**/*.ts'],
    });

    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      expect(path.isAbsolute(f)).toBe(true);
    }
  });
});

describe('enumerateGateFiles — default excludes', () => {
  test('*.test.ts files are excluded by default', () => {
    const files = enumerateGateFiles({
      root: FIXTURES_DIR,
      includes: ['**/*.ts'],
    });

    const testFiles = files.filter(f => f.endsWith('.test.ts'));
    expect(testFiles).toHaveLength(0);
  });

  test('non-test .ts files are included', () => {
    const files = enumerateGateFiles({
      root: FIXTURES_DIR,
      includes: ['**/*.ts'],
    });

    const names = files.map(f => path.basename(f));
    expect(names).toContain('alpha.ts');
    expect(names).toContain('beta.ts');
    expect(names).toContain('gamma.ts');
  });
});

describe('enumerateGateFiles — caller-supplied excludes', () => {
  test('caller excludes remove matching files', () => {
    const files = enumerateGateFiles({
      root: FIXTURES_DIR,
      includes: ['**/*.ts'],
      excludes: ['**/subdir/**'],
    });

    const names = files.map(f => path.basename(f));
    expect(names).not.toContain('gamma.ts');
    expect(names).toContain('alpha.ts');
  });
});

describe('enumerateGateFiles — sorted and deduped', () => {
  test('results are in sorted order', () => {
    const files = enumerateGateFiles({
      root: FIXTURES_DIR,
      includes: ['**/*.ts', '*.ts'],
    });

    const sorted = [...files].sort();
    expect(files).toEqual(sorted);
  });

  test('overlapping patterns do not produce duplicates', () => {
    const files = enumerateGateFiles({
      root: FIXTURES_DIR,
      includes: ['**/*.ts', '*.ts'],
    });

    const unique = [...new Set(files)];
    expect(files).toHaveLength(unique.length);
  });
});

describe('enumerateGateFiles — GATE_ROOT env override', () => {
  test('GATE_ROOT env var overrides the root parameter', () => {
    vi.stubEnv('GATE_ROOT', FIXTURES_DIR);

    // Pass a deliberately wrong root — GATE_ROOT should win
    const files = enumerateGateFiles({
      root: '/nonexistent/path/that/should/not/be/used',
      includes: ['**/*.ts'],
    });

    expect(files.length).toBeGreaterThan(0);
    // All paths should be under the fixtures dir
    for (const f of files) {
      expect(f.startsWith(FIXTURES_DIR) || f.toLowerCase().startsWith(FIXTURES_DIR.toLowerCase())).toBe(true);
    }

    vi.unstubAllEnvs();
  });
});
