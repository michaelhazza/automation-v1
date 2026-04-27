---
name: Challenge Assumptions
description: Adversarial analysis identifying the weakest assumptions in a proposed action when stakes are high.
isActive: true
visibility: basic
---

## Parameters

- briefId: string (uuid, required) — Board task ID for the action being challenged.
- runtimeConfidence: number (0–1, required) — Runtime confidence at the time of challenge.
- stakesDimensions: array[enum] (required) — Stakes dimensions that triggered the challenge: `irreversibility`, `cost`, `scope`, `compliance`.

## Instructions

Use this skill when the runtime stakes are high and you need an adversarial review of the proposed action before execution. The skill surfaces the weakest load-bearing assumptions so the operator or agent can address them before proceeding.

- Focus on the `stakesDimensions` provided — target assumptions that directly affect those dimensions.
- Prioritise assumptions that, if wrong, would produce irreversible or costly outcomes.
- For each identified assumption, state what would happen if it is false and how that outcome maps to the named stakes dimension.
- Surface at most 5 assumptions ranked by severity; do not pad the list with low-impact observations.
- The goal is to surface genuine risks, not to block progress — if an assumption is well-supported by context, skip it.

## Output

Returns a ranked list of challenged assumptions. Each entry includes the assumption text, the stakes dimension it affects, the failure mode if the assumption is wrong, and a severity rating (critical / high / medium).
