---
name: Config Update Data Source
description: Update an existing data source's priority or content type.
isActive: true
visibility: basic
---

## Parameters

- dataSourceId: string (required) — ID of the data source to update
- name: string (optional) — Updated display name
- priority: number (optional) — Updated loading priority
- maxTokenBudget: number (optional) — Updated token budget
- cacheMinutes: number (optional) — Updated cache duration in minutes
- contentType: string (optional) — Updated MIME type

## Instructions

Updates fields on an existing data source. Only include fields that need to change.

### Decision Rules

1. **Partial updates only**: Omitted fields retain their current values. Do not reset fields to defaults.
2. **Verify data source exists**: Confirm the data source ID is valid before applying changes.
3. **Token budget changes**: Lowering the token budget may cause content truncation. Warn the user when reducing this value.
