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
    // Returned paths are POSIX-normalised (forward slashes), so normalise the
    // FIXTURES_DIR reference before comparing, and use a case-insensitive check
    // on Windows where drive letters may differ in case.
    const fixturesPosix = FIXTURES_DIR.replace(/\\/g, '/');
    for (const f of files) {
      expect(f.toLowerCase().startsWith(fixturesPosix.toLowerCase())).toBe(true);
    }

    vi.unstubAllEnvs();
  });
});

describe('enumerateGateFiles — POSIX path normalisation', () => {
  test('returned paths use forward-slash separators on all platforms', () => {
    const files = enumerateGateFiles({
      root: FIXTURES_DIR,
      includes: ['**/*.ts'],
    });

    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      // No backslash may appear anywhere in a returned path, even on Windows.
      expect(f).not.toContain('\\');
    }
  });
});

describe('enumerateGateFiles — __tests__ directory exclusion', () => {
  test('caller-supplied **/__tests__/** exclude is applied without error and yields a subset', () => {
    // Without the exclude: include everything (excluding default *.test.ts)
    const filesAll = enumerateGateFiles({
      root: FIXTURES_DIR,
      includes: ['**/*.ts'],
    });

    // With the exclude: files inside __tests__ subdirectories (relative to root)
    // are removed.  The fixture tree has no __tests__ sub-folder, so the result
    // must equal the unfiltered set — verifying the exclude is applied without
    // crashing and does not incorrectly drop non-matching files.
    const filesFiltered = enumerateGateFiles({
      root: FIXTURES_DIR,
      includes: ['**/*.ts'],
      excludes: ['**/__tests__/**'],
    });

    // The filtered set must be a subset of (or equal to) the full set.
    for (const f of filesFiltered) {
      expect(filesAll).toContain(f);
    }

    // The fixture root itself has no __tests__ sub-directory, so every file
    // in filesAll should survive the filter.
    expect(filesFiltered).toHaveLength(filesAll.length);
  });

  test('**/__tests__/** exclude removes files under __tests__ sub-directories', () => {
    // Use the parent of FIXTURES_DIR so the fixtures folder lives under a path
    // that contains a __tests__ segment — confirming the exclude pattern fires.
    const fixturesParent = path.join(__dirname, 'fixtures');
    const fixturesPosix = FIXTURES_DIR.replace(/\\/g, '/');

    const filesWithExclude = enumerateGateFiles({
      root: fixturesParent,
      includes: ['**/*.ts'],
      excludes: ['**/__tests__/**'],
    });

    // None of the returned paths should sit inside the gate-file-enumerator
    // fixture dir, because that dir lives under
    // <fixturesParent>/__tests__/... — wait: it does NOT; fixturesParent IS
    // `scripts/__tests__/fixtures`.  So this test uses the scripts root to
    // place the fixture dir inside a __tests__ segment.
    // Simpler: just confirm no returned path contains a /__tests__/ segment
    // when the enumerator root is the repo scripts directory.
    const scriptsDir = path.join(__dirname, '..');
    const filesFromScripts = enumerateGateFiles({
      root: scriptsDir,
      includes: ['__tests__/fixtures/**/*.ts'],
      excludes: ['**/__tests__/**'],
    });

    // The __tests__ exclude should strip all fixture files because they sit
    // under scripts/__tests__/fixtures, which matches **/__tests__/**.
    expect(filesFromScripts).toHaveLength(0);
  });
});
