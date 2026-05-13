// Pure payload assembler for memory block sources (spec §6.1).
// Zero DB imports — all DB logic lives in memoryBlockSourcesService.ts.

export interface RawSourceDbRow {
  rowId: string;
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
  // Reserved for future LEFT JOIN on agent_runs; currently always null
  // because agent_runs has no label column — use sourceRunLabelAtCapture instead.
  runLabel: string | null;
  /** Count of other blocks that used this entry (populated when include_reverse=true). */
  usedInOtherBlocksCount?: number;
}

export interface MemoryBlockSourcesPayload {
  blockId: string;
  // Null when the block has no version rows (legacy blocks predating version
  // tracking). The Sources tab UI short-circuits on empty `sources` and never
  // renders top-level version metadata in that case, so null is preferable
  // to a fabricated sentinel value for API consumers.
  blockVersionId: string | null;
  versionNumber: number | null;
  // ISO timestamp of the block version's creation; null when no version exists.
  capturedAt: string | null;
  sources: Array<{
    rowId: string;
    sourceType: string;
    contributionRank: number;
    capturedAt: string;
    qualityScoreAtCapture: number | null;

    // Source entry — present if the source still exists
    sourceEntry: {
      id: string;
      content: string;
      isDeleted: boolean;
    } | null;

    // Source-entry deletion-safe fallback metadata (always present)
    sourceEntryIdHash: string;
    contentHash: string;

    // Run provenance — populated when synthesis time captured a run
    sourceRun: {
      id: string;
      label: string;
      isDeleted: boolean;
    } | null;
    sourceRunLabelAtCapture: string | null;

    // Reverse-lineage (only when include_reverse=true requested)
    usedInOtherBlocksCount?: number;
  }>;

  /** Present only when include_reverse=true was requested. */
  reverseLineageByEntry?: Record<string, number>;
}

export function assembleSourcesPayload(
  blockId: string,
  blockVersionId: string | null,
  versionNumber: number | null,
  blockVersionCapturedAt: Date | null,
  rows: RawSourceDbRow[],
  reverseCounts?: Map<string, number>,
): MemoryBlockSourcesPayload {
  const sources: MemoryBlockSourcesPayload['sources'] = rows.map((row) => {
    const qualityScoreAtCapture =
      row.qualityScoreAtCapture !== null ? parseFloat(row.qualityScoreAtCapture) : null;

    let sourceEntry: MemoryBlockSourcesPayload['sources'][number]['sourceEntry'] = null;
    if (row.sourceEntryId !== null && row.entryContent !== null) {
      sourceEntry = {
        id: row.sourceEntryId,
        content: row.entryContent,
        isDeleted: row.entryDeletedAt !== null,
      };
    } else if (row.sourceEntryId !== null) {
      // Entry exists (FK not null) but content is null — treat as soft-deleted with no content
      sourceEntry = {
        id: row.sourceEntryId,
        content: '',
        isDeleted: true,
      };
    }

    let sourceRun: MemoryBlockSourcesPayload['sources'][number]['sourceRun'] = null;
    if (row.sourceRunId !== null) {
      sourceRun = {
        id: row.sourceRunId,
        label: row.runLabel ?? row.sourceRunLabelAtCapture ?? '',
        isDeleted: false, // agent_runs has no deletedAt; FK SET NULL when deleted
      };
    }

    const sourceItem: MemoryBlockSourcesPayload['sources'][number] = {
      rowId: row.rowId,
      sourceType: row.sourceType,
      contributionRank: row.contributionRank,
      capturedAt: row.capturedAt.toISOString(),
      qualityScoreAtCapture,
      sourceEntry,
      sourceEntryIdHash: row.sourceEntryIdHash,
      contentHash: row.contentHash,
      sourceRun,
      sourceRunLabelAtCapture: row.sourceRunLabelAtCapture,
    };

    if (reverseCounts !== undefined && row.sourceEntryIdHash) {
      sourceItem.usedInOtherBlocksCount = reverseCounts.get(row.sourceEntryIdHash) ?? 0;
    }

    return sourceItem;
  });

  const payload: MemoryBlockSourcesPayload = {
    blockId,
    blockVersionId,
    versionNumber,
    capturedAt: blockVersionCapturedAt !== null ? blockVersionCapturedAt.toISOString() : null,
    sources,
  };

  if (reverseCounts !== undefined) {
    const reverseLineageByEntry: Record<string, number> = {};
    for (const [hash, count] of reverseCounts) {
      reverseLineageByEntry[hash] = count;
    }
    payload.reverseLineageByEntry = reverseLineageByEntry;
  }

  return payload;
}
