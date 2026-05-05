---
name: Send Invoice
description: Delivers an invoice via the configured channel (Stripe / email). Returns not_configured if no provider is set up.
isActive: true
visibility: basic
---

## Parameters

- invoice_id: string (required) — The invoice to send.
- channel: string (optional, enum: stripe|email) — The delivery channel. Defaults to the configured provider.

## Instructions

Send the specified invoice using the configured delivery channel. If no provider is configured, return status=not_configured. This skill is idempotent — re-sending an already-sent invoice returns the original send result.
