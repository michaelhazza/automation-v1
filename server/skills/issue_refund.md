---
name: Issue Refund
description: Issues a refund against a prior charge. Creates a new inbound-refund ledger row; does not mutate the original charge record. Idempotent on (parentChargeId, amountMinor, currency, merchant).
isActive: true
visibility: basic
---

## Parameters

- parentChargeId: string (required) — UUID of the original `agent_charges` row to refund against. Must be in `succeeded` status.
- amount: integer (required) — Amount to refund in currency minor units (e.g. 1999 = $19.99 USD). Must not exceed the original charge amount.
- currency: string (required, ISO 4217) — Three-letter currency code. Must match the currency of the original charge.
- merchant: object (required) — Merchant identity matching the original charge, for allowlist matching and ledger record.
  - merchant.id: string or null — Payment provider merchant identifier when available; null to fall back to descriptor matching.
  - merchant.descriptor: string (required) — Human-readable merchant name. Normalised before use.
- intent: string (required) — Human-readable description of the refund reason (e.g. "Refund duplicate invoice payment INV-2024-0042 — $19.99 USD").

## Instructions

Issue a refund against a prior charge. Call this skill only when you have confirmed the original charge ID and refund amount. The refund creates a new ledger row with direction `inbound_refund`; the original charge record is not modified.

The skill routes through the charge policy engine. Depending on the active spending policy, the refund may:
- Execute immediately (auto-approved, live mode).
- Enter a shadow-settled state (audit trail only, no real refund issued).
- Require operator approval before executing.
- Be blocked by policy or kill switch.

Do not use this skill for dispute-driven chargebacks; those are handled automatically via the payment provider webhook stream.

## Expected Output

```json
{
  "outcome": "executed" | "shadow_settled" | "pending_approval" | "blocked",
  "chargeId": "<uuid>",
  "providerChargeId": "<string or null>",
  "reason": "<string — present when outcome is blocked>"
}
```

- `executed`: Refund submitted to the payment provider. `providerChargeId` is the refund identifier issued by the provider.
- `shadow_settled`: Shadow mode active; no real refund issued. Full audit trail recorded.
- `pending_approval`: Routed to operator for HITL approval. Workflow pauses until resolved.
- `blocked`: Refund denied by policy or kill switch. See `reason`.
