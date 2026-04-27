---
name: Read Priority Feed
description: Read, claim, or release items from the prioritized work feed.
isActive: true
visibility: basic
reusable: true
---

## Parameters

### list operation
- op: "list" (required)
- limit: number — Maximum items to return (1-50, default: 20)

### claim operation
- op: "claim" (required)
- source: string (required) — Source type of the item (health_finding, review_item, task, etc.)
- itemId: string (required) — ID of the item to claim
- ttlMinutes: number — Claim TTL in minutes (5-120, default: 30)

### release operation
- op: "release" (required)
- source: string (required) — Source type of the item
- itemId: string (required) — ID of the item to release

## Instructions

Use this skill at the start of a heartbeat run to decide what to work on next. The feed returns a scored, ranked queue of open work items across your workspace.

### Workflow
1. Call `list` to see available work items ranked by priority
2. Call `claim` on the item you will work on — this prevents other agents from duplicating effort
3. Complete the work
4. If you cannot complete the work, call `release` to make the item available again

### Scoring
Items are ranked by a composite score considering:
- **Severity**: Critical items rank highest, then warning, then info
- **Age**: Older items get progressively higher priority (up to 7 days)
- **Relevance**: Items in your subaccount rank higher than cross-subaccount items

### Rules
- Always claim before working on an item
- Release items you cannot complete
- Claims expire after the TTL (default 30 minutes) — if your run takes longer, the item becomes available again
- Do not claim multiple items simultaneously unless you can complete them all within the TTL
