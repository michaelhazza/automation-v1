---
name: Config Attach Data Source
description: Attach a knowledge source (URL or uploaded file) to an agent, subaccount link, or scheduled task.
isActive: true
visibility: basic
---

## Parameters

- name: string (required) — Display name for the data source
- sourceType: enum (required) — One of: http_url, file_upload
- sourcePath: string (required) — URL or file path to the content
- contentType: string (optional) — MIME type of the content
- priority: number (optional) — Loading priority (lower numbers load first)
- maxTokenBudget: number (optional) — Maximum tokens to allocate for this source
- cacheMinutes: number (optional) — Minutes to cache the fetched content
- agentId: string (conditional) — Attach to an org-level agent
- subaccountAgentId: string (conditional) — Attach to a subaccount-agent link
- scheduledTaskId: string (conditional) — Attach to a scheduled task

## Instructions

Attaches a knowledge data source to an entity. HTTP URLs are fetched at load time; file uploads reference previously uploaded files.

### Decision Rules

1. **Exactly one target**: Exactly one of agentId, subaccountAgentId, or scheduledTaskId must be provided. Reject requests that specify zero or multiple targets.
2. **Token budget**: Set maxTokenBudget to avoid a single large source consuming the agent's entire context window.
3. **Cache duration**: For URLs that change frequently, use a lower cacheMinutes value. For stable reference material, a higher cache value reduces fetch overhead.
4. **Verify source**: For http_url sources, confirm the URL is accessible before attaching.
