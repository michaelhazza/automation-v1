---
name: Scan Escalation Phrases
description: Tokenises review_items.review_payload_json over 7 days and counts n-gram phrases. Returns phrases that appear 3 or more times, indicating recurring escalation topics that may benefit from brand-voice or playbook tuning.
isActive: true
visibility: none
---

## Parameters

- subaccountId: string (required) — UUID of the sub-account to scan.
- organisationId: string (required) — UUID of the organisation owning the sub-account.

## Output

Returns an array of `EscalationPhrasesRow`:
- `phrase` — the recurring phrase (lowercased, stop-words removed).
- `count` — integer number of occurrences in the 7-day window.
- `sample_escalation_ids` — ascending-sorted array of escalation IDs that contained this phrase.

Returns `[]` when no phrases meet the minimum occurrence threshold.

## Evaluator

Output is processed by the `repeatPhrase` evaluator (`server/services/optimiser/recommendations/repeatPhrase.ts`).

## Rules

- Query window: review_items.created_at >= now() - interval '7 days'.
- Tokeniser: lowercase, strip punctuation, suffix-strip -ing/-ed/-s, exclude stop-words.
- Minimum threshold: count >= 3.
- Returns raw data only. Evaluation is done by the evaluator module.
