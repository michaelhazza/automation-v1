/**
 * filesTabPure.test.ts
 * Pure-function tests for the Files tab helpers.
 * Run via: npx vitest run client/src/components/openTask/__tests__/filesTabPure.test.ts
 */

import { expect, test, describe } from 'vitest';
import {
  classifyFileGroup,
  filterLatestOnly,
  sortFiles,
  searchFiles,
  type TabFile,
} from '../filesTabPure.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeFile(overrides: Partial<TabFile> & Pick<TabFile, 'id' | 'name'>): TabFile {
  return {
    mimeType: 'text/plain',
    fileSizeBytes: 1024,
    updatedAt: '2025-01-01T00:00:00Z',
    producerKind: 'agent',
    currentVersion: 1,
    ...overrides,
  };
}

// ─── classifyFileGroup ────────────────────────────────────────────────────────

describe('classifyFileGroup', () => {
  test('agent producer -> output', () => {
    const f = makeFile({ id: '1', name: 'report.txt', producerKind: 'agent' });
    expect(classifyFileGroup(f)).toBe('output');
  });

  test('user producer -> reference', () => {
    const f = makeFile({ id: '2', name: 'brief.pdf', producerKind: 'user' });
    expect(classifyFileGroup(f)).toBe('reference');
  });

  test('reference producer -> reference', () => {
    const f = makeFile({ id: '3', name: 'guide.md', producerKind: 'reference' });
    expect(classifyFileGroup(f)).toBe('reference');
  });
});

// ─── filterLatestOnly ─────────────────────────────────────────────────────────

describe('filterLatestOnly', () => {
  test('single file passes through unchanged', () => {
    const files = [makeFile({ id: '1', name: 'a.txt', currentVersion: 1 })];
    expect(filterLatestOnly(files)).toEqual(files);
  });

  test('keeps only highest version for same name', () => {
    const files = [
      makeFile({ id: '1', name: 'report.txt', currentVersion: 1 }),
      makeFile({ id: '2', name: 'report.txt', currentVersion: 3 }),
      makeFile({ id: '3', name: 'report.txt', currentVersion: 2 }),
    ];
    const result = filterLatestOnly(files);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('2');
    expect(result[0].currentVersion).toBe(3);
  });

  test('preserves distinct files', () => {
    const files = [
      makeFile({ id: '1', name: 'a.txt', currentVersion: 2 }),
      makeFile({ id: '2', name: 'b.txt', currentVersion: 1 }),
      makeFile({ id: '3', name: 'a.txt', currentVersion: 1 }),
    ];
    const result = filterLatestOnly(files);
    expect(result).toHaveLength(2);
    const names = result.map((f) => f.name);
    expect(names).toContain('a.txt');
    expect(names).toContain('b.txt');
    // The kept 'a.txt' should be version 2
    const aFile = result.find((f) => f.name === 'a.txt')!;
    expect(aFile.currentVersion).toBe(2);
  });

  test('empty list returns empty', () => {
    expect(filterLatestOnly([])).toEqual([]);
  });
});

// ─── sortFiles ────────────────────────────────────────────────────────────────

describe('sortFiles', () => {
  const files = [
    makeFile({ id: '1', name: 'zebra.txt', updatedAt: '2025-01-01T00:00:00Z', fileSizeBytes: 100 }),
    makeFile({ id: '2', name: 'apple.txt', updatedAt: '2025-03-01T00:00:00Z', fileSizeBytes: 500 }),
    makeFile({ id: '3', name: 'mango.txt', updatedAt: '2025-02-01T00:00:00Z', fileSizeBytes: 300 }),
  ];

  test('sort by name ascending', () => {
    const sorted = sortFiles(files, 'name');
    expect(sorted.map((f) => f.name)).toEqual(['apple.txt', 'mango.txt', 'zebra.txt']);
  });

  test('sort by updated newest-first', () => {
    const sorted = sortFiles(files, 'updated');
    expect(sorted.map((f) => f.id)).toEqual(['2', '3', '1']);
  });

  test('sort by size largest-first', () => {
    const sorted = sortFiles(files, 'size');
    expect(sorted.map((f) => f.id)).toEqual(['2', '3', '1']);
  });

  test('sort by size with null sizes last', () => {
    const withNull = [
      makeFile({ id: '1', name: 'a.txt', fileSizeBytes: null }),
      makeFile({ id: '2', name: 'b.txt', fileSizeBytes: 500 }),
    ];
    const sorted = sortFiles(withNull, 'size');
    expect(sorted[0].id).toBe('2');
    expect(sorted[1].id).toBe('1');
  });

  test('does not mutate original array', () => {
    const original = [...files];
    sortFiles(files, 'name');
    expect(files.map((f) => f.id)).toEqual(original.map((f) => f.id));
  });
});

// ─── searchFiles ─────────────────────────────────────────────────────────────

describe('searchFiles', () => {
  const files = [
    makeFile({ id: '1', name: 'report.txt', agentName: 'ResearchAgent', tags: ['summary'] }),
    makeFile({ id: '2', name: 'invoice.pdf', agentName: 'BillingAgent', tags: ['finance'] }),
    makeFile({ id: '3', name: 'draft.md', producerKind: 'user' }),
  ];

  test('empty query returns all files', () => {
    expect(searchFiles(files, '')).toHaveLength(3);
    expect(searchFiles(files, '   ')).toHaveLength(3);
  });

  test('matches on file name (case insensitive)', () => {
    const result = searchFiles(files, 'REPORT');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('1');
  });

  test('matches on agent name', () => {
    const result = searchFiles(files, 'billing');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('2');
  });

  test('matches on tag', () => {
    const result = searchFiles(files, 'summary');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('1');
  });

  test('no match returns empty array', () => {
    const result = searchFiles(files, 'xyz_no_match');
    expect(result).toHaveLength(0);
  });

  test('partial substring match on name', () => {
    const result = searchFiles(files, 'inv');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('2');
  });
});
