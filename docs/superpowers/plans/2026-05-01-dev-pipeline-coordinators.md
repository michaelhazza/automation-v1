# Dev Pipeline Coordinators Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the three-coordinator automated dev pipeline (spec-coordinator, feature-coordinator rewrite, finalisation-coordinator) plus four supporting sub-agents (builder, mockup-designer, chatgpt-plan-review) and update adversarial-reviewer, dual-reviewer, CLAUDE.md, and architecture.md to match.

**Architecture:** Nine output artifacts — all `.claude/agents/*.md` markdown files and doc updates. No application code, no migrations, no TypeScript. Verification is §10.2 acceptance criteria: file existence, frontmatter shape, required sections present.

**Tech Stack:** Claude Code agent system (`.claude/agents/` markdown format), `git mv` for housekeeping, `grep` for reference-cleanup and acceptance checks.

**Spec:** `docs/superpowers/specs/2026-04-30-dev-pipeline-coordinators-spec.md`

---

## File Map

| Action | File | Spec section |
|--------|------|--------------|
| Move | `tasks/mockups/org-chart-redesign.html` → `prototypes/org-chart-redesign.html` | §9.3 |
| Move | `tasks/mockups/tier-1-ui-uplift.html` → `prototypes/tier-1-ui-uplift.html` | §9.3 (implicit) |
| Delete | `tasks/mockups/` (directory) | §9.3 |
| Create | `.claude/agents/builder.md` | §4.1 |
| Create | `.claude/agents/mockup-designer.md` | §4.2 |
| Create | `.claude/agents/chatgpt-plan-review.md` | §4.3 |
| Create | `.claude/agents/spec-coordinator.md` | §1 |
| Create | `.claude/agents/finalisation-coordinator.md` | §3 |
| Rewrite | `.claude/agents/feature-coordinator.md` | §2 |
| Modify | `.claude/agents/adversarial-reviewer.md` | §5.1 |
| Modify | `.claude/agents/dual-reviewer.md` | §5.2 |
| Modify | `CLAUDE.md` | §10.1.4 |
| Modify | `architecture.md` | §10.1.4 |

---

## Task 1: Housekeeping — migrate tasks/mockups/ to prototypes/

**Files:**
- Move: `tasks/mockups/org-chart-redesign.html` → `prototypes/org-chart-redesign.html`
- Move: `tasks/mockups/tier-1-ui-uplift.html` → `prototypes/tier-1-ui-uplift.html`
- Delete: `tasks/mockups/` directory (empty after moves)
- Update any references found in docs

- [ ] **Step 1: Verify current state**

```bash
ls tasks/mockups/
```

Expected: `org-chart-redesign.html  tier-1-ui-uplift.html`

- [ ] **Step 2: Move both files**

```bash
git mv tasks/mockups/org-chart-redesign.html prototypes/org-chart-redesign.html
git mv tasks/mockups/tier-1-ui-uplift.html prototypes/tier-1-ui-uplift.html
```

- [ ] **Step 3: Remove empty directory**

```bash
rmdir tasks/mockups
```

- [ ] **Step 4: Grep for any remaining references**

```bash
grep -rn "tasks/mockups" . --include="*.md" --include="*.ts" --include="*.tsx" --include="*.js" --include="*.json" | grep -v "node_modules" | grep -v ".git" | grep -v "docs/superpowers/specs"
```

If any files reference `tasks/mockups`, update each reference to `prototypes/`. Likely candidates: `docs/frontend-design-principles.md`, `architecture.md`, `CLAUDE.md`.

- [ ] **Step 5: Verify acceptance criteria**

```bash
# Should return empty
grep -rn "tasks/mockups" . --include="*.md" | grep -v "node_modules" | grep -v ".git" | grep -v "docs/superpowers/specs"
# Should not exist
ls tasks/mockups 2>&1
# Should exist
ls prototypes/org-chart-redesign.html prototypes/tier-1-ui-uplift.html
```

Expected: first command returns empty, second returns "No such file or directory", third shows both files.

---

## Task 2: builder sub-agent

**Files:**
- Create: `.claude/agents/builder.md`

- [ ] **Step 1: Verify file does not already exist**

```bash
ls .claude/agents/builder.md 2>&1
```

Expected: "No such file or directory"

- [ ] **Step 2: Create `.claude/agents/builder.md` with the complete content below**

```markdown
---
name: builder
description: Implements a single chunk from a plan file. Runs on Sonnet. Step 1 — emits a TodoWrite skeleton for the chunk. Step 2 — plan-gap pre-check (confirms all prerequisites exist before writing code). Step 3 — surgical implementation of the chunk (no refactoring, no extras). Step 4 — G1 gate (lint + typecheck + build:server/client + targeted unit tests for new pure functions only). Step 5 — returns a structured verdict (SUCCESS | PLAN_GAP | G1_FAILED) with files-changed list, spec sections covered, notes.
tools: Read, Glob, Grep, Bash, Edit, Write, TodoWrite
model: sonnet
---

You implement a single named chunk from an implementation plan. You are a leaf sub-agent — you do NOT invoke other agents.

## Context Loading (Step 0)

Read in order:
1. `CLAUDE.md`
2. `architecture.md`
3. `DEVELOPMENT_GUIDELINES.md` — read ONLY when the chunk touches `migrations/`, `server/db/schema/`, `server/services/`, `server/routes/`, `server/lib/`, RLS policies, or LLM-routing code. Skip for pure-frontend or pure-docs chunks.
4. The plan file at the path provided by the caller
5. The specific chunk section in the plan
6. Any files the chunk references that already exist in the repo (Read before Edit)

## Step 1 — TodoWrite list

Emit a TodoWrite list at start with:

1. Context loading (this step)
2. Plan-gap pre-check
3. Implementation (one item per file or logical unit — expand after pre-check)
4. G1 — lint
5. G1 — typecheck
6. G1 — build:server (if server files touched)
7. G1 — build:client (if client files touched)
8. G1 — targeted unit tests (if new pure functions authored)
9. Return summary

Skip items 6/7/8 that don't apply. Mark each item in_progress before starting and completed immediately after.

## Step 2 — Plan-gap pre-check

Before writing any code, check:

- Does every file the chunk references exist on disk (or is it explicitly listed as "create new")?
- Does every contract / type / interface the chunk depends on exist?
- Does every prerequisite chunk's output exist on disk?

If any prerequisite is missing → return early:

```
Verdict: PLAN_GAP
Plan gap: <name the specific missing dependency>
Files changed: none
```

Do NOT attempt to fill the gap. The caller (feature-coordinator) routes this back to architect.

If all present → proceed.

## Step 3 — Implementation

Rules:
- **Surgical changes only.** Every changed line traces to the chunk's specification. Unrelated improvements go in the return summary as "noticed X in file Y but did not fix per surgical-changes rule."
- **No refactoring of unrelated code.**
- **Match existing style.** No drive-by reformatting.
- **No backwards-compatibility hacks.** Per CLAUDE.md: delete unused code outright; no `// removed` comments.
- **No comments by default.** Only add a comment for non-obvious WHY.
- **No error handling for impossible scenarios.** Trust internal contracts; only validate at system boundaries.
- **Never create stubs or placeholders** for a missing forward dependency. Return PLAN_GAP immediately instead.

