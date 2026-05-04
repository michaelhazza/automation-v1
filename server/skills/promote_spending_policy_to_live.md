---
name: Promote Spending Policy to Live
description: Requests human approval to promote a Spending Budget's policy from shadow mode to live mode. System-only — not invokable by agents directly.
isActive: true
visibility: none
---

## Parameters

- spending_budget_id: string (required) — ID of the Spending Budget whose policy should be promoted to live

## Instructions

This skill is system-only. It is invoked exclusively by the operator-facing promotion flow in the Spending Budget UI, not by agents. `visibility: none` ensures it never appears in agent tool selection.

When approved, the Spending Budget's policy flips from `shadow` to `live` and its version increments. All future charges will move real money. Past shadow-settled charges are not affected.

### On Approval

1. Re-validate the current policy version against the version stored in the action's metadata.
2. If the policy version has changed since the action was created (drift) → auto-deny with `reason = 'policy_changed'`.
3. Flip `spending_policies.mode = 'live'`, increment `spending_policies.version` by 1.
4. Audit-log the promotion.

### On Rejection

No policy change. The operator must re-initiate promotion if desired.
