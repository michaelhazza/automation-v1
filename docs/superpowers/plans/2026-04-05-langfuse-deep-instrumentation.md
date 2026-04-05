# Langfuse Deep Instrumentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform Langfuse from basic trace-per-run to full observability backbone — every decision, tool call, LLM routing choice, and handoff chain visible in a single trace waterfall.

**Architecture:** Central tracing helpers (`server/lib/tracing.ts`) with typed schemas enforce consistent metadata across all instrumentation. Helpers wrap `getActiveTrace()` null checks, inject default context from AsyncLocalStorage, and are fail-safe (never break execution). All span/event names come from a compile-time registry.

**Tech Stack:** Langfuse SDK v3.38.6, Zod for metadata schemas, AsyncLocalStorage for context propagation, TypeScript string unions for name registry.

**Spec:** `tasks/langfuse-deep-instrumentation-brief.md`

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `server/lib/tracing.ts` | Central tracing helpers, naming registry, metadata schemas, context propagation |
| `server/lib/tracing.test.ts` | Unit tests for tracing helpers |

### Modified Files
| File | What Changes |
|------|-------------|
| `server/instrumentation.ts` | Extend AsyncLocalStorage to store run context (orgId, agentId, etc.), not just trace |
| `server/services/agentExecutionService.ts` | Add iteration spans, guard spans, finalization, loop termination events, session linking, run fingerprint |
| `server/services/llmRouter.ts` | Replace raw generation with `createGeneration()`, add routing metadata, fallback/escalation events |
| `server/services/skillExecutor.ts` | Replace raw spans with `createSpan()`, add gate decision events, pipeline phase spans, TripWire events |
| `server/services/workspaceMemoryService.ts` | Add memory recall spans, memory inject spans, insight extraction spans |
| `server/config/limits.ts` | Add tracing limits (max spans, max events, max depth) |

---

## Task 1: Extend AsyncLocalStorage Context (Phase 0)

**Files:**
- Modify: `server/instrumentation.ts`

- [ ] **Step 1: Define TraceContext type and update storage**

Replace the current `AsyncLocalStorage<LangfuseTraceClient>` with a richer context that carries run metadata alongside the trace.

```typescript
// server/instrumentation.ts — replace lines 41-60

export interface TraceContext {
  trace: LangfuseTraceClient;
  runId: string;
  orgId: string;
  subaccountId?: string;
  agentId?: string;
  executionMode?: string;
  spanCount: number;
  eventCount: number;
  maxSpans: number;
  maxEvents: number;
  emittedSpanIds: Set<string>;
  loopTerminated: boolean;
}

const traceStorage = new AsyncLocalStorage<TraceContext>();

export async function withTrace<T>(
  trace: LangfuseTraceClient,
  runContext: Omit<TraceContext, 'trace' | 'spanCount' | 'eventCount' | 'maxSpans' | 'maxEvents' | 'emittedSpanIds' | 'loopTerminated'>,
  fn: () => Promise<T>,
): Promise<T> {
  const ctx: TraceContext = {
    trace,
    ...runContext,
    spanCount: 0,
    eventCount: 0,
    maxSpans: 500,
    maxEvents: 1000,
    emittedSpanIds: new Set(),
    loopTerminated: false,
  };
  return traceStorage.run(ctx, fn);
}

export function getActiveTrace(): LangfuseTraceClient | undefined {
  return traceStorage.getStore()?.trace;
}

export function getTraceContext(): TraceContext | undefined {
  return traceStorage.getStore();
}

export async function withTraceContext<T>(
  ctx: TraceContext,
  fn: () => Promise<T>,
): Promise<T> {
  return traceStorage.run(ctx, fn);
}

export function bindTraceContext<T extends (...args: unknown[]) => unknown>(fn: T): T {
  const ctx = traceStorage.getStore();
  if (!ctx) return fn;
  return ((...args: unknown[]) => traceStorage.run(ctx, () => fn(...args))) as T;
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: Errors in agentExecutionService.ts where `withTrace` is called with old signature (2 args instead of 3). This is expected — we'll fix in Task 4.

- [ ] **Step 3: Commit**

```bash
git add server/instrumentation.ts
git commit -m "feat(tracing): extend AsyncLocalStorage context with run metadata and context propagation helpers"
```

---

## Task 2: Create Tracing Helpers with Naming Registry (Phase 0)

**Files:**
- Create: `server/lib/tracing.ts`
- Modify: `server/config/limits.ts`

- [ ] **Step 1: Add tracing limits to limits.ts**

Append to `server/config/limits.ts`:

```typescript
// ── Tracing limits ────────────────────────────────────────────
export const MAX_SPANS_PER_RUN = 500;
export const MAX_EVENTS_PER_RUN = 1000;
export const MAX_NESTING_DEPTH = 10;
export const MAX_METADATA_SIZE_BYTES = 4096;
export const MAX_EVENTS_PER_ITERATION = 20;
```

- [ ] **Step 2: Create server/lib/tracing.ts with naming registry, metadata schemas, and helpers**

```typescript
// server/lib/tracing.ts
import { type LangfuseSpanClient, type LangfuseGenerationClient } from 'langfuse';
import { getTraceContext, type TraceContext } from '../instrumentation.js';
import { logger } from './logger.js';

