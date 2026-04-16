/**
 * protectedBlockDivergenceService — daily divergence detection (§S24)
 *
 * Walks every protected block (name is in the canonical registry) and
 * compares DB content against the canonical file. Sets
 * `memory_blocks.divergence_detected_at` when content differs; clears it
 * when aligned.
 *
 * Runs via pg-boss daily. UI renders a banner when divergence_detected_at
 * is non-null.
 *
 * Spec: docs/memory-and-briefings-spec.md §S24
 */

import { readFile } from 'fs/promises';
import { resolve as resolvePath } from 'path';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { memoryBlocks } from '../db/schema/index.js';
import { getCanonicalPath } from './memoryBlockVersionService.js';
import { logger } from '../lib/logger.js';

const PROTECTED_BLOCK_NAMES = ['config-agent-guidelines'] as const;

export interface DivergenceSweepSummary {
  scanned: number;
  diverged: number;
  aligned: number;
  failed: number;
  durationMs: number;
}

export async function runDivergenceSweep(): Promise<DivergenceSweepSummary> {
  const started = Date.now();
  let scanned = 0;
  let diverged = 0;
  let aligned = 0;
  let failed = 0;
  const now = new Date();

  for (const name of PROTECTED_BLOCK_NAMES) {
    const canonicalPath = getCanonicalPath(name);
    if (!canonicalPath) continue;

    let canonicalContent: string;
    try {
      canonicalContent = await readFile(
        resolvePath(process.cwd(), canonicalPath),
        'utf-8',
      );
    } catch (err) {
      logger.error('protectedBlockDivergenceService.canonical_read_failed', {
        name,
        canonicalPath,
        error: err instanceof Error ? err.message : String(err),
      });
      failed += 1;
      continue;
    }

    const rows = await db
      .select({
        id: memoryBlocks.id,
        content: memoryBlocks.content,
        divergenceDetectedAt: memoryBlocks.divergenceDetectedAt,
      })
      .from(memoryBlocks)
      .where(and(eq(memoryBlocks.name, name), isNull(memoryBlocks.deletedAt)));

    for (const row of rows) {
      scanned += 1;
      const diverges = row.content !== canonicalContent;

      if (diverges && !row.divergenceDetectedAt) {
        await db
          .update(memoryBlocks)
          .set({ divergenceDetectedAt: now })
          .where(eq(memoryBlocks.id, row.id));
        diverged += 1;
        logger.warn('protectedBlockDivergenceService.diverged', {
          blockId: row.id,
          blockName: name,
        });
      } else if (!diverges && row.divergenceDetectedAt) {
        await db
          .update(memoryBlocks)
          .set({ divergenceDetectedAt: null })
          .where(eq(memoryBlocks.id, row.id));
        aligned += 1;
        logger.info('protectedBlockDivergenceService.realigned', {
          blockId: row.id,
          blockName: name,
        });
      }
    }
  }

  const summary: DivergenceSweepSummary = {
    scanned,
    diverged,
    aligned,
    failed,
    durationMs: Date.now() - started,
  };

  logger.info('protectedBlockDivergenceService.sweep_complete', { ...summary });
  return summary;
}
