# Claude Code Global Playbook

This file applies to every project. Project-level CLAUDE.md files extend it with repo-specific context.

> **App-specific architecture**: See [`architecture.md`](./architecture.md) for backend conventions, route patterns, permission system, three-tier agent model, skill system, and all patterns specific to this application. Read it before making backend changes.
>
> **Capabilities registry**: See [`docs/capabilities.md`](./docs/capabilities.md) for the full catalogue of product capabilities, agency capabilities, skills, and integrations. Update it in the same commit when adding features or skills.
>
> **Editorial rules for `docs/capabilities.md` (persistent — apply to every update):**
>
> 1. **No specific LLM / AI provider or product names** in the customer-facing sections — Core Value Proposition, Positioning & Competitive Differentiation, Product Capabilities, Agency Capabilities, Replaces / Consolidates. Do not reference Anthropic, Claude, Claude Code, Cowork, Routines, Managed Agents, Agent SDK, OpenAI, ChatGPT, GPT, Gemini, Google, Microsoft Copilot, or any other named provider or their product lines in these sections. Use generic category language instead: *"LLM providers," "foundation model vendors," "hosted agent platforms," "shared team chat products," "scheduled-prompt tools," "agent SDKs,"* etc.
> 2. **Named provider references are permitted only in the Support-facing sections** — Integrations Reference and Skills Reference — where they are factual product documentation, not marketing. Even there, prefer neutral factual phrasing over marketing language.
> 3. **Use marketing- and sales-ready terminology throughout the customer-facing sections.** Write for end-users, agency owners, and buyers — not engineers. Avoid internal technical identifiers (table names, service names, library names such as `pg-boss`, `BullMQ`, `Drizzle`) in customer-facing sections. Industry-standard terms (OAuth, HTTP, webhook, Docker, Playwright) are acceptable when they clarify the offering.
> 4. **Positioning stays vendor-neutral even under objection.** If a prospect asks "why not Anthropic / Claude / OpenAI specifically?", the written collateral still uses generic category language — *"LLM providers sell capability; Synthetos sells the business."* Specific vendor responses belong in live sales conversations, not in the registry.
> 5. **Model-agnostic is the north star.** When the topic of LLM choice comes up, frame Synthetos as *"model-agnostic across every frontier and open-source LLM — we route to the best one per task."* Never imply a default, preferred, or premium provider in customer-facing copy.
>
> Violations of rules 1–5 block the edit — revise before committing.

---

## 1. Plan Mode Default

- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- Write detailed specs upfront to reduce ambiguity
- Define both execution steps AND verification steps before starting
- **Rewrite goals as verifiable assertions before starting.** "Add validation" becomes "Write tests for invalid inputs, then make them pass." "Fix the bug" becomes "Write a test that reproduces it, then make it pass." Prefer assertions that can be validated automatically (tests, logs, deterministic checks) over subjective evaluation. Strong success criteria let you loop independently; vague instructions ("make it work") require constant clarification.
- If something goes sideways, STOP and re-plan immediately. Do not keep pushing.
- **Stuck detection rule:** If you attempt the same approach twice and it fails both times, you are stuck. Do not try a third time.
- Use plan mode for verification steps, not just building

## 2. Subagent Strategy

- Use subagents liberally to keep the main context window clean
- Offload research, exploration, and parallel analysis to subagents
- For complex problems, throw more compute at it via subagents
- One task per subagent for focused execution
- Parallelize thinking, not just execution
- **After writing an implementation plan, do not ask "which execution option?" — proceed immediately with `superpowers:subagent-driven-development`.** Never prompt the user to choose between subagent-driven and inline execution. This overrides the writing-plans skill's default "offer execution choice" step.

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

## 6. Surgical Changes

- Every changed line should trace directly to the user's request. If it doesn't, revert it.
- If you notice unrelated dead code, mention it in your response — don't delete it. LLMs are overconfident about what's "certainly unused." The cost of a wrong deletion is high; the cost of mentioning it is zero.
- Remove imports/variables/functions that YOUR changes made unused. Don't remove pre-existing dead code unless asked.
- Match existing style, even if you'd do it differently. No drive-by reformatting.