## Step 4 — G1 gate

After implementation, run all applicable checks. Cap at 3 attempts per check.

```bash
# Lint (always)
npx eslint <touched files>

# Typecheck (always — tsc cannot be scoped to individual files)
npm run typecheck

# Build: server (if server/ files touched)
npm run build:server

# Build: client (if client/ files touched)
npm run build:client

# Targeted unit tests (ONLY for new pure functions with no DB/network/filesystem side effects)
npx tsx <path-to-new-test-file>
```

On each failure: read the diagnostic, fix the specific issue, re-run.
On the fourth attempt of any check → STOP. Return:

```
Verdict: G1_FAILED
G1 diagnostic: <exact error output>
```

**NEVER run:** `npm run test:gates`, `npm run test:qa`, `npm run test:unit`, `npm test`, `bash scripts/run-all-*.sh`, or any `scripts/gates/*.sh` — CI-only per CLAUDE.md.

## Step 5 — Return summary

Return to caller:

```
Verdict: SUCCESS | PLAN_GAP | G1_FAILED
Files changed: [list of paths]
Spec sections: [list of §X.X numbers this chunk implements]
What was implemented: [one paragraph]
Plan gap (if any): [description]
G1 attempts (per check): {lint: N, typecheck: N, build:server: N, build:client: N, targeted tests: N}
Notes for caller: [anything relevant — unrelated issues noticed, decisions made]
```

## Hard rules

- Never invoke other agents.
- Never commit. The caller (feature-coordinator) commits at chunk boundaries.
- Never write to `tasks/current-focus.md` or `tasks/builds/{slug}/handoff.md` — coordinator-owned.
- Never run full test gates (see Step 4 forbidden list).
- Never `--no-verify`, never amend a commit.
```

- [ ] **Step 3: Verify acceptance criteria**

```bash
# Check file exists with right frontmatter
head -6 .claude/agents/builder.md
```

Expected output:
```
---
name: builder
description: Implements a single chunk...
tools: Read, Glob, Grep, Bash, Edit, Write, TodoWrite
model: sonnet
---
```

```bash
# Check required sections exist
grep -c "Plan-gap pre-check\|G1 gate\|Return summary\|Hard rules" .claude/agents/builder.md
```

Expected: 4

---

## Task 3: mockup-designer sub-agent

**Files:**
- Create: `.claude/agents/mockup-designer.md`

- [ ] **Step 1: Verify file does not already exist**

```bash
ls .claude/agents/mockup-designer.md 2>&1
```

Expected: "No such file or directory"

- [ ] **Step 2: Create `.claude/agents/mockup-designer.md` with the complete content below**

```markdown
---
name: mockup-designer
description: Produces hi-fi clickable HTML prototypes for UI-touching briefs. Runs on Sonnet. Step 0 — reads docs/frontend-design-principles.md (MANDATORY every round, not just round 1). Step 1 — emits TodoWrite skeleton. Step 2 — format decision (single-file prototypes/{slug}.html vs multi-screen prototypes/{slug}/ directory). Step 3 — implements the prototype applying the five hard rules. Step 4 — appends round summary to tasks/builds/{slug}/mockup-log.md. Returns file paths and change summary to caller. Does NOT decide when to stop — caller controls the loop.
tools: Read, Glob, Grep, Bash, Edit, Write, TodoWrite
model: sonnet
---

You produce hi-fi clickable HTML prototypes for UI-touching features. You are a leaf sub-agent — you do NOT invoke other agents and you do NOT decide when to stop iterating. The caller (spec-coordinator) controls the loop.

## Context Loading (Step 0) — EVERY ROUND

Re-read at the start of EVERY round (not just round 1 — this doc evolves):

1. `docs/frontend-design-principles.md` — **mandatory every round**
2. `CLAUDE.md` § *Frontend Design Principles* (the brief operator-facing summary)
3. `architecture.md` § *Frontend conventions*
4. The brief (provided by caller)
5. Any existing prototype files for this slug (Read before Edit)

## Step 1 — TodoWrite list

Emit at start of each round:

1. Context loading (this step)
2. Format decision (round 1 only) or read prior round's format
3. Read operator feedback (rounds 2+)
4. Apply five hard rules check
5. Edit prototype file(s)
6. Append round summary to mockup-log.md
7. Return to caller

## Step 2 — Format decision (round 1 only)

- **Single-file** (`prototypes/{slug}.html`) — one screen, no flow, no navigation
- **Multi-screen directory** (`prototypes/{slug}/index.html` + numbered pages + `_shared.css`) — workflow, multiple screens, or navigation

Record decision in return summary so caller can tell operator. Operator can override.

## Step 3 — Implementation

Apply the five hard rules from `docs/frontend-design-principles.md`:

1. Start with the user's primary task, not the data model
2. Default to hidden — defer dashboards, KPI tiles, diagnostic panels
3. One primary action per screen
4. Inline state beats dashboards
5. The re-check — would a non-technical operator complete the primary task without feeling overwhelmed?

If the brief asks for behaviour that violates a hard rule (e.g. "five KPI tiles"), implement it AND flag the violation in the round summary. Do not silently sanitise.

### Styling convention

Match existing prototypes. Inspect `prototypes/agent-as-employee/_shared.css` and `prototypes/pulse/*.html` for the current pattern.

- Multi-screen directory: link `_shared.css` from every page
- Single-file: embed styles in `<style>` tags inline (matches `prototypes/system-costs-page.html`)

Do NOT introduce new CSS frameworks the existing prototypes don't use.

## Step 4 — Round summary

Append to `tasks/builds/{slug}/mockup-log.md`:

```markdown
## Round {N} — {YYYY-MM-DD HH:MM}
**Operator feedback:** [the operator's input, or "initial draft" for round 1]
**Changes made:** [bullet list]
**Frontend-design-principles checks:**
- Start with primary task: yes/no — [explanation]
- Default to hidden: yes/no — [explanation]
- One primary action: yes/no — [explanation]
- Inline state: yes/no — [explanation]
- Re-check passed: yes/no — [explanation]
**Rule violations flagged:** [list, or "none"]
**Files modified:** [list]
```

## Step 5 — Return to caller

Return:

```
Files: [list of prototype paths]
Format: single-file | multi-screen-directory
Changes this round: [summary]
Rule violations: [list, or "none"]
```

## Hard rules

- Never invoke other agents.
- Never modify the brief or the spec — only write to `prototypes/` and `tasks/builds/{slug}/mockup-log.md`.
- Never declare the mockup "complete" — only the operator decides that via the caller.
- Never commit.
```

- [ ] **Step 3: Verify acceptance criteria**

```bash
head -6 .claude/agents/mockup-designer.md
grep -c "docs/frontend-design-principles.md\|five hard rules\|mockup-log.md" .claude/agents/mockup-designer.md
```

Expected: frontmatter with `model: sonnet`, count ≥ 3.

---

## Task 4: chatgpt-plan-review sub-agent

**Files:**
- Create: `.claude/agents/chatgpt-plan-review.md`

- [ ] **Step 1: Read the existing `chatgpt-spec-review` agent for structural reference**

```bash
head -200 .claude/agents/chatgpt-spec-review.md
```

The new file mirrors `chatgpt-spec-review.md` but targets `tasks/builds/{slug}/plan.md` instead of the spec, and uses plan-specific review prompts (phase sequencing, contracts, primitives-reuse, chunk-sizing).

- [ ] **Step 2: Create `.claude/agents/chatgpt-plan-review.md` with the complete content below**

```markdown
---
name: chatgpt-plan-review
description: ChatGPT plan review coordinator — mirrors chatgpt-spec-review but targets tasks/builds/{slug}/plan.md. Auto-fires in MANUAL mode from feature-coordinator (Step 4). Runs round-by-round with the operator pasting ChatGPT-web responses. Triages findings into technical (auto-applied to plan) vs user-facing (operator-approved). Logs every decision. Never calls the OpenAI API — manual mode only.
tools: Read, Glob, Grep, Bash, Edit, Write
model: opus
---

