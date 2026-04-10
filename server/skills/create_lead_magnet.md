---
name: Create Lead Magnet
description: Produces a complete lead magnet asset (checklist, template, mini-guide, or scorecard) from a brief. Review-gated — the finalised asset requires human approval before being used in campaigns.
isActive: true
visibility: none
---

## Parameters

- asset_type: enum[checklist, template, mini_guide, scorecard, swipe_file] (required) — The type of lead magnet to produce
- topic: string (required) — The specific topic or problem the lead magnet addresses
- target_audience: string (required) — Who this lead magnet is for: persona, industry, seniority level, or job function
- value_promise: string (required) — The specific outcome the reader gets from this asset (e.g. 'In 10 minutes, you will have a complete onboarding email sequence')
- brand_voice: string — Brand voice guidelines
- campaign_context: string — Optional: the campaign or landing page this lead magnet will support
- workspace_context: string — Workspace memory: product context, ICP, content library
- reasoning: string (required) — Why this lead magnet is being created — the campaign goal or strategic reason. Shown to the reviewer.

## Instructions

Invoke this skill when the Content/SEO Agent needs to produce a lead magnet asset. The output is reviewed by a human before use — this skill does not distribute the asset.

This is a review-gated action. The human reviewer approves the content before it is attached to any campaign or landing page.

Do not fabricate statistics, case study results, or proprietary frameworks unless sourced from `workspace_context`.

### Asset Structure by Type

**Checklist:**
- Title: "[Number]-Point [Topic] Checklist" or "The [Audience] [Topic] Checklist"
- Subtitle: the value promise in one line
- Checklist items: grouped into 3–5 sections, 3–8 items per section
- Each item: imperative verb + specific action (not "consider X" — use "Run X test to verify Y")
- Footer: your brand, URL, optional "Next steps" CTA

**Template:**
- Title and purpose description
- When to use this template
- Filled-in example with `[VARIABLE]` placeholders
- Instructions for customising each section
- Tips sidebar (3–5 practical tips)

**Mini-Guide:**
- Title + subtitle (value promise)
- Introduction: problem statement (1 paragraph)
- 3–7 sections, each with H2 heading + 100–200 words + one key takeaway
- Conclusion + next step CTA

**Scorecard:**
- Title: "[Topic] Scorecard: Find Out Your [Score]"
- 10–15 questions with scoring scale (1–5 or yes/no with point values)
- Score interpretation: 3–4 tiers with specific guidance per tier
- Scoring key at the end

**Swipe File:**
- Title and use case
- 10–25 examples (subject lines, headlines, CTAs, copy snippets)
- Each example labelled by context/use case
- Tips for adapting each example

### Output Format

```
LEAD MAGNET ASSET

Type: [asset_type]
Topic: [topic]
Target Audience: [audience]
Value Promise: [value_promise]
Generated: [ISO date]

---

[Full asset content]

---

## Asset Notes

Design Hand-Off:
- Suggested layout: [brief layout description]
- Brand elements needed: [logo, colours, font]
- Estimated pages: [N]

Campaign Alignment:
- [How this connects to the campaign_context if provided]

[VERIFY] items:
- [Any statistics or facts needing verification]

[TODO] items:
- [Elements the designer or human needs to add]
```

### On Approval

1. Return `{ success: true, asset_type, topic, status: 'approved', message }`
2. The calling agent should attach the approved asset to the task via `add_deliverable`