## 7. Autonomous Bug Fixing

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

## 8. Skills = System Layer

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

## 9. File System = Context Engine

- Structure is more valuable than volume
- Use dedicated folders to enable progressive disclosure and better reasoning:
  - `references/` for knowledge the agent needs to consult
  - `scripts/` for executable automation
  - `templates/` for reusable scaffolding
  - `tasks/` for plans, progress tracking, and lessons
- Structure improves reasoning quality. A well-organised filesystem is part of the agent's brain.

## 10. Avoid Over-Constraining the Agent

- Do not force rigid step-by-step instructions for everything
- Provide high-signal context, not micromanagement
- Let the agent adapt its approach to the problem
- Flexibility beats strict instruction sets for complex tasks
- The goal is good outcomes, not instruction compliance

## 11. Docs Stay In Sync With Code

- If a code change invalidates something described in a doc (`CLAUDE.md`, `architecture.md`, `KNOWLEDGE.md`, skill references, or any file under `references/`), update that doc **in the same session and the same commit** as the code change.
- Not later. Not "I'll come back to it." Right now, as part of the task.
- Before marking a task complete, ask: "did I change behaviour or structure that any doc describes?" If yes, the doc update is part of the task — not a follow-up.
- Stale docs are worse than missing docs. A wrong reference misleads future sessions; a missing one just sends the agent to read the code.

---

## 12. Context Management

Keep context lean so Claude stays sharp across long sessions.

**Compact protocol** — When context usage reaches ~50–60% (visible in the VS Code status line or via `/context`):
1. If working under a build slug, update `tasks/builds/<slug>/progress.md` with current session state: what was done, what's next, any decisions made.
2. Run `/compact`

Do not wait until the context is full — quality degrades before the hard limit.

**Pre-break protocol** — Before stepping away from a session:
1. If working under a build slug, save current progress to `tasks/builds/<slug>/progress.md`.
2. Run `/compact`

This reduces reprocessing cost when the session resumes and prevents the 5-minute prompt-cache expiry from triggering a full context reread at full cost.

