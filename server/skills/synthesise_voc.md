---
name: Synthesise VoC
description: Synthesises Voice of Customer data from multiple sources (reviews, interviews, support tickets, surveys) into a structured insight report with themes, sentiment breakdown, and strategic implications.
isActive: true
visibility: basic
---

## Parameters

- voc_data: string (required) — Raw VoC data to synthesise: customer reviews, interview transcripts, support ticket themes, NPS responses, or survey results. Include source labels for each batch of data.
- data_sources: string — JSON array of string values. List of data sources included (e.g. ['G2 reviews', 'customer interviews', 'NPS verbatims'])
- analysis_period: string — The period the data covers (e.g. 'Q1 2026', 'last 90 days')
- focus_questions: string — JSON array of string values. Optional: specific questions to answer with the synthesis (e.g. 'Why do customers churn?', 'What is the top feature request?')
- workspace_context: string — Workspace memory: product overview, ICP, known pain points from prior syntheses, strategic priorities

## Instructions

Invoke this skill when the Strategic Intelligence Agent needs to process a batch of customer feedback into structured insights. The synthesis output is the input to strategy documents, product roadmap briefs, and competitive positioning updates.

Do not fabricate customer quotes or sentiment. Every insight must be traceable to the `voc_data` input. Paraphrase themes rather than inventing them.

If `focus_questions` are provided, address each explicitly in the output — do not bury the answers in the general themes section.

When data spans multiple sources, note inter-source consistency or conflicts (e.g. "G2 reviews praise X, but NPS verbatims cite X as a pain point").

### Theme Extraction

1. Read all `voc_data` and tag each piece of feedback with:
   - Sentiment: positive / negative / neutral
   - Topic: the product area or experience being discussed
   - Signal type: praise / complaint / feature_request / churn_reason / recommendation

2. Group tags into recurring themes. A theme is valid when ≥ 3 independent data points support it.

3. Rank themes by frequency and intensity (a single vivid churn reason outweighs three mild complaints about UI).

### Sentiment Breakdown

Compute approximate percentages across the full dataset:
- % Positive (praise, recommendations, NPS promoters)
- % Negative (complaints, churn reasons, NPS detractors)
- % Neutral / Mixed

Note: this is a qualitative estimate from the text, not a precise NLP score.

### Output Format

```
VOC SYNTHESIS

Sources: [list]
Period: [analysis_period]
Data Points: [approximate count of individual feedback pieces]
Generated: [ISO date]

## Executive Summary

[3–4 sentences: overall sentiment, strongest signal, most urgent action implied]

## Sentiment Breakdown

Positive: ~[%]
Negative: ~[%]
Neutral/Mixed: ~[%]

## Top Themes

### Theme 1: [Theme Name] (Frequency: [high/medium/low])
Signal Type: [praise | complaint | feature_request | churn_reason]
Summary: [2–3 sentences describing the theme]
Representative Quotes:
> "[paraphrased or direct quote from voc_data]"
> "[another quote]"

### Theme 2: ...

## Top Praise Areas

1. [What customers consistently say is excellent]
2. ...

## Top Pain Points

1. [What customers consistently say is broken or missing]
2. ...

## Feature Requests (if present)

1. [Most requested feature or change]
2. ...

## Churn Signals (if present)

1. [Most cited churn reason]
2. ...

## Focus Questions

[If focus_questions provided:]
**Q: [question]**
A: [answer drawn from data]

## Strategic Implications

[3–5 bullet points: what this data means for product, positioning, or operations]

## Data Caveats

- [Source biases: e.g. "G2 data skews toward power users"]
- [Coverage gaps: e.g. "No enterprise customer feedback in this dataset"]
- [Time range: [any caveats about freshness]]
```

### Quality Checklist

Before returning:
- Every theme has ≥ 3 supporting data points
- No fabricated quotes — paraphrase only from actual voc_data
- Sentiment percentages noted as estimates
- Focus questions answered explicitly
- Strategic implications are specific, not generic ("improve onboarding" is too vague)
- Data caveats are honest about source limitations
