# Claw-Code Deep Dive: Tool Specs & Command Framework

**Date:** 2026-04-02  
**Focus:** Tool definitions, command framework, and actionable recommendations for Automation OS

---

## 1. Claw-Code Tool Inventory (19 Built-in Tools)

Every tool is defined as a `ToolSpec` struct with: name, description, JSON Schema for input, and a required permission level.

### File Operations
| Tool | Permission | Key Parameters |
|------|-----------|---------------|
| `bash` | DangerFullAccess | `command`*, `timeout`, `description`, `run_in_background`, `dangerouslyDisableSandbox` |
| `read_file` | ReadOnly | `path`*, `offset`, `limit` |
| `write_file` | WorkspaceWrite | `path`*, `content`* |
| `edit_file` | WorkspaceWrite | `path`*, `old_string`*, `new_string`*, `replace_all` |

### Search Operations
| Tool | Permission | Key Parameters |
|------|-----------|---------------|
| `glob_search` | ReadOnly | `pattern`*, `path` |
| `grep_search` | ReadOnly | `pattern`*, `path`, `glob`, `output_mode`, context flags (13 params total) |

### Web Operations
| Tool | Permission | Key Parameters |
|------|-----------|---------------|
| `WebFetch` | ReadOnly | `url`*, `prompt`* |
| `WebSearch` | ReadOnly | `query`*, `allowed_domains`, `blocked_domains` |

### Task/Session Management
| Tool | Permission | Key Parameters |
|------|-----------|---------------|
| `TodoWrite` | WorkspaceWrite | `todos`* (array of {content, activeForm, status}) |
| `Skill` | ReadOnly | `skill`*, `args` |
| `Agent` | DangerFullAccess | `description`*, `prompt`*, `subagent_type`, `model` |
| `ToolSearch` | ReadOnly | `query`*, `max_results` |

### Code Execution
| Tool | Permission | Key Parameters |
|------|-----------|---------------|
| `NotebookEdit` | WorkspaceWrite | `notebook_path`*, `cell_id`, `new_source`, `cell_type`, `edit_mode` |
| `REPL` | DangerFullAccess | `code`*, `language`*, `timeout_ms` |
| `PowerShell` | DangerFullAccess | `command`*, `timeout`, `description`, `run_in_background` |

### Communication & Config
| Tool | Permission | Key Parameters |
|------|-----------|---------------|
| `SendUserMessage` | ReadOnly | `message`*, `attachments`, `status` |
| `Config` | WorkspaceWrite | `setting`*, `value` |
| `Sleep` | ReadOnly | `duration_ms`* |
| `StructuredOutput` | ReadOnly | Any properties (open schema) |

---

## 2. Key Architecture Patterns

### 2.1 JSON Schema as Single Source of Truth
Every tool's `input_schema` is a standard JSON Schema with `additionalProperties: false`. The same schema is:
- Sent to the LLM (so it knows what parameters to provide)
- Used for runtime validation (via serde deserialization)

No separate validation layer needed — the schema IS the validation.

### 2.2 Permission-Per-Tool at Definition Time
Each tool declares its required permission as a property of its spec, not at runtime:
```
PermissionMode: ReadOnly → WorkspaceWrite → DangerFullAccess → Prompt → Allow
```
Unknown tools default to max permission (conservative). This enables filtering tool lists by permission context before exposing to the LLM.

### 2.3 Name Normalization + Alias System
Tool names are normalized (lowercase, hyphens→underscores) with common aliases mapped:
- `"read"` → `"read_file"`, `"glob"` → `"glob_search"`, etc.
Handles LLM name variations cheaply.

### 2.4 Conflict Detection at Registration Time
Plugin tools validated against built-in names during registration. Duplicates caught early with clear errors — not at execution time.

### 2.5 Pre/Post Hooks via Shell Scripts
Hooks bracket every tool execution as plain shell scripts with env vars (`HOOK_TOOL_NAME`, `HOOK_TOOL_INPUT`, etc.). Exit codes control flow: 0=allow, 2=deny, other=warn.

### 2.6 Tool Allowlist Filtering
Callers can restrict which tools are available (e.g., subagents get only `read_file` + `grep_search`). This is scope control, not just permissions.

### 2.7 Two-Tier Command Dispatch
Commands split into "pure" (return result directly — help, status) and "effectful" (need runtime context — git ops, subprocess spawning). Keeps the parsing layer testable.

### 2.8 Fuzzy Command Suggestion
4-tier ranking: exact match → prefix → contains → Levenshtein distance ≤ 2. Good UX for mistyped commands.

---

## 3. Comparison With Our Action Registry

| Aspect | Automation OS (`actionRegistry.ts`) | Claw-Code |
|--------|-------------------------------------|-----------|
| **Parameter validation** | `payloadFields` is a string array — no types, no constraints | Full JSON Schema per tool with types, required fields, min/max, formats |
| **Permission model** | `defaultGateLevel` (auto/review/block) | 5-level `PermissionMode` per tool + runtime policy |
| **MCP integration** | `McpAnnotations` (read-only, destructive, idempotent, open-world hints) | Permission level maps to similar concepts but less granular |
| **Retry policy** | Typed retry with error categories | No retry system |
| **State machine** | Full action lifecycle (proposed→executing→completed/failed) | No state machine — fire-and-forget |
| **Name handling** | Direct key lookup only | Normalization + aliases + fuzzy matching |
| **Tool filtering** | None built-in | Allowlist filtering per execution context |
| **Error taxonomy** | `retryOn`/`doNotRetryOn` with named error types | `Result<String, String>` — untyped errors |

