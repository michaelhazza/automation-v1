---
name: Search Agent History
description: Search memories and learnings across all agents in the workspace via semantic vector search.
isActive: true
visibility: basic
---

## Parameters

### search operation
- op: "search" (required)
- query: string (required) — Natural language search query (1-1000 chars)
- includeOtherSubaccounts: boolean — Search across all subaccounts in the org (default: false)
- topK: number — Maximum results to return (1-50, default: 10)

### read operation
- op: "read" (required)
- memoryId: string (required) — UUID of the memory entry to read

## Instructions

Use this skill to find what other agents in your workspace have learned, observed, or decided. This enables cross-agent knowledge sharing without requiring agents to be in the same subaccount.

### When to use
- Before starting a task, check if another agent has already gathered relevant information
- When you need context about a client, project, or decision that another agent may have recorded
- To avoid duplicating work that a previous agent run already completed
- To find patterns or preferences that were discovered by specialist agents

### Search tips
- Use natural language queries that describe what you are looking for
- Set `includeOtherSubaccounts: true` when searching for org-wide knowledge
- Use the `read` operation to get the full content of a specific memory entry from search results
- Results are ranked by semantic similarity — the most relevant memories appear first

### Example workflow
1. Search for relevant memories: `{ op: "search", query: "client preferences for reporting format" }`
2. Review the results and identify the most relevant entry
3. Read the full entry if needed: `{ op: "read", memoryId: "uuid-from-results" }`
4. Incorporate the knowledge into your current task
