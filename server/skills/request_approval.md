---
name: Request Approval
description: Escalate a decision to a human operator for review and approval.
isActive: true
---

```json
{
  "name": "request_approval",
  "description": "Escalate a decision or action to a human operator for review and approval. Use this when autonomous resolution is not possible. This is a review-gated action — it queues for human attention and does not execute immediately.",
  "input_schema": {
    "type": "object",
    "properties": {
      "title": { "type": "string", "description": "Short title describing what needs approval" },
      "description": { "type": "string", "description": "Detailed description of the situation and what you are requesting" },
      "context": { "type": "string", "description": "Full context the human needs to decide: what you tried, what failed, why you need input, what happens with each option" },
      "options": {
        "type": "array",
        "description": "Possible options for the human to choose from",
        "items": {
          "type": "object",
          "properties": {
            "label": { "type": "string", "description": "Short label for this option" },
            "description": { "type": "string", "description": "What this option means and its consequences" }
          },
          "required": ["label"]
        }
      }
    },
    "required": ["title", "description", "context"]
  }
}
```

## Instructions

Use `request_approval` when autonomous resolution is genuinely not possible. Always include full context — the reviewer may not have been following your progress. Provide clear options to make the decision as easy as possible. This call blocks the current task until a human responds.

## Methodology

### Escalation Hierarchy
Escalation is a 4-level system. Move to the next level only when the current level cannot resolve the issue:

| Level | Action | When |
|---|---|---|
| 1 | Retry | First failure — attempt a different approach once |
| 2 | Escalate to Orchestrator | After 2 failed attempts — write a blocked note and signal the Orchestrator |
| 3 | Request human approval | Orchestrator cannot resolve — use this skill |
| 4 | Halt permanently | Human approval not received after a reasonable window — log state and mark task as escalated |

### Unified Triggers (any agent)
Any of the following forces immediate Level 3 escalation regardless of current iteration:
- Iteration limit reached (>3 QA cycles, >2 Dev repair cycles, >5 total cycles)
- Result fingerprint unchanged for 2 consecutive QA cycles
- QA confidence < 0.5
- Test run limit (`maxTestRunsPerTask`) reached
- Critical severity bug in the shipping path
- No active agent capable of handling the required next step
- Patch rejected twice for the same file and intent
- DEC safeMode enabled unexpectedly

### Writing Good Escalations
1. **Be specific**: State exactly what needs the human to decide or provide.
2. **Show your work**: Include what you tried, what failed, and why you are stuck.
3. **Offer options**: Provide 2-3 concrete choices where possible.
4. **Estimate consequences**: For each option, briefly describe what happens next.
5. **Preserve state**: Before escalating, write your current state to the task board so work can resume after the human responds.

### Decision Rules
- Escalate early rather than late — do not spin in a loop.
- One escalation per blocker — do not create multiple approval requests for the same issue.
- Always log state to the board before escalating.
