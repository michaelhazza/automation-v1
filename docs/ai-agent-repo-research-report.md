# AI Agent & Automation Repo Research Report

**Purpose:** Prioritised study list for improving Automation OS — a multi-tenant agency SaaS with AI agents, HITL review gates, and scheduled execution. This document identifies which external open-source repos to study, in what order, and what to extract from each. It also defines the internal architectural contracts that must be locked before repo study begins, so external patterns map into the system rather than replacing it.

---

## Codebase baseline (as of report date)

### Well-built
- Multi-tenancy: org → subaccount → user, five-role RBAC, fine-grained permission sets
- Agent execution engine: agentic loop, handoffs, sub-agent spawning, heartbeat scheduling
- Workflow engine connector pattern: n8n, GHL, Make, Zapier via HMAC-signed webhook
- Scheduling: pg-boss + RRULE-based recurring tasks
- Memory system: two-layer (raw entries + compiled summaries) + pgvector HNSW + entity extraction
- LLM cost routing: Anthropic/OpenAI/Gemini adapter, append-only `llm_requests` ledger
- Skill/tool system: 20+ skills, `actionRegistry.ts`, three gate levels modelled

### Current gaps (priority order)
1. **HITL wiring** — schema and state machine complete; skillExecutor ↔ action gate integration partially done, legacy direct-execution paths still present
2. **Policy engine** — auto/review/block decision is static per action type in `actionRegistry.ts`; no rules-engine for dynamic conditions (role, amount, environment)
3. **OAuth flows for `integration_connections`** — gmail, github, hubspot, slack, ghl schema exists, zero token acquisition or refresh logic
4. **Orchestrator agent** — explicitly Phase 2, nothing built
5. **Observability depth** — basic cost ledger exists; per-tenant tracing, agent graph visualization, prompt management not built
6. **Agent testability** — `agentRunSnapshots` exist as raw material but no deterministic test harness or fixture-driven regression runner

---

## Pre-study contracts

These four contracts must be written, reviewed, and agreed internally before repo study begins. They define the system's own language so external patterns have something concrete to map against rather than something to replace.

### Contract 1 — Canonical HITL flow

```
Agent proposes action
→ policy engine evaluates rule set (ordered by priority, first_match wins)
  → auto   : execute immediately, write action_event, no gate
  → review : persist checkpoint, enqueue review_item,
             notify approver, block until resume
  → block  : reject immediately, return refusal to agent

On resume:
  validate checkpoint.input_hash        (reject if mismatch — input changed)
  validate checkpoint.tool_version      (reject or re-run if tool changed)
  validate checkpoint.timeout_at        (reject if expired)
  validate checkpoint.approval_context_hash  (reject if replayed in different context)
  execute with original context + approval metadata appended

Failure paths to handle explicitly:
  - Approval arrives after timeout_at          → reject, notify agent
  - Tool version changes before resume          → reject, re-propose to agent
  - Input data becomes stale                   → reject if hash mismatch
  - User approves twice (duplicate submission)  → idempotency_key deduplicates
  - Agent context has changed since proposal    → approval_context_hash catches this
```

### Contract 2 — Unified tool abstraction

```ts
type Tool = {
  slug: string
  version: string                           // for checkpoint validation on resume
  input_schema: JSONSchema
  execution_handler: (ctx: ToolContext) => Promise<ExecutionResult>
  auth_context?: IntegrationConnection      // always tenant-scoped, never shared across subaccounts
  gate_level: 'auto' | 'review' | 'block'  // default; overridden by policy engine at runtime
  idempotency_key_fn: (input: unknown) => string  // enforced at service boundary, before DB writes
  rate_limits?: RateLimitConfig
}

// Hard constraint: auth_context must be tenant-scoped.
// No shared tokens across subaccounts. Enforce at the service boundary, not by convention.
```

### Contract 3 — Execution result, policy rule, and HITL checkpoint shapes

