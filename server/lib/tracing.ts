/**
 * Central tracing helpers — the contract layer for all Langfuse instrumentation.
 *
 * All instrumentation MUST go through these helpers. Never call
 * `getActiveTrace()?.span()` directly — use `createSpan()` instead.
 *
 * Helpers are fail-safe: errors are swallowed with a structured log warning.
 * Observability must never break execution (Section 16.2).
 */

import { createHash } from 'crypto';
import type { LangfuseSpanClient, LangfuseGenerationClient } from 'langfuse';
import { getTraceContext, type TraceContext } from '../instrumentation.js';
import { logger } from './logger.js';
import { MAX_METADATA_SIZE_BYTES } from '../config/limits.js';

// ── Naming Registry (Section 7.2) ─────────────────────────────────────────
// All span, generation, and event names are compile-time enforced.
// No free-text names. No dynamic naming. Adding a new name requires
// updating this registry (intentional friction).

export const SPAN_NAMES = [
  'agent.run.lifecycle',
  'agent.loop.iteration',
  'agent.config.load',
  'agent.guards.check',
  'agent.finalization.run',
  'llm.router.call',
  'skill.pipeline.run',
  'skill.phase.processInput',
  'skill.phase.execute',
  'skill.phase.processOutput',
  'skill.review.wait',
  'memory.recall.query',
  'memory.inject.build',
  'memory.insights.extract',
  'budget.reservation.check',
  // ── IEE — Integrated Execution Environment (rev 6 §8.1) ─────────────────
  'iee.execution.run',
  'iee.execution.step',
] as const;

export type SpanName = (typeof SPAN_NAMES)[number];

export const GENERATION_NAMES = [
  'llm.router.call',
  'memory.insights.llm',
  'memory.summary.llm',
] as const;

export type GenerationName = (typeof GENERATION_NAMES)[number];

export const EVENT_NAMES = [
  'llm.router.escalation',
  'llm.router.fallback',
  'llm.router.budget_exceeded',
  'llm.router.cache_hit',
  'skill.gate.decision',
  'skill.action.proposed',
  'skill.action.failed',
  'skill.tripwire.triggered',
  'agent.middleware.decision',
  'agent.loop.terminated',
  'agent.handoff.enqueued',
  'agent.spawn.fanout',
  'run.status.changed',
  // ── IEE — Integrated Execution Environment (rev 6 §8.1, §13.6) ──────────
  'iee.execution.start',
  'iee.execution.step.complete',
  'iee.execution.step.failed',
  'iee.execution.complete',
  'iee.execution.failed',
  'iee.browser.session_recreated',  // §13.6 — Playwright corruption recovery
  'iee.dev.command',                // §13.6.1.c — per-command audit log
  'iee.cleanup.orphan_removed',     // §12.3 — orphan workspace removal
  // Reviewer round 3 #2 — audit trail for reservation releases done
  // outside the normal finalizeRun() path. Reasons: worker_crash (boot
  // reconciliation) | ttl_expired (cleanup sweep).
  'iee.reservation.released.reconciliation',
  // Reviewer round 4 #5 — periodic queue depth + age signal for SREs
  'iee.queue.depth',
  // LLM in-flight registry (tasks/llm-inflight-realtime-tracker-spec.md §4.4)
  'llm.inflight.active_count',
  // §1 provisional 'started' row — concurrent-call reconciliation signal
  'llm.router.reconciliation_required',
  // invoke_automation step telemetry (spec §5.9)
  'workflow.step.automation.dispatched',
  'workflow.step.automation.completed',
] as const;

export type EventName = (typeof EVENT_NAMES)[number];

// ── Error Taxonomy (Section 7.5) ──────────────────────────────────────────

export const ERROR_TYPES = [
  'provider_error',
  'validation_error',
  'tool_failure',
  'budget_exceeded',
  'rate_limited',
  'timeout',
  'loop_detected',
  'handoff_depth',
  'tripwire_fatal',
  'internal_error',
] as const;

export type ErrorType = (typeof ERROR_TYPES)[number];

// ── Final Status (Section 14.3) ───────────────────────────────────────────

export const FINAL_STATUSES = [
  'completed',
  'completed_with_retries',
  'partial_success',
  'failed',
  'timeout',
  'budget_exceeded',
  'loop_detected',
] as const;

