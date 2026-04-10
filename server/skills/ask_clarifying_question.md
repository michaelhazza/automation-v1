---
name: Ask Clarifying Question
description: Pause the run and ask the user a clarifying question when unsure how to proceed.
isActive: true
visibility: basic
---

## Parameters

- question: string (required) — The clarifying question to ask the user. Be specific about what you need to know.
- blocked_by: enum[topic_filter, scope_check, no_relevant_tool, low_confidence] — Why clarification is needed. Helps the system track clarification patterns.

## Instructions

Use this skill when you genuinely cannot determine the right action. Do NOT use it to delay or avoid making a decision you are reasonably confident about.

## When to use

- The user's message is ambiguous and could map to multiple very different actions
- No available tool matches the user's apparent intent
- The topic filter narrowed your tools but you are unsure which remaining tool fits
- Your confidence in the best tool choice is below 50%

## When NOT to use

- You have a reasonable guess (confidence >= 50%) — proceed with the best option
- The user's intent is clear but the phrasing is informal — interpret and act
- You already asked a clarifying question in the last 2 turns — synthesise what you know and act