```ts
type ExecutionResult = {
  status: 'success' | 'partial' | 'failed'
  data?: unknown
  error?: {
    message: string
    retryable: boolean
    code?: string
  }
  metadata?: {
    cost_usd?: number
    duration_ms?: number
    idempotency_key?: string
  }
}

type PolicyRule = {
  id: string
  priority: number                          // lower number = evaluated first
  tool_slug: string | '*'                   // '*' acts as catch-all
  conditions: {
    user_role?: OrgUserRole
    subaccount_id?: string
    amount_usd?: { gt?: number; lte?: number }
    environment?: 'production' | 'staging'
    [key: string]: unknown                  // extensible without schema changes
  }
  decision: 'auto' | 'review' | 'block'
}

// Policy engine evaluation contract
type PolicyEngine = {
  evaluation_mode: 'first_match'            // explicit lock — no "most restrictive" ambiguity,
                                            // no rule combining, no implicit behaviour
  rules: PolicyRule[]                       // sorted by priority ascending before eval
  default: PolicyRule                       // always last; decision: 'review' (safe default)
}

// Default fallback rule — always appended as last entry
const DEFAULT_POLICY_RULE: PolicyRule = {
  id: 'default-fallback',
  priority: 9999,
  tool_slug: '*',
  conditions: {},
  decision: 'review',
}

// HITL action checkpoint — full resume integrity
type ActionCheckpoint = {
  id: string
  tool_slug: string
  tool_version: string
  input_hash: string                        // SHA-256 of serialized tool input
  created_at: Date
  timeout_at: Date
  approved_by?: string                      // who approved — guards against replay attacks
  approval_context_hash?: string            // hash of approval payload — guards cross-context reuse
}
```

### Contract 4 — Agent test contract

Defines how agent runs are captured for deterministic regression testing. Feeds into HITL resume integrity testing (the `input_hash` validation path requires deterministic replay to test).

```ts
type AgentRunFixture = {
  fixture_id: string
  agent_run_id: string                      // source run being replayed
  memory_state_snapshot: WorkspaceMemoryState
  input_messages: AgentMessage[]
  tool_call_sequence: ToolCallRecord[]      // ordered list of expected tool calls
  expected_outputs: ExecutionResult[]       // per-tool expected results
  assertions: RunAssertion[]                // what to validate after replay
}

type RunAssertion = {
  type: 'tool_called' | 'result_status' | 'gate_decision' | 'cost_within'
  target: string                            // tool_slug or field path
  expected: unknown
}

// Replay harness contract:
// 1. Load fixture
// 2. Freeze inputs (substitute tool execution_handlers with fixture stubs)
// 3. Run agent loop against frozen inputs
// 4. Assert RunAssertion[] against actual outputs
// Source data: existing agentRunSnapshots + memoryStateAtStart fields
```

---

## Repo priority list

**Legend:**
- `[ADOPT]` — Partial adoption. Extract patterns, adapt to existing architecture. No blind copying.
- `[REF]` — Pattern reference only. Study for ideas. No code adoption.
- `[INT?]` — Integration candidate. Evaluate against kill criteria before committing.

---

### 1. HumanLayer `[ADOPT]`
**Repo:** humanlayer/humanlayer · ~10,200 ★ · TypeScript/Python
**Gap:** HITL execution interception in `skillExecutor.ts`

The key insight: bake approval into the tool function itself, not the agent loop. This guarantees oversight even if the LLM tries to bypass controls. The `@require_approval()` decorator wraps the function — the correct interception point in `skillExecutor.ts`.

**Extract:**
- Interception pattern: wrap the tool's `execution_handler`, not the agentic loop
- Async pause → notify → resume flow (maps to `actionService` + `reviewService`)
- Channel-based approval routing (per-client or per-role approval queues)
- `human_as_tool` primitive: lets agents explicitly escalate when uncertain

**Do not adopt:** Their approval data model — the existing `actions` state machine is more complete.

---

### 2. Windmill `[REF]`
**Repo:** windmill-labs/windmill · ~15,800 ★ · Rust/Svelte/PostgreSQL
**Gap:** Approval suspend/resume mechanics + PostgreSQL queue patterns

Pure pattern reference (Rust backend, Svelte frontend — no direct adoption). The most production-complete approval step implementation available.

