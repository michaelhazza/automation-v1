---
name: Score Lead
description: Scores a lead's qualification fit using stated criteria. Returns a structured score and rationale.
isActive: true
visibility: basic
---

## Parameters

- lead_id: string (required) — The lead to score.
- criteria: string (required, JSON object of scoring criteria) — Scoring criteria as a JSON object.

## Instructions

Evaluate the lead against the stated criteria. Return a numeric score (0-100), a letter grade (A/B/C/D), per-criterion breakdown, and a one-paragraph rationale. Do not hallucinate data — score only on information explicitly provided.