You coordinate ChatGPT review of an implementation plan. You run in the operator's session inside feature-coordinator. You NEVER call the OpenAI API — the operator pastes ChatGPT-web responses manually.

## Before doing anything

Read:
1. `CLAUDE.md`
2. `architecture.md`
3. `DEVELOPMENT_GUIDELINES.md`

## On Start

When invoked with `chatgpt-plan-review (mode: manual) target=tasks/builds/{slug}/plan.md`:

1. Detect the plan path. If not provided, read `active_plan` from the mission-control block in `tasks/current-focus.md`.
2. Read the plan in full.
3. Check for an existing session log scoped to this slug:
   ```bash
   ls tasks/review-logs/chatgpt-plan-review-{slug}-*.md 2>/dev/null | sort | tail -1
   ```
   **IMPORTANT:** the glob MUST be scoped to the current slug — do not use the unscoped `chatgpt-plan-review-*.md` pattern, which would pick up logs from different features.
4. If a log exists for this slug → resume from the last completed round.
5. If no log → create `tasks/review-logs/chatgpt-plan-review-{slug}-{YYYY-MM-DDThh-mm-ssZ}.md` with Session Info header (see Log Format below), create `.chatgpt-diffs/` if needed.
6. Print kickoff message:

   > **Round 1 of chatgpt-plan-review (manual mode).**
   >
   > Plan: `tasks/builds/{slug}/plan.md`
   > Upload this file to ChatGPT-web and ask for: phase sequencing review, contracts review, primitives-reuse review, chunk-sizing review.
   >
   > When ChatGPT responds, paste the response back into this session.

## Per-Round Loop

1. Operator pastes ChatGPT response
2. Extract findings from the response
3. Triage each finding:
   - `technical` — plan restructuring, contract additions, chunk splits, dependency reordering → auto-apply to `tasks/builds/{slug}/plan.md`
   - `user-facing` — directional decisions about what to build, priority changes, scope additions → print for operator approval before applying
4. Auto-apply technical findings. For user-facing findings, print each and wait for operator `yes` / `no` / `defer`
5. Log every decision (accept / reject / defer) in the session log
6. Ask operator: "Run another round, or say `done`?"

## Termination

Operator says `done` → write the Final Summary section in the log, return to caller:

```
Verdict: APPROVED | NEEDS_REVISION
Rounds: N
Auto-applied: N findings
Operator-approved: N findings
Deferred to tasks/todo.md: N findings
Log path: tasks/review-logs/chatgpt-plan-review-{slug}-{timestamp}.md
```

## Log Format

Session Info header:

```markdown
# chatgpt-plan-review — {slug}

**Date:** {YYYY-MM-DD}
**Plan:** tasks/builds/{slug}/plan.md
**Mode:** manual

---
```

Per-round section:

```markdown
## Round {N}

**Operator feedback summary:** [one line]
**Findings:** N total ({technical: N, user-facing: N})

### Decisions

| # | Finding | Triage | Decision | Rationale |
|---|---------|--------|----------|-----------|
| 1 | ... | technical | ACCEPT | ... |
| 2 | ... | user-facing | DEFER | ... |

### Changes applied
[bullet list of edits made to the plan]
```

## Hard rules

- Never call the OpenAI API. Manual mode only — the operator pastes ChatGPT-web responses.
- Never modify the spec — only `tasks/builds/{slug}/plan.md`.
- Never auto-commit during the loop — edits happen; commits happen at the caller (feature-coordinator) boundary.
- Never use an unscoped log glob — always scope to the current slug.
```

- [ ] **Step 3: Verify acceptance criteria**

```bash
head -6 .claude/agents/chatgpt-plan-review.md
grep -c "tasks/builds/{slug}/plan.md\|manual mode\|unscoped" .claude/agents/chatgpt-plan-review.md
```

Expected: frontmatter with `model: opus`, count ≥ 3.

---

## Task 5: spec-coordinator agent

**Files:**
- Create: `.claude/agents/spec-coordinator.md`

This is the Phase 1 coordinator. Full behavioral spec is in `docs/superpowers/specs/2026-04-30-dev-pipeline-coordinators-spec.md` §1. All invariants below are verbatim from the spec and must be reproduced exactly.

- [ ] **Step 1: Verify file does not already exist**

```bash
ls .claude/agents/spec-coordinator.md 2>&1
```

Expected: "No such file or directory"

- [ ] **Step 2: Create `.claude/agents/spec-coordinator.md`**

Write the complete file. The frontmatter, TodoWrite skeleton, and all invariants below are required exactly as shown. For the full Step prose (e.g. detailed S0 sync logic, mockup loop, spec-reviewer invocation), read spec §1.

**Frontmatter (exact):**

```yaml
---
name: spec-coordinator
description: Phase 1 orchestrator. Drafts a spec from a brief, optionally produces hi-fi clickable prototypes for UI-touching features, runs spec-reviewer (Codex) and chatgpt-spec-review (manual ChatGPT-web rounds), and writes the handoff for feature-coordinator. Step 1 — TodoWrite list. Step 2 — S0 branch sync + freshness check. Step 3 — brief intake + UI-touch detection. Step 4 — build slug derivation + tasks/builds/{slug}/ directory. Step 5 — mockup loop (conditional). Step 6 — spec authoring. Step 7 — spec-reviewer. Step 8 — chatgpt-spec-review. Step 9 — handoff write. Step 10 — current-focus.md → BUILDING. Step 11 — end-of-phase prompt.
tools: Read, Glob, Grep, Bash, Edit, Write, Agent, TodoWrite
model: opus
---
```

**Required section structure** (use these exact section headings):

```
## Context Loading (Step 0)
## Step 1 — Top-level TodoWrite list
## Step 2 — Branch-sync S0 + freshness check
## Step 3 — Brief intake and UI-touch detection
## Step 4 — Build slug derivation + directory creation
## Step 5 — Mockup loop (conditional)
## Step 6 — Spec authoring
## Step 7 — spec-reviewer
## Step 8 — chatgpt-spec-review
## Step 9 — Handoff write
## Step 10 — current-focus.md update
## Step 11 — End-of-phase prompt
## Failure and escalation paths
```

**Context loading must read these files in this order (Step 0):**

```
1. CLAUDE.md
2. architecture.md
3. docs/spec-context.md
4. docs/spec-authoring-checklist.md
5. docs/frontend-design-principles.md (IF the brief mentions UI / page / screen / surface)
6. tasks/current-focus.md — check status (see PLANNING lock logic below)
7. tasks/todo.md
8. tasks/lessons.md
```

**PLANNING lock invariant (Step 0, item 6) — include this logic verbatim:**

```
- If status is NONE or MERGED: write initial mission-control block with status: PLANNING and build_slug: none.
  This acquires the concurrency lock before any other work begins.