**Session isolation for concurrent work** — When running multiple sessions in parallel on different features:
- Each session writes to its own `tasks/builds/<slug>/progress.md` — never to a shared file
- `tasks/current-focus.md` is the sprint-level pointer (what spec/feature is in flight overall), not a per-session scratch pad
- Concurrent sessions cannot collide as long as each stays within its own `tasks/builds/<slug>/` directory

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
| `spec-conformance` | Verifies implemented code matches its source spec. Auto-detects the spec (from branch diff / build slug / `current-focus`) and the changed-code set (committed + staged + unstaged + untracked). Mixed-mode: auto-fixes mechanical gaps the spec explicitly names; routes directional gaps to `tasks/todo.md`. Never modifies the spec. Never adds features the spec doesn't name. Self-writes its log to `tasks/review-logs/spec-conformance-log-<slug>[-<chunk-slug>]-<timestamp>.md` (chunk-slug present for per-chunk invocations from `feature-coordinator`). | After the development session claims completion on any spec-driven task, **before** `pr-reviewer`. Mandatory for Standard / Significant / Major tasks that had a spec as the source of truth. Skipped automatically if no spec is detected (the agent reports "no spec detected" and returns). Not applicable to Trivial fixes or ad-hoc changes without a spec. |
| `pr-reviewer` | Independent code review — read-only, no self-review bias | Before marking any non-trivial task done. For spec-driven tasks, run `spec-conformance` first. |
| `dual-reviewer` | Codex review loop with Claude adjudication — second-phase **code** review. **Local-dev only — requires the local Codex CLI; unavailable in Claude Code on the web.** | After `pr-reviewer` on Significant and Major tasks — **only when the user explicitly asks**, never auto-invoked |
| `spec-reviewer` | Codex review loop with Claude adjudication — for **spec documents**, not code. Classifies findings as mechanical / directional / ambiguous, auto-applies mechanical fixes, autonomously decides directional findings using baked-in framing assumptions (pre-production, rapid evolution, no feature flags, prefer existing primitives). Uncertain decisions route to `tasks/todo.md` — never blocks. Max iterations configured via MAX_ITERATIONS in `.claude/agents/spec-reviewer.md` (currently 5), stops early on two consecutive mechanical-only rounds. Reads `docs/spec-context.md` as framing ground truth. | After writing any non-trivial spec, before starting implementation. Also after a major stakeholder edit — **but only if the 5-iteration lifetime cap has not been reached**. NOT for trivial updates (typos, one-liners). NOT mid-loop after a clean exit — diminishing returns, move to architect/build instead. |
| `feature-coordinator` | End-to-end pipeline for planned multi-chunk features | Starting a new planned feature from scratch |
| `audit-runner` | Runs codebase audits per `docs/codebase-audit-framework.md`. Three modes — Full / Targeted / Hotspot. Executes the three-pass model (findings → high-confidence fixes → deferred), self-writes the audit log to `tasks/review-logs/codebase-audit-log-<scope>-<timestamp>.md`, routes deferred items to `tasks/todo.md`. Uses a TodoWrite task list to process areas one by one without spawning sub-agents. Prints post-audit commands (`spec-conformance`, `pr-reviewer`) for the caller to run after the audit completes. Auto-commits and auto-pushes within its own flow. Does not create PRs — the user does. | Periodic codebase hygiene (quarterly), pre-major-release gating, post-incident health check, or any time a subsystem (RLS, agent execution, queues, skills, webhooks, frontend) feels gnarly. Default to Hotspot mode. |
| `chatgpt-pr-review` | ChatGPT PR review coordinator — captures feedback rounds, implements accepted changes, logs all decisions, finalises with KNOWLEDGE.md updates. **Run in a dedicated new Claude Code session (VS Code terminal CLI or new Claude Code web conversation).** | After `pr-reviewer` and/or `dual-reviewer`, when doing a ChatGPT pass on a PR |
| `chatgpt-spec-review` | ChatGPT spec review coordinator — auto-detects the spec, captures feedback rounds, applies accepted edits, logs all decisions, finalises with KNOWLEDGE.md updates. **Run in a dedicated new Claude Code session.** | After drafting a spec, when doing a ChatGPT review pass before implementation |

### Model guidance per phase

Use the most capable model where reasoning matters; switch to Sonnet once decisions are made and execution is the task.

| Phase | Model | What happens |
|-------|-------|--------------|
| Spec authoring | Opus | Writing specs, architecture decisions, `chatgpt-spec-review` passes |
| Plan breakdown | Opus | Invoking `architect` to decompose a finalised spec into implementation chunks |
| **Plan gate** | — | `feature-coordinator` presents the finalised plan and **stops**. Review it at `tasks/builds/{slug}/plan.md`, then manually switch to Sonnet before proceeding. |
| Execution | Sonnet | Running `superpowers:executing-plans` / `subagent-driven-development` against the plan |
| Mid-build decision | Opus | If a hard architectural choice surfaces during implementation, switch back to Opus for that question only, then return to Sonnet |

The plan gate is a deliberate checkpoint. Do not proceed to execution on Opus — the execution phase is token-intensive and Sonnet handles a clear plan equally well at lower cost.

### Task Classification

Classify every task before starting:

| Class | Definition | Action |
|-------|-----------|--------|
| **Trivial** | Single file, obvious change, no design decisions | Implement directly |
| **Standard** | 2–4 files, clear approach, no new patterns | Implement, then `spec-conformance` (if spec-driven), then `pr-reviewer` |
| **Significant** | Multiple domains, design decisions, or new patterns | Invoke architect first, then implement, then `spec-conformance` (if spec-driven), then `pr-reviewer`. `dual-reviewer` optionally — **only if the user explicitly asks and the session is running locally** (see note below). |
| **Major** | New subsystem, cross-cutting concern, or architectural change | Invoke feature-coordinator to orchestrate the full pipeline (architect → implement → `spec-conformance` → `pr-reviewer`). `dual-reviewer` optionally — **only if the user explicitly asks and the session is running locally** (see note below). |

