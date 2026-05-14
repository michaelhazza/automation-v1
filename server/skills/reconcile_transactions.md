---
name: Reconcile Transactions
description: Matches Stripe payouts against accounting records and surfaces mismatches as a structured diff.
isActive: true
visibility: basic
---

## Parameters

- period_start: string (required, ISO date) — Start of the reconciliation period.
- period_end: string (required, ISO date) — End of the reconciliation period.
- account_id: string (optional) — Limit reconciliation to a specific account.

## Instructions

Pull Stripe payouts and accounting records for the period. Match them by amount and date. Return a structured diff listing matched, unmatched, and partial-match items.