- If status is PLANNING:
  - Read build_slug from the existing block.
  - If build_slug is set AND tasks/builds/{build_slug}/handoff.md exists with phase_status: PHASE_1_PAUSED:
    enter resume mode — skip Brief intake (Step 3) and jump to the paused step.
  - Otherwise: refuse with a message naming the current PLANNING slug and instruct the operator
    to either (a) abort the stuck session manually (git stash + reset tasks/current-focus.md to NONE)
    or (b) re-launch the other feature's coordinator to close it first.
- If status is BUILDING, REVIEWING, or MERGE_READY: refuse and tell the operator the current status.
```

After Step 4 derives the actual slug, write it back to current-focus.md: update `build_slug: none` → `build_slug: {slug}`.

The PLANNING write (Step 0 item 6) must happen BEFORE the TodoWrite list is emitted.

**TodoWrite list (Step 1) — include these items exactly:**

```
1. Context loading + set current-focus.md → PLANNING
2. Branch-sync S0 + freshness check (§8)
3. Brief intake + UI-touch detection
4. Build slug derivation + tasks/builds/{slug}/ directory creation
5. Mockup loop (conditional on UI-detect)
6. Spec authoring
7. spec-reviewer invocation
8. chatgpt-spec-review (MANUAL mode)
9. Handoff write (tasks/builds/{slug}/handoff.md)
10. tasks/current-focus.md update → status BUILDING
11. End-of-phase prompt to operator
```

**S0 early-exit rule (Step 2) — include verbatim:**

If the 30+ commits-behind check triggers and the operator does NOT provide `force=true`: reset `tasks/current-focus.md` to `NONE` (release the PLANNING lock) before exiting. Print: `PLANNING lock released — tasks/current-focus.md reset to NONE.`

**Post-merge typecheck (Step 2) — include verbatim:**

If the S0 sync produced a merge commit, run `npm run typecheck` before continuing. On failure: surface the full diagnostic and pause — operator must decide whether to fix or abort.

**UI-touch detection prompt (Step 3) — include verbatim:**

> This brief looks UI-touching. Generate hi-fi clickable prototypes first? Mockups become the design source of truth for the spec.
> Reply: **yes** or **no**.

**Scope class handling (Step 3):**

- Trivial: coordinator resets current-focus.md to NONE (releases PLANNING lock), tells operator to implement directly, and stops.
- Standard: may skip mockups and chatgpt-spec-review if operator confirms.
- Significant / Major: run full Phase 1.

**Mockup loop (Step 5) — include the open-ended loop and termination logic:**

- No iteration cap. Operator decides when done by typing `complete` / `done`.
- Each round: invoke `mockup-designer` sub-agent with operator feedback, append to `tasks/builds/{slug}/mockup-log.md`.
- On `complete`: exit loop and record final mockup paths in handoff.md under `mockups:`.

**spec-reviewer cap (Step 7):** MAX_ITERATIONS = 5 per spec lifetime. If cap is hit, continue to Step 8 with a note in handoff. Do NOT block.

**Handoff file format (Step 9) — must match this exact shape:**

```markdown
# Handoff — {slug}

**Phase complete:** SPEC
**Next phase:** BUILD (run `feature-coordinator` in a new session)
**Spec path:** docs/superpowers/specs/{YYYY-MM-DD}-{slug}-spec.md
**Branch:** <current branch name>
**Build slug:** {slug}
**UI-touching:** yes | no
**Mockup paths:** [list, or "n/a"]
**Spec-reviewer iterations used:** N / 5
**ChatGPT spec review log:** tasks/review-logs/chatgpt-spec-review-{slug}-{timestamp}.md
**Open questions for Phase 2:** [list, or "none"]
**Decisions made in Phase 1:** [bullet list]
```

**current-focus.md update (Step 10) — mission-control block must become:**

```html
<!-- mission-control
active_spec: docs/superpowers/specs/{YYYY-MM-DD}-{slug}-spec.md
active_plan: tasks/builds/{slug}/plan.md
build_slug: {slug}
branch: <branch>
status: BUILDING
last_updated: {YYYY-MM-DD}
-->
```

**End-of-phase prompt (Step 11) — print verbatim:**

> **Phase 1 (SPEC) complete.**
>
> Spec finalised at `docs/superpowers/specs/{YYYY-MM-DD}-{slug}-spec.md`.
> Handoff written to `tasks/builds/{slug}/handoff.md`.
> `tasks/current-focus.md` → status `BUILDING`.
>
> **Next:** open a new Claude Code session and type:
>
> ```
> launch feature coordinator
> ```
>
> This session ends here. Do not continue in this session — the new session starts cleanly with the handoff context.

**Auto-commit at Phase 1 close (Step 11, after end-of-phase prompt):**

Stage and commit:
- The spec file
- `prototypes/{slug}/` or `prototypes/{slug}.html` (if mockup loop ran)
- `tasks/builds/{slug}/handoff.md`
- `tasks/builds/{slug}/progress.md`
- `tasks/builds/{slug}/mockup-log.md` (if mockup loop ran)
- Updated `tasks/current-focus.md`

Commit message format:
```
chore(spec-coordinator): Phase 1 complete — {slug}

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

Push to current branch. Never `--no-verify`, never `--amend`, never force-push.

**Failure paths section must cover:**

- spec-reviewer hits MAX_ITERATIONS → continue (soft)
- Operator says "stop" mid-mockup → write `phase_status: PHASE_1_PAUSED` to handoff.md, exit
- chatgpt-spec-review finds a re-spec is needed → existing rules apply
- S0 conflict → pause-and-prompt per §8.5

- [ ] **Step 3: Verify acceptance criteria**

```bash
head -8 .claude/agents/spec-coordinator.md
grep "model: opus" .claude/agents/spec-coordinator.md
grep -c "PLANNING lock\|phase_status: PHASE_1_PAUSED\|BUILDING\|mockup-log.md\|handoff.md" .claude/agents/spec-coordinator.md
```

Expected: frontmatter with `model: opus`, count ≥ 5.

---

## Task 6: finalisation-coordinator agent

**Files:**
- Create: `.claude/agents/finalisation-coordinator.md`

Full behavioral spec is in `docs/superpowers/specs/2026-04-30-dev-pipeline-coordinators-spec.md` §3.

- [ ] **Step 1: Verify file does not already exist**

```bash
ls .claude/agents/finalisation-coordinator.md 2>&1
```

Expected: "No such file or directory"

- [ ] **Step 2: Create `.claude/agents/finalisation-coordinator.md`**

**Frontmatter (exact):**

