# Improvements Roadmap — Detailed Implementation Specification

Companion to `docs/improvements-roadmap.md`. The roadmap defines *what* and *when*. This document defines *how* — file paths, schema changes, code locations, test approach, and an explicit "implement now vs defer" verdict for every item.

**Source documents:**
- `docs/improvements-roadmap.md` — phased plan
- `docs/agentic-pattern-improvements.md` — Gulli-book lens (per-pattern reasoning)
- `docs/external-improvements.md` — competitive lens (per-platform attribution)

This spec was written after merging `main` (commits up to `3e0f4ac`). Line numbers and file references are valid against that snapshot.

**Deployment context:** The platform is **pre-production** — running in a single development environment, no live users, no production pressure. The "significant testing" phase has not yet started. This document is the pre-testing restructuring plan; major changes that would be scary against live users are the right shape of change to land **now**, before testing begins, so the test suite is built against the intended architecture rather than the legacy one.

This context changes every verdict in the document. Risk aversion, staged rollouts, and feature flags are production-environment practices — in a dev environment they are cost without benefit. The spec previously flagged items as "READY — AWAITING GO-AHEAD" or "BLOCKED ON DEPENDENCY" because of production-style caution. That framing has been retired. Items are now sequenced by **dependency order alone**, not by risk tolerance.

---

## Implementation philosophy

Five rules that shape how work is sequenced in this document.

1. **Pre-testing is the right time for restructuring.** The testing phase hasn't started. Landing the major changes now means the test suite is built against the intended architecture from day one, rather than being retrofitted later. Every item in this spec that was previously "ready but awaiting authorisation because it touches the hot path" is now "build it, because the hot path is what needs the change".

2. **Dependency order is the only sequencing constraint.** Items are scheduled in the order their dependencies allow, not by arbitrary risk tiers. If P1.1 must land before P2.1 (because P2.1 checkpoints into tables that P1.1 hardens), they go in that order. Otherwise they run in parallel or whatever order is convenient.

3. **Test-first on the extracted seams.** P0.1 Layer 3 (extracting pure helpers out of `agentExecutionService.ts`) is the first item because every later item adds behaviour to that file, and behaviour without tests is a regression waiting to happen. The seam extraction is non-negotiable and happens before any runtime behaviour changes land.

4. **No new patterns when an existing one fits.** If the codebase already has a primitive (`policyEngineService`, `actionService.proposeAction`, `withBackoff`, `playbookEngineService`), the spec extends it rather than introducing a parallel mechanism. Most overlap in the source docs collapses when this rule is applied.

5. **Migrations ship without feature flags.** In a pre-production environment, a feature flag for a new column is dead weight. Ship the migration, ship the code that uses it, move on. Feature flags are reserved for items where the old and new behaviours genuinely need to coexist long enough to A/B (P4.4 shadow-mode critique gate is the only such item).

---

## Execution model — at-least-once, idempotent handlers

Every item in this spec that touches agent runs, pg-boss jobs, tool dispatch, or HITL resume operates under a single explicit execution model. This section establishes the contract once so every downstream item can reference it instead of restating it.

### The guarantee

**At-least-once execution, not exactly-once.** Any action in the system — a tool call, a pg-boss job handler, a middleware side effect, a resume after checkpoint — may be executed **more than once** as a consequence of crashes, retries, duplicate job delivery, resume paths, or middleware loops. The system does not and cannot guarantee exactly-once execution under failure, because exactly-once is not achievable across a Postgres + pg-boss boundary without two-phase commit (which we do not use).

**Every side-effecting handler must be idempotent.** The burden of correctness under retry is placed on the handler, not on the orchestrator. An action handler that cannot safely run twice with the same inputs is a bug.

### What this means in practice for each moving part

**Tool call handlers (`skillExecutor.ts` dispatch targets):**

- Must accept an `idempotencyKey` in their execution context. The key is derived deterministically from `(runId, toolCallId, args_hash)` per the P1.1 Layer 3 contract.
- Must be safe to invoke twice with the same key. Options:
  - **Naturally idempotent** (read-only, GET requests, queries): nothing to do.
  - **Idempotent by key** (most write paths): the handler checks for an existing record keyed on `idempotencyKey` before creating a new one. Examples: `send_email` checks the email provider's Idempotency-Key header support; `create_task` writes with an `ON CONFLICT` on `(runId, toolCallId)`; `trigger_process` dedupes on the same key.
  - **Irreversible and non-idempotent** (webhooks to third parties with no dedupe story): the handler MUST take a lock keyed on `idempotencyKey` via `pg_try_advisory_xact_lock(hashtext('tool:' || key)::bigint)` before the call. Second invocation with the same key sees the lock, waits for the first to finish, reads the result, returns it without re-calling. The existing `playbookEngineService` advisory-lock pattern is the reference implementation.
- The `ActionDefinition.idempotencyStrategy` field (added to the P0.2 Slice B field list) declares which of the three categories the handler belongs to: `'read_only' | 'keyed_write' | 'locked'`. The skill executor refuses to dispatch an action whose handler doesn't declare a strategy.

**pg-boss job handlers** (`agent-run-resume`, `regression-capture`, `bulk-dispatch-child`, `critique-gate-shadow`, `agent-run-cleanup`, etc.):

