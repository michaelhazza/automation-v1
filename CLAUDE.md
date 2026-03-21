# Claude Code Global Playbook

This file applies to every project. Project-level CLAUDE.md files extend it with repo-specific context.

---

## 1. Plan Mode Default

- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- Write detailed specs upfront to reduce ambiguity
- Define both execution steps AND verification steps before starting
- If something goes sideways, STOP and re-plan immediately. Do not keep pushing.
- Use plan mode for verification steps, not just building

## 2. Subagent Strategy

- Use subagents liberally to keep the main context window clean
- Offload research, exploration, and parallel analysis to subagents
- For complex problems, throw more compute at it via subagents
- One task per subagent for focused execution
- Parallelize thinking, not just execution

## 3. Self-Improvement Loop

- After ANY correction from the user: update `tasks/lessons.md` with the pattern
- Write rules for yourself that prevent the same mistake from recurring
- Ruthlessly iterate on these lessons until the mistake rate drops
- Review `tasks/lessons.md` at the start of each session for the relevant project
- Convert every failure into a reusable rule

## 4. Verification Before Done

- NEVER mark a task complete without proving it works
- Run tests, check logs, simulate real usage
- Diff behaviour between main and your changes when relevant
- Compare expected vs actual behaviour
- Ask yourself: "Would a senior/staff engineer approve this?"

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

## Core Principles

- **Simplicity First** -- Make every change as simple as possible. Impact minimal code.
- **No Lazy Fixes** -- Find root causes. No temporary patches. Senior developer standards.
- **Systems over Prompts** -- Better systems scale. Better prompts do not.
- **Verification over Generation** -- Proving something works matters more than producing it fast.
- **Iteration over Perfection** -- Ship, learn, improve. Do not stall waiting for perfect.
- **Structure over Volume** -- A well-organised project with less content beats a dumped context window.
