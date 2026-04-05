# Langfuse Deep Instrumentation — Development Brief

## Executive Summary

We have Langfuse installed (`langfuse ^3.38.6`) with solid infrastructure (singleton client, AsyncLocalStorage-based context propagation) but minimal usage. We trace agent runs at a coarse level — one trace per run, one generation span per LLM call, and basic skill action spans. We are effectively blind to what happens *inside* a run: which model was selected and why, what each step cost, where latency lives, how handoff chains flow, whether our skill pipeline is failing silently.

This brief proposes going from "Langfuse is installed" to "Langfuse is our observability backbone for the entire agent system." The goal is to unlock three outcomes:
1. **Debug agent behaviour** — trace every decision, tool call, and handoff in a single waterfall view
2. **Optimise costs** — see cost per step, per skill, per model, per agent, per subaccount
3. **Scale intelligently** — use evaluation datasets and prompt versioning to improve agent quality systematically rather than by guesswork

---

## Current State of Integration

### What exists today

| Layer | File | What's traced | What's missing |
|-------|------|---------------|----------------|
| **Run lifecycle** | `agentExecutionService.ts:589` | Top-level trace with `agent-run` name, tagged with subaccountId, runId, agentId, orgId | No spans for: config loading, pre-run guards, workspace limit checks, finalization, insight extraction. Claude Code mode has zero coverage. Trace is never updated at end with status/duration/tokens. |
| **LLM calls** | `llmRouter.ts:645` | `generation` span with model, input/output messages, token usage, provider, runId | Missing: routing decision (tier, wasDowngraded, reason), budget reservation details, provider fallback attempts, cost in cents, idempotency key, latency breakdown (TTFT vs total). Not emitted for cache hits, budget blocks, or provider failures. |
| **Skill execution** | `skillExecutor.ts:440,536` | Basic `span` with action type and input for auto-gated and review-gated actions | Missing: skill name, execution phase, gate decision (auto/review/block), action state transitions, TripWire retries, output, duration, review wait time. Direct skills (web_search, read_workspace, etc.) have zero tracing. |
| **Handoffs** | — | Nothing | No trace linking between parent and child runs; handoff depth not recorded; handoff context not captured |
| **Sub-agent spawning** | — | Nothing | `spawn_sub_agents` runs children via Promise.all directly — no fan-out/fan-in span |
| **Heartbeats/Scheduling** | — | Nothing | No session linking across wakeups; no span for schedule trigger vs heartbeat update |
| **Memory/RAG** | — | Nothing | No span for semantic search queries, vector similarity scores, memory injection, insight extraction |
| **Budget system** | — | Nothing | No span for reservation creation, hierarchy checks, commitment, delta release |
| **HITL/Review** | — | Nothing | No span for review gate wait time, approval/rejection decisions, timeout events |
| **Middleware** | — | Nothing | Pre-call and pre-tool middleware decisions (stop/inject/skip) are invisible |
| **MCP** | — | Nothing | MCP server delegates to skillExecutor but has no session-level tracing |

### Infrastructure quality

The existing infrastructure in `server/instrumentation.ts` is well-designed:
- Singleton Langfuse client with conditional enablement (no-ops if keys missing)
- `withTrace()` / `getActiveTrace()` via AsyncLocalStorage — any function in the async call stack can emit spans without argument threading
- Flush config: batch of 10, interval 5s

This foundation is ready for deeper instrumentation — we don't need to redesign it, just add spans in more places.

---

## Langfuse Capabilities We Should Use

### Tier 1 — High value, use immediately

**Deep Tracing (Traces > Spans > Generations > Events)**
- Supports arbitrary nesting: Session > Trace > Span > Generation > Event
- Each level carries: `name`, `input`, `output`, `metadata` (arbitrary JSON), `startTime`, `endTime`, `level`, `statusMessage`
- Generations additionally carry: `model`, `modelParameters`, `usage_details` (input/output/cached/reasoning tokens), `cost_details`, `promptName`, `promptVersion`, `completionStartTime` (TTFT)
- Events are point-in-time markers (no duration) — perfect for decision points
- **Our use:** Build a full trace tree per agent run