- Already covered by the per-job `singletonKey` contract in the "Job idempotency keys" table. That contract IS this execution model, restated for the job layer.
- pg-boss will deduplicate in-flight jobs by `singletonKey`, but two jobs can still execute sequentially on retry (first job succeeds, second is queued before the first's completion record arrives). Handlers must be idempotent against this pattern too.
- Jobs that dispatch to tool handlers inherit the handler's idempotency strategy via the `idempotencyKey` in the job payload.

**Middleware side effects** (`preCall`, `preTool`, `postCall`, `postTool` phases in `agentExecutionService.ts`):

- Middleware must be pure with respect to external state except for the explicit side effects it is defined to own (writing `tool_call_security_events`, writing `llmRequests`, writing audit rows).
- Every side-effecting middleware write must be idempotent on `(runId, iteration)` or `(runId, toolCallId)` as appropriate.
- The P1.1 Layer 3 middleware uses `INSERT ... ON CONFLICT DO NOTHING` with a unique index on `(agent_run_id, tool_call_id)` — this is the reference pattern for middleware writes.

**Checkpoint boundary semantics:**

This was ambiguous in earlier drafts and has been resolved explicitly.

**Terminology, stated once:**

- **"Loop iteration"** (the outer level) = one full pass of the agentic loop: an LLM call returns with zero or more tool calls in its response; all those tool calls are then executed sequentially; then the loop advances to the next LLM call. This is the `iteration` counter in `runAgenticLoop()` at `agentExecutionService.ts:1291`.
- **"Tool call"** (the inner level) = a single tool invocation within an iteration. An iteration may contain multiple tool calls if the LLM's response emits several at once.

**The authoritative rule: the checkpoint is written after every completed tool call, not once per iteration.**

This is finer-grained than "per iteration" and it is the correct choice because an LLM response that emits 5 tool calls in a single iteration would otherwise replay all 5 on resume, relying entirely on handler idempotency to prevent duplicate side effects. Per-tool-call checkpointing tightens the replay window to a single tool call — idempotency still matters (the race between tool completion and checkpoint persistence is real), but the blast radius of the race is strictly smaller.

**Concrete sequence within an iteration:**

```
LLM call emits tool calls [A, B, C]
Execute A
  ↳ checkpoint: { iteration: N, lastCompletedToolCallId: A.id, messageCursor: ... }
Execute B
  ↳ checkpoint: { iteration: N, lastCompletedToolCallId: B.id, messageCursor: ... }
Execute C
  ↳ checkpoint: { iteration: N, lastCompletedToolCallId: C.id, messageCursor: ... }
Advance to iteration N+1
  ↳ next LLM call
```

**Resume behaviour:**

- Crash **between** tool A completing and its checkpoint write → resume replays A. A is idempotent, so no duplicate side effect. Then executes B and C normally.
- Crash **after** tool A's checkpoint write, **before** tool B starts → resume skips A (already done per checkpoint), starts at B. No replay.
- Crash **mid-tool-call B** (B's handler is partway through its work) → resume replays B. B is idempotent, so no duplicate side effect. Then executes C.
- Crash **after tool C completes** and its checkpoint is persisted, before the next LLM call → resume skips A, B, C, starts the next iteration's LLM call.

**The race window between tool completion and checkpoint persistence is narrow (milliseconds) but real.** It is handled by the handler's idempotency, not by tightening the window. Shrinking per-iteration checkpointing to per-tool-call does not eliminate the race — it only narrows the replay scope when the race fires.

**Why not write the checkpoint transactionally with the tool's side effect?** Because many side effects are to systems outside Postgres (third-party APIs, webhooks, email providers, GHL) and cannot participate in a Postgres transaction. The fundamental constraint is distributed commit, not Drizzle's transaction API.

### Required of every new action handler added by this roadmap

Before an action lands in `ACTION_REGISTRY`, it must:

1. Declare `idempotencyStrategy: 'read_only' | 'keyed_write' | 'locked'` on its `ActionDefinition`.
2. Accept `idempotencyKey: string` in its execution context (passed down from the skill executor).
3. Be safe to invoke twice with the same key, via the mechanism declared in its strategy.
4. Have a unit test that calls the handler twice with the same key and asserts the second call produces the same result as the first with **exactly one** side effect observable externally.

### New static gate

A new gate script `verify-idempotency-strategy-declared.sh` fails CI if any entry in `ACTION_REGISTRY` has no `idempotencyStrategy` field. Ships in Sprint 1 alongside P0.2 Slice B.

### Why this is stated as a separate section, not a per-item note

Because three items (P1.1 Layer 3, P2.1, P3.1 bulk dispatch) each have their own idempotency rules that would otherwise look independent. They are not independent — they are three instantiations of the same execution model, applied to different layers. Stating the model once and referencing it from each item makes the overall contract visible and makes it harder for a future item to accidentally violate it.

### What this explicitly does NOT provide

- **Exactly-once delivery to third parties.** If a downstream integration (Slack, GHL, email provider) does not support idempotency keys and we can't use advisory locks for its class of call, we accept that a retry may produce a duplicate and document it on the specific action in the registry. There is no platform-level solution.
- **Distributed transactions.** Tool execution and checkpoint persistence are not transactional. See "Checkpoint boundary semantics" above — the race is handled by handler idempotency.
- **Compensation / saga patterns.** If step N of a multi-step workflow succeeds and step N+1 fails permanently, the platform does not automatically roll back step N. Compensation is the responsibility of the agent's prompt logic and the Playbook engine, not of individual action handlers.

---

## Verdict legend

Every item now uses one of three verdicts:

| Verdict | Meaning |
|---|---|
| **BUILD IN SPRINT N** | The item ships in the named sprint (see the sprint-by-sprint build order at the bottom of this document). Dependencies have been validated. |
| **BUILD WHEN DEPENDENCY SHIPS** | The item is constrained by a dependency inside an earlier sprint. It ships in the sprint immediately after its dependency lands. |
| **DEFER — AWAITING SIGNAL** | The item should not be built until a named real-world signal (user feedback, telemetry, integration arriving) materialises. Applies only to the Phase 5 items — these defer on signal, not on authorisation. |

The "READY — AWAITING GO-AHEAD" and "IMPLEMENT NOW (limited slice)" verdicts from the previous version are retired. Everything except the Phase 5 deferrals is now scheduled.

---

## Table of contents

| # | Item | Phase | Verdict | Sprint |
|---|---|---|---|---|
| P0.1 | Test harness | 0 | BUILD IN SPRINT 1 | 1 |
| P0.2 | Typed action registry | 0 | BUILD IN SPRINT 1 | 1 |
| P1.1 | Three-layer fail-closed isolation | 1 | BUILD IN SPRINT 2 | 2 |
| P1.2 | HITL → regression capture | 1 | BUILD WHEN DEPENDENCY SHIPS | 2 |
| P2.1 | Agent run checkpoint + resume | 2 | BUILD WHEN DEPENDENCY SHIPS | 3 |
| P2.2 | Deterministic reflection loop | 2 | BUILD IN SPRINT 3 | 3 |
| P2.3 | Confidence + decision-time guidance | 2 | BUILD IN SPRINT 3 | 3 |
| P3.1 | Playbook runMode toggle | 3 | BUILD IN SPRINT 4 | 4 |
| P3.2 | Portfolio Health bulk playbook | 3 | BUILD WHEN DEPENDENCY SHIPS | 4 |
| P3.3 | Structural trajectory comparison | 3 | BUILD WHEN DEPENDENCY SHIPS | 4 |
| P4.1 | Topics → Actions filter | 4 | BUILD WHEN DEPENDENCY SHIPS | 5 |
| P4.2 | Shared memory blocks | 4 | BUILD IN SPRINT 5 | 5 |
| P4.3 | Plan-then-execute | 4 | BUILD WHEN DEPENDENCY SHIPS | 5 |
| P4.4 | Critique gate (shadow mode) | 4 | BUILD WHEN DEPENDENCY SHIPS | 5 |
| P5.x | All Phase 5 items | 5 | DEFER — AWAITING SIGNAL | — |

The full sprint-by-sprint build order with ordering, parallelisation opportunities, and rollback notes is at the bottom of this document. Individual item sections below contain the detailed spec (files, schemas, tests, risks).

---

## P0.1 — Test harness

### Goal

Make it possible to test agent behaviour deterministically without burning real LLM tokens, then run those tests in CI on every commit.

### Current state

The codebase already has a test infrastructure — it just isn't a runtime test framework. There are three layers:

1. **19+ static gate scripts** in `scripts/run-all-gates.sh` that grep the codebase for compliance patterns (`verify-async-handler.sh`, `verify-org-scoped-writes.sh`, `verify-no-db-in-routes.sh`, etc.). These are essentially custom lints. They run on `npm run test:gates`.
2. **QA scripts** in `scripts/run-all-qa-tests.sh` — bash assertions over the codebase. Run on `npm run test:qa`.
3. **Two unit-style test files** using `tsx` directly:
   - `server/lib/playbook/__tests__/playbook.test.ts` (run via `npm run playbooks:test`)
   - `server/services/__tests__/runContextLoader.test.ts` (run via `tsx <path>` directly — not yet wired into npm)

The convention from `runContextLoader.test.ts` is significant: pure logic is extracted into a sibling `*Pure.ts` file (e.g. `runContextLoaderPure.ts`) so the test can import without pulling in the database or `env`. The comment in the file says:

> The repo doesn't have Jest / Vitest configured, so we follow the same lightweight pattern as `server/lib/playbook/__tests__/playbook.test.ts`.

So the team has explicitly chosen *not* to introduce a test framework. P0.1 must respect that.

### Design

P0.1 has three layers, in priority order.

#### Layer 1 — Formalise the existing tsx convention (small)

- New `npm run test:unit` script that runs every `**/__tests__/*.test.ts` file via `tsx`.
- New `scripts/run-all-unit-tests.sh` that finds these files and runs them sequentially, returning non-zero on any failure.
- Add `test:unit` to `npm test` so all three layers (gates, QA, unit) run on `npm test`.
- Add a one-page convention doc at `docs/testing-conventions.md` that codifies the "extract a `*Pure.ts` companion → write a `*.test.ts` next to it" pattern. The doc references the two existing examples as canonical templates.
- **No new dependencies. No vitest. No Jest.**

#### Layer 2 — LLM stub (medium)

- New file `server/lib/__tests__/llmStub.ts`. Exports a `createLLMStub(scenarios)` function that returns a mock implementation matching the `routeCall()` signature in `server/services/llmRouter.ts`.
- Scenarios are an array of `{ matchOnSystem?: RegExp, matchOnLastUser?: RegExp, response: ProviderResponse }`. The stub picks the first match and increments its call count. Unmatched calls throw with the messages array attached for debugging.
- Tests inject the stub by passing it as an argument to whatever production code receives the router (this is the dependency-inversion price tag — see Layer 3).
- The stub is **not** a global monkey-patch. It is passed in explicitly. This forces production code to take the router as a parameter, which is the right shape anyway.

#### Layer 3 — Extract testable seams from `agentExecutionService.ts`

This is the biggest piece of work in P0.1. `agentExecutionService.ts` is 1,900+ lines and `runAgenticLoop` (line 1228) does too much to be testable as-is. Three pure functions need to be extracted into a sibling `agentExecutionServicePure.ts`:

- `selectExecutionPhase(iteration, previousResponseHadToolCalls, totalToolCalls)` — already a pure switch at lines 1196-1208 of the current file. Extract verbatim.
- `validateToolCalls(toolCalls, activeTools)` — already pure at line 1191. Extract verbatim.
- `buildMiddlewareContext(...)` — pure constructor for `MiddlewareContext`. Currently inlined at lines 1115-1138.

After extraction, write three test files in `server/services/__tests__/`:
- `agentExecutionService.phase.test.ts`
- `agentExecutionService.validateToolCalls.test.ts`
- `agentExecutionService.middlewareContext.test.ts`

Each follows the `runContextLoader.test.ts` convention exactly.

**Explicit non-goal:** end-to-end testing of `runAgenticLoop` itself. That would require a full `routeCall` injection refactor and is much more invasive. Punt to Phase 3 (P3.3 trajectory comparison) which has the same need and can amortise the cost.

### Files to change

| File | Change |
|---|---|
| `package.json` | Add `test:unit` script. Update `test` to call all three layers. |
| `scripts/run-all-unit-tests.sh` | New. Discovers and runs `**/__tests__/*.test.ts` via `tsx`. |
| `docs/testing-conventions.md` | New. One-page convention doc. |
| `server/lib/__tests__/llmStub.ts` | New. LLM stub utility. |
| `server/services/agentExecutionServicePure.ts` | New. Three pure functions extracted from `agentExecutionService.ts`. |
| `server/services/__tests__/agentExecutionService.phase.test.ts` | New. |
| `server/services/__tests__/agentExecutionService.validateToolCalls.test.ts` | New. |
| `server/services/__tests__/agentExecutionService.middlewareContext.test.ts` | New. |
| `server/services/agentExecutionService.ts` | Replace inlined helpers with imports from `agentExecutionServicePure.ts`. |

### Test plan

The new tests test themselves. After landing:

1. `npm run test:unit` discovers and runs all four test files (existing two + three new).
2. `npm test` runs gates + qa + unit and exits non-zero if any layer fails.
3. CI (or whatever runs `npm test` on push) catches regressions on any of the extracted pure functions.

### Risk

Low. The biggest risk is the seam extraction — moving code from `agentExecutionService.ts` into a sibling file could introduce import cycles. Mitigation: the extracted functions are leaf-level pure functions with no DB or service dependencies, so there is nothing to cycle through.

### Verdict

**BUILD IN SPRINT 1.**

All three layers land in Sprint 1. Layer 3 (the seam extraction in `agentExecutionService.ts`) is exactly the kind of restructuring that should happen pre-testing — doing it later means retrofitting tests against a file that was never designed to be tested. The extraction is mechanically safe, the three functions are leaf-level pure logic with no dependencies to cycle through, and the before/after diff is small enough to review in one sitting.

**Order within Sprint 1:**

1. Layer 1 first (npm script + bash runner + convention doc) — unblocks the workflow.
2. Layer 3 second (extract `selectExecutionPhase`, `validateToolCalls`, `buildMiddlewareContext` into `agentExecutionServicePure.ts`, replace inline versions with imports). Ship with the three new test files that assert the pure functions behave correctly.
3. Layer 2 last (`llmStub.ts`) — only valuable once there is production code that can consume an injected router. The stub itself is cheap but the injection sites appear as later sprints land.

No feature flag. No phased rollout. The extracted functions are byte-equivalent to the originals.

---

## P0.2 — Typed action registry refactor

### Goal

Give every consumer of `ActionDefinition` (the policy engine, the skill executor, the future critique gate, the future topics filter, the future scope validator) a single typed source of truth that is Zod-validated and extensible.

### Current state

`server/config/actionRegistry.ts` (lines 6-47) defines four types:

- `RetryPolicy` — `{ maxRetries, strategy: 'exponential_backoff' | 'fixed' | 'none', retryOn: string[], doNotRetryOn: string[] }`. Already richer than the roadmap suggested — `retryOn`/`doNotRetryOn` lists exist but aren't wired into the executor's failure path.
- `McpAnnotations` — MCP spec passthrough.
- `ParameterSchema` — a custom hand-rolled JSON-Schema-shaped type. Lines 22-33. **Not Zod**, despite the codebase using Zod for validation everywhere else.
- `ActionDefinition` — the registry entry shape. 29 entries currently in `ACTION_REGISTRY` (one per action type).

The `payloadFields: string[]` field is marked `@deprecated` but still populated by every entry — this is the legacy of an older version that listed allowed payload keys without describing them.

The downstream consumer is `policyEngineService.evaluatePolicy()` (`server/services/policyEngineService.ts:121`) which falls back to `definition?.defaultGateLevel ?? 'review'` when no policy rule matches. The action definition is otherwise inert at runtime — its parameter schema is referenced for the LLM tool definition but not used for input validation.

### Design

#### Slice A — Convert `ParameterSchema` to Zod (mechanical, low risk)

Replace the custom `ParameterSchema` interface with a `z.ZodType` field on `ActionDefinition`:

```ts
// Before (lines 22-33, 44):
parameterSchema: ParameterSchema;

// After:
parameterSchema: z.ZodObject<any>;
```

Then convert each of the 29 `ACTION_REGISTRY` entries from object literals to Zod schemas:

```ts
// Before:
parameterSchema: {
  type: 'object',
  properties: {
    to: { type: 'string', description: 'Recipient email address' },
    subject: { type: 'string', description: 'Email subject line' },
    body: { type: 'string' },
  },
  required: ['to', 'subject', 'body'],
}

// After:
parameterSchema: z.object({
  to: z.string().describe('Recipient email address'),
  subject: z.string().describe('Email subject line'),
  body: z.string(),
}),
```

The LLM tool builder (which today serialises `parameterSchema` to JSON Schema for Anthropic) needs a small adapter — Zod has `zod-to-json-schema` (already in `node_modules` because `drizzle-zod` depends on it) which produces the exact shape Anthropic expects.

#### Slice B — Add new fields (additive, no migration)

Extend `ActionDefinition` with five new optional fields. All consumers of these fields are downstream phases — adding them now is just plumbing.

```ts
export interface ActionDefinition {
  // ... existing fields ...

  /** P1.1 Layer 3 — scope validation requirements. */
  scopeRequirements?: {
    /** Names of arg fields that must be subaccount IDs the current tenant owns. */
    validateSubaccountFields?: string[];
    /** Names of arg fields that must be GHL location IDs the current tenant owns. */
    validateGhlLocationFields?: string[];
    /** If true, run requires `userId` in execution context (no system runs). */
    requiresUserContext?: boolean;
  };

  /** P4.1 — topic tags for intent-based filtering. */
  topics?: string[];

  /** P4.4 — opt-in to the semantic critique gate when run via economy tier. */
  requiresCritiqueGate?: boolean;

  /** P0.2 Slice C — extended retry behaviour. See below. */
  onFailure?: 'retry' | 'skip' | 'fail_run' | 'fallback';
  fallbackValue?: unknown;

  /**
   * Execution-model contract (see "Execution model — at-least-once, idempotent handlers"
   * at the top of this document). Declares how the handler stays safe under retry.
   * Required on every entry — `verify-idempotency-strategy-declared.sh` fails CI if missing.
   * - 'read_only'  — no side effects; safe to re-run without coordination.
   * - 'keyed_write' — writes are deduped by idempotencyKey at the DB / provider layer.
   * - 'locked'     — handler takes a pg advisory lock keyed on idempotencyKey before the call.
   */
  idempotencyStrategy: 'read_only' | 'keyed_write' | 'locked';

  /**
   * P1.1 Layer 3 — flag to mark methodology skills (pure prompt scaffolds, no side effects).
   * When true, the preTool middleware bypasses actionService.proposeAction and writes a single
   * audit row with reason='methodology_skill'. See P1.1 Layer 3 idempotency contract.
   */
  isMethodology?: boolean;

  /**
   * P4.1 — universal skills are always merged into every agent's effective allowlist and
   * always preserved through the topic filter. See P4.1 universal-skill contract.
   */
  isUniversal?: boolean;

  /**
   * P1.1 Layer 3 — declarative scope metadata consumed by the before-tool authorisation hook.
   * See P1.1 Layer 3 validateScope() for the check implementation.
   */
  scopeRequirements?: {
    validateSubaccountFields?: string[];
    validateGhlLocationFields?: string[];
    requiresUserContext?: boolean;
  };
}
```

#### Slice C — Extended retry directives (small but touches the executor)

Today's `RetryPolicy` says *what to retry on* but the executor only knows *retry or fail*. Slice C adds three more options:

- **`retry`** (default) — current behaviour. Use `withBackoff` to retry per `RetryPolicy`.
- **`skip`** — failure is logged but the agent loop continues without the result. The tool result returned to the LLM is `{ success: false, skipped: true, reason }`.
- **`fail_run`** — failure terminates the entire agent run. Equivalent to `throw failure(...)` from `shared/iee/failure.ts`.
- **`fallback`** — return `fallbackValue` as the result instead of failing. Used for read-only tools where a stale or empty value is preferable to a hard fail.

Wiring point: in `skillExecutor.ts`, after a skill throws or returns `{ success: false, ... }`, dispatch on `actionDef.onFailure` before propagating the error. This is ~30 lines of code in one place.

### Files to change

| File | Change |
|---|---|
| `server/config/actionRegistry.ts` | Replace `ParameterSchema` with Zod. Add new optional fields. Convert all 29 entries. |
| `server/services/skillExecutor.ts` | Add `onFailure` dispatch in the skill execution path. Remove uses of the deprecated `payloadFields`. |
| `server/services/llmService.ts` (or wherever tool definitions are built) | Use `zod-to-json-schema` to serialise `parameterSchema` for Anthropic. |
| `server/services/__tests__/actionRegistry.test.ts` | New. Asserts every registry entry parses, has required Zod schema, and (when present) has valid `scopeRequirements`. |
| `scripts/gates/verify-action-registry-shape.sh` | New. Static gate that fails if any entry uses the legacy `ParameterSchema` shape. |

### Test plan

- The new `actionRegistry.test.ts` walks every entry in `ACTION_REGISTRY` and validates: schema is a `z.ZodObject`, `defaultGateLevel` is one of `auto/review/block`, `actionCategory` is in the closed set.
- For every entry that has `scopeRequirements`, assert the named field exists in the `parameterSchema`.
- The new gate script greps for the legacy `parameterSchema: {` shape and fails if found.
- Existing static gates (`verify-async-handler.sh`, etc.) continue to pass — this refactor is internal to the action registry.

### Risk

Medium. The Zod conversion is mechanical but touches 29 entries. The risk is in the LLM tool serialisation — if `zod-to-json-schema` produces a shape Anthropic doesn't accept, every agent in the system breaks. Mitigation: write a one-off `scripts/dump-tool-schemas.ts` that prints the JSON Schema for every entry before and after conversion, diff them, and only ship if every entry produces an Anthropic-compatible shape.

### Verdict

**BUILD IN SPRINT 1.**

All three slices land in Sprint 1 alongside P0.1. The order:

1. **Slice B first** (additive optional fields on `ActionDefinition`) — zero-risk, unlocks P4.1 topics filter and P4.4 critique gate downstream.
2. **Slice A second** (Zod conversion of all 29 entries) — mechanical refactor. The risk is in LLM tool serialisation, mitigated by the pre-flight script `scripts/dump-tool-schemas.ts` that diffs the before/after JSON Schema for every entry. Ship only if every entry produces an Anthropic-compatible shape.
3. **Slice C third** (error directives: `onFailure: 'retry' | 'skip' | 'fail_run' | 'fallback'`) — wiring in `skillExecutor.ts`, tested against the P0.1 harness from earlier in the sprint.

Unit tests (`server/services/__tests__/actionRegistry.test.ts`) ship with Slice A and catch any regressions in the conversion. The `verify-action-registry-shape.sh` gate script ships with Slice B.

No feature flag. Pre-production means the conversion doesn't need to coexist with the legacy `ParameterSchema` shape — delete it.

---

## P1.1 — Three-layer fail-closed data isolation

### Goal

Make the multi-tenant boundary structurally enforced at three independent layers, so a single missed `where` clause cannot leak data between organisations or subaccounts. Today the boundary is enforced once, in application code, and a single bug is a P0.

### Current state

- **Application-layer scoping is consistent.** Routes use `req.orgId` (not `req.user.organisationId`) and `resolveSubaccount(subaccountId, orgId)` validates ownership before any subaccount-scoped logic. Services filter on `organisationId` and (where applicable) `subaccountId`. This is correct but it is the *only* layer.
- **No Postgres RLS.** A grep across `migrations/*.sql` for `ROW LEVEL SECURITY` returns nothing. The single hit (`migrations/meta/0000_snapshot.json`) is a metadata artefact, not a real RLS policy.
- **No context-assembly verification.** When `runContextLoader.ts` (or workspace memory, or document retrieval) loads data into the LLM context window, there is no guard that asserts every loaded item belongs to the current run's tenant. The query is *expected* to filter correctly but nothing checks at the boundary.
- **No universal before-tool hook.** `actionService.proposeAction()` is the closest thing — it runs the policy engine for gated skills — but methodology skills (`review_code`, `draft_architecture_plan`, `draft_tech_spec`, `review_ux`, `write_tests`) bypass it because they are pure prompt scaffolds. As soon as one of those grows a side effect, the chokepoint has a hole.

### Design — three layers, all required

Each layer is independently capable of catching a leak. A leak only escapes if all three fail.

#### Layer 1 — Postgres Row-Level Security on highest-blast-radius tables

**Tables to enable RLS on (in priority order):**

1. `tasks`
2. `actions`
3. `agentRuns`
4. `agentRunSnapshots`
5. `reviewItems`
6. `reviewAuditRecords`
7. `workspaceMemories`
8. `llmRequests`
9. `taskActivities`, `taskDeliverables`
10. `auditEvents`

**Policy shape (per table):**

```sql
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY tasks_org_isolation ON tasks
  USING (organisation_id = current_setting('app.organisation_id', true)::uuid)
  WITH CHECK (organisation_id = current_setting('app.organisation_id', true)::uuid);

-- Bypass for migrations and admin tooling:
CREATE POLICY tasks_admin_bypass ON tasks
  TO admin_role
  USING (true)
  WITH CHECK (true);
```

**How `app.organisation_id` is set — execution contract:**

This section is now an explicit contract. Every access path must conform; anything that doesn't is a bug and gets blocked by the `verify-rls-contract-compliance.sh` gate.

The propagation mechanism is:

```sql
SELECT set_config('app.organisation_id', $1, true)
```

The `true` (is_local) flag scopes the setting to the current transaction, which avoids leakage between concurrent connections in a pool.

**Contract — three access paths, all must conform:**

**Path 1: HTTP requests.** A new middleware `server/middleware/orgScoping.ts` runs after `authenticate` and before any service calls. It opens an explicit Drizzle transaction for the rest of the request lifecycle, issues the `set_config` inside the transaction, and passes the transaction context down to services via AsyncLocalStorage (`server/instrumentation.ts` already owns the ALS — extend it with a `currentTx` slot). Every service-layer DB access reads the current transaction from ALS; if none is present, the access throws `failure('missing_org_context', ...)` immediately. There is no fall-through to a connection-pool acquisition. No request-scoped DB access happens outside the ALS-bound transaction.

**Path 2: Background jobs (pg-boss workers).** Every handler registered via `createWorker({ queue, handler })` in `server/lib/createWorker.ts` is wrapped by `createWorker` itself with an identical tx-opening prelude. The job payload must carry `organisationId` explicitly (enforced via Zod at the `boss.send(...)` call site, per `docs/pgboss-zod-hardening-spec.md`). The wrapper reads `organisationId` from the validated payload, opens the transaction, issues `set_config`, binds it into ALS, and then invokes the job handler. This means **every new pg-boss handler added by this roadmap (`agent-run-resume`, `regression-capture`, `bulk-dispatch`, `critique-gate-shadow`) automatically inherits the RLS contract** — no per-handler wiring needed.

**Path 3: System jobs (cron, migrations, admin tooling).** These do not have a natural `organisationId` and must use an explicit admin-bypass connection. A new `server/lib/adminDbConnection.ts` exports `withAdminConnection(fn)` which acquires a connection bound to a Postgres role that has `BYPASSRLS` (the role is `admin_role` referenced in the RLS policy examples). All migrations and cron jobs that legitimately need cross-org access must use this helper. The helper logs every invocation to `audit_events` with the caller's stack trace so admin-bypass usage is traceable.

**Hard-failure mode: RLS-protected query with no org context.**

This is where the previous draft was ambiguous. There are actually **two distinct failure modes at two distinct layers**, and they catch different classes of bug. Both exist; they do not conflict; they are not alternatives.

**Layer A — ALS guard in services (loud failure, first line of defence).**

Every service-layer DB access checks AsyncLocalStorage for an active tx context before touching the database. If ALS has no current tx, the service throws `failure('missing_org_context', ...)` immediately and the request fails with a 500 + structured failure reason. This is the **primary** defence and the one that should catch almost every bug — a service that forgot to open a transaction, a test that called a service without the wrapper, a worker handler that dispatched to a service synchronously without first binding ALS.

Characteristic: loud, deterministic, actionable stack trace.

**Layer B — RLS policy default on protected tables (silent fail-closed, backup defence-in-depth).**

RLS policies include a defensive clause that fail-closes when `app.organisation_id` is unset:

```sql
CREATE POLICY tasks_org_isolation ON tasks
  USING (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  )
  WITH CHECK (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  );
```

This layer catches a different class of bug: **raw SQL executed outside the service layer**, admin tooling that bypasses the ALS wrapper, a future contributor who writes `db.select(...)` directly in a route or a script. Any of these reach Postgres without Layer A having fired. Layer B's behaviour: queries return zero rows, writes silently fail (no rows inserted), and the calling code gets an unexpected empty result.

Characteristic: silent, deterministic, harder to debug from the code side — but impossible to defeat without explicitly using the admin-bypass connection.

**Why both layers exist:**

- Layer A alone is insufficient because a single missed `db.select()` outside a service bypasses the guard entirely. Layer B catches it.
- Layer B alone is insufficient because silent zero-row bugs are nightmarishly hard to track down. Layer A fires first and makes 99% of bugs visible with a clear stack trace.
- Together they cover the full matrix: every service call gets caught loudly by A; every non-service call gets caught silently but unavoidably by B.

**What the integration test asserts about each layer:**

The `rls.context-propagation.test.ts` integration test (see Testing strategy) exercises both layers explicitly:

- **Layer A assertion:** call a service with no ALS tx bound, assert `failure('missing_org_context')` is thrown synchronously.
- **Layer B assertion:** bypass the service layer entirely, execute a raw `db.select().from(tasks)` inside a `withAdminConnection()` wrapper that has deliberately NOT set `app.organisation_id`, assert zero rows are returned even though `tasks` contains rows.
- **Combined assertion:** open a legit ALS tx for `fixture-org-001`, execute a service call, assert only `fixture-org-001` rows come back (both layers agree).

**Non-compliant code is a blocking issue.** The static gate `verify-rls-contract-compliance.sh` greps for raw `db.select(...)` / `db.insert(...)` calls outside services and outside the ALS wrapper, and fails CI if any appear. This is the automated enforcement of Layer A. Layer B is enforced by the migrations themselves — once the policy is in place, the only way to bypass it is the explicit admin-bypass connection.

**Migration sequencing:**

- One migration per table batch (3 tables per migration to keep blast radius small).
- Each migration includes the RLS enable + the policy + an explicit `INSERT INTO migration_audit (...)` row so we know which tables are protected at any given moment.
- Down-migrations exist (`migrations/_down/`) so a problem in production can be unwound table-by-table.

#### Layer 2 — `context.assertScope()` at retrieval boundaries

A new module `server/lib/scopeAssertion.ts`:

```ts
export function assertScope<T extends { organisationId: string; subaccountId?: string | null }>(
  items: T[],
  expected: { organisationId: string; subaccountId?: string | null },
  source: string,
): T[] {
  for (const item of items) {
    if (item.organisationId !== expected.organisationId) {
      throw failure(
        'scope_violation',
        `${source}: organisationId mismatch`,
        { expected: expected.organisationId, actual: item.organisationId, source },
      );
    }
    if (expected.subaccountId !== undefined && item.subaccountId !== expected.subaccountId) {
      throw failure(
        'scope_violation',
        `${source}: subaccountId mismatch`,
        { expected: expected.subaccountId, actual: item.subaccountId, source },
      );
    }
  }
  return items;
}
```

**Call sites (every retrieval point that loads data into the LLM context window):**

- `server/services/runContextLoader.ts` — after fetching `agent_data_sources`, before returning to the agent.
- `server/services/workspaceMemoryService.ts` — after every list query.
- `server/services/taskAttachmentContextService.ts` — after fetching attachments.
- `server/services/agentService.ts::resolveSystemPrompt` — after merging `additionalPrompt` snippets.
- Any service that touches `documents` or `attachments` — exhaustive list to be produced via grep during implementation.

`scope_violation` joins the closed `FailureReason` enum in `shared/iee/failureReason.ts`. It is a non-retryable, terminal failure — the run is killed and an alert is raised.

#### Layer 3 — Universal before-tool authorisation hook

This is the original P1.2 from `agentic-pattern-improvements.md`, folded in as the third layer of Harvey isolation.

**Move `actionService.proposeAction()` from per-skill cases to a middleware in the `preTool` pipeline.**

Today: `skillExecutor.ts` has a big switch (lines ~325-525) where each gated skill case explicitly calls `executeWithActionAudit()` or `proposeReviewGatedAction()`. Methodology skills bypass this entirely.

After: The `preTool` middleware at `agentExecutionService.ts:1437` calls `actionService.proposeAction()` for every tool call before dispatching to the executor. The skill executor's per-case wrapping is removed. The flow becomes:

```
LLM emits tool call
  → preTool middleware
      → compute decision key: (runId, toolCallId)
      → check middleware decision cache for key
          → if cached: return cached decision (no DB write, no duplicate proposeAction)
      → actionService.proposeAction()   -- idempotent by (runId, toolCallId)
          → policyEngineService.evaluatePolicy()
              → if scopeRequirements present:
                    → validateScope(args, scopeRequirements, currentTenant)
                    → on fail: return { decision: 'block', reason: 'scope_violation' }
              → else: return policy decision (auto/review/block)
      → write to middleware decision cache
      → write to tool_call_security_events   -- dedupe by (runId, toolCallId)
      → if blocked: return error to LLM
      → if review: hand off to existing HITL path
      → if auto: dispatch to skill executor
  → executor runs with the same args (no second validation)
```

**Idempotency contract — mandatory:**

The middleware fires once per `(runId, toolCallId)` tuple, period. This matters because:

- Agent run retries re-enter the loop at the last checkpoint (P2.1) and replay the last LLM response, which means the same tool call may reach the middleware twice.
- The pg-boss worker for `agent-run-resume` (also P2.1) may re-deliver a job after a transient failure.
- The reflection loop middleware (P2.2) may inject a `inject_message` action that causes the preceding tool call to be re-emitted by the LLM on the next iteration — same `toolCallId`, same args.

**Three layers of idempotency, all required:**

1. **In-memory decision cache on `MiddlewareContext`.** A new `mwCtx.preToolDecisions: Map<string, PreToolDecision>` keyed by `toolCallId`. First middleware invocation writes to the map; subsequent invocations return the cached decision without calling `proposeAction` again.

2. **`actionService.proposeAction` must be idempotent by `(runId, toolCallId)`.** Today `proposeAction` already takes an `idempotencyKey` parameter — extend it to be derived deterministically from `(runId, toolCallId, args_hash)` instead of the current `${actionType}:${runId}:${Date.now()}` timestamped shape (see `skillExecutor.ts:547`). A retry with the same `toolCallId` + same args returns the existing `action.id` instead of creating a new row. The existing `actions.idempotency_key` unique constraint enforces this at the DB level.

3. **`tool_call_security_events` dedupe on write.** Add a unique index on `(agent_run_id, tool_call_id)` with `WHERE tool_call_id IS NOT NULL`. Writes use `INSERT ... ON CONFLICT DO NOTHING`. Replays don't create duplicate audit rows.

**Methodology skills:**

Pure-prompt methodology skills (`review_code`, `draft_architecture_plan`, `draft_tech_spec`, `review_ux`, `write_tests`, `analyse_42macro_transcript`) have no side effects and no real gating concern — they are prompt scaffolds that return structured text. Before this change they bypass `proposeAction` entirely. After this change they still bypass it, but the bypass is now **explicit policy**, not accidental:

- Each methodology skill is tagged `isMethodology: true` in `ActionDefinition` (new field, added with P0.2 Slice B).
- The `preTool` middleware checks this flag first. If `isMethodology === true`, it writes a single row to `tool_call_security_events` with `decision = 'allow'` and `reason = 'methodology_skill'`, skips `proposeAction`, and dispatches to the executor directly.
- This preserves auditability ("every tool call was evaluated") without creating review items or consuming HITL queue capacity for prompt scaffolds.

`validateScope()` reads `actionDef.scopeRequirements` from P0.2 Slice B and checks:

- Every field in `validateSubaccountFields` exists in args, contains a UUID, and that UUID is in `req.tenantSubaccounts` (a per-request memoised set queried once on the first scope check per request).
- Every field in `validateGhlLocationFields` matches a GHL connection owned by the current tenant.
- If `requiresUserContext` is true, `context.userId` is set.

**Security audit stream:**

A new table `tool_call_security_events`:

```sql
CREATE TABLE tool_call_security_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  subaccount_id uuid REFERENCES subaccounts(id),
  agent_run_id uuid REFERENCES agent_runs(id),
  tool_slug text NOT NULL,
  decision text NOT NULL, -- 'allow' | 'deny'
  reason text, -- populated on deny
  args_hash text NOT NULL, -- sha256 of canonicalised args (no PII)
  scope_check_results jsonb, -- per-field check breakdown
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX tool_call_security_events_org_idx
  ON tool_call_security_events (organisation_id, created_at);

CREATE INDEX tool_call_security_events_run_idx
  ON tool_call_security_events (agent_run_id);
```

This is a separate table from `actionEvents` and `auditEvents` because (a) it has higher write volume (every tool call), (b) it has different retention requirements (compliance log, retain longer), (c) querying it for security audits should not contend with the functional run-state queries.

### Files to change

| File | Change |
|---|---|
| `migrations/0079_rls_tasks_actions_runs.sql` | Enable RLS on `tasks`, `actions`, `agent_runs`. |
| `migrations/0080_rls_review_audit_workspace.sql` | Enable RLS on `review_items`, `review_audit_records`, `workspace_memories`. |
| `migrations/0081_rls_llm_requests_audit.sql` | Enable RLS on `llm_requests`, `audit_events`, `task_activities`, `task_deliverables`. |
| `migrations/0082_tool_call_security_events.sql` | New table per schema above. |
| `migrations/_down/*` | Down-migrations for each. |
| `server/middleware/orgScoping.ts` | New. Sets `app.organisation_id` per request transaction. |
| `server/index.ts` | Mount `orgScoping` middleware after `authenticate`. |
| `server/lib/scopeAssertion.ts` | New. `assertScope()` helper. |
| `shared/iee/failureReason.ts` | Add `scope_violation` to closed enum. |
| `server/services/runContextLoader.ts` | Wrap returned items with `assertScope()`. |
| `server/services/workspaceMemoryService.ts` | Wrap list queries with `assertScope()`. |
| `server/services/taskAttachmentContextService.ts` | Wrap attachment fetches. |
| `server/services/agentExecutionService.ts` | New `preTool` middleware that calls `actionService.proposeAction()` before every tool dispatch. |
| `server/services/skillExecutor.ts` | Remove per-case `executeWithActionAudit` / `proposeReviewGatedAction` wrappers; the middleware does it once. |
| `server/services/actionService.ts` | Add scope validation step inside `proposeAction()`, before policy evaluation. |
| `server/services/policyEngineService.ts` | Optionally accept an `args` argument and surface scope failures via `PolicyDecision.reason`. |
| `server/db/schema/toolCallSecurityEvents.ts` | New Drizzle schema. |
| `scripts/gates/verify-rls-coverage.sh` | New gate. Greps every protected table for an RLS policy in the migrations folder. Fails if a protected table has no policy. |
| `server/services/__tests__/scopeAssertion.test.ts` | New. Tests the assertion helper. |
| `server/services/__tests__/policyEngine.scopeValidation.test.ts` | New. Tests scope validation in the policy engine. |

### Test plan

- Unit tests for `assertScope()` (positive and negative cases).
- Unit tests for `policyEngineService.evaluatePolicy()` with scope requirements.
- A new gate `verify-rls-coverage.sh` that fails CI if any of the 10 protected tables has no RLS policy after migration.
- Manual smoke test: a system_admin scoped into a different org via `X-Organisation-Id` should be able to see that org's tasks (the admin bypass policy works); a regular user should not be able to (RLS blocks).
- Integration test: deliberately call a service with the wrong `req.orgId` and assert the query returns zero rows even when the underlying SQL has no `where` clause on `organisationId` (this is the "missed where clause" case that RLS catches).
- Load test the per-request `set_config` overhead — if it's > 1ms per request, consider a connection-pool-level solution instead.

### Risk

**High in terms of blast radius, low in terms of rollout cost** — this is the largest item in the spec but pre-production removes the usual rollout concerns.

- RLS is global. If a policy is wrong, every query against that table from every code path returns zero rows or fails — no partial degradation.
- The per-request `set_config` change touches every request transaction. Bug here breaks every API endpoint.
- The middleware reorganisation in `agentExecutionService.ts` and `skillExecutor.ts` touches the hottest path in the platform.

**Mitigation strategy (pre-production):**

- The `verify-rls-coverage.sh` and `verify-rls-contract-compliance.sh` gates are the primary safety net. They run in CI on every commit and block merges that break the contract.
- The integration test `rls.context-propagation.test.ts` (I1) exercises both failure layers (Layer A throws, Layer B returns zero rows) against fixture data before any merge lands.
- Each migration has a documented down-migration at `migrations/_down/`. Rollback is "run the down-migration, revert the commit" — no staging, no feature flag, no coordination with live traffic.
- The `orgScoping` middleware lands first as a no-op (sets the config but no RLS policies read it yet). Any bug here surfaces before the first RLS policy exists, which means the RLS policies land against an already-tested scoping layer.
- The three RLS migrations (0079-0081) still land sequentially in one sprint, but the sequencing is about code review clarity, not rollout safety. All three can ship in the same PR if the reviewer prefers.
- The middleware reorganisation (Layer 3) lands without a feature flag. If it breaks, revert the commit and re-land with the fix. No partial-enable state.

### Verdict

**BUILD IN SPRINT 2.**

Pre-production means the "staged rollout with feature flags" plan from the previous verdict is retired. The three layers land in Sprint 2 in the following order — chosen to maximise coverage from the earliest commit:

1. **Layer 3 first** (before-tool authorisation hook in `preTool` middleware). No migration. Touches `skillExecutor.ts` to remove the per-case wrappers and `agentExecutionService.ts` to add the middleware. Unblocks universal coverage immediately — every skill invocation, methodology or otherwise, flows through `actionService.proposeAction()`.

2. **Layer 2 second** (`context.assertScope()` helper + call sites at every retrieval boundary). Also no migration. Adds `scope_violation` to the `FailureReason` enum and wraps returned items in the scope assertion. Catches leaks at the context-assembly boundary before they enter the LLM window.

3. **Layer 1 last** (Postgres RLS). Ships as three migrations (0079-0081) in one sprint — all three land together in the dev environment because there are no live users to protect against migration pauses. The split is a code review convenience, not a rollout sequencing requirement. The order within the migrations:

   - 0079: `tasks`, `actions`, `agent_runs` (the highest-touched tables).
   - 0080: `review_items`, `review_audit_records`, `workspace_memories`.
   - 0081: `llm_requests`, `audit_events`, `task_activities`, `task_deliverables`.

   The `orgScoping` middleware (setting `app.organisation_id` per request transaction) ships before 0079 in the same sprint. The three migrations can ship as a single PR if the reviewer prefers — splitting is for readability.

4. The `tool_call_security_events` table and its schema file ship with Layer 3 in sprint 2 (migration 0082). Every scope check writes here from the moment Layer 3 lands — there is no value in a scope check with no audit trail.

**The old "land migrations one batch at a time, verify in staging between batches" plan is retired.** There is no staging. The dev environment is the environment. All three layers ship in one sprint. The `verify-rls-coverage.sh` gate is the safety net — it fails CI if any protected table is missing a policy, which catches the only class of error that matters.

**No feature flag for the `preTool` middleware.** The old plan flagged this as `ROUTER_USE_UNIVERSAL_PRETOOL_INTERCEPT` — that flag is deleted. Pre-production means the new behaviour is the behaviour.

---

## P1.2 — HITL rejection → automatic regression test capture

### Goal

Every time a human reviewer rejects or edits an agent action at a HITL gate, automatically capture the rejection as a replayable regression test for that agent configuration. The test is re-run on every commit; if a future change causes the same agent to make the same rejected decision again, the test fails.

### Current state

The data is **already captured** — `reviewAuditRecords` is populated on every human decision at a review gate. From `server/db/schema/reviewAuditRecords.ts`:

```ts
export const reviewAuditRecords = pgTable('review_audit_records', {
  id: uuid('id').defaultRandom().primaryKey(),
  actionId: uuid('action_id').notNull(),       // → actions.id
  organisationId, subaccountId, agentRunId,
  toolSlug: text('tool_slug').notNull(),
  agentOutput: jsonb('agent_output').notNull(), // proposed args at review time
  decidedBy: uuid('decided_by').notNull(),
  decision: text('decision').notNull(),         // 'approved'|'rejected'|'edited'|'timed_out'
  rawFeedback: text('raw_feedback'),
  collapsedOutcome: text('collapsed_outcome'),  // LLM-classified, async
  editedArgs: jsonb('edited_args'),             // populated when decision = 'edited'
  workflowRunId, workflowStepId,
  proposedAt, decidedAt, waitDurationMs,
});
```

Every field needed for a regression case is already there. The data has no consumer today — there is no service that reads `reviewAuditRecords` other than the audit UI.

### Design

#### Data model

Add a `regression_cases` table that wraps the audit records with regression-specific metadata:

```sql
CREATE TABLE regression_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  agent_id uuid NOT NULL REFERENCES agents(id),
  source_audit_record_id uuid NOT NULL REFERENCES review_audit_records(id),
  tool_slug text NOT NULL,
  -- Inputs the agent received
  input_snapshot jsonb NOT NULL,        -- system prompt + last user message + relevant memory state
  -- The agent's proposed action that was rejected/edited
  rejected_args jsonb NOT NULL,
  -- The corrected version (if edited) or expected behaviour description (if rejected)
  expected_args jsonb,
  expected_outcome text NOT NULL,       -- 'should_not_propose' | 'should_propose_with_edits' | 'should_seek_clarification'
  human_feedback text,                  -- raw feedback from the reviewer for context
  -- Lifecycle
  is_active boolean NOT NULL DEFAULT true,
  last_run_at timestamptz,
  last_run_outcome text,                -- 'pass' | 'regression' | 'inconclusive'
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX regression_cases_org_idx ON regression_cases (organisation_id);
CREATE INDEX regression_cases_agent_idx ON regression_cases (agent_id, is_active);
CREATE UNIQUE INDEX regression_cases_source_audit_idx
  ON regression_cases (source_audit_record_id);
```

The `input_snapshot` is the key non-trivial field. To replay an agent run faithfully, we need:

- The system prompt as it was rendered for that specific run
- The conversation history up to the rejected tool call
- The state of any memory blocks the agent could have read
- The available tools at the time

All of this is reachable from `agent_runs` (via `agentRunSnapshots.systemPromptSnapshot`, `toolCallsLog`) and `actions` (via the reverse link). The `input_snapshot` field is the materialised, dereferenced version — captured once at regression-creation time so a later schema change to `agent_runs` doesn't invalidate the test.

#### Capture pipeline

A new service `server/services/regressionCaptureService.ts`:

```ts
export const regressionCaptureService = {
  /**
   * Called from reviewService.recordDecision() after a rejection or edit.
   * Idempotent: skips if a case already exists for this audit record.
   */
  async captureFromAuditRecord(auditRecordId: string): Promise<void> {
    const audit = await db.select().from(reviewAuditRecords).where(...).limit(1);
    if (!audit || audit.decision !== 'rejected' && audit.decision !== 'edited') return;

    const existing = await db.select().from(regressionCases)
      .where(eq(regressionCases.sourceAuditRecordId, auditRecordId)).limit(1);
    if (existing.length > 0) return;

    // Materialise input snapshot from agent_runs + agent_run_snapshots
    const snapshot = await materialiseInputSnapshot(audit.agentRunId, audit.actionId);

    await db.insert(regressionCases).values({
      organisationId: audit.organisationId,
      agentId: ..., // resolve from agentRunId
      sourceAuditRecordId: auditRecordId,
      toolSlug: audit.toolSlug,
      inputSnapshot: snapshot,
      rejectedArgs: audit.agentOutput,
      expectedArgs: audit.editedArgs,
      expectedOutcome: audit.decision === 'edited'
        ? 'should_propose_with_edits'
        : 'should_not_propose',
      humanFeedback: audit.rawFeedback,
      isActive: true,
    });
  },
};
```

The hook into `reviewService.recordDecision()` is one extra line:

```ts
await regressionCaptureService.captureFromAuditRecord(auditRecord.id);
```

#### Replay pipeline

A new CLI/CI runner `scripts/run-regression-cases.ts`:

- Loads all `regression_cases` where `is_active = true`.
- For each case: spin up a fake agent run with the materialised `input_snapshot` using the **same harness and injection seam as P0.1's test infrastructure**, but point the router-injection slot at the **real LLM router** (`routeCall()` from `server/services/llmRouter.ts`) instead of the LLM stub. The point of the regression runner is to exercise what the current model actually produces against a known-rejected input, so stubbing the LLM would defeat the purpose. The harness provides the isolation and fixture wiring; the router provides the real output. Let the agent emit a tool call, compare against `expected_outcome`.
- Comparison logic:
  - `should_not_propose` — pass if the agent does NOT propose the same `toolSlug` with similar args (similarity threshold defined in the case). Regression if the agent proposes anything close to `rejected_args`.
  - `should_propose_with_edits` — pass if the agent proposes the same `toolSlug` AND the args are closer to `expected_args` than to `rejected_args` (cosine or simple field-level).
  - `should_seek_clarification` — pass if the agent emits text only, no tool calls, and the text contains a question.
- Updates `last_run_at`, `last_run_outcome` per case.
- Summary report: per-agent regression count, drift over time.

#### Cost ceiling

Replaying real LLM calls is expensive. To keep the runner affordable:

- The replay runs on a weekly cron, not every commit. Per-commit CI runs only the **structural trajectory tests** (P3.3) which use stubbed responses.
- A configurable per-agent cap on regression cases: `agents.regressionCaseCap` defaults to 50. New cases past the cap evict the oldest by `last_run_outcome = 'pass' AND last_run_at > 30d`.
- A monthly cost budget per organisation, enforced by `runCostBreaker`.

### Files to change

| File | Change |
|---|---|
| `migrations/0083_regression_cases.sql` | New table per schema above. |
| `server/db/schema/regressionCases.ts` | New Drizzle schema. |
| `server/services/regressionCaptureService.ts` | New service. |
| `server/services/reviewService.ts` | Add one-line hook to capture on every decision. |
| `scripts/run-regression-cases.ts` | New CLI runner. |
| `package.json` | Add `regression:run` script. |
| `server/services/__tests__/regressionCapture.test.ts` | Unit tests for the materialisation logic. |

### Test plan

- Unit tests assert that `captureFromAuditRecord()` is idempotent, skips approvals, captures rejections + edits.
- Integration test: feed a fake `reviewAuditRecord` row, run `captureFromAuditRecord`, assert a `regression_cases` row exists with the right shape.
- Manual test: run the regression CLI against a known-good agent and confirm zero regressions on a freshly captured case (the same model should still produce the same rejected output).

### Risk

Medium. The capture pipeline is low-risk (one new table, one new service, one hook line). The replay runner is higher-risk because it makes real LLM calls and could accumulate cost if misconfigured. Mitigation: per-org monthly cost cap from day one, and the runner is opt-in (does not run automatically until enabled per-org).

### Verdict

**BUILD WHEN DEPENDENCY SHIPS (Sprint 2, immediately after P1.1 Layer 3).**

The capture half (migration 0083, `regressionCaptureService`, hook into `reviewService.recordDecision()`) is trivially additive and goes in first. The replay runner follows once P0.1 Layer 3 has landed the seam extraction — which happens in Sprint 1, so the replay runner is unblocked by the time Sprint 2 starts. Both halves ship in Sprint 2 as a single sequenced pair of PRs:

1. **Capture** — migration 0083, service file, hook line in `reviewService.ts`, unit tests for the materialisation logic. Starts populating `regression_cases` from day one of Sprint 2.
2. **Replay runner** — `scripts/run-regression-cases.ts`, monthly cron wiring, per-org cost budget in `runCostBreaker`. Depends on having enough `regression_cases` rows to actually run against, so there's a natural 1-2 week delay between capture landing and the replay runner producing meaningful output.

**Cost ceiling stays in place** — the replay runner makes real LLM calls, so the per-org monthly budget is enforced from the first commit. Pre-production doesn't remove the cost concern, it just removes the authorisation concern.

---

## P2.1 — Agent run checkpoint + resume parity with Playbooks

### Goal

When an agent run is interrupted (process crash, deploy, OOM, deliberate pause for HITL), it can resume from the last completed tool call instead of restarting from iteration 0. Match the behaviour Playbooks already have via `workflowRuns.checkpoint`.

### Current state

- **Playbooks already checkpoint correctly.** `workflowRuns.checkpoint` is documented in the schema as "LangGraph-style checkpoint — written after each step completes. Allows deterministic resume after process restart or HITL pause."
- **Agent runs do not.** `agentRunSnapshots` exists but contains only the final `systemPromptSnapshot` and `toolCallsLog` (debug data captured at the end). On crash, the run is dead — `runAgenticLoop()` (`agentExecutionService.ts:1228`) starts the loop from `iteration = 0` with no resume path.
- The shared `withBackoff` retry primitive can recover transient API failures within an iteration, but a full process restart loses the entire run.
- Two consequences: (a) any session longer than ~5 minutes is at risk of total loss on deploy, (b) HITL pauses today work by blocking the awaiting Promise inside `hitlService.awaitDecision()` — meaning the entire process must stay alive for the human to respond, which is unsustainable.

### Design

Mirror the Playbooks pattern. Three additions:

#### Schema additions

**Decision: extend `agent_run_snapshots` with a lightweight checkpoint + store messages separately + deprecate `agent_run_snapshots.toolCallsLog`.**

The first version of this spec planned a single `checkpoint jsonb` column holding the full message history. That design has a real problem: on a 50-iteration agent run, the checkpoint would be rewritten ~50 times with a progressively larger `messages` array, causing row bloat (Postgres rewrites the full jsonb blob on every update), write amplification, and slower reads.

**Reconciliation with existing `agent_run_snapshots.toolCallsLog`:**

`agent_run_snapshots` already has a `toolCallsLog jsonb` column from the H-5 blob extraction (see `server/db/schema/agentRunSnapshots.ts:20`). This column holds the finalised tool-call history written **once at run completion** for debug purposes. It is read by the run detail UI to render the tool call timeline.

Adding the new `agent_run_messages` table creates an overlap: `toolCallsLog` contains tool-call records, `agent_run_messages` contains messages including tool results. If both coexist without a clear contract, there are two sources of truth.

**The resolution — a phased handover:**

1. **During P2.1 rollout:** `agent_run_messages` becomes the **authoritative** source of both tool calls and their results for runs that went through the new loop. `toolCallsLog` is marked deprecated in the schema comment but stays populated for backward compatibility with old runs and the debug UI.

2. **Write-time behaviour:** the refactored `runAgenticLoop` writes to `agent_run_messages` append-only during execution. At run completion, it **also** writes a derived `toolCallsLog` jsonb blob by projecting the tool-call subset of the messages. This one-off write at completion keeps the existing UI working without changes.

3. **Read-time behaviour:** new code (the run detail page's Plan panel from P4.3, the trajectory comparison tool from P3.3, the regression replay from P1.2) reads exclusively from `agent_run_messages`. Existing code (the debug UI rendering the tool call timeline) continues to read `toolCallsLog` until it's updated.

4. **Deprecation window:** `toolCallsLog` stays in the schema through Phase 1-5 of this roadmap. It is removed only when the debug UI has been migrated to read from `agent_run_messages` — a follow-up ticket after the roadmap lands, not part of the roadmap itself.

5. **Gate to prevent drift:** a new static gate `verify-run-state-source-of-truth.sh` fails CI if any new code reads `agent_run_snapshots.toolCallsLog` directly (except the one allow-listed debug UI file). This stops future code from accidentally reintroducing the dual source of truth.

**Why not just drop `toolCallsLog` in the same migration?** Because the debug UI migration is non-trivial, out of scope for P2.1, and removing the column would break the UI immediately. The deprecation window is the cleanest way to keep both working during the transition.

**Single-column mistake avoided.** The `agent_run_snapshots.checkpoint` column is NOT a replacement for `toolCallsLog`. It holds pointers only (iteration, messageCursor, counters) — never messages or tool call records. Three-way clean division:

| Column / table | Holds | Write frequency | Lifecycle |
|---|---|---|---|
| `agent_run_messages` (new table) | Full conversation including tool calls + tool results | Append-only, once per message | Authoritative for new runs; RLS-protected (see "Sprint sequencing" below) |
| `agent_run_snapshots.checkpoint` (new column) | Pointers only: iteration, messageCursor, counters, resume token, configVersion hash, lastCompletedToolCallId | Updated **once per completed tool call** (not once per iteration — see Execution Model section), ~500 bytes bounded | New; required for resume |
| `agent_run_snapshots.toolCallsLog` (existing column) | **Deprecated.** Derived tool-call subset written once at run completion for backward-compatible UI reads | Once at run completion | Legacy; removed in a follow-up ticket after the debug UI migrates |

The revised design splits the concern into three pieces:

**Piece 1: Append-only message log.** New table `agent_run_messages`:

```sql
CREATE TABLE agent_run_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  organisation_id uuid NOT NULL REFERENCES organisations(id),  -- for RLS
  sequence_number integer NOT NULL,                            -- monotonic per run
  role text NOT NULL CHECK (role IN ('user', 'assistant', 'tool_result')),
  content jsonb NOT NULL,
  tool_call_id text,                                           -- when role = 'tool_result'
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX agent_run_messages_run_seq_idx
  ON agent_run_messages (run_id, sequence_number);

CREATE INDEX agent_run_messages_run_idx
  ON agent_run_messages (run_id, sequence_number);
```

Every iteration appends its new messages (user injection, assistant response, tool results) with monotonically incremented `sequence_number`. **Never updated after insert.** Write amplification is bounded to the size of the new message, not the full history.

**Sprint sequencing for `agent_run_messages` RLS:**

There is a temporal ordering issue to be explicit about. The P1.1 RLS batch (migrations 0079-0081) ships in **Sprint 2**. `agent_run_messages` is created in **Sprint 3** via migration 0084 as part of P2.1. You cannot add an RLS policy to a table that does not exist yet. The P1.1 "protected tables list" in Sprint 2 therefore does NOT include `agent_run_messages`.

**The contract:** migration 0084 (Sprint 3) ships `agent_run_messages` WITH its RLS policy in the same SQL file. The policy mirrors the shape used by the 0079-0081 batch:

```sql
-- Part of migration 0084 (Sprint 3 / P2.1)
CREATE TABLE agent_run_messages (
  ...
);

ALTER TABLE agent_run_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY agent_run_messages_org_isolation ON agent_run_messages
  USING (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  )
  WITH CHECK (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  );

CREATE POLICY agent_run_messages_admin_bypass ON agent_run_messages
  TO admin_role
  USING (true)
  WITH CHECK (true);
```

**`verify-rls-coverage.sh` updates atomically with the migration.** The protected tables list used by the gate script is not a code constant — it's derived at gate-run time by reading a well-known manifest. Migration 0084 appends `agent_run_messages` to `server/config/rlsProtectedTables.ts` in the same commit as the CREATE TABLE. The gate script reads the manifest and greps migrations for matching `CREATE POLICY` statements. One commit, one coherent change.

This pattern is the **general rule for any new protected table added by later sprints**: the RLS policy ships with the table creation, not deferred to a separate migration. The P1.1 batch (0079-0081) is a one-off retrofit for existing tables. Every new table from Sprint 2 onwards follows the at-creation pattern.

**What this means for each later sprint that adds a protected table:**

| Sprint | Table | Migration | RLS policy location |
|---|---|---|---|
| 2 | `regression_cases` (P1.2) | 0083 | Same migration as CREATE TABLE |
| 2 | `tool_call_security_events` (P1.1 Layer 3) | 0082 | Same migration as CREATE TABLE |
| 3 | `agent_run_messages` (P2.1) | 0084 | Same migration as CREATE TABLE |
| 5 | `memory_blocks`, `memory_block_attachments` (P4.2) | 0088 | Same migration as CREATE TABLE |

The P1.1 rollback table at the bottom of P1.1 is updated to reflect this — migration 0083 and 0084's rollback caveats now include "drop the RLS policy and remove from `rlsProtectedTables.ts` in the same commit".

**Piece 2: Lightweight checkpoint on `agent_run_snapshots`.**

```sql
ALTER TABLE agent_run_snapshots
  ADD COLUMN IF NOT EXISTS checkpoint jsonb;
```

The checkpoint holds only the pointers needed to resume:

```ts
interface AgentRunCheckpoint {
  version: 1;
  iteration: number;                     // current loop iteration
  totalToolCalls: number;
  totalTokensUsed: number;
  messageCursor: number;                 // last sequence_number in agent_run_messages
  middlewareContext: SerialisableMiddlewareContext; // small — just counters + reflection state, no messages
  pendingToolCall?: { id: string; name: string; input: unknown }; // if interrupted mid-execute
  lastCompletedToolCallId?: string;
  resumeToken: string;                   // opaque, prevents concurrent-resume races
  configVersion: string;                 // see "Deterministic resume" below
}

interface SerialisableMiddlewareContext {
  /**
   * Version of the serialised middleware context schema. Incremented every time
   * a field is added, removed, or changes meaning. Resume code compares this
   * against MIDDLEWARE_CONTEXT_VERSION (in limits.ts) and refuses to resume
   * if the checkpoint version is newer than the running code.
   */
  middlewareVersion: number;

  iteration: number;
  tokensUsed: number;
  toolCallsCount: number;
  toolCallHistory: Array<{ name: string; inputHash: string; iteration: number }>;
  // P2.2 — reflection loop state. MUST be included in the serialisable context
  // so a resumed run honours the iteration counter and doesn't start fresh on
  // review_code iterations. If a run is checkpointed after BLOCKED verdict 2/3
  // and then resumed, it continues at iteration 3/3, not 1/3.
  lastReviewCodeVerdict?: 'APPROVE' | 'BLOCKED' | null;
  reviewCodeIterations?: number;
  // P4.1 — preTool decision cache keyed by (runId, toolCallId). MUST be included
  // so a resumed run doesn't double-propose actions that were already gated
  // before the checkpoint. See P1.1 Layer 3 idempotency contract.
  preToolDecisions?: Record<string, { decision: 'auto' | 'review' | 'block'; actionId?: string }>;
}
```

This shape is **bounded in size**. An iteration write is ~500 bytes regardless of run length (even with reflection state and preTool decisions — these are small structures bounded by `MAX_REFLECTION_ITERATIONS = 3` and `MAX_LOOP_ITERATIONS = 25` respectively). Row updates are cheap.

### Checkpoint persistence contract — the rules that govern future extensions

This is the contract every future middleware author must follow. It is enforced by a new gate script `verify-middleware-state-serialised.sh`.

**Rule 1: `middlewareContext` is treated as opaque and fully serialised.**

The `resumeAgentRun()` path reads `middlewareContext` from the checkpoint and rehydrates it wholesale into `mwCtx`. It does NOT selectively populate fields, skip fields it doesn't recognise, or attempt to merge with defaults from the current code. The checkpoint IS the source of truth for middleware state at the checkpoint boundary.

**Rule 2: No middleware state is recomputed on resume.**

If a middleware maintains state across iterations (counter, cache, last-seen value, accumulated set), that state MUST live in `mwCtx` and be serialised. The alternative — recomputing the state from the message log on resume — is banned because it's (a) slow, (b) easy to get wrong when the derivation rule changes, and (c) causes non-deterministic resume when the recomputation depends on config that may have changed between run start and resume.

Concrete example of the banned pattern: "on resume, iterate over `agent_run_messages` and count how many `review_code` calls have happened so far to rebuild `reviewCodeIterations`." This is banned because it couples the reflection loop's resume correctness to the message log format, and if the format changes (or the derivation misses a case), the resumed run silently loses its iteration count.

**Rule 3: New middleware features must either be derivable from existing serialised state OR add new fields to the checkpoint schema (and bump `middlewareVersion`).**

When a new middleware is added in a future sprint (Sprint 5's topic filter, the P4.4 critique gate, etc.), the author has two options:

- **Derivable option:** prove that the new middleware's state can be reconstructed purely from fields already in `SerialisableMiddlewareContext` plus `agent_run_messages`. Document the derivation in the middleware's file header. No schema change needed.
- **Additive option:** add new fields to `SerialisableMiddlewareContext`, bump `MIDDLEWARE_CONTEXT_VERSION` in `limits.ts` by 1, and add a migration note to the checkpoint rollback documentation.

There is no "just don't serialise it, recompute on resume" third option. That is the banned pattern from Rule 2.

**Rule 4: `middlewareVersion` is a forward-compatibility guard.**

When `resumeAgentRun()` reads a checkpoint, it compares the checkpoint's `middlewareVersion` against the current `MIDDLEWARE_CONTEXT_VERSION` constant:

- **Equal:** resume proceeds normally.
- **Checkpoint version < current version:** the code has added new optional fields since the checkpoint was written. Resume proceeds with the new fields populated from defaults. This is the normal forward-compatibility case and it is allowed.
- **Checkpoint version > current version:** the checkpoint was written by newer code than the currently-running code (possible if a deploy rolls back and an in-flight run resumes on the older binary). Resume refuses with `failure('middleware_version_newer_than_runtime', ...)`. The run stays in `awaiting_review` and can be resumed after the code is rolled forward again.

**Rule 5: Removing or renaming a field is a breaking change.**

If a field is removed from `SerialisableMiddlewareContext`, bump `MIDDLEWARE_CONTEXT_VERSION` by 1 and mark any in-flight runs with `checkpoint.middlewareVersion < new version` as permanently non-resumable (they transition to `failed` with `failureReason: 'middleware_schema_incompatible'`). In pre-production this is acceptable; in a future stabilised phase this becomes a coordinated deployment concern.

### New static gate: `verify-middleware-state-serialised.sh`

The gate asserts that every field on the `MiddlewareContext` runtime type has a matching field on `SerialisableMiddlewareContext`. If a developer adds a field to `MiddlewareContext` without also adding it to `SerialisableMiddlewareContext` (or documenting it as explicitly ephemeral with a `// ephemeral:` comment), the gate fails CI.

Implementation: greps for the `MiddlewareContext` and `SerialisableMiddlewareContext` interfaces, extracts their fields, compares the sets, and reports any drift.

**Explicit coupling notes:**

- **P2.2 reflection state** → P2.1 serialisation: when P2.2 ships its middleware, it MUST extend `SerialisableMiddlewareContext` with `lastReviewCodeVerdict` and `reviewCodeIterations` (as shown above), bump `MIDDLEWARE_CONTEXT_VERSION` from 1 to 2, and update the round-trip test. Sprint 3 landing order: P2.1 ships first with the initial shape, then P2.2 adds its fields as a version bump.
- **P1.1 Layer 3 preTool decision cache** → P2.1 serialisation: P1.1 ships in Sprint 2 before P2.1, so the `preToolDecisions` field is part of the initial `middlewareVersion: 1` shape. No version bump needed.
- **P4.1 topic filter** → P2.1 serialisation: the topic filter is stateless per-iteration (it re-classifies the user message every iteration), so it has no state to serialise. This must be documented in the middleware's file header per Rule 3's derivable-option clause.
- **P4.4 critique gate** → P2.1 serialisation: similarly stateless per-iteration. No new serialised fields needed. Must be documented.

**Piece 3: Pruning policy.** Both `agent_run_messages` and `agent_run_snapshots` rows cascade on `agent_runs` delete. A nightly cron `agent-run-cleanup` deletes `agent_runs` in terminal state (`completed`, `failed`, `timeout`, `cancelled`) older than 90 days (configurable per org via `organisations.run_retention_days`). See "Retention and pruning policies" cross-cutting section for the full retention table.

#### Deterministic resume — config snapshot by default

**Change from the first version of this spec.** The original spec said:

> Reconstructs `LoopParams` from the checkpoint + the agent's current config (NOT the configSnapshot — we want the live config because the agent may have been edited mid-pause).

That was wrong. Using the live config on resume creates a real security and correctness problem:

- If the agent's `additionalPrompt` was edited during the pause, the resumed run runs with instructions it wasn't authorised for at start time.
- If a skill was added to the allowlist during the pause, the agent gains tool access mid-run and can invoke skills that were forbidden when the run started.
- If a policy rule was edited during the pause, actions that were auto-approved at start become blocked (or vice versa).
- Debugging a mixed-config run is almost impossible — telemetry shows two different behaviours for one run ID.

**The correct default is: resume uses the `configSnapshot` captured at run start.** `agent_runs.configSnapshot` already exists for this purpose (per `server/db/schema/agentRuns.ts:47`) — the resume path reads from it, not from the live agent row.

The checkpoint records `configVersion: string` (a hash of the snapshot at run start) so the resume path can assert the snapshot hasn't been tampered with between checkpoint write and resume read.

**Manual override: `resumeWithLatestConfig`.** An operator endpoint `POST /api/agent-runs/:id/resume?useLatestConfig=true` is available for the specific case where an operator knows the original config was broken and wants to resume with the fixed version. This endpoint requires `system_admin` or org_admin role, writes an audit event, and is the only way to break the snapshot-by-default rule. The default `resumeAgentRun(runId)` call from the pg-boss worker **never** uses live config.

#### Write path

Inside `runAgenticLoop()` at `agentExecutionService.ts:1228`, after each iteration completes (specifically after the `postTool` middleware phase at line 1528):

```ts
await persistCheckpoint(runId, {
  version: 1,
  iteration,
  totalToolCalls,
  totalTokensUsed,
  messages,
  middlewareContext: serialiseMiddlewareContext(mwCtx),
  lastCompletedToolCallId: lastToolCall?.id,
  resumeToken: generateResumeToken(),
});
```

`persistCheckpoint` is a single upsert into `agent_run_snapshots` keyed on `runId`. Throttled — write at most once per 3 seconds (matching the existing heartbeat throttle at `agentExecutionService.ts:1144` for the `lastActivityAt` update).

#### Read path

A new entry point `resumeAgentRun(runId, { useLatestConfig = false } = {})` that:

1. Loads `agent_runs` row, asserts `status = 'pending'` or `'running'` or `'awaiting_review'`.
2. Loads checkpoint from `agent_run_snapshots`. If absent, falls through to a fresh `runAgenticLoop()` (defensive — handles old runs with no checkpoint).
3. Determines the config source:
   - **Default (`useLatestConfig = false`):** reads from `agent_runs.configSnapshot` (immutable, captured at run start). Asserts `hash(configSnapshot) === checkpoint.configVersion` — if they don't match, refuses to resume and moves the run to `failed` with `failureReason: 'config_snapshot_tamper'`.
   - **Operator override (`useLatestConfig = true`):** reads from the live `agents` / `subaccount_agents` rows. Only callable from the audited admin endpoint. Writes an audit event before proceeding.
4. Streams messages from `agent_run_messages` where `sequence_number <= checkpoint.messageCursor`, ordered, into the reconstructed `LoopParams.messages`.
5. Reconstructs the `MiddlewareContext` from `checkpoint.middlewareContext` (counters and iteration only — messages are already rehydrated above).
6. Calls `runAgenticLoop()` with `startingIteration: checkpoint.iteration + 1` and the rehydrated messages.
7. The loop continues from where it left off.

#### Per-tool-call checkpoint rule (LangGraph-inspired)

This is the rule that implements the Execution Model section's "checkpoint per completed tool call" semantics inside `runAgenticLoop`.

The rule: **an iteration's inner tool-call loop executes one tool call, writes a checkpoint including `lastCompletedToolCallId`, executes the next tool call, writes another checkpoint, and so on until all tool calls from the current LLM response are done.** Then the loop advances to the next LLM call.

This is a meaningful change to `runAgenticLoop()`. Today (line 1495) the loop iterates over all tool calls in a single LLM response in a tight `for` loop without checkpointing between them. After P2.1, that loop becomes: execute one, checkpoint, execute next, checkpoint, ... until all are done, then the next iteration's LLM call runs.

**Resume correctness property:** given a checkpoint with `lastCompletedToolCallId = X`, the resume path skips all tool calls in the current LLM response up to and including X, then executes the next one. This guarantees no completed tool call is re-executed on resume from a clean checkpoint.

**The race window** (tool completes → crash → checkpoint not persisted) is still real and still handled by the handler's declared `idempotencyStrategy`, exactly as specified in the Execution Model section. This rule narrows the window's blast radius but does not eliminate it.

#### How HITL becomes async

Today: `hitlService.awaitDecision()` blocks the agent run process until a human decides. The process must stay alive.

After P2.1: when a `review` gate fires, the loop checkpoints and **returns**. The run status moves to `awaiting_review`. When the human decides via the API, a new pg-boss job is enqueued: `agent-run-resume` with `{ runId }`. A worker picks it up, calls `resumeAgentRun(runId)`, and the loop continues. The original process is free to die.

This is a significant behaviour change for the HITL path — it makes long-running HITL pauses cheap (no held processes) but requires `hitlService` to be refactored from blocking-wait to enqueue-on-decide.

### Files to change

| File | Change |
|---|---|
| `migrations/0084_agent_run_checkpoint_and_messages.sql` | **New migration containing both**: (a) `ALTER TABLE agent_run_snapshots ADD COLUMN checkpoint jsonb`; (b) `CREATE TABLE agent_run_messages (...)`; (c) `ENABLE ROW LEVEL SECURITY` on `agent_run_messages`; (d) the `agent_run_messages_org_isolation` and `agent_run_messages_admin_bypass` policies; (e) the required indexes (`run_seq_idx` unique, `run_idx`). All in one SQL file so the table and its RLS policy are atomic. |
| `migrations/_down/0084_agent_run_checkpoint_and_messages.sql` | Rollback: drop `agent_run_messages`, drop the `checkpoint` column, remove `agent_run_messages` from `rlsProtectedTables.ts` manifest — in that order. |
| `server/db/schema/agentRunSnapshots.ts` | Add `checkpoint: jsonb('checkpoint').$type<AgentRunCheckpoint>()` column. Add deprecation comment on existing `toolCallsLog` column pointing at `agent_run_messages`. |
| `server/db/schema/agentRunMessages.ts` | **New Drizzle schema file** mirroring the migration table definition. Exports `agentRunMessages` table + `AgentRunMessage` / `NewAgentRunMessage` inferred types. |
| `server/db/schema/index.ts` | Re-export `agentRunMessages` and its types. |
| `server/config/rlsProtectedTables.ts` | **New manifest file** (created in Sprint 2 with P1.1 Layer 1). Append `agent_run_messages` to the manifest in the same commit as the migration. See "Sprint sequencing for `agent_run_messages` RLS" above. |
| `shared/iee/types.ts` (or `agentExecutionService` co-located) | Declare `AgentRunCheckpoint` TypeScript type (see "Schema additions" above for shape). |
| `server/services/agentExecutionService.ts` | Add `persistCheckpoint()` after each iteration; add `resumeAgentRun()`; refactor inner tool-call loop to one-at-a-time execution; replace in-memory `messages` array with append-only writes to `agent_run_messages` via `agentRunMessageService`. |
| `server/services/agentExecutionServicePure.ts` | Add `serialiseMiddlewareContext()` / `deserialiseMiddlewareContext()` (pure helpers extracted in P0.1). Must include reflection state (`lastReviewCodeVerdict`, `reviewCodeIterations`) once P2.2 has shipped — see "Reflection state in checkpoint" note in P2.2. |
| `server/services/agentRunMessageService.ts` | **New service** for appending messages during run execution and streaming them back for replay. Exposes `appendMessage(runId, organisationId, sequence, role, content, toolCallId?)` and `streamMessages(runId, fromSequence?, toSequence?)`. Centralises the write path so the `runAgenticLoop` doesn't talk to the table directly. |
| `server/services/toolCallsLogProjectionService.ts` | **New service** (small) that reads `agent_run_messages` at run completion and projects the tool-call subset into `agent_run_snapshots.toolCallsLog` for backward-compat UI reads. Called once per run from the completion hook. Drops the requirement that the loop maintain `toolCallsLog` inline. |
| `server/config/jobConfig.ts` | Add `agent-run-resume` job type with `singletonKey: 'run:${runId}'` per the idempotency contract. |
| `server/jobs/agentRunResumeProcessor.ts` | New worker that handles `agent-run-resume` jobs via `resumeAgentRun(runId, { useLatestConfig: false })`. Inherits the RLS execution contract (Path 2) via `createWorker` wrapper. |
| `server/services/hitlService.ts` | Refactor from `awaitDecision(promise)` (blocking) to `triggerResume(runId)` (enqueues the `agent-run-resume` job on human decision). |
| `server/services/agentRunStatusService.ts` (or wherever agent run statuses live) | Add `'awaiting_review'` status to the enum. |
| `server/routes/agentRuns.ts` | New endpoint `POST /api/agent-runs/:id/resume?useLatestConfig=true` — admin-only, writes audit event, the only path that bypasses snapshot-by-default. |
| `scripts/gates/verify-run-state-source-of-truth.sh` | **New gate** that fails CI if any new code reads `agent_run_snapshots.toolCallsLog` directly (except the allow-listed debug UI file). Prevents drift during the deprecation window. |
| `server/services/__tests__/agentExecutionService.checkpoint.test.ts` | New unit tests for serialise/deserialise round-trip of `SerialisableMiddlewareContext`. |
| `server/services/__tests__/agentRunMessageService.test.ts` | New unit tests for append-only writes and stream reads. |
| `server/services/__tests__/agentRun.crash-resume-parity.test.ts` | Integration test **I2** from the testing strategy. Kill-point matrix, config-snapshot enforcement, HITL async resume. |

### Test plan

- Unit test: serialise → deserialise → assert byte-equal (no information loss).
- Unit test: `resumeAgentRun()` from a known checkpoint produces identical messages to `runAgenticLoop()` running fresh (cross-check the resume path).
- Integration test: kill the process mid-iteration, restart, verify the run resumes from the right point and produces the same final output as a non-interrupted run.
- Integration test: HITL pause flow — agent hits review gate, process exits, human approves, new process resumes the run.

### Risk

Pre-production removes the rollout concern. The change to "one tool call at a time, checkpoint between" is still a hot-path behaviour change and gets the full unit-test + integration-test treatment from P0.1's harness. No feature flag — the new behaviour is the behaviour.

### Verdict

**BUILD WHEN DEPENDENCY SHIPS (Sprint 3, after P1.1 lands in Sprint 2).**

Sequence: P1.1 Layer 1 (RLS migrations) ships in Sprint 2, then P2.1 ships in Sprint 3. The reason to wait is still valid — checkpoints write into `agent_run_snapshots`, which P1.1 Layer 1 adds an RLS policy to, so checkpointing must respect the `app.organisation_id` setting already in place. Starting P2.1 before P1.1 means writing the checkpoint path twice.

Once Sprint 2 lands, P2.1 is a single-sprint item:

1. Migration 0084 adds the `checkpoint jsonb` column to `agent_run_snapshots` **and** creates `agent_run_messages` with its RLS policy in the same SQL file. `rlsProtectedTables.ts` manifest appended in the same commit. Down-migration at `migrations/_down/0084_*.sql`.
2. `agentRunMessageService` shipped first — `runAgenticLoop` cannot start writing messages until the service exists.
3. `persistCheckpoint()` writes **after each completed tool call** (per the authoritative rule in the Execution Model section). The call is throttled by coalescing multiple tool calls within the same millisecond into a single write — in practice tool calls take longer than that, so the throttle is rarely relevant. Writes only the lightweight checkpoint — messages already went into `agent_run_messages` via the service.
4. `resumeAgentRun()` reads the checkpoint, streams messages from `agent_run_messages` where `sequence_number <= checkpoint.messageCursor`, reconstructs `LoopParams`.
5. Inner tool-call loop refactored to one-at-a-time execution.
6. `hitlService` refactored from blocking-wait to enqueue-on-decide (new `agent-run-resume` pg-boss job with `singletonKey: 'run:${runId}'`).
7. `toolCallsLogProjectionService` runs at run completion to populate the deprecated `toolCallsLog` jsonb for backward-compat UI.
8. Integration test **I2** (`agentRun.crash-resume-parity.test.ts`) covers: kill-point matrix at three positions, config-snapshot enforcement, HITL async resume.

**The old `AGENT_RUN_CHECKPOINTING_ENABLED` feature flag is deleted from the plan.** The new behaviour ships enabled.

---

## P2.2 — Deterministic reflection loop enforcement

### Goal

Make the existing prompt-level "max 3 self-review iterations" rule in `review_code` mechanically enforced, not vibes-based. When a write_patch / create_pr fires without a preceding APPROVE verdict from `review_code`, inject the critique back into the loop. After 3 iterations without an APPROVE, escalate to HITL.

### Current state

- `server/skills/review_code.md` line 47: *"Always invoke this skill before submitting any patch via `write_patch`. No patch is submitted without a self-review pass. If the verdict is BLOCKED, fix blocking issues and re-invoke. Maximum 3 self-review iterations before escalating to human."*
- Output format includes a structured `Verdict` line (`APPROVE` | `BLOCKED`) at the end of the methodology output.
- Enforcement is **prompt-only**. A model that decides to skip review entirely faces no consequence — `write_patch` will just propose the action and (depending on policy) get auto-approved or routed to HITL with no self-review attached.
- `executeMethodologySkill('review_code', ...)` at `skillExecutor.ts:391` returns the methodology output as a string. The verdict is in the string but not parsed.

### Design

#### One new middleware in the `postTool` pipeline

Location: `agentExecutionService.ts:1528`, in the `postTool` loop. Today the `postTool` pipeline runs after a tool result is returned to the LLM. Adding a new middleware here means it sees every tool execution and can react.

```ts
// New file: server/services/middleware/reflectionLoopMiddleware.ts
import { failure } from '../../../shared/iee/failure.js';

export const reflectionLoopMiddleware: PostToolMiddleware = {
  name: 'reflection_loop',
  execute(ctx, toolCall, toolResult) {
    // Track verdicts from review_code in the middleware context
    if (toolCall.name === 'review_code') {
      const verdict = parseVerdict(toolResult);
      ctx.lastReviewCodeVerdict = verdict;        // 'APPROVE' | 'BLOCKED' | null
      ctx.reviewCodeIterations = (ctx.reviewCodeIterations ?? 0) + 1;

      if (verdict === 'BLOCKED' && ctx.reviewCodeIterations < MAX_REFLECTION_ITERATIONS) {
        // Inject the critique back as a user message
        return {
          action: 'inject_message',
          message: `Self-review verdict: BLOCKED (iteration ${ctx.reviewCodeIterations}/${MAX_REFLECTION_ITERATIONS}). Address the blocking issues above before invoking write_patch.`,
        };
      }

      if (verdict === 'BLOCKED' && ctx.reviewCodeIterations >= MAX_REFLECTION_ITERATIONS) {
        // Escalate
        return {
          action: 'escalate_to_review',
          reason: 'reflection_iterations_exhausted',
        };
      }
    }

    // Block write_patch if review_code hasn't approved
    if (toolCall.name === 'write_patch' && ctx.lastReviewCodeVerdict !== 'APPROVE') {
      return {
        action: 'inject_message',
        message: `Cannot submit a patch without an APPROVE verdict from review_code. Run review_code on your changes first.`,
      };
    }

    return { action: 'continue' };
  },
};
```

`MAX_REFLECTION_ITERATIONS = 3` lives in `server/config/limits.ts` next to `MAX_LOOP_ITERATIONS`.

#### `parseVerdict()` helper

The methodology output has a `## Verdict` section ending with either `APPROVE` or `BLOCKED`. A simple regex over the last 200 characters of the output: `/Verdict[\s\S]*?(APPROVE|BLOCKED)/`. Lives in `server/services/middleware/reflectionLoopPure.ts` (the pure-function companion for testability per the P0.1 convention).

#### Middleware context extension

`MiddlewareContext` (defined inside `agentExecutionService.ts`) needs two new optional fields:

```ts
interface MiddlewareContext {
  // ... existing fields ...
  lastReviewCodeVerdict?: 'APPROVE' | 'BLOCKED' | null;
  reviewCodeIterations?: number;
}
```

These are reset when a new `runAgenticLoop()` starts (they live in `mwCtx`, which is built fresh per run).

#### `escalate_to_review` middleware action

This is a **new middleware action type** that doesn't exist today. The current `postTool` middleware actions are `continue | stop | inject_message`. Adding `escalate_to_review` means:

1. The current run halts.
2. A `reviewItem` is created via `reviewService.createReviewItem()` with the agent's last `write_patch` proposal as the action under review.
3. The agent run status moves to `awaiting_review`.

This introduces a circular-dependency risk (`postTool` middleware ↔ `reviewService`). Mitigation: the middleware does not call `reviewService` directly. It returns the escalate signal to the loop, which calls `reviewService` from outside the middleware.

### Files to change

| File | Change |
|---|---|
| `server/services/middleware/reflectionLoopMiddleware.ts` | New. The middleware. |
| `server/services/middleware/reflectionLoopPure.ts` | New. `parseVerdict()` and any other pure helpers. |
| `server/services/__tests__/reflectionLoop.test.ts` | New. Tests `parseVerdict` + the middleware decision logic. |
| `server/config/limits.ts` | Add `MAX_REFLECTION_ITERATIONS = 3`. |
| `server/services/agentExecutionService.ts` | Register `reflectionLoopMiddleware` in `pipeline.postTool`. Handle the new `escalate_to_review` action in the post-tool loop. |
| `server/services/__tests__/middlewarePipeline.test.ts` | Extend if exists, create if not, to test the escalation flow. |

### Test plan

- Unit tests for `parseVerdict()` on real `review_code` output examples (APPROVE, BLOCKED, malformed, missing verdict).
- Unit test for the middleware: feed it a sequence of tool calls + results, assert the middleware returns the right action sequence.
- Manual integration test (post-implementation): run a dev agent on a small task, observe that `write_patch` without a preceding `review_code` is blocked.

### Risk

**Low.** The middleware is a single new file, additive to the existing pipeline. The escalation path uses an existing primitive (`reviewService.createReviewItem`). The biggest risk is the regex parsing of the verdict — mitigation is to test against real `review_code` outputs from past agent runs (queryable from `agentRunSnapshots.toolCallsLog`).

### Verdict

**BUILD IN SPRINT 3.**

All pieces ship together — the split between "capability" and "wiring" from the previous verdict is retired. Pre-production means the new middleware is registered and active from the moment it lands. Order within Sprint 3:

1. `MAX_REFLECTION_ITERATIONS = 3` constant in `limits.ts`.
2. `reflectionLoopPure.ts` with `parseVerdict()` + unit tests.
3. `reflectionLoopMiddleware.ts` and its unit tests.
4. Extend the `postTool` middleware action union to include `escalate_to_review` and wire the handler in `runAgenticLoop()`.
5. Register the middleware in `pipeline.postTool`.

This is the smallest behaviour-change item in Sprint 3. Ships alongside P2.3 and P2.1, no ordering constraint between them beyond "land after Sprint 2".

---

## P2.3 — Confidence scoring + decision-time guidance

### Goal

Two complementary improvements to HITL quality:

1. **Confidence gate.** The agent emits a `confidence` value alongside every tool call. Low confidence auto-upgrades the gate level for that single call (auto → review).
2. **Decision-time guidance.** Situational instructions are injected at the action proposal moment, not front-loaded into the master prompt.

Together they tighten HITL without adding noise or rigidity to the prompt.

### Current state

- The `report_bug` skill already has a `confidence` input (`server/skills/report_bug.md` lines 18, 23). It's metadata only — nothing reads it for routing decisions. The skill methodology even says "the QA confidence score is automatically capped at 0.79 [for critical bugs]" implying a downstream consumer that doesn't actually exist yet.
- `policyEngineService.evaluatePolicy()` (`server/services/policyEngineService.ts:121`) takes a `PolicyContext { toolSlug, subaccountId, organisationId, input? }`. It evaluates rules from the `policyRules` table and returns `auto | review | block`. There is no notion of confidence in the context.
- Master prompts today are static. They are assembled once per run from `agent.masterPrompt + agent.additionalPrompt + memory blocks + tool list`. There is no runtime guidance injection.

### Design

#### Slice A — Confidence as a first-class field on every tool call

Confidence is **not a tool argument**. Tool arguments are provided by the LLM and shaped by each skill's `parameterSchema`. Adding a `confidence` field to every tool's parameter schema would (a) pollute every skill, (b) be ignored by the LLM unless every prompt mentions it, (c) couple the gate logic to skill-level concerns.

Instead: confidence is emitted via a **dedicated tool call wrapper** the LLM is instructed to use. The agent prompt template gains a section:

> When you call a tool, prefix it with a brief confidence assessment. For each tool call, emit a `tool_intent` block with `{ tool: '...', confidence: 0.0-1.0, reasoning: '...' }` immediately before the tool call itself. The platform uses this for adaptive review gating.

Then the `preTool` middleware looks for the most recent `tool_intent` block in the conversation history matching the current tool call and reads the confidence. If absent, defaults to `1.0` (no impact).

This is cleaner than parameter-schema pollution and degrades gracefully (an agent that doesn't emit `tool_intent` blocks behaves exactly as today).

#### Slice B — Confidence-driven gate upgrade

In `policyEngineService.evaluatePolicy()`, after the existing first-match rule lookup:

```ts
const decision = ...; // existing first-match logic
if (decision.decision === 'auto' && ctx.confidence !== undefined && ctx.confidence < CONFIDENCE_GATE_THRESHOLD) {
  return {
    ...decision,
    decision: 'review',
    matchedRule: decision.matchedRule,
    reason: `confidence_${ctx.confidence.toFixed(2)}_below_threshold`,
  };
}
```

`CONFIDENCE_GATE_THRESHOLD = 0.7` lives in `server/config/limits.ts`. Per-org override goes in `policy_rules` via a new optional column `confidenceThreshold` (or, more conservatively, as a wildcard rule with a `confidenceCondition`).

Block-level decisions are not affected — a `block` rule still blocks regardless of confidence.

#### Slice C — Decision-time guidance

A new method on `policyEngineService`:

```ts
async getDecisionTimeGuidance(ctx: PolicyContext): Promise<string | null> {
  const rules = await getRulesForOrg(ctx.organisationId);
  const matchingGuidance = rules
    .filter(r => matchesRule(r, ctx) && r.guidanceText)
    .map(r => r.guidanceText)
    .join('\n');
  return matchingGuidance || null;
}
```

The `policy_rules` table gains a `guidance_text` column (text, nullable). The `preTool` middleware calls `getDecisionTimeGuidance()` and, if a result is returned, **injects it into the conversation as a system reminder before the tool call executes**:

```
<system-reminder>
Decision-time guidance for write_patch on subaccount XYZ:
This subaccount's repo has strict commit message conventions. Your write_patch
must include a Conventional Commits prefix (feat:, fix:, chore:, refactor:).
</system-reminder>
```

The agent sees this guidance in-context when it makes the next tool call, and the model has documented good behaviour for system-reminder blocks.

This is more useful than front-loaded prompt rules because:
- It only fires for the relevant action types (no prompt bloat for irrelevant ones).
- It can vary by subaccount, by input conditions, by time of day.
- It scales past the 3-4-rule degradation point of static prompts.

### Files to change

| File | Change |
|---|---|
| `migrations/0085_policy_rules_confidence_guidance.sql` | Add `confidence_threshold real`, `guidance_text text` to `policy_rules`. |
| `server/db/schema/policyRules.ts` | Mirror new columns. |
| `server/services/policyEngineService.ts` | Extend `PolicyContext` with `confidence?: number`. Add `getDecisionTimeGuidance()`. Update `evaluatePolicy()` for confidence upgrades. |
| `server/services/agentExecutionService.ts` | In `preTool` middleware: extract last `tool_intent` confidence; call `policyEngineService.getDecisionTimeGuidance()`; inject guidance as system reminder. |
| `server/services/agentExecutionServicePure.ts` | New helper `extractToolIntentConfidence(messages, toolName)`. |
| `server/services/__tests__/policyEngine.confidence.test.ts` | New. Tests confidence gate logic. |
| `server/services/__tests__/agentExecutionService.toolIntent.test.ts` | New. Tests `extractToolIntentConfidence`. |
| All agent master prompt templates | One-line addition explaining the `tool_intent` convention. |
| `server/config/limits.ts` | Add `CONFIDENCE_GATE_THRESHOLD = 0.7`. |

### Test plan

- Unit test: `extractToolIntentConfidence` returns the right value for various conversation shapes.
- Unit test: `policyEngineService.evaluatePolicy()` upgrades auto → review when confidence < threshold and downgrade is not blocked.
- Unit test: `getDecisionTimeGuidance()` returns concatenated guidance from matching rules.
- Manual test: run a dev agent with a prompt that says "always emit low confidence" and verify all its tool calls hit the review gate.

### Risk

Low-medium. The confidence side is genuinely additive — agents that don't emit `tool_intent` are unaffected. The decision-time guidance side is also additive but creates a new place where prompts can affect behaviour, which adds a reasoning surface for future debugging.

### Verdict

**BUILD IN SPRINT 3.**

Ships in Sprint 3 alongside P2.1 and P2.2. All three slices land together:

1. **Slice A** (`tool_intent` convention in the agent prompt template + `extractToolIntentConfidence()` pure helper + unit tests).
2. **Slice B** (migration 0085 adding `confidence_threshold` and `guidance_text` columns to `policy_rules`, plus `confidence` field on `PolicyContext`, plus the auto→review upgrade logic in `policyEngineService.evaluatePolicy()`).
3. **Slice C** (`getDecisionTimeGuidance()` on `policyEngineService`, called from the `preTool` middleware, result injected as a `<system-reminder>` block).

The three slices touch `agentExecutionService.ts`, `policyEngineService.ts`, and the `policy_rules` migration — all files that P1.1 and P2.2 are already modifying in the same sprint range. Coalescing the work into one sprint reduces merge-conflict surface vs. spreading it across three.

No feature flag. Agents that don't emit `tool_intent` blocks behave exactly as before — the backward-compatible default is `confidence = 1.0`.

---

## P3.1 — Playbook multi-execution-mode toggle

### Goal

Add a `runMode` to playbook runs that lets operators choose between four behaviours without redesigning the playbook itself: `auto` (current behaviour, deterministic step-by-step), `supervised` (approval gate before every step), `background` (async, no live updates), `bulk` (fans out N runs against the same template).

### Current state

- `playbookRuns` does not have a `runMode` column. Today every playbook run executes step-by-step with parallelism limited by step `dependsOn` declarations.
- The Playbook engine (`server/services/playbookEngineService.ts`) tick algorithm reads steps where `dependsOn` is satisfied and dispatches them. `MAX_PARALLEL_STEPS_DEFAULT = 8`. The engine has a watchdog and advisory locks (per architecture.md §Playbooks).
- HITL gates exist at the step level via `humanReviewRequired: true` on a step definition (architecture.md §"Step definition shape"). These are *opt-in per step*, not a run-level setting.
- Bulk execution (running the same template against many subaccounts) can be approximated today by enqueuing N separate playbook runs from a script, but there is no first-class concept.

### Design

#### Schema

Add one column to `playbook_runs`:

```sql
ALTER TABLE playbook_runs
  ADD COLUMN IF NOT EXISTS run_mode text NOT NULL DEFAULT 'auto'
    CHECK (run_mode IN ('auto', 'supervised', 'background', 'bulk'));
```

That's it for the schema. The four modes are enforced by engine behaviour, not new tables.

#### Engine behaviour per mode

**`auto` (default):** unchanged. Existing behaviour.

**`supervised`:**

In the engine tick, after computing the ready set of steps but before dispatching them, check if a step's pending state matches `playbookStepReviews` (the existing approval table). If not, synthesise a review item and pause the step. The step does not advance until a human approves.

Implementation: a new branch in `playbookEngineService.tick()` that, for `runMode === 'supervised'`, calls `playbookStepReviewService.requireApproval(stepRun)` before dispatch. The existing review queue flow is reused.

**`background`:**

Same execution as `auto`, but with WebSocket updates suppressed. The caller receives only the final completion event. Useful for long-running playbooks where the operator doesn't want a live stream.

Implementation: a flag `suppressWebsocketUpdates` passed to the playbook event emitter. The emitter checks the flag before broadcasting.

**`bulk`:**

The current playbook run becomes a *parent* run. The engine reads the parent's `bulkTargets: string[]` (subaccount IDs) from `contextJson` and enqueues N child playbook runs against the same `templateVersionId`, one per target. The parent run's status is `running` until all children complete (or fail). The parent collects child results into its own `contextJson.bulkResults`.

Implementation: a new step type `bulk_dispatch` is added at the engine level (not a user-facing step), or more cleanly: when `runMode === 'bulk'` and the run is at iteration 0, the engine special-cases the first tick to fan out children instead of executing the template's steps directly.

This is the most complex of the four modes and likely the largest single piece of work in P3.1.

#### Operator UX

The mode is selected at run kick-off. The Playbook Studio UI gains a dropdown in the "Start Run" modal. The API endpoint that creates a playbook run accepts a `runMode` field.

For `bulk`, the UI also surfaces a target picker (which subaccounts to target) — the picker writes the array into `contextJson.bulkTargets`.

### Files to change

| File | Change |
|---|---|
| `migrations/0086_playbook_run_mode.sql` | Add `run_mode` column. |
| `server/db/schema/playbookRuns.ts` | Mirror column. |
| `server/services/playbookEngineService.ts` | Branch on `runMode` per tick: supervised → require review per step; background → suppress WS; bulk → fan out children at iteration 0. |
| `server/services/playbookStepReviewService.ts` | New method `requireApproval(stepRun)` for the supervised mode. |
| `server/websocket/emitters.ts` | Honour `suppressWebsocketUpdates` for background mode. |
| `server/routes/playbookRuns.ts` | Accept `runMode` on the create endpoint. |
| `client/src/pages/PlaybookStudioPage.tsx` (or wherever the start-run modal lives) | Add the dropdown + target picker. |
| `server/services/__tests__/playbookEngine.runModes.test.ts` | New tests per mode. |

### Test plan

- Unit test for each mode's behaviour (using the existing `server/lib/playbook/__tests__/playbook.test.ts` pattern).
- Integration test: bulk mode against 3 fake subaccounts, assert 3 children are created and the parent waits for them.
- Manual test: supervised mode pauses at every step.

### Risk

**Medium.** The schema change is trivial. The behaviour changes are bounded inside `playbookEngineService.ts` — no other service is affected. The biggest risk is the bulk mode (new fan-out logic). Mitigation: ship `auto` + `supervised` + `background` first (one PR), then `bulk` separately.

### Verdict

**BUILD IN SPRINT 4.**

The single fastest operator-visible win in the entire roadmap ships in Sprint 4. All four modes (`auto`, `supervised`, `background`, `bulk`) land together:

1. Migration 0086 adds the `run_mode` column with the CHECK constraint.
2. `playbookEngineService` gains per-tick branching on `runMode`.
3. `playbookStepReviewService.requireApproval(stepRun)` is wired into the `supervised` branch.
4. `emitters.ts` honours `suppressWebsocketUpdates` for `background` mode.
5. The `bulk` branch special-cases iteration 0 to fan out children against `contextJson.bulkTargets`.
6. `playbookRuns` create endpoint accepts `runMode` on input.
7. Start-run modal UI gains the dropdown + bulk target picker.

Integration tests against the existing `playbook.test.ts` convention from the start. No feature flag — all four modes are first-class from day one.

---

## P3.2 — Portfolio Health as a bulk-mode Playbook

### Goal

Replace the current sequential per-subaccount loop in the Portfolio Health Agent with a Playbook template running in `bulk` mode (P3.1). One step per subaccount fans out in parallel; a synthesis step waits for all of them.

### Current state

There is no explicit "Portfolio Health Agent" in the codebase today as a standalone agent. The Reporting Agent skills (`compute_health_score`, `compute_churn_risk`, `detect_anomaly`, `generate_portfolio_report`, `query_subaccount_cohort`) are dispatched through `intelligenceSkillExecutor.ts` and invoked by whichever agent the org wires up to call them. They are *capable* of operating across subaccounts but the dispatch pattern is not first-class — there is no template that says "run this for every subaccount in this org".

`MAX_PARALLEL_STEPS_DEFAULT = 8` is the existing parallelism cap in the playbook engine.

### Design

#### Phase 0: a system Playbook template

A new system playbook template `portfolio-health-sweep` defined in `scripts/seed-portfolio-health-playbook.ts` with the following shape:

```ts
{
  name: 'Portfolio Health Sweep',
  initialInputSchema: { type: 'object', properties: {}, required: [] },
  steps: [
    {
      id: 'enumerate_subaccounts',
      name: 'List active subaccounts',
      type: 'agent_call',
      dependsOn: [],
      agentId: '<reporting-agent-id>',
      inputs: { skill: 'list_active_subaccounts' },
      outputSchema: { type: 'object', properties: { subaccountIds: { type: 'array' } } },
    },
    // The following steps are SYNTHESISED at run time by the engine when run_mode === 'bulk'
    // — one step per subaccount returned by enumerate_subaccounts.
    // The engine creates these dynamically in iteration 1.
    {
      id: 'synthesise',
      name: 'Generate portfolio report',
      type: 'agent_call',
      dependsOn: ['<all_per_subaccount_steps>'], // resolved at run time
      agentId: '<reporting-agent-id>',
      inputs: { skill: 'generate_portfolio_report', context: '{{ steps.* }}' },
    },
  ],
}
```

The `bulk_dispatch` mechanism from P3.1 special-cases iteration 1 to enumerate subaccounts and create one step run per result.

#### Concurrency cap protecting GHL rate limits

A new column on `organisations`:

```sql
ALTER TABLE organisations
  ADD COLUMN IF NOT EXISTS ghl_concurrency_cap integer NOT NULL DEFAULT 5;
```

The playbook engine reads this when dispatching `bulk` children that touch GHL: it caps in-flight children to `min(MAX_PARALLEL_STEPS_DEFAULT, organisations.ghl_concurrency_cap)`.

#### Wiring

The system seeds the template via `scripts/seed-portfolio-health-playbook.ts`. Orgs adopt it via the existing playbook fork mechanism. A scheduled trigger (using existing scheduling infrastructure) kicks off the template on a cron.

### Files to change

| File | Change |
|---|---|
| `migrations/0087_org_ghl_concurrency_cap.sql` | Add `ghl_concurrency_cap` column. |
| `server/db/schema/organisations.ts` | Mirror column. |
| `scripts/seed-portfolio-health-playbook.ts` | New seeder. |
| `server/services/playbookEngineService.ts` | Honour `organisations.ghl_concurrency_cap` in bulk dispatch. |
| `server/skills/list_active_subaccounts.md` | New skill (or extend an existing reporting agent skill) that returns the subaccount enumeration. |
| `server/services/intelligenceSkillExecutor.ts` | Wire `list_active_subaccounts`. |

### Test plan

- Seed the template into a dev org with 3 fake subaccounts.
- Kick off a run, assert 3 child step runs are created and dispatched in parallel.
- Set `ghl_concurrency_cap = 2` and assert the engine queues the third child until one finishes.
- Assert the synthesis step receives results from all three.

### Risk

Low once P3.1 ships. The seeder and the new column are both additive. The risk is entirely in the dependency on P3.1's bulk mode behaving correctly.

### Verdict

**BUILD WHEN DEPENDENCY SHIPS (Sprint 4, immediately after P3.1).**

P3.2 is a thin layer over P3.1's bulk mode and lands in the same sprint. Order within Sprint 4:

1. P3.1 ships first (all four modes).
2. P3.1 validated with integration tests — bulk mode against 3 fake subaccounts succeeds.
3. Migration 0087 adds `ghl_concurrency_cap` to `organisations`.
4. `scripts/seed-portfolio-health-playbook.ts` seeds the system template.
5. `list_active_subaccounts` skill added (or existing skill extended) and wired in `intelligenceSkillExecutor.ts`.
6. `playbookEngineService` reads `ghl_concurrency_cap` when dispatching bulk children.

The two items could land in a single PR but are cleaner split: P3.1 is the generic mechanism, P3.2 is the first consumer.

---

## P3.3 — Structural trajectory comparison

### Goal

Replay an agent run against a reference trajectory and report any structural divergence — wrong tool called, wrong order, missing step. Catches regressions in agent behaviour automatically without LLM-as-Judge cost.

### Current state

- Trajectory **capture** is already done. Every tool call writes a row to `actions` keyed by `agentRunId`. Ordering by `(agentRunId, createdAt)` gives the trajectory for free.
- Structured tracing in `server/lib/tracing.ts` captures span and event sequences (`agent.loop.iteration`, `skill.action.proposed`, `skill.gate.decision`, etc.) — a second source of trajectory data, finer-grained than `actions`.
- No reference trajectories exist anywhere in the repo.
- No comparison tooling exists.

### Design

#### Reference trajectory format

JSON files under `tests/trajectories/`, one per workflow:

```json
{
  "$schema": "../../shared/iee/trajectorySchema.json",
  "name": "intake-triage-standard",
  "description": "Business analyst processes a standard intake item",
  "fixtureRunId": "fixture-intake-001",
  "matchMode": "in-order",
  "expected": [
    { "actionType": "read_workspace", "argMatchers": { "key": "intake_queue" } },
    { "actionType": "triage_intake" },
    { "actionType": "create_task", "argMatchers": { "priority": "medium" } }
  ]
}
```

Match modes:

- **`exact`** — actual sequence must equal expected, no extras. Highest stakes.
- **`in-order`** — actual contains expected in order, extras allowed between. Most flexible useful mode.
- **`any-order`** — actual contains all expected, order doesn't matter.
- **`single-tool`** — actual contains the named tool at least once. Smoke test.

`argMatchers` is an optional partial-equality check on tool args. Field-level: each key in the matcher must equal the corresponding key in the actual call. Missing keys are ignored.

#### Comparison service

`server/services/trajectoryService.ts`:

```ts
export const trajectoryService = {
  /** Reads the actions table for a run and returns the typed trajectory. */
  async loadTrajectory(runId: string): Promise<TrajectoryEvent[]> { ... },

  /** Compares actual against expected per the match mode. */
  compare(actual: TrajectoryEvent[], expected: ReferenceTrajectory): TrajectoryDiff { ... },

  /** Pretty-print a diff for CI output. */
  formatDiff(diff: TrajectoryDiff): string { ... },
};
```

The pure logic (`compare`, `formatDiff`) lives in `trajectoryServicePure.ts` per the P0.1 convention. The DB-touching `loadTrajectory` stays in the impure file.

#### CLI runner

`scripts/run-trajectory-tests.ts`:

1. Discover all `tests/trajectories/*.json` files.
2. For each, find the fixture agent run (or replay it via the test harness from P0.1, if a recording is available).
3. Load the trajectory, compare against the reference, format the diff.
4. Exit non-zero on any mismatch.

Wire into `npm test` via a new `test:trajectories` script. Run on every commit once enough references exist.

#### Initial reference set

Five trajectories to start (matches the roadmap):

1. `intake-triage-standard` — happy-path BA run on a standard intake.
2. `dev-patch-cycle` — dev agent + review_code → write_patch flow.
3. `qa-review-blocked` — QA verdict BLOCKED, agent retries (if P2.2 shipped).
4. `portfolio-health-3-subaccounts` — bulk Portfolio Health sweep (depends on P3.2).
5. `reporting-agent-morning` — daily reporting agent run.

Each is captured from a known-good live run on a fixture subaccount, then frozen as the reference.

### Files to change

| File | Change |
|---|---|
| `server/services/trajectoryService.ts` | New impure service (DB reads). |
| `server/services/trajectoryServicePure.ts` | New pure compare/format helpers. |
| `shared/iee/trajectorySchema.ts` | New Zod schema for reference trajectory format. |
| `tests/trajectories/*.json` | New. The 5 reference trajectories. |
| `scripts/run-trajectory-tests.ts` | New CLI runner. |
| `package.json` | Add `test:trajectories` script. |
| `server/services/__tests__/trajectoryService.test.ts` | New unit tests for `compare`/`formatDiff`. |

### Test plan

- Unit tests for each match mode against synthetic trajectories.
- Unit tests for `argMatchers` partial equality.
- Manual test: run the CLI against a known-good fixture, assert pass; perturb the fixture (delete one action), assert fail with the right diff.

### Risk

Low. New service, new files, no schema change, no production code touched. The only risk is the fixture management — keeping the reference trajectories in sync with the live agents requires discipline.

### Verdict

**BUILD WHEN DEPENDENCY SHIPS (Sprint 4, after P3.1 lands the bulk-mode fixture).**

P3.3 depends on P0.1 Layer 3 (already shipped in Sprint 1) and P1.2 capture (already shipped in Sprint 2). By Sprint 4 both prerequisites are in place. The remaining gating item is the Portfolio Health fixture — trajectory 4 in the initial set needs P3.2's bulk playbook to exist before a reference run can be captured.

Order within Sprint 4:

1. P3.1 and P3.2 ship first (to unblock the Portfolio Health fixture).
2. `trajectoryServicePure.ts` + unit tests land.
3. `trajectoryService.ts` (impure, DB-reading) lands.
4. `shared/iee/trajectorySchema.ts` Zod schema for the reference format.
5. CLI runner at `scripts/run-trajectory-tests.ts` wired into `test:trajectories`.
6. Five initial reference trajectories captured from known-good runs and committed:
   - `intake-triage-standard`
   - `dev-patch-cycle`
   - `qa-review-blocked`
   - `portfolio-health-3-subaccounts`
   - `reporting-agent-morning`

The comparison runs on every commit once the references exist. This is the first real structural test suite the platform has ever had — expect it to catch unexpected regressions immediately.

---

## P4.1 — Topics → Instructions → Deterministic Action Filter

### Goal

Narrow the agent's tool space *before* the LLM reasons, based on the intent of the current user message. Reduces hallucinated tool calls and gives operators a topic-level allowlist that's more meaningful than per-skill toggling.

### Current state

- `subaccountAgents.skillSlugs` provides a per-link allowlist of skills available to a given agent in a given subaccount. Already exists. Already enforced.
- No intent classification. The LLM sees the full allowlist regardless of what the user asked.
- No topic taxonomy on skills.

### Design

**Three pieces, plus staged-narrowing behaviour for safety:**

1. **Topic taxonomy.** Each `ActionDefinition` gains a `topics: string[]` field (added in P0.2 Slice B). Topics are short tags like `email`, `calendar`, `dev`, `reporting`, `intake`, `gh-integration`. A skill can belong to multiple topics. New skills declare their topics in the registry. **Skills with no topics are treated as universal** (visible in every classification bucket) so unclassified skills don't accidentally disappear.

2. **Intent classifier with confidence score.** A small classifier — keyword rules first, flash-model later if telemetry justifies — picks 1-2 topics for the current user message AND returns a `confidence: number (0.0-1.0)`. The output is `{ primaryTopic: 'reporting', secondaryTopic?: 'email', confidence: 0.85 }`.

3. **Staged narrowing — not hard removal by default.** This is the key change from the first version of this spec. The previous design said *"the filter is hard removal, not prompt instruction — the LLM cannot use a tool it doesn't see."* Hard removal is attractive in theory but carries real risk in practice:
   - Keyword classifiers misclassify compound asks (*"check the inbox then draft a patch"* → classified as `email`, `dev` filter loses `read_inbox`).
   - User intent shifts mid-thread (*"actually scrap that, can you write the report?"* → classifier locked in on stale intent).
   - Core fallback tools (*`ask_clarifying_question`*, *`read_workspace`*) should never disappear regardless of intent.
   - An agent that silently loses a tool it needs fails in a way that's very hard to debug from logs alone.

   **Staged narrowing replaces hard removal as the default behaviour:**

   ```ts
   const allowed = saLink.skillSlugs;
   const { topics, confidence } = await classifier.predictTopics(messages);
   const topicSkills = skillsMatchingTopics(topics);

   // Always present, regardless of classification:
   const coreFallbackSkills = [
     'ask_clarifying_question',   // must exist as a universal skill, see below
     'read_workspace',
     'search_codebase',
     'web_search',                 // if in the allowlist
   ].filter(s => allowed.includes(s));

   if (confidence >= HARD_REMOVAL_CONFIDENCE_THRESHOLD) {
     // High confidence — hard-remove non-matching tools (minus core fallbacks)
     const keep = new Set([...topicSkills, ...coreFallbackSkills]);
     activeTools = activeTools.filter(t => keep.has(t.name));
   } else {
     // Low confidence — soft narrowing: reorder + descriptions.
     // Matching tools appear first and get "(likely relevant)" in the tool description.
     // Non-matching tools stay visible but appear later with unchanged descriptions.
     // No tool is removed.
     activeTools = reorderToolsByTopicRelevance(activeTools, topicSkills, coreFallbackSkills);
   }
   ```

   `HARD_REMOVAL_CONFIDENCE_THRESHOLD = 0.85` in `limits.ts`. A keyword classifier will rarely hit that threshold in practice — which is intentional. Hard removal should be rare and deliberate, not the default.

4. **Core fallback skills — explicit universal-skill contract.**

   Previous drafts of this spec said "these skills stay in `activeTools` no matter what the classifier says" and then waved at "if the agent's allowlist doesn't contain one of these, it's skipped". That is not a contract — it's a hand-wave. Here is the concrete contract.

   **How a skill becomes universal:**

   `ActionDefinition` gains a new optional field in P0.2 Slice B (added to the list with `scopeRequirements`, `topics`, `requiresCritiqueGate`, `onFailure`, `isMethodology`):

   ```ts
   export interface ActionDefinition {
     // ... existing fields ...

     /**
      * P4.1 — universal skills are always available to every agent regardless
      * of the per-link `skillSlugs` allowlist, and always preserved through the
      * topic filter regardless of classifier output. Use sparingly — this is a
      * platform-wide override.
      */
     isUniversal?: boolean;
   }
   ```

   **The universal set, declared in the action registry:**

   The following skills set `isUniversal: true`. They are added to the action registry in Sprint 5 alongside the topic-filter work:

   - `ask_clarifying_question` — new skill added in Sprint 5 specifically as the graceful-degradation path. When topic narrowing or scope validation eliminates tools the agent needed, this skill lets the agent emit a clarification request instead of failing silently. `parameterSchema = z.object({ question: z.string(), blocked_by: z.enum(['topic_filter', 'scope_check', 'no_relevant_tool']).optional() })`. The handler writes the question to `agent_runs.summary`, marks the run `awaiting_clarification`, and emits a WebSocket event.
   - `read_workspace` — universal context access (reads `workspace_memories`).
   - `search_codebase` — universal read-only retrieval.
   - `web_search` — universal read-only retrieval.

   **How universal skills interact with `subaccountAgents.skillSlugs`:**

   Universal skills **merge into** the agent's effective allowlist at resolution time. They do NOT override it; they do NOT require the operator to add them explicitly. The merge happens in `skillService.getToolsForRun()`:

   ```ts
   const linkAllowlist = saLink.skillSlugs ?? agent.defaultSkillSlugs ?? [];
   const universalSkills = ACTION_REGISTRY
     .filter(a => a.isUniversal === true)
     .map(a => a.actionType);
   const effectiveAllowlist = Array.from(new Set([...linkAllowlist, ...universalSkills]));
   ```

   This means:
   - Every agent in every subaccount has access to `ask_clarifying_question`, `read_workspace`, `search_codebase`, `web_search` by default.
   - Operators cannot *remove* universal skills from an agent via the allowlist — a universal skill bypasses the allowlist entirely by design. This is a deliberate platform policy: there is no legitimate reason to prevent an agent from asking a clarifying question or reading its own workspace.
   - Operators CAN still block a universal skill via the policy engine (`policyRules` can set `decision = 'block'` on a universal skill for a specific subaccount). The universal merge only affects the allowlist; the policy engine still runs.

   **How the topic filter treats universal skills:**

   The topic filter's `coreFallbackSkills` array is derived from `ACTION_REGISTRY.filter(a => a.isUniversal === true).map(a => a.actionType)` at middleware construction time — it is NOT a hardcoded list in the filter middleware. This means adding a new universal skill in the action registry automatically propagates it into the topic filter's preserve list without touching middleware code.

   **What the topic filter does when the effective allowlist has zero tools matching the classified topic:**

   This is the scenario the hand-wave didn't cover. Explicit behaviour:

   ```
   effectiveAllowlist = [...linkAllowlist, ...universalSkills]
   topicMatches = effectiveAllowlist.filter(s => matchesClassifiedTopic(s))

   if (topicMatches.length === 0) {
     // Zero-match fallback: the classifier produced a topic the agent has no tools for.
     // This can happen legitimately (classifier is wrong) or catastrophically (agent
     // is misconfigured). We fail open to universal skills only + log the telemetry
     // row loudly.
     logTelemetry('topic_filter_zero_match', {
       runId, classifiedTopics, effectiveAllowlistSize, universalSkills
     });
     activeTools = activeTools.filter(t => universalSkills.includes(t.name));
   }
   ```

   The zero-match fallback gives the agent exactly the universal skills — no subject-specific tools at all. This is intentional: if the classifier confidently says "this is an `email` task" and the agent has no email tools, giving it random unrelated tools is worse than making it ask `ask_clarifying_question` to recover. The fallback is the primary reason `ask_clarifying_question` exists — it's the guaranteed-available escape hatch.

   Zero-match events are loud in telemetry (separate `topic_filter_zero_match` event name, not just a log line) so operators can review whether the classifier is over-aggressive or the allowlist is too narrow.

5. **Telemetry.** Every classification writes to `llmRequests.metadataJson.topic_filter`:
   ```json
   { "topics": ["reporting"], "confidence": 0.72, "mode": "soft", "removed": [], "preserved_core": [...] }
   ```
   After the feature ships, this telemetry is the feedback loop for deciding whether to switch the classifier from keyword rules to flash-model, and whether to adjust the hard-removal threshold.

6. **Tool-confidence escape hatch — coupling with P2.3.**

   Staged narrowing + universal-skill preservation + zero-match fallback together cover most classifier failure modes, but there is one remaining edge case: the classifier picks a topic with high confidence, the narrowed toolset contains at least one matching tool, but **no candidate tool call emitted by the LLM carries enough of its own confidence** to be trusted. The LLM is technically "choosing a tool from the narrowed set" but its own uncertainty signal says it's guessing. Letting the guess through is worse than asking.

   This coupling uses P2.3's `tool_intent` mechanism (from P2.3 Slice A, which ships in Sprint 3 — long before this P4.1 item in Sprint 5). Reminder of what P2.3 provides:

   - Every agent is prompted to emit a `tool_intent` block before every tool call with `{ tool, confidence, reasoning }`.
   - The `preTool` middleware already extracts the confidence value via `extractToolIntentConfidence(messages, toolName)` (pure helper in `agentExecutionServicePure.ts`).
   - P2.3 Slice B uses that confidence to upgrade auto→review at `CONFIDENCE_GATE_THRESHOLD = 0.7`.

   **P4.1 adds a second, lower threshold with a different remediation path:**

   ```ts
   // server/config/limits.ts
   export const MIN_TOOL_ACTION_CONFIDENCE = 0.5;  // below this, force clarification instead of execution
   ```

   **Decision matrix:**

   | Confidence | Behaviour |
   |---|---|
   | `>= 0.7` | Proceed normally. Policy engine's existing gate applies. |
   | `>= 0.5 and < 0.7` | Proceed but policy engine upgrades auto→review (P2.3 Slice B's existing behaviour). Reviewer decides. |
   | `< 0.5` | **Block the tool call, force `ask_clarifying_question` instead.** |

   **How the block-and-force mechanism works:**

   The `preTool` middleware (already modified by P1.1 Layer 3 to call `actionService.proposeAction`, already modified by P2.3 Slice B to read confidence) gets one more branch added in P4.1:

   ```ts
   // Inside preTool middleware, after P2.3's confidence extraction but before
   // actionService.proposeAction. This branch is added by P4.1 in Sprint 5.
   const confidence = extractToolIntentConfidence(messages, toolCall.name);

   if (confidence !== undefined && confidence < MIN_TOOL_ACTION_CONFIDENCE) {
     logTelemetry('tool_confidence_escape_hatch', {
       runId, toolCallName: toolCall.name, confidence, threshold: MIN_TOOL_ACTION_CONFIDENCE
     });

     // Skip the proposed tool call entirely and inject a message steering the
     // agent to ask_clarifying_question with a context prompt.
     return {
       action: 'skip',
       reason: `confidence_${confidence.toFixed(2)}_below_clarification_threshold`,
       injectMessage: `Your confidence for ${toolCall.name} was ${confidence.toFixed(2)}, below the ${MIN_TOOL_ACTION_CONFIDENCE} threshold required to execute. Call ask_clarifying_question to gather the information you need from the user before proceeding.`,
     };
   }

   // P2.3 Slice B's upgrade logic runs here
   // P1.1 Layer 3's proposeAction runs here
   ```

   The `skip` middleware action (added to the `preTool` middleware action union in P1.1 Layer 3) returns an error result to the LLM for the proposed tool, and `injectMessage` appends a user message telling the agent what to do next. The agent's next iteration reads the injected message and emits `ask_clarifying_question` with `blocked_by: 'low_confidence'` (a new value added to the skill's `blocked_by` enum in this sprint).

   **Why this is in P4.1, not P2.3:**

   P2.3's confidence gate sends the call to HITL review (human decides). P4.1's confidence gate sends the call to user clarification (user provides more context). They are different remediation paths for different failure modes:

   - **HITL review** is correct when the uncertainty is about whether the action is appropriate or authorised — a human with the right context can decide. Review queue has the decision authority.
   - **Clarification** is correct when the uncertainty is about what the user actually wants — the user is the source of truth, not the reviewer. Review queue can't answer.

   Having both coexist lets each remediation fire for its right failure mode. The `MIN_TOOL_ACTION_CONFIDENCE < CONFIDENCE_GATE_THRESHOLD` ordering ensures clarification fires before review upgrade when confidence is very low — you get clarified, then if still uncertain reviewed.

   **The reviewer's original scenario:**

   > User asks about billing, classified as "support", only support tools remain, but correct action was "ask clarification".

   Under this rule, the flow becomes:

   1. Classifier confidently picks `support` topic, narrows tools to the support subset + universal skills.
   2. LLM emits `tool_intent` for `create_support_ticket` with `confidence: 0.4` (because it's not actually sure this is the right move for a billing question).
   3. `preTool` middleware sees confidence < 0.5, blocks the call, injects clarification prompt.
   4. LLM next iteration calls `ask_clarifying_question` with `question: "Are you asking about a billing issue or looking for support on something else?"`.
   5. Run pauses at `awaiting_clarification`, user responds, run resumes with the correct context.
   6. The potentially-wrong `create_support_ticket` call never happens.

   This turns the system from "best guess executor" into "safe executor with explicit uncertainty awareness", exactly as the reviewer framed it.

   **Telemetry for tuning:**

   Every `tool_confidence_escape_hatch` event writes to `llmRequests.metadataJson.confidence_escape_hatch` with `{ toolCallName, confidence, threshold }`. After the feature ships, this telemetry drives three decisions:

   - Whether `MIN_TOOL_ACTION_CONFIDENCE = 0.5` is the right threshold (too low = unsafe, too high = annoying clarification spam).
   - Whether the LLM's `tool_intent` confidence is calibrated (or whether we need to rescale it).
   - Which specific tools attract disproportionately many low-confidence emissions (those tools may have unclear documentation, unclear invocation rules, or be poorly scoped).

   **Gate script:**

   A new static gate `verify-confidence-escape-hatch-wired.sh` asserts the `preTool` middleware contains the escape-hatch branch AND that `MIN_TOOL_ACTION_CONFIDENCE` is declared in `limits.ts` AND that `blocked_by: 'low_confidence'` is in the `ask_clarifying_question` skill's parameter schema. Ships in Sprint 5 alongside P4.1.

#### Classifier choice

Three options, in order of complexity:

- **Keyword rules.** Cheapest, deterministic. A YAML file maps regex patterns to topics. Easy to debug, easy to extend, no LLM cost. Recommended starting point.
- **Flash model.** Single fast call to a flash-tier model with a short prompt. Better generalisation. ~$0.0001/call.
- **Embedding similarity.** Embed the user message + each topic description, return top-k. Most accurate but adds infrastructure.

Start with keyword rules, instrument the classifier output to telemetry, and switch to a model if data shows the rules misclassify.

### `ask_clarifying_question` — behaviour contract

This is a new universal skill introduced by P4.1 and it deserves its own contract since the topic-filter zero-match fallback depends on it behaving predictably.

**What happens when an agent calls `ask_clarifying_question`:**

1. The skill executor invokes the handler at `server/tools/internal/askClarifyingQuestion.ts`. The handler:
   - Writes the question to `agent_runs.summary` (replacing any previous value — the last clarification wins).
   - Appends a `tool_result` message to `agent_run_messages` with `role: 'tool_result'` and `content: { question, blocked_by }` so the clarification is part of the trajectory for replay and trajectory comparison.
   - Transitions the agent run status from `running` to `awaiting_clarification` (new status; see status enum additions below).
   - Emits a WebSocket event `agent:run:awaiting-clarification` with `{ runId, question, blockedBy }` on the subaccount room.
   - Cancels any active `postTool` middleware processing for the current iteration and exits the loop cleanly (returns the equivalent of a `stop` middleware action).
2. The return value from the skill to the LLM is `{ success: true, status: 'awaiting_clarification', question }` — the agent sees confirmation that the question was recorded.
3. Because the loop exits after the skill fires, no further tool calls execute until the user responds.

**How the user responds:**

A new endpoint `POST /api/agent-runs/:id/clarify` accepts `{ answer: string }`. The handler:

1. Loads the run, asserts `status === 'awaiting_clarification'`.
2. Appends a new `role: 'user'` message to `agent_run_messages` with `content: answer`.
3. Transitions status back to `pending`.
4. Enqueues an `agent-run-resume` pg-boss job (reusing the P2.1 resume machinery) with `singletonKey: 'run:${runId}'`.

The resume path from P2.1 handles the rest — it loads the checkpoint, streams the updated message log (now including the clarification Q&A pair), and continues the loop.

**What `ask_clarifying_question` does NOT do:**

- It does **not** create a `reviewItem` or consume HITL queue capacity. This is not a review gate — it's an agent-initiated clarification that doesn't need human decision-making infrastructure. It uses a lighter-weight mechanism (the clarify endpoint + WebSocket event) specifically to keep it cheap.
- It does **not** block the whole subaccount's work. Other agents continue running. Only the specific run with `awaiting_clarification` status is paused.
- It does **not** require a permission set entry. Universal skills are platform-level and authorised by virtue of being in `ACTION_REGISTRY` with `isUniversal: true`.

### Files to change

| File | Change |
|---|---|
| `server/config/topicRegistry.ts` | **New.** Defines the topic taxonomy + keyword rules. |
| `server/services/topicClassifier.ts` | **New.** Impure wrapper — loads org-specific classifier config if needed. |
| `server/services/topicClassifierPure.ts` | **New.** Pure `classifyTopics(messages): { topics, confidence }`. Testable without DB. |
| `server/services/agentExecutionService.ts` | New `preCall` middleware that implements the staged-narrowing filter (reorder on low confidence, hard-remove on high confidence) with universal-skill preservation and zero-match fallback. |
| `server/services/skillService.ts` | Extend `getToolsForRun()` to merge `ACTION_REGISTRY.filter(a => a.isUniversal === true)` into the effective allowlist (see "Universal-skill contract" above). |
| `server/config/actionRegistry.ts` | Populate `topics` field on every entry (29 entries). Add **new entry** for `ask_clarifying_question` with `isUniversal: true`, `defaultGateLevel: 'auto'`, `isMethodology: false`, `actionCategory: 'api'`, empty `topics: []`. Also add `read_workspace`, `search_codebase`, `web_search` to the universal set (`isUniversal: true`). |
| `server/skills/ask_clarifying_question.md` | **New skill definition file.** Methodology section documents when to use (topic-narrowed out, scope-check failed, user intent unclear). `parameterSchema = z.object({ question: z.string().min(10).max(2000), blocked_by: z.enum(['topic_filter', 'scope_check', 'no_relevant_tool', 'missing_context']).optional() })`. |
| `server/tools/internal/askClarifyingQuestion.ts` | **New handler file.** Implements the behaviour contract above: writes to `agent_runs.summary`, appends to `agent_run_messages`, transitions status, emits WebSocket event, exits loop cleanly. |
| `server/services/skillExecutor.ts` | Add case for `ask_clarifying_question` that dispatches to the new handler. Because the skill is `isMethodology: false` and `defaultGateLevel: 'auto'`, it flows through the standard `actionService.proposeAction` path but auto-approves instantly. |
| `server/db/schema/agentRuns.ts` | Add `'awaiting_clarification'` to the `status` enum. |
| `server/routes/agentRuns.ts` | New endpoint `POST /api/agent-runs/:id/clarify` per the behaviour contract. |
| `server/websocket/emitters.ts` | New event emitter `emitAwaitingClarification(runId, question, blockedBy)`. |
| `client/src/pages/AgentRunDetailPage.tsx` (or equivalent) | Render the clarification question + a text input for the user to answer. On submit, POST to `/clarify`. |
| `server/services/__tests__/topicClassifier.test.ts` | New unit tests for keyword classifier + confidence scoring. |
| `server/services/__tests__/askClarifyingQuestion.test.ts` | New unit tests for the handler (status transitions, message append, event emission). |
| `server/config/__tests__/universalSkills.test.ts` | New unit test asserting `skillService.getToolsForRun()` merges universal skills into every allowlist, and that the topic filter's core-fallback list matches `ACTION_REGISTRY.filter(a => a.isUniversal === true)` at construction time. |

### Test plan

- Unit tests for the classifier on a corpus of representative user messages, including compound asks and mid-thread intent shifts.
- Unit tests for `ask_clarifying_question` handler: asserts `summary` is updated, `agent_run_messages` row is appended, status is `awaiting_clarification`, WebSocket event fires.
- Unit test for universal-skill merge: create an agent with a narrow allowlist, assert `getToolsForRun()` returns the allowlist ∪ universal skills.
- Unit test for zero-match fallback: stub the classifier to return a topic with zero matching tools, assert `activeTools` narrows to universal skills only and `topic_filter_zero_match` telemetry event fires.
- Integration test: an agent with a 20-skill allowlist receives a user message about "send my client a status update", classifier returns `email` + `reporting` with confidence 0.9, filter narrows to ~6 tools + the 4 universal skills.
- Manual test: deliberately misclassify (override the classifier) and verify the agent calls `ask_clarifying_question` instead of silently failing.
- Manual test: exercise the full clarify flow — agent emits question, UI shows the prompt, operator responds, run resumes and completes.

### Risk

Low-medium. The risk is mis-classification — if the classifier wrongly excludes tools the agent needs AND the classifier confidence is above the `HARD_REMOVAL_CONFIDENCE_THRESHOLD`, the agent's hand gets narrowed and it has to fall back to `ask_clarifying_question`. Mitigation:

- Default threshold `HARD_REMOVAL_CONFIDENCE_THRESHOLD = 0.85` means keyword rules rarely trigger hard removal. Low-confidence classifications stay in soft narrowing mode and keep all tools visible.
- `ask_clarifying_question` is always available as the escape hatch — the agent can never be left without a way to recover.
- Every classification logs `{ topics, confidence, mode, removed, preserved_core }` to `llmRequests.metadataJson.topic_filter`. Operators can tune the threshold from this telemetry.
- `topic_filter_zero_match` events fire loudly so operators see when the allowlist is structurally too narrow for a classified topic.

**No silent-failure risk.** The old draft's concern ("the agent fails silently because the tool isn't visible") is resolved by the `ask_clarifying_question` escape hatch plus the zero-match telemetry event.

### Verdict

**BUILD WHEN DEPENDENCY SHIPS (Sprint 5).**

The `topics` field on `ActionDefinition` ships in Sprint 1 via P0.2 Slice B. By Sprint 5 the prerequisite is long-since available. P4.1 lands as:

1. `server/config/topicRegistry.ts` defining the topic taxonomy and keyword rules.
2. Populate the `topics` field on all 29 `ACTION_REGISTRY` entries.
3. `topicClassifierPure.ts` (the keyword-matching logic) + unit tests.
4. `topicClassifier.ts` impure wrapper.
5. New `preCall` middleware in the agentic loop that filters `activeTools` by classified topics.
6. Telemetry hook logging classifier input + output to `llmRequests.metadataJson` for later analysis.

Start with the keyword classifier — it's cheapest and most debuggable. Swap to a flash-model classifier later if telemetry shows the rules misclassify.

The safety net: if classification returns zero topics (low confidence), the middleware falls through to the unfiltered allowlist. An agent can never have an empty tool set from this middleware — worst case is "filter did nothing".

---

## P4.2 — Shared memory blocks (Letta pattern)

### Goal

Named memory blocks that can attach to multiple agents with read-only or read-write permissions. Solves "all agents in this subaccount share the same brand voice" without copy-pasting `additionalPrompt`.

### Current state

- `workspaceMemories` is per-subaccount and per-agent already, but each row is a single piece of data — there is no concept of a "block" attached to multiple agents.
- `agents.additionalPrompt` is per-agent. To share text across agents you have to copy it.
- No primitive for "this block is shared between Agent A, Agent B, and Agent C; only Agent A can edit it".

### Design

#### Schema

Two new tables:

```sql
CREATE TABLE memory_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  subaccount_id uuid REFERENCES subaccounts(id), -- nullable for org-level blocks
  name text NOT NULL,                            -- e.g. 'brand_voice', 'client_context'
  content text NOT NULL,
  owner_agent_id uuid REFERENCES agents(id),    -- the only agent that can write
  is_read_only boolean NOT NULL DEFAULT true,   -- if true, even the owner cannot write at runtime
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE UNIQUE INDEX memory_blocks_org_name_idx
  ON memory_blocks (organisation_id, name)
  WHERE deleted_at IS NULL;

CREATE TABLE memory_block_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  block_id uuid NOT NULL REFERENCES memory_blocks(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES agents(id),
  permission text NOT NULL CHECK (permission IN ('read', 'read_write')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX memory_block_attachments_block_agent_idx
  ON memory_block_attachments (block_id, agent_id);
```

#### Read path

When `agentService.resolveSystemPrompt()` runs, it queries `memory_block_attachments` for the agent and merges all attached blocks into the system prompt after `additionalPrompt`:

```
[masterPrompt]
[additionalPrompt]
[memory blocks, in deterministic order by name]
```

The blocks appear as a clearly-marked section: `## Shared Context` followed by each block's name and content.

#### Write path

A new skill `update_memory_block` (gated, review by default) takes `{ blockName, newContent }` and updates the block. The skill validates:

- The current agent has a `read_write` attachment to the named block.
- The block's `owner_agent_id` matches the current agent (only the owner can edit, even with `read_write` permission).
- The block is not `is_read_only`.

Failures throw a structured `failure('memory_block_permission_denied', ...)`.

#### UX

A new admin page at `/admin/memory-blocks` for creating, editing, and attaching blocks. Per-org and per-subaccount scoping. The agent edit page gains a "Shared Context" tab listing the blocks attached to that agent.

### Files to change

| File | Change |
|---|---|
| `migrations/0088_memory_blocks.sql` | New tables. |
| `server/db/schema/memoryBlocks.ts` | New schema. |
| `server/db/schema/memoryBlockAttachments.ts` | New schema. |
| `server/services/memoryBlockService.ts` | New. CRUD + permission checks. |
| `server/services/agentService.ts` | Extend `resolveSystemPrompt()` to merge attached blocks. |
| `server/skills/update_memory_block.md` | New skill. |
| `server/services/skillExecutor.ts` | Wire `update_memory_block`. |
| `server/routes/memoryBlocks.ts` | New routes. |
| `client/src/pages/admin/MemoryBlocksPage.tsx` | New admin page. |
| `client/src/pages/AgentEditPage.tsx` (or equivalent) | New "Shared Context" tab. |

### Test plan

- Unit tests for permission checks.
- Integration test: create a block, attach to two agents, verify both see it in their system prompt; one edits, the other sees the update on the next run.
- Permission test: attempt to write a read-only block from the owner agent → fails; attempt to write a read-write block from a non-owner → fails.

### Risk

Medium. The schema is straightforward but the read path runs on every agent run start, so query performance matters. Mitigation: cache attachments per `agentId` for the duration of a run (`mwCtx.cachedMemoryBlocks`).

### Verdict

**BUILD IN SPRINT 5.**

P4.2 has no cross-item dependencies beyond the test harness from P0.1, which ships in Sprint 1. It could theoretically land as early as Sprint 2 but is scheduled in Sprint 5 alongside the other Phase 4 items to keep the agent master-prompt changes clustered in one review window.

Ships as a single coordinated PR:

1. Migration 0088 adds `memory_blocks` + `memory_block_attachments` tables.
2. Drizzle schemas.
3. `memoryBlockService.ts` with CRUD + permission checks.
4. `agentService.resolveSystemPrompt()` extended to merge attached blocks (cached per-run in `mwCtx.cachedMemoryBlocks`).
5. `update_memory_block` skill added to the registry and wired in `skillExecutor.ts`.
6. Admin routes at `/api/memory-blocks`.
7. Admin UI page at `client/src/pages/admin/MemoryBlocksPage.tsx`.
8. New "Shared Context" tab on the agent edit page.

The per-run cache is the only performance concern, and it's handled from day one by reading the attachments once at run start and stashing them in `MiddlewareContext`.

---

## P4.3 — Plan-then-execute for single-shot agent runs

### Goal

For high-stakes single-shot agent runs, separate planning from execution. The agent first emits a plan (a list of intended actions), the plan is persisted and inspectable, then the agent executes against the plan. Optionally gate execution behind plan approval.

### Current state

- Playbooks already do this — every step is planned in the template, executed by the engine. The whole DAG model *is* plan-then-execute.
- Single-shot agent runs do not. The agent just runs `runAgenticLoop()` and starts emitting tool calls immediately.
- The agentic loop does compute a `phase: 'planning' | 'execution' | 'synthesis'` value per iteration (`agentExecutionService.ts:1196-1208`), but the model isn't aware of it — the phase only affects routing and observability.

### Design

#### Two-phase loop for "complex" runs

A run is "complex" if any of:

- `agent.complexityHint === 'complex'` (new optional field).
- The user message exceeds N words.
- The agent's allowlist exceeds N skills.

For complex runs, the agentic loop has a new initial step *before* iteration 0:

1. Call the LLM with a planning system prompt: *"Output a JSON plan describing the actions you intend to take. Do NOT execute any tools yet. Your response must be a `plan` object with an `actions` array."*
2. Parse the plan, persist to a new column `agent_runs.plan_json`.
3. Emit a WebSocket event `agent:run:plan` with the plan for the UI.
4. If the run is part of a `supervised`-mode playbook (P3.1), pause and require human approval of the plan via the existing review queue.
5. Begin the normal execution loop, with the plan injected as a system reminder so the agent stays anchored.

#### Replanning on failure

If a tool call fails in a way that violates the plan (e.g. the plan said `update_task` but the agent now realises it needs to `create_task`), the loop gives the agent one chance to revise the plan. The revised plan is persisted as a new version.

### Files to change

| File | Change |
|---|---|
| `migrations/0089_agent_runs_plan.sql` | Add `plan_json jsonb` column to `agent_runs`. |
| `server/db/schema/agentRuns.ts` | Mirror column. |
| `server/services/agentExecutionService.ts` | Add planning prelude for complex runs. Integrate with playbook supervised mode. |
| `server/services/agentExecutionServicePure.ts` | Add `parsePlan(content)` and `isComplexRun(...)`. |
| `client/src/pages/AgentRunDetailPage.tsx` (or equivalent) | New "Plan" panel showing the plan + execution status against it. |
| `server/services/__tests__/agentExecutionService.plan.test.ts` | New tests. |

### Test plan

- Unit tests for `parsePlan` (valid plan, malformed JSON, empty plan).
- Unit tests for `isComplexRun` (boundary cases on word count, skill count).
- Integration test: a complex run produces a plan, the plan is persisted, the run executes against it.
- Integration test: in supervised mode, the run pauses at the plan and resumes on approval.

### Risk

Medium. Planning is an extra LLM call per run, which adds cost and latency. Mitigation: only "complex" runs get a planning phase (default heuristic excludes most runs); the threshold is configurable per-org.

### Verdict

**BUILD WHEN DEPENDENCY SHIPS (Sprint 5, after P3.1 ships in Sprint 4).**

Sprint 5 is the natural home for P4.3 — P3.1's supervised mode landed in Sprint 4, so the supervised-approval integration is ready to wire. Ships as:

1. Migration 0089 adds `plan_json` column to `agent_runs`.
2. `isComplexRun(request)` and `parsePlan(content)` added to `agentExecutionServicePure.ts` with unit tests.
3. New planning prelude in `runAgenticLoop()` — runs before iteration 0 when `isComplexRun()` returns true.
4. `agent.complexityHint` optional column on `agents` table (or reuse an existing config field).
5. WebSocket event `agent:run:plan` emitted when a plan is persisted.
6. Supervised-mode branch in the playbook engine pauses on plan approval via the existing review queue flow.
7. New "Plan" panel on the agent run detail page showing plan + execution progress.
8. Replanning-on-failure logic (one revision allowed per run).

Threshold defaults for "complex" — pick starting values, instrument them, tune from telemetry:

- `agent.complexityHint === 'complex'` (explicit opt-in)
- User message word count > 300
- Agent allowlist skill count > 15

---

## P4.4 — Semantic Critique Gate (shadow mode)

### Goal

Catch semantically wrong (but syntactically valid) tool calls that the existing schema validator misses. A flash-tier model evaluates the agent's tool call output against a minimal rubric and flags disagreement. Initially shadow mode (log only); flip to active rerouting only after data justifies the cost.

### Current state

- The schema-level critique gate is **already done** at `agentExecutionService.ts:1191`, with the cascade at `:1391` retrying with the frontier model when economy-tier produces invalid tool calls.
- The cascade only catches syntax errors (unknown tool, missing required field, malformed input). It cannot catch a semantically wrong call (e.g. emailing the wrong recipient, applying a patch with the wrong logic).
- `llmRequests` already tracks `wasEscalated`, `escalationReason`, model, tier, cost — perfect substrate for shadow-mode telemetry.

### Design

#### Shadow-mode middleware

A new middleware in a new pipeline phase: `postCall` (after the LLM responds, before the tool calls execute). Activates only when:

- `phase === 'execution'` (so we're not gating planning or synthesis)
- `response.routing.wasDowngraded === true` (so we only check economy-tier outputs)
- `actionDef.requiresCritiqueGate === true` (opt-in flag from P0.2 Slice B)

When all three conditions match, fire one flash-tier LLM call:

```
You are a critique gate. The agent is about to call a tool.
Tool: {toolName}
Args: {toolArgs}
Context: {last 3 messages}
Question: Is this tool call coherent with the user's request?
Answer with JSON: { "verdict": "ok" | "suspect", "reason": "..." }
```

The critique result is written to `llmRequests.metadataJson.critique_gate_result` for the original LLM request. **The tool call is not blocked** — this is shadow mode.

#### Active mode (gated, requires data)

After 2-4 weeks of shadow-mode data, query the rate of `verdict === 'suspect'` per tool. If the rate justifies the cost (rough heuristic: > 5% suspect rate AND the suspects correlate with downstream HITL rejections), flip a per-tool flag `requiresCritiqueGate.activate = true` and the middleware starts rerouting suspects to the frontier model via the existing cascade path.

### Files to change

| File | Change |
|---|---|
| `server/services/agentExecutionService.ts` | New `postCall` middleware phase. New `critiqueGateMiddleware`. |
| `server/services/middleware/critiqueGate.ts` | New. Shadow-mode logic. |
| `server/services/middleware/critiqueGatePure.ts` | New. Result-parsing helpers. |
| `server/services/__tests__/critiqueGate.test.ts` | New unit tests. |
| `server/services/llmRouter.ts` | Optionally accept a `parentRequestId` to associate the critique call with the original. |
| `server/db/schema/llmRequests.ts` | No schema change — `metadataJson` already exists. |
| `server/config/limits.ts` | Add `CRITIQUE_GATE_SHADOW_MODE = true` (env-overridable). |

### Test plan

- Unit tests for the critique result parser.
- Manual test: tag one production action with `requiresCritiqueGate: true`, run an agent through it on a fixture subaccount, verify the critique result appears in `llmRequests.metadataJson` without the actual tool execution being affected.

### Risk

Low (in shadow mode). The middleware is opt-in via the `requiresCritiqueGate` flag, so it only fires for actions explicitly marked. Cost is bounded — one extra flash call per gated action. Active mode is higher risk and is explicitly deferred.

### Verdict

**BUILD WHEN DEPENDENCY SHIPS (Sprint 5).**

Both prerequisites (`requiresCritiqueGate` flag from P0.2 Slice B, test harness from P0.1) landed in Sprint 1. P4.4 ships in Sprint 5 alongside the other Phase 4 items. This item keeps its feature-flag-like guard — not because the code is risky, but because it genuinely needs the shadow-mode data-collection period before being flipped to active:

1. New `postCall` middleware phase added to the agentic loop pipeline.
2. `critiqueGatePure.ts` with result-parsing helpers + unit tests.
3. `critiqueGate.ts` middleware in shadow mode — logs to `llmRequests.metadataJson.critique_gate_result`, does NOT reroute.
4. `CRITIQUE_GATE_SHADOW_MODE = true` constant in `limits.ts`. This is the one flag that survives the pre-production simplification because it genuinely guards a data-collection mode, not a rollout.
5. Tag 3-5 high-stakes actions (`send_email`, `write_patch`, `create_pr`, `trigger_account_intervention`) with `requiresCritiqueGate: true` to start generating shadow-mode data.
6. Telemetry dashboard query (via Langfuse or a dedicated report) showing disagreement rate by tool slug.

The active-mode flip (`CRITIQUE_GATE_SHADOW_MODE = false`, reroute suspects via frontier cascade) is **not scheduled in this roadmap**. It waits on 2-4 weeks of disagreement-rate data from shadow mode. When that data justifies active mode, the flip is a one-line config change that the user can authorise at the time.

---

## Phase 5 — Deferred items

These items are not implementable now because they depend on signals that don't exist yet. Each has an explicit trigger condition. **They are listed so they don't get rediscovered as "new ideas" later.**

### P5.1 — ElevenLabs-style tool execution timing modes

**Trigger to build:** voice integration work begins. Per-skill `executionTiming: 'immediate' | 'post_message' | 'async'` mainly matters for conversational UX. Limited value until the platform has a voice agent story.

**Why deferred:** building a feature for a use case that doesn't exist yet creates dead code that has to be maintained.

**Verdict: DEFER — AWAITING SIGNAL.**

### P5.2 — Per-skill fallback cascade (different skill on failure)

**Trigger to build:** P3.3 trajectory comparison surfaces recurring failure modes where a *different skill* would have worked.

**Why deferred:** the existing provider fallback chain (`PROVIDER_FALLBACK_CHAIN` in `server/config/limits.ts`), the economy→frontier cascade, `withBackoff`, and `TripWire` already cover the real failure modes the codebase has seen. P0.2 Slice B partially addresses this with the `onFailure: 'fallback'` directive (per-action fallback values). A full cross-skill cascade is the next step **if** justified. No data justifies it today.

**Verdict: DEFER — AWAITING SIGNAL.**

### P5.3 — Workforce Canvas visual DAG

**Trigger to build:** users explicitly ask for visual playbook authoring.

**Why deferred:** Playbook Studio's chat-driven authoring is the more modern pattern and is already shipped. Visual DAG authoring is a nice-to-have, not a differentiator. Building it speculatively creates two competing authoring experiences that have to be kept in sync.

**Verdict: DEFER — AWAITING SIGNAL.**

### P5.4 — Separate QA system agent for the reflection loop

**Trigger to build:** P2.2 ships and measurement shows the self-review approach has a quality ceiling that a distinct critic persona would break through.

**Why deferred:** `review_code` is already structured as if it were a critic role. The hypothesis that a separate persona materially improves outcomes is unproven. Build P2.2 first, measure for 4-6 weeks, then decide.

**Verdict: DEFER — AWAITING SIGNAL.**

### P5.5 — LLM-as-Judge for trajectory eval

**Trigger to build:** P3.3 structural comparison ships and a specific failure class needs subjective evaluation that structural comparison cannot catch.

**Why deferred:** LLM-as-Judge is expensive to run continuously, hard to calibrate, and prone to known biases (confirmation, position, model-family). Structural trajectory comparison captures most of the value at a fraction of the cost. Add LLM-as-Judge only if a real failure class requires it.

**Verdict: DEFER — AWAITING SIGNAL.**

---

## Testing strategy

### What actually exists today

An audit of the repo shows a deliberate testing posture: heavy investment in static analysis, minimal runtime testing.

| Layer | What exists | Count |
|---|---|---|
| **Static gate scripts** (bash, grep-based structural lints) | `scripts/verify-*.sh` — every async route uses `asyncHandler`, every org-scoped query uses `req.orgId`, every schema has `organisationId`, etc. | 24 scripts |
| **QA spec scripts** (bash, check-list style) | `run-all-qa-tests.sh`, `run-paperclip-features-tests.sh`, `run-spec-v2-tests.sh`, `run-all-gates.sh` — 113+ lines of grep-based "does this file/field/function exist" assertions per spec chunk. | 4 scripts |
| **Runtime unit tests** (tsx, ad-hoc assertions) | `server/lib/playbook/__tests__/playbook.test.ts`, `server/services/__tests__/runContextLoader.test.ts` | **2 files** |
| **Frontend tests** | None. No Vitest. No Jest. No React Testing Library. No `*.test.tsx`. | 0 |
| **API contract tests** | None. Route shape covered indirectly by static gates. | 0 |
| **E2E tests of the app** | None. `playwright` **is** installed as a runtime dependency, but only for the IEE browser worker and for the `run_playwright_test` agent skill (which lets agents test the **customer's** app). No `playwright.config.ts` at the repo root, no `e2e/` directory, no tests of Automation OS itself. | 0 |

This is a deliberate bet on **static analysis over runtime tests** and it's the right bet for a rapidly-evolving codebase. Static gates catch structural regressions without breaking when behaviour changes — runtime tests break every time a feature evolves.

### Testing posture for the current phase (rapid evolution)

The platform is pre-production and the feature set is still evolving rapidly. A full multi-phase testing environment (backend / frontend / API / E2E) is the wrong investment right now — tests against rapidly-evolving features become maintenance burden faster than they add safety.

**The principle: invest in tests that don't break when features change, skip tests that do.**

Concretely, this roadmap adopts five rules for the current phase:

1. **Static gates stay the primary investment.** Every major structural change in this roadmap gets a new `verify-*.sh` script. These are cheap, fast, deterministic, and don't break when behaviour changes — they only break when structure drifts, which is exactly what should trigger a test failure. See "New static gates" below for the specific scripts per sprint.

2. **Runtime unit tests are for pure logic only.** Follow the existing `*Pure.ts` + `*.test.ts` convention. Test anything that parses, normalises, compares, or transforms data. **Do not** unit-test services, routes, or middlewares — they change too often to be worth the maintenance.

3. **Exactly one runtime smoke test** across the whole roadmap. A single "agent hello world" integration test that dispatches a trivial agent run against a fixture subaccount with the LLM stubbed, walks the full middleware pipeline, and asserts the run completes. <5s runtime, catches catastrophic breakage immediately, near-zero maintenance because it exercises the happy path only.

4. **P1.2 regression capture is the long-game test suite.** Every HITL rejection is converted to a replayable test case automatically. Zero upfront investment; compounds with usage. This is the platform's version of property-based testing — the users generate the test oracle by correcting the agents.

5. **No frontend, API, or E2E tests** written as part of this roadmap. Skip entirely. TypeScript type-checking + the static gates are the coverage for those layers during rapid evolution. Revisit in the "phase 2" posture below.

### What that means concretely (per-item test plan consolidation)

Every per-item `Test plan` section above is still valid — but many of them are smaller than they look once the five rules above are applied. Here is the consolidated test surface after filtering:

**Pure-logic unit tests** (follow `*Pure.ts` + `*.test.ts` convention):

- P0.1 Layer 3 extraction: `agentExecutionService.phase.test.ts`, `validateToolCalls.test.ts`, `middlewareContext.test.ts`
- P0.2 Slice A: `actionRegistry.test.ts` (parses every entry as Zod, asserts shape)
- P1.1 Layer 2: `scopeAssertion.test.ts`
- P1.2 Capture: `regressionCapture.test.ts` (idempotency of the capture hook)
- P2.1: `checkpoint.test.ts` (serialise/deserialise round-trip on the extracted pure helper)
- P2.2: `reflectionLoopPure.test.ts` (`parseVerdict` regex against real `review_code` outputs)
- P2.3 Slice A: `toolIntent.test.ts` (`extractToolIntentConfidence`)
- P3.3: `trajectoryServicePure.test.ts` (match modes + argMatchers)
- P4.1: `topicClassifier.test.ts` (keyword rules against representative messages)
- P4.3: `plan.test.ts` (`parsePlan`, `isComplexRun`)
- P4.4: `critiqueGatePure.test.ts` (result parser)

Total new unit test files: **11**. All are small, pure-logic, and stable.

**New static gate scripts** (bash, grep-based):

| Sprint | New gate | What it checks |
|---|---|---|
| 1 | `verify-action-registry-zod.sh` | Every `ACTION_REGISTRY` entry uses Zod, none uses legacy `ParameterSchema` shape. |
| 1 | `verify-pure-helper-convention.sh` | Every `*.test.ts` file has a sibling `*Pure.ts` import. |
| 1 | `verify-idempotency-strategy-declared.sh` | Every `ACTION_REGISTRY` entry declares `idempotencyStrategy: 'read_only' \| 'keyed_write' \| 'locked'` (enforces the Execution Model contract). |
| 2 | `verify-rls-coverage.sh` | Every protected table in `rlsProtectedTables.ts` has a `CREATE POLICY` in `migrations/`. |
| 2 | `verify-rls-contract-compliance.sh` | No raw `db.select(...)` / `db.insert(...)` calls outside services or outside the ALS wrapper. Enforces Layer A of the RLS execution contract. |
| 2 | `verify-scope-assertion-callsites.sh` | Every known retrieval boundary calls `assertScope()` or is on an explicit allowlist. |
| 2 | `verify-pretool-middleware-registered.sh` | `proposeAction` is no longer called from per-case blocks in `skillExecutor.ts` — it lives in the `preTool` middleware only. |
| 2 | `verify-job-idempotency-keys.sh` | Every new `boss.send('...')` call includes a `singletonKey` option. Enforces the job idempotency contract. |
| 3 | `verify-reflection-middleware-registered.sh` | `reflectionLoopMiddleware` is in `pipeline.postTool`. |
| 3 | `verify-middleware-state-serialised.sh` | Every field on `MiddlewareContext` has a matching field on `SerialisableMiddlewareContext` (or is marked `// ephemeral:`). Enforces Rule 2 of the checkpoint persistence contract. |
| 3 | `verify-run-state-source-of-truth.sh` | No new code reads `agent_run_snapshots.toolCallsLog` directly except the one allow-listed debug UI file. Prevents drift during the `toolCallsLog` deprecation window. |
| 4 | `verify-playbook-run-mode-enforced.sh` | `playbookEngineService` branches on `runMode` per tick. |
| 5 | `verify-critique-gate-shadow-only.sh` | `CRITIQUE_GATE_SHADOW_MODE = true` and no callsite routes based on gate result. |
| 5 | `verify-confidence-escape-hatch-wired.sh` | The `preTool` middleware contains the escape-hatch branch, `MIN_TOOL_ACTION_CONFIDENCE` is declared in `limits.ts`, and `blocked_by: 'low_confidence'` is in the `ask_clarifying_question` schema. |

Total new static gates: **14**. Each is <30 lines of bash, checks one structural invariant, near-zero maintenance.

The gate count grew from the initial "8" count as later spec iterations added cross-cutting contracts (Execution Model, RLS execution contract, middleware persistence contract, tool-confidence escape hatch). Each added contract brought its own enforcement gate — which is why gates are the right primary investment: they're cheap to add and each one prevents a specific class of regression.

**The one runtime smoke test:**

- `server/services/__tests__/agentExecution.smoke.test.ts` — created in Sprint 1, exercised by every subsequent sprint. Uses the P0.1 LLM stub. Dispatches a minimal agent run against a fixture subaccount with one stub response. Asserts: run reaches `completed`, all middleware phases ran in order, no scope violations, no uncaught errors. Updated in each sprint to add one line of new-behaviour coverage (e.g. Sprint 3 adds "reflection middleware fires when `write_patch` comes before `review_code`").

**Three mandatory integration tests** (carved out as exceptions to the "skip integration tests" rule because they cover hot-path behaviour where static gates alone are insufficient):

These are the only integration tests added by this roadmap. Each targets a specific high-risk item where a silent correctness bug would cause a P0 incident and the behaviour is inherently cross-component (can't be unit-tested meaningfully).

**I1: `rls.context-propagation.test.ts` (Sprint 2, ships with P1.1).**

Covers the RLS execution contract end to end. Uses the existing tsx convention, loads fixtures from `loadFixtures()`, asserts the contract holds across all three access paths.

Test cases:
1. **HTTP request path.** Fake an HTTP request bound to `fixture-org-001`, call `taskService.list()`, assert only `fixture-org-001` rows come back even though the fixture DB contains rows for a second org.
2. **Wrong-org spoof.** Same request but with `req.orgId` deliberately mutated mid-request to the second org. Assert the orgScoping middleware catches it (transaction was opened with the original org; mutation has no effect) OR the RLS policy blocks it (query returns zero rows). Either outcome is acceptable; both together is the defence-in-depth guarantee.
3. **Missing org context.** Call a service directly without opening a transaction. Assert `failure('missing_org_context', ...)` is thrown before any DB hit.
4. **Background job path.** Enqueue a fake pg-boss job with `{ organisationId: 'fixture-org-001' }`, run the handler, assert it can read `fixture-org-001` data and cannot read the second org's data.
5. **Admin bypass.** Call `withAdminConnection()`, assert it can read both orgs' data, assert it writes an `audit_events` row.

**I2: `agentRun.crash-resume-parity.test.ts` (Sprint 3, ships with P2.1).**

Covers deterministic resume from checkpoint. Proves the crash-point doesn't matter and the resumed run produces the same output as an uninterrupted run.

Test cases:
1. **Round-trip parity.** Run a fixture agent task uninterrupted with the LLM stub, capture the final state. Run it again, force a crash (throw mid-iteration), resume from checkpoint, assert the final state is byte-equal to the uninterrupted run.
2. **Kill-point matrix.** Run the same task three times, each crashing at a different checkpoint boundary: (a) after iteration 2, (b) after a tool call but before the next LLM call, (c) mid-`preTool` middleware execution. All three resumed runs must produce the same final state as the uninterrupted baseline.
3. **Config-snapshot enforcement.** Run a task, pause mid-run, mutate the agent's `additionalPrompt` in the DB, resume. Assert the resume uses the snapshot (old prompt), NOT the mutated version. Assert `resumeWithLatestConfig: true` endpoint does use the new prompt and writes an audit event.
4. **HITL async resume.** Run a task that hits a `review` gate, process exits, human approves via the API, new process picks up the `agent-run-resume` job, assert the run continues from the approved point.

**I3: `playbookBulk.parent-child-idempotency.test.ts` (Sprint 4, ships with P3.1 bulk mode).**

Covers the bulk-dispatch fan-out path and the retry semantics that go with it.

Test cases:
1. **Fan-out and synthesis.** Dispatch a bulk playbook against 3 fake subaccounts, assert 3 child runs are created, each independently executes its steps, synthesis step waits for all three and receives the right outputs.
2. **Child retry idempotency.** Force one child to fail with a retryable error, let pg-boss retry, assert the child produces exactly one completed run and exactly one completion event (no duplicate side effects). Keyed on `(parent_run_id, target_subaccount_id)`.
3. **Parent retry idempotency.** Kill the parent mid-dispatch, restart, assert the parent doesn't re-dispatch the children that were already dispatched (keyed on parent idempotency + target subaccount).
4. **Concurrency cap.** Set `organisations.ghl_concurrency_cap = 2`, dispatch against 5 targets, assert the engine queues the third+ children until earlier ones complete. Assert no more than 2 are in-flight at any time.
5. **Failure propagation.** Force one child to fail non-retryably, assert the parent still completes the other children and marks itself `partial` (not `failed`) with a structured summary.

Each of these 3 tests is a single file, uses the existing tsx convention, uses the `loadFixtures()` helper, uses the LLM stub from P0.1 Layer 2, and targets <30 seconds runtime. They run via the same `npm run test:unit` discovery (they live under `__tests__/` like the unit tests) but are tagged `integration` in their filename so they can be filtered if runtime becomes a concern.

**What is explicitly NOT added as part of this roadmap:**

- Composition tests for middleware interactions beyond the 3 integration tests above (static gate covers registration; happy path covered by the smoke test)
- Frontend unit tests
- Frontend integration tests (MSW-style)
- React Testing Library setup
- API contract tests (supertest or equivalent)
- E2E tests of the Automation OS app (Playwright or otherwise)
- Migration safety tests (no data to migrate — dev environment)
- Performance baselines (performance doesn't matter at this stage)
- Load tests (same reason)
- Adversarial security tests beyond what the static gates and I1 catch (`verify-rls-coverage.sh` + `I1` are the primary defence)
- Resilience / chaos tests for P2.1 beyond I2's kill-point matrix

Each of these is a real category that a mature testing strategy would include. They are deliberately excluded from the current phase because the cost-to-value ratio is wrong for rapidly-evolving code. The 3 integration tests above are the carved-out exceptions — targeted, bounded, and tied to items where a silent correctness bug is the failure mode.

### Fixture specification (minimal)

One fixture set for the whole roadmap, loaded by the smoke test and referenced by any other test that needs a real-looking agent run:

- **1 fixture organisation** (`fixture-org-001`)
- **2 fixture subaccounts** under that org (`fixture-sub-001`, `fixture-sub-002`) — two, not one, so cross-tenant tests are possible
- **1 fixture agent** per subaccount (same agent definition, linked twice) — so shared memory block tests in P4.2 have two agents to attach to
- **1 fixture task** on `fixture-sub-001`
- **3 fixture `review_code` outputs** (APPROVE, BLOCKED, malformed) used by P2.2 pure tests

Fixtures live in `server/services/__tests__/fixtures/` and are loaded via a single helper `loadFixtures()` from the smoke test file. Nothing more elaborate until the app stabilises.

### Phase 2 testing posture (once features stabilise)

The trigger to move to a heavier testing posture is **per-feature, not per-calendar**: when a specific feature has been stable for 4+ weeks and is no longer evolving rapidly, it becomes a testing candidate. Not before.

When features start stabilising, the plan is:

1. **Frontend unit tests (React Testing Library)** for stable UI surfaces — start with Layout, auth flows, the agent edit page, anything that hasn't changed in 4+ weeks.
2. **API contract tests (supertest)** for stable endpoints — start with auth, org management, subaccount resolution, the plumbing routes.
3. **Real E2E tests with Playwright against critical flows** — create `e2e/` at the repo root, point a new `playwright.config.ts` at the dev server, write 5-10 tests for the flows that absolutely cannot break: login, task creation, HITL approval, triggering an agent run. Keep the count small on purpose.
4. **Activate the P1.2 regression suite** — by then it has meaningful volume. Turn on the weekly cron from P1.2.
5. **Performance baselines** — once performance actually matters, add baselines for the hot paths (`runAgenticLoop` iterations/second, `policyEngineService.evaluatePolicy` p99, `resolveSystemPrompt` with memory-block merge).
6. **Frontend integration tests with MSW** — once the API surface is stable enough that mocking it isn't a daily chore.
7. **Decide whether to introduce Vitest.** Only if the `tsx` + static-gate pattern starts genuinely breaking down — not because "proper frameworks". The current convention is fine for its job and switching costs are real.

Phase 2 is **not** in this roadmap's scope. It's documented here so the decision to add it is a conscious phase transition, not a "we forgot".

---



Every scheduled item in one place. Each sprint is a coherent chunk of work that can be reviewed as a unit. Sprints are sized for review-ability, not calendar time — a "sprint" here is a logical grouping that can ship as 2-4 related PRs.

### Sprint 1 — Foundations

**Goal:** Everything downstream depends on test harness + typed action registry. These two items land first and unblock every other sprint.

| # | Item | Notes |
|---|---|---|
| 1 | P0.1 Layer 1 | npm script, bash runner, convention doc. 30 minutes of pure plumbing. |
| 2 | P0.1 Layer 3 | Extract `selectExecutionPhase`, `validateToolCalls`, `buildMiddlewareContext` from `agentExecutionService.ts` into `agentExecutionServicePure.ts`. Ship with unit tests. |
| 3 | P0.1 Layer 2 | `llmStub.ts` for test injection. Cheap to add, starts being used in Sprint 3. |
| 4 | P0.2 Slice B | Add optional `scopeRequirements`, `topics`, `requiresCritiqueGate`, `onFailure`, `fallbackValue` fields to `ActionDefinition`. Zero-risk, unblocks Phase 4. |
| 5 | P0.2 Slice A | Convert `ParameterSchema` to Zod. Run `scripts/dump-tool-schemas.ts` before + after, diff every entry, ship only if Anthropic-compatible. |
| 6 | P0.2 Slice C | Error directives wired in `skillExecutor.ts`. Tested against the new harness. |

**Sprint 1 gate:** `npm test` runs `test:gates`, `test:qa`, and `test:unit`. All green.

**Exit criteria:** Every subsequent sprint can assume: (a) tests exist and run in CI, (b) pure helpers are extractable from `agentExecutionService.ts`, (c) `ActionDefinition` has the fields later items need.

---

### Sprint 2 — Trust foundation (multi-tenant hardening + learning loop)

**Goal:** Data isolation is defence-in-depth. Every rejection turns into a regression test.

| # | Item | Notes |
|---|---|---|
| 7 | P1.1 Layer 3 | Universal before-tool hook in `preTool` middleware. Removes per-case wrappers in `skillExecutor.ts`. Migration 0082 adds `tool_call_security_events` table. |
| 8 | P1.1 Layer 2 | `scopeAssertion.ts` helper + call sites in `runContextLoader`, `workspaceMemoryService`, `taskAttachmentContextService`, `agentService.resolveSystemPrompt`. Adds `scope_violation` to `FailureReason` enum. |
| 9 | P1.1 Layer 1 | `orgScoping` middleware + migrations 0079-0081 enabling RLS on 10 protected tables. `verify-rls-coverage.sh` gate script. |
| 10 | P1.2 Capture | Migration 0083 adds `regression_cases` table. `regressionCaptureService` hooked into `reviewService.recordDecision()`. Starts capturing from day one. |
| 11 | P1.2 Replay | `scripts/run-regression-cases.ts` CLI runner. Monthly cron wired. Per-org cost budget enforced via `runCostBreaker`. |

**Sprint 2 gate:** `verify-rls-coverage.sh` passes. `scope_violation` test fires correctly on a deliberate cross-tenant query. `regression_cases` rows are written on the next HITL rejection.

**Exit criteria:** Multi-tenant boundary is enforced at three independent layers. Every review rejection creates a test case automatically.

---

### Sprint 3 — Reliability (the agentic loop gets opinionated)

**Goal:** The loop gets three independent improvements that all reinforce each other — deterministic reflection, explicit confidence, and crash-safe resume.

| # | Item | Notes |
|---|---|---|
| 12 | P2.2 | Reflection loop middleware. Small, independent. Blocks `write_patch` / `create_pr` without `APPROVE` from `review_code`. Escalates after 3 iterations. |
| 13 | P2.3 Slice A | `tool_intent` convention in agent prompt template + `extractToolIntentConfidence()` pure helper. |
| 14 | P2.3 Slice B | Migration 0085 adds `confidence_threshold` + `guidance_text` to `policy_rules`. Confidence upgrade logic in `policyEngineService.evaluatePolicy()`. |
| 15 | P2.3 Slice C | `getDecisionTimeGuidance()` in the policy engine. `preTool` middleware injects guidance as `<system-reminder>` blocks. |
| 16 | P2.1 | Migration 0084 adds `checkpoint` column to `agent_run_snapshots` **and** creates `agent_run_messages` with RLS policy in the same SQL file. `persistCheckpoint()` writes after **each completed tool call** (per-tool-call, not per-iteration — see Execution Model section). `resumeAgentRun()` uses `configSnapshot` by default, live config via audited admin override only. Inner tool-call loop refactored to one-at-a-time with per-tool checkpoint writes. `hitlService` refactored from blocking-wait to enqueue-on-decide. New `agent-run-resume` pg-boss job with `singletonKey: 'run:${runId}'`. `SerialisableMiddlewareContext` shipped with `middlewareVersion: 1` (bumped to 2 when P2.2 lands). |

**Sprint 3 gate:** Kill an agent run mid-iteration, restart, resume produces byte-equivalent output to an uninterrupted run. Reflection loop blocks a malformed `write_patch` in a unit test. Confidence < 0.7 upgrades an auto decision to review.

**Exit criteria:** The agentic loop is crash-safe, self-reviewing, and confidence-aware. Long-running autonomous sessions become credible.

---

### Sprint 4 — Scale & operator modes (playbook engine levels up)

**Goal:** Operators get explicit control over how autonomous playbooks are, Portfolio Health becomes the first parallel workflow, and the first real structural test suite starts catching regressions.

| # | Item | Notes |
|---|---|---|
| 17 | P3.1 | Migration 0086 adds `run_mode` to `playbook_runs`. Engine branches per tick on all four modes (`auto`, `supervised`, `background`, `bulk`). Start-run modal UI gains dropdown + bulk target picker. |
| 18 | P3.2 | Migration 0087 adds `ghl_concurrency_cap` to `organisations`. `portfolio-health-sweep` system playbook template seeded. `list_active_subaccounts` skill added. |
| 19 | P3.3 | `trajectoryService.ts` + `trajectoryServicePure.ts`. `shared/iee/trajectorySchema.ts`. Five reference trajectories captured from known-good runs: `intake-triage-standard`, `dev-patch-cycle`, `qa-review-blocked`, `portfolio-health-3-subaccounts`, `reporting-agent-morning`. `test:trajectories` wired into `npm test`. |

**Sprint 4 gate:** Portfolio Health bulk run against 3 fake subaccounts fans out in parallel and synthesises correctly. `npm run test:trajectories` runs all 5 references and reports zero divergence against the captured fixtures.

**Exit criteria:** Playbooks have four execution modes. Portfolio Health scales with subaccount count. Structural regressions are caught automatically on every commit.

---

### Sprint 5 — Polish & competitive features (agent authoring becomes first-class)

**Goal:** Topics filter deterministically narrows tool selection, shared memory blocks enable cross-agent context, plan-then-execute makes complex runs inspectable, and the critique gate starts collecting shadow-mode data for a future activation decision.

| # | Item | Notes |
|---|---|---|
| 20 | P4.2 | Migrations 0088 adds `memory_blocks` + `memory_block_attachments`. `memoryBlockService`. `agentService.resolveSystemPrompt()` extended. `update_memory_block` skill. Admin UI at `/admin/memory-blocks`. New agent edit tab. |
| 21 | P4.1 | Topic taxonomy in `server/config/topicRegistry.ts`. Populate `topics` on all 29 `ACTION_REGISTRY` entries. Add `isUniversal: true` on 4 skills (`ask_clarifying_question`, `read_workspace`, `search_codebase`, `web_search`). **New `ask_clarifying_question` skill**: `server/skills/ask_clarifying_question.md` + `server/tools/internal/askClarifyingQuestion.ts` handler + `POST /api/agent-runs/:id/clarify` endpoint + `'awaiting_clarification'` status + WebSocket emitter + client UI for the clarification prompt. `topicClassifier` (keyword-rule version) with confidence scoring. `skillService.getToolsForRun()` extended to merge universal skills. New `preCall` middleware implements staged-narrowing filter (reorder on low confidence, hard-remove above 0.85, preserve universal skills, zero-match fallback to universal-only + loud telemetry event). |
| 22 | P4.3 | Migration 0089 adds `plan_json` to `agent_runs`. `isComplexRun()` + `parsePlan()` in pure helpers. Planning prelude in `runAgenticLoop()`. Integration with supervised mode from P3.1. New agent run detail "Plan" panel. Replanning-on-failure (one revision per run). |
| 23 | P4.4 | `postCall` middleware phase added. Shadow-mode critique gate writes to `llmRequests.metadataJson.critique_gate_result`. Tag 3-5 high-stakes actions with `requiresCritiqueGate: true`. Telemetry dashboard query for disagreement rate by tool. **Active-mode flip is NOT in this sprint** — waits on 2-4 weeks of data. |

**Sprint 5 gate:** Every item has unit tests and manual integration tests. Shadow-mode critique gate logs appear in `llmRequests` for tagged actions. Topics filter narrows the tool set correctly for known user messages. Shared memory blocks merge into the system prompt on agent run start.

**Exit criteria:** The platform has every scheduled item from Phase 0-4 shipped. The testing phase can begin against the intended architecture.

---

### Deferred (Phase 5 — no sprint)

Five items remain deferred because they depend on real-world signals, not on authorisation. They will be revisited after the testing phase generates the signals they need:

- **P5.1** — ElevenLabs execution timing modes: wait for voice integration work.
- **P5.2** — Per-skill fallback cascade: wait for trajectory data showing recurring failure modes that skill substitution would solve.
- **P5.3** — Workforce Canvas visual DAG: wait for user feedback explicitly requesting visual authoring.
- **P5.4** — Separate QA system agent: wait for 4-6 weeks of P2.2 measurement showing self-review has a ceiling.
- **P5.5** — LLM-as-Judge for trajectory eval: wait for P3.3 telemetry showing a failure class that structural comparison cannot catch.

### Parallelisation opportunities

Items within a sprint can often run in parallel. Concretely:

- **Sprint 1:** P0.1 Layer 1 → Layer 3 → Layer 2 must be sequential. P0.2 Slice B can start the moment P0.1 Layer 1 lands. P0.2 Slices A and C run after Slice B but independently of each other.
- **Sprint 2:** P1.1 Layer 3 and P1.2 Capture are independent and can land in parallel once Sprint 1 exits. P1.1 Layer 2 depends on Layer 3 for the `FailureReason` enum change. P1.1 Layer 1 is independent of the other layers and can land last in parallel with P1.2 Replay.
- **Sprint 3:** P2.2 is entirely independent and can land first as a warm-up. P2.3 Slices A/B/C are sequential. P2.1 is the largest single item and should land last.
- **Sprint 4:** P3.1 must land before P3.2 and before the Portfolio Health fixture capture for P3.3. P3.2 and P3.3's fixture capture can run in parallel once P3.1 is in place. P3.3's comparison utility is independent of either.
- **Sprint 5:** All four items are independent of each other (they all depend on Sprint 1 prerequisites) and can be built in any order or in parallel.

### Rollback posture

Pre-production means rollback is "delete the files / revert the migration / restore from the previous commit". There is no production database to worry about. Down-migrations exist under `migrations/_down/` per existing project convention and must be written for every forward migration in this plan. That's the full rollback story.

The only item that genuinely retains a runtime switch is P4.4's `CRITIQUE_GATE_SHADOW_MODE` constant, which guards a data-collection mode and survives the pre-production simplification because it gates *behaviour* (shadow vs active), not *deployment*.

### Per-item rollback notes

Each migration in the plan has specific rollback caveats beyond "restore the schema". These are the ones that need explicit mention at implementation time:

| Migration | Forward | Rollback caveat |
|---|---|---|
| 0079-0081 (RLS) | Enables RLS on 10 tables | Rollback is DROP POLICY + DISABLE ROW LEVEL SECURITY. Safe as long as no other code path assumes RLS is active. After rollback, every service must revalidate its application-layer scoping — do not assume the pre-P1.1 code path "just works" if any of the new `preTool` middleware from Layer 3 has shipped. |
| 0082 (tool_call_security_events) | New table | Safe drop. No foreign keys point at it. |
| 0083 (regression_cases) | New table | Safe drop. No foreign keys point at it. `regressionCaptureService` is tolerant of the table missing (no-op on missing table) so the service code can ship before or after the migration is reverted. |
| 0084 (agent_run_snapshots.checkpoint + agent_run_messages) | New column + new table | Rollback: drop `agent_run_messages`, then `ALTER TABLE agent_run_snapshots DROP COLUMN checkpoint`. Agent runs in progress at rollback time will crash on their next iteration because the code path expects the column; ensure no runs are in flight before rolling back. |
| 0085 (policy_rules extensions) | Add `confidence_threshold`, `guidance_text` | Safe drop of columns. Rules already in the table with populated values will lose data — export first if rules have been written. |
| 0086 (playbook_runs.run_mode) | Add `run_mode` column | Existing runs at rollback time will all have `run_mode = 'auto'` which matches pre-P3.1 behaviour, so no data loss. Safe. |
| 0087 (organisations.ghl_concurrency_cap) | Add column | Safe drop. |
| 0088 (memory_blocks, memory_block_attachments) | Two new tables | Safe drop in dependency order (attachments first, then blocks). `agentService.resolveSystemPrompt()` is tolerant of missing tables (returns empty merge) so the code path can stay in place after rollback. |
| 0089 (agent_runs.plan_json) | Add jsonb column | Safe drop. |

### Job idempotency keys

Every new pg-boss job added by this roadmap must declare an explicit idempotency key (pg-boss `singletonKey`) so retries don't cause duplicate work. Listed in order of roadmap appearance:

| Job name | Sprint | `singletonKey` shape | Deduplication semantics |
|---|---|---|---|
| `agent-run-resume` | 3 (P2.1) | `run:${runId}` | Only one resume in flight per run. If the worker dies mid-resume, the restart picks up the same job. No duplicate resumes. |
| `regression-capture` | 2 (P1.2) | `capture:${auditRecordId}` | Capture is idempotent on `review_audit_records.id`. Retries are harmless but deduplicated for cleanliness. |
| `regression-replay` | 2 (P1.2) | `replay:${regressionCaseId}:${runDate}` | Weekly replay cron generates one job per case per week. Retries within the same day replace the existing job. |
| `bulk-dispatch-child` | 4 (P3.1) | `bulk:${parentRunId}:${targetSubaccountId}` | Critical. Prevents duplicate children on parent retry. Enforced by pg-boss before the child handler runs. |
| `bulk-dispatch-synthesis` | 4 (P3.1) | `bulk-synth:${parentRunId}` | One synthesis step per parent, ever. Keyed on parent run ID so retries don't re-synthesise. |
| `critique-gate-shadow` | 5 (P4.4) | `critique:${llmRequestId}` | One shadow evaluation per LLM call. Retries are free but deduplicated. |
| `agent-run-cleanup` | 3 (retention) | `cleanup:${date}` | One cleanup per day. Retries within the day are no-ops. |

Idempotency keys are enforced at the `boss.send(...)` call site via `getJobConfig('...')` in `server/config/jobConfig.ts` (per existing pattern). The call sites for all new jobs must be linted via a new gate script `verify-job-idempotency-keys.sh` which asserts every new `boss.send('...')` in this roadmap's diff includes a `singletonKey` option.

### Retention and pruning policies

Three new data-producing tables need explicit retention policies. Without them they grow unbounded.

| Table | Growth driver | Retention | Pruning job |
|---|---|---|---|
| `tool_call_security_events` | One row per tool call across the whole platform. Highest-volume new table by orders of magnitude. | **30 days by default**, configurable per org via `organisations.security_event_retention_days`. Compliance-sensitive orgs can extend up to 365 days. | `scripts/prune-security-events.ts` runs nightly as pg-boss job `security-events-cleanup` (singletonKey `prune-security:${date}`). Deletes rows older than the configured retention. |
| `regression_cases` | One row per HITL rejection. Lower volume — scales with human review throughput. | **Indefinite for `is_active = true`**, capped at `agents.regressionCaseCap` (default 50) via eviction. Inactive cases kept for 90 days. | Eviction happens inline on `regressionCaptureService.captureFromAuditRecord()` when the cap is exceeded. Oldest `last_run_outcome = 'pass'` case is evicted first. |
| `agent_run_messages` | Messages for every agent run. Medium volume — bounded by run count × iterations × message size. | **90 days for terminal runs** (completed/failed/timeout/cancelled), configurable per org via `organisations.run_retention_days`. Non-terminal runs are never pruned (they're the resume targets). | Cascades on `agent_runs` delete. `agent-run-cleanup` cron (pg-boss job, singletonKey `cleanup:${date}`) deletes terminal `agent_runs` older than retention window; messages cascade. |
| `agent_run_snapshots.checkpoint` | One row per agent run (pre-existing), now with a jsonb column updated per iteration. | Same as parent `agent_runs` row. Cascades on delete. | Same cleanup job as above. |

All retention configs live on the `organisations` table as new nullable integer columns with platform defaults in `server/config/limits.ts`. No new table, no new config system — retention is per-org and enforced by the cleanup jobs above.

Retention-related migrations ship in the same sprints as the tables they prune:

- `agent-run-cleanup` cron → Sprint 3 alongside P2.1.
- `security-events-cleanup` cron → Sprint 2 alongside P1.1 Layer 3.
- `regression_cases` eviction → Sprint 2 alongside P1.2 Capture.

