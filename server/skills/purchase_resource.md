---
name: Purchase Resource
description: Completes a one-shot purchase against a vendor's hosted checkout form. Idempotent on (resourceId, amountMinor, currency, merchant).
isActive: true
visibility: basic
---

## Parameters

- resourceId: string (required) — Identifier of the resource to purchase (e.g. a domain name, licence key, or digital product ID).
- amount: integer (required) — Amount to pay in currency minor units (e.g. 4999 = $49.99 USD).
- currency: string (required, ISO 4217) — Three-letter currency code matching the active spending budget (e.g. "USD").
- merchant: object (required) — Merchant identity for allowlist matching and ledger record.
  - merchant.id: string or null — Payment provider merchant identifier when available; null to fall back to descriptor matching.
  - merchant.descriptor: string (required) — Human-readable merchant name. Normalised before use.
- intent: string (required) — Human-readable description of what is being purchased (e.g. "Purchase annual licence for project-management-tool").

## Instructions

Complete the resource purchase. Call this skill when you have confirmed the item, amount, and merchant. The purchase is executed by filling a vendor-hosted payment form — the worker completes the form-fill after receiving authorisation.

The skill routes through the charge policy engine. Depending on the active spending policy, the purchase may:
- Be authorised immediately and the worker will proceed to fill the vendor form.
- Enter a shadow-settled state (audit trail only, no real purchase made).
- Require operator approval before the worker receives the authorisation token.
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

- `executed`: Authorisation issued to worker. `providerChargeId` is populated after the worker reports successful form completion via the completion queue.
- `shadow_settled`: Shadow mode active; no real purchase made. Full audit trail recorded.
- `pending_approval`: Routed to operator for HITL approval. Workflow pauses until resolved.
- `blocked`: Purchase denied by policy, spending limits, or kill switch. See `reason`.