**Session Tracking**
- Pass `sessionId` to group traces. Timeline view with aggregated tokens, cost, duration.
- **Our use:** Link traces across handoff chains and heartbeat wakeups

**Automatic Cost Calculation**
- Maintains cost registry for OpenAI, Anthropic, Google. Supports tiered pricing.
- Pre-built cost dashboard: spend over time by model, user, trace name, prompt version
- **Our use:** Dual-write — our ledger for billing, Langfuse for operational dashboards

**User-Level Analytics**
- Pass `userId` on traces. Builds User Explorer with per-user metrics.
- **Our use:** Map `subaccountId` as userId for per-workspace observability

### Tier 2 — Medium value, implement after core tracing

**Scores and Evaluation**
- Attach numeric, categorical, or boolean scores to any trace or span
- Sources: API/SDK, human annotation, LLM-as-a-Judge, annotation queues
- **Our use:** Score agent runs on quality dimensions, feed runOutcome as scores

**Datasets and Experiments**
- Input/expectedOutput pairs, created from production traces
- Run experiments, compare across runs
- **Our use:** Regression testing for skill prompts

**Prompt Management**
- Version-controlled prompts with labels (production, staging)
- SDK fetches at runtime with 60s cache + background refresh
- Composable prompts (shared fragments)
- **Our use:** Move skill prompts from code to Langfuse (future)

### Tier 3 — Evaluate later

- **Playground** — prompt testing in UI
- **Custom Dashboards** — built on Metrics API
- **Self-Hosting** — MIT-licensed, requires Postgres + ClickHouse + Redis + S3
- **Metrics API** — programmatic analytics access

---

## What to Build (Workstreams)

### Workstream 1: Full Trace Tree for Agent Runs

**Goal:** Every agent run produces a complete, nested trace that tells the full story.

**Trace hierarchy:**

```
Session: handoff-chain-{rootRunId} or schedule-{agentId}-{date}
+-- Trace: agent-run (existing, enhance metadata)
    +-- Span: config-load
    +-- Span: pre-run-guards (workspace limits, budget checks)
    +-- Span: agentic-loop
    |   +-- Span: iteration-0 (phase: planning)
    |   |   +-- Event: pre-call-middleware (decision: continue/stop/inject)
    |   |   +-- Generation: llm-call (model, provider, tier, tokens, cost, TTFT)
    |   |   |   +-- Event: model-escalation (if economy->frontier)
    |   |   |   +-- Event: provider-fallback (if primary failed)
    |   |   +-- Span: tool-execution (skill: web_search)
    |   |   |   +-- Event: action-proposed
    |   |   |   +-- Event: gate-decision (auto/review/block)
    |   |   |   +-- Span: skill-execute (actual work)
    |   |   +-- Span: tool-execution (skill: write_workspace)
    |   +-- Span: iteration-1 (phase: execution)
    |   |   +-- Generation: llm-call
    |   |   +-- Span: tool-execution (skill: send_email)
    |   |       +-- Event: action-proposed
    |   |       +-- Event: gate-decision (review_gated)
    |   |       +-- Span: review-wait (duration = human response time)
    |   |       +-- Span: skill-execute
    |   +-- Span: iteration-2 (phase: synthesis)
    |       +-- Generation: llm-call (final response, no tools)
    +-- Span: finalization
    |   +-- Event: run-status-update (completed/failed/timeout)
    |   +-- Span: insight-extraction (memory extraction LLM call)
    +-- Span: workspace-memory
        +-- Span: memory-recall (vector search query, results, similarity scores)
        +-- Span: memory-inject (what was injected into system prompt)
```

### Workstream 2: Cross-Run Session Linking

**Goal:** Connect related runs in a single session view.

