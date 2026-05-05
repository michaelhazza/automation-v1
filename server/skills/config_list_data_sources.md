---
name: Config List Data Sources
description: List data sources attached to a given agent, link, or task.
isActive: true
visibility: basic
---

## Parameters

- agentId: string (optional) — The agent to list data sources for.
- subaccountAgentId: string (optional) — The subaccount agent link to list data sources for.
- scheduledTaskId: string (optional) — The scheduled task to list data sources for.

## Instructions

Returns data sources attached to the specified entity. Provide exactly one of agentId, subaccountAgentId, or scheduledTaskId. Shows name, source type, source path, loading mode, and priority.
