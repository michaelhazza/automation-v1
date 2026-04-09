/**
 * Langfuse instrumentation — singleton client + AsyncLocalStorage context propagation.
 *
 * Usage:
 *   import { langfuse, withTrace, getActiveTrace, getTraceContext } from './instrumentation.js';
 *
 *   // Start a trace around a unit of work (pass run context for automatic metadata injection):
 *   await withTrace(trace, { runId, orgId, subaccountId, agentId }, async () => {
 *     // Use tracing helpers from server/lib/tracing.ts — they pull context automatically.
 *     const span = createSpan('agent.loop.iteration', { iteration: 0, phase: 'planning' });
 *     // ... do work ...
 *     span.end({ output: result });
 *   });
 *
 * The AsyncLocalStorage makes getActiveTrace() / getTraceContext() work anywhere
 * in the call stack without threading the trace object through every function signature.
 */

import { AsyncLocalStorage } from 'async_hooks';
import { Langfuse } from 'langfuse';
import type { LangfuseTraceClient } from 'langfuse';
import { env } from './lib/env.js';
import { MAX_SPANS_PER_RUN, MAX_EVENTS_PER_RUN } from './config/limits.js';

// ---------------------------------------------------------------------------
// Langfuse singleton — no-ops automatically if keys are not configured
// ---------------------------------------------------------------------------

export const langfuse = new Langfuse({
  publicKey:  env.LANGFUSE_PUBLIC_KEY  ?? '',
  secretKey:  env.LANGFUSE_SECRET_KEY  ?? '',
  baseUrl:    env.LANGFUSE_BASE_URL    ?? 'https://cloud.langfuse.com',
  // Disable if keys not set — SDK will no-op all calls
  enabled: Boolean(env.LANGFUSE_PUBLIC_KEY && env.LANGFUSE_SECRET_KEY),
  flushAt: 10,
  flushInterval: 5000,
});

// ---------------------------------------------------------------------------
// Trace context — carries run metadata alongside the Langfuse trace
// ---------------------------------------------------------------------------

export interface TraceContext {
  trace: LangfuseTraceClient;
  runId: string;
  orgId: string;
  subaccountId?: string;
  agentId?: string;
  executionMode?: string;
  /** Running count of spans emitted — used for performance budget enforcement */
  spanCount: number;
  /** Running count of events emitted — used for performance budget enforcement */
  eventCount: number;
  maxSpans: number;
  maxEvents: number;
  /** Whether an agent.loop.terminated event has been emitted (Section 15.4) */
  loopTerminated: boolean;
}

// ---------------------------------------------------------------------------
// AsyncLocalStorage — propagates trace context through async call stacks
// ---------------------------------------------------------------------------

const traceStorage = new AsyncLocalStorage<TraceContext>();

/**
 * Run `fn` inside an async context where tracing helpers can access the
 * active trace and run metadata. The `runContext` fields are injected as
 * default metadata on every span/event created within `fn`.
 */
export async function withTrace<T>(
  trace: LangfuseTraceClient,
  runContext: {
    runId: string;
    orgId: string;
    subaccountId?: string;
    agentId?: string;
    executionMode?: string;
  },
  fn: () => Promise<T>,
): Promise<T> {
  const ctx: TraceContext = {
    trace,
    ...runContext,
    spanCount: 0,
    eventCount: 0,
    maxSpans: MAX_SPANS_PER_RUN,
    maxEvents: MAX_EVENTS_PER_RUN,
    loopTerminated: false,
  };
  return traceStorage.run(ctx, fn);
}

/**
 * Returns the active Langfuse trace for the current async context,
 * or undefined if we're outside a `withTrace` block.
 */
export function getActiveTrace(): LangfuseTraceClient | undefined {
  return traceStorage.getStore()?.trace;
}

/**
 * Returns the full trace context (trace + run metadata + counters),
 * or undefined if outside a `withTrace` block.
 */
export function getTraceContext(): TraceContext | undefined {
  return traceStorage.getStore();
}

/**
 * Run `fn` inside an existing trace context snapshot. Use this to preserve
 * trace context across async boundaries (Promise.all, pg-boss handlers,
 * event emitters) where AsyncLocalStorage context would otherwise be lost.
 */
export async function withTraceContext<T>(
  ctx: TraceContext,
  fn: () => Promise<T>,
): Promise<T> {
  return traceStorage.run(ctx, fn);
}

/**
 * Bind a function so it always runs in the current trace context, even when
 * called later from a different async scope (e.g., event emitter callbacks).
 * If no context is active, returns the function unchanged.
 */
export function bindTraceContext<T extends (...args: never[]) => unknown>(fn: T): T {
  const ctx = traceStorage.getStore();
  if (!ctx) return fn;
  return ((...args: never[]) => traceStorage.run(ctx, () => fn(...args))) as unknown as T;
}

// ---------------------------------------------------------------------------
// Sprint 2 P1.1 Layer 1 — org-scoped transaction slot
//
// Every request and every pg-boss job runs inside an explicit Drizzle
// transaction that has issued `SELECT set_config('app.organisation_id', $1)`
// for the current tenant. The transaction handle lives here so every
// service-layer DB access can read it without threading it through every
// function signature.
//
// If a service-layer DB helper finds no active OrgTxContext, that is a
// Layer A contract violation and MUST throw `failure('missing_org_context')`.
// ---------------------------------------------------------------------------

/**
 * The minimal shape a drizzle transaction handle satisfies — same as the
 * top-level `db` object. We use `unknown` to avoid an import cycle with
 * server/db/index.ts; consumers cast back to the Drizzle DB type via the
 * `getCurrentOrgTx()` helper in server/lib/orgScopedDb.ts.
 */
export interface OrgTxContext {
  /** The tenant-scoped Drizzle transaction handle. */
  tx: unknown;
  /** Organisation ID that `set_config('app.organisation_id', …)` was set to. */
  organisationId: string;
  /** Optional subaccount context, when the request/job is subaccount-scoped. */
  subaccountId?: string | null;
  /** Principal that initiated the work, when known (HTTP requests only). */
  userId?: string;
  /** Human-readable origin for debugging (e.g. "http:GET /api/tasks"). */
  source: string;
}

const orgTxStorage = new AsyncLocalStorage<OrgTxContext>();

/**
 * Run `fn` inside an org-scoped transaction context. Typically called by
 * `server/middleware/orgScoping.ts` for HTTP requests and by
 * `server/lib/createWorker.ts` for pg-boss jobs.
 */
export async function withOrgTx<T>(ctx: OrgTxContext, fn: () => Promise<T>): Promise<T> {
  return orgTxStorage.run(ctx, fn);
}

/**
 * Returns the active org-scoped transaction context, or undefined when the
 * caller is outside a `withOrgTx` block. Services that require a tx call
 * `requireOrgTx()` instead so the missing-context failure is structured.
 */
export function getOrgTxContext(): OrgTxContext | undefined {
  return orgTxStorage.getStore();
}