export type FinalStatus = (typeof FINAL_STATUSES)[number];

// ── Loop Termination Reasons (Section 15.4) ───────────────────────────────

export const TERMINATION_REASONS = [
  'no_tool_calls',
  'max_iterations',
  'middleware_stop',
  'error',
  'timeout',
  'budget_exceeded',
  'pre_loop_exit',
] as const;

export type TerminationReason = (typeof TERMINATION_REASONS)[number];

// ── No-op implementations ─────────────────────────────────────────────────
// Returned when tracing is disabled or budget limits are reached.

const noopSpan = {
  end: () => {},
  update: () => noopSpan,
  span: () => noopSpan,
  generation: () => noopGeneration,
  event: () => {},
} as unknown as LangfuseSpanClient;

const noopGeneration = {
  end: () => {},
  update: () => noopGeneration,
} as unknown as LangfuseGenerationClient;

// ── Default Metadata Injection (Section 7.1) ──────────────────────────────

function getDefaultMetadata(ctx: TraceContext): Record<string, unknown> {
  return {
    runId: ctx.runId,
    orgId: ctx.orgId,
    subaccountId: ctx.subaccountId,
    agentId: ctx.agentId,
    executionMode: ctx.executionMode,
    traceSchemaVersion: 'v1',
    instrumentationVersion: '1.0',
  };
}

/** Guard against oversized metadata (Section 7.3) */
function safeMetadata(meta: Record<string, unknown>): Record<string, unknown> {
  try {
    const str = JSON.stringify(meta);
    if (str.length > MAX_METADATA_SIZE_BYTES) {
      logger.warn('tracing_metadata_oversized', { size: str.length, limit: MAX_METADATA_SIZE_BYTES });
      return { ...getDefaultMetadata(getTraceContext()!), _truncated: true, _originalSize: str.length };
    }
    return meta;
  } catch {
    return meta;
  }
}

// ── Core Helpers ──────────────────────────────────────────────────────────
// All helpers are fail-safe (Section 16.2): try/catch with structured warning.

/**
 * Create a timed span. Use for any work with duration EXCEPT LLM calls
 * (use `createGeneration` for those — Section 15.2).
 */
export function createSpan(
  name: SpanName,
  metadata?: Record<string, unknown>,
  options?: { input?: unknown; parentSpan?: LangfuseSpanClient },
): LangfuseSpanClient {
  try {
    const ctx = getTraceContext();
    if (!ctx) return noopSpan;

    if (ctx.spanCount >= ctx.maxSpans) return noopSpan;
    ctx.spanCount++;

    const parent = options?.parentSpan ?? ctx.trace;
    const merged = safeMetadata({ ...getDefaultMetadata(ctx), ...metadata });

    return parent.span({
      name,
      input: options?.input,
      metadata: merged,
      startTime: new Date(),
    });
  } catch (err) {
    logger.warn('tracing_helper_error', { helper: 'createSpan', name, error: String(err) });
    return noopSpan;
  }
}

/**
 * Create an LLM generation span. ONLY call this from `llmRouter.ts`
 * (Section 15.2). Other modules that need LLM tracing must go through
 * `routeCall()` which handles generation span creation.
 */
export function createGeneration(
  name: GenerationName,
  params: {
    model: string;
    input?: unknown;
    output?: unknown;
    modelParameters?: Record<string, unknown>;
    usage?: { input?: number; output?: number; total?: number };
    completionStartTime?: Date;
    metadata?: Record<string, unknown>;
    parentSpan?: LangfuseSpanClient;
  },
): LangfuseGenerationClient {
  try {
    const ctx = getTraceContext();
    if (!ctx) return noopGeneration;

    if (ctx.spanCount >= ctx.maxSpans) return noopGeneration;
    ctx.spanCount++;

    const parent = params.parentSpan ?? ctx.trace;
    const merged = safeMetadata({ ...getDefaultMetadata(ctx), ...params.metadata });

    return parent.generation({
      name,
      model: params.model,
      input: params.input,
      output: params.output,
      modelParameters: params.modelParameters as Record<string, string | number | boolean | string[] | null> | undefined,
      usage: params.usage,
      completionStartTime: params.completionStartTime,
      metadata: merged,
      startTime: new Date(),
    });
  } catch (err) {
    logger.warn('tracing_helper_error', { helper: 'createGeneration', name, error: String(err) });
    return noopGeneration;
  }
}

