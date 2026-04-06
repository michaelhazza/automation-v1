# GSD-2 Adoption Spec — Reliability & Intelligence Upgrades

**Date:** 2026-04-04
**Status:** Spec (not started)
**Source:** Analysis of [gsd-build/gsd-2](https://github.com/gsd-build/gsd-2) patterns applied to Automation OS

---

## Executive Summary

Adopt 12 patterns from GSD-2, prioritised by: reliability > intelligence > polish.

Three CLAUDE.md guardrails (verification, stuck detection, knowledge capture) + three app-level reliability fixes (crash recovery, context pressure, observation masking) + six deferred improvements (semantic loop detection, budget pressure routing, skill metrics, post-mortem, arch-guard, ADR tracking).

---

## Stage 1 of 5 (20%) — CLAUDE.md Foundations

> Goal: Make the dev agent reliable by default. No code changes — just rules.

### 1.1 Verification Commands

**Problem:** Quality is intent-based ("NEVER mark a task complete without proving it works") but not enforced. No concrete commands listed.

**Change:** Add a `## Verification Commands` section to `CLAUDE.md` after the existing "Verification Before Done" section.

**Exact content to add:**

```markdown
## Verification Commands

Run these after every non-trivial change. No task is complete until all relevant checks pass.

| Trigger | Command | Max auto-fix attempts |
|---------|---------|----------------------|
| Any code change | `npm run lint` | 3 |
| Any TypeScript change | `npm run typecheck` | 3 |
| Logic change in server/ | `npm test` (or relevant suite) | 2 |
| Schema change | `npm run db:generate` — verify migration file | 1 |
| Client change | `npm run build` | 2 |

### Rules
- Run the relevant checks, not all of them, unless the change spans client + server.
- If a check fails, fix the issue and re-run. Do not mark the task complete.
- After 3 failed fix attempts on the same check, STOP and escalate to the user with:
  - The exact error output
  - What you tried
  - Your hypothesis for root cause
- Never skip a failing check. Never suppress warnings to make a check pass.
```

**Files changed:** `CLAUDE.md`
**Verification:** Read the updated CLAUDE.md and confirm the section parses correctly.

---

### 1.2 Concrete Stuck Detection Rules

**Problem:** Current rule is "If something goes sideways, STOP and re-plan immediately." Too vague — agents still loop.

**Change:** Replace the last bullet in "Plan Mode Default" and add a dedicated subsection.

**In section "1. Plan Mode Default", replace:**
```
- If something goes sideways, STOP and re-plan immediately. Do not keep pushing.
```

**With:**
```
- If something goes sideways, STOP and re-plan immediately. Do not keep pushing.
- **Stuck detection rule:** If you attempt the same approach twice and it fails both times, you are stuck. Do not try a third time.
```

**Add new section after "6. Autonomous Bug Fixing":**

```markdown
## Stuck Detection Protocol

When stuck (same approach fails twice):

1. **STOP** — do not retry the same thing a third time
2. **Write the blocker** to `tasks/todo.md` under a `## Blockers` heading:
   - What was attempted (be specific — file, function, approach)
   - Exact error or failure mode
   - Why you think it failed (root cause hypothesis)
   - What you would try next if unblocked
3. **Ask the user** — present the blocker summary and wait for direction

### What counts as "the same approach"
- Same file edit that fails the same check twice
- Same command that errors twice with the same message
- Same architectural approach that hits the same wall
- Rephrasing the same logic does NOT count as a different approach

### What to do instead of retrying
- Try a fundamentally different approach (different algorithm, different file, different pattern)
- Read more context (maybe you're missing something)
- Check if the problem is upstream (wrong assumption, stale data, missing dependency)
```

**Files changed:** `CLAUDE.md`
**Verification:** Grep for "Stuck Detection Protocol" in CLAUDE.md.

---

### 1.3 Knowledge File Upgrade (lessons.md -> KNOWLEDGE.md)

**Problem:** `tasks/lessons.md` is empty. Only triggers on corrections. The agent doesn't compound intelligence across sessions.

**Change:**
1. Create `KNOWLEDGE.md` at project root (not in tasks/) so it's always visible
2. Update CLAUDE.md section "3. Self-Improvement Loop" to reference it
3. Keep `tasks/lessons.md` as-is (archive, no breaking change)

**New file: `KNOWLEDGE.md`**

```markdown
# Project Knowledge Base

Append-only register of patterns, decisions, and gotchas discovered during development.
Read this at the start of every session. Never edit or remove existing entries — only append.

---

## How to Use

### When to write (proactively, not just on failure)
- You discover a non-obvious codebase pattern
- You make an architectural decision during implementation
- You find a gotcha that would trip up a future session
- You learn something about how a library/tool behaves in this project
- The user corrects you (always capture the correction)

### Entry format
```
### [YYYY-MM-DD] [Category] — [Short title]

[1-3 sentences. Be specific. Include file paths and function names where relevant.]
```

### Categories
- **Pattern** — how something works in this codebase
- **Decision** — why we chose X over Y
- **Gotcha** — non-obvious trap or edge case
- **Correction** — user corrected a wrong assumption
- **Convention** — team/project convention not documented elsewhere

---

## Entries

_No entries yet._
```

**Update in CLAUDE.md section "3. Self-Improvement Loop", replace entire section with:**

```markdown
## 3. Self-Improvement Loop

- Review `KNOWLEDGE.md` at the start of each session
- Write to `KNOWLEDGE.md` proactively — not just after corrections (see KNOWLEDGE.md for triggers)
- After ANY correction from the user: always add a Correction entry to `KNOWLEDGE.md`
- Be specific. Vague entries do not prevent future mistakes.
- Never edit or remove existing entries — only append new ones
- Convert every failure into a reusable rule
```

**Files changed:** `KNOWLEDGE.md` (new), `CLAUDE.md` (update section 3)
**Verification:** Confirm KNOWLEDGE.md exists at root. Confirm CLAUDE.md references it.

---

## Stage 1 Checklist

- [ ] Add Verification Commands section to CLAUDE.md
- [ ] Add Stuck Detection Protocol section to CLAUDE.md
- [ ] Update Plan Mode Default bullet for stuck detection
- [ ] Create KNOWLEDGE.md at project root
- [ ] Update Self-Improvement Loop section in CLAUDE.md
- [ ] Verify all changes parse correctly (no broken markdown)
- [ ] Commit: `docs: add verification commands, stuck detection, and knowledge file (GSD-2 adoption stage 1)`

---

## Stage 2 of 5 (20%) — Crash Recovery & Stale Run Detection

> Goal: Fix the correctness bug where dead agent runs stay in "running" forever.

### 2.1 Problem Statement

When an agent run dies mid-execution (process crash, unhandled exception outside the try/catch, network partition, OOM kill), the `agent_runs` row stays in `status = 'running'` permanently. There is:
- No heartbeat mechanism to detect stale runs
- No cleanup job to mark them as failed
- No websocket notification to update the UI
- Users see phantom "running" agents with no recourse

### 2.2 Design

**Approach:** Add a `lastActivityAt` timestamp column to `agent_runs`. Update it during the agentic loop on each iteration. A periodic pg-boss job scans for stale runs and marks them failed.

#### 2.2.1 Schema Change

**File:** `server/db/schema/agentRuns.ts`

Add column:
```typescript
lastActivityAt: timestamp('last_activity_at', { withTimezone: true }),
```

**Migration:** New Drizzle migration file (next sequential number, e.g. `0042_stale_run_detection.ts`).

Add index for the cleanup query:
```typescript
staleRunIdx: index('agent_runs_stale_run_idx').on(table.status, table.lastActivityAt),
```

#### 2.2.2 Heartbeat Updates in Agentic Loop

**File:** `server/services/agentExecutionService.ts`

In `runAgenticLoop()`, at the top of the `outerLoop` (line ~891), after updating `mwCtx`, add:

```typescript
// Heartbeat: update lastActivityAt for stale run detection
// Throttle to every 3rd iteration to avoid DB write pressure
if (iteration % 3 === 0) {
  db.update(agentRuns)
    .set({ lastActivityAt: new Date() })
    .where(eq(agentRuns.id, runId))
    .catch(() => {}); // fire-and-forget — never block the loop
}
```

Also set `lastActivityAt: new Date()` at run creation (line ~207) and at run completion (line ~625).

For Claude Code execution mode (line ~534), set `lastActivityAt` before spawning and rely on the timeout mechanism already in place (no iteration loop to heartbeat from).

#### 2.2.3 Stale Run Cleanup Job

**New file:** `server/services/staleRunCleanupService.ts`

```typescript
import { eq, and, lt, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { agentRuns } from '../db/schema/index.js';
import { emitAgentRunUpdate, emitSubaccountUpdate, emitOrgUpdate } from '../websocket/emitters.js';
import { logger } from '../lib/logger.js';

// Runs are stale if no activity for this duration
const STALE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

// Also catch runs with no lastActivityAt that have been running too long
const LEGACY_STALE_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour (for pre-migration runs)

export const staleRunCleanupService = {
  async cleanupStaleRuns(): Promise<number> {
    const now = new Date();
    const staleThreshold = new Date(now.getTime() - STALE_THRESHOLD_MS);
    const legacyThreshold = new Date(now.getTime() - LEGACY_STALE_THRESHOLD_MS);

    // Find stale runs: status='running' AND lastActivityAt < threshold
    const staleRuns = await db
      .select({
        id: agentRuns.id,
        organisationId: agentRuns.organisationId,
        subaccountId: agentRuns.subaccountId,
        agentId: agentRuns.agentId,
        executionScope: agentRuns.executionScope,
        startedAt: agentRuns.startedAt,
        lastActivityAt: agentRuns.lastActivityAt,
      })
      .from(agentRuns)
      .where(
        and(
          eq(agentRuns.status, 'running'),
          // Either: has heartbeat and it's stale, OR no heartbeat and started too long ago
          // Use SQL OR here
        )
      );

    // Filter in application code for clarity (two conditions)
    const toCleanup = staleRuns.filter(run => {
      if (run.lastActivityAt) {
        return run.lastActivityAt < staleThreshold;
      }
      // Legacy: no heartbeat column populated yet
      return run.startedAt && run.startedAt < legacyThreshold;
    });

    for (const run of toCleanup) {
      const durationMs = run.startedAt
        ? now.getTime() - run.startedAt.getTime()
        : null;

      await db.update(agentRuns).set({
        status: 'failed',
        errorMessage: 'Run terminated: no activity detected (stale run cleanup)',
        errorDetail: {
          type: 'stale_run',
          lastActivityAt: run.lastActivityAt?.toISOString() ?? null,
          detectedAt: now.toISOString(),
          thresholdMs: run.lastActivityAt ? STALE_THRESHOLD_MS : LEGACY_STALE_THRESHOLD_MS,
        },
        completedAt: now,
        durationMs,
        updatedAt: now,
      }).where(eq(agentRuns.id, run.id));

      // Notify UI
      emitAgentRunUpdate(run.id, 'agent:run:failed', {
        agentId: run.agentId,
        status: 'failed',
        reason: 'stale_run_cleanup',
      });

      if (run.executionScope === 'org') {
        emitOrgUpdate(run.organisationId, 'live:agent_failed', {
          runId: run.id, agentId: run.agentId, reason: 'stale',
        });
      } else if (run.subaccountId) {
        emitSubaccountUpdate(run.subaccountId, 'agent:run:failed', {
          runId: run.id, agentId: run.agentId, reason: 'stale',
        });
      }

      logger.info('stale_run_cleanup.cleaned', {
        runId: run.id,
        agentId: run.agentId,
        lastActivityAt: run.lastActivityAt?.toISOString(),
        durationMs,
      });
    }

    if (toCleanup.length > 0) {
      logger.info('stale_run_cleanup.summary', { cleaned: toCleanup.length });
    }

    return toCleanup.length;
  },
};
```

#### 2.2.4 Register Cleanup Job in Schedule Service

**File:** `server/services/agentScheduleService.ts`

In `initialize()`, after registering the existing workers, add:

```typescript
// Stale run cleanup — runs every 5 minutes
const STALE_CLEANUP_QUEUE = 'stale-run-cleanup';
await pgboss.work(STALE_CLEANUP_QUEUE, async () => {
  const { staleRunCleanupService } = await import('./staleRunCleanupService.js');
  await staleRunCleanupService.cleanupStaleRuns();
});
await pgboss.schedule(STALE_CLEANUP_QUEUE, '*/5 * * * *');
```

For the fallback scheduler path, add a `setInterval` equivalent.

### 2.3 Edge Cases

- **Sub-agent runs:** If a parent run dies, child runs with `isSubAgent: true` also go stale. The cleanup catches them independently since each has its own `lastActivityAt`.
- **Claude Code runs:** These don't heartbeat from the loop. The timeout mechanism in `claudeCodeRunner` handles termination. The stale cleanup is a safety net — use `LEGACY_STALE_THRESHOLD_MS` (1 hour) as the fallback.
- **Race condition:** If a run completes between the scan and the update, the cleanup will try to set status='failed' on an already-completed run. Guard with `WHERE status = 'running'` in the update.

### 2.4 Files Changed

| File | Change |
|------|--------|
| `server/db/schema/agentRuns.ts` | Add `lastActivityAt` column + index |
| `migrations/0042_stale_run_detection.ts` | New migration |
| `server/services/agentExecutionService.ts` | Heartbeat writes in loop + at run start/end |
| `server/services/staleRunCleanupService.ts` | New service |
| `server/services/agentScheduleService.ts` | Register cleanup job |

### 2.5 Verification

- [ ] Start an agent run, kill the process mid-run
- [ ] Wait 10 minutes (or temporarily lower `STALE_THRESHOLD_MS` for testing)
- [ ] Confirm run transitions to `failed` with `stale_run` error detail
- [ ] Confirm websocket event fires
- [ ] Confirm completed runs are not touched by cleanup
- [ ] Run `npm run typecheck` and `npm test`

---

## Stage 2 Checklist

- [ ] Create migration for `lastActivityAt` column + index
- [ ] Update `agentRuns` schema with new column
- [ ] Add heartbeat writes to `runAgenticLoop`
- [ ] Set `lastActivityAt` at run creation and completion
- [ ] Create `staleRunCleanupService.ts`
- [ ] Register cleanup job in `agentScheduleService.ts`
- [ ] Test stale detection with lowered threshold
- [ ] Commit: `feat(agents): add stale run detection and crash recovery (GSD-2 adoption stage 2)`

---

## Stage 3 of 5 (20%) — Context Pressure Warning & Observation Masking

> Goal: Prevent quality degradation in long agent runs. Reduce cost, improve reasoning.

### 3.1 Context Pressure Soft Warning

**Problem:** The agentic loop in `agentExecutionService.ts` has hard limits (token budget, tool call cap, timeout) but no soft warning. When the agent hits a hard limit, it gets a terse "wrap up" message and produces a garbage summary with `WRAP_UP_MAX_TOKENS = 1024`.

**Inspiration:** GSD-2 signals the agent at 70% context usage to finish durable output before hitting hard limits.

#### 3.1.1 Design

Add a new `PreCallMiddleware` that injects a warning message at 70% budget consumption. The warning doesn't stop the loop — it tells the agent to prioritize completing the current task and writing a good summary.

**New file:** `server/services/middleware/contextPressure.ts`

```typescript
import type { PreCallMiddleware, MiddlewareContext, PreCallResult } from './types.js';

// Thresholds as fractions of the budget
const SOFT_WARNING_THRESHOLD = 0.70;
const CRITICAL_WARNING_THRESHOLD = 0.85;

export const contextPressureMiddleware: PreCallMiddleware = {
  name: 'contextPressure',

  execute(ctx: MiddlewareContext): PreCallResult {
    const tokenRatio = ctx.tokensUsed / ctx.tokenBudget;
    const toolCallRatio = ctx.toolCallsCount / ctx.maxToolCalls;
    const timeRatio = (Date.now() - ctx.startTime) / ctx.timeoutMs;

    // Use the highest pressure signal
    const pressure = Math.max(tokenRatio, toolCallRatio, timeRatio);

    if (pressure >= CRITICAL_WARNING_THRESHOLD && !ctx._criticalWarningIssued) {
      ctx._criticalWarningIssued = true;
      return {
        action: 'inject_message',
        message: '[SYSTEM] You are at 85% of your resource budget. Complete your current action, write a summary of progress, and stop. Do not start new tasks.',
      };
    }

    if (pressure >= SOFT_WARNING_THRESHOLD && !ctx._softWarningIssued) {
      ctx._softWarningIssued = true;
      return {
        action: 'inject_message',
        message: '[SYSTEM] You are at 70% of your resource budget. Prioritise completing your current task. Avoid starting new work. Begin preparing your summary.',
      };
    }

    return { action: 'continue' };
  },
};
```

#### 3.1.2 Middleware Type Extension

**File:** `server/services/middleware/types.ts`

Add `inject_message` action to `PreCallResult`:

```typescript
export type PreCallResult =
  | { action: 'continue' }
  | { action: 'stop'; reason: string; status: string }
  | { action: 'inject_message'; message: string };
```

Add tracking flags to `MiddlewareContext`:

```typescript
export interface MiddlewareContext {
  // ... existing fields ...
  _softWarningIssued?: boolean;
  _criticalWarningIssued?: boolean;
}
```

#### 3.1.3 Handle `inject_message` in the Loop

**File:** `server/services/agentExecutionService.ts`

In `runAgenticLoop()`, the pre-call middleware loop (line ~897), add handling for `inject_message`:

```typescript
for (const mw of pipeline.preCall) {
  const result = mw.execute(mwCtx);
  if (result.action === 'stop') {
    // ... existing stop handling ...
  }
  if (result.action === 'inject_message') {
    // Inject as a user message so the agent sees it
    messages.push({ role: 'user', content: result.message });
    // Don't break — continue to next middleware
  }
}
```

#### 3.1.4 Register in Pipeline

**File:** `server/services/middleware/index.ts`

Add to the default pipeline's `preCall` array, BEFORE `budgetCheckMiddleware`:

```typescript
import { contextPressureMiddleware } from './contextPressure.js';

export function createDefaultPipeline(): MiddlewarePipeline {
  return {
    preCall: [contextPressureMiddleware, budgetCheckMiddleware],
    preTool: [toolRestrictionMiddleware, loopDetectionMiddleware],
    postTool: [],
  };
}
```

Order matters: pressure warning fires first (soft), then budget check fires (hard stop) if over limit.

### 3.2 Observation Masking

**Problem:** The `messages` array in `runAgenticLoop()` grows every iteration. By iteration 15 of 25, you're sending the full history of all tool results on every LLM call. This is expensive and degrades reasoning quality — the model gets lost in old context.

**Inspiration:** GSD-2's observation masking replaces tool results older than N turns with `[result masked]` before each LLM call. Zero LLM overhead — deterministic text replacement.

#### 3.2.1 Design

Before each `routeCall()`, apply a masking function that replaces tool_result content older than the keep window. The original `messages` array is untouched — masking creates a shallow copy for the LLM call.

**Configurable:** Keep the last `KEEP_WINDOW` iterations of tool results. Default: 5.

**New file:** `server/services/middleware/observationMasking.ts`

```typescript
import type { LLMMessage, LLMContentBlock } from '../llmService.js';

// Keep tool results from the last N iterations
const DEFAULT_KEEP_WINDOW = 5;

// Max chars per individual tool result before truncation
const MAX_TOOL_RESULT_CHARS = 1500;

const MASK_PLACEHOLDER = '[result masked — see earlier in conversation]';

/**
 * Create a masked copy of the messages array.
 * Tool results older than `keepWindow` iterations are replaced with a placeholder.
 * Recent tool results are preserved in full (but individually truncated if too large).
 *
 * Returns a new array — does not mutate the original.
 */
export function maskObservations(
  messages: LLMMessage[],
  currentIteration: number,
  keepWindow: number = DEFAULT_KEEP_WINDOW,
): LLMMessage[] {
  // Determine which iterations to keep
  const keepFromIteration = Math.max(0, currentIteration - keepWindow);

  // We need to track which messages correspond to which iterations.
  // Convention: each user message with tool_result content = one iteration boundary.
  let iterationCounter = 0;

  return messages.map(msg => {
    if (msg.role !== 'user' || typeof msg.content === 'string') {
      return msg;
    }

    // Check if this message contains tool_results
    const blocks = msg.content as LLMContentBlock[];
    const hasToolResults = blocks.some(b => b.type === 'tool_result');

    if (!hasToolResults) return msg;

    const messageIteration = iterationCounter;
    iterationCounter++;

    if (messageIteration >= keepFromIteration) {
      // Recent — keep but truncate individual results
      return {
        ...msg,
        content: blocks.map(block => {
          if (block.type === 'tool_result' && block.content.length > MAX_TOOL_RESULT_CHARS) {
            return {
              ...block,
              content: block.content.slice(0, MAX_TOOL_RESULT_CHARS) + '...[truncated]',
            };
          }
          return block;
        }),
      };
    }

    // Old — mask tool results
    return {
      ...msg,
      content: blocks.map(block => {
        if (block.type === 'tool_result') {
          return { ...block, content: MASK_PLACEHOLDER };
        }
        return block;
      }),
    };
  });
}
```

#### 3.2.2 Integrate into the Agentic Loop

**File:** `server/services/agentExecutionService.ts`

In `runAgenticLoop()`, before the `routeCall()` (line ~938), apply masking:

```typescript
import { maskObservations } from './middleware/observationMasking.js';

// Before the LLM call:
const maskedMessages = maskObservations(messages, iteration);

const response = await routeCall({
  messages: maskedMessages,  // <-- use masked copy
  system: systemPrompt,
  // ... rest unchanged
});
```

Also apply masking before the wrap-up call (line ~901) and the escalation call (line ~963).

**Important:** The original `messages` array is NOT modified. Tool results are still fully stored for the tool calls log / snapshot. Only the LLM sees the masked version.

#### 3.2.3 Configurable via Agent Config

Future enhancement (not in this stage): make `keepWindow` configurable per subaccount agent via `subaccountAgents.observationKeepWindow`. For now, use the default of 5.

### 3.3 Files Changed

| File | Change |
|------|--------|
| `server/services/middleware/contextPressure.ts` | New — soft warning middleware |
| `server/services/middleware/observationMasking.ts` | New — message masking utility |
| `server/services/middleware/types.ts` | Add `inject_message` action, add warning flags |
| `server/services/middleware/index.ts` | Register `contextPressureMiddleware` |
| `server/services/agentExecutionService.ts` | Handle inject_message, apply masking before routeCall |

### 3.4 Verification

- [ ] Run an agent with a small token budget (e.g. 5000 tokens)
- [ ] Confirm soft warning appears at ~70% usage
- [ ] Confirm critical warning appears at ~85% usage
- [ ] Confirm warnings only appear once each (not repeated)
- [ ] Run a long agent (20+ iterations) and verify masked messages via log
- [ ] Compare token usage before/after masking on a representative run
- [ ] Run `npm run typecheck` and `npm test`

---

## Stage 3 Checklist

- [ ] Create `contextPressure.ts` middleware
- [ ] Update `types.ts` with `inject_message` action and warning flags
- [ ] Register in default pipeline (`index.ts`)
- [ ] Handle `inject_message` in the agentic loop
- [ ] Create `observationMasking.ts` utility
- [ ] Apply `maskObservations()` before all `routeCall()` invocations in the loop
- [ ] Verify masking doesn't affect tool call logging or snapshots
- [ ] Commit: `feat(agents): add context pressure warning and observation masking (GSD-2 adoption stage 3)`

---

## Stage 4 of 5 (20%) — Semantic Stuck Detection & Budget Pressure

> Goal: Smarter loop detection and graceful cost degradation.

### 4.1 Semantic Stuck Detection

**Problem:** Current `loopDetection.ts` only catches identical tool calls (same name + same JSON input hash). It misses higher-level cycles where the agent oscillates between different tools in a repeating pattern (e.g., `read_workspace -> create_task -> read_workspace -> create_task`).

**Inspiration:** GSD-2 uses sliding-window analysis to detect repeated dispatch patterns including cycles like A->B->A.

#### 4.1.1 Design

Extend `loopDetection.ts` with a second detection layer: **sequence pattern matching** on the last N tool call names.

**Updated file:** `server/services/middleware/loopDetection.ts`

```typescript
import { createHash } from 'crypto';
import { MAX_TOOL_REPEATS } from '../../config/limits.js';
import type { PreToolMiddleware, MiddlewareContext, PreToolResult } from './types.js';

export function hashToolCall(name: string, input: Record<string, unknown>): string {
  return createHash('md5').update(name + JSON.stringify(input)).digest('hex');
}

// Sliding window size for pattern detection
const PATTERN_WINDOW = 12;

// Minimum pattern length to detect (e.g., A->B = 2, A->B->C = 3)
const MIN_PATTERN_LENGTH = 2;

// Max pattern length to search for
const MAX_PATTERN_LENGTH = 4;

// How many times a pattern must repeat to be considered a cycle
const MIN_PATTERN_REPEATS = 3;

/**
 * Detect repeating patterns in a sequence of tool names.
 * Returns the detected pattern if found, null otherwise.
 *
 * Example: ['a','b','a','b','a','b'] -> detects ['a','b'] repeated 3x
 */
function detectCycle(toolNames: string[]): string[] | null {
  if (toolNames.length < MIN_PATTERN_LENGTH * MIN_PATTERN_REPEATS) return null;

  // Try pattern lengths from shortest to longest
  for (let patLen = MIN_PATTERN_LENGTH; patLen <= MAX_PATTERN_LENGTH; patLen++) {
    // Extract candidate pattern from the end of the sequence
    const candidate = toolNames.slice(-patLen);

    // Count how many times this pattern repeats backwards from the end
    let repeats = 0;
    for (let offset = 0; offset + patLen <= toolNames.length; offset += patLen) {
      const segment = toolNames.slice(toolNames.length - offset - patLen, toolNames.length - offset);
      if (segment.every((name, i) => name === candidate[i])) {
        repeats++;
      } else {
        break;
      }
    }

    if (repeats >= MIN_PATTERN_REPEATS) {
      return candidate;
    }
  }

  return null;
}

export const loopDetectionMiddleware: PreToolMiddleware = {
  name: 'loopDetection',

  execute(
    ctx: MiddlewareContext,
    toolCall: { name: string; input: Record<string, unknown> }
  ): PreToolResult {
    // Layer 1: Identical input detection (existing behavior)
    const hash = hashToolCall(toolCall.name, toolCall.input);
    const repeatCount = ctx.toolCallHistory.filter(h => h.inputHash === hash).length;

    if (repeatCount >= MAX_TOOL_REPEATS) {
      return {
        action: 'stop',
        reason: `Loop detected: tool "${toolCall.name}" has been called ${repeatCount} times with identical input. Stopping to prevent infinite loop.`,
        status: 'loop_detected',
      };
    }

    // Layer 2: Semantic pattern detection (new)
    const recentNames = ctx.toolCallHistory
      .slice(-PATTERN_WINDOW)
      .map(h => h.name);
    recentNames.push(toolCall.name); // include the current call

    const cycle = detectCycle(recentNames);
    if (cycle) {
      return {
        action: 'stop',
        reason: `Cycle detected: tool sequence [${cycle.join(' -> ')}] has been repeating. The agent appears stuck in a loop. Stopping to prevent wasted compute.`,
        status: 'loop_detected',
      };
    }

    return { action: 'continue' };
  },
};
```

#### 4.1.2 New Config Constants

**File:** `server/config/limits.ts`

Add:
```typescript
/** Sliding window size for semantic loop pattern detection */
export const LOOP_PATTERN_WINDOW = 12;

/** Minimum times a tool name sequence must repeat to trigger cycle detection */
export const MIN_CYCLE_REPEATS = 3;
```

### 4.2 Budget Pressure Auto-Downgrade

**Problem:** The budget system is binary — either the budget is OK or it throws `BudgetExceededError`. There's no graceful degradation. When budget is 80% consumed, the agent should use cheaper models for simple tasks rather than running out mid-complex-task.

**Inspiration:** GSD-2 has graduated model downgrading at 50%, 75%, 90% budget thresholds. Heavy tasks keep the strong model; light tasks shift to cheaper tiers.

#### 4.2.1 Design

Add a `getBudgetPressure()` function to `budgetService.ts` that returns a 0-1 pressure score. Pass this to the `llmRouter` via the `LLMCallContext` so the router can factor it into model selection.

**File:** `server/services/budgetService.ts`

Add new export:

```typescript
export interface BudgetPressure {
  /** 0.0 = no pressure, 1.0 = at limit */
  score: number;
  /** Which limit is closest to being hit */
  limitingFactor: string;
  /** Recommended routing mode based on pressure */
  recommendedRouting: 'ceiling' | 'economy';
}

/**
 * Calculate budget pressure for a run context.
 * Returns a score 0-1 indicating how close any budget limit is to being hit.
 */
async function getBudgetPressure(ctx: BudgetContext): Promise<BudgetPressure> {
  const pressures: Array<{ ratio: number; factor: string }> = [];

  // Check daily subaccount limit
  if (ctx.subaccountId) {
    const limits = await getWorkspaceLimits(ctx.subaccountId);
    if (limits?.dailyCostLimitCents) {
      const dailyUsed = await getDailySpend(ctx.subaccountId, ctx.billingDay);
      pressures.push({
        ratio: dailyUsed / limits.dailyCostLimitCents,
        factor: 'daily_subaccount',
      });
    }
    if (limits?.monthlyCostLimitCents) {
      const monthlyUsed = await getMonthlySpend(ctx.subaccountId, ctx.billingMonth);
      pressures.push({
        ratio: monthlyUsed / limits.monthlyCostLimitCents,
        factor: 'monthly_subaccount',
      });
    }
  }

  // Check monthly org limit
  const orgBudget = await getOrgBudget(ctx.organisationId);
  if (orgBudget?.monthlyCostLimitCents) {
    const orgMonthlyUsed = await getOrgMonthlySpend(ctx.organisationId, ctx.billingMonth);
    pressures.push({
      ratio: orgMonthlyUsed / orgBudget.monthlyCostLimitCents,
      factor: 'monthly_org',
    });
  }

  if (pressures.length === 0) {
    return { score: 0, limitingFactor: 'none', recommendedRouting: 'ceiling' };
  }

  const highest = pressures.reduce((a, b) => a.ratio > b.ratio ? a : b);

  return {
    score: Math.min(1, highest.ratio),
    limitingFactor: highest.factor,
    recommendedRouting: highest.ratio >= 0.5 ? 'economy' : 'ceiling',
  };
}
```

#### 4.2.2 Integration with LLM Router

**File:** `server/services/llmRouter.ts`

Add optional `budgetPressure` to `RouterCallParams`:

```typescript
export interface RouterCallParams {
  // ... existing fields ...
  budgetPressure?: number; // 0-1 score from budgetService
}
```

In the model resolution logic, when `budgetPressure >= 0.5` and `routingMode === 'ceiling'`, downgrade to the economy model:

```typescript
// Inside routeCall(), after resolving provider/model:
if (params.budgetPressure && params.budgetPressure >= 0.75) {
  // High pressure: force economy model for non-synthesis phases
  if (params.context.executionPhase !== 'synthesis') {
    resolvedModel = economyModel ?? resolvedModel;
  }
} else if (params.budgetPressure && params.budgetPressure >= 0.5) {
  // Medium pressure: use economy for planning phase only
  if (params.context.executionPhase === 'planning') {
    resolvedModel = economyModel ?? resolvedModel;
  }
}
```

#### 4.2.3 Wire into the Agentic Loop

**File:** `server/services/agentExecutionService.ts`

At the start of `runAgenticLoop()`, compute pressure once. Recompute every 5 iterations (budget changes as tokens are spent):

```typescript
let budgetPressure = 0;

// Inside the loop, every 5 iterations:
if (iteration % 5 === 0) {
  try {
    const pressure = await budgetService.getBudgetPressure({
      organisationId: request.organisationId,
      subaccountId: request.subaccountId,
      runId,
      billingDay: new Date().toISOString().slice(0, 10),
      billingMonth: new Date().toISOString().slice(0, 7),
    });
    budgetPressure = pressure.score;
  } catch { /* non-critical */ }
}

// Pass to routeCall:
const response = await routeCall({
  // ... existing params ...
  budgetPressure,
});
```

### 4.3 Files Changed

| File | Change |
|------|--------|
| `server/services/middleware/loopDetection.ts` | Add semantic cycle detection (Layer 2) |
| `server/config/limits.ts` | Add pattern detection constants |
| `server/services/budgetService.ts` | Add `getBudgetPressure()` function |
| `server/services/llmRouter.ts` | Accept `budgetPressure`, downgrade model selection |
| `server/services/agentExecutionService.ts` | Compute + pass budget pressure to routeCall |

### 4.4 Verification

- [ ] Test cycle detection: mock a tool call history with A->B->A->B->A->B and confirm detection
- [ ] Test that non-cyclic diverse tool usage doesn't trigger false positives
- [ ] Test budget pressure returns 0 when no limits configured
- [ ] Test budget pressure returns >0.5 when approaching daily limit
- [ ] Confirm economy model is selected when pressure >= 0.75
- [ ] Confirm synthesis phase never gets downgraded (agent needs quality for summaries)
- [ ] Run `npm run typecheck` and `npm test`

---

## Stage 4 Checklist

- [ ] Upgrade `loopDetection.ts` with `detectCycle()` function
- [ ] Add constants to `limits.ts`
- [ ] Add `getBudgetPressure()` to `budgetService.ts`
- [ ] Update `llmRouter.ts` to accept and use budget pressure
- [ ] Wire budget pressure into agentic loop
- [ ] Write unit tests for `detectCycle()`
- [ ] Commit: `feat(agents): add semantic loop detection and budget pressure routing (GSD-2 adoption stage 4)`

---

## Stage 5 of 5 (20%) — Observability & Quality Gates

> Goal: Make failures visible, track skill performance, enforce architecture rules, record decisions.

### 5.1 Skill Health Metrics

**Problem:** Skills execute via `skillExecutor.ts` but there's no tracking of which skills succeed, fail, how much they cost, or how long they take. You can't answer "which skills are unreliable?" or "which skills are expensive?"

**Inspiration:** GSD-2 tracks skill metrics in `metrics.json` with usage stats, success rates, token consumption, and staleness detection.

#### 5.1.1 Design

Add a `skill_metrics` table and write to it after every skill execution in the agentic loop.

**New migration:** `0043_skill_metrics.ts`

**New schema:** `server/db/schema/skillMetrics.ts`

```typescript
import { pgTable, uuid, text, integer, boolean, timestamp, index } from 'drizzle-orm/pg-core';

export const skillMetrics = pgTable(
  'skill_metrics',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id').notNull(),
    skillSlug: text('skill_slug').notNull(),
    runId: uuid('run_id').notNull(),
    agentId: uuid('agent_id').notNull(),

    // Outcome
    success: boolean('success').notNull(),
    errorType: text('error_type'),        // e.g. 'validation', 'timeout', 'permission'
    errorMessage: text('error_message'),

    // Performance
    durationMs: integer('duration_ms').notNull(),
    retried: boolean('retried').notNull().default(false),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    orgSkillIdx: index('skill_metrics_org_skill_idx').on(table.organisationId, table.skillSlug),
    createdAtIdx: index('skill_metrics_created_at_idx').on(table.createdAt),
  })
);
```

#### 5.1.2 Write Metrics in the Agentic Loop

**File:** `server/services/agentExecutionService.ts`

After each tool call completes (line ~1105, after the `logEntry` creation), fire-and-forget a metrics write:

```typescript
// Fire-and-forget skill metric
db.insert(skillMetrics).values({
  organisationId: request.organisationId,
  skillSlug: toolCall.name,
  runId,
  agentId: request.agentId,
  success: !error,
  errorType: error?.type ?? null,
  errorMessage: error ? error.message.slice(0, 500) : null,
  durationMs: toolDurationMs,
  retried: retried ?? false,
}).catch(() => {}); // never block the loop
```

#### 5.1.3 Query API (future)

Not in this stage, but the table enables:
- `GET /api/admin/skill-metrics?orgId=X` — success rates by skill
- Dashboard widget showing unreliable skills
- Staleness detection (skills not used in 30+ days)

---

### 5.2 Post-Mortem on Failed Runs

**Problem:** When a run fails, the `summary` field contains whatever the agent managed to say. There's no structured analysis of what went wrong.

**Inspiration:** GSD-2's `/gsd forensics` provides anomaly detection, unit traces, and LLM-guided investigation.

#### 5.2.1 Design

After a run fails, queue an async job that analyzes the tool call log and writes a structured post-mortem to `taskActivities`.

**New file:** `server/services/postMortemService.ts`

```typescript
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { agentRuns, agentRunSnapshots, taskActivities } from '../db/schema/index.js';
import { logger } from '../lib/logger.js';

export const postMortemService = {
  /**
   * Analyze a failed run and write a structured post-mortem.
   * Called asynchronously after run failure — never blocks.
   */
  async analyzeFailedRun(runId: string): Promise<void> {
    const [run] = await db.select().from(agentRuns).where(eq(agentRuns.id, runId));
    if (!run || run.status === 'completed') return;

    const [snapshot] = await db.select().from(agentRunSnapshots).where(eq(agentRunSnapshots.runId, runId));
    const toolLog = (snapshot?.toolCallsLog ?? []) as Array<{
      tool: string; input: object; output: string; durationMs: number; iteration: number;
    }>;

    // Analyze patterns
    const analysis = {
      runId,
      status: run.status,
      durationMs: run.durationMs,
      totalToolCalls: run.totalToolCalls,
      totalTokens: run.totalTokens,
      errorMessage: run.errorMessage,
      errorDetail: run.errorDetail,

      // Tool usage breakdown
      toolBreakdown: Object.entries(
        toolLog.reduce((acc, t) => {
          acc[t.tool] = (acc[t.tool] ?? 0) + 1;
          return acc;
        }, {} as Record<string, number>)
      ).sort((a, b) => b[1] - a[1]),

      // Failed tool calls
      failedTools: toolLog.filter(t => {
        try { return !JSON.parse(t.output).success; } catch { return false; }
      }).map(t => ({ tool: t.tool, iteration: t.iteration, output: t.output.slice(0, 200) })),

      // Last 3 tool calls (most likely to show the failure point)
      lastToolCalls: toolLog.slice(-3).map(t => ({
        tool: t.tool, iteration: t.iteration, durationMs: t.durationMs,
      })),

      // Detect if the agent ran out of budget vs hit a real error
      failureCategory: categorizeFailure(run),
    };

    // Write to task activity if the run was working on a task
    if (run.taskId) {
      await db.insert(taskActivities).values({
        taskId: run.taskId,
        organisationId: run.organisationId,
        actorType: 'system',
        action: 'post_mortem',
        content: JSON.stringify(analysis, null, 2),
      }).catch(() => {});
    }

    // Also update the run's errorDetail with the analysis
    await db.update(agentRuns).set({
      errorDetail: { ...(run.errorDetail as object ?? {}), postMortem: analysis },
      updatedAt: new Date(),
    }).where(eq(agentRuns.id, runId));

    logger.info('post_mortem.completed', { runId, category: analysis.failureCategory });
  },
};

function categorizeFailure(run: typeof agentRuns.$inferSelect): string {
  if (run.status === 'timeout') return 'timeout';
  if (run.status === 'budget_exceeded') return 'budget_exhaustion';
  if (run.status === 'loop_detected') return 'loop';
  if (run.errorMessage?.includes('stale run')) return 'crash';
  if (run.errorMessage?.includes('rate limit')) return 'rate_limit';
  return 'execution_error';
}
```

#### 5.2.2 Trigger After Failed Runs

**File:** `server/services/agentExecutionService.ts`

In the run finalization block (line ~625), after writing the run status, fire-and-forget:

```typescript
// Async post-mortem for non-success runs
if (finalStatus !== 'completed') {
  import('./postMortemService.js').then(({ postMortemService }) => {
    postMortemService.analyzeFailedRun(run.id).catch(() => {});
  });
}
```

---

### 5.3 Extended Arch-Guard

**Problem:** `.claude/hooks/arch-guard.sh` only wires 5 of the 24 available verification scripts. Key architecture rules (soft-delete filters, service error format, org-id source) aren't automatically checked.

**Change:** Wire the most impactful additional scripts into the hook.

**File:** `.claude/hooks/arch-guard.sh`

Add to the route changes block:
```bash
if $HAS_ROUTE_CHANGES; then
  # Existing checks
  bash "$ROOT_DIR/scripts/verify-no-db-in-routes.sh" || [ $? -eq 2 ] || EXIT_CODE=1
  bash "$ROOT_DIR/scripts/verify-async-handler.sh" || EXIT_CODE=1
  bash "$ROOT_DIR/scripts/verify-subaccount-resolution.sh" || EXIT_CODE=1
  bash "$ROOT_DIR/scripts/verify-no-direct-role-checks.sh" || [ $? -eq 2 ] || EXIT_CODE=1

  # NEW: additional architecture guards
  bash "$ROOT_DIR/scripts/verify-org-id-source.sh" || [ $? -eq 2 ] || EXIT_CODE=1
fi

if $HAS_SERVICE_CHANGES; then
  # Existing
  bash "$ROOT_DIR/scripts/verify-org-scoped-writes.sh" || EXIT_CODE=1

  # NEW: additional service guards
  bash "$ROOT_DIR/scripts/verify-soft-delete-integrity.sh" || [ $? -eq 2 ] || EXIT_CODE=1
  bash "$ROOT_DIR/scripts/verify-service-contracts.sh" || [ $? -eq 2 ] || EXIT_CODE=1
fi
```

Also add a schema change detection:
```bash
HAS_SCHEMA_CHANGES=false
for f in $CHANGED_FILES; do
  [[ "$f" == server/db/schema/* ]] && HAS_SCHEMA_CHANGES=true
done

if $HAS_SCHEMA_CHANGES; then
  bash "$ROOT_DIR/scripts/verify-schema-compliance.sh" || [ $? -eq 2 ] || EXIT_CODE=1
  bash "$ROOT_DIR/scripts/verify-data-relationships.sh" || [ $? -eq 2 ] || EXIT_CODE=1
fi
```

**Note:** Using `[ $? -eq 2 ]` as fallback means exit code 2 (warnings/not-applicable) is treated as pass. Only exit code 1 (real violations) blocks.

---

### 5.4 ADR (Architecture Decision Records)

**Problem:** Architecture rules exist in `CLAUDE.md` and `architecture.md` but there's no record of *why* decisions were made. When a future session asks "why don't we use X?", there's no answer.

**Change:** Create a `docs/decisions/` directory with a template and seed it with the most important existing decisions.

**New file:** `docs/decisions/TEMPLATE.md`

```markdown
# ADR-NNN: [Title]

**Date:** YYYY-MM-DD
**Status:** Accepted | Superseded by ADR-NNN | Deprecated

## Context

[What is the issue? What forces are at play?]

## Decision

[What did we decide?]

## Consequences

[What are the positive and negative outcomes?]
```

**New file:** `docs/decisions/ADR-001-three-tier-agent-model.md`

```markdown
# ADR-001: Three-Tier Agent Model (System -> Org -> Subaccount)

**Date:** 2026-01-15 (reconstructed)
**Status:** Accepted

## Context

Needed a way to distribute AI agents across the platform where:
- Platform IP (system prompts) stays hidden from org admins
- Orgs can customize agents without breaking system behavior
- Each client (subaccount) can override config independently

## Decision

Three-tier inheritance: System Agent -> Org Agent -> Subaccount Agent.
System agents own the masterPrompt (hidden). Org agents inherit it when isSystemManaged=true.
Subaccount agents can override heartbeat, skills, and limits per client.

## Consequences

- Positive: Clear separation of concerns. System IP is protected. Orgs have flexibility.
- Positive: Subaccount overrides enable per-client customization without org-wide changes.
- Negative: Three-table joins for full agent resolution. More complex than a flat model.
- Negative: isSystemManaged flag creates two code paths (editable vs read-only masterPrompt).
```

**New file:** `docs/decisions/ADR-002-pg-boss-over-bullmq.md`

```markdown
# ADR-002: pg-boss for Job Scheduling (over BullMQ/Redis)

**Date:** 2026-02-01 (reconstructed)
**Status:** Accepted

## Context

Needed a job queue for: agent scheduling, handoff execution, triggered runs, execution processing.
Options: pg-boss (PostgreSQL-backed), BullMQ (Redis-backed), custom.

## Decision

Use pg-boss. It uses the existing PostgreSQL database — no additional infrastructure (Redis).
Fallback to in-memory SimpleQueue when pg-boss is unavailable (dev/test).

## Consequences

- Positive: No Redis dependency. Single database for everything. Transactional consistency.
- Positive: Fallback scheduler means the system works without pg-boss installed.
- Negative: Less throughput than Redis-backed queues. Not an issue at current scale.
- Negative: Advisory locks needed for deduplication in fallback mode.
```

**Update CLAUDE.md:** Add to architecture rules section:

```markdown
### Decisions
- **New architectural decisions** must be recorded in `docs/decisions/` using the ADR template
- The architect agent should create ADRs when making SIGNIFICANT or MAJOR decisions
```

---

### 5.5 Files Changed

| File | Change |
|------|--------|
| `server/db/schema/skillMetrics.ts` | New schema |
| `migrations/0043_skill_metrics.ts` | New migration |
| `server/services/agentExecutionService.ts` | Skill metrics writes + post-mortem trigger |
| `server/services/postMortemService.ts` | New service |
| `.claude/hooks/arch-guard.sh` | Wire additional verification scripts |
| `docs/decisions/TEMPLATE.md` | New template |
| `docs/decisions/ADR-001-three-tier-agent-model.md` | New ADR |
| `docs/decisions/ADR-002-pg-boss-over-bullmq.md` | New ADR |
| `CLAUDE.md` | Add ADR rule to architecture section |

### 5.6 Verification

- [ ] Confirm `skill_metrics` table is created by migration
- [ ] Run an agent, verify metrics rows are written per tool call
- [ ] Force a run failure, verify post-mortem is written to `errorDetail`
- [ ] Modify a route file and verify extended arch-guard runs the new checks
- [ ] Modify a service file and verify soft-delete + service-contracts checks run
- [ ] Confirm ADR template renders correctly
- [ ] Run `npm run typecheck` and `npm test`

---

## Stage 5 Checklist

- [ ] Create `skillMetrics` schema + migration
- [ ] Add metrics writes to agentic loop
- [ ] Create `postMortemService.ts`
- [ ] Wire post-mortem trigger on failed runs
- [ ] Extend `arch-guard.sh` with additional verification scripts
- [ ] Create `docs/decisions/` directory with template + 2 seed ADRs
- [ ] Add ADR rule to CLAUDE.md
- [ ] Commit: `feat: add skill metrics, post-mortem analysis, extended arch-guard, and ADR system (GSD-2 adoption stage 5)`

---

## Full Implementation Order

| Stage | Scope | Effort | Dependencies |
|-------|-------|--------|-------------|
| **1** | CLAUDE.md: verification, stuck detection, KNOWLEDGE.md | Low | None |
| **2** | App: crash recovery, stale run detection | Medium | Migration |
| **3** | App: context pressure, observation masking | Medium | Stage 2 (middleware types) |
| **4** | App: semantic loop detection, budget pressure | Medium | Stage 3 (middleware pattern) |
| **5** | App: skill metrics, post-mortem, arch-guard, ADRs | Medium | Stage 2 (migration pattern) |

Stages 1-3 are the "must do" tier. Stages 4-5 are "do next" tier.
Each stage is independently deployable and testable.

---
