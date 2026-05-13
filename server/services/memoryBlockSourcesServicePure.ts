// Pure payload assembler for memory block sources (spec §6.1).
// Zero DB imports — all DB logic lives in memoryBlockSourcesService.ts.

export interface SourceRow {
  sourceEntryId: string | null;
  sourceEntryIdHash: string;
  contentHash: string;
  sourceType: string;
  capturedAt: string;
  qualityScoreAtCapture: string | null;
  contributionRank: number;
  sourceRunId: string | null;
  sourceRunLabel: string | null;
  /** Excerpt of current entry content; null when entry hard-deleted. */
  contentExcerpt: string | null;
  /** True when the entry exists but has been soft-deleted. */
  isDeleted: boolean;
  /** Count of other blocks that used this entry (populated when include_reverse=true). */
  usedInOtherBlocksCount?: number;
}

export interface MemoryBlockSourcesPayload {
  blockId: string;
  blockSource: string;
  versionNumber: number | null;
  sources: SourceRow[];
  /** Present only when include_reverse=true was requested. */
  reverseLineageByEntry?: Record<string, number>;
}

export interface RawSourceDbRow {
  sourceEntryId: string | null;
  sourceEntryIdHash: string;
  contentHash: string;
  sourceType: string;
  capturedAt: Date;
  qualityScoreAtCapture: string | null;
  contributionRank: number;
  sourceRunId: string | null;
  sourceRunLabelAtCapture: string | null;
  // Fields from LEFT JOIN on workspace_memory_entries
  entryContent: string | null;
  entryDeletedAt: Date | null;
}

export function assembleSourcesPayload(
  blockId: string,
  blockSource: string,
  versionNumber: number | null,
  rows: RawSourceDbRow[],
  reverseCounts?: Map<string, number>,
): MemoryBlockSourcesPayload {
  const sources: SourceRow[] = rows.map((row) => {
    const isDeleted = row.entryDeletedAt !== null;
    const contentExcerpt =
      row.entryContent !== null
        ? row.entryContent.slice(0, 120)
        : null;

    const sourceRow: SourceRow = {
      sourceEntryId: row.sourceEntryId,
      sourceEntryIdHash: row.sourceEntryIdHash,
      contentHash: row.contentHash,
      sourceType: row.sourceType,
      capturedAt: row.capturedAt.toISOString(),
      qualityScoreAtCapture: row.qualityScoreAtCapture,
      contributionRank: row.contributionRank,
      sourceRunId: row.sourceRunId,
      sourceRunLabel: row.sourceRunLabelAtCapture,
      contentExcerpt,
      isDeleted,
    };

    if (reverseCounts && row.sourceEntryIdHash) {
      sourceRow.usedInOtherBlocksCount = reverseCounts.get(row.sourceEntryIdHash) ?? 0;
    }

    return sourceRow;
  });

  const payload: MemoryBlockSourcesPayload = {
    blockId,
    blockSource,
    versionNumber,
    sources,
  };

  if (reverseCounts) {
    const reverseLineageByEntry: Record<string, number> = {};
    for (const [hash, count] of reverseCounts) {
      reverseLineageByEntry[hash] = count;
    }
    payload.reverseLineageByEntry = reverseLineageByEntry;
  }

  return payload;
}
