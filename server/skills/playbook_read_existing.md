---
name: Read existing playbook
description: Load an existing playbook file from server/playbooks/ for reference. Used by the Playbook Author agent to ground new playbooks against existing structural patterns.
isActive: true
visibility: none
---

```json
{
  "name": "playbook_read_existing",
  "description": "Load the contents of an existing playbook file from server/playbooks/<slug>.playbook.ts. Returns the full TypeScript source. Use this when you want to reference the structural pattern of an existing playbook before drafting a new one. The slug must match an existing file (use playbook_list_existing to discover available slugs).",
  "input_schema": {
    "type": "object",
    "properties": {
      "slug": {
        "type": "string",
        "description": "The kebab-case slug of the playbook to load (e.g. 'event-creation')"
      }
    },
    "required": ["slug"]
  }
}
```

## Instructions

This is a Playbook Studio authoring tool — only available to the Playbook Author system agent. It is read-only: it loads the contents of an existing `.playbook.ts` file so you can reference its structural patterns when drafting a new playbook.

## When to use

- Before writing a new playbook with similar structure to an existing one
- When the user mentions an existing playbook by name and you need to inspect it
- Never as a step in a regular org/subaccount agent workflow — this tool exists only for Studio authoring

## Output

Returns `{ found: boolean, contents?: string }`. If the slug doesn't exist, `found` is false.
