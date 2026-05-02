---
name: Scan Cache Efficiency
description: Reads llm_requests cache token columns to compute per-agent LLM prompt cache reuse ratios over 7 days. Used by the optimiser to detect agents with low cache reuse that could benefit from prompt structure improvements.
isActive: true
visibility: none
---

## Parameters

- subaccount_id: string (required) — UUID of the sub-account to scan.

## Output

Returns an array of `CacheEfficiencyRow`:
- `agent_id` — UUID of the agent.
- `creation_tokens` — integer sum of cache_creation_tokens in the window.
- `reused_tokens` — integer sum of cached_prompt_tokens in the window.
- `dominant_skill` — feature_tag with the highest total token cost in the window.

Returns `[]` when no LLM request data exists for the sub-account in the window.

## Rules

- Query window: llm_requests.created_at >= now() - interval '7 days'.
- Reuse ratio: reused_tokens / (creation_tokens + reused_tokens).
- Evaluator triggers when reuse ratio < 20%.
- Returns raw data only. Ratio threshold evaluation is done by the evaluator.
