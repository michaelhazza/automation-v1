# Claude Code Global Playbook

This file applies to every project. Project-level CLAUDE.md files extend it with repo-specific context.

> **App-specific architecture**: See [`architecture.md`](./architecture.md) for backend conventions, route patterns, permission system, three-tier agent model, skill system, and all patterns specific to this application. Read it before making backend changes.
>
> **Development guidelines**: See [`DEVELOPMENT_GUIDELINES.md`](./DEVELOPMENT_GUIDELINES.md) for build discipline, RLS rules, schema invariants, gate protocol, migration rules, testing posture, multi-tenant safety checklist, and the §8 development-discipline rule set. Read it before any non-trivial PR — the §8 rules (idempotency, error handling, sort tiebreakers, lifecycle hooks, deferred-enforcement logging, etc.) apply across `server/`, `client/`, and `shared/`, not just backend tenant code.
>
> **Capabilities registry**: See [`docs/capabilities.md`](./docs/capabilities.md) for the full catalogue of product capabilities, agency capabilities, skills, and integrations. Update it in the same commit when adding features or skills. **Editorial Rules** (vendor-neutral, marketing-ready, model-agnostic) live in `docs/capabilities.md` § *Editorial Rules* — violations block the edit.

---

## 1. Plan Mode Default

- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- Write detailed specs upfront to reduce ambiguity
- Define both execution steps AND verification steps before starting
- **Rewrite goals as verifiable assertions before starting.** "Add validation" becomes "Write tests for invalid inputs, then make them pass." "Fix the bug" becomes "Write a test that reproduces it, then make it pass." Prefer assertions that can be validated automatically (tests, logs, deterministic checks) over subjective evaluation.
- If something goes sideways, STOP and re-plan immediately. Do not keep pushing.
- Use plan mode for verification steps, not just building

