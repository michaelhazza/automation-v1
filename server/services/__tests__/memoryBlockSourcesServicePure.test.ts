import { describe, test, expect } from 'vitest';
import {
  assembleSourcesPayload,
  type RawSourceDbRow,
} from '../memoryBlockSourcesServicePure.js';

const BASE_DATE = new Date('2026-01-15T10:00:00.000Z');
const BLOCK_ID = 'block-001';
const BLOCK_VERSION_ID = 'version-001';

function makeRow(overrides: Partial<RawSourceDbRow> = {}): RawSourceDbRow {
  return {
    rowId: 'row-001',
    sourceEntryId: 'entry-001',
    sourceEntryIdHash: 'hash-entry-001',
    contentHash: 'hash-content-001',
    sourceType: 'workspace_memory',
    capturedAt: BASE_DATE,
    qualityScoreAtCapture: '0.85',
    contributionRank: 1,
    sourceRunId: 'run-001',
    sourceRunLabelAtCapture: 'Sales Agent · 2026-01-15 10:00',
    entryContent: 'This is a test memory entry content.',
    entryDeletedAt: null,
    runLabel: null,
    ...overrides,
  };
}

describe('assembleSourcesPayload', () => {
  test('source entry present — basic row assembled correctly', () => {
    const rows = [makeRow()];
    const result = assembleSourcesPayload(BLOCK_ID, BLOCK_VERSION_ID, 1, BASE_DATE, rows);

    expect(result.blockId).toBe(BLOCK_ID);
    expect(result.blockVersionId).toBe(BLOCK_VERSION_ID);
    expect(result.versionNumber).toBe(1);
    expect(result.capturedAt).toBe(BASE_DATE.toISOString());
    expect(result.sources).toHaveLength(1);

    const s = result.sources[0];
    expect(s.rowId).toBe('row-001');
    expect(s.sourceEntry).not.toBeNull();
    expect(s.sourceEntry!.id).toBe('entry-001');
    expect(s.sourceEntry!.isDeleted).toBe(false);
    expect(s.sourceEntry!.content).toBe('This is a test memory entry content.');
    expect(s.sourceRun).not.toBeNull();
    expect(s.sourceRun!.id).toBe('run-001');
    expect(s.sourceRun!.label).toBe('Sales Agent · 2026-01-15 10:00');
    expect(s.sourceRun!.isDeleted).toBe(false);
    expect(s.qualityScoreAtCapture).toBeCloseTo(0.85);
    expect(s.contributionRank).toBe(1);
  });

  test('source entry soft-deleted — isDeleted true, content still present', () => {
    const rows = [makeRow({ entryDeletedAt: new Date('2026-02-01T00:00:00Z') })];
    const result = assembleSourcesPayload(BLOCK_ID, BLOCK_VERSION_ID, 1, BASE_DATE, rows);

    expect(result.sources[0].sourceEntry).not.toBeNull();
    expect(result.sources[0].sourceEntry!.isDeleted).toBe(true);
    expect(result.sources[0].sourceEntry!.content).not.toBe('');
  });

  test('source entry hard-deleted — sourceEntry null, deletion-safe fields retained', () => {
    const rows = [makeRow({ sourceEntryId: null, entryContent: null, entryDeletedAt: null })];
    const result = assembleSourcesPayload(BLOCK_ID, BLOCK_VERSION_ID, 1, BASE_DATE, rows);

    expect(result.sources[0].sourceEntry).toBeNull();
    // Hash is still retained (deletion-safe)
    expect(result.sources[0].sourceEntryIdHash).toBe('hash-entry-001');
    expect(result.sources[0].contentHash).toBe('hash-content-001');
  });

  test('source run present — label populated from captured label', () => {
    const rows = [makeRow({ sourceRunLabelAtCapture: 'Support Agent · 2026-01-10 08:30' })];
    const result = assembleSourcesPayload(BLOCK_ID, BLOCK_VERSION_ID, 1, BASE_DATE, rows);
    expect(result.sources[0].sourceRun).not.toBeNull();
    expect(result.sources[0].sourceRun!.label).toBe('Support Agent · 2026-01-10 08:30');
    expect(result.sources[0].sourceRun!.id).toBe('run-001');
    expect(result.sources[0].sourceRunLabelAtCapture).toBe('Support Agent · 2026-01-10 08:30');
  });

  test('source run absent — sourceRun null, fallback label null', () => {
    const rows = [makeRow({ sourceRunId: null, sourceRunLabelAtCapture: null })];
    const result = assembleSourcesPayload(BLOCK_ID, BLOCK_VERSION_ID, 1, BASE_DATE, rows);
    expect(result.sources[0].sourceRun).toBeNull();
    expect(result.sources[0].sourceRunLabelAtCapture).toBeNull();
  });

  test('both source entry and run absent — all nested fields null', () => {
    const rows = [makeRow({
      sourceEntryId: null,
      entryContent: null,
      entryDeletedAt: null,
      sourceRunId: null,
      sourceRunLabelAtCapture: null,
    })];
    const result = assembleSourcesPayload(BLOCK_ID, BLOCK_VERSION_ID, 1, BASE_DATE, rows);
    expect(result.sources[0].sourceEntry).toBeNull();
    expect(result.sources[0].sourceRun).toBeNull();
    expect(result.sources[0].sourceRunLabelAtCapture).toBeNull();
  });

  test('reverse-lineage map population — usedInOtherBlocksCount and reverseLineageByEntry populated', () => {
    const rows = [makeRow({ sourceEntryIdHash: 'hash-abc' })];
    const reverseCounts = new Map([['hash-abc', 5]]);
    const result = assembleSourcesPayload(BLOCK_ID, BLOCK_VERSION_ID, 1, BASE_DATE, rows, reverseCounts);

    expect(result.sources[0].usedInOtherBlocksCount).toBe(5);
    expect(result.reverseLineageByEntry).toBeDefined();
    expect(result.reverseLineageByEntry!['hash-abc']).toBe(5);
  });

  test('empty input — returns empty sources array with top-level fields', () => {
    const result = assembleSourcesPayload(BLOCK_ID, BLOCK_VERSION_ID, null, BASE_DATE, []);
    expect(result.sources).toHaveLength(0);
    expect(result.blockVersionId).toBe(BLOCK_VERSION_ID);
    expect(result.capturedAt).toBe(BASE_DATE.toISOString());
    expect(result.versionNumber).toBeNull();
    expect(result.reverseLineageByEntry).toBeUndefined();
  });

  test('no reverse map — reverseLineageByEntry absent from payload', () => {
    const rows = [makeRow()];
    const result = assembleSourcesPayload(BLOCK_ID, BLOCK_VERSION_ID, 1, BASE_DATE, rows);
    expect(result.reverseLineageByEntry).toBeUndefined();
    expect(result.sources[0].usedInOtherBlocksCount).toBeUndefined();
  });

  test('qualityScoreAtCapture null — passes through as null', () => {
    const rows = [makeRow({ qualityScoreAtCapture: null })];
    const result = assembleSourcesPayload(BLOCK_ID, BLOCK_VERSION_ID, 1, BASE_DATE, rows);
    expect(result.sources[0].qualityScoreAtCapture).toBeNull();
  });

  test('no version metadata — blockVersionId and capturedAt pass through as null', () => {
    // Empty-versions early return path: block exists but has zero version rows
    // (legacy blocks predating version tracking). Nulls are passed instead of
    // fabricated sentinels so consumers can distinguish "no version" from a
    // real version captured at epoch. Per dual-reviewer Codex finding
    // 2026-05-13 iteration 3 (P2 accept).
    const result = assembleSourcesPayload(BLOCK_ID, null, null, null, []);
    expect(result.blockVersionId).toBeNull();
    expect(result.capturedAt).toBeNull();
    expect(result.versionNumber).toBeNull();
    expect(result.sources).toHaveLength(0);
  });
});
