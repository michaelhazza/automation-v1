---
name: Triage Intake
description: Captures ideas, feature requests, and bugs into the task board. Operates in capture mode (fast intake) or triage mode (assess and route the untriaged backlog).
isActive: true
---

```json
{
  "name": "triage_intake",
  "description": "Capture ideas, bugs, and feature requests into the task board, or triage the untriaged backlog queue. In capture mode: turn raw input into a structured board task. In triage mode: assess untriaged items and suggest dispositions (Defer, Assess, Schedule, Close).",
  "input_schema": {
    "type": "object",
    "properties": {
      "mode": {
        "type": "string",
        "enum": ["capture", "triage"],
        "description": "capture: fast intake of a single idea/bug. triage: work the untriaged backlog queue."
      },
      "raw_input": {
        "type": "string",
        "description": "The raw text of the idea, bug, or feature request. Required in capture mode."
      },
      "input_type": {
        "type": "string",
        "enum": ["idea", "bug", "chore"],
        "description": "Classification of the input. Required in capture mode."
      },
      "source": {
        "type": "string",
        "description": "Where this came from: human, support-agent, ba-agent, orchestrator, etc. Required in capture mode."
      },
      "related_task_id": {
        "type": "string",
        "description": "If this is related to an existing board task. Optional."
      },
      "scope": {
        "type": "string",
        "enum": ["all", "single"],
        "description": "In triage mode: 'all' to process the full untriaged queue, 'single' with related_task_id for a specific item."
      }
    },
    "required": ["mode"]
  }
}
```

## Instructions

Use this skill to capture and route incoming ideas or bugs. The Orchestrator invokes it when new items arrive outside normal channels. The Business Analyst invokes it when out-of-scope ideas surface during requirements analysis.

**Capture mode** is always fast and context-free. Create the task and confirm. Do not assess value or feasibility during capture.

**Triage mode** involves judgment. Scan the backlog, assess each item, and suggest a disposition. Reserve "Assess" (send to BA) for items where the decision is genuinely unclear or potentially high-impact.

## Methodology

### Capture Mode: Ideas and Feature Requests

Create a board task with this structure:

```
Task type: idea
Status: backlog
Priority: could

Title: [Concise title inferred from raw input]
Description:
  Origin: [source]
  Related task: [related_task_id or "None"]

  Problem / Opportunity:
  [Restated as a clear problem or opportunity — 1-3 sentences]

  Rough shape (if user described a solution):
  [2-5 bullet points capturing the proposed approach]

  Notes:
  [Any additional context that should not be lost]
```

**Capture rules:**
- Be fast. Infer what you can from context.
- Do not assess value, feasibility, or priority — that is triage's job.
- If multiple ideas are in one input, create a separate task for each.
- Do not ask clarifying questions unless the domain is genuinely ambiguous.

### Capture Mode: Bugs

```
Task type: bug
Status: backlog
Priority: could (escalate to must if data corruption or data loss is involved)

Title: [Short description of the defect]
Description:
  Origin: [source]
  Related task: [related_task_id or "None"]

  Observed behaviour:
  [What actually happens]

  Expected behaviour:
  [What should happen]

  Reproduction steps (if known):
  1. [step]
  2. [step]

  Impact estimate:
  - Users affected: [All / Subset / Edge case / Unknown]
  - Data impact: [None / Read-only incorrect / Write corruption / Data loss / Unknown]
  - Workaround exists: [Yes — describe / No / Unknown]
```

**Escalation rule:** If a bug involves data corruption or data loss, set priority to `must` and immediately notify the human via a high-priority flag. Do not batch-process — surface it immediately.

### Triage Mode

1. Scan the board for tasks with `status: backlog` and no triage decision recorded.
2. Group by type (bug / idea / chore) with a one-line summary of each.
3. For each item, produce an initial read:
   - Duplicate check against existing tasks
   - Rough relevance to current roadmap phase
   - Suggested disposition: **Defer** / **Assess** (send to BA) / **Schedule** / **Close**
4. Wait for human or Orchestrator input on each disposition.
5. Apply the decision by updating the board task.

For items marked "Assess": create a sub-task for the Business Analyst Agent to evaluate.

**Triage Decision Record** (written to each processed task):

```
Triage decision: [Defer | Schedule to Phase X | Close — Not Doing]
Rationale: [One sentence]
Assessments requested: [BA Agent / None]
Triage date: [ISO date]
```

### Hand-off Pattern

```
triage_intake (capture + assess)
  → If "Assess": creates sub-task for BA Agent
  → If scheduled: board task updated to "ready-for-ba"
  → Orchestrator picks up in next directive
  → BA Agent produces full requirements spec (review gate)
  → Dev Agent begins implementation on approval
```
