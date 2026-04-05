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

---

## Usage Layer

Instrumentation that nobody uses is shelfware. This section defines who uses traces, how they use them, and what workflows to follow.

### 10.1 Primary Consumers

| Consumer | What they need | How they access it |
|----------|---------------|-------------------|
| **Engineers** | Debug failed runs, trace slow paths, understand agent decisions | Langfuse trace view — click into a specific run |
| **Product/Ops** | Understand agent behaviour patterns, identify bottlenecks, monitor HITL response times | Langfuse dashboards — filter by agent, subaccount, time range |
| **Cost optimisation** | Track spend per agent/model/skill, validate model routing decisions, find waste | Langfuse cost dashboard + generation metadata queries |

### 10.2 Core Workflows

**Debug a failed run:**
1. Find the run in Langfuse (filter: `finalStatus = failed`, or search by runId)
2. Open trace → check `run.status.changed` event for failure reason
3. Follow the waterfall → find the last successful span
4. Inspect the next span/event → that's where it broke
5. Check `errorType` + `errorMessage` in metadata
6. If LLM-related: check `llm.router.fallback` events for provider chain failures
7. If skill-related: check `skill.action.failed` event for classification

**Optimise cost for an agent:**
1. Filter traces by `agentId` in Langfuse
2. Sort by `totalCostCents` (trace metadata) — find expensive runs
3. Open an expensive run → inspect cost overlay on each generation
4. Check `routingTier` — are economy calls being escalated to frontier? How often?
5. Check `budgetVariance` — are estimates wildly off? (indicates model pricing is stale)
6. Compare `costPerIteration` across runs — identify whether cost is in planning, execution, or synthesis

**Investigate slow HITL workflows:**
1. Filter traces containing `skill.review.wait` spans
2. Sort by review wait duration
3. Identify which skills/agents create the longest review queues
4. Check approval vs rejection rate — are reviewers rubber-stamping or genuinely evaluating?

**Compare agent behaviour over time:**
1. Group by `runFingerprint`
2. Compare iteration count, cost, and scores across date ranges
3. If a fingerprint's performance degrades, diff the trace trees of good vs bad runs
4. Check if config changed (different `configHash`) or if prompts/skills changed

### 10.3 Anti-Patterns

Things that will degrade observability quality over time. Enforce these in code review.

| Anti-pattern | Why it's bad | What to do instead |
|-------------|-------------|-------------------|
| Log everything "just in case" | Noise drowns signal, cardinality explodes, costs grow | Only instrument what answers the Top 5 Questions |
| Put raw payloads into metadata | Breaks dashboards, high cardinality, slow queries | Use `input`/`output` fields for content; metadata for structured, queryable fields only |
| Create new span names ad hoc | Naming drift, broken queries, inconsistent dashboards | All names must exist in the registry (Section 7.2). PR rejected if new name not added to registry. |
| Bypass tracing helpers | Inconsistent metadata, missing context, no schema validation | Never call `getActiveTrace()?.span()` directly — always use `createSpan()` helper |
| Instrument inside tight loops without limits | Span explosion, performance degradation | Use performance budget limits (Section 7.7). Aggregate loop data, don't span each iteration of inner loops. |
| Rely on Langfuse for business logic | Coupling observability to execution, fragile when Langfuse is down | Langfuse is read-only observability. Business logic uses our own ledger/DB. |
| Turn decisions into spans | Clutters waterfall, wastes span budget on zero-duration items | Decisions are events. Spans are for work with duration. (Section 7.2 enforces this via the registry.) |
| Span names with dynamic content | `skill.execute.send_email` creates unbounded cardinality | Use `skill.pipeline.run` with `skillName: "send_email"` in metadata |

---

## Rollout Strategy

### 11.1 Incremental Rollout Plan

This won't be clean. There will be a period of partial instrumentation. That's fine — define what "done" looks like at each phase so partial is still useful.

**Rollout pattern:**

```
Phase 0: Ship helpers → validate they work on 1 existing call site (refactor llmRouter.ts generation)
Phase 1: Instrument loop + router → validate in Langfuse UI with real runs
Phase 2: Instrument skills → validate skill spans nest correctly under iterations
Phase 3: Add session linking → validate handoff chains appear as single sessions
Phase 4: Instrument memory → validate recall spans appear under correct iterations
```

**At each phase boundary:**
1. Run 3-5 real agent runs through the instrumented paths
2. Open traces in Langfuse UI
3. Verify: trace tree structure matches the design (Section 9.2)
4. Verify: no cardinality explosions (check Langfuse observation count)
5. Verify: can answer at least one of the Top 5 Questions
6. Only proceed to next phase if validation passes

### 11.2 Definition of Done (per phase)

| Phase | Done when... |
|-------|-------------|
| 0 | Helpers exist, existing generation span refactored to use them, trace finalisation works, one test run produces a clean trace |
| 1 | Opening any agent run trace shows iteration spans, generation spans with routing metadata, decision events. Can answer "why did this run fail?" and "where did cost go?" |
| 2 | Skill executions appear as nested spans under iterations. HITL wait time visible. Can answer "where did time go?" |
| 3 | Handoff chains visible as single session. Run fingerprint on all traces. Can answer "what changed vs a successful run?" |
| 4 | Memory recall spans show query + results + scores. Budget metadata on generations. Can answer all 5 questions. |

