---
name: Add Deliverable
description: Attach a deliverable (output/artifact) to a task.
isActive: true
visibility: basic
---

```json
{
  "name": "add_deliverable",
  "description": "Attach a deliverable to a task. Use this to submit your work output — reports, drafts, analysis, recommendations.",
  "input_schema": {
    "type": "object",
    "properties": {
      "task_id": { "type": "string", "description": "The ID of the task to attach the deliverable to" },
      "title": { "type": "string", "description": "Title of the deliverable" },
      "deliverable_type": { "type": "string", "description": "Type: \"artifact\" (text content), \"url\" (link), \"file\" (file reference)" },
      "description": { "type": "string", "description": "The deliverable content." }
    },
    "required": ["task_id", "title", "deliverable_type", "description"]
  }
}
```

## Instructions

When you complete work, always attach the output as a deliverable so it can be reviewed. Add the deliverable before moving the task to review. Each deliverable should be complete and stand alone.

## Methodology

### Deliverable Types
- **artifact**: Full text content (reports, analysis, drafts). Content goes in the description field.
- **url**: A link to external content.
- **file**: A reference to a generated file.

### Quality Standards
- Title must be descriptive. Content must be complete and stand alone.
- Structure long content with headings, bullet points, and sections.

### Decision Rules
- **One deliverable per output**.
- **Always attach to the right task**.
- **Add deliverable before moving to review**.
