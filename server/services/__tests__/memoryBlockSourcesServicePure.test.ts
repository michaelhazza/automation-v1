import { describe, test, expect } from 'vitest';
import {
  assembleSourcesPayload,
  type RawSourceDbRow,
} from '../memoryBlockSourcesServicePure.js';

const BASE_DATE = new Date('2026-01-15T10:00:00.000Z');
const BLOCK_ID = 'block-001';
const BLOCK_SOURCE = 'auto_synthesised';

function makeRow(overrides: Partial<RawSourceDbRow> = {}): RawSourceDbRow {
  return {
    sourceEntryId: 'entry-001',
    sourceEntryIdHash: 'hash-entry-001',
    contentHash: 'hash-content-001',
    sourceType: 'workspace_memory',
    capturedAt: BASE_DATE,
    qualityScoreAtCapture: '0.85',
    contributionRank: 1,
    sourceRunId: 'run-001',
    sourceRunLabelAtCapture: 'Sales Agent · 2026-01-15 10:00',
    entryContent: 'This is a test memory entry content that is longer than 120 characters to test the excerpt truncation behavior properly.',
    entryDeletedAt: null,
    ...overrides,
  };
}

describe('assembleSourcesPayload', () => {
  test('source entry present — basic row assembled correctly', () => {
    const rows = [makeRow()];
    const result = assembleSourcesPayload(BLOCK_ID, BLOCK_SOURCE, 1, rows);

    expect(result.blockId).toBe(BLOCK_ID);
    expect(result.blockSource).toBe(BLOCK_SOURCE);
    expect(result.versionNumber).toBe(1);
    expect(result.sources).toHaveLength(1);

    const s = result.sources[0];
    expect(s.sourceEntryId).toBe('entry-001');
    expect(s.isDeleted).toBe(false);
    expect(s.sourceRunLabel).toBe('Sales Agent · 2026-01-15 10:00');
    expect(s.contentExcerpt).toHaveLength(120);
    expect(s.contributionRank).toBe(1);
  });

  test('source entry soft-deleted — isDeleted true, content excerpt still present', () => {
    const rows = [makeRow({ entryDeletedAt: new Date('2026-02-01T00:00:00Z') })];
    const result = assembleSourcesPayload(BLOCK_ID, BLOCK_SOURCE, 1, rows);

    expect(result.sources[0].isDeleted).toBe(true);
    expect(result.sources[0].contentExcerpt).not.toBeNull();
  });

  test('source entry hard-deleted — sourceEntryId null, contentExcerpt null', () => {
    const rows = [makeRow({ sourceEntryId: null, entryContent: null, entryDeletedAt: null })];
    const result = assembleSourcesPayload(BLOCK_ID, BLOCK_SOURCE, 1, rows);

    expect(result.sources[0].sourceEntryId).toBeNull();
    expect(result.sources[0].contentExcerpt).toBeNull();
    expect(result.sources[0].isDeleted).toBe(false);
    // Hash is still retained (deletion-safe)
    expect(result.sources[0].sourceEntryIdHash).toBe('hash-entry-001');
  });

  test('source run present — label populated', () => {
    const rows = [makeRow({ sourceRunLabelAtCapture: 'Support Agent · 2026-01-10 08:30' })];
    const result = assembleSourcesPayload(BLOCK_ID, BLOCK_SOURCE, 1, rows);
    expect(result.sources[0].sourceRunLabel).toBe('Support Agent · 2026-01-10 08:30');
    expect(result.sources[0].sourceRunId).toBe('run-001');
  });

  test('source run absent — label and runId null', () => {
    const rows = [makeRow({ sourceRunId: null, sourceRunLabelAtCapture: null })];
    const result = assembleSourcesPayload(BLOCK_ID, BLOCK_SOURCE, 1, rows);
    expect(result.sources[0].sourceRunLabel).toBeNull();
    expect(result.sources[0].sourceRunId).toBeNull();
  });

  test('both source entry and run absent — all null identifiers', () => {
    const rows = [makeRow({
      sourceEntryId: null,
      entryContent: null,
      entryDeletedAt: null,
      sourceRunId: null,
      sourceRunLabelAtCapture: null,
    })];
    const result = assembleSourcesPayload(BLOCK_ID, BLOCK_SOURCE, 1, rows);
    expect(result.sources[0].sourceEntryId).toBeNull();
    expect(result.sources[0].sourceRunId).toBeNull();
    expect(result.sources[0].contentExcerpt).toBeNull();
  });

  test('reverse-lineage map population — usedInOtherBlocksCount and reverseLineageByEntry populated', () => {
    const rows = [makeRow({ sourceEntryIdHash: 'hash-abc' })];
    const reverseCounts = new Map([['hash-abc', 5]]);
    const result = assembleSourcesPayload(BLOCK_ID, BLOCK_SOURCE, 1, rows, reverseCounts);

    expect(result.sources[0].usedInOtherBlocksCount).toBe(5);
    expect(result.reverseLineageByEntry).toBeDefined();
    expect(result.reverseLineageByEntry!['hash-abc']).toBe(5);
  });

  test('empty input — returns empty sources array', () => {
    const result = assembleSourcesPayload(BLOCK_ID, BLOCK_SOURCE, null, []);
    expect(result.sources).toHaveLength(0);
    expect(result.versionNumber).toBeNull();
    expect(result.reverseLineageByEntry).toBeUndefined();
  });

  test('no reverse map — reverseLineageByEntry absent from payload', () => {
    const rows = [makeRow()];
    const result = assembleSourcesPayload(BLOCK_ID, BLOCK_SOURCE, 1, rows);
    expect(result.reverseLineageByEntry).toBeUndefined();
    expect(result.sources[0].usedInOtherBlocksCount).toBeUndefined();
  });
});
