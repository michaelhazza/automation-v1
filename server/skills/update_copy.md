---
name: Update Copy
description: Uploads approved ad copy to the connected ads platform, replacing or adding to existing copy. Review-gated — requires human approval before the copy change goes live.
isActive: true
visibility: none
---

```json
{
  "name": "update_copy",
  "description": "Upload approved ad copy to the connected ads platform. This is a review-gated action — it enters the approval queue and does NOT apply immediately. A human must approve it before the copy change is submitted to the platform.",
  "input_schema": {
    "type": "object",
    "properties": {
      "platform": {
        "type": "string",
        "enum": ["google_ads", "meta_ads", "linkedin_ads"],
        "description": "The ads platform"
      },
      "campaign_id": {
        "type": "string",
        "description": "Campaign ID to update copy for"
      },
      "campaign_name": {
        "type": "string",
        "description": "Human-readable campaign name — shown in the review item"
      },
      "ad_group_id": {
        "type": "string",
        "description": "Optional: ad group ID if updating at ad group level"
      },
      "ad_format": {
        "type": "string",
        "enum": ["responsive_search_ad", "display_ad", "social_feed_ad", "sponsored_content"],
        "description": "The ad format being updated"
      },
      "copy_content": {
        "type": "object",
        "description": "The approved copy fields to upload. Structure depends on ad_format — include headlines, descriptions, CTA as key-value pairs.",
        "additionalProperties": true
      },
      "replace_existing": {
        "type": "boolean",
        "description": "If true, replaces all existing copy. If false, adds as a new variant alongside existing copy. Default false."
      },
      "reasoning": {
        "type": "string",
        "description": "Why this copy change is being made — test hypothesis or performance issue being addressed. Shown to the reviewer."
      }
    },
    "required": ["platform", "campaign_id", "campaign_name", "ad_format", "copy_content", "reasoning"]
  }
}
```

## Instructions

Invoke this skill only after `draft_ad_copy` has produced copy that has been reviewed and approved. The copy content in `copy_content` must match the format produced by `draft_ad_copy` for the given `ad_format`.

This is a review-gated action. The reviewer sees the full proposed copy, the campaign it targets, and the reasoning before approving.

If `replace_existing` is true, the reviewer is shown what is being replaced alongside the new copy — make sure this is surfaced clearly in the review item.

**MVP stub:** Platform write APIs not yet connected. On approval, the executor logs the intended change and returns `pending_integration` status.

## Methodology

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
