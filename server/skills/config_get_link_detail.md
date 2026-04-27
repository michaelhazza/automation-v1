---
name: Config Get Link Detail
description: Get full configuration detail for a specific subaccount agent link.
isActive: true
visibility: basic
---

## Parameters

- linkId: string (required) — The subaccount agent link to retrieve details for.
- subaccountId: string (required) — The subaccount the link belongs to.

## Instructions

Returns the complete subaccount agent link record including all override fields, skills, schedule, and limits. Use this to understand a link's full configuration before making changes.