Two patterns:
1. **Handoff chains:** `sessionId = handoff-chain-{rootRunId}`. Propagate root session ID through pg-boss job payload. Tag with `handoffDepth`, `sourceRunId`, `chainLength`.
2. **Scheduled/recurring runs:** `sessionId = schedule-{agentId}-{YYYY-MM-DD}`. Day's runs visible in sequence.
3. **Sub-agent spawns:** Parent span wraps the fan-out, child runs link back. Tag with `fanOutCount`.

### Workstream 3: LLM Router Enrichment

**Goal:** Every LLM call captures the full routing decision, not just the final model.

Add to generation span:
- Routing decision: tier, wasDowngraded, downgradeReason
- Budget context: reservationId, estimatedCost, actualCost, budgetRemaining
- Provider chain: attempted providers, failures, cooldown state
- Latency: `completionStartTime` for TTFT
- Cost: `cost_details` with actual cost in cents (our pricing with margin)

Add events for: provider fallback, model escalation, budget exceeded.

### Workstream 4: Skill Pipeline Instrumentation

**Goal:** See inside the skill execution pipeline — not just "tool X was called."

For each skill execution:
- `processInput` phase span
- Gate decision event (auto/review/block + policy rule)
- For review-gated: `review-wait` span (captures human response time)
- `execute` phase span
- `processOutputStep` phase span
- TripWire handling event (retry count, error type, retryable vs fatal)
- Explicit `skill_failed` event with reason classification

### Workstream 5: Memory/RAG Observability

**Goal:** Understand what context agents work with and whether retrieval is effective.

Spans: memory-recall (query, results, similarity scores), memory-inject (length/summary), insight-extraction (quality scores).

### Workstream 6: Scores and Quality Tracking

**Goal:** Attach quality signals to traces for measurement over time.

Automatic scores: run-outcome, tool-success-rate, review-approval-rate, cost-efficiency, iteration-count. Human and LLM-as-Judge scores deferred.

---

## Implementation Approach + Sequencing

### Design Principles

1. **Non-breaking:** All new spans use `getActiveTrace()?.span()` — no-ops if Langfuse disabled.
2. **Dual-write:** Our ledger = billing truth. Langfuse = observability layer.
3. **Incremental:** Each workstream is independently shippable.
4. **Low overhead:** SDK batches events, fire-and-forget, non-blocking.

### Sequencing

| Phase | Workstream | Effort | Files | Risk |
|-------|-----------|--------|-------|------|
| 1 | Core Tracing Depth (loop + router) | 1-2 days | 2 | Very low |
| 2 | Skill Pipeline + HITL | 1-2 days | 2-3 | Very low |
| 3 | Cross-Run Linking | 0.5-1 day | 3 | Low |
| 4 | Memory/RAG Observability | 0.5 day | 1 | Very low |
| 5 | Quality Scores | 1-2 days | 2-3 | Low |
| 6 | Prompt Management (future) | 3-5 days | 10+ | Medium |

**Phases 1-4 total: ~3-5 days of development.**

### What NOT to do now

- Self-hosting Langfuse (operational overhead)
- Custom dashboards (use built-in views first)
- Metrics API integration (ledger handles billing)
- OpenTelemetry migration (direct SDK is simpler)

---

## Cost/Benefit Analysis

### Benefits by Phase

**After Phase 1:** Debug any run via trace. See model selection, cost per call, iteration count, latency, provider failures.

**After Phase 2:** See what tools agents use, review gate bottlenecks, TripWire patterns, failing skills.

**After Phase 3:** Follow handoff chains end-to-end. See scheduled agent daily patterns.

**After Phase 4:** Debug "agent didn't know X" via retrieval data. Tune similarity thresholds.

**After Phase 5:** Track agent quality over time with real metrics.

### Should We Implement Now?

**Yes, Phases 1-4.** We're scaling blind, the infrastructure is built, the cost is low (~3-5 days, ~8 files, all additive), and the alternative is log spelunking across multiple tables.

### Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| Langfuse cloud goes down | SDK no-ops gracefully. Ledger is billing truth. |
| Performance overhead | Fire-and-forget, batched. Negligible at our volume. |
| Data volume / cloud costs | Start on free tier (50k obs/month). Self-host if needed. |
| Prompt mgmt dependency | Defer until confident. SDK caches last-known prompt. |
| Over-instrumentation noise | Standardisation layer (see next section). |

---

## Standardisation Layer (Instrumentation Guardrails)

### 7.1 Instrumentation Contract

The biggest risk to this project isn't *what* we trace — it's consistency drift. Without a contract layer, each developer adds spans with slightly different metadata shapes, naming, and conventions. Dashboards break. Queries become unreliable.

**Solution: Central tracing helpers with enforced schemas.**

Create `server/lib/tracing.ts` with typed helpers:

```typescript
// Conceptual API — not implementation spec
createSpan(name: SpanName, metadata: SpanMetadataSchema, options?: SpanOptions)
createGeneration(metadata: GenerationMetadataSchema)
createEvent(name: EventName, payload: EventPayloadSchema)
finalizeTrace(status: RunStatus, summary: TraceSummary)
```

Each helper:
- Validates metadata against a Zod schema for that span type
- Injects default context automatically (runId, orgId, subaccountId, agentId) from AsyncLocalStorage
- Enforces the naming registry (rejects unknown span names)
- Handles the `getActiveTrace()?.` null-check pattern internally
- Returns a typed `end()` function that also validates output schema

**What this buys us:**
- Single place to change tracing behaviour (sampling, cardinality limits, etc.)
- Type safety — TypeScript catches missing or wrong metadata at compile time
- Consistent metadata shape across all spans — dashboards and queries work reliably
- Default context injection means developers can't forget runId/orgId

**Default metadata injected on every span:**

| Field | Source | Always present |
|-------|--------|---------------|
| `runId` | AsyncLocalStorage context | Yes |
| `orgId` | AsyncLocalStorage context | Yes |
| `subaccountId` | AsyncLocalStorage context | Yes |
| `agentId` | AsyncLocalStorage context | Yes |
| `executionMode` | Run config | Yes |
| `timestamp` | `Date.now()` | Yes |

This means the existing `withTrace()` in `instrumentation.ts` should be extended to also store run context (not just the trace object) in AsyncLocalStorage, so the helpers can pull it automatically.

### 7.2 Naming Convention Registry

Free-text span names lead to inconsistency and broken queries. All span, generation, and event names must come from a predefined registry.

**Format:** `<domain>.<component>.<action>`

**Registry:**

```
# Spans (timed operations)
agent.run.lifecycle          # Top-level trace
agent.loop.iteration         # Single loop iteration
agent.config.load            # Config + prompt assembly
agent.guards.check           # Pre-run workspace limit checks
agent.finalization.run       # Post-run status + cleanup

llm.router.call              # LLM generation (existing, rename from 'llm-call')

skill.pipeline.run           # Full skill execution wrapper
skill.phase.processInput     # Input processing phase
skill.phase.execute          # Actual skill work
skill.phase.processOutput    # Output processing phase
skill.review.wait            # HITL blocking wait

memory.recall.query          # Semantic search
memory.inject.build          # System prompt injection
memory.insights.extract      # Post-run insight extraction

budget.reservation.check     # Budget hierarchy check + reserve

# Generations (LLM calls — use Langfuse generation type)
llm.router.call              # Standard LLM call
memory.insights.llm          # Insight extraction LLM call
memory.summary.llm           # Summary regeneration LLM call

# Events (point-in-time, no duration)
llm.router.escalation        # Economy -> frontier escalation
llm.router.fallback          # Provider fallback attempt
llm.router.budget_exceeded   # Call rejected due to budget
llm.router.cache_hit         # Idempotent response returned

skill.gate.decision          # auto/review/block decision
skill.action.proposed        # Action record created
skill.action.failed          # Skill execution failed (with reason)
skill.tripwire.triggered     # TripWire retry or fatal

agent.middleware.decision     # Pre-call or pre-tool middleware stop/inject/skip
agent.loop.terminated        # Loop ended (with reason)
agent.handoff.enqueued       # Handoff job created
agent.spawn.fanout           # Sub-agent parallel spawn

run.status.changed           # completed/failed/timeout/budget_exceeded
```

