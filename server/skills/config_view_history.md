---
name: Config View History
description: List version history for a given entity (entity type + entity ID).
isActive: true
visibility: none
---

## Parameters

- entityType: string (required) — The type of entity to retrieve history for.
- entityId: string (required) — The ID of the entity.
- limit: number (optional, default 20) — Maximum number of history entries to return.

## Instructions

Returns the version history for a configuration entity. Shows version number, change timestamp, who made the change, change source (ui, api, config_agent, restore), and a summary of what changed. Use this when the user asks about previous configurations or wants to understand what changed.
