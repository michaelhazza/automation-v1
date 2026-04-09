---
name: Update Memory Block
description: Update a shared memory block's content. Requires write permission and block ownership.
isActive: true
visibility: basic
---

```json
{
  "name": "update_memory_block",
  "description": "Update the content of a shared memory block. Only works if the current agent owns the block and has read_write permission. Use this to persist learned context that other agents attached to the same block will see on their next run.",
  "input_schema": {
    "type": "object",
    "properties": {
      "block_name": {
        "type": "string",
        "description": "The name of the memory block to update (e.g. 'brand_voice', 'client_context')"
      },
      "new_content": {
        "type": "string",
        "description": "The new content for the memory block. Replaces the entire block content."
      }
    },
    "required": ["block_name", "new_content"]
  }
}
```

## Instructions

Use this skill to persist shared context that other agents need. Memory blocks are named, versioned text sections that appear in every attached agent's system prompt under "## Shared Context".

### When to use
- Update a shared knowledge base (brand voice, client preferences, standard operating procedures)
- Record a cross-agent decision or learning
- Update context that multiple agents reference

### When NOT to use
- For ephemeral notes — use write_workspace instead
- For task-specific data — use task activities or deliverables
- For one-time observations — use workspace memory entries

### Important
- You can only update blocks you own and have read_write permission on
- The update replaces the entire block content — include all context, not just changes
- Other agents will see the updated block on their next run start