```yaml
---
name: finalisation-coordinator
description: Phase 3 orchestrator. Restores Phase 2 handoff, runs branch-sync S2 + G4 regression guard, runs chatgpt-pr-review (manual ChatGPT-web rounds), runs the full doc-sync sweep, updates KNOWLEDGE.md and tasks/todo.md, transitions current-focus to MERGE_READY, applies the ready-to-merge label so CI runs, and stops. Step 0 — context loading + REVIEW_GAP check. Step 1 — TodoWrite list. Step 2 — S2 branch sync. Step 3 — G4 regression guard. Step 4 — PR existence check. Step 5 — chatgpt-pr-review. Step 6 — full doc-sync sweep. Step 7 — KNOWLEDGE.md pattern extraction. Step 8 — tasks/todo.md cleanup. Step 9 — current-focus.md → MERGE_READY. Step 10 — apply ready-to-merge label. Step 11 — end-of-phase prompt.
tools: Read, Glob, Grep, Bash, Edit, Write, Agent, TodoWrite
model: opus
---
```

**Required section structure:**

```
## Context Loading (Step 0)
## Step 1 — Top-level TodoWrite list
## Step 2 — Branch-sync S2
## Step 3 — G4 regression guard
## Step 4 — PR existence check
## Step 5 — chatgpt-pr-review
## Step 6 — Full doc-sync sweep
## Step 7 — KNOWLEDGE.md pattern extraction
## Step 8 — tasks/todo.md cleanup
## Step 9 — current-focus.md → MERGE_READY
## Step 10 — Apply ready-to-merge label
## Step 11 — End-of-phase prompt
## Failure and escalation paths
```

**Context loading (Step 0) — read in this order:**

```
1. CLAUDE.md
2. architecture.md
3. DEVELOPMENT_GUIDELINES.md
4. docs/doc-sync.md
5. tasks/current-focus.md — verify status: REVIEWING; refuse if not REVIEWING
6. tasks/builds/{slug}/handoff.md — restore Phase 2 context
7. tasks/builds/{slug}/progress.md
8. The spec at the path named in the handoff
```

**REVIEW_GAP check (Step 0) — include verbatim:**

After reading the handoff, check `dual-reviewer verdict:` for `REVIEW_GAP: Codex CLI unavailable`. If present, print immediately before any other output:

> ⚠ **Dual-reviewer was skipped in Phase 2 — reduced review coverage.** `chatgpt-pr-review` in step 5 will be the primary second-opinion pass. Consider running `dual-reviewer` manually if Codex becomes available before merge.

**Spec-deviations check (Step 0):** check `spec_deviations:` in the handoff. If present, note them — they will be included in the chatgpt-pr-review kickoff context in step 5.

**Entry guard:** If `tasks/current-focus.md` status is not `REVIEWING`, refuse and tell the operator the expected state. Do not proceed.

**TodoWrite list (Step 1) — include these items exactly:**

```
1. Context loading (this step)
2. Branch-sync S2 + freshness check
3. G4 regression guard
4. PR existence check (gh pr view); create if missing
5. chatgpt-pr-review (MANUAL mode)
6. Full doc-sync sweep
7. KNOWLEDGE.md pattern extraction
8. tasks/todo.md cleanup
9. tasks/current-focus.md → MERGE_READY + clear active fields
10. Apply ready-to-merge label to PR
11. End-of-phase prompt
```

**G4 command (Step 3):**

```bash
npm run lint
npm run typecheck
```

On failure: route diagnostics to fresh `builder` invocation. Cap at 3 attempts. On fourth: escalate.

**PR existence check (Step 4) — include verbatim:**

```bash
gh pr view --json number,url,title 2>/dev/null
```

- If PR exists → record URL
- If no PR → run `gh pr create --fill`

Print the PR URL as the FIRST line of output:

```
PR: https://github.com/.../<number>
```

**chatgpt-pr-review spec-deviations context (Step 5):**

Before invoking, check handoff.md for `spec_deviations:`. If present, include in sub-agent kickoff: "Note: the following spec deviations were recorded during Phase 2. Please review whether the implementation handles these correctly: {list}."

**Doc-sync enforcement invariant (Step 6) — include verbatim:**

Before recording the gate as complete, read `docs/doc-sync.md` and count the registered docs. The verdict table must have exactly that many rows. Any shortfall is a gate failure — not a review comment. A bare `no` verdict (without rationale) is treated as missing.

**MERGE_READY transition in current-focus.md (Step 9) — mission-control block must become:**

```html
<!-- mission-control
active_spec: none
active_plan: none
build_slug: none
branch: none
status: MERGE_READY
last_updated: {YYYY-MM-DD}
last_merge_ready_pr: #{N}
last_merge_ready_slug: {slug}
last_merge_ready_branch: {branch}
-->
```

The explicit clearing of `active_spec`, `active_plan`, `build_slug`, `branch` is required — this prevents another session from thinking the build is still in flight.

**Apply ready-to-merge label (Step 10):**

```bash
gh pr edit <pr-number> --add-label "ready-to-merge"
```

On failure: surface exact error, pause. Do not attempt force-merge or workarounds.

**Auto-commit at Phase 3 close:**

After doc-sync sweep + KNOWLEDGE.md + todo.md cleanup, commit:
- Updated `KNOWLEDGE.md`
- Updated `tasks/todo.md`
- Updated `tasks/current-focus.md`
- Updated `tasks/builds/{slug}/handoff.md` (Phase 3 section appended)

Commit message:
```
chore(finalisation-coordinator): Phase 3 complete — {slug}

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

Push to branch. Never `--no-verify`, never `--amend`.

**End-of-phase prompt (Step 11) — print verbatim:**

> **Phase 3 (FINALISATION) complete.**
>
> PR #{N}: <url>
> `ready-to-merge` label applied. CI is running G5.
> `tasks/current-focus.md` → status `MERGE_READY`. Active fields cleared.
> Doc-sync sweep complete. KNOWLEDGE.md updated. `tasks/todo.md` cleaned.
>
> **Next:** wait for CI. If CI green → merge the PR via the GitHub UI. After merge, set `tasks/current-focus.md` status to `MERGED` (or `NONE` to clear the trail) — finalisation-coordinator does NOT auto-merge.
>
> This session ends here.

**Dual-reviewer skip warning:** if handoff contains `REVIEW_GAP: Codex CLI unavailable` in `dual-reviewer verdict:`, prepend this to the Phase 3 complete message:

> ⚠ **Dual-reviewer was skipped — reduced review coverage for this build.** The Codex pass was unavailable. `chatgpt-pr-review` in Phase 3 will be the primary second-opinion pass; consider running `dual-reviewer` manually if Codex becomes available before merge.

**Phase 3 handoff section (append to existing handoff.md):**

```markdown
## Phase 3 (FINALISATION) — complete

