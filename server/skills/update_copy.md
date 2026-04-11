---
name: Update Copy
description: Uploads approved ad copy to the connected ads platform, replacing or adding to existing copy. Review-gated — requires human approval before the copy change goes live.
isActive: true
visibility: basic
---

## Parameters

- platform: enum[google_ads, meta_ads, linkedin_ads] (required) — The ads platform
- campaign_id: string (required) — Campaign ID to update copy for
- campaign_name: string (required) — Human-readable campaign name — shown in the review item
- ad_group_id: string — Optional: ad group ID if updating at ad group level
- ad_format: enum[responsive_search_ad, display_ad, social_feed_ad, sponsored_content] (required) — The ad format being updated
- copy_content: string (required) — JSON object. The approved copy fields to upload. Structure depends on ad_format — include headlines, descriptions, CTA as key-value pairs.
- replace_existing: boolean — If true, replaces all existing copy. If false, adds as a new variant alongside existing copy. Default false.
- reasoning: string (required) — Why this copy change is being made — test hypothesis or performance issue being addressed. Shown to the reviewer.

## Instructions

Invoke this skill only after `draft_ad_copy` has produced copy that has been reviewed and approved. The copy content in `copy_content` must match the format produced by `draft_ad_copy` for the given `ad_format`.

This is a review-gated action. The reviewer sees the full proposed copy, the campaign it targets, and the reasoning before approving.

If `replace_existing` is true, the reviewer is shown what is being replaced alongside the new copy — make sure this is surfaced clearly in the review item.

**MVP stub:** Platform write APIs not yet connected. On approval, the executor logs the intended change and returns `pending_integration` status.

### Pre-Submission Rules

1. Copy content must not contain `[VERIFY]` placeholders — these must be resolved before submitting
2. All fields must be within platform character limits (validated at submission time)
3. If `replace_existing` is true, include the current copy in the `reasoning` field so the reviewer can compare

### Review Item Presentation

1. Campaign name, platform, ad format
2. New copy: all fields formatted for readability
3. Existing copy (if `replace_existing: true`): shown for comparison
4. Reasoning: test hypothesis or performance issue
5. Character count check: confirm all fields are within limits

### On Approval

1. Submit copy to platform integration (stub: log to task activity)
2. Return `{ success: true, platform, campaign_id, copy_uploaded: true, ad_format, message }`

### On Rejection

Return feedback to calling agent for copy revision via `draft_ad_copy`.