**Extract:**
- `waitForApproval()` suspension and state serialization mechanics
- Resume URL generation pattern
- Conditional branching on approval / rejection / timeout response
- Custom form fields in approval UI — reference for review gate interface
- `LISTEN/NOTIFY` PostgreSQL queue pattern — validates and extends pg-boss approach
- Checkpoint/replay: completed steps return cached results instantly on replay; sleeping workflows consume zero worker resources

---

### 3. Mastra `[ADOPT]` — constrained scope
**Repo:** mastra-ai/mastra · ~21,100 ★ · TypeScript · Apache 2.0
**Gap:** Suspend/resume DAG workflows + processors guardrails + MCP integration

TypeScript-native, same ecosystem, Apache 2.0. Study now, implement later.

**Gate on implementation:** Do not begin building orchestrator until HITL is fully wired and at least two real workflows are running end-to-end.

**Extract only:**
- Execution graph patterns and checkpointing model (how DAG state is serialized and resumed)
- Processors system: per-step validation, tool dependency enforcement, task drift monitoring — maps to gate model configuration
- MCP integration approach: how external tool servers plug into a tool registry without custom integrations

**Do not extract:**
- Their agent abstraction (clashes with existing `agentExecutionService.ts`)
- Their agent lifecycle model (same reason)

---

### 4. Activepieces `[ADOPT]` — chosen integration strategy
**Repo:** activepieces/activepieces · ~20,800 ★ · TypeScript · MIT
**Gap:** OAuth2 flows for `integration_connections` (gmail, github, hubspot, slack, ghl)

