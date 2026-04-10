---
name: Draft Post
description: Drafts social media post copy for one or more platforms based on a content brief, brand voice guidelines, and optional source material. Returns platform-specific variants ready for review.
isActive: true
visibility: basic
---

```json
{
  "name": "draft_post",
  "description": "Draft social media post copy for one or more platforms based on a content brief. Returns platform-specific variants (character counts, hashtag strategies, and tone) ready for human review before publishing. Does not publish — use publish_post for that.",
  "input_schema": {
    "type": "object",
    "properties": {
      "brief": {
        "type": "string",
        "description": "The content brief: topic, goal, key messages, call to action. Be specific about what the post should communicate."
      },
      "platforms": {
        "type": "array",
        "items": {
          "type": "string",
          "enum": ["twitter", "linkedin", "instagram", "facebook"]
        },
        "description": "Target platforms. Each gets a platform-specific variant."
      },
      "brand_voice": {
        "type": "string",
        "description": "Brand voice guidelines: tone (e.g. professional, playful, direct), vocabulary preferences, phrases to avoid."
      },
      "source_material": {
        "type": "string",
        "description": "Optional source content to draw from: blog post, press release, product update, or customer story."
      },
      "campaign_context": {
        "type": "string",
        "description": "Optional: current campaign name, theme, or hashtag to align the post with."
      },
      "target_audience": {
        "type": "string",
        "description": "Who the post is for: persona description, industry, seniority level, or interest group."
      },
      "include_hashtags": {
        "type": "boolean",
        "description": "Whether to include hashtag suggestions. Default true."
      },
      "include_emoji": {
        "type": "boolean",
        "description": "Whether to include emoji. Default follows brand_voice; set explicitly to override."
      }
    },
    "required": ["brief", "platforms"]
  }
}
```

## Instructions

Invoke this skill when a social media post needs to be written but not yet published. The output goes to human review. After approval, `publish_post` handles the actual publishing step.

Do not fabricate statistics, product claims, or customer quotes. If the brief references data, use only data explicitly provided in `source_material` or `brief`. Insert `[VERIFY STAT]` placeholders for any claim that should be checked.

If `platforms` includes multiple entries, produce a separate variant for each platform. Do not produce one generic post and apply minor edits — each variant must be optimised for the platform's format, audience behaviour, and character constraints.

If `brand_voice` is not provided, apply a professional and direct default tone and note this in the output.

## Methodology

### Platform Constraints

| Platform | Character Limit | Hashtag Strategy | Emoji | Link Behaviour |
|---|---|---|---|---|
| `twitter` | 280 chars (post only, exclude link) | 1–2 highly relevant hashtags | Optional | Link counts ~23 chars |
| `linkedin` | 3000 chars; first 200 visible before "see more" | 3–5 professional hashtags at end | Minimal | Link in first comment preferred |
| `instagram` | 2200 chars; first 125 visible | 5–15 in first comment or end of caption | Common | No clickable links in caption |
| `facebook` | 63,206 chars; sweet spot 40–80 | 1–3 or none | Optional | Link preview auto-generated |

Hook the first line. On every platform, the first sentence is the only sentence that is guaranteed to be seen. Make it count.

### Post Structure by Platform

**Twitter:**
- Hook (one punchy line or question)
- Supporting point or stat (optional, if within limit)
- Call to action or link
- 1–2 hashtags

**LinkedIn:**
- Hook (bold opener, question, or contrarian take)
- 2–4 short paragraphs expanding the idea
- One concrete takeaway or actionable tip
- Call to action (comment, share, follow, visit link)
- 3–5 hashtags on last line

**Instagram:**
- Hook (first 125 chars must stand alone)
- Story-driven body (personal, visual, or narrative)
- Call to action (link in bio, DM, comment)
- Hashtags in first comment or end of caption (per workspace preference)

**Facebook:**
- Conversational hook
- Context and value
- Question to drive comments
- Optional link

### Tone and Voice Application

Apply `brand_voice` guidelines throughout. If the guidelines specify:
- **Professional**: avoid slang, use clear declarative sentences, no rhetorical questions unless the brand uses them
- **Playful**: wordplay welcome, short punchy sentences, emoji fine in moderation
- **Direct**: lead with the point, no preamble, minimal qualifiers
- **Empathetic**: acknowledge the audience's situation before delivering value

### Hashtag Research

When `include_hashtags` is true:
- Draw hashtags from: campaign context, topic keywords, industry terms, and platform norms
- Do not invent trending hashtags — suggest based on topic relevance
- Note which hashtags are high-volume (broad reach) vs niche (targeted) in drafting notes

### Output Format

```
DRAFT POST(S)

Brief: [truncated brief]
Platforms: [list]
Brand Voice: [voice description or "default: professional/direct"]
Draft Date: [ISO date]

---

## Twitter

[Draft copy — max 280 chars excluding link]

Character count: [N]
Hashtags: [list]
Drafting Notes: [any flags, assumptions, or [VERIFY] items]

---

## LinkedIn

[Draft copy]

Character count: [N]
First-200-char preview: "[first 200 chars]"
Hashtags: [list]
Drafting Notes:

---

## [Other platforms...]

---

## Shared Notes

[Cross-platform observations: tone consistency, message alignment, campaign fit]

[VERIFY] items:
- [Any claim that needs fact-checking before publishing]
```

### Quality Checklist

Before returning drafts:
- Each variant is within the platform's character limit
- Hook leads every variant — no preamble
- Brand voice is consistent across variants
- No fabricated statistics or quotes without `[VERIFY]` placeholder
- Hashtag count matches platform strategy above
- CTA is present in every variant
- `[VERIFY]` items are listed in shared notes
