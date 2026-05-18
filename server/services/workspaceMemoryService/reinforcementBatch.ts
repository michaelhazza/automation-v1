import { sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { getMemoryConsolidationTierEnabled } from '../../config/featureFlags.js';
import { logger } from '../../lib/logger.js';

// Pure helpers — exported for tests and for inline use in the flusher.
export function shouldFlushByTime(lastFlushMs: number, nowMs: number, intervalMs: number): boolean {
  return (nowMs - lastFlushMs) >= intervalMs;
}

export function shouldFlushByCount(bufferSize: number, threshold: number): boolean {
  return bufferSize >= threshold;
}

export function pruneOldestHalf<T>(map: Map<string, T>): Map<string, T> {
  const entries = Array.from(map.entries());
  const keepFrom = Math.ceil(entries.length / 2);
  return new Map(entries.slice(keepFrom));
}

// Outer key: `${orgId}:${subaccountId}`; inner key: entryId; inner value: accumulated count.
const buffer = new Map<string, Map<string, number>>();
const lastFlush: Record<string, number> = {};
const flushing = new Set<string>();

const FLUSH_INTERVAL_MS = 60_000;
const FLUSH_COUNT_THRESHOLD = 500;
const BUFFER_CAP = 5_000;
const TICK_MS = 1_000;
const DRAIN_TIMEOUT_MS = 10_000;

let tickerHandle: ReturnType<typeof setInterval> | null = null;

export function recordAccess(entryId: string, organisationId: string, subaccountId: string): void {
  try {
    if (!getMemoryConsolidationTierEnabled()) return;
    const tenantKey = `${organisationId}:${subaccountId}`;
    let tenantBucket = buffer.get(tenantKey);
    if (!tenantBucket) {
      tenantBucket = new Map<string, number>();
      buffer.set(tenantKey, tenantBucket);
    }
    tenantBucket.set(entryId, (tenantBucket.get(entryId) ?? 0) + 1);
    if (tenantBucket.size > BUFFER_CAP) {
      const pruned = pruneOldestHalf(tenantBucket);
      buffer.set(tenantKey, pruned);
      logger.warn('reinforcement_batch.buffer_cap_exceeded', { tenantKey, prunedTo: pruned.size });
    }
  } catch {
    // recordAccess must never throw
  }
}

export function startReinforcementBatchFlusher(): void {
  if (tickerHandle !== null) return;
  if (!getMemoryConsolidationTierEnabled()) return;
  tickerHandle = setInterval(() => {
    void flushAll();
  }, TICK_MS);
}

export async function stopReinforcementBatchFlusher(): Promise<void> {
  if (tickerHandle !== null) {
    clearInterval(tickerHandle);
    tickerHandle = null;
  }
  const deadline = Date.now() + DRAIN_TIMEOUT_MS;
  while (flushing.size > 0 && Date.now() < deadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }
}

async function flushAll(): Promise<void> {
  const now = Date.now();
  for (const [tenantKey, tenantBuffer] of buffer.entries()) {
    if (
      !shouldFlushByTime(lastFlush[tenantKey] ?? 0, now, FLUSH_INTERVAL_MS) &&
      !shouldFlushByCount(tenantBuffer.size, FLUSH_COUNT_THRESHOLD)
    ) {
      continue;
    }
    if (flushing.has(tenantKey)) continue;
    flushing.add(tenantKey);
    void flushTenant(tenantKey, tenantBuffer, now);
  }
}

async function flushTenant(
  tenantKey: string,
  tenantBuffer: Map<string, number>,
  now: number,
): Promise<void> {
  const colonIdx = tenantKey.indexOf(':');
  const orgId = tenantKey.slice(0, colonIdx);
  const subaccountId = tenantKey.slice(colonIdx + 1);

  // Snapshot the buffer before the flush so new writes during the async flush
  // are not lost. Clear the live bucket immediately; re-accumulate from the snapshot on error.
  const snapshot = new Map(tenantBuffer);
  buffer.delete(tenantKey);

  const flushStart = Date.now();
  try {
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT set_config('app.organisation_id', ${orgId}, true)`,
      );
      await tx.execute(
        sql`SELECT set_config('app.subaccount_id', ${subaccountId}, true)`,
      );
      for (const [entryId, count] of snapshot.entries()) {
        await tx.execute(sql`
          UPDATE workspace_memory_entries
          SET last_accessed_at = GREATEST(last_accessed_at, now()),
              access_count = access_count + ${count}
          WHERE id = ${entryId}
            AND organisation_id = ${orgId}
            AND subaccount_id = ${subaccountId}
        `);
      }
    });
    lastFlush[tenantKey] = now;
    const flushMs = Date.now() - flushStart;
    logger.info('reinforcement_batch.flush', {
      reinforcement_batch_updates_total: snapshot.size,
      reinforcement_batch_flush_ms: flushMs,
      tenantKey,
    });
  } catch (err) {
    logger.error('reinforcement_batch.flush_failed', { tenantKey, error: err instanceof Error ? err.message : String(err) });
    // Re-merge snapshot back into the live buffer so the next tick retries.
    const existing = buffer.get(tenantKey);
    if (existing) {
      for (const [entryId, count] of snapshot.entries()) {
        existing.set(entryId, (existing.get(entryId) ?? 0) + count);
      }
    } else {
      buffer.set(tenantKey, new Map(snapshot));
    }
  } finally {
    flushing.delete(tenantKey);
  }
}

export const __testing = {
  getBuffer: () => buffer,
  flushNow: async (orgId: string, subaccountId: string): Promise<void> => {
    const tenantKey = `${orgId}:${subaccountId}`;
    const tenantBuffer = buffer.get(tenantKey);
    if (!tenantBuffer || tenantBuffer.size === 0) return;
    await flushTenant(tenantKey, tenantBuffer, Date.now());
  },
};
