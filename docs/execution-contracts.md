# Execution Contracts

**Version:** 1.0
**Date:** 2026-03-31
**Branch:** claude/research-ai-agent-repos-2iK2b

These four contracts define the canonical shapes and flows that every feature in Automation OS maps to. External frameworks (HumanLayer, LangGraph, Windmill, Mastra, CrewAI) were studied and validated against these definitions. When those frameworks are referenced in the dev spec, this document is the authority — not their internal models.

---

## Contract 1 — Canonical HITL Flow

Every agent action that touches an external system or has side effects must pass through this flow. No exceptions.

```
Agent proposes action (tool call from skillExecutor.ts)
  │
  ▼
Policy Engine evaluates (first-match, ordered by priority ASC)
  │
  ├─► auto   → Create action record (state: proposed → executing)
  │           → Execute immediately
  │           → Write audit event (no human gate)
  │           → Update state: executing → completed | failed
  │
  ├─► review → Create action record (state: proposed)
  │           → Validate: generate input_hash, set tool_version
  │           → Set suspend_count = 1, suspend_until = now + timeout
  │           → Transition: proposed → pending_approval
  │           → Enqueue review_item (subaccountId, orgId, priority)
  │           → Notify approver (in-app + optional channel)
  │           → Block agent (promise held open — no polling)
  │           → On approve:
  │               Validate input_hash matches (reject if mismatch)
  │               Validate tool_version matches (reject or re-run if changed)
  │               Validate checkpoint not expired (timeout_at > now)
  │               Set approved_by, approval_context_hash
  │               Transition: pending_approval → approved → executing
  │               Resolve blocking promise → agent resumes
  │               Execute tool → transition: executing → completed | failed
  │           → On reject:
  │               Set comment (required — no silent rejections)
  │               Transition: pending_approval → rejected
  │               Inject denial message as tool output (not exception)
  │               Agent receives denial observation, continues loop
  │           → On timeout (suspend_until <= now):
  │               Transition: pending_approval → rejected
  │               Inject timeout message as tool output
  │               Apply timeout_policy (default: reject)
  │
  └─► block  → Create action record (state: proposed → blocked)
              → Return refusal immediately — never queued for approval
              → Agent receives blocked message, continues loop

Resume integrity checks (all run before transitioning approved → executing):
  1. input_hash: SHA-256(canonicalize(action.input)) === checkpoint.input_hash
  2. tool_version: current tool version === checkpoint.tool_version
  3. timeout: checkpoint.timeout_at > now()
  4. double-approve guard: action.status !== 'pending_approval' → throw AlreadyDecidedError
  5. tenant isolation: checkpoint.subaccountId === approver.subaccountId
```

---

## Contract 2 — Unified Tool Abstraction

Every executable capability in the system — internal skills, OAuth integrations, MCP tools — implements this interface. The `execution_handler` is the single dispatch point. Gate enforcement happens above this in the HITL flow, never inside handlers.

```typescript
/**
 * The canonical tool definition. Every skill, integration, and MCP tool
 * implements this interface. Nothing executes without going through it.
 */
interface Tool {
  // Identity
  slug: string;                   // unique, kebab-case (e.g. 'send_email', 'github_create_issue')
  version: string;                // semver — used for checkpoint validation on resume
  description: string;            // shown to agent in system prompt

  // Schema
  input_schema: JSONSchema;       // Anthropic tool_use format (type: 'object', properties, required)

  // Execution
  execution_handler: (ctx: ToolContext) => Promise<ExecutionResult>;

  // Auth — always tenant-scoped, never shared across subaccounts
  auth_context?: IntegrationConnection;

  // Gate
  gate_level: 'auto' | 'review' | 'block';  // default; overridden per-rule by PolicyEngine

  // Idempotency — enforced at the service boundary before DB writes
  idempotency_key_fn: (input: unknown) => string;  // e.g. stableHash(JSON.stringify(input))

  // Rate limiting
  rate_limits?: {
    requests_per_minute?: number;
    requests_per_day?: number;
  };

  // MCP readiness — zero-cost to add now, enables MCP registration later
  mcp?: {
    annotations?: {
      readOnlyHint?: boolean;       // tool does not modify state
      destructiveHint?: boolean;    // tool can cause irreversible changes
      idempotentHint?: boolean;     // repeated calls with same args are safe
      openWorldHint?: boolean;      // tool interacts with external systems
    };
    server_name?: string;           // set when tool originates from an MCP server
    server_version?: string;
  };
}

interface ToolContext {
  input: unknown;                 // validated against input_schema before handler is called
  subaccountId: string;
  organisationId: string;
  agentRunId: string;
  actionId?: string;              // present for review/block gated executions
  auth_context?: IntegrationConnection;
}

/**
 * All OAuth connections. Strictly tenant-scoped — no shared tokens.
 * Tokens never leave the organisation's data boundary.
 */
interface IntegrationConnection {
  id: string;
  provider: 'gmail' | 'github' | 'hubspot' | 'slack' | 'ghl' | 'custom';
  subaccountId: string;           // non-nullable — hard enforcement
  organisationId: string;         // non-nullable — hard enforcement
  access_token: string;           // AES-256-GCM encrypted at rest
  refresh_token?: string;         // AES-256-GCM encrypted at rest
  expires_at?: Date;
  scopes: string[];
  metadata?: Record<string, unknown>;
}
```

