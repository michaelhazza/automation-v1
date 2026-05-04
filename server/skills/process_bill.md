---
name: Process Bill
description: Records an inbound bill or expense. Emits a review-gated approval for human sign-off.
isActive: true
visibility: basic
---

## Parameters

- vendor_name: string (required) — The vendor issuing the bill.
- amount: number (required) — The bill amount.
- currency: string (required, ISO 4217) — The currency code.
- invoice_date: string (required, ISO date) — The date on the invoice.
- category: string (optional) — Expense category for accounting classification.

## Instructions

Record the inbound bill. Create a review item requiring human sign-off before the expense is booked. Return the pending review item ID.