The chosen direction for building the OAuth layer — not Composio (see #5). Self-hosted, TypeScript, MIT. All five providers with stubs in `integration_connections` are covered in open-source MIT Pieces packages.

**Extract:**
- OAuth2 authorization code → token exchange → encrypted storage → auto-refresh pattern
- Type-safe Pieces package structure as reference for the `integration_connections` service architecture
- "Todos" HITL step type as secondary approval surface reference

**Hard constraint:** All `auth_context` implementations must be tenant-scoped. No shared tokens across subaccounts. Enforce at the service boundary.

---

### 5. Composio `[INT?]` — evaluate against kill criteria
**Repo:** ComposioHQ/composio · ~15,000 ★ · TypeScript SDK
**Gap:** Potential bridge adapter for OAuth — strategic decision pending

Study briefly after #4. One specific question: can it plug cleanly into the unified `Tool` abstraction as a replaceable `auth_context` provider without owning any core abstraction?

**Kill criteria — reject if any are true:**
- It dictates the auth model rather than slotting into `IntegrationConnection`
- Removing it later would require refactoring core services
- It introduces a second integration abstraction layer alongside the Activepieces-informed one

If it passes all three: use as a temporary bridge adapter with an explicit deprecation plan. If it fails any: reject early, before any integration work takes a dependency on it. Do not treat it as a peer strategic option alongside Activepieces.

---

### 6. Langfuse `[ADOPT]` — Phase 1 scope only
**Repo:** langfuse/langfuse · ~24,000 ★ · TypeScript/Next.js + PostgreSQL · MIT
**Gap:** Per-tenant observability, agent run tracing, per-subaccount cost attribution

TypeScript + PostgreSQL match. The existing `llm_requests` ledger is the data source — Langfuse patterns inform the query and display layer, not the collection layer.

**Phase 1 scope (strictly):**
- Run-level tracing: one trace per `agent_run`, grouped by `subaccount_id`
- Tool-level spans: one span per skill execution, attaching `ExecutionResult` metadata
- Per-tenant cost aggregation surfaced in the existing `cost_aggregates` pipeline

**Not in Phase 1:**
- Prompt versioning system
- Full observability UI replication
- Deep analytics, A/B testing, or annotation queues

---

### 7. LangGraph `[REF]`
**Repo:** langchain-ai/langgraph · ~27,900 ★ · Python + TypeScript (LangGraph.js) · MIT
**Gap:** HITL theory — three-tier gate model + checkpoint patterns + Agent Inbox UI reference

Python-primary. High signal for HITL architecture theory. Value is in patterns, not code.

**Extract:**
- Three-tier gate model: compile-time `interrupt_before` → runtime `interrupt()` → policy-based `HumanInTheLoopMiddleware`. Maps directly to auto/review/block.
- `AsyncPostgresSaver`: reference for how to persist checkpoint state on PostgreSQL
- Agent Inbox UI (`langchain-ai/agent-inbox`): the best available reference for the review queue interface
- Checkpoint-based time travel (rewind + replay): feeds into the agent test contract

---

### 8. n8n `[REF]`
**Repo:** n8n-io/n8n · ~174,000 ★ · Node.js/TypeScript · Fair-code (no adoption)
**Gap:** Per-tool HITL routing UI reference + canvas workflow builder for Phase 2

Fair-code license prohibits building a competing SaaS — no code adoption. Already integrated as an external engine target via webhook connector.

**Extract:**
- Per-tool HITL routing configuration UI: how individual tools within an AI Agent node can independently require approval, routed to different channels — reference for the review gate configuration interface
- Canvas node editor: primary Phase 2 visual workflow builder UI reference
- Execution inspection UX: showing every prompt, model response, and branching decision per run

---

### 9. CrewAI `[REF]`
**Gap:** Orchestrator/directive architecture (Phase 2)**
**Repo:** crewAIInc/crewAI · ~46,900 ★ · Python · MIT

Python. Study when Phase 2 orchestrator design begins — not before.

**Extract:**
- Flows + Crews dual architecture: deterministic routing (Flows) + autonomous intelligence (Crews) — conceptual reference for the orchestrator/directive split
- `@human_feedback` branching logic: approve / reject / needs_revision with audit history — reference for policy engine response routing
- Memory isolation failure mode: default shared DB across users is a cautionary tale — reinforces workspace-scoped memory enforcement already in the system

---

### 10. Mem0 `[REF]`
**Repo:** mem0ai/mem0 · ~43,000 ★ · Python + JS SDK · Apache 2.0
**Gap:** Memory lifecycle concepts — scoring, decay, TTL (Phase 2+)

Correctly last. The existing two-layer memory system (raw entries + compiled summaries + pgvector) is functional. The graph layer (Neo4j) adds infrastructure complexity not yet justified.

**Extract (apply to existing system without new dependencies):**
- Relevance scoring model: how memories are weighted by recency + significance
- Memory decay / TTL patterns: preventing workspace memory from becoming cluttered over time
- Per-agent / per-task context scoping: tighter retrieval relevance per run

---

## Summary table

| # | Repo | Type | Primary gap |
|---|------|------|-------------|
| — | Canonical HITL flow | Internal contract | Lock before repo #1 |
| — | Unified tool abstraction | Internal contract | Lock before repo #1 |
| — | Execution contract + policy rule | Internal contract | Lock before repo #1 |
| — | Agent test contract | Internal contract | Lock before repo #1 |
| 1 | HumanLayer | `[ADOPT]` | HITL execution interception |
| 2 | Windmill | `[REF]` | Suspend/resume + PG queue patterns |
| 3 | Mastra | `[ADOPT]` | DAG checkpointing + MCP (study now, build later) |
| 4 | Activepieces | `[ADOPT]` | OAuth flows — chosen integration strategy |
| 5 | Composio | `[INT?]` | Bridge adapter — evaluate against kill criteria |
| 6 | Langfuse | `[ADOPT]` | Per-tenant tracing (Phase 1 scope only) |
| 7 | LangGraph | `[REF]` | HITL theory + policy engine reference |
| 8 | n8n | `[REF]` | Canvas UI + per-tool HITL routing reference |
| 9 | CrewAI | `[REF]` | Orchestrator model (Phase 2) |
| 10 | Mem0 | `[REF]` | Memory lifecycle concepts (Phase 2+) |

## Recommended next step

**Do not start repo deep-dives yet.**

Convert the four internal contracts above into a formal spec (`docs/execution-contracts.md`) containing:
- Final type definitions for all four contracts
- Canonical HITL flow as a sequence diagram
- `PolicyRule` evaluation walkthrough with a concrete example (e.g. "auto-approve under $1k for manager role in staging")
- Resume integrity validation steps in order
- Edge case handling table: timeout / hash mismatch / version change / double-approval / stale input

Once that spec is written, agreed, and committed: start with HumanLayer deep-dive exactly as planned.
