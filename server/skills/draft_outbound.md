---
name: Draft Outbound
description: Drafts a 1:1 outbound message (cold email or LinkedIn) for a prospect. Returns text and tone score.
isActive: true
visibility: basic
---

## Parameters

- prospect_name: string (required) — Full name of the prospect.
- company: string (required) — Prospect's company name.
- channel: string (required, enum: email|linkedin) — The outbound channel.
- value_proposition: string (required) — The core value proposition to communicate.
- context: string (optional) — Additional context about the prospect or account.

## Instructions

Draft a personalised outbound message for the prospect. Return the draft text, tone score (1-10 on warmth/professionalism), and any suggested subject line for email. Keep it concise — under 150 words.
