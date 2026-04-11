---
name: Create PR
description: Create a GitHub pull request from approved and applied patches.
isActive: true
visibility: basic
---

## Parameters

- title: string (required) — Pull request title (clear, specific, action-oriented)
- description: string (required) — Pull request description — what changed, why, and how to test it
- branch: string — Branch name to create the PR from. If omitted, uses the current task branch.

## Instructions

Create a pull request only after all patches for the task have been applied and tests pass. The PR title should be clear and action-oriented. The description must explain what changed, why, and include testing instructions. Human approval is required before the PR is created.

### Prerequisites
Before creating a PR:
1. All write_patch actions for the task have been approved and applied.
2. run_tests passes (or failures are documented and pre-existing).
3. run_command: `git log --oneline -5` to review commits being included.

### Writing a Good PR
- **Title**: Under 72 characters. Start with a verb: "Add", "Fix", "Update", "Remove".
- **Description**:
  - **What**: Summary of changes (2-3 bullet points).
  - **Why**: The problem this solves or feature this adds.
  - **How to test**: Step-by-step instructions for a reviewer to verify the change.
  - **Related task**: Reference the board task ID.

### Decision Rules
- **Tests must pass**: Do not create a PR if your patches caused new test failures.
- **One PR per task**: Do not create multiple PRs for the same task.
- **Human approval required**: This action routes through the review queue.
- **safeMode check**: If safeMode is enabled for this project, create_pr is disabled.
