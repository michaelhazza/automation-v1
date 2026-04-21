# Design: ChatGPT Review Agents

**Date:** 2026-04-22
**Status:** Draft

## Overview

Two new local agents that structure the existing workflow of taking PR diffs and spec documents to ChatGPT for external review, capturing every round of feedback, logging all accept/reject/defer decisions with rationale, and finalising with doc updates and PR management when the session is complete.

- `chatgpt-pr-review` — for code review of a PR or branch diff
- `chatgpt-spec-review` — for review of a spec document before implementation

Both agents are defined in `.claude/agents/` and run in a **dedicated new Claude Code session** (VS Code terminal CLI or new Claude Code web conversation) while the main implementation session remains untouched.

---

## Problem Being Solved

The back-and-forth with ChatGPT for code and spec review currently loses all signal. Decisions about what to implement, reject, or defer — and the rationale behind each — exist only in the user's head and in ephemeral chat threads. Over time, recurring patterns in ChatGPT's feedback (things Claude consistently misses) cannot be mined because the data is never persisted. This design captures everything.

---

## Invocation

User opens a new Claude Code session in the same project directory and says:

```
run chatgpt-pr-review
run chatgpt-spec-review
```

No arguments. Each agent figures everything out from the repository state.

---

## Agent: `chatgpt-pr-review`

### Initialization

1. Reads current branch (`git branch --show-current`) and full diff (`git diff main...HEAD`)
2. Checks for an existing PR (`gh pr view --json number,url,title`). If no PR exists, creates one immediately (`gh pr create`) with an auto-generated title and body summarising the branch changes.
3. **Always prints the PR URL** — whether it just created it or it already existed.
4. Creates session log at `tasks/review-logs/chatgpt-pr-review-<slug>-<timestamp>.md`
5. Prints a ready message:

> *Ready. PR #167: https://github.com/org/repo/pull/167*
> *Take that PR link (or the diff below) to ChatGPT. When you have their first response, paste it here with your usual phrase.*

Then prints the full diff below the message.

### Per-Round Loop

**Trigger:** User pastes raw ChatGPT response verbatim, followed by their usual phrase ("what should we implement from this feedback, go ahead and do so" or natural variants).

If the pasted content is ambiguous (e.g. ChatGPT asked a clarifying question rather than giving findings, or the response is cut off), the agent says so explicitly and asks the user to paste again or clarify — it does not guess.

**Agent behavior:**

1. Parses every distinct finding from the paste
2. For each finding, assigns: `accept` / `reject` / `defer` + a **severity** (`critical` / `high` / `medium` / `low`) + a one-line rationale
3. **Pre-check:** before implementing, estimates impact of accepted items. If they appear to touch >5 distinct files or >200 LOC, logs: `⚠ High-impact round — consider splitting PR` (then proceeds)
4. Implements all accepted items immediately (Edit, Write, Bash as needed)
5. Runs `npm run lint` and `npm run typecheck` after implementing — fixes any issues introduced
6. Runs `git diff main...HEAD --stat` — if cumulative diff exceeds 20 files or +500 lines, logs: `⚠ Diff expansion: +N lines across M files — review scope creep risk`
6. Appends the round to the session log including a **Top themes** line using `finding_type` vocabulary (e.g. `null_check, naming, architecture`) — not free-form text
7. Prints a summary and the updated diff for the user to copy back to ChatGPT:

> *Round 1 done — 4 accepted and implemented, 2 rejected, 1 deferred. Updated diff below.*

**Decision criteria for accept/reject/defer:**

- **Accept** if: valid bug, missing guard, real inconsistency with codebase patterns, or genuine improvement with clear value
- **Reject** if: conflicts with documented conventions in `CLAUDE.md` / `architecture.md`, is stylistic-only without a documented standard to back it, or would introduce unnecessary complexity
- **Defer** if: valid but out of scope for this PR, better addressed in a follow-up, or requires architectural discussion first

