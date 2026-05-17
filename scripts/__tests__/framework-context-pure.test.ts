/**
 * framework-context-pure.test.ts
 *
 * Vitest unit tests for scripts/lib/framework-context-pure.mjs:
 *   - parseFrameworkContextBlock
 *   - extractPackageVersion
 *   - extractVersionsFromProse
 *   - compareVersions
 *   - compareFrameworkContext
 *
 * Run via: npx vitest run scripts/__tests__/framework-context-pure.test.ts
 */

import { describe, expect, test } from 'vitest';
import {
  parseFrameworkContextBlock,
  extractPackageVersion,
  extractVersionsFromProse,
  compareVersions,
  compareFrameworkContext,
} from '../lib/framework-context-pure.mjs';

// ── parseFrameworkContextBlock ────────────────────────────────────────────────

describe('parseFrameworkContextBlock', () => {
  const SAMPLE_MD = `
## 1. Introduction

Some text here.

## 2. AutomationOS context block

| Item | Value |
|---|---|
| TypeScript | \`^5.3.3\` |
| Server runtime | Node + Express \`^4.18.2\`, dev via \`node --watch\` |
| Queue | **pg-boss \`^9.0.3\`** is canonical |

## 3. Universal Rules

More text.
`;

  test('(a) clean fixture — extracts table rows from §2', () => {
    const rows = parseFrameworkContextBlock(SAMPLE_MD);
    expect(rows.length).toBeGreaterThanOrEqual(3);
    const tsRow = rows.find(r => r.fact === 'TypeScript');
    expect(tsRow).toBeDefined();
    expect(tsRow?.declaredValue).toContain('^5.3.3');
  });

  test('(b) does not include header row (Item/Value)', () => {
    const rows = parseFrameworkContextBlock(SAMPLE_MD);
    const headerRow = rows.find(r => r.fact === 'Item');
    expect(headerRow).toBeUndefined();
  });

  test('(c) malformed input — no §2 section → empty array, no silent pass', () => {
    const text = `# No section 2 here\n\nJust some text.`;
    const rows = parseFrameworkContextBlock(text);
    expect(rows).toEqual([]);
  });

  test('(d) returns correct fact and value for multi-package row', () => {
    const md = `
## 2. AutomationOS context block

| Item | Value |
|---|---|
| Queue | **pg-boss \`^9.0.3\`** is canonical |

## 3. Next section
`;
    const rows = parseFrameworkContextBlock(md);
    const queueRow = rows.find(r => r.fact === 'Queue');
    expect(queueRow).toBeDefined();
    expect(queueRow?.declaredValue).toContain('^9.0.3');
  });
});

// ── extractPackageVersion ─────────────────────────────────────────────────────

describe('extractPackageVersion', () => {
  const pkg = {
    dependencies: {
      express: '^4.18.2',
      'socket.io': '^4.8.3',
    },
    devDependencies: {
      vitest: '^2.1.9',
      typescript: '^5.3.3',
    },
    optionalDependencies: {
      docx: '^9.6.1',
    },
  };

  test('(a) finds version in dependencies', () => {
    expect(extractPackageVersion(pkg, 'express')).toBe('^4.18.2');
  });

  test('(b) finds version in devDependencies', () => {
    expect(extractPackageVersion(pkg, 'typescript')).toBe('^5.3.3');
  });

  test('(c) finds version in optionalDependencies', () => {
    expect(extractPackageVersion(pkg, 'docx')).toBe('^9.6.1');
  });

  test('(d) returns null for package not in any section', () => {
    expect(extractPackageVersion(pkg, 'nonexistent-pkg')).toBeNull();
  });
});

// ── extractVersionsFromProse ──────────────────────────────────────────────────

describe('extractVersionsFromProse', () => {
  test('(a) simple backtick version', () => {
    expect(extractVersionsFromProse('`^5.3.3`')).toEqual(['^5.3.3']);
  });

  test('(b) tilde prefix', () => {
    expect(extractVersionsFromProse('`~28.0.0`')).toEqual(['~28.0.0']);
  });

  test('(c) embedded in prose', () => {
    const prose = 'Node + Express `^4.18.2`, dev via `node --watch`';
    expect(extractVersionsFromProse(prose)).toEqual(['^4.18.2']);
  });

  test('(d) multiple versions', () => {
    const prose = 'React `^18.2.0` + Vite `^5.4.21` (NO Next.js)';
    const result = extractVersionsFromProse(prose);
    expect(result).toContain('^18.2.0');
    expect(result).toContain('^5.4.21');
    expect(result).toHaveLength(2);
  });

  test('(e) no backtick versions — returns empty array', () => {
    expect(extractVersionsFromProse('No version here')).toEqual([]);
  });
});

// ── compareVersions ───────────────────────────────────────────────────────────

describe('compareVersions', () => {
  test('(a) match — declared version matches package.json string', () => {
    const result = compareVersions('`^5.3.3`', '^5.3.3');
    expect(result).toBe('match');
  });

  test('(b) drift — declared version differs from package.json string', () => {
    const result = compareVersions('`^5.3.3`', '^5.4.0');
    expect(result).toBe('drift');
  });

  test('(c) no-source — null package.json version', () => {
    const result = compareVersions('`^5.3.3`', null);
    expect(result).toBe('no-source');
  });

  test('(d) no version in prose — returns match (nothing to check)', () => {
    const result = compareVersions('Three-layer fail-closed', '^4.18.2');
    expect(result).toBe('match');
  });

  test('(e) compound fact — object of packageName: version — all match', () => {
    const result = compareVersions(
      'React `^18.2.0` + Vite `^5.4.21`',
      { react: '^18.2.0', vite: '^5.4.21' }
    );
    expect(result).toBe('match');
  });

  test('(e) compound fact — one version drifted', () => {
    const result = compareVersions(
      'React `^18.2.0` + Vite `^5.4.21`',
      { react: '^18.2.0', vite: '^6.0.0' }
    );
    expect(result).toBe('drift');
  });
});

// ── compareFrameworkContext ───────────────────────────────────────────────────

describe('compareFrameworkContext', () => {
  test('(a) clean fixture — all rows match → no drift findings', () => {
    const md = `
## 2. AutomationOS context block

| Item | Value |
|---|---|
| TypeScript | \`^5.3.3\` |

## 3. Next
`;
    const pkg = {
      devDependencies: { typescript: '^5.3.3' },
    };
    const findings = compareFrameworkContext(md, pkg);
    const drifts = findings.filter(f => f.result === 'drift');
    expect(drifts).toHaveLength(0);
  });

  test('(b) intentional drift — TypeScript row differs → 1 drift finding', () => {
    const md = `
## 2. AutomationOS context block

| Item | Value |
|---|---|
| TypeScript | \`^5.3.3\` |

## 3. Next
`;
    const pkg = {
      devDependencies: { typescript: '^5.4.0' },
    };
    const findings = compareFrameworkContext(md, pkg);
    const drifts = findings.filter(f => f.result === 'drift');
    expect(drifts).toHaveLength(1);
    expect(drifts[0].fact).toBe('TypeScript');
  });

  test('(c) malformed markdown — no §2 → no findings', () => {
    const md = `# Just some text, no §2 table`;
    const pkg = { dependencies: {} };
    const findings = compareFrameworkContext(md, pkg);
    expect(findings).toHaveLength(0);
  });
});
