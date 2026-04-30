// ---------------------------------------------------------------------------
// conversationThreadContextService.ts — Per-conversation thread context
// (tasks, approach, decisions) with versioned writes and live WebSocket push.
// Spec: Chunk A — Thread Context doc + plan checklist
// ---------------------------------------------------------------------------

import { createHash } from 'crypto';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import { conversationThreadContext } from '../db/schema/index.js';
import { emitConversationUpdate } from '../websocket/emitters.js';
import { logger } from '../lib/logger.js';
import {
  applyPatchToPureState,
  buildReadModelFromState,
  normalizePatch,
} from './conversationThreadContextServicePure.js';
import type {
  ThreadContextPatch,
  ThreadContextPatchResult,
  ThreadContextReadModel,
} from '../../shared/types/conversationThreadContext.js';
import type { ConversationThreadContext } from '../db/schema/conversationThreadContext.js';

// ── Idempotency dedup store (module-level, in-memory, v1) ────────────────────
// Keyed by `${runId}:${sha256(normalizePatch(patch))}`.
// Limitation: does not survive process restarts or work across multiple
// server instances. Acceptable for v1 — the write is idempotent at the
// data level regardless (version not bumped twice), so worst-case the
// duplicate write is a no-op in practice.
const processedIdempotencyKeys = new Map<string, ThreadContextPatchResult>();

// ── Read model builder (exported for route use) ──────────────────────────────

export function buildReadModel(row: ConversationThreadContext): ThreadContextReadModel {
  return buildReadModelFromState({
    decisions: row.decisions ?? [],
    tasks: row.tasks ?? [],
    approach: row.approach,
    version: row.version,
    updatedAt: row.updatedAt,
  });
}

// ── Empty read model (returned when no row exists yet) ───────────────────────

function emptyReadModel(): ThreadContextReadModel {
  return {
    decisions: [],
    approach: '',
    openTasks: [],
    completedTasks: [],
    version: 0,
    updatedAt: new Date().toISOString(),
    rawTasks: [],
    rawDecisions: [],
  };
}

// ── buildThreadContextReadModel ───────────────────────────────────────────────

export async function buildThreadContextReadModel(
  conversationId: string,
  organisationId: string,
): Promise<ThreadContextReadModel> {
  const rows = await db
    .select()
    .from(conversationThreadContext)
    .where(
      and(
        eq(conversationThreadContext.conversationId, conversationId),
        eq(conversationThreadContext.organisationId, organisationId),
      ),
    )
    .limit(1);

  if (rows.length === 0) return emptyReadModel();
  return buildReadModel(rows[0]);
}

// ── applyPatch ────────────────────────────────────────────────────────────────

