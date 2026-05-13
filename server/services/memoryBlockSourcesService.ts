import { and, eq, inArray, sql } from 'drizzle-orm';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import {
  memoryBlockVersionSources,
  memoryBlockVersions,
  memoryBlocks,
  workspaceMemoryEntries,
} from '../db/schema/index.js';
import {
  assembleSourcesPayload,
  type MemoryBlockSourcesPayload,
  type RawSourceDbRow,
} from './memoryBlockSourcesServicePure.js';

interface GetSourcesOpts {
  version?: number;
  includeReverse?: boolean;
}

export async function getSourcesForBlock(
  blockId: string,
  organisationId: string,
  opts: GetSourcesOpts = {},
): Promise<MemoryBlockSourcesPayload> {
  const db = getOrgScopedDb('memoryBlockSourcesService');

  // Resolve the block and its source field
  const [blockRow] = await db
    .select({ source: memoryBlocks.source })
    .from(memoryBlocks)
    .where(and(eq(memoryBlocks.id, blockId), eq(memoryBlocks.organisationId, organisationId)));

  if (!blockRow) {
    throw { statusCode: 404, message: 'Block not found', errorCode: 'BLOCK_NOT_FOUND' };
  }

  // Resolve the target version
  let blockVersionId: string;
  let resolvedVersionNumber: number | null;

  if (opts.version != null) {
    const [vRow] = await db
      .select({ id: memoryBlockVersions.id, version: memoryBlockVersions.version })
      .from(memoryBlockVersions)
      .where(
        and(
          eq(memoryBlockVersions.memoryBlockId, blockId),
          eq(memoryBlockVersions.version, opts.version),
        ),
      );
    if (!vRow) {
      throw { statusCode: 404, message: 'Block version not found', errorCode: 'BLOCK_NOT_FOUND' };
    }
    blockVersionId = vRow.id;
    resolvedVersionNumber = vRow.version;
  } else {
    // Default: latest version
    const [latestVersion] = await db
      .select({ id: memoryBlockVersions.id, version: memoryBlockVersions.version })
      .from(memoryBlockVersions)
      .where(eq(memoryBlockVersions.memoryBlockId, blockId))
      .orderBy(sql`${memoryBlockVersions.version} DESC`)
      .limit(1);

    if (!latestVersion) {
      // Block exists but has no version rows — return empty sources
      return assembleSourcesPayload(blockId, blockRow.source, null, []);
    }
    blockVersionId = latestVersion.id;
    resolvedVersionNumber = latestVersion.version;
  }

  // Fetch lineage rows with LEFT JOIN on workspace_memory_entries
  const rawRows = await db
    .select({
      sourceEntryId: memoryBlockVersionSources.sourceEntryId,
      sourceEntryIdHash: memoryBlockVersionSources.sourceEntryIdHash,
      contentHash: memoryBlockVersionSources.contentHash,
      sourceType: memoryBlockVersionSources.sourceType,
      capturedAt: memoryBlockVersionSources.capturedAt,
      qualityScoreAtCapture: memoryBlockVersionSources.qualityScoreAtCapture,
      contributionRank: memoryBlockVersionSources.contributionRank,
      sourceRunId: memoryBlockVersionSources.sourceRunId,
      sourceRunLabelAtCapture: memoryBlockVersionSources.sourceRunLabelAtCapture,
      entryContent: workspaceMemoryEntries.content,
      entryDeletedAt: workspaceMemoryEntries.deletedAt,
    })
    .from(memoryBlockVersionSources)
    .leftJoin(
      workspaceMemoryEntries,
      eq(memoryBlockVersionSources.sourceEntryId, workspaceMemoryEntries.id),
    )
    .where(eq(memoryBlockVersionSources.blockVersionId, blockVersionId))
    .orderBy(memoryBlockVersionSources.contributionRank);

  const typedRows: RawSourceDbRow[] = rawRows.map((r) => ({
    sourceEntryId: r.sourceEntryId ?? null,
    sourceEntryIdHash: r.sourceEntryIdHash,
    contentHash: r.contentHash,
    sourceType: r.sourceType,
    capturedAt: r.capturedAt,
    qualityScoreAtCapture: r.qualityScoreAtCapture ?? null,
    contributionRank: r.contributionRank,
    sourceRunId: r.sourceRunId ?? null,
    sourceRunLabelAtCapture: r.sourceRunLabelAtCapture ?? null,
    entryContent: r.entryContent ?? null,
    entryDeletedAt: r.entryDeletedAt ?? null,
  }));

  // Optionally compute reverse-lineage counts (index-covered via idx_mbvs_source_entry_hash)
  let reverseCounts: Map<string, number> | undefined;
  if (opts.includeReverse && typedRows.length > 0) {
    const hashes = [...new Set(typedRows.map((r) => r.sourceEntryIdHash))];
    const reverseRows = await db
      .select({
        sourceEntryIdHash: memoryBlockVersionSources.sourceEntryIdHash,
        count: sql<number>`COUNT(DISTINCT ${memoryBlockVersionSources.blockVersionId})::int`,
      })
      .from(memoryBlockVersionSources)
      .where(inArray(memoryBlockVersionSources.sourceEntryIdHash, hashes))
      .groupBy(memoryBlockVersionSources.sourceEntryIdHash);

    reverseCounts = new Map(reverseRows.map((r) => [r.sourceEntryIdHash, r.count]));
  }

  return assembleSourcesPayload(
    blockId,
    blockRow.source,
    resolvedVersionNumber,
    typedRows,
    reverseCounts,
  );
}