Rationale is always one line. When rejecting because a convention is missing from `CLAUDE.md` or `architecture.md`, prefix the rationale with `[missing-doc]`. Never accept, reject, or defer silently.

### Finalization

Triggered by: "done", "finished", "we're done", "that's it", or equivalent.

1. **Consistency check:** scans all decisions across rounds for contradictions — same finding type accepted in one round and rejected in another. For each contradiction found:
   - Logs it under `### Consistency Warnings`
   - Resolves it: prefer the **later-round decision** as canonical, add a one-line `Resolution:` explaining why (e.g. "Later rejection stands — initial acceptance missed architectural constraint in CLAUDE.md")
2. Writes final summary block to the session log
3. **Pattern extraction:** scans all decisions for systematic gaps (same category in 2+ rounds) or undocumented conventions (rejections tagged `[missing-doc]`). Before appending any entry to `KNOWLEDGE.md`, grep for a similar existing entry — **similar** means same `finding_type` OR same leading phrase (first ~5 words of the entry title). If a match is found, update it instead of adding a duplicate. When adding or updating an entry, include a reference count: `(seen N times in this review)`. If `[missing-doc]` rejections total more than 2, also updates `CLAUDE.md` or `architecture.md` with the missing convention directly.
4. **Structured index:** appends one JSONL record per finding to `tasks/review-logs/_index.jsonl`:
   ```json
   {"timestamp":"...","agent":"chatgpt-pr-review","finding_type":"null_check","decision":"accept","severity":"high","file":"agentExecutionService.ts","category":"bug"}
   ```
5. **Deferred backlog:** appends deferred items to `tasks/todo.md` — the single-source-of-truth deferred-items file that existing feature backlogs (Hermes Tier 1, Live Agent Execution Log) already use. Do **not** write to `tasks/review-logs/_deferred.md`; that file is superseded by this convention. Create a new dated section (or append to an existing same-PR section) rather than mixing entries into an existing feature's section — future sessions reading `tasks/todo.md` should find one contiguous block per review session. Before appending each item, scan the file for a similar existing entry — **similar** means same `finding_type` OR same leading phrase (first ~5 words). Skip if already present. Entry format:

   ```markdown
   ## Deferred from ChatGPT PR review — PR #<N> / <branch>

   **Captured**: <ISO date>
   **Source log**: `tasks/review-logs/chatgpt-pr-review-<slug>-<timestamp>.md`

   - [ ] <finding> — <reason>
   - [ ] <finding> — <reason>
   ```
6. Checks if `architecture.md` or `capabilities.md` needs updating based on structural changes — updates if yes
7. PR handling:
   - If PR already exists: prints "Ready to merge — PR #167 at `<url>`"
   - If no PR exists: runs `gh pr create --fill`, prints the new PR URL
8. Prints one-line session summary: rounds completed, total accepted/rejected/deferred

---

## Agent: `chatgpt-spec-review`

### Initialization

1. **Auto-detects the spec file** by inspecting `git diff main...HEAD --name-only` for modified files matching `tasks/*.md` or `docs/*.md`. If exactly one candidate is found, uses it. If multiple candidates are found, lists them and asks the user to confirm which one. If none are found, checks the "In-flight spec" pointer in `CLAUDE.md` and asks the user to confirm.
2. Reads the detected spec file in full.
3. Checks for an existing PR (`gh pr view`). If no PR exists, creates one immediately. **Always prints the PR URL** — whether just created or already existing.
4. Creates session log at `tasks/review-logs/chatgpt-spec-review-<slug>-<timestamp>.md`
5. Prints a ready message:

> *Ready. Reviewing `tasks/my-spec.md`. PR #168: https://github.com/org/repo/pull/168*
> *Take the spec content below to ChatGPT. When you have their first response, paste it here with your usual phrase.*

Then prints the spec content.

### Per-Round Loop

