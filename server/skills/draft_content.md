---
name: Draft Content
description: Drafts long-form content (blog posts, landing pages, case studies, whitepapers) from a content brief. Returns a structured draft with section headings, body copy, and SEO recommendations.
isActive: true
visibility: basic
---

## Parameters

- content_type: enum[blog_post, landing_page, case_study, whitepaper, email_newsletter] (required) — The type of content to draft
- brief: string (required) — The content brief: topic, target audience, goal, key messages, desired length, tone
- primary_keyword: string — The primary SEO keyword this content should rank for
- secondary_keywords: string — JSON array of string values. Supporting keywords to weave into the content naturally
- target_word_count: number — Target word count. Defaults by content type: blog_post=1200, landing_page=600, case_study=800, whitepaper=2000, email_newsletter=400.
- brand_voice: string — Brand voice guidelines: tone, vocabulary, phrases to avoid
- source_material: string — Optional: research, data, or existing content to draw from
- workspace_context: string — Workspace memory: product details, ICP, brand positioning, content library references

## Instructions

Invoke this skill when the Content/SEO Agent needs to produce a long-form draft. The output goes to human review before publishing.

Do not fabricate statistics, case study results, or customer quotes. Use only data from `source_material` or `workspace_context`. Insert `[VERIFY]` for any factual claim that requires checking.

If `primary_keyword` is provided, follow the SEO optimisation guidelines below. If not, produce the draft without SEO recommendations and note this in the drafting notes.

### Content Structure by Type

**Blog Post:**
- H1: Title (primary keyword near start, max 60 chars for SERP display)
- Introduction: Hook + problem statement + preview of what the reader will learn
- Body: 3–5 H2 sections with supporting H3s where needed
- Conclusion: Summary + CTA
- Estimated reading time

**Landing Page:**
- H1: Value proposition headline (benefit-led, not feature-led)
- Subheadline: Amplify the H1 promise
- Problem section: 2–3 pain points (customer language)
- Solution section: How the product resolves each pain point
- Social proof block: placeholder for testimonials/logos `[ADD SOCIAL PROOF]`
- CTA: Primary action (one CTA only)

**Case Study:**
- Client overview (anonymised if needed)
- Challenge: What problem they were solving
- Solution: What was implemented
- Results: Specific, quantified outcomes (use `[VERIFY]` if metrics are estimated)
- Quote: `[ADD CLIENT QUOTE]` placeholder
- CTA

**Whitepaper:**
- Executive summary
- Introduction: Market context and problem
- Section 1–4: Depth analysis
- Conclusion + recommendations
- About section: `[ADD COMPANY DETAILS]`

**Email Newsletter:**
- Subject line options (3 variants)
- Preview text
- Greeting + intro
- Main story/value section
- Secondary item (optional)
- CTA
- Footer placeholder

### SEO Optimisation Rules

When `primary_keyword` is provided:
1. Include the primary keyword in: title, first paragraph, one H2, meta description
2. Use secondary keywords in H2s and body paragraphs — once each, naturally
3. Target keyword density: 1–1.5% for primary (not stuffed)
4. Include an internal link placeholder `[INTERNAL LINK: topic]` for at least one related topic
5. Include an external link placeholder `[EXTERNAL LINK: authoritative source on X]` for at least one claim
6. Suggest a meta description (155 chars max) in the drafting notes

### Output Format

```
CONTENT DRAFT

Type: [content_type]
Title: [proposed title]
Primary Keyword: [keyword]
Target Word Count: [N] | Actual Word Count: [N]
Generated: [ISO date]

---

[Full content draft with H1, H2, H3 structure]

---

## Drafting Notes

SEO:
- Meta description: [155-char suggestion]
- Keyword density: [%]
- Internal link placeholders: [count]
- External link placeholders: [count]

[VERIFY] items:
- [Any claims needing verification]

[TODO] items:
- [Placeholders that need human input: social proof, quotes, images]
```

### Quality Checklist

Before returning:
- Word count is within 10% of target
- No fabricated statistics — `[VERIFY]` used
- `[TODO]` placeholders for elements the human must add
- SEO notes included if primary_keyword was provided
- Brand voice applied throughout — no generic filler phrases
