---
name: Write Patch
description: Propose a code change as a unified diff for human review and approval.
isActive: true
visibility: basic
---

## Parameters

- file: string (required) — Path to the file to modify, relative to projectRoot
- diff: string (required) — Unified diff (--- / +++ / @@ format). Must be minimal and targeted.
- base_commit: string (required) — The git commit hash this diff is based on. Read from executionSnapshot.baseCommit — do not run a shell command to obtain it.
- intent: string — Type of change: feature, bugfix, refactor, test, config
- reasoning: string (required) — Why this change is needed. The human reviewer sees only this field and the diff.

## Instructions

Always read the target file with `read_codebase` before proposing a patch. Get `base_commit` from `executionSnapshot.baseCommit` — never from a shell command. Keep patches small and focused on one logical concern. Human approval is required before execution.

### Patch Constraints
- Max files per patch: 5
- Max lines changed per patch: 300
- Larger changes must be split into multiple focused patches.
- One logical concern per patch — never mix feature changes with refactoring.

### Idempotency Check
Before proposing any patch:
1. Review `executionSnapshot.runHistory` for prior patches on this task.
2. If an entry with the same `file` + same `intent` already exists in runHistory, do not submit a duplicate — update reasoning in context instead.
3. If runHistory is unavailable, check `write_workspace` activity log for prior patch proposals on this task.

### Pre-Patch Checklist
1. Target file read in full via `read_codebase`.
2. `base_commit` sourced from `executionSnapshot.baseCommit`.
3. Diff is minimal — only lines that need to change.
4. No unrelated refactors or style changes included.
5. No security vulnerabilities introduced (SQL injection, XSS, command injection, hardcoded secrets).
6. Patch size within limits (5 files, 300 lines). Split if needed.
7. Migration check: if change affects DB schema, env variables, or external integrations — write a migration plan to the board before submitting this patch.

### Diff Format
Standard unified diff format:
```
--- a/src/path/file.ts
+++ b/src/path/file.ts
@@ -12,7 +12,8 @@
 context line
-old line
+new line
 context line
```
Include at least 3 lines of context around each change.

### After Approval
write_patch is review-gated — your call returns `status: pending_approval`. After submitting:
1. Write a progress note: "Patch proposed: [brief description]. Awaiting human approval."
2. Do not submit a duplicate patch for the same change.
3. After approval and execution, run tests to verify.

### Rejection Handling
If a patch is rejected:
1. Read the rejection reason.
2. Adjust approach and propose a revised patch.
3. If rejected twice for the same file + intent: use the structured blocker format and escalate via `request_approval`.
