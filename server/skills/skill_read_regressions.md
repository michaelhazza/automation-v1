---
name: Read Skill Regressions
description: Query regression_cases filtered by agent and optionally by rejected call name.
isActive: true
visibility: none
---

## Parameters

- agentId: string — Filter by agent ID
- rejectedCallName: string — Optional filter by rejected tool call name
- status: string — Filter by status (default: "active")
- limit: number — Max results (default: 20)

## Instructions

Query the regression case database to find cases where an agent's tool calls were rejected by a human reviewer. These cases inform skill improvements — if a skill's definition caused a bad tool call, the regression case captures the evidence. Focus on active cases that haven't been resolved.