Same trigger and same decision framework as `chatgpt-pr-review` (including severity field, `[missing-doc]` tagging, and Top themes line), with one difference: accepted items are applied as **edits to the spec document** rather than code changes. The agent uses `Edit` on the spec file. No lint/typecheck — no code changed.

After applying accepted items, prints the changed sections only (not the full spec) so the user has a focused excerpt to show ChatGPT in the next round.

### Finalization

1. **Consistency check:** same as PR agent — scans for contradictions, logs under `### Consistency Warnings`, resolves each by preferring the later-round decision with a `Resolution:` line
2. **Implementation readiness checklist:** verifies the spec is actually buildable:
   - All inputs defined
   - All outputs defined
   - Failure modes covered
   - Ordering guarantees explicit
   - No unresolved forward references
   Each failure logged as a warning. If **2 or more** items fail, also log: `⚠ Spec not implementation-ready — resolve checklist failures before starting build`
3. Writes final summary to the session log
4. **Pattern extraction + `_index.jsonl`:** same as PR agent — extracts patterns to `KNOWLEDGE.md` (with deduplication check before appending), force-updates `CLAUDE.md` if >2 `[missing-doc]` rejections, appends JSONL records to `tasks/review-logs/_index.jsonl` (with fingerprint dedup)
5. **Deferred backlog:** appends deferred items to `tasks/todo.md` (same single-source-of-truth file the PR agent uses — see §Agent: `chatgpt-pr-review` Finalization step 5). Same scan-before-append dedup rule. Same section shape, with a spec-review heading:

   ```markdown
   ## Deferred from ChatGPT spec review — <spec-file>

   **Captured**: <ISO date>
   **Source log**: `tasks/review-logs/chatgpt-spec-review-<slug>-<timestamp>.md`

   - [ ] <finding> — <reason>
   ```
6. Prints: "Spec review complete. PR #<N>: <url>. Hand off to architect or invoke writing-plans when ready to implement."

The spec agent **does** create a PR at the end — the spec document itself has been edited and those changes need to land on a branch.

---

## Log Format

Both agents write to the same structure:

```markdown
# ChatGPT PR Review Session — <slug> — <timestamp>
# (or: ChatGPT Spec Review Session — ...)

## Session Info
- Branch: <branch>
- PR: #<number> | none
- Spec: <file path> (spec agent only)
- Started: <ISO 8601 UTC>

---

## Round 1 — <timestamp>

### ChatGPT Feedback (raw)
<verbatim paste>

### Decisions
| Finding | Decision | Severity | Rationale |
|---------|----------|----------|-----------|
| Missing null check on agentRun | accept | high | Can NPE when run finishes before event flushes |
| Rename `payload` to `body` | reject | low | `payload` is the established term throughout this codebase |
| Extract renderer to its own component | defer | medium | Valid but premature — fewer than 80 lines, no reuse case yet |

**Top themes this round:** null safety, naming

### Implemented
- Added null guard in `server/services/agentExecutionService.ts:142`
- Updated error message in `server/routes/agentExecutionLog.ts:67`

---

## Round 2 — <timestamp>
...

---

## Final Summary
- Rounds: 3
- Accepted: 9 | Rejected: 4 | Deferred: 2
- Deferred items → `tasks/todo.md` § Deferred from ChatGPT PR review — PR #167 / <branch>
  - Extract renderer component (defer to follow-up)
  - Add pagination to timeline (out of scope for this PR)
- KNOWLEDGE.md updated: yes (1 entry added)
- architecture.md updated: no
- PR: #167 — ready to merge | created at <url>
```

---

## Differences Between the Two Agents

| | `chatgpt-pr-review` | `chatgpt-spec-review` |
|---|---|---|
| Reads at start | `git diff main...HEAD` | Named spec file |
| Implements into | Codebase (Edit / Write / Bash) | Spec document (Edit only) |
| "Updated content" printed | `git diff` after changes | Changed spec sections only |
| Runs checks | `npm run lint` + `npm run typecheck` | None (no code changed) |
| Finalization | Surface / confirm PR | Create / surface PR + "Hand off to writing-plans" |
| Log prefix | `chatgpt-pr-review-` | `chatgpt-spec-review-` |

