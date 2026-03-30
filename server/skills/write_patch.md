---
name: Write Patch
description: Propose a code change as a unified diff for human review and approval.
isActive: true
---

```json
{
  "name": "write_patch",
  "description": "Propose a code change as a unified diff. This action requires human approval before the patch is applied. Always read the file first and include the current HEAD commit hash as base_commit.",
  "input_schema": {
    "type": "object",
    "properties": {
      "file": { "type": "string", "description": "Relative path to the file to patch (e.g. \"src/services/userService.ts\")" },
      "diff": { "type": "string", "description": "Unified diff format patch (--- a/file, +++ b/file, @@ ... @@ context)" },
      "reasoning": { "type": "string", "description": "Explanation of why this change is needed and what it does" },
      "base_commit": { "type": "string", "description": "Current HEAD commit hash. Fetch via run_command: git rev-parse HEAD" },
      "intent": { "type": "string", "description": "Change intent: \"feature\", \"bugfix\", \"refactor\", \"test\", \"config\"" }
    },
    "required": ["file", "diff", "reasoning", "base_commit", "intent"]
  }
}
```

## Instructions

Always read the target file before proposing a patch. Fetch the current HEAD commit hash with `git rev-parse HEAD` via run_command and pass it as `base_commit`. Keep patches small and focused — one logical change per patch. Human approval is required before the patch is applied.

## Methodology

### Before Writing a Patch
1. Read the target file with `read_codebase`.
2. Run `git rev-parse HEAD` via `run_command` to get the base commit hash.
3. Understand the existing patterns — match them in your change.
4. Check if tests exist for the area you're changing.

### Writing the Diff
- Use unified diff format: `--- a/path`, `+++ b/path`, `@@ ... @@` hunks.
- Include at least 3 lines of context around each change.
- Keep diffs small: under 100 lines changed per patch when possible.
- One logical concern per patch. Do not mix feature changes with refactoring.

### Reasoning Quality
The reasoning field is shown to the human reviewer. Include:
- Why the change is needed (the problem being solved).
- What the change does (the mechanism).
- Any risks or side effects to watch for.

### Decision Rules
- **One patch per logical change**: Do not bundle multiple concerns in one patch.
- **Never patch without reading**: Always read the file first.
- **Include base_commit**: Patches will be rejected if base_commit is missing or stale.
- **Follow existing style**: Match indentation, naming, and patterns in surrounding code.
- **safeMode check**: If safeMode is enabled for this project, write_patch is disabled.
