---
name: Scan Memory Citation
description: Reads memory_citation_scores to compute per-agent low-citation rates and projected token waste over 7 days. Used by the optimiser to detect agents injecting memory blocks that are rarely cited in responses.
isActive: true
visibility: none
---

## Parameters

- subaccount_id: string (required) — UUID of the sub-account to scan.

## Output

Returns an array of `MemoryCitationRow`:
- `agent_id` — UUID of the agent.
- `low_citation_pct` — ratio 0..1 (4 decimal places) of injected blocks with low citation scores.
- `total_injected` — integer total memory blocks injected in the window.
- `projected_token_savings` — integer estimated tokens that could be saved by removing low-citation blocks.

Returns `[]` when no citation data exists for the sub-account in the window.

## Rules

- Query window: memory_citation_scores.created_at >= now() - interval '7 days'.
- Low citation: final_score below the configured threshold (cited=false).
- Returns raw data only. Citation rate threshold evaluation is done by the evaluator.