export async function applyPatch(
  conversationId: string,
  organisationId: string,
  subaccountId: string | null,
  patch: ThreadContextPatch,
  ctx: { runId?: string },
): Promise<ThreadContextPatchResult> {
  const runId = ctx.runId;

  // ── Idempotency check (keyed_write, §6.5) ──────────────────────────────────
  // Only dedup when a runId is present — agent-driven calls always supply one.
  let idempotencyKey: string | null = null;
  if (runId) {
    const patchHash = createHash('sha256')
      .update(JSON.stringify(normalizePatch(patch)))
      .digest('hex');
    idempotencyKey = `${runId}:${patchHash}`;
    const cached = processedIdempotencyKeys.get(idempotencyKey);
    if (cached) {
      return cached;
    }
  }

  // Load or initialise the row
  const existing = await db
    .select()
    .from(conversationThreadContext)
    .where(
      and(
        eq(conversationThreadContext.conversationId, conversationId),
        eq(conversationThreadContext.organisationId, organisationId),
      ),
    )
    .limit(1);

  const current = existing[0] ?? null;
  const currentState = {
    decisions: current?.decisions ?? [],
    tasks: current?.tasks ?? [],
    approach: current?.approach ?? '',
  };

  // Apply patch (throws cap error if needed)
  let pureResult: ReturnType<typeof applyPatchToPureState>;
  try {
    pureResult = applyPatchToPureState(currentState, patch);
  } catch (err: unknown) {
    const capErr = err as { errorCode?: string };
    if (capErr?.errorCode === 'APPROACH_TOO_LONG') {
      // Compute attempted length for the structured log
      let attemptedLength: number;
      if (patch.approach?.replace !== undefined) {
        attemptedLength = patch.approach.replace.length;
      } else if (patch.approach?.appendNote !== undefined) {
        const base = currentState.approach ? `${currentState.approach}\n\n` : '';
        attemptedLength = (base + patch.approach.appendNote).length;
      } else {
        attemptedLength = 0;
      }
      logger.warn('approach_cap_rejected', {
        conversationId,
        runId,
        action: 'approach_cap_rejected',
        currentLength: currentState.approach.length,
        attemptedLength,
      });
    }
    throw err;
  }

  // finalPureResult tracks which pure result's IDs/ops were actually persisted.
  // In the happy path this is pureResult; in the race-retry path it is retryResult.
  let finalPureResult = pureResult;

  const { decisions, tasks, approach } = pureResult;

  const nextVersion = (current?.version ?? 0) + 1;
  const now = new Date();

  let updatedRow: ConversationThreadContext;

  if (current === null) {
    // INSERT new row
    const inserted = await db
      .insert(conversationThreadContext)
      .values({
        conversationId,
        organisationId,
        subaccountId: subaccountId ?? undefined,
        decisions,
        tasks,
        approach,
        version: nextVersion,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning();

    if (inserted.length === 0) {
      // Race condition: another writer beat us — re-load and retry once
      const reloaded = await db
        .select()
        .from(conversationThreadContext)
        .where(
          and(
            eq(conversationThreadContext.conversationId, conversationId),
            eq(conversationThreadContext.organisationId, organisationId),
          ),
        )
        .limit(1);

      if (reloaded.length === 0) {
        throw new Error(`thread_context: failed to insert or find row for conversation ${conversationId}`);
      }

      // Re-apply on top of the concurrent row
      const concurrentState = {
        decisions: reloaded[0].decisions ?? [],
        tasks: reloaded[0].tasks ?? [],
        approach: reloaded[0].approach ?? '',
      };
      const retryResult = applyPatchToPureState(concurrentState, patch);
      // Use retryResult's IDs/ops — pureResult's UUIDs were never persisted
      finalPureResult = retryResult;
      const retryVersion = reloaded[0].version + 1;

      const updated = await db
        .update(conversationThreadContext)
        .set({
          decisions: retryResult.decisions,
          tasks: retryResult.tasks,
          approach: retryResult.approach,
          version: retryVersion,
          updatedAt: now,
        })
        .where(eq(conversationThreadContext.id, reloaded[0].id))
        .returning();

      updatedRow = updated[0];
    } else {
      updatedRow = inserted[0];
    }
  } else {
    // UPDATE existing row
    const updated = await db
      .update(conversationThreadContext)
      .set({
        decisions,
        tasks,
        approach,
        version: nextVersion,
        updatedAt: now,
      })
      .where(eq(conversationThreadContext.id, current.id))
      .returning();

    updatedRow = updated[0];
  }

  const readModel = buildReadModel(updatedRow);

  // Structured log
  logger.info('thread_context_patched', {
    conversationId,
    runId,
    version: updatedRow.version,
    action: 'thread_context_patched',
    opsApplied: finalPureResult.opsApplied,
  });

  // Log no-op removes (spec: silent no-op + structured log)
  if (finalPureResult.noOpRemovedIds.length > 0) {
    logger.info('thread_context_noop_remove', {
      conversationId,
      runId,
      noOpRemovedIds: finalPureResult.noOpRemovedIds,
      action: 'thread_context_noop_remove',
    });
  }

  // Emit live update
  emitConversationUpdate(
    conversationId,
    'conversation:thread_context_updated',
    readModel as unknown as Record<string, unknown>,
  );

  const result: ThreadContextPatchResult = {
    version: updatedRow.version,
    createdIds: finalPureResult.createdIds,
    readModel,
  };

  // Store in idempotency cache for future duplicate calls
  if (idempotencyKey) {
    // Evict oldest entry when at capacity to prevent unbounded memory growth
    if (processedIdempotencyKeys.size >= 10_000) {
      const oldestKey = processedIdempotencyKeys.keys().next().value;
      if (oldestKey !== undefined) processedIdempotencyKeys.delete(oldestKey);
    }
    processedIdempotencyKeys.set(idempotencyKey, result);
  }

  return result;
}

// ── Named export object (mirrors conversationService pattern) ─────────────────

export const conversationThreadContextService = {
  buildReadModel,
  buildThreadContextReadModel,
  applyPatch,
};
