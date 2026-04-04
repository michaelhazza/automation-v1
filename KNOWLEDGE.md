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

### 2026-04-04 Decision — Injected middleware messages use role: 'user' not role: 'system'

Anthropic's Messages API only supports `system` as the top-level parameter, not as mid-conversation messages. Context pressure warnings are injected as `role: 'user'` with a `[SYSTEM]` prefix. This is the correct pattern — `role: 'system'` inside the messages array would cause an API error.

### 2026-04-04 Pattern — Persist execution phase to agentRuns for observability

The agentic loop already computes `phase` ('planning' | 'execution' | 'synthesis') per iteration in `agentExecutionService.ts` (line ~940). Consider persisting this to the `agent_runs` row for debugging and post-mortem analysis. Deferred to next sprint — would require a schema change.
