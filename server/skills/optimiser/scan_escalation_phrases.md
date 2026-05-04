---
name: Scan Escalation Phrases
description: Tokenises review item payloads over the last 7 days and groups by phrase. Returns phrases that appear in 3 or more distinct escalations — signals recurring patterns that may indicate a workflow or prompt issue.
isActive: true
visibility: none
---

## Parameters

- subaccount_id: string (required) — UUID of the sub-account to scan.

## Output

Returns `Array<{ phrase: string, count: number, sample_escalation_ids: string[] }>` where:

- `phrase` — The repeated phrase extracted from escalation payloads.
- `count` — Number of distinct escalations containing this phrase.
- `sample_escalation_ids` — Up to 3 representative `review_items` IDs containing the phrase.

Returns an empty array when no phrases reach the occurrence threshold in the window.

## Instructions

This skill is read-only. It queries `review_items.reviewPayloadJson` over a 7-day window, tokenises the text, groups by normalised phrase, and returns phrases with count >= 3. Findings are evaluated using the `optimiser.escalation.repeat_phrase` evaluator.

No side effects. Read-replica safe.
