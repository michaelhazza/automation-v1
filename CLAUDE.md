# Claude Code Global Playbook

This file applies to every project. Project-level CLAUDE.md files extend it with repo-specific context.

> **App-specific architecture**: See [`architecture.md`](./architecture.md) for backend conventions, route patterns, permission system, three-tier agent model, skill system, and all patterns specific to this application. Read it before making backend changes.

---

## 1. Plan Mode Default

- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- Write detailed specs upfront to reduce ambiguity
- Define both execution steps AND verification steps before starting
- If something goes sideways, STOP and re-plan immediately. Do not keep pushing.
- **Stuck detection rule:** If you attempt the same approach twice and it fails both times, you are stuck. Do not try a third time.
- Use plan mode for verification steps, not just building

## 2. Subagent Strategy

- Use subagents liberally to keep the main context window clean
- Offload research, exploration, and parallel analysis to subagents
- For complex problems, throw more compute at it via subagents
- One task per subagent for focused execution
- Parallelize thinking, not just execution

## 3. Self-Improvement Loop

- Review `KNOWLEDGE.md` at the start of each session
- Write to `KNOWLEDGE.md` proactively — not just after corrections (see KNOWLEDGE.md for triggers)
- After ANY correction from the user: always add a Correction entry to `KNOWLEDGE.md`
- Be specific. Vague entries do not prevent future mistakes.
- Never edit or remove existing entries — only append new ones
- Convert every failure into a reusable rule

## 4. Verification Before Done

- NEVER mark a task complete without proving it works
- Run tests, check logs, simulate real usage
- Diff behaviour between main and your changes when relevant
- Compare expected vs actual behaviour
- Ask yourself: "Would a senior/staff engineer approve this?"

## Verification Commands

Run these after every non-trivial change. No task is complete until all relevant checks pass.

| Trigger | Command | Max auto-fix attempts |
|---------|---------|----------------------|
| Any code change | `npm run lint` | 3 |
| Any TypeScript change | `npm run typecheck` | 3 |
| Logic change in server/ | `npm test` (or relevant suite) | 2 |
| Schema change | `npm run db:generate` — verify migration file | 1 |
| Client change | `npm run build` | 2 |

### Rules
- Run the relevant checks, not all of them, unless the change spans client + server.
- If a check fails, fix the issue and re-run. Do not mark the task complete.
- After 3 failed fix attempts on the same check, STOP and escalate to the user with:
  - The exact error output
  - What you tried
  - Your hypothesis for root cause
- Never skip a failing check. Never suppress warnings to make a check pass.

---

## 5. Demand Elegance

- For non-trivial changes: pause and ask "is there a simpler, cleaner way?"
- If a fix feels hacky, apply: "Knowing everything I know now, implement the elegant solution"
- Skip this step for simple, obvious fixes. Do not over-engineer.
- Optimise for long-term maintainability over short-term speed
- Challenge your own work before presenting it

## 6. Autonomous Bug Fixing

- When given a bug report: just fix it. Do not ask for hand-holding.
- Point at logs, errors, and failing tests, then resolve them
- Zero context switching required from the user
- Find root cause, not symptoms
- Fix failing CI tests proactively without being told how

## Stuck Detection Protocol

When stuck (same approach fails twice):

1. **STOP** — do not retry the same thing a third time
2. **Write the blocker** to `tasks/todo.md` under a `## Blockers` heading:
   - What was attempted (be specific — file, function, approach)
   - Exact error or failure mode
   - Why you think it failed (root cause hypothesis)
   - What you would try next if unblocked
3. **Ask the user** — present the blocker summary and wait for direction

### What counts as "the same approach"
- Same file edit that fails the same check twice
- Same command that errors twice with the same message
- Same architectural approach that hits the same wall
- Rephrasing the same logic does NOT count as a different approach

