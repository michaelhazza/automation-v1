---
name: List My Subordinates
description: Returns the agent's immediate children (scope=children) or full subtree (scope=descendants, depth ≤ 3). Reads system_agents directly — no external API.
isActive: true
visibility: none
---

## Parameters

- scope: string (required, enum: children|descendants) — Use children for immediate reports only. Use descendants for the full subtree (max depth 3).
- include_inactive: boolean (default false) — Whether to include inactive agents in the result.

## Instructions

Return the list of system agents that directly or transitively report to the calling agent. Use scope=children for immediate reports only. Use scope=descendants for the full subtree (max depth 3).