### Invoking agents

```
# Capture an idea without stopping the session
"triage-agent: idea: [description]"

# Capture a bug
"triage-agent: bug: [description]"

# Get an architecture plan before implementing
"architect: [feature description]"

# Verify the code matches the spec — runs BEFORE pr-reviewer on spec-driven tasks
# Auto-detects the spec and changed files. Auto-fixes mechanical gaps.
# Routes directional gaps to tasks/todo.md. Never edits the spec.
"spec-conformance: verify the current branch against its spec"
# (optionally scope to a phase/chunk if a long plan is only partially implemented)
"spec-conformance: verify phase 1 of [spec path]"

# Independent review after implementation
"pr-reviewer: review the changes I just made to [file list]"

# Full pipeline for a planned feature
"feature-coordinator: implement [feature name]"

# Codebase audit per docs/codebase-audit-framework.md
# IMPORTANT: audit-runner runs INLINE in the current session — do NOT use the Agent tool.
# Read .claude/agents/audit-runner.md and execute the instructions directly so the
# TodoWrite task list is visible to the user.
# Default to Hotspot mode. Subsystems: rls, agent-execution, queues, skills, webhooks, frontend
"audit-runner: hotspot rls"
"audit-runner: hotspot agent-execution"
"audit-runner: targeted areas 1,2,7 modules I,J"
"audit-runner: full"

# Second-phase Codex loop for CODE — LOCAL DEV ONLY, manual trigger only.
# dual-reviewer depends on the local Codex CLI. It is NOT available in Claude
# Code on the web. Never auto-invoke — only run when the user explicitly asks.
"dual-reviewer: [brief description of what was implemented]"

# Spec review loop for SPEC DOCUMENTS (not code)
# Run AFTER a draft spec is written, BEFORE implementing against it
"spec-reviewer: review docs/path-to-spec.md"
```

### Independent review is not optional

For Standard, Significant, and Major tasks — invoke `pr-reviewer` before marking done. The main session has implementation bias. The reviewer eliminates it.

**For spec-driven tasks, run `spec-conformance` before `pr-reviewer`.** The development session can silently miss spec items (missed files, missed exports, missed columns, missed error codes) while claiming completion. `spec-conformance` catches those gaps: it auto-fixes the mechanical ones (where the spec explicitly names the missing item) and routes directional gaps to `tasks/todo.md` for human resolution. If `spec-conformance` applied any mechanical fixes, re-run `pr-reviewer` on the expanded changed-code set — the reviewer needs to see the final state, not the pre-fix state.

**Processing `spec-conformance` NON_CONFORMANT findings — standalone contract.** When `spec-conformance` returns `NON_CONFORMANT` (directional/ambiguous gaps routed to `tasks/todo.md`), the caller — whether `feature-coordinator` or a manual invocation by the main session — processes the dated section the same way `pr-reviewer` findings are processed: (1) non-architectural gaps → fix in-session, then re-invoke `spec-conformance` to confirm closure (max 2 re-invocations); (2) architectural gaps (significant redesign, contract change, multi-service impact) → leave in the dated section as the raw record AND promote into `## PR Review deferred items / ### <slug>` so they survive across review cycles — do not re-invoke `spec-conformance`, escalate instead. This rule applies identically regardless of whether `spec-conformance` was invoked by `feature-coordinator` per-chunk or manually via `spec-conformance: verify the current branch against its spec`.

If no spec was the source of truth for the task (ad-hoc bug fix, small refactor), `spec-conformance` is not applicable — skip it.

**Before creating any PR** — regardless of task size — always run `pr-reviewer` before creating the pull request. For spec-driven work, that means: `spec-conformance` → `pr-reviewer` (re-run after any mechanical fixes `spec-conformance` applied) → (optionally `dual-reviewer`) → PR.

### `dual-reviewer` is a local-development-only optional add-on

`dual-reviewer` runs a Codex CLI review loop with Claude adjudicating each recommendation. It is **only available when the session is running locally** on a machine with the Codex CLI installed and authenticated — it does **not** run in Claude Code on the web, in CI, or in any remote sandbox.