**Rules:**
- No free-text names — all names must exist in the registry
- No dynamic naming (no `skill.execute.${skillName}` — put `skillName` in metadata)
- Registry lives in `server/lib/tracing.ts` as a TypeScript string union
- Adding a new name requires updating the registry (intentional friction)

### 7.3 Cardinality Control

Langfuse (and any observability backend) degrades with high-cardinality metadata fields. We must define rules per field type.

**Field rules:**

| Field type | Strategy | Example |
|-----------|----------|---------|
| IDs (runId, agentId, orgId) | Always allowed — bounded cardinality | `runId: "abc123"` |
| Enums (status, phase, tier) | Always allowed — predefined values | `phase: "planning"` |
| Model names | Always allowed — bounded set | `model: "claude-sonnet-4-20250514"` |
| Short text (<200 chars) | Allowed in metadata | `skillName: "send_email"` |
| Long text (messages, prompts) | Truncate to 500 chars in metadata; full content in `input`/`output` fields only | `query: truncate(query, 500)` |
| User content (tool payloads) | Truncate to 1000 chars; hash if sensitive | `input: truncate(payload, 1000)` |
| Error messages | Normalise to error type enum + first 200 chars of message | `errorType: "provider_error", errorMessage: truncate(msg, 200)` |
| Numeric values (cost, tokens, scores) | Always allowed | `costCents: 42` |
| Arrays (provider chain) | Limit to 10 elements, stringify | `failedProviders: ["openai", "gemini"]` |

**Implementation:** The `createSpan()` / `createGeneration()` helpers enforce these rules via Zod transform schemas. Developers pass raw data; the helper truncates/normalises before sending to Langfuse.

**What goes in `input`/`output` vs `metadata`:**
- `input`/`output`: Full content (messages, tool payloads, LLM responses). Langfuse handles storage efficiently for these fields.
- `metadata`: Structured, queryable fields only. This is what dashboards and filters use. Keep it clean.

### 7.4 Sampling Strategy

Tracing everything works at low volume but won't scale indefinitely. Build sampling into the contract layer from day one, even if we start at 100%.

**Sampling modes:**

| Condition | Sample rate | Rationale |
|-----------|------------|-----------|
| Run ends in error/failure/timeout | 100% | Always trace failures |
| Budget exceeded | 100% | Always trace budget events |
| Handoff chains (depth > 0) | 100% | Always trace multi-agent flows |
| Review-gated actions present | 100% | Always trace HITL workflows |
| Normal successful runs | 100% initially, reduce to 20-50% at scale | Volume control |

**Implementation:** A `shouldTrace(run)` function in `server/lib/tracing.ts` that evaluates at run start. If false, the entire run gets a no-op trace context — all `createSpan()` calls become no-ops with zero overhead.

**Future evolution:** Dynamic sampling based on:
- Agent error rate (high error rate → increase sampling)
- Cost per run (expensive runs → always trace)
- Subaccount tier (premium subaccounts → higher sampling)
- Time-based (first run of the day → always trace)

**Day one:** Ship at 100% sampling. Add the `shouldTrace()` hook so we can dial it down without code changes when volume grows.

### 7.5 Error Taxonomy Standardisation

We already have error classification in `server/services/middleware/errorHandling.ts`. Reuse the same taxonomy in Langfuse so errors are queryable and consistent across both systems.

**Standard error types (attach to traces, generations, and spans):**

