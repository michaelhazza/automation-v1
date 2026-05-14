---
name: Simulate Workflow run
description: Static analysis pass over a candidate definition. Returns parallelism profile, critical path length, irreversible step count, and topological order. No execution.
isActive: true
visibility: none
---

## Parameters

- definition: string (required) — JSON object. The candidate Workflow definition object.

## Instructions

Call after `workflow_validate` returns `{ ok: true }`. Use the result to summarise the Workflow for the human admin in plain English before they save:

> "Here's what I have: 6 steps, max parallelism 2, critical path 4 steps, 1 irreversible step at the end. Sound right?"

Sets accurate expectations about run cost, duration, and risk before commit.
