---
name: Draft Ad Copy
description: Drafts ad copy variants for a specified campaign and platform. Returns headlines, descriptions, and CTAs formatted to platform spec, ready for human review before uploading.
isActive: true
visibility: basic
---

```json
{
  "name": "draft_ad_copy",
  "description": "Draft ad copy variants for a specified campaign and platform. Returns headlines, descriptions, and calls-to-action formatted to platform spec. Output is ready for human review before being submitted via update_copy. Does not upload — use update_copy for that.",
  "input_schema": {
    "type": "object",
    "properties": {
      "campaign_name": {
        "type": "string",
        "description": "Name of the campaign this copy is for"
      },
      "platform": {
        "type": "string",
        "enum": ["google_ads", "meta_ads", "linkedin_ads"],
        "description": "Target ads platform"
      },
      "ad_format": {
        "type": "string",
        "enum": ["responsive_search_ad", "display_ad", "social_feed_ad", "sponsored_content"],
        "description": "The ad format — determines copy structure and character limits"
      },
      "brief": {
        "type": "string",
        "description": "What the ad should communicate: offer, value proposition, audience, key differentiator"
      },
      "existing_copy": {
        "type": "string",
        "description": "Optional: current ad copy to replace or improve. Include to signal this is a copy test iteration."
      },
      "performance_context": {
        "type": "string",
        "description": "Optional: performance notes from analyse_performance — e.g. low CTR, which headline underperformed"
      },
      "brand_voice": {
        "type": "string",
        "description": "Brand voice guidelines: tone, vocabulary preferences, phrases to avoid"
      },
      "landing_page_url": {
        "type": "string",
        "description": "The landing page URL this ad will point to — informs CTA and message alignment"
      },
      "variants_requested": {
        "type": "number",
        "description": "Number of copy variants to produce (default 3, max 5)"
      }
    },
    "required": ["campaign_name", "platform", "ad_format", "brief"]
  }
}
```

## Instructions

Invoke this skill when performance analysis recommends a copy test, or when new campaign copy is needed. Output goes to human review. After approval, use `update_copy` to upload the copy to the platform.

Do not fabricate product claims, statistics, or offers not present in the brief or workspace context. Insert `[VERIFY]` placeholders for any claim that must be confirmed.

Produce the number of variants specified (`variants_requested`), defaulting to 3. Each variant must be meaningfully different — not minor word substitutions. Vary the hook, value proposition angle, or CTA across variants.

## Methodology

### Platform Copy Specs

| Format | Field | Limit |
|---|---|---|
| `responsive_search_ad` (Google) | Headline | 30 chars each, up to 15 |
| | Description | 90 chars each, up to 4 |
| `display_ad` (Google) | Headline | 30 chars |
| | Long headline | 90 chars |
| | Description | 90 chars |
| `social_feed_ad` (Meta) | Primary text | 125 chars (preview), 500 max |
| | Headline | 40 chars |
| | Description | 30 chars |
| `sponsored_content` (LinkedIn) | Intro text | 150 chars (preview), 600 max |
| | Headline | 70 chars |
| | Description | 100 chars |

Stay within the preview limits for the most critical fields — text beyond the preview is not guaranteed to show.

### Copy Principles

1. **Lead with benefit, not feature**: "Reduce churn by 40%" beats "Our platform has churn prediction."
2. **CTA must be specific**: "Start Free Trial", "Book a Demo", "Get Your Report" — not "Learn More" or "Click Here."
3. **Match message to landing page**: The headline promise must be delivered on the landing page. If `landing_page_url` is provided, align the CTA and value prop.
4. **Test one variable at a time**: If `existing_copy` is provided and the brief says CTR is low, focus copy changes on the headline — keep descriptions stable.

### Copy Testing Strategy

When `existing_copy` and `performance_context` are both provided:
- Identify the underperforming element (headline, description, CTA)
- Produce 2–3 variants that change that specific element
- Keep the strong elements from the existing copy intact
- Note the test hypothesis for each variant

### Output Format

```
DRAFT AD COPY

Campaign: [campaign_name]
Platform: [platform]
Format: [ad_format]
Generated: [ISO date]
Variants: [count]

---

## Variant 1

[Format-specific fields]

Hypothesis: [What this variant tests or why it should outperform existing]

---

## Variant 2
...

---

## Copy Notes

- [VERIFY] items: [any claims that need checking]
- Landing page alignment: [confirmed / not verifiable without page access]
- Test recommendation: [which variant to prioritise if running a limited test]
```

### Quality Checklist

Before returning:
- Every variant is within platform character limits
- CTA is specific and actionable in every variant
- No fabricated statistics — `[VERIFY]` used for unconfirmed claims
- Variants are meaningfully different (not synonym swaps)
- Test hypothesis is stated for each variant
