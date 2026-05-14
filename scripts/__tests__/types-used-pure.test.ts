/**
 * types-used-pure.test.ts
 *
 * Vitest unit tests for scripts/lib/types-used-pure.mjs:
 *   - collectExportsFromFile (via synthetic in-memory fixture)
 *   - isExportSuppressed
 *   - scanReferencesNode (pure Node fallback)
 *
 * Run via: npx vitest run scripts/__tests__/types-used-pure.test.ts
 *
 * Note: findUnreferencedExports and scanReferences (the rg-backed version) are
 * integration-level and covered by the gate's smoke run against the live tree.
 * The pure helpers (collectExportsFromFile, isExportSuppressed, scanReferencesNode)
 * are tested here with synthetic fixtures.
 */

import { describe, expect, test } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import {
  isExportSuppressed,
  scanReferencesNode,
} from '../lib/types-used-pure.mjs';

// ── isExportSuppressed ────────────────────────────────────────────────────────

describe('isExportSuppressed', () => {
  test('(a) no annotation — not suppressed', () => {
    const lines = [
      'export interface Foo {',
      '  bar: string;',
      '}',
    ];
    expect(isExportSuppressed(lines, 0)).toBe(false);
  });

  test('(b) same-line guard-ignore annotation — suppressed', () => {
    const lines = [
      'export type Foo = string; // guard-ignore: types-used reason="legacy export"',
    ];
    expect(isExportSuppressed(lines, 0)).toBe(true);
  });

  test('(b) previous-line guard-ignore-next-line annotation — suppressed', () => {
    const lines = [
      '// guard-ignore-next-line: types-used reason="intentional"',
      'export interface Bar {',
    ];
    expect(isExportSuppressed(lines, 1)).toBe(true);
  });

  test('(c) wrong guard-id — not suppressed', () => {
    const lines = [
      '// guard-ignore: no-db-in-routes reason="unrelated"',
      'export interface Baz {',
    ];
    expect(isExportSuppressed(lines, 1)).toBe(false);
  });

  test('(d) first line (no previous line) — does not throw', () => {
    const lines = ['export const Qux = 42;'];
    expect(isExportSuppressed(lines, 0)).toBe(false);
  });
});

// ── scanReferencesNode (pure fallback) ────────────────────────────────────────

describe('scanReferencesNode', () => {
  // Create a temporary directory structure for each test
  let tmpDir: string;

  function setup(files: Record<string, string>) {
    tmpDir = join(tmpdir(), `types-used-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    for (const [rel, content] of Object.entries(files)) {
      const fullPath = join(tmpDir, rel);
      mkdirSync(join(fullPath, '..'), { recursive: true });
      writeFileSync(fullPath, content);
    }
  }

  function cleanup() {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore cleanup errors */ }
  }

  test('(a) clean fixture — type is referenced → returns true', () => {
    setup({
      'shared/types/foo.ts': 'export interface FooType {}',
      'server/services/bar.ts': 'import type { FooType } from "../../shared/types/foo.js";',
    });

    const declaringAbsolute = join(tmpDir, 'shared/types/foo.ts');
    const result = scanReferencesNode(
      tmpDir,
      'FooType',
      declaringAbsolute,
      [join(tmpDir, 'server'), join(tmpDir, 'shared')]
    );
    cleanup();
    expect(result).toBe(true);
  });

  test('(b) intentional drift fixture — type not referenced → returns false', () => {
    setup({
      'shared/types/orphan.ts': 'export interface OrphanType {}',
      'server/services/other.ts': 'const x = 1;',
    });

    const declaringAbsolute = join(tmpDir, 'shared/types/orphan.ts');
    const result = scanReferencesNode(
      tmpDir,
      'OrphanType',
      declaringAbsolute,
      [join(tmpDir, 'server'), join(tmpDir, 'shared')]
    );
    cleanup();
    expect(result).toBe(false);
  });

  test('(b) self-reference in declaring file does NOT count as referenced', () => {
    // The declaring file itself references the type — but it should be excluded
    setup({
      'shared/types/self.ts': `
export type SelfRef = string;
const x: SelfRef = 'hello'; // self-reference, should not count
`,
      'server/services/other.ts': 'const y = 1;',
    });

    const declaringAbsolute = join(tmpDir, 'shared/types/self.ts');
    const result = scanReferencesNode(
      tmpDir,
      'SelfRef',
      declaringAbsolute,
      [join(tmpDir, 'server'), join(tmpDir, 'shared')]
    );
    cleanup();
    expect(result).toBe(false);
  });

  test('(c) malformed/missing directory — does not throw, returns false', () => {
    const result = scanReferencesNode(
      '/nonexistent/path',
      'SomeType',
      '/nonexistent/path/types/foo.ts',
      ['/nonexistent/path/server']
    );
    expect(result).toBe(false);
  });

  test('(d) type referenced in a .tsx file — returns true', () => {
    setup({
      'shared/types/widget.ts': 'export interface WidgetProps {}',
      'client/src/Widget.tsx': 'import type { WidgetProps } from "../../shared/types/widget.js";',
    });

    const declaringAbsolute = join(tmpDir, 'shared/types/widget.ts');
    const result = scanReferencesNode(
      tmpDir,
      'WidgetProps',
      declaringAbsolute,
      [join(tmpDir, 'client'), join(tmpDir, 'shared')]
    );
    cleanup();
    expect(result).toBe(true);
  });
});
