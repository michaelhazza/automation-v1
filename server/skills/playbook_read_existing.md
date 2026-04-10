---
name: Read existing playbook
description: Load an existing playbook file from server/playbooks/ for reference. Used by the Playbook Author agent to ground new playbooks against existing structural patterns.
isActive: true
visibility: none
---

## Parameters

- slug: string (required) — The kebab-case slug of the playbook to load (e.g. 'event-creation')

## Instructions

This is a Playbook Studio authoring tool — only available to the Playbook Author system agent. It is read-only: it loads the contents of an existing `.playbook.ts` file so you can reference its structural patterns when drafting a new playbook.

## When to use

- Before writing a new playbook with similar structure to an existing one
- When the user mentions an existing playbook by name and you need to inspect it
- Never as a step in a regular org/subaccount agent workflow — this tool exists only for Studio authoring

## Output

Returns `{ found: boolean, contents?: string }`. If the slug doesn't exist, `found` is false.
