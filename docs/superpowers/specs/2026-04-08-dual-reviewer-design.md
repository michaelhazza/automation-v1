# Dual Reviewer — Design Spec
**Date:** 2026-04-08

## Problem

The existing `pr-reviewer` agent provides a strong Claude-native review but reflects only one model's perspective. High-stakes code changes benefit from a second, independent reviewer that catches different classes of issues. This design adds an automated Codex review loop as a second phase, with Claude adjudicating each recommendation before applying it.

---

## Flow

```
Phase 1 (unchanged): pr-reviewer
  → Reviews git diff
  → Fixes blocking issues
  → Returns findings

Phase 2 (new): dual-reviewer
  → Loop up to 3 iterations:
      1. Run `codex` CLI against current git diff
      2. Claude reads each recommendation with full codebase context
      3. Accepts (will fix) or rejects (with reasoning) each item
      4. Implements accepted changes via Edit/Write
      5. If zero accepted in iteration → break early
  → Outputs: decision log + summary + "PR ready" signal
```

Phase 1 and Phase 2 are independent agents. The main session invokes them in sequence for Significant and Major tasks.

---

## dual-reviewer Agent Design

**File:** `.claude/agents/dual-reviewer.md`
**Model:** opus (reasoning needed for accept/reject decisions)
**Tools:** All tools

### Inputs (caller provides)
- What was implemented (brief description)
- Files changed, or "use git diff" (default)

### Behaviour

**Iteration loop (max 3):**
1. Capture `git diff HEAD` — this is the current state of all changes
2. Invoke `codex` CLI with a structured review prompt piped via stdin, capturing stdout
3. Parse each recommendation from Codex output
4. For each recommendation:
   - Read the relevant file and surrounding context (Read, Glob, Grep)
   - Decide: **Accept** (the issue is valid, applicable, and worth fixing) or **Reject** (not applicable, already handled, conflicts with project conventions, or too minor for the risk)
   - Log the decision with one-line reasoning
5. Implement all accepted changes (Edit/Write)
6. If no recommendations were accepted → break early (Codex is satisfied or remaining items are all reject)

**Output:**
- Per-iteration decision table: recommendation → accept/reject + reason
- Summary of all changes made
- Explicit "PR ready" signal

### Loop termination conditions
- Codex returns no issues
- All recommendations in an iteration are rejected (Codex raising the same issues Claude has already decided aren't worth fixing)
- 3 iterations completed

---

## Codex CLI invocation

```bash
echo "$DIFF" | codex "You are reviewing a code change for production readiness.
Review the following git diff and return a list of specific, actionable issues only.

Format each issue exactly as:
ISSUE: [description]
FILE: [path:line]
SEVERITY: [critical|important|minor]
FIX: [specific, concrete fix]

If there are no issues, output: NO_ISSUES

Git diff:
$DIFF"
```

This produces structured output Claude can parse reliably without brittle regex.

---

## CLAUDE.md Changes

### Agent fleet table — add row:
| `dual-reviewer` | Codex loop with Claude adjudication | After `pr-reviewer` on Significant/Major tasks |

### Review workflow — update:
- **Standard:** invoke `pr-reviewer`
- **Significant/Major:** invoke `pr-reviewer`, then invoke `dual-reviewer`

---

## Plugin Installation (user action required)

The `dual-reviewer` agent uses the `codex` CLI binary directly — no plugin required for the automated loop. The Claude Code plugin (`/codex:review`) is optional and useful for interactive use only.

To install the CLI:
```
npm install -g @openai/codex
```

To install the Claude Code plugin for interactive use:
```
/plugin marketplace add openai/codex-plugin-cc
/plugin install codex@openai-codex
/reload-plugins
/codex:setup
```

---

## What is NOT being built

- No modification to `pr-reviewer` or `pr-review-toolkit:code-reviewer`
- No changes to Trivial or Standard task review workflow
- No UI, no config, no feature flags
- The Codex loop does not run in the main session (context window stays clean)