---

## Contract 3 — ExecutionResult, PolicyRule, PolicyEngine, ActionCheckpoint

### ExecutionResult

Returned by every `execution_handler`. No exceptions bubble up from handlers — errors are captured here.

```typescript
interface ExecutionResult {
  status: 'success' | 'partial' | 'failed';
  data?: unknown;
  error?: {
    message: string;
    retryable: boolean;   // true → HITL flow may retry; false → halt agent
    code?: string;
  };
  metadata?: {
    cost_usd?: number;
    duration_ms?: number;
    idempotency_key?: string;
    tokens_used?: number;
  };
}
```

### PolicyRule

Rules evaluated in ascending priority order. First match wins. A fallback rule (priority 9999, slug `*`, decision `review`) always exists as the last entry.

```typescript
interface PolicyRule {
  id: string;
  priority: number;               // lower = evaluated first; 9999 = fallback default
  tool_slug: string | '*';        // exact match or wildcard

  conditions: {
    user_role?: OrgUserRole;                       // 'system_admin' | 'org_admin' | 'manager' | 'user' | 'client_user'
    subaccount_id?: string;                        // apply only to this subaccount
    amount_usd?: { gt?: number; lte?: number };    // for financial actions
    environment?: 'production' | 'staging';
    [key: string]: unknown;                        // extensible without schema change
  };

  decision: 'auto' | 'review' | 'block';

  // Explicit evaluation contract — prevents "most restrictive" ambiguity
  evaluation_mode: 'first_match';

  // Reviewer options surfaced to the UI (from LangGraph HumanInterruptConfig)
  interrupt_config?: {
    allow_ignore: boolean;
    allow_respond: boolean;         // free-text feedback alongside approve/reject
    allow_edit: boolean;            // reviewer can modify args before approval
    allow_accept: boolean;
  };

  // Outcome routing (from CrewAI @human_feedback emit pattern)
  allowed_decisions?: Array<'approve' | 'edit' | 'reject'>;

  // Markdown description surfaced to the reviewer
  description_template?: string;  // supports {{tool_slug}}, {{args}}, {{subaccount_name}}

  timeout_seconds?: number;        // override default; null = no timeout
  timeout_policy?: 'auto_reject' | 'auto_approve' | 'escalate';
}

// The fallback rule — always the last evaluated
const POLICY_FALLBACK: PolicyRule = {
  id: 'fallback',
  priority: 9999,
  tool_slug: '*',
  conditions: {},
  decision: 'review',             // safe default: require human approval
  evaluation_mode: 'first_match',
};
```

### PolicyEngine

```typescript
interface PolicyEngine {
  evaluation_mode: 'first_match';  // locked — no "most restrictive" or "combine" variants
  rules: PolicyRule[];             // sorted by priority ASC before evaluation
  default: PolicyRule;             // always POLICY_FALLBACK

  evaluate(toolSlug: string, context: PolicyContext): PolicyDecision;
}

interface PolicyContext {
  toolSlug: string;
  userRole: OrgUserRole;
  subaccountId: string;
  organisationId: string;
  input?: unknown;                // for amount/content-based conditions
  environment?: 'production' | 'staging';
}

interface PolicyDecision {
  decision: 'auto' | 'review' | 'block';
  matchedRule: PolicyRule;
  interrupt_config?: PolicyRule['interrupt_config'];
  allowed_decisions?: PolicyRule['allowed_decisions'];
  description?: string;          // rendered description_template
  timeout_seconds?: number;
}
```

### ActionCheckpoint

Persisted when an action enters `pending_approval` state. All fields are immutable after creation — approval only updates `approved_by`, `approval_context_hash`, and `human_response`.

