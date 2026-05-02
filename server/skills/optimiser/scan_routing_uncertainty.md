---
name: Scan Routing Uncertainty
description: Reads fast_path_decisions to compute per-agent low-confidence routing rates and second-look trigger rates over 7 days. Used by the optimiser to detect agents where routing is frequently uncertain.
isActive: true
visibility: none
---

## Parameters

- subaccountId: string (required) — UUID of the sub-account to scan.
- organisationId: string (required) — UUID of the organisation owning the sub-account.

## Output

Returns an array of `RoutingUncertaintyRow`:
- `agent_id` — UUID of the agent.
- `low_confidence_pct` — ratio 0..1 (4 decimal places) of decisions below the confidence threshold.
- `second_look_pct` — ratio 0..1 (4 decimal places) of decisions that triggered a second-look escalation.
- `total_decisions` — integer raw row count (required for materialDelta volume floor).

Returns `[]` when no routing decision data exists for the sub-account in the window.

## Evaluator

Output is processed by the `routingUncertainty` evaluator (`server/services/optimiser/recommendations/routingUncertainty.ts`).

## Rules

- Query window: fast_path_decisions.decided_at >= now() - interval '7 days'.
- Low confidence threshold: confidence score below 0.7.
- Minimum volume: evaluator requires total_decisions >= 50 before flagging.
- Returns raw data only. Threshold evaluation is done by the evaluator.