**Stuck detection.** If the same approach fails twice (same file edit failing the same check, same command erroring with the same message, same architectural approach hitting the same wall — rephrasing the same logic does NOT count as different), you are stuck. STOP. Write the blocker to `tasks/todo.md` under `## Blockers` (what was attempted, exact failure, root-cause hypothesis, what you'd try next), then ask the user. Do not try a third time. Try a fundamentally different approach, read more context, or check if the problem is upstream — never retry-with-rephrasing.

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

### Gate-cadence rule (overrides default per-change verification for `npm run test:gates` and `bash scripts/run-all-unit-tests.sh`)

Both the unit test suite and gate scripts are **expensive** and run exactly ONCE each at programme-end, in this order:

1. `bash scripts/run-all-unit-tests.sh` — after all chunks + spec-conformance complete, before `pr-reviewer`.
2. Full gate set (`npm run test:gates` / `scripts/verify-*.sh`) — immediately after the unit tests, still before `pr-reviewer`.

Neither runs at any other point during development. For routine mid-iteration verification use only:
- `npx tsc --noEmit` for typecheck.
- `npm run build:client` / `npm run build:server` only when the change touches the build surface.

This rule applies to all sessions, including review-loop iterations. Running unit tests or gates mid-iteration is always wrong.

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
- Never duplicate logic — if the same behaviour is needed in two or more places, extract it into a shared function, helper, or service before writing it twice.

## 7. Autonomous Bug Fixing

- When given a bug report: just fix it. Do not ask for hand-holding.
- Point at logs, errors, and failing tests, then resolve them
- Zero context switching required from the user
- Find root cause, not symptoms
- Fix failing CI tests proactively without being told how

## 8. Skills = System Layer

- Skills are NOT just markdown files. They are modular systems the agent can explore and execute — reference knowledge, executable scripts, datasets, workflows, automation.
- The agent does not just read skills. It uses them.
- Use skills for: verification, automation, data analysis, scaffolding, review, CI/CD, runbooks, infra ops.
- Each skill has a single clear responsibility. Skills are reusable intelligence — treat them as internal products.

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

## 13. Doc style: agent-facing is dense, human-facing is readable

Documentation falls into two classes — write each accordingly.

**Agent-facing** (loaded into LLM context routinely): `CLAUDE.md`, `DEVELOPMENT_GUIDELINES.md`, `architecture.md`, `KNOWLEDGE.md`, all skill files, `references/**`, agent definitions, this file. Optimise for tokens and signal density: bullets over prose, short sentences, no preambles, no reassurance text, no marketing language. Code examples only when copy-paste is the point — otherwise reference the canonical source. Every line should earn its tokens.

**Human-facing** (read by people, not loaded into context routinely): `docs/capabilities.md`, `README.md`, customer-visible specs, marketing copy, public-facing docs. Optimise for clarity and tone: full sentences, narrative flow, vendor-neutral product language. Editorial rules apply (see `docs/capabilities.md § Editorial Rules`).

If unsure: would Claude read this in most sessions? Yes → agent-facing. When editing an agent-facing doc, condense rather than expand — if a rule cannot be stated in ≤2 sentences, the detail belongs in `architecture.md` or `KNOWLEDGE.md` with a one-line pointer in the rule doc.

---

## Long Document Writing

Documentation files (`.md`, `.mdx`, `.rst`, `README`/`CHANGELOG`/`LICENSE`) over ~10,000 characters must use the chunked workflow — `.claude/hooks/long-doc-guard.js` blocks single Writes that exceed the threshold:

1. `TodoWrite` task list — one todo per chunk, named after its section. The list is mandatory; the user needs to see the phases move through.
2. Single `Write` for the skeleton (header + ToC + headings only).
3. `Edit` to append each section. Mark its todo `in_progress` before, `completed` immediately after. Never batch completions.

If you see `BLOCKED by long-doc-guard`, follow the workflow — don't work around it. Threshold and scope live in `.claude/hooks/long-doc-guard.js`.

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

### Common invocations

```
"triage-agent: idea: [description]"     # capture without derailing
"architect: [feature description]"       # plan before implementing (Significant/Major)
"spec-conformance: verify the current branch against its spec"
"pr-reviewer: review the changes I just made to [file list]"
"feature-coordinator: implement [feature name]"
"audit-runner: hotspot rls"              # see audit-runner.md for full mode list
"dual-reviewer: [brief description]"     # local-only, user must explicitly ask
"spec-reviewer: review docs/path-to-spec.md"
```

`audit-runner` runs INLINE in the current session — do NOT use the Agent tool. Read `.claude/agents/audit-runner.md` and execute its instructions directly so the TodoWrite task list is visible.

### Review pipeline (mandatory order)

For Standard/Significant/Major tasks, before marking done or opening a PR:

1. **Spec-driven only:** `spec-conformance` first. If it returns `CONFORMANT_AFTER_FIXES`, re-run `pr-reviewer` on the expanded changed-code set.
2. `pr-reviewer` — always.
3. `dual-reviewer` — optional, local-only, user must explicitly ask.

Full caller contracts (filename convention, deferred-items routing, NON_CONFORMANT triage, log persistence) live in [`tasks/review-logs/README.md`](./tasks/review-logs/README.md). Each agent definition under `.claude/agents/` carries its own copy of the contract relevant to that agent.

### Before you write a spec

For Significant/Major specs, read [`docs/spec-authoring-checklist.md`](./docs/spec-authoring-checklist.md) before drafting. Trivial specs (typos, one-liners, pure ADRs) skip it.

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

Simplicity first — minimal code, root causes, no lazy patches. Systems over prompts. Verification over generation. Iteration over perfection. Structure over volume.

---

## Non-goals: what Automation OS is NOT

See [`docs/capabilities.md` § Non-goals](./docs/capabilities.md). These are durable product stances — review before proposing features that compete with provider primitives.

---

## Frontend Design Principles

Automation OS is a consumer-simple product built on enterprise-grade backend capability. A rich backend does not justify a rich UI — frontend surfaces must be usable by non-technical operators without training.

**Five hard rules — applied to every UI artifact:**

1. **Start with the user's primary task, not the data model.** Design the minimum surface for that task. If you're mapping backend columns to UI panels, stop and restart from the task.
2. **Default to hidden.** Metric dashboards, KPI boards, trend charts, diagnostic panels, ID exposure, aggregated-cost views — deferred by default. Ship only when a specific workflow requires them, or behind admin-only views.
3. **One primary action per screen.** ≥2 primary actions → split. ≥3 sidebar panels → cut one. Table + chart + ranking + KPI tiles means you're rebuilding a monitoring product on top of the core product.
4. **Inline state beats dashboards.** A status dot beats a utilization dashboard. A "last run · succeeded" line beats a run-history panel. Ask: can this live as inline state on an existing page?
5. **The re-check.** Before committing a UI artifact: would a non-technical operator complete the primary task without feeling overwhelmed? If not, cut information.

**Deep rationale, pre-design checklist, worked examples:** [`docs/frontend-design-principles.md`](./docs/frontend-design-principles.md). Read it before generating a mockup or designing a new page.

---

## User Preferences

- Concise communication, no emojis
- No auto-commits or auto-pushes from the main session — the user commits explicitly after reviewing changes. **Exception:** review agents (`spec-reviewer`, `spec-conformance`, `dual-reviewer`, `chatgpt-pr-review`, `chatgpt-spec-review`, `audit-runner`) auto-commit and auto-push within their own flows; the user has explicitly opted in so review output persists to the remote and is visible across sessions. Read-only reviewers (`pr-reviewer`) never commit.
- Stop and ask when requirements are ambiguous enough to affect architecture