```typescript
interface ActionCheckpoint {
  // Identity
  id: string;                        // UUID — foreign key on actions.checkpoint_id
  action_id: string;                 // FK → actions.id
  subaccount_id: string;             // tenant scope — hard enforced
  organisation_id: string;

  // Tool identity — for version and content validation on resume
  tool_slug: string;
  tool_version: string;              // snapshot of tool version at checkpoint creation
  input_hash: string;                // SHA-256(canonicalize(JSON.stringify(args)))
                                     // LangGraph has no equivalent — this is our addition

  // Timing
  created_at: Date;
  timeout_at: Date;                  // created_at + policy.timeout_seconds

  // The action request — what the agent actually wants to do
  action_request: {
    action: string;                  // human-readable label (e.g. "Send email to client@co.com")
    args: Record<string, unknown>;   // exact args the agent passed
  };

  // Reviewer options (from LangGraph HumanInterruptConfig)
  interrupt_config: {
    allow_ignore: boolean;
    allow_respond: boolean;          // free-text feedback
    allow_edit: boolean;             // modify args before approval
    allow_accept: boolean;
  };

  // Resume integrity — set on approval, not on creation
  approved_by?: string;              // user ID of approver
  approval_context_hash?: string;    // SHA-256 of full interrupt payload — our addition

  // Human response — set on resolution
  human_response?: {
    type: 'accept' | 'ignore' | 'response' | 'edit';
    args: null | string | { action: string; args: Record<string, unknown> };
    comment?: string;                // required when type = 'response' or denial
  };
}
```

---

## Contract 4 — Agent Test Contract

Defines how agent runs are captured, frozen as fixtures, and replayed deterministically for regression testing. Uses the existing `agentRunSnapshots` table as raw material.

```typescript
/**
 * A frozen snapshot of a complete agent run, suitable for deterministic replay.
 * Generated from agentRunSnapshots + agentRuns data.
 */
interface AgentRunFixture {
  // Identity
  fixture_id: string;             // UUID — stable across replays
  agent_slug: string;
  subaccount_id: string;
  created_at: Date;
  description?: string;           // human label for this test case

  // Frozen inputs — these never change between replay runs
  input: {
    system_prompt_snapshot: string;    // from agentRunSnapshots.systemPromptSnapshot
    initial_message: string;
    memory_state: unknown;             // from agentRuns.memoryStateAtStart
    workspace_limits: unknown;
    skill_slugs: string[];
  };

  // Frozen tool call sequence — what the agent did
  tool_calls: Array<{
    call_index: number;
    tool_slug: string;
    input: Record<string, unknown>;
    expected_gate: 'auto' | 'review' | 'block';
    mock_response?: ExecutionResult;   // if set, use mock instead of live execution
  }>;

  // Assertions — what to verify after replay
  assertions: Array<AgentRunAssertion>;
}

type AgentRunAssertion =
  | { type: 'tool_called'; tool_slug: string; at_index?: number }
  | { type: 'tool_not_called'; tool_slug: string }
  | { type: 'gate_applied'; tool_slug: string; gate: 'auto' | 'review' | 'block' }
  | { type: 'run_completed'; within_iterations?: number }
  | { type: 'run_halted'; reason: 'budget' | 'loop_detected' | 'tripwire' }
  | { type: 'output_contains'; substring: string }
  | { type: 'cost_below_usd'; amount: number };

/**
 * The replay harness interface. Accepts a fixture, runs the agent with mocked
 * LLM responses and tool handlers, and returns assertion results.
 */
interface AgentTestHarness {
  run(fixture: AgentRunFixture, options?: {
    llm_mock?: (messages: unknown[]) => unknown;  // override LLM calls
    tool_overrides?: Record<string, (input: unknown) => ExecutionResult>;
  }): Promise<AgentTestResult>;
}

interface AgentTestResult {
  passed: boolean;
  assertions: Array<{
    assertion: AgentRunAssertion;
    passed: boolean;
    actual?: unknown;
    message?: string;
  }>;
  run_summary: {
    iterations: number;
    tool_calls: number;
    cost_usd: number;
    duration_ms: number;
    final_status: string;
  };
}
```

---

## Summary Reference

| Contract | Core type(s) | Primary source |
|---|---|---|
| 1 — HITL Flow | Prose specification | HumanLayer + Windmill + LangGraph |
| 2 — Tool Abstraction | `Tool`, `ToolContext`, `IntegrationConnection` | Mastra (MCP fields) + Composio (auth pattern) |
| 3 — Execution shapes | `ExecutionResult`, `PolicyRule`, `PolicyEngine`, `ActionCheckpoint` | LangGraph (checkpoint fields) + CrewAI (interrupt_config) + Windmill (timeout) |
| 4 — Test Contract | `AgentRunFixture`, `AgentRunAssertion`, `AgentTestHarness` | LangGraph (checkpoint/replay) |

These contracts are the system's own language. Every implementation decision, every external pattern adopted, maps to these types — not the reverse.