/**
 * Emit a point-in-time event (no duration). Use for decision points
 * (Section 8.2): gate decisions, model escalation, middleware stops,
 * loop termination reasons.
 */
export function createEvent(
  name: EventName,
  metadata?: Record<string, unknown>,
  options?: {
    input?: unknown;
    parentSpan?: LangfuseSpanClient;
    level?: 'DEBUG' | 'DEFAULT' | 'WARNING' | 'ERROR';
  },
): void {
  try {
    const ctx = getTraceContext();
    if (!ctx) return;

    if (ctx.eventCount >= ctx.maxEvents) return;
    ctx.eventCount++;

    const parent = options?.parentSpan ?? ctx.trace;
    const merged = safeMetadata({ ...getDefaultMetadata(ctx), ...metadata });

    parent.event({
      name,
      input: options?.input,
      metadata: merged,
      level: options?.level,
    });
  } catch (err) {
    logger.warn('tracing_helper_error', { helper: 'createEvent', name, error: String(err) });
  }
}

// ── Trace Summary (Section 7.5) ───────────────────────────────────────────

export interface TraceSummary {
  finalStatus: FinalStatus;
  totalCostCents?: number;
  totalTokensIn?: number;
  totalTokensOut?: number;
  iterationCount?: number;
  toolCallCount?: number;
  durationMs: number;
  errorType?: ErrorType | null;
  errorMessage?: string | null;
  runFingerprint?: string;
  queuedAt?: string;
  startedAt?: string;
  queueDelayMs?: number;
}

/**
 * Finalize the active trace with a status update. MUST be called at the
 * end of every run, regardless of success or failure (Section 7.5).
 *
 * Warns if no `agent.loop.terminated` event was emitted (Section 15.4).
 * Includes truncation visibility metadata (Section 16.3).
 */
export function finalizeTrace(summary: TraceSummary): void {
  try {
    const ctx = getTraceContext();
    if (!ctx) return;

    if (!ctx.loopTerminated) {
      logger.warn('trace_missing_loop_termination', { runId: ctx.runId });
    }

    const spansOver = Math.max(0, ctx.spanCount - ctx.maxSpans);
    const eventsOver = Math.max(0, ctx.eventCount - ctx.maxEvents);

    ctx.trace.update({
      output: {
        status: summary.finalStatus,
        errorType: summary.errorType ?? null,
        errorMessage: summary.errorMessage ?? null,
      },
      metadata: {
        ...getDefaultMetadata(ctx),
        ...summary,
        // Truncation visibility (Section 16.3)
        traceTruncated: spansOver > 0 || eventsOver > 0,
        spansDropped: spansOver,
        eventsDropped: eventsOver,
        truncationReason: spansOver > 0
          ? 'span_limit'
          : eventsOver > 0
            ? 'event_limit'
            : null,
      },
    });
  } catch (err) {
    logger.warn('tracing_helper_error', { helper: 'finalizeTrace', error: String(err) });
  }
}

// ── Loop Termination (Section 15.4) ───────────────────────────────────────

/** Mark that a loop termination event was emitted */
export function markLoopTerminated(): void {
  const ctx = getTraceContext();
  if (ctx) ctx.loopTerminated = true;
}

/**
 * Emit loop termination event — exactly one per run.
 * This is the single source of truth for "why it ended."
 */
export function emitLoopTermination(
  reason: TerminationReason,
  metadata?: Record<string, unknown>,
  parentSpan?: LangfuseSpanClient,
): void {
  markLoopTerminated();
  createEvent('agent.loop.terminated', { reason, ...metadata }, { parentSpan });
}

// ── Run Fingerprint (Section 8.3) ─────────────────────────────────────────

/** Generate a deterministic fingerprint for grouping similar runs */
export function generateRunFingerprint(
  agentId: string,
  taskType: string,
  skillSlugs: string[],
): string {
  const input = `${agentId}:${taskType}:${[...skillSlugs].sort().join(',')}`;
  return `fp_${createHash('sha1').update(input).digest('hex').slice(0, 12)}`;
}