---

## Agent File Conventions

Both agents follow the existing `.claude/agents/` format:

```yaml
---
name: chatgpt-pr-review
description: ...
tools: Read, Glob, Grep, Bash, Edit, Write
model: sonnet
---
```

Both need write tools (unlike `pr-reviewer` which is read-only) because they implement changes.

---

## CLAUDE.md Updates Required

The two agents need to be added to the agent fleet table and the task classification table in `CLAUDE.md`, following the same pattern as `pr-reviewer` and `dual-reviewer`.

---

## Structured Log Index

Both agents append to a shared `tasks/review-logs/_index.jsonl` file (one JSON object per line, appended — never overwritten). This enables cross-session querying: "what are our top recurring issues?", "what % of suggestions are accepted?", "where are we leaking quality?".

```json
{"timestamp":"2026-04-22T14:30:00Z","agent":"chatgpt-pr-review","finding_type":"null_check","decision":"accept","severity":"high","file":"agentExecutionService.ts","category":"bug","fingerprint":"a3f9c2d1e4f6","source":"claude/build-agent-execution-spec-6p1nC"}
{"timestamp":"2026-04-22T14:30:00Z","agent":"chatgpt-pr-review","finding_type":"naming","decision":"reject","severity":"low","file":null,"category":"style","fingerprint":"b1d4e7a2c3f8","source":"claude/build-agent-execution-spec-6p1nC"}
```

### Enum enforcement (hard constraint)

`source` is the current branch slug (`git branch --show-current`), populated at write time.

`file` is the specific file path if the finding is file-scoped; use `"global"` for architectural, naming-wide, or spec-level findings that don't map to a single file. Never use null or omit the field.

`finding_type` **must** be selected from this exact list — do not invent new values:
`null_check` | `idempotency` | `naming` | `architecture` | `error_handling` | `test_coverage` | `security` | `performance` | `scope` | `other`

`category` **must** be selected from: `bug` | `improvement` | `style` | `architecture`

`severity` **must** be: `critical` | `high` | `medium` | `low`

If a finding doesn't clearly map to a value, use `other` / `improvement` / `medium` respectively. Never invent a new enum value.

### Fingerprint

Each record includes a `fingerprint` field, computed as:

```
sha1(finding_type + "|" + file + "|" + normalize(finding_text)[0:60])
```

Where `normalize` = lowercase, trim whitespace, collapse consecutive spaces to one. Truncate to 12 hex characters. Use stable SHA-1 — not a random ID. This ensures the same finding produces the same fingerprint across sessions and across both agents.

Before appending a record, scan the current session's entries in `_index.jsonl` for a matching fingerprint. If found, skip the write — ChatGPT repeating the same issue across rounds should not inflate signal.

### Silent failure handling

`_index.jsonl` writes are best-effort. If the write fails (file lock, disk error, malformed JSON):
- Log a one-line warning in the session log: `⚠ _index.jsonl write failed — <reason>`
- Validate the JSON object before writing; if invalid, skip and log instead of writing a corrupt line
- Do **not** block finalization — the review session is more important than the index

---

## Future Hook

This agent may be extended to call an external review API directly, eliminating the manual copy-paste step. Design is intentionally compatible with that future:

- The per-round loop is already structured as a stateless function (paste → decisions → implement → log)
- Adding an automated caller requires only wrapping the trigger step — the rest of the loop is unchanged
- Multi-model consensus (two external reviewers) would run two rounds and merge the findings before the decision step

No changes to the core loop are required to enable this.

---

## Out of Scope

- Automating the copy-paste to ChatGPT (no public programmatic API for ChatGPT web)
- Storing raw ChatGPT conversation threads
- Multi-agent coordination between the review session and the main implementation session