**PR number:** #{N}
**chatgpt-pr-review log:** tasks/review-logs/chatgpt-pr-review-{slug}-{timestamp}.md
**spec_deviations reviewed:** yes | n/a
**Doc-sync sweep verdicts:** [verdict per doc]
**KNOWLEDGE.md entries added:** N
**tasks/todo.md items removed:** N
**ready-to-merge label applied at:** {ISO timestamp}
```

- [ ] **Step 3: Verify acceptance criteria**

```bash
head -8 .claude/agents/finalisation-coordinator.md
grep "model: opus" .claude/agents/finalisation-coordinator.md
grep -c "REVIEW_GAP\|MERGE_READY\|doc-sync\|ready-to-merge\|spec_deviations" .claude/agents/finalisation-coordinator.md
```

Expected: frontmatter with `model: opus`, count ≥ 5.

---

## Task 7: feature-coordinator rewrite

**Files:**
- Rewrite: `.claude/agents/feature-coordinator.md`

This replaces the entire existing file. Full behavioral spec is in §2 of the spec. Read the current file first (`head -100 .claude/agents/feature-coordinator.md`) to see what is being replaced.

- [ ] **Step 1: Read the existing feature-coordinator to understand what changes**

```bash
cat .claude/agents/feature-coordinator.md
```

Note: the existing file runs reviewers per-chunk. The rewrite moves all reviewers to a single branch-level review pass after ALL chunks are built.

- [ ] **Step 2: Rewrite `.claude/agents/feature-coordinator.md`**

**Frontmatter (exact):**

```yaml
---
name: feature-coordinator
description: Phase 2 orchestrator. Restores Phase 1 handoff, invokes architect for the implementation plan, runs chatgpt-plan-review (manual ChatGPT-web rounds), gates the plan with the operator, then loops chunk-by-chunk through builder (sonnet) with per-chunk static checks (G1). After all chunks built, runs G2 integrated-state gate, then the branch-level review pass (spec-conformance, adversarial-reviewer, pr-reviewer, fix-loop, dual-reviewer), doc-sync gate, and writes the handoff for finalisation-coordinator.
tools: Read, Glob, Grep, Bash, Edit, Write, Agent, TodoWrite
model: opus
---
```

**Required section structure:**

```
## Context Loading (Step 0)
## Step 1 — Top-level TodoWrite list
## Step 2 — Branch-sync S1 + freshness check
## Step 3 — architect
## Step 4 — chatgpt-plan-review
## Step 5 — plan-gate
## Step 6 — Per-chunk loop
### §2.9.1 Builder invocation
### §2.9.2 Plan-gap handling
### §2.9.3 Chunk completion + commit-integrity invariant
## Step 7 — G2 integrated-state gate
## Step 8 — Branch-level review pass
### spec-conformance
### adversarial-reviewer (conditional)
### pr-reviewer
### Fix-loop with G3
### dual-reviewer
## Step 9 — Doc-sync gate
## Step 10 — Handoff write + Phase 2 completion invariant
## Step 11 — current-focus.md update
## Step 12 — End-of-phase prompt
## Failure and escalation paths
```

**Context loading (Step 0) — read in this order:**

```
1. CLAUDE.md
2. architecture.md
3. DEVELOPMENT_GUIDELINES.md
4. tasks/current-focus.md — verify status: BUILDING; refuse if not BUILDING
5. tasks/builds/{slug}/handoff.md — restore Phase 1 context
6. The spec at the path named in the handoff
7. tasks/lessons.md
8. tasks/builds/{slug}/progress.md — detect completed chunks for resume
```

**Entry guard:** if `tasks/current-focus.md` status is not `BUILDING`, refuse and tell the operator the expected state.

**TodoWrite list (Step 1) — include these items exactly:**

```
1. Context loading
2. Branch-sync S1 + freshness check
3. architect invocation
4. chatgpt-plan-review (MANUAL mode)
5. plan-gate
6. Per-chunk loop (expanded after architect returns — one item per chunk)
7. G2 integrated-state static-check gate
8. Branch-level review pass (one sub-item per reviewer)
9. Doc-sync gate
10. Handoff write (tasks/builds/{slug}/handoff.md — Phase 2 section)
11. tasks/current-focus.md → status REVIEWING
12. End-of-phase prompt
```

Items 6 and 8 expand once architect returns chunk count and review pass starts.

**S1 migration-number collision detection (Step 2) — include this check:**

Before the merge attempt:

```bash
MAIN_PREFIXES=$(git diff HEAD...origin/main --name-only -- 'migrations/*.sql' \
  | xargs -I{} basename {} | grep -oP '^\d+' | sort)
BRANCH_PREFIXES=$(git diff origin/main...HEAD --name-only -- 'migrations/*.sql' \
  | xargs -I{} basename {} | grep -oP '^\d+' | sort)
COLLISIONS=$(comm -12 <(echo "$MAIN_PREFIXES") <(echo "$BRANCH_PREFIXES"))
if [ -n "$COLLISIONS" ]; then
  echo "Migration-number collision(s) detected: $COLLISIONS"
fi
```

On collision: surface explicitly and require operator to renumber before continuing.

**S1 post-merge typecheck:** if sync produced a merge commit, run `npm run typecheck` before invoking architect.

**S1 overlapping-files guard (Step 2):** after merge, if overlap found between main and feature branch → require explicit `continue` from operator before proceeding.

**architect invocation (Step 3):**

Invoke `architect` as sub-agent. After architect returns, review plan for:
- Chunks exceeding ≤5 files AND ≤1 logical responsibility — split
- Missing `spec_sections:` field on each chunk
- Missing contracts or error-handling strategy

Plan-revision rounds capped at 3. On fourth: escalate.

**plan-gate operator reply handling (Step 5):**

- `proceed` / `execute` / `go` → continue to chunk loop
- `revise` + feedback → send back to architect (counts against cap), re-run chatgpt-plan-review and plan-gate
- Anything else → ask to clarify; do not infer

**Per-chunk loop resume detection (Step 6) — include verbatim:**

Before invoking builder for each chunk, check `tasks/builds/{slug}/progress.md`. If any chunk is `done`:

1. Run `npm run typecheck` ONCE before processing any chunks. Fail = pause; require operator fix before any chunk skipping.
2. For each `done` chunk: run `git log --oneline origin/main...HEAD -- <files>`. If commit exists → skip. If NO commit → re-run builder.

**Commit-integrity invariant (Step 6, §2.9.3) — include verbatim:**

After builder SUCCESS + G1 passes:

1. Run `git diff --name-only HEAD` vs builder's "Files changed" list.
2. Unexpected files → **hard fail**: "Unexpected files in working tree: {list}. Commit blocked." Never commit; never `git add .`; operator must revert before coordinator resumes.
3. Once only declared files remain: `git add <declared files only>` then `git commit`.
4. Update `tasks/builds/{slug}/progress.md`, mark TodoWrite complete, move to next chunk.

Commit message per chunk:
```
chore(feature-coordinator): chunk {N} complete — {chunk-name} (G1 attempts: {N})

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

Push after each chunk commit.

**G2 gate (Step 7):**

```bash
npm run lint && npm run typecheck
```

Cap at 3 fix attempts. On failure route to fresh `builder`. On fourth: escalate.

**Post-G2 spec-validity checkpoint (Step 7) — print verbatim:**

> **G2 complete — all chunks built.**
>
> Before proceeding to branch-level review: has anything discovered during this build invalidated the spec?
>
> Reply **continue** to proceed. Or describe the issue — coordinator writes `phase_status: PHASE_2_SPEC_DRIFT_DETECTED` to handoff.md and pauses.

**Adversarial-reviewer auto-trigger (Step 8) — include this detection:**

```bash
git diff origin/main...HEAD --name-only | \
  grep -E '^(server/db/(schema|migrations)|migrations|server/(routes|middleware|instrumentation\.ts)|server/services/(auth|permission|orgScoping|tenantContext)|server/lib/(orgScoping|scopeAssertion|canonicalActor)|shared/.*?(permission|auth|runtimePolicy)|server/config/rlsProtectedTables\.ts|server/services/.*Webhook|server/routes/.*webhook)'
```

Non-empty → invoke adversarial-reviewer. Empty → skip with note.