// ── Naming Registry ───────────────────────────────────────────
// Section 7.2 + 15.2: All names are compile-time enforced.

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
] as const;

export type EventName = (typeof EVENT_NAMES)[number];

// ── Error Taxonomy (Section 7.5) ──────────────────────────────
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

// ── Final Status (Section 14.3) ───────────────────────────────
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

// ── Loop Termination Reasons (Section 15.4) ───────────────────
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

// ── No-op implementations ─────────────────────────────────────
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

// ── Metadata Helpers ──────────────────────────────────────────

function truncate(value: string, maxLen: number): string {
  if (value.length <= maxLen) return value;
  return value.slice(0, maxLen - 3) + '...';
}

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

// ── Core Helpers (Section 7.1, 16.2) ──────────────────────────
// All helpers are fail-safe: errors are swallowed with a log warning.

export function createSpan(
  name: SpanName,
  metadata?: Record<string, unknown>,
  options?: { input?: unknown; parentSpan?: LangfuseSpanClient },
): LangfuseSpanClient {
  try {
    const ctx = getTraceContext();
    if (!ctx) return noopSpan;

    // Performance budget (Section 7.7)
    if (ctx.spanCount >= ctx.maxSpans) {
      return noopSpan;
    }
    ctx.spanCount++;

    const parent = options?.parentSpan ?? ctx.trace;
    const merged = { ...getDefaultMetadata(ctx), ...metadata };

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

    if (ctx.spanCount >= ctx.maxSpans) {
      return noopGeneration;
    }
    ctx.spanCount++;

    const parent = params.parentSpan ?? ctx.trace;
    const merged = { ...getDefaultMetadata(ctx), ...params.metadata };

    return parent.generation({
      name,
      model: params.model,
      input: params.input,
      output: params.output,
      modelParameters: params.modelParameters,
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

export function createEvent(
  name: EventName,
  metadata?: Record<string, unknown>,
  options?: { input?: unknown; parentSpan?: LangfuseSpanClient; level?: 'DEBUG' | 'DEFAULT' | 'WARNING' | 'ERROR' },
): void {
  try {
    const ctx = getTraceContext();
    if (!ctx) return;

    if (ctx.eventCount >= ctx.maxEvents) {
      return;
    }
    ctx.eventCount++;

    const parent = options?.parentSpan ?? ctx.trace;
    const merged = { ...getDefaultMetadata(ctx), ...metadata };

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

export function finalizeTrace(summary: TraceSummary): void {
  try {
    const ctx = getTraceContext();
    if (!ctx) return;

    // Section 15.4: Warn if no loop termination event was emitted
    if (!ctx.loopTerminated) {
      logger.warn('trace_missing_loop_termination', { runId: ctx.runId });
    }

    const truncationData = {
      traceTruncated: ctx.spanCount >= ctx.maxSpans || ctx.eventCount >= ctx.maxEvents,
      spansDropped: Math.max(0, ctx.spanCount - ctx.maxSpans),
      eventsDropped: Math.max(0, ctx.eventCount - ctx.maxEvents),
    };

    ctx.trace.update({
      output: {
        status: summary.finalStatus,
        errorType: summary.errorType ?? null,
        errorMessage: summary.errorMessage ?? null,
      },
      metadata: {
        ...getDefaultMetadata(ctx),
        ...summary,
        ...truncationData,
      },
    });
  } catch (err) {
    logger.warn('tracing_helper_error', { helper: 'finalizeTrace', error: String(err) });
  }
}

/** Mark that a loop termination event was emitted (Section 15.4) */
export function markLoopTerminated(): void {
  const ctx = getTraceContext();
  if (ctx) ctx.loopTerminated = true;
}

/** Emit loop termination event — exactly one per run (Section 15.4) */
export function emitLoopTermination(
  reason: TerminationReason,
  metadata?: Record<string, unknown>,
  parentSpan?: LangfuseSpanClient,
): void {
  markLoopTerminated();
  createEvent('agent.loop.terminated', { reason, ...metadata }, { parentSpan });
}

/** Generate run fingerprint (Section 8.3) */
export function generateRunFingerprint(
  agentId: string,
  taskType: string,
  skillSlugs: string[],
): string {
  const input = `${agentId}:${taskType}:${[...skillSlugs].sort().join(',')}`;
  // Simple hash — crypto not needed for fingerprinting
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return `fp_${Math.abs(hash).toString(36)}`;
}
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: May show errors in agentExecutionService.ts (withTrace signature change). Other files should be clean.

- [ ] **Step 4: Commit**

```bash
git add server/lib/tracing.ts server/config/limits.ts
git commit -m "feat(tracing): add central tracing helpers with naming registry, metadata schemas, and fail-safe wrappers"
```

---

## Task 3: Write Tests for Tracing Helpers (Phase 0)

**Files:**
- Create: `server/lib/tracing.test.ts`

- [ ] **Step 1: Write unit tests**

```typescript
// server/lib/tracing.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// We need to mock instrumentation before importing tracing
vi.mock('../instrumentation.js', () => {
  const mockTrace = {
    span: vi.fn().mockReturnValue({
      end: vi.fn(),
      update: vi.fn().mockReturnThis(),
      span: vi.fn().mockReturnThis(),
      generation: vi.fn().mockReturnThis(),
      event: vi.fn(),
    }),
    generation: vi.fn().mockReturnValue({
      end: vi.fn(),
      update: vi.fn().mockReturnThis(),
    }),
    event: vi.fn(),
    update: vi.fn(),
  };

  let store: unknown = undefined;

  return {
    getTraceContext: () => store,
    getActiveTrace: () => (store as { trace: unknown } | undefined)?.trace,
    withTrace: async (_trace: unknown, _ctx: unknown, fn: () => Promise<unknown>) => {
      store = { trace: mockTrace, ..._ctx, spanCount: 0, eventCount: 0, maxSpans: 500, maxEvents: 1000, emittedSpanIds: new Set(), loopTerminated: false };
      try { return await fn(); } finally { store = undefined; }
    },
    __mockTrace: mockTrace,
    __setStore: (s: unknown) => { store = s; },
  };
});

import { createSpan, createEvent, createGeneration, finalizeTrace, emitLoopTermination, generateRunFingerprint, type SpanName, type EventName } from './tracing.js';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { __mockTrace, __setStore } = await import('../instrumentation.js') as any;

describe('tracing helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __setStore(undefined);
  });

  describe('createSpan', () => {
    it('returns noop when no trace context', () => {
      const span = createSpan('agent.loop.iteration');
      span.end(); // should not throw
      expect(__mockTrace.span).not.toHaveBeenCalled();
    });

    it('creates span with default metadata when context exists', () => {
      __setStore({
        trace: __mockTrace,
        runId: 'run-1',
        orgId: 'org-1',
        subaccountId: 'sa-1',
        agentId: 'agent-1',
        spanCount: 0,
        eventCount: 0,
        maxSpans: 500,
        maxEvents: 1000,
        emittedSpanIds: new Set(),
        loopTerminated: false,
      });

      createSpan('agent.loop.iteration', { iteration: 0, phase: 'planning' });
      expect(__mockTrace.span).toHaveBeenCalledWith(expect.objectContaining({
        name: 'agent.loop.iteration',
        metadata: expect.objectContaining({
          runId: 'run-1',
          orgId: 'org-1',
          iteration: 0,
          phase: 'planning',
          traceSchemaVersion: 'v1',
        }),
      }));
    });

    it('returns noop when span limit reached', () => {
      __setStore({
        trace: __mockTrace,
        runId: 'run-1', orgId: 'org-1',
        spanCount: 500, eventCount: 0, maxSpans: 500, maxEvents: 1000,
        emittedSpanIds: new Set(), loopTerminated: false,
      });

      const span = createSpan('agent.loop.iteration');
      expect(__mockTrace.span).not.toHaveBeenCalled();
      span.end(); // noop, should not throw
    });
  });

  describe('createEvent', () => {
    it('does nothing when no trace context', () => {
      createEvent('agent.loop.terminated', { reason: 'no_tool_calls' });
      expect(__mockTrace.event).not.toHaveBeenCalled();
    });

    it('creates event with merged metadata', () => {
      __setStore({
        trace: __mockTrace,
        runId: 'run-1', orgId: 'org-1',
        spanCount: 0, eventCount: 0, maxSpans: 500, maxEvents: 1000,
        emittedSpanIds: new Set(), loopTerminated: false,
      });

      createEvent('agent.loop.terminated', { reason: 'no_tool_calls' });
      expect(__mockTrace.event).toHaveBeenCalledWith(expect.objectContaining({
        name: 'agent.loop.terminated',
        metadata: expect.objectContaining({ runId: 'run-1', reason: 'no_tool_calls' }),
      }));
    });
  });

  describe('emitLoopTermination', () => {
    it('marks loopTerminated flag on context', () => {
      const store = {
        trace: __mockTrace,
        runId: 'run-1', orgId: 'org-1',
        spanCount: 0, eventCount: 0, maxSpans: 500, maxEvents: 1000,
        emittedSpanIds: new Set(), loopTerminated: false,
      };
      __setStore(store);

      emitLoopTermination('no_tool_calls');
      expect(store.loopTerminated).toBe(true);
    });
  });

  describe('generateRunFingerprint', () => {
    it('produces consistent fingerprints', () => {
      const fp1 = generateRunFingerprint('agent-1', 'development', ['web_search', 'send_email']);
      const fp2 = generateRunFingerprint('agent-1', 'development', ['send_email', 'web_search']);
      expect(fp1).toBe(fp2); // order-independent
      expect(fp1).toMatch(/^fp_/);
    });

    it('produces different fingerprints for different inputs', () => {
      const fp1 = generateRunFingerprint('agent-1', 'development', ['web_search']);
      const fp2 = generateRunFingerprint('agent-2', 'development', ['web_search']);
      expect(fp1).not.toBe(fp2);
    });
  });

  describe('finalizeTrace', () => {
    it('warns if loop termination event was not emitted', () => {
      __setStore({
        trace: __mockTrace,
        runId: 'run-1', orgId: 'org-1',
        spanCount: 0, eventCount: 0, maxSpans: 500, maxEvents: 1000,
        emittedSpanIds: new Set(), loopTerminated: false,
      });

      // Should not throw, but should log warning
      finalizeTrace({ finalStatus: 'completed', durationMs: 1000 });
      expect(__mockTrace.update).toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `npx vitest run server/lib/tracing.test.ts`
Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add server/lib/tracing.test.ts
git commit -m "test(tracing): add unit tests for tracing helpers"
```

---

## Task 4: Instrument Agent Execution Service — Trace + Finalization (Phase 1)

**Files:**
- Modify: `server/services/agentExecutionService.ts`

This is the largest task. It touches the trace creation (line ~589), agentic loop (lines ~855-1183), and finalization (lines ~624-660).

- [ ] **Step 1: Update imports**

Add tracing imports at the top of agentExecutionService.ts:

```typescript
import { langfuse, withTrace, getActiveTrace } from '../instrumentation.js';
import {
  createSpan, createEvent, createGeneration, finalizeTrace,
  emitLoopTermination, generateRunFingerprint,
  type FinalStatus, type ErrorType,
} from '../lib/tracing.js';
```

- [ ] **Step 2: Update trace creation and withTrace call (~line 589)**

Replace the trace creation and `withTrace` call. The key change is passing run context as the second argument to `withTrace`:

```typescript
// Replace the existing trace creation block (~lines 589-601)
const trace = langfuse.trace({
  name: 'agent-run',
  userId: request.subaccountId,
  sessionId: run.id,
  metadata: {
    agentId: request.agentId,
    runType: request.runType,
    orgId: request.organisationId,
    subaccountId: request.subaccountId,
    executionMode: 'api',
    traceSchemaVersion: 'v1',
    instrumentationVersion: '1.0',
    startedAt: new Date().toISOString(),
  },
});

loopResult = await withTrace(
  trace,
  {
    runId: run.id,
    orgId: request.organisationId,
    subaccountId: request.subaccountId,
    agentId: request.agentId,
    executionMode: 'api',
  },
  () => runAgenticLoop({ /* existing params */ }),
);
```

- [ ] **Step 3: Add guard span before the agentic loop**

Before the `runAgenticLoop` call, wrap workspace limit checks in a span:

```typescript
const guardsSpan = createSpan('agent.guards.check');
// ... existing workspace limit checks ...
guardsSpan.end();
```

- [ ] **Step 4: Add iteration spans inside the agentic loop (~line 894)**

Inside `runAgenticLoop`, wrap each iteration in a span:

```typescript
for (let iteration = 0; iteration < MAX_LOOP_ITERATIONS; iteration++) {
  const iterationSpan = createSpan('agent.loop.iteration', {
    iteration,
    phase, // determined below — move phase determination before span creation
  });

  // ... existing iteration code ...

  iterationSpan.end({
    output: {
      toolCallCount: iterationToolCalls,
      tokensUsed: iterationTokens,
    },
  });
}
```

- [ ] **Step 5: Add loop termination events**

At each `break` point in the loop, emit the termination event:

```typescript
// When no tool calls (line ~1008):
if (!response.toolCalls?.length) {
  emitLoopTermination('no_tool_calls', { iteration, totalToolCalls });
  break;
}

// When max iterations reached (after loop):
if (iteration >= MAX_LOOP_ITERATIONS - 1) {
  emitLoopTermination('max_iterations', { iteration, totalToolCalls });
}

// When middleware stops (line ~930):
emitLoopTermination('middleware_stop', {
  iteration, middlewareName: preCallResult.source, reason: preCallResult.reason,
});
break outerLoop;
```

- [ ] **Step 6: Add middleware decision events**

At each middleware decision point:

```typescript
// Pre-call middleware (~line 912):
createEvent('agent.middleware.decision', {
  middlewareName: preCallResult.source ?? 'unknown',
  decision: preCallResult.action, // 'continue' | 'stop' | 'inject_message'
  reason: preCallResult.reason,
  iteration,
});
```

- [ ] **Step 7: Add trace finalization after loop completes**

In the finalization block (~lines 624-660), after the loop result is processed:

```typescript
// Determine final status
let traceFinalStatus: FinalStatus = 'completed';
let traceErrorType: ErrorType | null = null;
if (loopResult.finalStatus === 'timeout') {
  traceFinalStatus = 'timeout';
  traceErrorType = 'timeout';
} else if (loopResult.finalStatus === 'budget_exceeded') {
  traceFinalStatus = 'budget_exceeded';
  traceErrorType = 'budget_exceeded';
} else if (loopResult.finalStatus === 'loop_detected') {
  traceFinalStatus = 'loop_detected';
  traceErrorType = 'loop_detected';
} else if (loopResult.finalStatus === 'failed') {
  traceFinalStatus = 'failed';
  traceErrorType = 'internal_error';
}

const finalizationSpan = createSpan('agent.finalization.run');

createEvent('run.status.changed', {
  fromStatus: 'running',
  toStatus: traceFinalStatus,
});

finalizationSpan.end();

finalizeTrace({
  finalStatus: traceFinalStatus,
  totalTokensIn: loopResult.inputTokens,
  totalTokensOut: loopResult.outputTokens,
  iterationCount: loopResult.toolCallsLog.length > 0 ? Math.max(...loopResult.toolCallsLog.map(t => (t as { iteration: number }).iteration)) + 1 : 0,
  toolCallCount: loopResult.totalToolCalls,
  durationMs: Date.now() - startTime,
  errorType: traceErrorType,
  startedAt: new Date(startTime).toISOString(),
});

await langfuse.flushAsync();
```

- [ ] **Step 8: Run typecheck**

Run: `npm run typecheck`
Expected: Pass (or minor type fixes needed).

- [ ] **Step 9: Run tests**

Run: `npm test`
Expected: Existing tests should pass — changes are additive.

- [ ] **Step 10: Commit**

```bash
git add server/services/agentExecutionService.ts
git commit -m "feat(tracing): add iteration spans, guard spans, loop termination events, and trace finalization to agent execution"
```

---

## Task 5: Instrument LLM Router — Generation Enrichment (Phase 1)

**Files:**
- Modify: `server/services/llmRouter.ts`

- [ ] **Step 1: Update imports**

Replace the direct `getActiveTrace` import with tracing helpers:

```typescript
import { createGeneration, createEvent } from '../lib/tracing.js';
```

- [ ] **Step 2: Replace raw generation span with createGeneration (~line 645)**

Replace the existing `getActiveTrace()?.generation({...})` block:

```typescript
createGeneration('llm.router.call', {
  model: actualModel,
  input: params.messages,
  output: providerResponse.content,
  modelParameters: params.maxTokens ? { maxTokens: params.maxTokens } : undefined,
  usage: {
    input: providerResponse.tokensIn,
    output: providerResponse.tokensOut,
  },
  metadata: {
    provider: actualProvider,
    runId: ctx.runId,
    agentName: ctx.agentName,
    taskType: ctx.taskType,
    executionPhase: ctx.executionPhase,
    routingTier,
    wasDowngraded,
    routingReason,
    wasEscalated: ctx.wasEscalated ?? false,
    escalationReason: ctx.escalationReason,
    idempotencyKey,
    estimatedCostCents: estimatedCostCents ?? null,
    reservationId: reservationId ?? null,
    attemptNumber,
    criticalPath: true,
  },
});
```

- [ ] **Step 3: Add provider fallback events**

Inside the provider fallback loop, when a provider fails:

```typescript
// After a provider attempt fails (~line 405):
createEvent('llm.router.fallback', {
  failedProvider: provider,
  failedModel: mappedModel,
  error: truncateError(String(err)),
  nextProvider: fallbackChain[fallbackChain.indexOf(provider) + 1] ?? 'none',
  attemptIndex: attempt,
});
```

- [ ] **Step 4: Add escalation events**

When economy-to-frontier escalation happens (~line 979-1006 in agentExecutionService, but the event should be emitted in the router or at the call site):

```typescript
// At the escalation point in the router or agentExecutionService:
createEvent('llm.router.escalation', {
  fromModel: economyModel,
  toModel: frontierModel,
  reason: escalationReason,
});
```

- [ ] **Step 5: Add cache hit events**

When an idempotency cache hit occurs:

```typescript
// When cached response returned (~line 300):
createEvent('llm.router.cache_hit', {
  idempotencyKey,
  model: effectiveModel,
  provider: effectiveProvider,
});
```

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck`
Expected: Pass.

- [ ] **Step 7: Commit**

```bash
git add server/services/llmRouter.ts
git commit -m "feat(tracing): enrich LLM generation spans with routing metadata, add fallback/escalation/cache events"
```

---

## Task 6: Instrument Skill Executor — Pipeline Spans + Decision Events (Phase 2)

**Files:**
- Modify: `server/services/skillExecutor.ts`

- [ ] **Step 1: Update imports**

```typescript
import { createSpan, createEvent } from '../lib/tracing.js';
```

- [ ] **Step 2: Replace raw spans in executeWithActionAudit (~line 440)**

Replace `getActiveTrace()?.span({ name: actionType, input })` with:

```typescript
const pipelineSpan = createSpan('skill.pipeline.run', {
  skillName: actionType,
  gateLevel: 'auto',
});

// After action proposal:
createEvent('skill.action.proposed', {
  skillName: actionType,
  actionId: proposed.actionId,
  status: proposed.status,
}, { parentSpan: pipelineSpan });

// Gate decision event:
createEvent('skill.gate.decision', {
  gateLevel: proposed.status === 'blocked' ? 'block' : 'auto',
  skillName: actionType,
  policyRule: proposed.policyRule ?? 'default',
}, { parentSpan: pipelineSpan });

// Execution phase span:
const executeSpan = createSpan('skill.phase.execute', {
  skillName: actionType,
}, { parentSpan: pipelineSpan });

// ... actual execution ...

executeSpan.end({ output: result });
pipelineSpan.end({ output: result });
```

- [ ] **Step 3: Replace raw spans in proposeReviewGatedAction (~line 536)**

Similar pattern but with review wait span:

```typescript
const pipelineSpan = createSpan('skill.pipeline.run', {
  skillName: actionType,
  gateLevel: 'review',
});

createEvent('skill.gate.decision', {
  gateLevel: 'review',
  skillName: actionType,
  policyRule: proposed.policyRule ?? 'default',
}, { parentSpan: pipelineSpan });

// Review wait span (captures human response time):
const reviewSpan = createSpan('skill.review.wait', {
  skillName: actionType,
  actionId: proposed.actionId,
  criticalPath: true,
}, { parentSpan: pipelineSpan });

const reviewResult = await awaitReviewDecision(proposed.actionId, actionType, context);

reviewSpan.end({
  output: {
    approved: reviewResult.approved,
    waitDurationMs: Date.now() - reviewStartTime,
  },
});
```

- [ ] **Step 4: Add skill failure events**

In catch blocks:

```typescript
createEvent('skill.action.failed', {
  skillName: actionType,
  errorType: classifySkillError(err),
  error: truncate(String(err), 200),
}, { parentSpan: pipelineSpan, level: 'ERROR' });
```

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: Pass.

- [ ] **Step 6: Commit**

```bash
git add server/services/skillExecutor.ts
git commit -m "feat(tracing): add skill pipeline spans, gate decision events, review wait spans, and failure events"
```

---

## Task 7: Cross-Run Session Linking + Run Fingerprint (Phase 3)

**Files:**
- Modify: `server/services/agentExecutionService.ts`
- Modify: `server/services/agentScheduleService.ts`

- [ ] **Step 1: Add session linking to trace creation**

In the trace creation block, compute sessionId based on run type:

```typescript
// Handoff chains: link via root run
let sessionId: string;
if (request.runSource === 'handoff' && request.sourceRunId) {
  sessionId = `handoff-chain-${request.sourceRunId}`;
} else if (request.runType === 'scheduled') {
  const dateStr = new Date().toISOString().slice(0, 10);
  sessionId = `schedule-${request.agentId}-${dateStr}`;
} else {
  sessionId = run.id;
}

const trace = langfuse.trace({
  name: 'agent-run',
  userId: request.subaccountId,
  sessionId,
  metadata: {
    // ... existing metadata ...
    handoffDepth: request.handoffDepth ?? 0,
    sourceRunId: request.sourceRunId ?? null,
    isSubAgent: request.isSubAgent ?? false,
    parentSpawnRunId: request.parentSpawnRunId ?? null,
  },
});
```

- [ ] **Step 2: Add run fingerprint to trace metadata**

After tools are resolved (before the loop):

```typescript
const skillSlugs = tools.map(t => t.name);
const runFingerprint = generateRunFingerprint(
  request.agentId,
  'development',
  skillSlugs,
);

// Update trace with fingerprint
trace.update({
  metadata: {
    // ... existing ...
    runFingerprint,
  },
});
```

- [ ] **Step 3: Add handoff enqueued event in skillExecutor**

In `enqueueHandoff()`:

```typescript
createEvent('agent.handoff.enqueued', {
  targetAgentId: handoffRequest.agentId,
  sourceRunId: handoffRequest.sourceRunId,
  handoffDepth: handoffRequest.handoffDepth,
  taskId: handoffRequest.taskId,
});
```

- [ ] **Step 4: Add sub-agent spawn event**

In `executeSpawnSubAgents()`:

```typescript
createEvent('agent.spawn.fanout', {
  fanOutCount: subTasks.length,
  perChildBudget: perChildBudget,
  perChildTimeoutMs: perChildTimeout,
});
```

- [ ] **Step 5: Run typecheck and tests**

Run: `npm run typecheck && npm test`
Expected: Pass.

- [ ] **Step 6: Commit**

```bash
git add server/services/agentExecutionService.ts server/services/agentScheduleService.ts server/services/skillExecutor.ts
git commit -m "feat(tracing): add cross-run session linking, run fingerprints, handoff and spawn events"
```

---

## Task 8: Memory/RAG Observability (Phase 4)

**Files:**
- Modify: `server/services/workspaceMemoryService.ts`

- [ ] **Step 1: Add imports**

```typescript
import { createSpan } from '../lib/tracing.js';
```

- [ ] **Step 2: Add memory recall span in getMemoryForPrompt**

```typescript
// In getMemoryForPrompt(), wrap vector search:
const recallSpan = createSpan('memory.recall.query', {
  queryLength: taskContext?.length ?? 0,
  searchLimit: VECTOR_SEARCH_LIMIT,
  similarityThreshold: VECTOR_SIMILARITY_THRESHOLD,
});

// ... existing vector search ...

recallSpan.end({
  output: {
    resultsCount: vectorResults.length,
    topSimilarity: vectorResults[0]?.similarity ?? null,
  },
});
```

- [ ] **Step 3: Add memory inject span**

```typescript
const injectSpan = createSpan('memory.inject.build', {
  entryCount: entries.length,
  entityCount: entities.length,
});

// ... existing prompt building ...

injectSpan.end({
  output: {
    injectedLength: memoryBlock.length,
    totalEntries: entries.length + entities.length,
  },
});
```

- [ ] **Step 4: Add insight extraction span in extractRunInsights**

```typescript
const extractSpan = createSpan('memory.insights.extract', {
  runId,
  criticalPath: false,
});

// ... existing extraction ...

extractSpan.end({
  output: {
    insightsExtracted: entries.length,
    duplicatesRemoved: deduplicatedCount,
  },
});
```

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: Pass.

- [ ] **Step 6: Commit**

```bash
git add server/services/workspaceMemoryService.ts
git commit -m "feat(tracing): add memory recall, inject, and insight extraction spans"
```

---

## Task 9: Budget Visibility (Phase 4)

**Files:**
- Modify: `server/services/llmRouter.ts`

- [ ] **Step 1: Add budget metadata to generation span**

In the `createGeneration` call (from Task 5), add budget fields:

```typescript
metadata: {
  // ... existing fields ...
  budgetVariance: reservationCostCents != null && actualCostCents != null
    ? reservationCostCents - actualCostCents
    : null,
  estimatedCostCents: estimatedCostCents ?? null,
  actualCostCents: actualCostCents ?? null,
},
```

- [ ] **Step 2: Add budget exceeded event**

When budget check fails:

```typescript
createEvent('llm.router.budget_exceeded', {
  estimatedCostCents,
  budgetTierHit: 'workspace', // or 'org', 'platform'
  reason: 'insufficient_budget',
});
```

- [ ] **Step 3: Run typecheck and tests**

Run: `npm run typecheck && npm test`
Expected: Pass.

- [ ] **Step 4: Commit**

```bash
git add server/services/llmRouter.ts
git commit -m "feat(tracing): add budget visibility metadata and budget exceeded events"
```

---

## Task 10: Final Verification

- [ ] **Step 1: Run full verification suite**

```bash
npm run lint
npm run typecheck
npm test
```

All must pass.

- [ ] **Step 2: Review all changes**

```bash
git diff main...HEAD --stat
```

Verify the change set matches expectations:
- `server/instrumentation.ts` — extended context
- `server/lib/tracing.ts` — new helpers
- `server/lib/tracing.test.ts` — new tests
- `server/config/limits.ts` — tracing limits
- `server/services/agentExecutionService.ts` — iteration spans, finalization, session linking
- `server/services/llmRouter.ts` — enriched generation, events
- `server/services/skillExecutor.ts` — pipeline spans, gate events
- `server/services/workspaceMemoryService.ts` — memory spans

- [ ] **Step 3: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix(tracing): address lint/type/test issues from instrumentation rollout"
```