**Never auto-invoke `dual-reviewer`.** The main session must not spawn this agent on its own judgement, even for Significant or Major tasks. Auto-invocation in a non-local environment hangs the session waiting on a command that cannot execute, and silently burns time on a review the user did not ask for.

**Only invoke `dual-reviewer` when:**

1. The user **explicitly** asks for it (e.g. "run dual-reviewer", "do the Codex pass"), AND
2. The session is local. If uncertain, ask the user before spawning.

The PR-ready bar for this project is: `pr-reviewer` has passed and any blocking findings are addressed. `dual-reviewer` is a power-user add-on for an extra pass when the local environment supports it — not a gate on the PR.

### Review logs must be persisted

Every review-loop invocation — `pr-reviewer`, `dual-reviewer`, `spec-reviewer`, `spec-conformance`, `chatgpt-pr-review`, `chatgpt-spec-review` — produces a durable log on disk under `tasks/review-logs/`. All review logs live in that single directory to keep the main `tasks/` tree uncluttered. The logs exist so recurring findings can be mined across many reviews and folded back into the review rubrics, `CLAUDE.md`, or `architecture.md`.

- **`pr-reviewer` caller contract.** `pr-reviewer` is read-only — it emits its complete review inside a fenced markdown block tagged `pr-review-log`. **Before fixing any issues**, the caller (main session or `feature-coordinator`) must extract the block verbatim and write it to `tasks/review-logs/pr-review-log-<slug>-<timestamp>.md`, where `<slug>` is the feature slug (if working under `tasks/builds/<slug>/`) or a short kebab-case name otherwise, and `<timestamp>` is ISO 8601 UTC with seconds. Persist first, then fix — this captures the raw reviewer voice before code changes overwrite the context. **After persisting**, process findings in this order: (1) Blocking non-architectural findings → implement in-session; (2) Blocking findings that are architectural in nature (significant redesign, contract change, multi-service impact) → route to `tasks/todo.md` under `## PR Review deferred items / ### <slug>` rather than attempting in-place; (3) Strong Recommendations → implement if in-scope, otherwise defer to the same backlog section.
- **`spec-conformance` self-writes.** `spec-conformance` writes its own log to `tasks/review-logs/spec-conformance-log-<slug>[-<chunk-slug>]-<timestamp>.md` per its agent spec. `<chunk-slug>` is present when the agent is invoked by `feature-coordinator` per-chunk (matches the `pr-review-log-<slug>-<chunk-slug>-<timestamp>.md` precedent), and omitted for manual whole-branch invocations. The agent also appends its directional/ambiguous findings to `tasks/todo.md` under a dated section (`## Deferred from spec-conformance review — <spec-slug>`). The caller does not need to persist anything — just read the log path the agent returns. If the log's Next-step verdict is `CONFORMANT_AFTER_FIXES`, the agent modified files in-session and the caller must re-run `pr-reviewer` on the expanded changed-code set. If the Next-step verdict is `NON_CONFORMANT`, triage the dated section: non-architectural gaps resolve in-session the same way as `pr-reviewer` blocking findings, then re-invoke `spec-conformance` to confirm closure; architectural gaps stay in the dated section (the raw record), and the caller additionally promotes them into `## PR Review deferred items / ### <slug>` so they survive across review cycles — do not re-invoke `spec-conformance` if the remaining gap set is architectural-only or ambiguous-only, escalate to the user instead.
- **`dual-reviewer` self-writes.** `dual-reviewer` writes its own log to `tasks/review-logs/dual-review-log-<slug>-<timestamp>.md` per its agent spec. The caller does not need to persist anything — just read the log path the agent returns.
- **`chatgpt-pr-review` and `chatgpt-spec-review` self-write.** Both agents write their own session logs to `tasks/review-logs/chatgpt-pr-review-<slug>-<timestamp>.md` and `tasks/review-logs/chatgpt-spec-review-<slug>-<timestamp>.md` respectively. The caller does not need to persist anything.

If a reviewer ran, the log must exist. This applies regardless of task classification (Trivial / Standard / Significant / Major).

