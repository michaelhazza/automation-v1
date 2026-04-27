---
name: Score NPS CSAT
description: Aggregates NPS and CSAT signals, classifies trend, and surfaces at-risk segments.
isActive: true
visibility: basic
---

## Parameters

- period_start: string (required, ISO date) — Start of the scoring period.
- period_end: string (required, ISO date) — End of the scoring period.
- segment: string (optional) — Limit analysis to a specific customer segment.

## Instructions

Pull NPS and CSAT data for the period. Compute trend (improving/stable/declining). Identify at-risk segments (score < 30 for NPS, < 3 for CSAT). Return a structured report with scores, trends, and segment breakdown.