### 11.3 Minimal Viable Trace

Not every run needs full instrumentation from day one. Define the minimum that makes a trace useful:

**A trace is "validly instrumented" if it has:**
- Trace with complete metadata (agentId, orgId, subaccountId, executionMode, runFingerprint)
- At least 1 iteration span with phase label
- At least 1 generation span with model + tokens + cost
- Trace finalisation with `finalStatus`, `totalCostCents`, `durationMs`

This ensures partial instrumentation is still useful. A trace missing skill spans is less useful but still debuggable. A trace missing finalisation is broken.

**Validation:** The `finalizeTrace()` helper should log a warning if the trace doesn't meet MVT requirements (e.g., zero generations recorded). This catches instrumentation bugs early.

### 11.4 Trace Versioning

Once shipped, the metadata schema becomes a contract. Changing it breaks dashboards and queries.

**Add to every trace:**
```
metadata.traceSchemaVersion: "v1"
```

**Rules:**
- Additive changes (new fields): no version bump needed
- Renamed or removed fields: bump to `v2`, update dashboards
- Changed field semantics: bump version, document migration

**Why this matters:**
- Dashboards can filter by version during migrations
- Old traces remain queryable with their original schema
- Enables A/B instrumentation experiments (test new metadata shape on 10% of runs)

---

## Execution Path Parity

### 12.1 All Paths Must Produce the Same Trace Structure

The codebase has multiple execution paths that must all produce equivalent traces:

| Path | Current coverage | Required |
|------|-----------------|----------|
| API agentic loop | Partial (trace + generation + skill spans) | Full trace tree |
| Claude Code CLI | Zero | Same trace structure — create trace before CLI spawn, emit events for turns |
| MCP tool invocations | Zero (delegates to skillExecutor) | Same skill spans, plus MCP session context in metadata |
| Sub-agent spawns (Promise.all) | Zero | Parent span wrapping fan-out, child traces linked via sessionId |
| Handoff queue runs | Trace exists but no linking | Same trace structure + sessionId linking to parent |

**Rule:** If two execution paths can produce the same logical operation (e.g., an LLM call), they must produce the same trace structure. Otherwise comparisons break and fingerprints become meaningless.

**Claude Code path specifically:** This is the biggest gap. If a run uses Claude Code mode, it's completely invisible. At minimum:
- Create a trace before CLI spawn
- Capture turn-level events from CLI output
- Finalise trace with outcome
- Use the same metadata schema as API loop traces

### 12.2 Alerting Hooks (Future-Ready)

We don't need full monitoring now, but build the emission points so we can add alerting later without re-instrumenting.

**Define metric emission points in the tracing helpers:**

```typescript
// Conceptual — not implementation spec
emitMetric("agent.run.completed", { agentId, durationMs, costCents, status })
emitMetric("agent.run.failed", { agentId, errorType, iterationCount })
emitMetric("llm.fallback.triggered", { fromProvider, toProvider, reason })
emitMetric("llm.escalation.triggered", { fromModel, toModel, reason })
emitMetric("skill.review.timeout", { skillName, agentId, waitDurationMs })
emitMetric("budget.threshold.warning", { orgId, headroomPercent })
```

**Day one implementation:** These are no-ops (or simple `console.log` behind a feature flag). The point is that the emission points exist in the code, at the right locations, with the right data.

**Future integration:** Swap the no-op for StatsD, Prometheus, or Langfuse Metrics API. Connect to Slack/PagerDuty for:
- Error rate spikes (> X% of runs failing in last hour)
- Cost anomalies (run cost > 3x median for that fingerprint)
- HITL bottlenecks (review wait > 10 minutes)
- Provider degradation (fallback rate > 20%)

---

## Future: Intelligence Layer

### 13.1 From Observability to Optimisation

The trace data we're collecting isn't just for debugging. Once mature, it becomes the foundation for an agent intelligence layer.

**What we'll have after Phase 4:**
- Structured decision data (every routing choice, gate decision, middleware action)
- Cost + latency + outcome data per run, per iteration, per skill
- Behaviour traces (what agents do, in what order, with what results)
- Run fingerprints for clustering similar runs

**What this enables (not now — after 2-4 weeks of production data):**

| Capability | How | Value |
|-----------|-----|-------|
| **Auto-tune model routing** | Analyse cost vs outcome by tier. If economy succeeds 95% of the time for skill X, stop escalating. | Direct cost reduction |
| **Policy refinement** | Analyse gate decisions vs outcomes. If auto-gated actions for skill Y fail 30% of the time, suggest review-gating. | Improved reliability |
| **Anomaly detection** | Flag runs that deviate from fingerprint baselines (cost, iterations, duration). | Early warning system |
| **Agent performance ranking** | Score agents by success rate, cost efficiency, iteration count, HITL approval rate. | Data-driven agent improvement |
| **Automated debugging suggestions** | When a run fails, find the most similar successful run and diff the trace trees. | Faster root cause analysis |

**This is not in scope for this brief.** But every design decision here (fingerprints, decision events, structured metadata, trace versioning) is intentionally laying the groundwork. We're building observability that becomes intelligence — not a logging system that stays a logging system.
