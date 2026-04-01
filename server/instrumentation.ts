/**
 * Langfuse instrumentation — singleton client + AsyncLocalStorage context propagation.
 *
 * Usage:
 *   import { langfuse, withTrace, getActiveTrace } from './instrumentation.js';
 *
 *   // Start a trace around a unit of work:
 *   await withTrace(langfuse.trace({ name: 'agent-run', userId: subaccountId }), async () => {
 *     const span = getActiveTrace()?.span({ name: 'tool-call', input: { ... } });
 *     // ... do work ...
 *     span?.end({ output: result });
 *   });
 *
 * The AsyncLocalStorage makes getActiveTrace() work anywhere in the call stack
 * without threading the trace object through every function signature.
 */

import { AsyncLocalStorage } from 'async_hooks';
import { Langfuse } from 'langfuse';
import type { LangfuseTraceClient } from 'langfuse';
import { env } from './lib/env.js';

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
// AsyncLocalStorage — propagates active trace through async call stacks
// ---------------------------------------------------------------------------

const traceStorage = new AsyncLocalStorage<LangfuseTraceClient>();

/**
 * Run `fn` inside an async context where `getActiveTrace()` returns `trace`.
 * Automatically calls `trace.update` and flushes on completion.
 */
export async function withTrace<T>(
  trace: LangfuseTraceClient,
  fn: () => Promise<T>,
): Promise<T> {
  return traceStorage.run(trace, fn);
}

/**
 * Returns the active Langfuse trace for the current async context,
 * or undefined if we're outside a `withTrace` block.
 */
export function getActiveTrace(): LangfuseTraceClient | undefined {
  return traceStorage.getStore();
}
