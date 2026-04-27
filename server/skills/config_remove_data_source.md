---
name: Config Remove Data Source
description: Remove a data source from an agent, link, or task.
isActive: true
visibility: basic
reusable: true
---

## Parameters

- dataSourceId: string (required) — ID of the data source to remove

## Instructions

Removes a data source. The data source record is deleted; config history captures the pre-deletion state for potential restore.

### Decision Rules

1. **High-risk action**: Always confirm with the user before proceeding. State the data source name and its attached entity so the user knows exactly what will be removed.
2. **No undo**: While config history records the pre-deletion state, re-attaching requires a new config_attach_data_source call. Make sure the user understands this.
3. **Verify data source exists**: Confirm the data source ID is valid before attempting removal.
4. **Impact check**: If the data source is the only knowledge source attached to an agent or task, warn the user that the entity will have no knowledge context after removal.
