---
name: Request Clarification
description: Route a real-time question to a named human (subaccount manager, agency owner, or client contact) via WebSocket and optionally pause the current step until they reply or the timeout fires.
isActive: true
visibility: basic
---

## Parameters

- question: string (required, 10-2000 chars) — The clarifying question addressed to the recipient. Be specific about what you need to know.
- contextSnippet: string (optional, ≤ 1000 chars) — Short context block showing the relevant input, prior belief, or conflict that prompted the question. Helps the recipient answer without reading the full run.
- urgency: enum[blocking, non_blocking] (required) — `blocking` pauses the current step (and any dependent downstream steps) until the reply arrives or `CLARIFICATION_TIMEOUT_BLOCKING_MINUTES` elapses (default 5 min). `non_blocking` fires the notification and the run continues with the agent's best guess; the answer is reconciled on the next run.
- suggestedAnswers: string[] (optional, max 5 items) — One-tap answer choices surfaced as buttons in the WebSocket notification. Free-text reply is always available.

## When to use

Use this skill when the agent encounters a real-time ambiguity that warrants a human decision mid-run:

- Contradictory beliefs with near-equal confidence (spec §4.3) — both are ≥ 0.6 and the gap is ≤ `CONFLICT_CONFIDENCE_GAP`.
- A client-domain fact the system needs but has no stored belief for.
- A proposed action that would have material client impact and the agent is under a review-gate.

Distinct from `ask_clarifying_question`:

- `ask_clarifying_question` halts the conversation in-place for the *same* user who fired the run.
- `request_clarification` routes to a *named role* (subaccount manager → agency owner → client contact) via WebSocket notification, supports timeout fallback, and allows the run to continue on a best-guess path when non-blocking.

## Routing

Routing obeys `subaccounts.clarificationRoutingConfig` (JSONB) when set, else the spec §5.4 default fallback chain:

1. Subaccount manager (if online).
2. Agency owner (if subaccount manager is offline and urgency=blocking).
3. Client contact (if portal mode=collaborative AND the question is client-domain).

## Blocking semantics

A blocking clarification pauses **only the current step**. The run is not terminated — it enters `waiting_on_clarification` state. Downstream steps that depend on the paused step's output cannot execute until either the clarification resolves or the timeout fires. Independent downstream steps proceed normally.

On timeout, the step transitions to `completed_with_uncertainty`, the run is flagged `hadUncertainty=true`, and dependent downstream steps execute against the agent's best-guess answer.
