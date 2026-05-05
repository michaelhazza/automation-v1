---
name: Read existing Workflow
description: Load an existing Workflow file from server/Workflows/ for reference. Used by the Workflow Author agent to ground new Workflows against existing structural patterns.
isActive: true
visibility: none
---

## Parameters

- slug: string (required) — The kebab-case slug of the Workflow to load (e.g. 'event-creation')

## Instructions

This is a Workflow Studio authoring tool — only available to the Workflow Author system agent. It is read-only: it loads the contents of an existing `.Workflow.ts` file so you can reference its structural patterns when drafting a new Workflow.

## When to use

- Before writing a new Workflow with similar structure to an existing one
- When the user mentions an existing Workflow by name and you need to inspect it
- Never as a step in a regular org/subaccount agent workflow — this tool exists only for Studio authoring

## Output

Returns `{ found: boolean, contents?: string }`. If the slug doesn't exist, `found` is false.
