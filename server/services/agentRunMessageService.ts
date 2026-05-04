/**
 * agentRunMessageService — Sprint 3 P2.1 Sprint 3A impure wrapper.
 *
 * Thin service layer on top of `agent_run_messages`. The pure decision
 * logic (shape validation + sequence number arithmetic) lives in
 * `agentRunMessageServicePure.ts`; this file owns the Drizzle reads
 * and writes and the transaction discipline that keeps
 * `(run_id, sequence_number)` unique under contention.
 *
 * ---------------------------------------------------------------------
 * Transaction contract — READ BEFORE MODIFYING
 *
 * `appendMessage()` MUST be called inside an active `withOrgTx(...)`
 * block (it uses `getOrgScopedDb`, which fails closed outside one).
 * Sprint 3A has a single writer per run — `runAgenticLoop` — so the
 * naive `max(sequence_number) + 1` pattern would already be race-free
 * in practice. We nonetheless acquire a row-level lock on the owning
 * `agent_runs` row via `SELECT ... FOR UPDATE` before computing the
 * next sequence number. Rationale:
 *
 *   1. Cheap insurance against a future Sprint 3B resume path that
 *      briefly overlaps an in-flight worker.
 *   2. Keeps the unique-index violation path cold. The invariant is
 *      enforced in SQL (see migration 0084), and we want the service
 *      layer to never fire it under normal operation.
 *   3. Matches the pattern used by `computeBudgetService.acquireOrgComputeBudgetLock`
 *      so reviewers have one precedent to check rather than two.
 *
 * The lock is released automatically when the surrounding `withOrgTx`
 * commits or rolls back — the caller never manages it directly.
 *
 * ---------------------------------------------------------------------
 * Read helpers
 *
 * `streamMessages` — range read used by Sprint 3B resume, surfaced
 * here so the read-side shape is co-located with the write-side.
 * Filters by `run_id` + optional `[fromSequence, toSequence]` window
 * and orders ascending so the caller can rebuild the in-memory
 * `messages[]` array directly.
 *
 * `nextSequenceNumber` — non-transactional peek used by diagnostic
 * paths (e.g. admin UI) that want to know the current cursor without
 * acquiring the row lock. Do NOT use this to allocate a sequence
 * number for a write — use `appendMessage` instead.
 *
 * Contract: docs/improvements-roadmap-spec.md §P2.1.
 */

import { and, asc, eq, gte, lte, sql } from 'drizzle-orm';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { agentRuns, agentRunMessages } from '../db/schema/index.js';
import type { AgentRunMessage } from '../db/schema/agentRunMessages.js';
import {
  validateMessageShape,
  computeNextSequenceNumber,
  type AgentRunMessageRole,
} from './agentRunMessageServicePure.js';

export interface AppendMessageInput {
  runId: string;
  organisationId: string;
  role: AgentRunMessageRole;
  /** Provider-neutral content — string, object, or non-empty array. */
  content: unknown;
  /** Top-level tool_call_id for single-block messages. Null otherwise. */
  toolCallId?: string | null;
}

export interface AppendMessageResult {
  id: string;
  sequenceNumber: number;
}

/**
 * Append a message to `agent_run_messages`. The caller is responsible
 * for supplying a role + content that round-trips through
 * `validateMessageShape` (see the pure module). Throws on any shape
 * violation; returns the surrogate id and allocated sequence number on
 * success.
 */
