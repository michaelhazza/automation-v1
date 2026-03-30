---
name: Request Approval
description: Escalate a decision to a human operator for review and approval.
isActive: true
---

```json
{
  "name": "request_approval",
  "description": "Escalate a decision or action to a human operator for review and approval. Use this when you cannot proceed autonomously, when the stakes are too high, or when explicit human sign-off is required.",
  "input_schema": {
    "type": "object",
    "properties": {
      "title": { "type": "string", "description": "Short title describing what needs approval" },
      "description": { "type": "string", "description": "Detailed description of the situation and what you are requesting" },
      "context": { "type": "string", "description": "Full context the human needs to make an informed decision: what you have tried, what you found, why you need their input" },
      "options": {
        "type": "array",
        "description": "Possible options for the human to choose from (optional but recommended)",
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

Use request_approval when you cannot proceed autonomously. This blocks the current task until a human responds. Always include full context — the human may not have been following your progress. Provide clear options when possible to make the decision easier.

## Methodology

### When to Escalate
- A required action has destructive or irreversible consequences.
- You have reached the maximum retry or iteration limit.
- Conflicting instructions that cannot be resolved without human judgement.
- You lack the permissions or credentials needed to proceed.
- The task scope has changed significantly from the original brief.

### Writing Good Escalations
1. **Be specific**: State exactly what you need the human to decide or provide.
2. **Show your work**: Include what you tried, what you found, and why you are stuck.
3. **Offer options**: Give the human 2-3 concrete choices where possible.
4. **Estimate consequences**: For each option, briefly describe what will happen next.

### Decision Rules
- **Escalate early rather than late**: Do not spin in a loop; escalate after 2-3 failed attempts.
- **One escalation per blocker**: Do not create multiple approval requests for the same issue.
- **Do not abandon the task**: Log your state to the board before escalating so work can resume.
