---
name: Generate Invoice
description: Builds an invoice from an engagement record and billing schedule. Returns a structured invoice and idempotency key.
isActive: true
visibility: basic
---

## Parameters

- engagement_id: string (required) — The engagement record to invoice.
- billing_schedule_id: string (required) — The billing schedule to apply.
- period_start: string (required, ISO date) — Start of the billing period.
- period_end: string (required, ISO date) — End of the billing period.

## Instructions

Generate an invoice for the specified engagement and billing period. Return a structured invoice object including line items, totals, and an idempotency key. The invoice is not sent until send_invoice is called.
