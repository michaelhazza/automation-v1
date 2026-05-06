---
name: Top Up Balance
description: Tops up a prepaid balance or credits account via a vendor's hosted top-up form. Distinct from ad-platform budget top-ups. Idempotent on (accountId, amountMinor, currency, merchant).
isActive: true
visibility: basic
---

## Parameters

- accountId: string (required) — Identifier of the prepaid balance or credits account to top up (e.g. a vendor account ID, wallet ID, or credits account reference).
- amount: integer (required) — Amount to add to the balance in currency minor units (e.g. 10000 = $100.00 USD).
- currency: string (required, ISO 4217) — Three-letter currency code matching the active spending budget (e.g. "USD").
- merchant: object (required) — Merchant identity for allowlist matching and ledger record.
  - merchant.id: string or null — Payment provider merchant identifier when available; null to fall back to descriptor matching.
  - merchant.descriptor: string (required) — Human-readable vendor name. Normalised before use.
- intent: string (required) — Human-readable description of the top-up purpose (e.g. "Top up SMS credits balance for subaccount acme — current balance below threshold").

## Instructions

Top up the specified balance account. Call this skill when a prepaid balance falls below an operational threshold and you have confirmed the top-up amount with the operator or from retrieved balance data. The top-up is completed via a vendor-hosted form — the worker fills the form after receiving authorisation.

The skill routes through the charge policy engine. Depending on the active spending policy, the top-up may:
- Be authorised immediately and the worker will proceed to fill the vendor form.
- Enter a shadow-settled state (audit trail only, no real top-up made).
- Require operator approval before the worker receives the authorisation token.
- Be blocked by policy (allowlist, limits, or kill switch).

Do not call this skill for ad-platform budget increases; use the appropriate ad-platform skill instead.

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
- `shadow_settled`: Shadow mode active; no real top-up made. Full audit trail recorded.
- `pending_approval`: Routed to operator for HITL approval. Workflow pauses until resolved.
- `blocked`: Top-up denied by policy, spending limits, or kill switch. See `reason`.