export async function appendMessage(
  input: AppendMessageInput,
): Promise<AppendMessageResult> {
  validateMessageShape({
    role: input.role,
    content: input.content,
    toolCallId: input.toolCallId ?? null,
  });

  const tx = getOrgScopedDb('agentRunMessageService.appendMessage');

  // ── 1. Acquire the per-run sentinel lock ─────────────────────────
  // SELECT ... FOR UPDATE on the agent_runs row. This serialises
  // concurrent appendMessage calls for the same run even in the
  // pathological case where Sprint 3B resume briefly overlaps a
  // running worker. The lock is released when withOrgTx commits.
  const lockedRows = await tx
    .select({ id: agentRuns.id })
    .from(agentRuns)
    .where(
      and(
        eq(agentRuns.id, input.runId),
        eq(agentRuns.organisationId, input.organisationId),
      ),
    )
    .for('update');

  if (lockedRows.length === 0) {
    throw new Error(
      `agentRunMessageService.appendMessage: run ${input.runId} not found in organisation ${input.organisationId}`,
    );
  }

  // ── 2. Compute next sequence number ──────────────────────────────
  const [currentMaxRow] = await tx
    .select({
      maxSeq: sql<number | null>`max(${agentRunMessages.sequenceNumber})`,
    })
    .from(agentRunMessages)
    .where(eq(agentRunMessages.runId, input.runId));

  const currentMax =
    currentMaxRow?.maxSeq === null || currentMaxRow?.maxSeq === undefined
      ? null
      : Number(currentMaxRow.maxSeq);
  const nextSeq = computeNextSequenceNumber(currentMax);

  // ── 3. Insert the new message row ────────────────────────────────
  const [inserted] = await tx
    .insert(agentRunMessages)
    .values({
      organisationId: input.organisationId,
      runId: input.runId,
      sequenceNumber: nextSeq,
      role: input.role,
      content: input.content as object,
      toolCallId: input.toolCallId ?? null,
    })
    .returning({
      id: agentRunMessages.id,
      sequenceNumber: agentRunMessages.sequenceNumber,
    });

  if (!inserted) {
    throw new Error(
      `agentRunMessageService.appendMessage: insert returned no row (runId=${input.runId}, seq=${nextSeq})`,
    );
  }

  return { id: inserted.id, sequenceNumber: inserted.sequenceNumber };
}

export interface StreamMessagesOptions {
  /** Inclusive lower bound on sequence_number. Default: 0. */
  fromSequence?: number;
  /** Inclusive upper bound on sequence_number. Default: no upper bound. */
  toSequence?: number;
}

/**
 * Stream messages for a run in ascending `sequence_number` order.
 * Used by the Sprint 3B resume path to rebuild the in-memory
 * conversation array; also consumed by the toolCallsLog projection
 * service at run completion.
 *
 * `organisationId` is a required argument for defence-in-depth: even
 * though RLS on `agent_run_messages` already forbids cross-org reads
 * (migration 0084), every other service in the codebase layers an
 * explicit `organisationId` predicate on top, and we match that
 * convention so a misconfigured ALS context cannot silently widen the
 * read scope.
 */
export async function streamMessages(
  runId: string,
  organisationId: string,
  opts: StreamMessagesOptions = {},
): Promise<AgentRunMessage[]> {
  const tx = getOrgScopedDb('agentRunMessageService.streamMessages');

  const conditions = [
    eq(agentRunMessages.runId, runId),
    eq(agentRunMessages.organisationId, organisationId),
  ];
  if (opts.fromSequence !== undefined) {
    conditions.push(gte(agentRunMessages.sequenceNumber, opts.fromSequence));
  }
  if (opts.toSequence !== undefined) {
    conditions.push(lte(agentRunMessages.sequenceNumber, opts.toSequence));
  }

  return tx
    .select()
    .from(agentRunMessages)
    .where(and(...conditions))
    .orderBy(asc(agentRunMessages.sequenceNumber));
}

/**
 * Non-transactional peek at the highest sequence number currently
 * persisted for a run. Returns `null` if the run has no messages.
 *
 * Despite the name, this does NOT return the "next" sequence number
 * — it returns the current MAX, which is the sequence number of the
 * LAST row written. The Sprint 3A allocator in `appendMessage` adds
 * one to this value under a sentinel lock to produce the next slot.
 * The helper exists for diagnostic / admin surfaces (e.g. the run
 * inspector) that want to display the current cursor position.
 *
 * Runs inside whatever org-scoped tx the caller has open —
 * `getOrgScopedDb` enforces that. Do NOT use this to allocate a
 * sequence number for a write: the only race-free allocator is
 * `appendMessage`, which holds the per-run sentinel lock while
 * reading and writing.
 */
export async function nextSequenceNumber(runId: string): Promise<number | null> {
  const tx = getOrgScopedDb('agentRunMessageService.nextSequenceNumber');

  const [row] = await tx
    .select({
      maxSeq: sql<number | null>`max(${agentRunMessages.sequenceNumber})`,
    })
    .from(agentRunMessages)
    .where(eq(agentRunMessages.runId, runId));

  if (row?.maxSeq === null || row?.maxSeq === undefined) return null;
  return Number(row.maxSeq);
}