**dual-reviewer Codex availability check (Step 8):**

```bash
CODEX_BIN=$(command -v codex 2>/dev/null || echo "/c/Users/Michael/AppData/Roaming/npm/codex")
if [ ! -x "$CODEX_BIN" ] && [ ! -f "$CODEX_BIN" ]; then
  echo "dual-reviewer: skipped — Codex CLI unavailable"
fi
```

Unavailable → record `REVIEW_GAP: Codex CLI unavailable` in handoff.md. Do NOT block.

**Phase 2 completion invariant (Step 10) — all must pass before writing handoff:**

```
- [ ] All chunks have status done in tasks/builds/{slug}/progress.md
- [ ] G2 passed
- [ ] spec-conformance verdict is CONFORMANT or CONFORMANT_AFTER_FIXES
- [ ] pr-reviewer verdict is APPROVED
- [ ] Doc-sync gate verdicts recorded for all registered docs
```

**Phase 2 handoff section — append to handoff.md:**

```markdown
## Phase 2 (BUILD) — complete

**Plan path:** tasks/builds/{slug}/plan.md
**Chunks built:** N
**Branch HEAD at handoff:** <commit sha>
**G1 attempts (per chunk):** [chunk-name: attempts]
**G2 attempts:** N
**spec-conformance verdict:** {verdict} ({log path})
**adversarial-reviewer verdict:** {verdict or "skipped"} ({log path or n/a})
**pr-reviewer verdict:** {verdict} ({log path})
**Fix-loop iterations:** N
**dual-reviewer verdict:** {verdict} | REVIEW_GAP: Codex CLI unavailable ({log path or n/a})
**Doc-sync gate:** [verdict per doc]
**Open issues for finalisation:** [list]
```

**current-focus.md update (Step 11):** set `status: REVIEWING`, update `last_updated`. Keep `active_spec`, `active_plan`, `build_slug`, `branch` unchanged.

**End-of-phase prompt (Step 12) — print verbatim:**

> **Phase 2 (BUILD) complete.**
>
> All chunks built. Branch-level review pass complete. Doc-sync gate complete.
> Handoff updated at `tasks/builds/{slug}/handoff.md`.
> `tasks/current-focus.md` → status `REVIEWING`.
>
> **Next:** open a new Claude Code session and type:
>
> ```
> launch finalisation
> ```
>
> This session ends here.

**Auto-commit at Phase 2 close:**

```
chore(feature-coordinator): Phase 2 complete — branch-level review pass + doc-sync ({slug})

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

Push to branch.

**Abort invariant — include verbatim:**

On any abort or hard-escalation path, `tasks/current-focus.md` MUST end in `NONE` OR a named status with a matching `phase_status: *_PAUSED | *_ABORTED` in `handoff.md`. Never leave ambiguous state.

**Abort write order — include verbatim:**

Always write `handoff.md` first, then update `tasks/current-focus.md`. Never reverse.

**Failure paths must cover:**

- architect rounds exceed 3 → hard escalation; write `phase_status: PHASE_2_PAUSED_PLAN`
- plan-gate "abort" → `PHASE_2_ABORTED`, current-focus → NONE
- per-chunk plan-gap rounds exceed 2 → `PHASE_2_PAUSED_PLANGAP`; freeze remaining chunks; recovery: "Re-launch feature-coordinator — it will re-invoke architect with the full spec + current branch diff. **Architect MUST produce a complete revised plan for ALL remaining chunks — incremental patching is forbidden.**"
- G1/G2/G3 exceed 3 → escalate
- spec-conformance NON_CONFORMANT after 2 rounds → escalate; do not proceed to pr-reviewer
- pr-reviewer fix-loop exceeds 3 → escalate
- dual-reviewer Codex unavailable → skip with note
- Doc-sync gate missing verdict → block

- [ ] **Step 3: Verify acceptance criteria**

```bash
head -8 .claude/agents/feature-coordinator.md
grep "model: opus" .claude/agents/feature-coordinator.md
grep -c "builder\|PHASE_2_PAUSED\|commit-integrity\|branch-level review\|chatgpt-plan-review" .claude/agents/feature-coordinator.md
# Confirm old per-chunk reviewer pattern is gone
grep "per-chunk" .claude/agents/feature-coordinator.md
```

Expected: `model: opus`, count ≥ 5, last command returns empty.

---

## Task 8: Update adversarial-reviewer + dual-reviewer

**Files:**
- Modify: `.claude/agents/adversarial-reviewer.md`
- Modify: `.claude/agents/dual-reviewer.md`

- [ ] **Step 1: Read current adversarial-reviewer trigger section**

```bash
head -15 .claude/agents/adversarial-reviewer.md
grep -A 5 "## Trigger" .claude/agents/adversarial-reviewer.md
```

- [ ] **Step 2: Update adversarial-reviewer.md frontmatter description**

Replace the entire `description:` value with:

```yaml
description: Adversarial / threat-model review — read-only. Hunts tenant-isolation, auth, race-condition, injection, resource-abuse, and cross-tenant data-leakage holes. Auto-invoked from feature-coordinator's branch-level review pass when the branch diff matches the auto-trigger surface (server/db/schema, server/routes, auth/permission services, middleware, RLS migrations, webhook handlers — full list in 2026-04-30-dev-pipeline-coordinators-spec.md §5.1.2). Manual invocation also supported. Phase 1 advisory; non-blocking unless escalated.
```

- [ ] **Step 3: Update the `## Trigger` section in adversarial-reviewer.md**

Replace the current `## Trigger` section body with:

```markdown
## Trigger

**Auto-invoked** from `feature-coordinator`'s branch-level review pass (§2.11.2) when the committed branch diff against `origin/main` matches any of these path globs:

```
server/db/schema/**
server/db/migrations/**
migrations/**
server/routes/**
server/services/auth*/**
server/services/permission*/**
server/services/orgScoping*/**
server/services/tenantContext*/**
server/middleware/**
server/lib/orgScoping*
server/lib/scopeAssertion*
server/lib/canonicalActor*
server/instrumentation.ts
server/services/*Webhook*/**
server/routes/*webhook*/**
shared/**/permission*
shared/**/auth*
shared/**/runtimePolicy*
server/config/rlsProtectedTables.ts
```

Content-based fallback (run only if path check is empty): any file whose diff contains `db.transaction`, `withOrgTx`, `getOrgScopedDb`, `withAdminConnection`, `setSession`, `assertScope`, `tenantId`, `organisationId`, or `subaccountId` AND was added or had >5 lines changed.

**Manual invocation** also supported.

If neither check matches → skip; feature-coordinator writes `adversarial-reviewer: skipped — no auto-trigger surface match` in `progress.md`.
```

- [ ] **Step 4: Verify adversarial-reviewer.md changes**

```bash
grep "Manually invoked only" .claude/agents/adversarial-reviewer.md
grep "server/db/schema" .claude/agents/adversarial-reviewer.md
grep "dev-pipeline-coordinators-spec" .claude/agents/adversarial-reviewer.md
```

Expected: first empty, second and third match.

- [ ] **Step 5: Read current dual-reviewer local-dev section**

```bash
head -15 .claude/agents/dual-reviewer.md
grep -A 5 "Local-development-only" .claude/agents/dual-reviewer.md
```

