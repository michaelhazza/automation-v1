---
name: Track Subscriptions
description: Pulls current SaaS subscription state and flags renewals or cancellations within a configurable window.
isActive: true
visibility: basic
---

## Parameters

- lookahead_days: integer (optional, default 30) — Number of days ahead to flag renewals and cancellations.
- include_cancelled: boolean (optional, default false) — Whether to include already-cancelled subscriptions.

## Instructions

Retrieve the current subscription portfolio. Flag any renewals or cancellations within the lookahead window. Return a structured list sorted by renewal date.
