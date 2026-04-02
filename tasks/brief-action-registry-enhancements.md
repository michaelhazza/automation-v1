# Development Brief: Action Registry Enhancements

**Date:** 2026-04-02  
**Status:** Proposal — pending sanity check  
**Origin:** Claw-code architecture analysis (see `tasks/claw-code-deep-dive.md`)

---

## Problem

Our action registry (`server/config/actionRegistry.ts`) defines 17 actions that power agent tool-calling and MCP exposure. Two gaps were identified when benchmarking against well-regarded open-source agent harness patterns:

1. **No parameter schemas** — `payloadFields` is a string array with no types, constraints, or required/optional markers. The LLM has no structured definition of what each action accepts, and we have no schema-driven validation at runtime.

2. **No per-agent tool scoping** — Every agent sees every action. There's no mechanism to restrict which actions an agent can access based on its role or purpose.

3. **No action descriptions** — Actions have no human/LLM-readable description, which weakens MCP tool discovery and LLM tool selection accuracy.

---

## Proposed Changes

### 1. Add `parameterSchema` (JSON Schema) to each action

Replace `payloadFields: string[]` with a standard JSON Schema object per action. This schema would serve as:
- The MCP tool definition sent to LLMs
- The runtime validation source (via Zod or ajv)
- Self-documenting parameter reference

**Example — `send_email` before/after:**

```
// Before
payloadFields: ['to', 'subject', 'body', 'thread_id', 'provider']

// After
parameterSchema: {
  type: 'object',
  properties: {
    to:        { type: 'string', format: 'email' },
    subject:   { type: 'string', minLength: 1 },
    body:      { type: 'string' },
    thread_id: { type: 'string' },
    provider:  { type: 'string', enum: ['sendgrid', 'resend'] },
  },
  required: ['to', 'subject', 'body', 'provider'],
  additionalProperties: false,
}
```

**Expected impact:** Fewer malformed tool calls from LLMs, single source of truth for validation, and cleaner MCP tool definitions.

### 2. Add `allowedActions` filtering per agent context

Allow agent definitions (or execution contexts) to specify which actions they can access:

```
allowedActions?: string[]  // If set, only these actions are exposed to the agent
```

An email-drafting agent would only see `send_email`, `read_inbox`, `create_task`. A devops agent would see `read_codebase`, `run_tests`, `write_patch`, `create_pr`. Actions not in the allowlist simply don't appear in the tool list sent to the LLM.

**Expected impact:** Reduced hallucinated tool calls, better agent focus, defence-in-depth beyond gate levels.

### 3. Add `description` field to each action

A one-line human/LLM-readable description per action:

```
description: 'Send an email via the configured provider (SendGrid or Resend)'
```

**Expected impact:** Better LLM tool selection when actions are exposed via MCP.

### 4. Add name normalization + aliases (minor)

A `normalizeActionType()` function and small alias map (`'email'` → `'send_email'`, `'test'` → `'run_tests'`) to handle LLM name variations gracefully.

**Expected impact:** Fewer tool-call failures from minor name mismatches.

---

## What This Does NOT Change

- Action state machine and lifecycle (proposed → executing → completed/failed) — untouched
- Retry policies and error taxonomy — untouched
- MCP annotations (readOnlyHint, destructiveHint, etc.) — untouched
- HITL gate levels — untouched
- `payloadFields` can be kept temporarily for backward compat and derived from the schema

---

## Effort Estimate

| Change | Scope | Files Touched |
|--------|-------|---------------|
| `parameterSchema` | Define schemas for 17 actions | `actionRegistry.ts`, MCP server, skill executor |
| `allowedActions` | Filter logic in tool exposure | Agent service, MCP server, execution layer |
| `description` | Add strings to 17 actions | `actionRegistry.ts` |
| Name normalization | Small utility function + alias map | `actionRegistry.ts` |

---

## Open Questions

1. **Is this actually needed now?** Our current `payloadFields` approach works — agents successfully call tools. The question is whether the accuracy improvement from schemas justifies the effort, or if this is premature optimization.

2. **Zod vs ajv for runtime validation?** We already use Zod elsewhere. JSON Schema can be converted to Zod, or we could define in Zod and derive JSON Schema. Need to pick a direction.

3. **Should `allowedActions` live on the agent definition or the execution context?** Agent-level is simpler. Execution-context-level is more flexible (same agent, different scopes per workflow).

4. **Do we version schemas?** If a schema changes, persisted action payloads from older executions may not match. Do we need a version field or schema hash?
