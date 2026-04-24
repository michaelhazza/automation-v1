// ---------------------------------------------------------------------------
// Pure idempotency-key derivation for `llmRouter.routeCall`.
//
// Extracted from `llmRouter.ts` so the contract can be pinned by a pure test
// (no env, no DB, no provider adapters). The live router continues to call
// this from the same position in `routeCall`.
//
// See `tasks/llm-inflight-deferred-items-brief.md` §2 for the versioning
// rationale — a canonicalisation change MUST bump `IDEMPOTENCY_KEY_VERSION`
// in the same commit so old rows stay valid and new calls don't silently
// collide.
// ---------------------------------------------------------------------------

import { createHash } from 'crypto';
import { IDEMPOTENCY_KEY_VERSION } from '../lib/idempotencyVersion.js';

/**
 * Minimal context surface needed to derive the idempotency key. Kept as a
 * narrow interface so this pure module doesn't have to import the full
 * `LLMCallContext` Zod schema (which carries env- and DB-dependent types).
 */
export interface IdempotencyKeyContext {
  organisationId: string;
  runId?:       string;
  executionId?: string;
  ieeRunId?:    string;
  sourceId?:    string;
  agentName?:   string;
  featureTag?:  string;
  taskType:     string;
}

/**
 * Deterministic idempotency key for a router call.
 *
 * Shape: `${IDEMPOTENCY_KEY_VERSION}:${orgId}:${sourceSlot}:${agentSlot}:${taskType}:${provider}:${model}:${messageHash}`
 *
 * - `sourceSlot` = runId ?? executionId ?? ieeRunId ?? sourceId ?? 'system'
 *   so analyzer/system callers dedupe meaningfully within the same job.
 *   Without sourceId, every analyzer call for the same org would collide
 *   on 'system'.
 * - `agentSlot` = agentName ?? featureTag ?? 'no-agent' so non-agent
 *   callers dedupe by feature rather than colliding on 'no-agent'.
 * - `messageHash` = first 32 hex chars of sha256(JSON.stringify(messages)).
 *   Positional semantics — array order is retained (reorder = different
 *   hash).
 *
 * The version prefix is the non-negotiable contract surface. Any future
 * change to the hash inputs, their ordering, or the `messageHash` algorithm
 * MUST bump `IDEMPOTENCY_KEY_VERSION` to force a deliberate migration
 * decision rather than silent dedup drift.
 */
export function generateIdempotencyKey(
  ctx: IdempotencyKeyContext,
  messages: unknown[],
  provider: string,
  model: string,
): string {
  const messageHash = createHash('sha256')
    .update(JSON.stringify(messages))
    .digest('hex')
    .slice(0, 32);

  const body = [
    ctx.organisationId,
    ctx.runId ?? ctx.executionId ?? ctx.ieeRunId ?? ctx.sourceId ?? 'system',
    ctx.agentName ?? ctx.featureTag ?? 'no-agent',
    ctx.taskType,
    provider,
    model,
    messageHash,
  ].join(':');
  return `${IDEMPOTENCY_KEY_VERSION}:${body}`;
}
