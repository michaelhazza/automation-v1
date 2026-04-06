---
name: Run Command
description: Execute an approved shell command in the project root directory.
isActive: true
isVisible: false
---

```json
{
  "name": "run_command",
  "description": "Execute a shell command in the project root directory. This action requires human approval. Only commands on the allowedCommands whitelist will be executed.",
  "input_schema": {
    "type": "object",
    "properties": {
      "command": { "type": "string", "description": "The shell command to execute (e.g. \"git rev-parse HEAD\", \"npm run build\", \"git status\")" }
    },
    "required": ["command"]
  }
}
```

## Instructions

Use run_command to execute necessary shell operations such as fetching the current commit hash, checking git status, or running build commands. Human approval is required. Only whitelisted commands will execute — do not attempt commands outside the allowed list.

## Methodology

### Common Use Cases
- `git rev-parse HEAD` — get current commit hash before writing a patch.
- `git status` — check for uncommitted changes.
- `git log --oneline -5` — review recent commits.
- `npm run build` or `npm run typecheck` — verify compilation.
- `git diff HEAD` — review staged or unstaged changes.

### Before Running
1. Confirm the command is in the allowedCommands list for this project.
2. Run the minimum command needed — do not chain multiple operations unnecessarily.
3. Document why the command is needed in the task board activity.

### Handling Output
- Parse the stdout for the information you need.
- If the command fails, check stderr for the error message.
- Log the key result (e.g. the commit hash) to your working context.

### Decision Rules
- **Minimal commands**: Run only what is necessary for the current step.
- **No destructive commands**: Never run commands that delete files, reset branches, or alter git history unless explicitly required and approved.
- **safeMode check**: If safeMode is enabled for this project, run_command is disabled.