### Review-log filename convention — canonical definition

All review-log filenames use the shape:

```
tasks/review-logs/<agent>-log-<slug>[-<chunk-slug>]-<timestamp>.md
```

- **`<slug>`** — the feature/spec slug when working under `tasks/builds/<slug>/`, otherwise a short kebab-case name derived from the branch or spec path.
- **`<chunk-slug>`** — present ONLY when the review is scoped to a single plan chunk (e.g. `feature-coordinator` per-chunk invocations of `spec-conformance` or `pr-reviewer`); omitted for manual whole-branch invocations. **Format: kebab-case of the chunk name — lower-case, ASCII, hyphen-separated, no spaces or underscores, no duplicate hyphens.** Derive deterministically: lowercase the chunk name, replace any run of non-alphanumeric characters with a single hyphen, trim leading/trailing hyphens. Example: chunk name `"DB schema — agent_runs"` → `db-schema-agent-runs`.
- **`<timestamp>`** — ISO 8601 UTC with seconds and hyphens between time fields (e.g. `2026-04-22T07-08-30Z`).

Every agent that writes a review log (`pr-reviewer`, `dual-reviewer`, `spec-reviewer`, `spec-conformance`, `chatgpt-pr-review`, `chatgpt-spec-review`) uses this shape. When referencing the review log from another artifact (`tasks/todo.md` source-log field, `progress.md` Notes column, a scratch file), use the same slug and chunk-slug so all three match.

### Deferred actions route to `tasks/todo.md` — single source of truth

Every review loop — `pr-reviewer`, `dual-reviewer`, `spec-reviewer`, `spec-conformance`, `chatgpt-pr-review`, `chatgpt-spec-review` — that produces deferred action items writes them to **`tasks/todo.md`**, not to per-session side files. The review log in `tasks/review-logs/` keeps the raw finding-by-finding record; `tasks/todo.md` carries the curated backlog.

Why one file: a future session picking up deferred work needs to grep one place, not scan a directory of session logs. Existing sections (Hermes Tier 1, Live Agent Execution Log) already use this pattern.

Append rules:
- **New dated section per review session** — heading shape `## Deferred from <agent> review — <PR-or-spec-ref>` with `**Captured**`, `**Source log**`, and a checkbox list. Never mix a new review's items into an existing feature's section.
- **Append-only** — never rewrite or delete existing sections. Future triage sessions close items by checking the box, not by deleting the line.
- **Dedup before append** — scan for a similar existing entry (same `finding_type` OR same leading ~5 words); skip if already present so re-runs don't duplicate.
- **Docs-cleanup trigger.** The ChatGPT review agents call this step automatically at finalization (see `docs/superpowers/specs/2026-04-22-chatgpt-review-agents-design.md` §Agent: `chatgpt-pr-review` Finalization step 5, and the mirror step in the spec-review agent). Manual reviewers (humans, or sessions running `pr-reviewer` / `spec-reviewer`) follow the same convention when promoting a review finding to a backlog item.
- **No concurrent review agents against the same repo.** `tasks/todo.md` is a single shared file — two review agents appending simultaneously will race on the write. The human-in-the-loop invocation model already prevents this in practice; don't fight it by fanning out review agents in parallel on the same branch.

The superseded file `tasks/review-logs/_deferred.md` was never created — the convention is `tasks/todo.md` from day one.

### Before you write a spec

For any Significant or Major spec, read `docs/spec-authoring-checklist.md` before drafting. It is a pre-authoring checklist derived from patterns the `spec-reviewer` has caught across 15+ production specs — primitives-reuse search, file-inventory lock, contracts, RLS/permissions, execution model, phase sequencing, deferred items, self-consistency, and testing posture.

The checklist points back at the deep references in `architecture.md` and `docs/spec-context.md`; it does not restate them. Authors who work through the appendix checklist before invoking `spec-reviewer` shorten the review loop — every unchecked box is a finding the reviewer will raise anyway.

Trivial specs (typos, one-line clarifications, pure ADRs) do not need the checklist — just write and move on.

---

## Current focus

