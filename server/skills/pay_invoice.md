---
name: Pay Invoice
description: Pays an outstanding invoice via the configured payment integration. Feeder skill for process_bill. Idempotent on (invoiceId, amountMinor, currency, merchant).
isActive: true
visibility: basic
---

## Parameters

- invoiceId: string (required) — The invoice identifier issued by the vendor or payment provider.
- amount: integer (required) — Amount to pay in currency minor units (e.g. 1999 = $19.99 USD).
- currency: string (required, ISO 4217) — Three-letter currency code matching the active spending budget (e.g. "USD").
- merchant: object (required) — Merchant identity for allowlist matching and ledger record.
  - merchant.id: string or null — Payment provider merchant identifier when available; null to fall back to descriptor matching.
  - merchant.descriptor: string (required) — Human-readable merchant name. Normalised before use.
- intent: string (required) — Human-readable description of the payment purpose (e.g. "Pay November hosting invoice #INV-2024-0042").

## Instructions

Pay the specified invoice. Call this skill only when you have a confirmed outstanding invoice and have verified the amount with the operator or from retrieved invoice data. The payment is irreversible — do not speculate on amounts.

The skill routes through the charge policy engine. Depending on the active spending policy, the payment may:
- Execute immediately (auto-approved, live mode).
- Enter a shadow-settled state (audit trail only, no real money moved).
- Require operator approval before executing.
- Be blocked by policy (allowlist, limits, or kill switch).

## Expected Output

```json
{
  "outcome": "executed" | "shadow_settled" | "pending_approval" | "blocked",
  "chargeId": "<uuid>",
  "providerChargeId": "<string or null>",
  "reason": "<string — present when outcome is blocked>"
}
```

- `executed`: Payment submitted to the payment provider. `providerChargeId` is populated when the main app executed the charge directly.
- `shadow_settled`: Shadow mode active; no real payment made. Full audit trail recorded.
- `pending_approval`: Routed to operator for HITL approval. Workflow pauses until resolved.
- `blocked`: Payment denied by policy, spending limits, or kill switch. See `reason`.
