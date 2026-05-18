import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
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

  // Resolve the block (excluding soft-deleted blocks — ChatGPT R1 T1)
  // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
  const [blockRow] = await db
    .select({ id: memoryBlocks.id })
    .from(memoryBlocks)
    .where(
      and(
        eq(memoryBlocks.id, blockId),
        eq(memoryBlocks.organisationId, organisationId),
        isNull(memoryBlocks.deletedAt),
      ),
    );

  if (!blockRow) {
    throw { statusCode: 404, message: 'Block not found', errorCode: 'BLOCK_NOT_FOUND' };
  }

  // Resolve the target version
  let blockVersionId: string;
  let resolvedVersionNumber: number | null;
  let blockVersionCapturedAt: Date;
  // Note: the empty-versions early return (block exists but has zero version
  // rows — only reachable for legacy blocks predating version tracking) passes
  // nulls directly to assembleSourcesPayload instead of populating these.

  if (opts.version != null) {
    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
    const [vRow] = await db
      .select({
        id: memoryBlockVersions.id,
        version: memoryBlockVersions.version,
        createdAt: memoryBlockVersions.createdAt,
      })
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
    blockVersionCapturedAt = vRow.createdAt;
  } else {
    // Default: latest version
    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
    const [latestVersion] = await db
      .select({
        id: memoryBlockVersions.id,
        version: memoryBlockVersions.version,
        createdAt: memoryBlockVersions.createdAt,
      })
      .from(memoryBlockVersions)
      .where(eq(memoryBlockVersions.memoryBlockId, blockId))
      .orderBy(sql`${memoryBlockVersions.version} DESC`)
      .limit(1);

    if (!latestVersion) {
      // Block exists but has no version rows — return empty sources with null
      // version metadata so consumers can distinguish "no version" from a real
      // version captured at epoch. The Sources tab UI short-circuits on
      // sources.length === 0 and never reads these top-level fields.
      return assembleSourcesPayload(blockId, null, null, null, []);
    }
    blockVersionId = latestVersion.id;
    resolvedVersionNumber = latestVersion.version;
    blockVersionCapturedAt = latestVersion.createdAt;
  }

  // Fetch lineage rows with LEFT JOIN on workspace_memory_entries
  // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
  const rawRows = await db
    .select({
      rowId: memoryBlockVersionSources.id,
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
    rowId: r.rowId,
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
    runLabel: null, // agent_runs has no label column; captured label is the display value
  }));

  // Optionally compute reverse-lineage counts (index-covered via idx_mbvs_source_entry_hash).
  // The UI label is "Used in N other blocks" — count distinct memory_block_id
  // (NOT distinct block_version_id, which over-counts when one block has
  // multiple versions citing the same entry) and exclude the current block
  // (ChatGPT R1 F4).
  let reverseCounts: Map<string, number> | undefined;
  if (opts.includeReverse && typedRows.length > 0) {
    const hashes = [...new Set(typedRows.map((r) => r.sourceEntryIdHash))];
    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
    const reverseRows = await db
      .select({
        sourceEntryIdHash: memoryBlockVersionSources.sourceEntryIdHash,
        count: sql<number>`COUNT(DISTINCT ${memoryBlockVersions.memoryBlockId})::int`,
      })
      .from(memoryBlockVersionSources)
      .innerJoin(
        memoryBlockVersions,
        eq(memoryBlockVersionSources.blockVersionId, memoryBlockVersions.id),
      )
      .where(
        and(
          inArray(memoryBlockVersionSources.sourceEntryIdHash, hashes),
          ne(memoryBlockVersions.memoryBlockId, blockId),
        ),
      )
      .groupBy(memoryBlockVersionSources.sourceEntryIdHash);

    reverseCounts = new Map(reverseRows.map((r) => [r.sourceEntryIdHash, r.count]));
  }

  return assembleSourcesPayload(
    blockId,
    blockVersionId,
    resolvedVersionNumber,
    blockVersionCapturedAt,
    typedRows,
    reverseCounts,
  );
}
