---
name: Scan Cache Efficiency
description: Per agent, compares LLM cache creation tokens vs cached (reused) tokens over the last 7 days. Returns agents where cache creation exceeds reuse — a signal that prompt caching is not being leveraged effectively.
isActive: true
visibility: none
---

## Parameters

- subaccount_id: string (required) — UUID of the sub-account to scan.

## Output

Returns `Array<{ agent_id: string, creation_tokens: number, reused_tokens: number, dominant_skill: string }>` where:

- `agent_id` — UUID of the agent.
- `creation_tokens` — Total `cacheCreationTokens` summed across all LLM requests in the 7-day window.
- `reused_tokens` — Total `cachedPromptTokens` summed across all LLM requests in the 7-day window.
- `dominant_skill` — The skill slug responsible for the highest share of cache creation tokens.

Returns an empty array when no agents have more cache creation than reuse in the window.

## Instructions

This skill is read-only. It queries `llm_requests` over a 7-day window, grouped by agent. Only agents where `creation_tokens > reused_tokens` are returned. Findings are evaluated using the `optimiser.llm.cache_poor_reuse` evaluator.

No side effects. Read-replica safe.
