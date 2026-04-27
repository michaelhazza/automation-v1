---
name: Config Restore Version
description: Restore an entity to a previous version from config history.
isActive: true
visibility: basic
reusable: true
---

## Parameters

- entityType: string (required) — The type of entity to restore.
- entityId: string (required) — The ID of the entity to restore.
- version: number (required) — The version number to restore to.

## Instructions

Restores an entity to a previous version. This is a high-risk action requiring user approval. Restore creates a NEW version with the content of the target version — it does not delete intermediate versions. History is always append-only.

Before restoring, verify that foreign key references in the snapshot still exist (e.g., agents referenced in a subaccount_agent snapshot have not been deleted). Show the user what will change before proceeding.