```
provider_error      # LLM provider returned an error (5xx, rate limit, auth)
validation_error    # Invalid tool call, missing required fields, schema mismatch
tool_failure        # Skill execution failed
budget_exceeded     # Run or call rejected due to budget limits
rate_limited        # Per-minute or per-hour rate limit hit
timeout             # Run, HITL wait, or provider call timed out
loop_detected       # Agent stuck in a loop (middleware detected)
handoff_depth       # Handoff chain exceeded MAX_HANDOFF_DEPTH
tripwire_fatal      # TripWire signalled non-retryable failure
internal_error      # Unexpected/unclassified error
```

**Where errors attach:**

| Langfuse object | Error fields |
|----------------|--------------|
| Trace (agent-run) | `metadata.errorType`, `metadata.errorMessage`, `statusMessage`, level: `ERROR` |
| Generation (llm-call) | `metadata.errorType`, `statusMessage` on failed calls, level: `ERROR` |
| Span (skill execution) | `metadata.errorType`, `metadata.errorMessage`, level: `ERROR` or `WARNING` for retryable |
| Event | `metadata.errorType` for decision events (budget_exceeded, loop_detected) |

**Trace finalisation (mandatory):**

Every trace MUST end with a status update. This is the single most impactful missing piece today.

```typescript
// At end of executeRun(), regardless of success or failure:
trace.update({
  output: { status, errorType, errorMessage },  // structured final state
  metadata: {
    ...existingMetadata,
    finalStatus: status,           // completed | failed | timeout | budget_exceeded | loop_detected
    totalCostCents: aggregatedCost,
    totalTokensIn: aggregatedTokensIn,
    totalTokensOut: aggregatedTokensOut,
    iterationCount: loopIterations,
    toolCallCount: totalToolCalls,
    durationMs: Date.now() - startTime,
    errorType: errorType || null,
  }
});
await langfuse.flushAsync();  // Ensure final state is sent
```

Without trace finalisation: dashboards show incomplete data, sessions are misleading, and you can't reliably query "all failed runs."

### 7.6 Idempotency and Duplication Protection

Retries, TripWire, and provider fallback loops can cause duplicate span emission. Guard against this.

**Risk areas:**
- **Provider fallback loop:** Each retry attempt should be a separate event, not a duplicate generation. The successful call is the generation; failed attempts are events.
- **Skill TripWire retries:** Each retry should be a separate span with a `retryIndex` in metadata, not overwriting the original span.
- **HITL pre-resolved decisions:** If approval arrives before `awaitDecision` registers, don't emit both a "waiting" and "pre-resolved" span.

**Implementation:**
- Generate deterministic span IDs where possible: `spanId = hash(runId + spanName + iterationIndex + retryIndex)`
- The `createSpan()` helper maintains a `Set<string>` of emitted span IDs per trace context
- Before emitting, check: `if (emittedSpans.has(spanId)) return noopSpan`
- For retry loops: use `retryIndex` in the span ID to ensure each attempt gets its own span

### 7.7 Performance Budget

Observability should never slow down the system it observes.

**Limits:**

| Metric | Limit | Enforcement |
|--------|-------|-------------|
| Max spans per run | 500 | Counter in trace context; `createSpan()` returns no-op after limit |
| Max metadata size per span | 4KB (after JSON serialisation) | Zod transform truncates oversized fields |
| Max events per iteration | 20 | Counter per iteration; excess events dropped with warning log |
| Max total observations per run | 1000 | Hard cap; covers spans + generations + events combined |

**Fail-safe:** If `spanCount > limit`, the helpers log a warning and stop emitting for that run. The trace still has partial data (better than nothing) and the warning surfaces in application logs for investigation.

**Overhead budget:** All tracing operations (span creation, metadata serialisation, Langfuse SDK calls) should add < 5ms per span. The SDK's batching (flushAt: 10, flushInterval: 5000ms) handles network overhead. If we observe P99 latency increase > 1% attributable to tracing, reduce sampling rate first.

---

## Architectural Elevations

### 8.1 Shadow Execution Graph

The brief currently treats Langfuse as a logging layer. The feedback correctly identifies we can elevate it to a **parallel execution graph** — a structured mirror of every agent run that can be reconstructed deterministically.

