---
name: List Connections
description: Return the active integration connections for the caller's org or a specific subaccount. Never returns secrets.
isActive: true
visibility: basic
reusable: true
---

## Parameters

- scope: string (required) — `'org'` for org-level connections, `'subaccount'` for subaccount-scoped
- orgId: string (required) — must match the caller's organisation
- subaccountId: string (optional) — required when `scope=subaccount`
- include_inactive: boolean (optional) — include revoked/expired/error connections (default false)

## Instructions

Use `list_connections` when you need to answer "what integrations does this org/subaccount have live right now?" — distinct from "what integrations does the platform support."

### When to use
- Before routing a task, to check whether the required integrations are actually connected.
- To answer user questions about which services they have hooked up.
- As input to `check_capability_gap` for full platform-vs-org capability analysis.

### When NOT to use
- Checking the platform catalogue — use `list_platform_capabilities`.
- Retrieving tokens or credentials — this skill strips all secrets.

### Output shape
Returns `connections[]` where each entry has: `id`, `slug` (provider_type), `provider_type` (oauth/mcp/webhook/native/hybrid), `status` (active/expired/revoked/error), `connected_at`, `scopes_granted`, `last_verified`.

### Permissions
System and org agents can call this skill for their own org. Subaccount agents can only call with `scope: 'subaccount'` and their own subaccount id.
