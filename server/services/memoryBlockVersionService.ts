/**
 * memoryBlockVersionService — governance affordances (S24)
 *
 * Exposes:
 *   - listVersions(blockId)
 *   - diffVersions(blockId, fromVersion, toVersion)
 *   - diffAgainstCanonical(blockId) — reads docs/agents/*.md for protected blocks
 *   - resetToCanonical(blockId, actorUserId)
 *   - writeVersionRow(blockId, content, changeSource, actorUserId, notes) — internal,
 *     called by memoryBlockService on every content mutation
 *
 * Idempotency: consecutive identical-content versions coalesce (no-op insert).
 *
 * Spec: docs/memory-and-briefings-spec.md §S24
 */

import { readFile } from 'fs/promises';
import { resolve as resolvePath } from 'path';
import { and, desc, eq, isNull, max, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import type { OrgScopedTx } from '../db/index.js';
import {
  memoryBlocks,
  memoryBlockVersions,
} from '../db/schema/index.js';
import type {
  MemoryBlockVersion,
  NewMemoryBlockVersion,
} from '../db/schema/memoryBlockVersions.js';
import { logger } from '../lib/logger.js';

// ---------------------------------------------------------------------------
// Protected block canonical files
// ---------------------------------------------------------------------------

const PROTECTED_BLOCK_CANONICAL_PATHS: Readonly<Record<string, string>> = Object.freeze({
  'config-agent-guidelines': 'docs/agents/config-agent-guidelines.md',
});

/** Keys of all protected blocks. Imported by protectedBlockDivergenceService. */
export const PROTECTED_BLOCK_NAMES: readonly string[] = Object.keys(PROTECTED_BLOCK_CANONICAL_PATHS);

export function getCanonicalPath(blockName: string): string | null {
  return PROTECTED_BLOCK_CANONICAL_PATHS[blockName] ?? null;
}

// ---------------------------------------------------------------------------
// Write path — called from memoryBlockService on every content mutation
// ---------------------------------------------------------------------------

export interface WriteVersionParams {
  blockId: string;
  content: string;
  changeSource: NewMemoryBlockVersion['changeSource'];
  actorUserId?: string | null;
  notes?: string;
  /** Optional transactional DB handle so writes happen atomically. */
  tx?: typeof db | OrgScopedTx;
}

export async function writeVersionRow(params: WriteVersionParams): Promise<MemoryBlockVersion | null> {
  const dbh = params.tx ?? db;

  // Check latest version to coalesce duplicates
  const [latest] = await dbh
    .select({ version: memoryBlockVersions.version, content: memoryBlockVersions.content })
    .from(memoryBlockVersions)
    .where(eq(memoryBlockVersions.memoryBlockId, params.blockId))
    .orderBy(desc(memoryBlockVersions.version))
    .limit(1);

  if (latest && latest.content === params.content) {
    // Consecutive identical content — no-op
    return null;
  }

  const nextVersion = (latest?.version ?? 0) + 1;

  const [inserted] = await dbh
    .insert(memoryBlockVersions)
    .values({
      memoryBlockId: params.blockId,
      content: params.content,
      version: nextVersion,
      createdByUserId: params.actorUserId ?? null,
      changeSource: params.changeSource,
      notes: params.notes,
    })
    .returning();

  if (inserted) {
    // Keep activeVersionId in sync. All callers (memoryBlockService content
    // mutations, resetToCanonical) share this path so the pointer is always
    // authoritative — no caller needs to resolve "latest by timestamp".
    await dbh
      .update(memoryBlocks)
      .set({ activeVersionId: inserted.id })
      .where(eq(memoryBlocks.id, params.blockId));
  }

  return inserted ?? null;
}

// ---------------------------------------------------------------------------
// Authz helper — used by routes to validate block belongs to org
// ---------------------------------------------------------------------------

/**
 * Throws { statusCode: 404 } if the block is not found in the organisation
 * or has been soft-deleted. Routes use this instead of accessing `db` directly.
 */
export async function ensureBlockInOrg(blockId: string, organisationId: string): Promise<void> {
  const [row] = await db
    .select({ id: memoryBlocks.id })
    .from(memoryBlocks)
    .where(
      and(
        eq(memoryBlocks.id, blockId),
        eq(memoryBlocks.organisationId, organisationId),
        isNull(memoryBlocks.deletedAt),
      ),
    )
    .limit(1);

  if (!row) throw { statusCode: 404, message: 'Block not found' };
}

// ---------------------------------------------------------------------------
// Read path
// ---------------------------------------------------------------------------

export async function listVersions(blockId: string): Promise<MemoryBlockVersion[]> {
  return db
    .select()
    .from(memoryBlockVersions)
    .where(eq(memoryBlockVersions.memoryBlockId, blockId))
    .orderBy(desc(memoryBlockVersions.version));
}

export interface DiffResult {
  fromVersion: number;
  toVersion: number;
  fromContent: string;
  toContent: string;
  /** Simple unified line-level diff. Use the `diff` package if richer output needed. */
  unifiedDiff: string;
}

export async function diffVersions(
  blockId: string,
  fromVersion: number,
  toVersion: number,
): Promise<DiffResult> {
  const [fromRow] = await db
    .select()
    .from(memoryBlockVersions)
    .where(
      and(
        eq(memoryBlockVersions.memoryBlockId, blockId),
        eq(memoryBlockVersions.version, fromVersion),
      ),
    )
    .limit(1);

  const [toRow] = await db
    .select()
    .from(memoryBlockVersions)
    .where(
      and(
        eq(memoryBlockVersions.memoryBlockId, blockId),
        eq(memoryBlockVersions.version, toVersion),
      ),
    )
    .limit(1);

  if (!fromRow || !toRow) {
    throw { statusCode: 404, message: 'Version not found' };
  }

  return {
    fromVersion,
    toVersion,
    fromContent: fromRow.content,
    toContent: toRow.content,
    unifiedDiff: simpleUnifiedDiff(fromRow.content, toRow.content),
  };
}

export interface DiffCanonicalResult {
  blockId: string;
  blockName: string;
  canonicalPath: string;
  dbContent: string;
  canonicalContent: string;
  diverges: boolean;
  unifiedDiff: string;
}

export async function diffAgainstCanonical(
  blockId: string,
  organisationId: string,
): Promise<DiffCanonicalResult | null> {
  const [block] = await db
    .select({ id: memoryBlocks.id, name: memoryBlocks.name, content: memoryBlocks.content })
    .from(memoryBlocks)
    .where(and(eq(memoryBlocks.id, blockId), eq(memoryBlocks.organisationId, organisationId), isNull(memoryBlocks.deletedAt)))
    .limit(1);

  if (!block) throw { statusCode: 404, message: 'Block not found' };

  const canonicalPath = getCanonicalPath(block.name);
  if (!canonicalPath) return null; // not a protected block

  const abs = resolvePath(process.cwd(), canonicalPath);
  let canonicalContent: string;
  try {
    canonicalContent = await readFile(abs, 'utf-8');
  } catch {
    throw { statusCode: 503, message: 'Canonical file unavailable — cannot diff.', errorCode: 'CANONICAL_FILE_MISSING' };
  }

  return {
    blockId: block.id,
    blockName: block.name,
    canonicalPath,
    dbContent: block.content,
    canonicalContent,
    diverges: block.content !== canonicalContent,
    unifiedDiff: simpleUnifiedDiff(canonicalContent, block.content),
  };
}

// ---------------------------------------------------------------------------
// Reset to canonical
// ---------------------------------------------------------------------------

export interface ResetToCanonicalInput {
  blockId: string;
  organisationId: string;
  actorUserId: string;
}

export interface ResetToCanonicalResult {
  blockId: string;
  previousContent: string;
  canonicalContent: string;
  versionWritten: MemoryBlockVersion | null;
}

export async function resetToCanonical(
  input: ResetToCanonicalInput,
): Promise<ResetToCanonicalResult> {
  const [block] = await db
    .select({ id: memoryBlocks.id, name: memoryBlocks.name, content: memoryBlocks.content })
    .from(memoryBlocks)
    .where(
      and(
        eq(memoryBlocks.id, input.blockId),
        eq(memoryBlocks.organisationId, input.organisationId),
        isNull(memoryBlocks.deletedAt),
      ),
    )
    .limit(1);

  if (!block) throw { statusCode: 404, message: 'Block not found' };

  const canonicalPath = getCanonicalPath(block.name);
  if (!canonicalPath) {
    throw {
      statusCode: 400,
      message: `Block '${block.name}' is not a protected block — no canonical file to reset from.`,
      errorCode: 'NOT_PROTECTED_BLOCK',
    };
  }

  const abs = resolvePath(process.cwd(), canonicalPath);
  let canonicalContent: string;
  try {
    canonicalContent = await readFile(abs, 'utf-8');
  } catch {
    throw { statusCode: 503, message: 'Canonical file unavailable — cannot reset.', errorCode: 'CANONICAL_FILE_MISSING' };
  }

  // Transaction: update block content + write version row + clear divergence flag
  let versionWritten: MemoryBlockVersion | null = null;

  await db.transaction(async (tx) => {
    await tx
      .update(memoryBlocks)
      .set({
        content: canonicalContent,
        divergenceDetectedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(memoryBlocks.id, block.id));

    versionWritten = await writeVersionRow({
      blockId: block.id,
      content: canonicalContent,
      changeSource: 'reset_to_canonical',
      actorUserId: input.actorUserId,
      notes: `Reset from ${canonicalPath}`,
      tx,
    });
  });

  logger.info('memoryBlockVersionService.reset_to_canonical', {
    blockId: block.id,
    blockName: block.name,
    actorUserId: input.actorUserId,
  });

  return {
    blockId: block.id,
    previousContent: block.content,
    canonicalContent,
    versionWritten,
  };
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Very simple line-level diff marker. Replace with a proper unified-diff
 * renderer (via the `diff` npm package, which is already a dependency) when
 * richer output is wanted.
 */
function simpleUnifiedDiff(a: string, b: string): string {
  const aLines = a.split('\n');
  const bLines = b.split('\n');
  const out: string[] = [];
  const max = Math.max(aLines.length, bLines.length);
  for (let i = 0; i < max; i++) {
    const la = aLines[i] ?? '';
    const lb = bLines[i] ?? '';
    if (la === lb) {
      out.push(`  ${la}`);
    } else {
      if (la) out.push(`- ${la}`);
      if (lb) out.push(`+ ${lb}`);
    }
  }
  return out.join('\n');
}

// Touch imports so they stay active for future enrichment
void max;
void sql;