**What this means in practice:**
- Every decision point, state transition, and data flow is captured with enough context to replay the run's logic
- The trace tree mirrors the actual call graph — not an approximation
- Spans carry both inputs and outputs, so you can reconstruct what the agent saw and decided at each step

**What this unlocks (future):**
- **Offline debugging:** Reconstruct a failed run step-by-step without reproducing it
- **Regression detection:** Compare trace trees of the same agent on different dates
- **Simulation:** Feed historical inputs to a modified agent and compare trace output

**What this requires now:** No additional work beyond what's already specified. If we implement the full trace tree (Workstream 1) with inputs/outputs on every span and decision events at every branch, we get the shadow graph for free. The key is discipline — don't skip spans for "simple" operations.

### 8.2 Decision Points as First-Class Events

The brief mentions events but underutilises them. Decision points are more valuable than spans for debugging *behaviour* (why the agent did X, not just how long X took).

**Decision events to prioritise:**

| Event | When | Payload |
|-------|------|---------|
| `llm.router.escalation` | Economy model fails validation | `fromModel`, `toModel`, `reason` (unknown_tool, missing_fields) |
| `skill.gate.decision` | Policy engine resolves gate level | `gateLevel` (auto/review/block), `policyRule`, `skillName` |
| `agent.middleware.decision` | Middleware halts or modifies loop | `middlewareName`, `decision` (continue/stop/inject), `reason` |
| `agent.loop.terminated` | Loop ends | `reason` (max_iterations, no_tool_calls, middleware_stop, error, budget) |
| `llm.router.fallback` | Provider fails, trying next | `failedProvider`, `error`, `nextProvider`, `attemptIndex` |
| `run.status.changed` | Run status transitions | `fromStatus`, `toStatus`, `reason` |

These events are cheap (no duration tracking), high-signal, and enable queries like "show me all runs where the model was escalated" or "which policy rules block the most actions."

### 8.3 Run Fingerprint

For grouping similar runs and detecting regressions:

```
runFingerprint = hash(agentId + taskType + configHash + skillSlugs.sort().join(','))
```

**What this enables:**
- **Clustering:** Group runs that should behave similarly
- **Comparison:** "This fingerprint used to complete in 3 iterations, now it takes 8 — what changed?"
- **Failure patterns:** "All runs with fingerprint X fail at skill Y"
- **Regression detection:** Compare score distributions for the same fingerprint over time

Attach as `metadata.runFingerprint` on the trace. Low effort, high analytical value.

### 8.4 Budget System Visibility

The budget system is a major operational concern that's underplayed in the base brief. We should be able to answer:

- **Where is budget consumed?** Cost per iteration, per skill, per LLM call
- **Which steps waste budget?** Failed calls that still consumed tokens, unnecessary retries
- **How accurate are estimates?** Reservation vs actual cost (budget variance)
- **Are we hitting limits?** Which budget tier is the bottleneck (agent, workspace, org, platform)

**Metadata to add on budget-related spans/events:**

```
budgetVariance:     estimatedCost - actualCost (how accurate is our estimation)
costPerIteration:   running cost total at each iteration boundary
costPerSkill:       cost attributed to each skill execution
budgetTierHit:      which limit was checked / which was closest to exhaustion
headroomPercent:    remaining budget as percentage at time of check
```

This turns Langfuse from "what happened" into "where money went" — critical for cost optimisation.

---

## Success Criteria

### 9.1 Top 5 Questions This Must Answer

Every piece of instrumentation should serve at least one of these questions. If a span doesn't help answer any of them, reconsider whether it's needed.

