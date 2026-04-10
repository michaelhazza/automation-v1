---
name: Read Codebase
description: Read a file from the project codebase within the Dev Execution Context.
isActive: true
visibility: none
---

## Parameters

- file_path: string (required) — Relative path to the file from the project root (e.g. "src/services/userService.ts")

## Instructions

Always read the relevant files before proposing any code changes. Understand the existing patterns, conventions, and dependencies before writing a patch. You cannot read files outside the configured project root.

### Phase 1: Entry Points
Start by reading the files most directly related to the task. Identify the correct module, class, or function that needs to change.

### Phase 2: Dependencies
Read imported files, interfaces, and related modules to understand the full context. Look for existing patterns you should follow.

### Phase 3: Tests
Read existing test files for the module you're changing. Understand what is already tested so you can verify your changes don't break anything.

### Decision Rules
- **Read before patching**: Never propose a write_patch without first reading the target file.
- **Read the test file**: Always read associated tests before making changes.
- **Follow existing patterns**: Do not introduce new conventions without explicit instruction.
- **Note the imports**: Check what utilities and helpers are already available.