See [`tasks/current-focus.md`](./tasks/current-focus.md). Update it whenever the sprint, spec, or active branch changes. A stale pointer misleads future sessions — keep it current or set it to `none`.

> **Authoritative references live in `architecture.md`, not here.** CLAUDE.md intentionally contains no canonical file mappings, route patterns, or service contracts. Do not duplicate that content here — update `architecture.md` directly. If you find a mapping in both files that differs, `architecture.md` wins.

---

## Key files per domain

See [`architecture.md` § Key files per domain](./architecture.md). This is the index for domain entry points — update it when adding new domain areas.

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

See [`architecture.md` § Architecture Rules](./architecture.md). Violations are blocking issues in any code review.

---

## Core Principles

- **Simplicity First** -- Make every change as simple as possible. Impact minimal code.
- **No Lazy Fixes** -- Find root causes. No temporary patches. Senior developer standards.
- **Systems over Prompts** -- Better systems scale. Better prompts do not.
- **Verification over Generation** -- Proving something works matters more than producing it fast.
- **Iteration over Perfection** -- Ship, learn, improve. Do not stall waiting for perfect.
- **Structure over Volume** -- A well-organised project with less content beats a dumped context window.

---

## Non-goals: what Automation OS is NOT

See [`docs/capabilities.md` § Non-goals](./docs/capabilities.md). These are durable product stances — review before proposing features that compete with provider primitives.

---

## Frontend Design Principles

**Automation OS is a consumer-simple product built on enterprise-grade backend capability.** Backend specs stay thorough — they must cover the full capability surface. Frontend surfaces stay minimal — they must be usable by non-technical operators without training. A rich backend does not justify a rich UI; those are two different decisions.

The failure mode to avoid: surfacing every backend capability the spec exposes as a frontend screen. Utilization metrics, attribution hashes, per-tenant aggregations, diagnostic panels — the backend needs to compute them; the UI almost never needs to render them by default. Most of them either belong in admin-only views, behind progressive disclosure, or deferred out of v1 entirely.

**Five hard rules — applied to every UI artifact (mockup, component, page):**

1. **Start with the user's primary task, not the data model.** Before sketching any screen, answer: *what single task is the user here to complete?* Design the minimum surface for that task. If you find yourself designing from "the backend exposes columns X, Y, Z — so the UI shows panels X, Y, Z", stop and start over from the task.
2. **Default to hidden.** Metric dashboards, KPI boards, trend charts, diagnostic panels, prefix-hash / ID exposure, aggregated-cost views, per-tenant financial breakdowns, observability surfaces — all **deferred by default**. Ship them only when a specific user asks for a specific workflow that requires them, or when they go in an admin-only view that the average user never sees.
3. **One primary action per screen.** If a screen has ≥ 2 primary actions, split it. If it has ≥ 3 sidebar panels, cut one. If it has a table AND a chart AND a ranking AND KPI tiles, you're rebuilding a monitoring product on top of the core product.
4. **Inline state beats dashboards.** A status dot next to a name beats a utilization dashboard. A single "last run · succeeded" line beats a run-history panel. Before adding a new page, ask: *can this live as inline state on a page that already exists?* Usually yes.
5. **The re-check.** Before committing any UI artifact, ask: *would a non-technical operator complete the primary task on this screen without feeling overwhelmed?* If the answer is anything other than "yes, obviously", cut information until it is.

**Deep rationale, pre-design checklist, worked good-vs-bad examples:** see [`docs/frontend-design-principles.md`](./docs/frontend-design-principles.md). Read that doc before generating a mockup or designing a new page.

---

## User Preferences

- Concise communication, no emojis
- No auto-commits or auto-pushes from the main session — the user commits explicitly after reviewing changes. **Exception:** review agents (`spec-reviewer`, `spec-conformance`, `dual-reviewer`, `chatgpt-pr-review`, `chatgpt-spec-review`, `audit-runner`) auto-commit and auto-push within their own flows; the user has explicitly opted in so review output persists to the remote and is visible across sessions. Read-only reviewers (`pr-reviewer`) never commit.
- Stop and ask when requirements are ambiguous enough to affect architecture