| # | Question | Which workstreams answer it |
|---|----------|-----------------------------|
| 1 | **Why did this run fail?** | WS1 (trace tree + error taxonomy + finalisation), WS3 (router errors), WS4 (skill failures) |
| 2 | **Where did time go?** | WS1 (iteration spans), WS4 (skill durations, HITL wait), WS5 (memory recall latency) |
| 3 | **Where did cost go?** | WS3 (cost per generation, budget variance), WS1 (cost per iteration), WS4 (cost per skill) |
| 4 | **Why did the agent choose this path?** | Decision events (gate decisions, model escalation, middleware stops, loop termination reason) |
| 5 | **What changed vs a successful run?** | Run fingerprint (compare similar runs), session linking (compare across chain), scores (quality delta) |

If, after implementation, a developer can't answer all 5 questions by looking at a single Langfuse trace, the instrumentation is incomplete.

### 9.2 Debug View Design (Target State)

Before writing code, we should know what the "perfect trace view" looks like in Langfuse. This is what we're building toward:

**Waterfall view of a single run:**
```
[agent.run.lifecycle] ─────────────────────────────────────── 12.4s  $0.08
  [agent.config.load] ──── 0.1s
  [agent.guards.check] ── 0.05s
  [agent.loop.iteration] phase:planning ──────────── 4.2s  $0.03
    ! middleware.decision: continue
    [llm.router.call] claude-sonnet tier:economy ── 3.8s  $0.02
      ! model-escalation: economy→frontier (unknown_tool)
    [skill.pipeline.run] web_search ── 0.4s
      ! gate.decision: auto (policy: default_auto)
      [skill.phase.execute] ── 0.3s
  [agent.loop.iteration] phase:execution ─────────── 6.1s  $0.04
    [llm.router.call] claude-sonnet tier:frontier ── 2.1s  $0.03
    [skill.pipeline.run] send_email ── 4.0s
      ! gate.decision: review_gated (policy: comms_review)
      [skill.review.wait] ── 3.8s  ← human took 3.8s to approve
      [skill.phase.execute] ── 0.2s
  [agent.loop.iteration] phase:synthesis ─────────── 1.8s  $0.01
    [llm.router.call] claude-sonnet tier:frontier ── 1.8s  $0.01
  [agent.finalization.run] ── 0.3s
    ! run.status.changed: completed
    [memory.insights.extract] ── 0.2s
```

**Key visual elements:**
- **Waterfall depth** shows nesting — you can see the trace tree structure
- **Cost overlay** on the right — see where money goes at a glance
- **Decision markers (!)** — point-in-time events that explain *why* things happened
- **Phase labels** on iterations — see the agent's cognitive progression
- **Duration** on each span — find the bottleneck instantly
- **HITL wait** stands out as a distinct, potentially long span — identify workflow bottlenecks

This view answers all 5 questions for any given run.

---

## Revised Recommendation

The feedback identifies three improvements to implement before building:

1. **Tracing contract** (central helpers + Zod schemas + default context injection) — Section 7.1
2. **Naming convention registry** (predefined span/event names as TypeScript union) — Section 7.2
3. **Trace finalisation + error taxonomy** (mandatory trace.update at run end) — Section 7.5

These three additions should be built as **Phase 0** — a small foundational layer (~0.5-1 day) that all subsequent phases build on. Without them, Phases 1-4 will ship inconsistent instrumentation that degrades over time.

**Revised sequencing:**

| Phase | What | Effort |
|-------|------|--------|
| **0** | Tracing contract + naming registry + error taxonomy + trace finalisation | 0.5-1 day |
| **1** | Core tracing depth (loop iterations + router enrichment) | 1-2 days |
| **2** | Skill pipeline + HITL + decision events | 1-2 days |
| **3** | Cross-run linking + run fingerprint | 0.5-1 day |
| **4** | Memory/RAG observability + budget visibility | 0.5-1 day |
| **5** | Quality scores (deferred) | 1-2 days |
| **6** | Prompt management migration (deferred) | 3-5 days |

**Total for Phases 0-4: ~4-6 days.**

The sampling strategy (7.4), cardinality control (7.3), idempotency protection (7.6), and performance budget (7.7) are built into Phase 0's contract layer — they're properties of the helpers, not separate work.
