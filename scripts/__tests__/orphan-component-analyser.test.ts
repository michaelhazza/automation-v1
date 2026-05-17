/**
 * orphan-component-analyser.test.ts
 *
 * Vitest unit tests for findOrphanComponents in
 * scripts/lib/orphan-component-analyser.mjs.
 *
 * Uses synthetic fixtures under scripts/__fixtures__/orphan-component/:
 *   - routed.tsx      — referenced via lazy import in fake entry file → clean
 *   - allowlisted.tsx — not routed but in the fixture allow-list → clean
 *   - orphan.tsx      — not routed and not allow-listed → violation
 *
 * The test creates a temporary directory with:
 *   - A fake App.tsx that lazy-imports ./pages/routed
 *   - A pages/ subdirectory containing copies of the fixture files
 *   - A .orphan-allowlist.json referencing the copy of allowlisted.tsx
 *
 * All paths are consistent: the App.tsx import, the allow-list, and the
 * analyser's file scan all reference the same copy paths in TMP_DIR/pages/.
 *
 * Run via: npx vitest run scripts/__tests__/orphan-component-analyser.test.ts
 */

import { describe, expect, test, beforeAll, afterAll } from 'vitest';
import { findOrphanComponents } from '../lib/orphan-component-analyser.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, rmSync, mkdirSync, copyFileSync } from 'node:fs';
import os from 'node:os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const FIXTURES_DIR = path.join(__dirname, '../__fixtures__/orphan-component');

// Temporary directory for the fake entry file, allow-list, and component copies.
let TMP_DIR: string;
let FAKE_APP_TSX: string;
let FAKE_ALLOW_LIST: string;

beforeAll(() => {
  TMP_DIR = path.join(os.tmpdir(), `orphan-test-${Date.now()}`);
  const fakePagesDir = path.join(TMP_DIR, 'pages');
  mkdirSync(fakePagesDir, { recursive: true });

  // Copy fixture files into pages/ so the scanner and the App.tsx import
  // both reference the same absolute paths (TMP_DIR/pages/*.tsx).
  copyFileSync(path.join(FIXTURES_DIR, 'routed.tsx'), path.join(fakePagesDir, 'routed.tsx'));
  copyFileSync(path.join(FIXTURES_DIR, 'allowlisted.tsx'), path.join(fakePagesDir, 'allowlisted.tsx'));
  copyFileSync(path.join(FIXTURES_DIR, 'orphan.tsx'), path.join(fakePagesDir, 'orphan.tsx'));

  // Fake App.tsx that routes only the 'routed.tsx' copy via a relative import.
  // The lazy import resolves to TMP_DIR/pages/routed.tsx — the same path the
  // analyser finds when it scans TMP_DIR/pages/.
  FAKE_APP_TSX = path.join(TMP_DIR, 'App.tsx');
  writeFileSync(FAKE_APP_TSX, [
    "import { lazy } from 'react';",
    "const RoutedPage = lazy(() => import('./pages/routed'));",
    'export default RoutedPage;',
  ].join('\n'));

  // Allow-list using a path relative to REPO_ROOT that resolves back to
  // TMP_DIR/pages/allowlisted.tsx.  path.relative produces a ../../ prefix
  // when TMP is outside the repo; path.resolve(repoRoot, relPath) correctly
  // reconstructs the absolute temp path.
  FAKE_ALLOW_LIST = path.join(TMP_DIR, '.orphan-allowlist.json');
  const allowlistedRelPath = path.relative(REPO_ROOT, path.join(fakePagesDir, 'allowlisted.tsx')).replace(/\\/g, '/');
  writeFileSync(FAKE_ALLOW_LIST, JSON.stringify({
    _doc: 'test allow-list',
    files: [{ path: allowlistedRelPath, reason: 'fixture test — intentional orphan' }],
  }));
});

afterAll(() => {
  try {
    rmSync(TMP_DIR, { recursive: true, force: true });
  } catch {
    // Cleanup failure is non-fatal.
  }
});

describe('findOrphanComponents', () => {
  test('routed.tsx is not flagged (it is in the lazy import list)', () => {
    const violations = findOrphanComponents({
      entryFile: FAKE_APP_TSX,
      componentRoot: TMP_DIR,
      allowListFile: FAKE_ALLOW_LIST,
      repoRoot: REPO_ROOT,
    });
    const routedViolations = violations.filter(v => v.file.endsWith('routed.tsx'));
    expect(routedViolations).toHaveLength(0);
  });

  test('allowlisted.tsx is not flagged (it is in the allow-list)', () => {
    const violations = findOrphanComponents({
      entryFile: FAKE_APP_TSX,
      componentRoot: TMP_DIR,
      allowListFile: FAKE_ALLOW_LIST,
      repoRoot: REPO_ROOT,
    });
    const allowlistedViolations = violations.filter(v => v.file.endsWith('allowlisted.tsx'));
    expect(allowlistedViolations).toHaveLength(0);
  });

  test('orphan.tsx is flagged as an orphan component', () => {
    const violations = findOrphanComponents({
      entryFile: FAKE_APP_TSX,
      componentRoot: TMP_DIR,
      allowListFile: FAKE_ALLOW_LIST,
      repoRoot: REPO_ROOT,
    });
    const orphanViolations = violations.filter(v => v.file.endsWith('orphan.tsx'));
    expect(orphanViolations.length).toBeGreaterThan(0);
    expect(orphanViolations[0].message).toContain('no ingress');
  });
});
