---
name: Report Bug
description: File a structured bug report with severity and confidence scoring.
isActive: true
---

```json
{
  "name": "report_bug",
  "description": "File a structured bug report as a board task. Use this to document confirmed bugs with full reproduction context, severity classification, and a quality confidence score.",
  "input_schema": {
    "type": "object",
    "properties": {
      "title": { "type": "string", "description": "Short, specific bug title (e.g. \"POST /api/users returns 500 when email is missing\")" },
      "description": { "type": "string", "description": "Full description of the bug" },
      "severity": { "type": "string", "description": "Severity: \"critical\", \"high\", \"medium\", \"low\"" },
      "confidence": { "type": "number", "description": "Your confidence this is a real bug, 0.0–1.0 (e.g. 0.95 for confirmed, 0.6 for suspected)" },
      "steps_to_reproduce": { "type": "string", "description": "Step-by-step reproduction instructions" },
      "expected_behavior": { "type": "string", "description": "What should happen" },
      "actual_behavior": { "type": "string", "description": "What actually happens (include error messages, status codes, stack traces)" }
    },
    "required": ["title", "description", "severity", "confidence", "steps_to_reproduce", "expected_behavior", "actual_behavior"]
  }
}
```

## Instructions

File a bug report for every confirmed issue you find. Do not mention bugs only in activity notes — always use report_bug so they are tracked as board tasks. Include specific reproduction steps so a developer can reproduce and fix the issue without additional context.

## Methodology

### Severity Classification
- **critical**: System crash, data loss, security vulnerability, complete feature failure with no workaround.
- **high**: Core feature broken for most users, no workaround available.
- **medium**: Feature partially broken, workaround exists.
- **low**: Cosmetic issue, edge case, minor UX problem, performance concern.

### Confidence Scoring
- **0.95–1.0**: Reproduced consistently, root cause confirmed, clear expected vs actual.
- **0.7–0.94**: Reproduced but root cause unclear, or reproduced inconsistently.
- **0.5–0.69**: Suspected issue based on code analysis, not yet confirmed by test run.
- **Below 0.5**: Speculative — do not file unless you note it is unconfirmed.

### Writing Good Bug Reports
1. **Title**: Include the failing component, action, and symptom. Be specific.
2. **Steps**: Write from the perspective of a developer who knows the system but has no context on your session.
3. **Expected vs actual**: Be precise. Include status codes, error messages, and field values.
4. **Evidence**: Attach test output, stack traces, or endpoint responses as part of actual_behavior.

### Decision Rules
- **One report per bug**: Do not file duplicates. Check existing bug tasks on the board first.
- **File every confirmed bug**: Even if you plan to fix it yourself, file it so there is a record.
- **Low confidence = low severity**: If you're not sure it's a bug, file it as low severity.