### What to do instead of retrying
- Try a fundamentally different approach (different algorithm, different file, different pattern)
- Read more context (maybe you're missing something)
- Check if the problem is upstream (wrong assumption, stale data, missing dependency)

---

## 7. Skills = System Layer

- Skills are NOT just markdown files. They are modular systems the agent can explore and execute.
- Each skill folder can include: reference knowledge, executable scripts, datasets, workflows, and automation
- The agent does not just read skills. It uses them.
- Use skills for: verification, automation, data analysis, scaffolding, and review
- Skills are reusable intelligence. Treat them as internal products.

**Skill categories to build toward:**

| Category | Purpose |
|---|---|
| Knowledge | Teach APIs, CLIs, and system behaviour |
| Verification | Test flows, assert correctness, check outputs |
| Data | Fetch, analyse, and compare signals |
| Automation | Run repeatable workflows |
| Scaffolding | Generate structured code and boilerplate |
| Review | Enforce quality and standards |
| CI/CD | Deploy, monitor, and rollback |
| Runbooks | Debug real production issues |
| Infra ops | Manage systems safely |

Each skill should have a single clear responsibility.

## 8. File System = Context Engine

- Structure is more valuable than volume
- Use dedicated folders to enable progressive disclosure and better reasoning:
  - `references/` for knowledge the agent needs to consult
  - `scripts/` for executable automation
  - `templates/` for reusable scaffolding
  - `tasks/` for plans, progress tracking, and lessons
- Structure improves reasoning quality. A well-organised filesystem is part of the agent's brain.

## 9. Avoid Over-Constraining the Agent

- Do not force rigid step-by-step instructions for everything
- Provide high-signal context, not micromanagement
- Let the agent adapt its approach to the problem
- Flexibility beats strict instruction sets for complex tasks
- The goal is good outcomes, not instruction compliance

## 10. Docs Stay In Sync With Code

- If a code change invalidates something described in a doc (`CLAUDE.md`, `architecture.md`, `KNOWLEDGE.md`, skill references, or any file under `references/`), update that doc **in the same session and the same commit** as the code change.
- Not later. Not "I'll come back to it." Right now, as part of the task.
- Before marking a task complete, ask: "did I change behaviour or structure that any doc describes?" If yes, the doc update is part of the task — not a follow-up.
- Stale docs are worse than missing docs. A wrong reference misleads future sessions; a missing one just sends the agent to read the code.

---

## Long Document Writing

Large single-shot `Write` calls to long documentation files can freeze Claude Code. Any time you are about to produce a documentation file (`.md`, `.mdx`, `.markdown`, `.rst`, `.adoc`, `.txt`, or an extensionless `README`/`CHANGELOG`/`LICENSE`) that will exceed **~10,000 characters** (roughly 250–300 lines of typical markdown), use the chunked workflow — no exceptions.

### Workflow

1. **Create a `TodoWrite` task list first.** One todo per chunk. The user needs to SEE the phases move through — the task list is **mandatory, not optional**. Name each todo after the section it covers (e.g. "Chunk 2/5 — Testing philosophy").
2. **Write the skeleton once.** A single `Write` call containing only the file header, table of contents, and section headings. Keep the skeleton well under the 10,000-char threshold.
3. **Append each section via `Edit`.** For every chunk: mark its todo `in_progress`, use `Edit` to append the section content, mark the todo `completed`, give the user a one-line summary of what landed, then move to the next chunk.
4. **Never batch completions.** Update the task list one chunk at a time so the user watches live progress through the phases.
5. **Track chunks in `tasks/todo.md`** for Significant or Major documents, the same as any other multi-step task.

### Enforcement

`.claude/hooks/long-doc-guard.js` runs as a `PreToolUse` hook on every `Write` tool call. If the target file is a documentation file and the content exceeds 10,000 characters, the hook blocks the call (exit 2) and feeds instructions back to Claude. If you ever see `BLOCKED by long-doc-guard`, do not try to "work around" it — follow the chunked workflow above.

Threshold and scope live in `.claude/hooks/long-doc-guard.js` (`LONG_DOC_THRESHOLD`, `DOC_EXT_RE`, `DOC_BASENAME_RE`). Update them there, not in settings.

---

## Task Management Workflow

Every non-trivial task follows this sequence:

1. **Plan First** -- Write the plan to `tasks/todo.md` with checkable items before touching code
2. **Verify Plan** -- Check in with the user before starting implementation if scope is significant
3. **Track Progress** -- Mark items complete as you go
4. **Explain Changes** -- Provide a high-level summary at each meaningful step
5. **Document Results** -- Add a review/outcome section to `tasks/todo.md` on completion
6. **Capture Lessons** -- Update `tasks/lessons.md` after any correction or unexpected finding

---

## Local Dev Agent Fleet

The local Claude Code session IS the developer. The agent fleet provides specialist support — architecture, independent review, intake, and pipeline orchestration. You are not a builder in this fleet; you are the builder.

Agents live in `.claude/agents/`. Read their definitions before invoking them.

| Agent | Purpose | When to invoke |
|-------|---------|----------------|
| `triage-agent` | Capture ideas and bugs mid-session without derailing focus | Any time an idea or bug surfaces and you don't want to lose it |
| `architect` | Architecture decisions and implementation plans | Before implementing any SIGNIFICANT or MAJOR task |
| `pr-reviewer` | Independent code review — read-only, no self-review bias | Before marking any non-trivial task done |
| `dual-reviewer` | Codex review loop with Claude adjudication — second-phase **code** review | After `pr-reviewer` on Significant and Major tasks |
| `spec-reviewer` | Codex review loop with Claude adjudication — for **spec documents**, not code. Classifies findings as mechanical / directional / ambiguous, auto-applies mechanical fixes, pauses for HITL on anything directional. Max iterations configured via MAX_ITERATIONS in `.claude/agents/spec-reviewer.md` (currently 5), stops early on two consecutive mechanical-only rounds. Reads `docs/spec-context.md` as framing ground truth. | After a draft spec is written, before starting implementation against it |
| `feature-coordinator` | End-to-end pipeline for planned multi-chunk features | Starting a new planned feature from scratch |

### Task Classification

Classify every task before starting:

| Class | Definition | Action |
|-------|-----------|--------|
| **Trivial** | Single file, obvious change, no design decisions | Implement directly |
| **Standard** | 2–4 files, clear approach, no new patterns | Implement, then invoke pr-reviewer |
| **Significant** | Multiple domains, design decisions, or new patterns | Invoke architect first, then implement, then pr-reviewer → dual-reviewer |
| **Major** | New subsystem, cross-cutting concern, or architectural change | Invoke feature-coordinator to orchestrate the full pipeline; pr-reviewer → dual-reviewer before PR |

### Invoking agents

```
# Capture an idea without stopping the session
"triage-agent: idea: [description]"

# Capture a bug
"triage-agent: bug: [description]"

# Get an architecture plan before implementing
"architect: [feature description]"

# Independent review after implementation
"pr-reviewer: review the changes I just made to [file list]"

# Full pipeline for a planned feature
"feature-coordinator: implement [feature name]"

# Second-phase Codex loop for CODE (Significant and Major tasks only)
# Run AFTER pr-reviewer has fixed initial issues
"dual-reviewer: [brief description of what was implemented]"

# Spec review loop for SPEC DOCUMENTS (not code)
# Run AFTER a draft spec is written, BEFORE implementing against it
"spec-reviewer: review docs/path-to-spec.md"
```

### Independent review is not optional

For Standard, Significant, and Major tasks — invoke `pr-reviewer` before marking done. The main session has implementation bias. The reviewer eliminates it.

For **Significant and Major tasks**, also invoke `dual-reviewer` after `pr-reviewer`. This runs up to three Codex review iterations with Claude adjudicating each recommendation — accepting valid issues, rejecting items that conflict with project conventions, and documenting the reasoning. When `dual-reviewer` finishes, the PR is ready to create.

**Before creating any PR** — regardless of task size — always run `pr-reviewer` then `dual-reviewer` before creating the pull request. Do not create a PR without both reviewers having passed.

### Spec review is the equivalent pipeline for spec documents

When a draft spec document is written (roadmaps, implementation specs, architecture plans, phased build plans), invoke `spec-reviewer` before starting implementation against it. This is the spec-document equivalent of the `dual-reviewer` loop for code. The agent:

- Reads `docs/spec-context.md` as framing ground truth before every run.
- **Hard lifetime cap: 5 iterations per spec, total, across every invocation.** Not 5-per-invocation — 5 lifetime. If a spec has already seen 5 spec-reviewer iterations (count the `tasks/spec-review-checkpoint-<slug>-<N>-*.md` files or the iteration numbers in their content), do not start a new iteration. If the spec has had substantive edits since the last clean exit and you believe more review is needed, surface that to the user and ask whether to bust the cap — do not silently re-invoke.
- Stops early on two consecutive mechanical-only rounds.
- Classifies every finding as **mechanical**, **directional**, or **ambiguous**.
- **Auto-applies mechanical findings** (contradictions, stale language, file inventory drift, sequencing bugs, under-specified contracts).
- **Pauses for HITL** on directional or ambiguous findings (scope changes, phase re-ordering, testing posture changes, rollout posture changes, architecture changes, anything that would invalidate a baked-in framing assumption).
- Writes checkpoint files at `tasks/spec-review-checkpoint-<spec-slug>-<iteration>-<timestamp>.md` when HITL is needed. The human edits the checkpoint's `Decision:` lines and re-invokes the agent to resume.

**Directional findings are never auto-applied, even if the recommendation looks obviously correct.** The classifier biases aggressively toward HITL — a false positive costs 30 seconds of reading; a false negative costs a wrong-shaped spec and a re-review round.

**When to invoke `spec-reviewer`:**

- After writing any non-trivial spec document
- Before starting implementation against a spec
- After a major edit to an existing spec (e.g. incorporating feedback from a stakeholder) — **but only if the 5-iteration lifetime cap has not been reached**
- NOT for trivial doc updates (typos, one-line clarifications) — just edit and move on
- NOT for mid-loop spec additions where the review has already cleanly exited once — the spec-review pipeline is not a perfection engine, and re-invoking after every refinement creates an infinite-loop failure mode that has already burned real session time. Diminishing returns kick in fast. Apply judgement and move on to the architect or build phase.

---

## Current focus

**In-flight spec:** none
**Active items:** none

This pointer is hand-maintained. Update it whenever the current spec or sprint changes. **A stale pointer is worse than no pointer** because it actively misleads future agent sessions about what to focus on. If the project has no in-flight spec, set both fields to `none` rather than leaving them stale.

---

## Key files per domain

Quick reference for "where do I start when adding X". This is the index, not the deep reference — `architecture.md` is the deep reference for everything below.

| Task | Start here |
|------|------------|
| Add a new agent skill | `server/skills/`, `server/config/actionRegistry.ts` |
| Add a new tool action | `server/config/actionRegistry.ts`, `server/services/skillExecutor.ts` |
| Add a new database table | `server/db/schema/`, `migrations/` (next free sequence number) |
| Add a new pg-boss job | `server/jobs/`, `server/jobs/index.ts` (registration) |
| Add a new agent middleware | `server/services/middleware/`, `server/services/middleware/index.ts` |
| Add a new client page | `client/src/pages/`, router config in `client/src/App.tsx` |
| Add a new permission key | `server/lib/permissions.ts` |
| Add a new static gate | `scripts/verify-*.sh`, `scripts/run-all-gates.sh` |
| Add a new run-time test | `server/services/__tests__/` (pure file pattern: `*Pure.test.ts`) |
| Modify the agent execution loop | `server/services/agentExecutionService.ts`, `agentExecutionServicePure.ts` |
| Add a new workspace health detector | `server/services/workspaceHealth/detectors/`, then re-export from `detectors/index.ts` |

---

## Capturing Ideas During Development

When a feature idea, UX improvement, or "nice to have" surfaces during a dev session:

1. **Do not implement it.** Stay focused on the current task.
2. **Invoke triage-agent** with a brief description: `"triage-agent: idea: [description]"`.
3. **Continue the current task.** The idea is captured and queued.
4. **Triage the queue** at the next natural break: `"triage-agent: let's triage"`.

Ideas that seem valuable in isolation may be low priority in context. Let triage decide.

---

## Architecture Rules (Automation OS specific)

These are non-negotiable. Violations are blocking issues in any code review.

### Server
- **Routes** call services only — never access `db` directly in a route
- **`asyncHandler`** wraps every async handler — no manual try/catch in routes
- **Service errors** throw as `{ statusCode, message, errorCode? }` — never raw strings
- **`resolveSubaccount(subaccountId, orgId)`** called in every route with `:subaccountId`
- **Auth middleware** — `authenticate` always first, then permission guards as needed
- **Org scoping** — all queries filter by `organisationId` using `req.orgId` (not `req.user.organisationId`)
- **Soft deletes** — always filter with `isNull(table.deletedAt)` on soft-delete tables
- **Schema changes** — Drizzle migration files only; never raw SQL schema changes

### Agent system
- **Three-tier model** (System → Org → Subaccount) must be respected in all agent-related changes
- **System-managed agents** — `isSystemManaged: true` means masterPrompt is not editable; only additionalPrompt
- **Idempotency keys** — all new agent run creation paths must support deduplication
- **Heartbeat changes** — account for `heartbeatOffsetMinutes` (minute-level precision)
- **Handoff depth** — check `MAX_HANDOFF_DEPTH` (5) in `server/config/limits.ts`

### Client
- **Lazy loading** — all page components use `lazy()` with `Suspense` fallback
- **Permissions-driven UI** — visibility gated by `/api/my-permissions` or `/api/subaccounts/:id/my-permissions`
- **Real-time updates** — new features that update state use WebSocket rooms via `useSocket`

---

## Core Principles

- **Simplicity First** -- Make every change as simple as possible. Impact minimal code.
- **No Lazy Fixes** -- Find root causes. No temporary patches. Senior developer standards.
- **Systems over Prompts** -- Better systems scale. Better prompts do not.
- **Verification over Generation** -- Proving something works matters more than producing it fast.
- **Iteration over Perfection** -- Ship, learn, improve. Do not stall waiting for perfect.
- **Structure over Volume** -- A well-organised project with less content beats a dumped context window.

---

## User Preferences

- Concise communication, no emojis
- No auto-commits or auto-pushes — the user commits explicitly after reviewing changes
- Stop and ask when requirements are ambiguous enough to affect architecture