**We're ahead on:** State machine, retry policies, error taxonomy, MCP annotations, lifecycle management.  
**They're ahead on:** Parameter schemas, name normalization, tool filtering, permission granularity.

---

## 4. Actionable Recommendations

### HIGH VALUE — Should Implement

#### 4.1 Add JSON Schema to `payloadFields`
**Current:** `payloadFields: ['to', 'subject', 'body', 'thread_id', 'provider']` — just names, no types.  
**Recommended:** Replace with a `parameterSchema` field containing a JSON Schema object:

```typescript
parameterSchema: {
  type: 'object',
  properties: {
    to: { type: 'string', format: 'email', description: 'Recipient email address' },
    subject: { type: 'string', minLength: 1, description: 'Email subject line' },
    body: { type: 'string', description: 'Email body content' },
    thread_id: { type: 'string', description: 'Thread to reply to' },
    provider: { type: 'string', enum: ['sendgrid', 'resend'] },
  },
  required: ['to', 'subject', 'body', 'provider'],
  additionalProperties: false,
}
```

**Why:** This schema serves triple duty — (1) LLM tool definition, (2) runtime validation via Zod/ajv, (3) documentation. Eliminates drift between what the LLM thinks the tool accepts and what actually validates. This is claw-code's strongest pattern.

#### 4.2 Add Name Normalization + Aliases
**Current:** Actions looked up by exact key only.  
**Recommended:** Add a `normalizeActionType()` function and an alias map:

```typescript
const ACTION_ALIASES: Record<string, string> = {
  'email': 'send_email',
  'approve': 'request_approval',
  'patch': 'write_patch',
  'test': 'run_tests',
};
```

**Why:** LLMs sometimes use shorthand or variations. Cheap insurance against tool-call failures.

#### 4.3 Add Tool Allowlist Filtering Per Agent Context
**Current:** All registered actions are available to all agents.  
**Recommended:** Add an `allowedActions` field to agent definitions or execution contexts:

```typescript
// In agent config or execution context
allowedActions?: string[];  // If set, only these actions are available
```

**Why:** A subaccount agent doing email drafting shouldn't have access to `run_command` or `write_patch`. This is scope control beyond permissions — it's about relevance and safety.

### MEDIUM VALUE — Worth Considering

#### 4.4 Add Description Field to Actions
**Current:** No `description` field on actions.  
**Recommended:** Add a human/LLM-readable description:

```typescript
description: 'Send an email via the configured provider (SendGrid or Resend)',
```

**Why:** When exposing actions as MCP tools, the description is what helps the LLM decide which tool to use. Currently this context is missing.

#### 4.5 Conservative Default for Unknown Actions
**Current:** `getActionDefinition()` returns `undefined` for unknown actions.  
**Recommended:** If an unknown action type is encountered during execution, default to `block` gate level rather than allowing it through.

**Why:** Claw-code defaults unknown tools to `DangerFullAccess` (max permission required). Same principle — fail closed, not open.

### LOW PRIORITY — File Away for Later

#### 4.6 Fuzzy Action Suggestion
If an agent requests an unknown action, suggest the closest match using Levenshtein distance. Nice UX but not critical.

#### 4.7 Pre/Post Action Hooks
Shell-based hooks that bracket action execution. Our HITL gates already serve a similar purpose, but hooks would allow custom automation (logging, notifications, transformations) without code changes.

---

## 5. Anti-Patterns to Avoid (from Claw-Code)

| Anti-Pattern | Detail | Our Status |
|-------------|--------|------------|
| `Result<String, String>` untyped errors | No error codes or categories — must string-match to handle | ✅ We already have typed error categories in `retryOn`/`doNotRetryOn` |
| No tool versioning | Schema changes break persisted sessions | ⚠️ We should consider adding a version/hash if we add JSON schemas |
| Static hardcoded tool list | Adding tools requires modifying a monolithic function | ⚠️ Our registry is also a static object — consider a builder/registration pattern if the list grows significantly |
| Split command execution | Handler returns `None` for most commands, scattering execution | ✅ Our action state machine centralizes execution flow |

---

## 6. Summary

The highest-impact takeaway from claw-code is **JSON Schema as the single source of truth for tool parameters**. Our `payloadFields` string array is the biggest gap — it provides no type information, no validation constraints, and can't be used directly as an MCP tool definition. Adding proper schemas would immediately improve LLM tool-call accuracy, runtime validation, and documentation.

The second takeaway is **tool scoping per execution context** (allowlists). As we add more agents with different responsibilities, restricting which actions each agent can see (not just permission-gating them) will reduce hallucinated tool calls and improve safety.

Everything else is incremental improvement on patterns we already do well.
