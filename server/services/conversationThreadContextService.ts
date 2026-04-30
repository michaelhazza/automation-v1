// ---------------------------------------------------------------------------
// conversationThreadContextService.ts — Per-conversation thread context
// (tasks, approach, decisions) with versioned writes and live WebSocket push.
// Spec: Chunk A — Thread Context doc + plan checklist
// ---------------------------------------------------------------------------

import { eq, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import { conversationThreadContext } from '../db/schema/index.js';
import { emitConversationUpdate } from '../websocket/emitters.js';
import { logger } from '../lib/logger.js';
import {
  applyPatchToPureState,
  buildReadModelFromState,
} from './conversationThreadContextServicePure.js';
import type {
  ThreadContextPatch,
  ThreadContextPatchResult,
  ThreadContextReadModel,
} from '../../shared/types/conversationThreadContext.js';
import type { ConversationThreadContext } from '../db/schema/conversationThreadContext.js';

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
  const { decisions, tasks, approach, createdIds, opsApplied } =
    applyPatchToPureState(currentState, patch);

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
    runId: ctx.runId,
    version: updatedRow.version,
    action: 'thread_context_patched',
    opsApplied,
  });

  // Emit live update
  emitConversationUpdate(
    conversationId,
    'conversation:thread_context_updated',
    readModel as unknown as Record<string, unknown>,
  );

  return {
    version: updatedRow.version,
    createdIds,
    readModel,
  };
}

// ── Named export object (mirrors conversationService pattern) ─────────────────

export const conversationThreadContextService = {
  buildReadModel,
  buildThreadContextReadModel,
  applyPatch,
};