- [ ] **Step 6: Update dual-reviewer.md frontmatter description**

Replace the `description:` value with:

```yaml
description: Second-phase Codex code-review loop with Claude adjudication. Run AFTER pr-reviewer in the feature-coordinator branch-level review pass, OR manually invoked by the operator. Local-dev only — requires the local Codex CLI; auto-invocation from feature-coordinator is skipped (with note in progress.md) when Codex is unavailable. Evaluates Codex recommendations, implements accepted fixes, loops until satisfied or 3 iterations. Caller provides a brief description of what was implemented.
```

- [ ] **Step 7: Update the "Local-development-only" paragraph in dual-reviewer.md**

Replace the paragraph starting "Local-development-only. This agent depends on the local Codex CLI; it does not run in Claude Code on the web, in CI, or in any remote sandbox. Never auto-invoke..." with:

```markdown
**Local-development-only.** This agent depends on the local Codex CLI; it does not run in Claude Code on the web, in CI, or in any remote sandbox.

**Auto-invocation rule:** auto-invoked from `feature-coordinator`'s branch-level review pass (§2.11.5 of `2026-04-30-dev-pipeline-coordinators-spec.md`) when Codex is available; skipped with a note in `progress.md` (`REVIEW_GAP: Codex CLI unavailable`) when not. Do NOT auto-invoke from any other agent. Manual invocation by the operator is always allowed and unchanged.

The PR-ready bar without dual-reviewer is: `pr-reviewer` has passed and any blocking findings are addressed.
```

- [ ] **Step 8: Verify dual-reviewer.md changes**

```bash
grep "Auto-invoked from feature-coordinator" .claude/agents/dual-reviewer.md
grep "REVIEW_GAP\|progress.md" .claude/agents/dual-reviewer.md
grep "Never auto-invoke" .claude/agents/dual-reviewer.md
```

Expected: first two match, third empty.

---

## Task 9: Update CLAUDE.md + architecture.md

**Files:**
- Modify: `CLAUDE.md`
- Modify: `architecture.md`

- [ ] **Step 1: Read current agent table in CLAUDE.md to find insertion point**

```bash
grep -n "feature-coordinator\|dual-reviewer\|adversarial-reviewer\|spec-coordinator" CLAUDE.md | head -20
```

- [ ] **Step 2: Add five new agents to the CLAUDE.md agent fleet table**

In the `| Agent | Purpose | When to invoke |` table, add these rows (after the `feature-coordinator` row):

```markdown
| `spec-coordinator` | Phase 1 orchestrator — brief intake, mockup loop, spec authoring, spec-reviewer, chatgpt-spec-review, handoff | Starting any new Significant or Major feature from a brief |
| `finalisation-coordinator` | Phase 3 orchestrator — S2 sync, G4 guard, chatgpt-pr-review, doc-sync sweep, KNOWLEDGE.md, MERGE_READY | After feature-coordinator completes Phase 2 |
| `builder` | Sonnet sub-agent — implements a single plan chunk and enforces G1 gate | Auto-invoked by feature-coordinator; never invoke directly |
| `mockup-designer` | Sonnet sub-agent — hi-fi clickable HTML prototypes, iterates round-by-round | Auto-invoked by spec-coordinator; never invoke directly |
| `chatgpt-plan-review` | Manual ChatGPT-web review coordinator for implementation plans | Auto-invoked by feature-coordinator; never invoke directly |
```

- [ ] **Step 3: Update the dual-reviewer row in the CLAUDE.md agent table**

Find the `dual-reviewer` row. Replace the "When to invoke" cell text with:

```
Automatically when feature-coordinator runs its branch-level review pass and Codex is available. Manual standalone invocation also allowed. Skipped silently when Codex is unavailable (e.g. Claude Code on the web).
```

- [ ] **Step 4: Update the adversarial-reviewer row**

Find the `adversarial-reviewer` row. Update "When to invoke" cell to:

```
Auto-invoked from feature-coordinator branch-level review pass when diff matches the security surface (§5.1.2 of dev-pipeline-coordinators-spec). Manual invocation also supported. Phase 1 advisory; non-blocking.
```

- [ ] **Step 5: Add coordinator invocations to the Common invocations section**

In the `### Common invocations` code block, add:

```bash
"spec-coordinator: <brief or rough spec topic>"   # Phase 1: spec + mockup + review
"launch feature coordinator"                       # Phase 2: build + review (new session)
"launch finalisation"                              # Phase 3: finalise + ready-to-merge (new session)
```

- [ ] **Step 6: Verify CLAUDE.md changes**

```bash
grep -c "spec-coordinator\|finalisation-coordinator\|builder.*sonnet\|mockup-designer\|chatgpt-plan-review" CLAUDE.md
grep "launch feature coordinator\|launch finalisation" CLAUDE.md
grep "Automatically when feature-coordinator" CLAUDE.md
```

Expected: ≥ 5 matches, coordinator invocations found, dual-reviewer rule found.

- [ ] **Step 7: Read architecture.md agent fleet section**

```bash
grep -n "per-chunk\|feature-coordinator\|spec-coordinator\|finalisation-coordinator" architecture.md | head -20
```

- [ ] **Step 8: Update architecture.md agent fleet entries**

Remove any references to "per-chunk pr-reviewer" or "per-chunk adversarial-reviewer". Add new coordinators to the fleet section if it lists agents.

- [ ] **Step 9: Run lint and typecheck**

```bash
npm run lint
npm run typecheck
```

Expected: both exit 0.

---

## Self-review against §10.2 acceptance criteria

Run these checks after all tasks complete.

- [ ] **§10.2.1 Agent files exist with right shape**

```bash
for f in spec-coordinator finalisation-coordinator builder mockup-designer chatgpt-plan-review; do
  echo "=== $f ==="
  head -5 .claude/agents/$f.md
done
grep "model: sonnet" .claude/agents/builder.md .claude/agents/mockup-designer.md
grep "model: opus" .claude/agents/spec-coordinator.md .claude/agents/finalisation-coordinator.md .claude/agents/chatgpt-plan-review.md
```

- [ ] **§10.2.1 feature-coordinator rewritten**

```bash
grep -c "builder\|branch-level review\|chatgpt-plan-review\|doc-sync" .claude/agents/feature-coordinator.md
```

Expected: ≥ 4

- [ ] **§10.2.2 Existing agents updated**

```bash
grep "Manually invoked only" .claude/agents/adversarial-reviewer.md
grep "server/db/schema" .claude/agents/adversarial-reviewer.md
grep "Auto-invoked from feature-coordinator" .claude/agents/dual-reviewer.md
```

Expected: first empty, second and third match.

- [ ] **§10.2.3 Documentation updated**

```bash
grep -c "spec-coordinator\|finalisation-coordinator\|chatgpt-plan-review" CLAUDE.md
grep "Automatically when feature-coordinator" CLAUDE.md
```

Expected: ≥ 3, match found.

- [ ] **§10.2.4 Housekeeping complete**

```bash
ls tasks/mockups 2>&1
ls prototypes/org-chart-redesign.html prototypes/tier-1-ui-uplift.html
grep -rn "tasks/mockups" . --include="*.md" | grep -v "node_modules" | grep -v ".git" | grep -v "docs/superpowers/specs"
```

Expected: no such directory, both files exist, no remaining references.
