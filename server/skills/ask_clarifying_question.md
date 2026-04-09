---
name: Ask Clarifying Question
description: Pause the run and ask the user a clarifying question when unsure how to proceed.
isActive: true
visibility: basic
---

```json
{
  "name": "ask_clarifying_question",
  "description": "Pause the current run and ask the user a clarifying question. Use this when you are unsure which action to take, the user's request is ambiguous, or your confidence in the correct tool is low. The run will pause until the user responds.",
  "input_schema": {
    "type": "object",
    "properties": {
      "question": {
        "type": "string",
        "description": "The clarifying question to ask the user. Be specific about what you need to know."
      },
      "blocked_by": {
        "type": "string",
        "enum": ["topic_filter", "scope_check", "no_relevant_tool", "low_confidence"],
        "description": "Why clarification is needed. Helps the system track clarification patterns."
      }
    },
    "required": ["question"]
  }
}
```

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
