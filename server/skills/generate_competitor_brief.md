---
name: Generate Competitor Brief
description: Researches a competitor and produces a structured intelligence brief covering product positioning, pricing, recent moves, strengths, and weaknesses. Uses web search to verify current information.
isActive: true
visibility: basic
---

```json
{
  "name": "generate_competitor_brief",
  "description": "Research a competitor and produce a structured intelligence brief: product positioning, pricing, recent moves (funding, launches, partnerships), strengths, weaknesses, and strategic implications. Uses web_search to verify current information. Returns a structured brief for use in strategy documents and VoC synthesis.",
  "input_schema": {
    "type": "object",
    "properties": {
      "competitor_name": {
        "type": "string",
        "description": "Name of the competitor to research"
      },
      "competitor_url": {
        "type": "string",
        "description": "Competitor website URL — used to anchor web searches"
      },
      "research_focus": {
        "type": "array",
        "items": {
          "type": "string",
          "enum": ["pricing", "product_features", "positioning", "recent_news", "customer_reviews", "team_and_funding"]
        },
        "description": "Specific areas to focus the research. If omitted, covers all areas."
      },
      "our_positioning": {
        "type": "string",
        "description": "Our product's positioning and value proposition — used to frame the competitive comparison"
      },
      "workspace_context": {
        "type": "string",
        "description": "Workspace memory: ICP, target market, known competitive dynamics, prior briefs on this competitor"
      }
    },
    "required": ["competitor_name"]
  }
}
```

## Instructions

Invoke this skill when the Strategic Intelligence Agent needs a competitive brief. Use `web_search` to retrieve current information — do not rely on training data for competitor pricing, features, or recent news, as these change frequently.

Run at least 2 web searches: one for the competitor's current product/pricing page, and one for recent news (funding, product launches, partnerships). Add more searches for specific `research_focus` areas.

Do not fabricate competitive intelligence. If information cannot be verified via web search, mark it as `unverified` and note the source gap. Use `[VERIFY]` for claims that need more recent data.

The brief is intelligence, not opinion. Present findings as factual observations, not strategic recommendations — those belong in a separate analysis layer.

## Methodology

### Research Checklist

For each `research_focus` area:

**Pricing:**
- Current pricing tiers and price points
- Free tier or trial offering
- Recent pricing changes (search for "[competitor] pricing change [year]")

**Product Features:**
- Core feature set (from product page)
- Recent feature launches (from changelog or blog)
- Notable gaps vs our product

**Positioning:**
- Tagline and headline value proposition
- Target customer segment
- Key messaging themes

**Recent News:**
- Funding rounds (amount, investor, date)
- Product launches
- Partnerships or acquisitions
- Executive changes

**Customer Reviews:**
- Overall rating (G2, Capterra, Trustpilot)
- Top praise themes
- Top complaint themes

**Team and Funding:**
- Headcount (LinkedIn estimate)
- Total funding raised
- Key investors

### Output Format

```
COMPETITOR BRIEF

Competitor: [name]
URL: [url]
Research Date: [ISO date]
Focus Areas: [list]

---

## Executive Summary
[3–4 sentences: who they are, what they do, and the most important strategic implication]

## Product & Pricing

### Pricing
[Tier breakdown with prices. Mark as [VERIFY] if not from official pricing page.]

### Key Features
- [feature]: [description]
- [feature]: [description]

### Positioning
Tagline: "[tagline]"
Target Segment: [description]
Key Messages: [list]

## Recent Developments
- [date]: [event — funding, launch, partnership, etc.]
- [Unverified / no recent news found]

## Strengths
- [strength]: [evidence]

## Weaknesses
- [weakness]: [evidence from reviews or gaps]

## Competitive Implications
[How does this competitor compare to our positioning? Where do we win, where do we lose?]
Only include if our_positioning was provided — otherwise omit this section.

## Sources
- [URL]: [what was retrieved]
- [URL]: [what was retrieved]

## Gaps
- [Any research_focus area where data could not be verified]
```

### Quality Checklist

Before returning:
- At least 2 web searches completed
- Pricing marked `[VERIFY]` if not from official pricing page
- No fabricated features, pricing, or events
- Sources listed for all major claims
- Gaps section lists any unverifiable areas
