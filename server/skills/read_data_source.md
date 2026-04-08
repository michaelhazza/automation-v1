---
name: Read Data Source
description: List and read context data sources (agent-wide, subaccount-scoped, scheduled-task-scoped, or task-instance attachments) attached to the current run.
isActive: true
visibility: full
---

```json
{
  "name": "read_data_source",
  "description": "Access the context data sources attached to this run. Use op='list' to see what's available (including sources already loaded in the Knowledge Base and lazy sources you haven't read yet). Use op='read' with a source id to fetch content. For sources larger than the per-call token cap, use the offset and limit parameters to walk the content in chunks. Lazy sources are only loaded into your context when you explicitly read them — use this to pull in large reference files on demand without bloating the system prompt.",
  "input_schema": {
    "type": "object",
    "properties": {
      "op": {
        "type": "string",
        "enum": ["list", "read"],
        "description": "Operation to perform. 'list' returns the manifest of available sources. 'read' fetches the content of a single source by id."
      },
      "id": {
        "type": "string",
        "description": "Required when op='read'. The opaque id of the source to read (obtained from op='list')."
      },
      "offset": {
        "type": "integer",
        "minimum": 0,
        "description": "Optional when op='read'. Starting character offset into the source content (default 0). Use with 'limit' to walk large sources in chunks."
      },
      "limit": {
        "type": "integer",
        "minimum": 1,
        "description": "Optional when op='read'. Maximum number of tokens to return in a single read (default is the system per-read cap, approximately 15000 tokens). If the source is larger than this at the current offset, the response includes 'nextOffset' so you can continue."
      }
    },
    "required": ["op"]
  }
}
```

## Instructions

Use this tool to access reference materials attached to the current run. There are four scopes of sources:

- **agent** — cross-task reference material attached to the agent itself (policies, brand guidelines)
- **subaccount** — client-specific reference material for this subaccount
- **scheduled_task** — project-specific reference material for the recurring task that fired this run
- **task_instance** — one-off files uploaded to this specific board task

### When to use `op: 'list'`

- At the start of a run, to see what reference material is available before deciding how to approach the work
- When you're unsure whether a specific reference file exists for this project

### When to use `op: 'read'`

- You need the full content of a source that's marked as lazy in the manifest
- You need to re-check an exact quote from a source already loaded into your Knowledge Base
- You need a source that was skipped due to token budget pressure

### Handling large sources

Sources larger than the per-read cap return a truncated slice plus a `nextOffset` field. To read the next chunk, call `read` again with `offset: nextOffset`. Continue until `nextOffset` is null.

For most sources under 15k tokens you can ignore `offset` and `limit` entirely — just use `op: 'read'` with the source id. The slicing machinery only matters for very large sources.

### Rules

- **Eager sources are already in your Knowledge Base.** You don't usually need to re-read them. Check your system prompt first.
- **Lazy sources are NOT loaded by default.** You must explicitly read them. The manifest shows their name, scope, and approximate size — use this to decide whether to pull them.
- **Binary attachments cannot be read in v1.** If the manifest shows `[binary — not readable]`, the file exists but you cannot access its contents through this skill. Tell the user if the binary attachment is critical.
- **Be conservative with large sources.** If a lazy source is over 20KB, consider whether you really need it before fetching — it will consume your context budget.
- **Per-read size limit enforced.** A single `read` call returns at most ~15000 tokens. Larger sources require multiple reads via `offset` + `limit`, or a smarter approach (skim the list first, read only the most relevant source).

## Methodology

### Phase 1: Discovery

On any run that might need reference material, call `op: 'list'` once at the start to see what's available. Note which sources are already in your Knowledge Base (marked eager) and which are lazy.

### Phase 2: Selective retrieval

For each piece of work, ask yourself:
1. Do I already have the reference material I need in my Knowledge Base?
2. If not, which lazy source(s) would give me the context I need?
3. Can I answer without reading all of them?

Read only the sources you need. This keeps the loop efficient and avoids burning tokens on irrelevant context.

### Phase 3: Iterative lookup

If you partially answer and realise you need more context, call `op: 'read'` again with a different source id. The pool is stable across the run — the same id returns the same source every time.
