---
name: Subscribe to Service
description: Completes a vendor signup and subscription against a hosted payment form. Read mirror: track_subscriptions. Idempotent on (serviceId, amountMinor, currency, merchant).
isActive: true
visibility: basic
---

## Parameters

- serviceId: string (required) — Identifier of the subscription or service tier to activate (e.g. a plan slug, product ID, or vendor-assigned service identifier).
- amount: integer (required) — Initial or recurring charge amount in currency minor units (e.g. 2999 = $29.99 USD per period).
- currency: string (required, ISO 4217) — Three-letter currency code matching the active spending budget (e.g. "USD").
- merchant: object (required) — Merchant identity for allowlist matching and ledger record.
  - merchant.id: string or null — Payment provider merchant identifier when available; null to fall back to descriptor matching.
  - merchant.descriptor: string (required) — Human-readable vendor name. Normalised before use.
- intent: string (required) — Human-readable description of the subscription purpose (e.g. "Subscribe to analytics-platform Pro plan for subaccount acme").

## Instructions

Complete the vendor signup and subscription. Call this skill when you have confirmed the service, plan, and pricing. The subscription is activated by filling a vendor-hosted payment form — the worker completes the form-fill after receiving authorisation.

The skill routes through the charge policy engine. Depending on the active spending policy, the subscription may:
- Be authorised immediately and the worker will proceed to fill the vendor form.
- Enter a shadow-settled state (audit trail only, no real subscription created).
- Require operator approval before the worker receives the authorisation token.
- Be blocked by policy (allowlist, limits, or kill switch).

Use `track_subscriptions` to verify an existing subscription before calling this skill to avoid duplicates.

## Expected Output

```json
{
  "outcome": "executed" | "shadow_settled" | "pending_approval" | "blocked",
  "chargeId": "<uuid>",
  "providerChargeId": "<string or null>",
  "reason": "<string — present when outcome is blocked>"
}
```

- `executed`: Authorisation issued to worker. `providerChargeId` is populated after the worker reports successful form completion.
- `shadow_settled`: Shadow mode active; no real subscription created. Full audit trail recorded.
- `pending_approval`: Routed to operator for HITL approval. Workflow pauses until resolved.
- `blocked`: Subscription denied by policy, spending limits, or kill switch. See `reason`.
