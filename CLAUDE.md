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
- Ruthlessly iterate on these lessons until the mistake rate drops

## 4. Verification Before Done

- NEVER mark a task complete without proving it works
- Run tests, check logs, simulate real usage
- Diff behaviour between main and your changes when relevant
- Compare expected vs actual behaviour
- Ask yourself: "Would a senior/staff engineer approve this?"

**Verifiability heuristic.** Before scoping work, ask: is the success condition checkable by a deterministic test or only by human judgment? Verifiable work (route returns X, row saves with the right shape, test passes) can be agent-driven aggressively. Non-verifiable work (UX polish, tone, copy, "feels right", layout taste) needs a human in the loop on every iteration — frontier models are jagged here and will not self-correct toward the goal. For non-verifiable work: do not subagent-drive it overnight; sit with it; iterate visually.

## Verification Commands

Run after every non-trivial change. No task is complete until relevant checks pass.

| Trigger | Command | Max auto-fix attempts |
|---------|---------|----------------------|
| Any code change | `npm run lint` | 3 |
| Any TypeScript change | `npm run typecheck` | 3 |
| Logic change in server/ | Targeted run of the test file(s) authored for THIS change — `npx vitest run <path-to-test>` | 2 |
| Schema change | `npm run db:generate` — verify migration file | 1 |
| Client change | `npm run build:client` | 2 |

Run only relevant checks unless the change spans client + server. Never skip a failing check or suppress warnings to make one pass. After 3 failed fix attempts on the same check, STOP and escalate with the error, what was tried, and your root-cause hypothesis.

**Test gates are CI-only.** Full suites (`test:gates`, `test:qa`, `test:unit`, `npm test`, `scripts/run-all-*`, `scripts/verify-*`, `scripts/gates/*`) do NOT run locally — CI handles them. Allowed locally: `lint`, `typecheck`, `build:server`/`build:client` when relevant, and targeted `npx vitest run <test-path>` for tests authored in THIS change. **Runner is Vitest** — see `docs/testing-conventions.md`. Do not author tests with `node:test`, `node:assert`, or handwritten harnesses; `scripts/verify-test-quality.sh` rejects them. Single source of truth: [`references/test-gate-policy.md`](./references/test-gate-policy.md).

---

## 5. Demand Elegance

- For non-trivial changes: pause and ask "is there a simpler, cleaner way?"
- If a fix feels hacky, apply: "Knowing everything I know now, implement the elegant solution"
- Skip this step for simple, obvious fixes. Do not over-engineer.
- Optimise for long-term maintainability over short-term speed
- Challenge your own work before presenting it

## 6. Surgical Changes

1. **Three-Similar-Lines rule** — resist abstraction until the fourth occurrence. Three near-identical lines is acceptable; do not extract a helper until a fourth call site lands.
2. **Line-by-line justification** — every changed line traces directly to the user's request. If it does not, revert it.
3. **Surface, don't smuggle** — if you notice an out-of-scope improvement (dead code, smell, doc drift) while implementing, surface it in your response and route it to `tasks/todo.md`. Do not silently fix it. LLMs are overconfident about what's "certainly unused." The cost of a wrong deletion is high; the cost of mentioning it is zero.

- Remove imports/variables/functions that YOUR changes made unused. Don't remove pre-existing dead code unless asked.
- Match existing style, even if you'd do it differently. No drive-by reformatting.
- Never duplicate logic — if the same behaviour is needed in two or more places, extract it into a shared function, helper, or service before writing it twice.
- **Comments describing a *completed* refactor are residue, the commit message is the right home.** If a comment block exists only to explain why some code USED to be different, delete it. Anchor case: the 2026-05-14 pre-v1-lockdown audit found a 44-line cluster in `server/services/agentExecutionService.ts:72-116` describing an import-removal refactor that shipped in migration 0106. The git history carries that. The code does not need to.

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
- **Canonical checklist:** `docs/doc-sync.md` — lists every reference doc with its update trigger. Enforced at finalisation by `chatgpt-pr-review`, `chatgpt-spec-review`, and `feature-coordinator`.

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

**Async polling cadence** — When polling external state (CI, builds, deployments, jobs) from a Claude Code session: default to 90-120s between polls, not 4-5 min. CI on this repo typically completes in 1-2 min, so a too-long cadence pushes past a full cycle and delays merge. Pick cadence to match expected event time, not to maximise prompt-cache hits — responsiveness wins for fast pollable signals. Use `ScheduleWakeup` or `Monitor`; long synchronous `sleep` commands are runtime-blocked.

---

## 13. Doc style: agent-facing is dense, human-facing is readable

**Agent-facing** (`CLAUDE.md`, `DEVELOPMENT_GUIDELINES.md`, `architecture.md`, `KNOWLEDGE.md`, skills, agent defs, `references/**` — loaded into context routinely): bullets over prose, no preambles, no reassurance text. Every line earns its tokens. Code examples only when copy-paste is the point.

**Human-facing** (`docs/capabilities.md`, `README.md`, customer-visible docs): full sentences, vendor-neutral language, editorial rules per `docs/capabilities.md § Editorial Rules`.

If unsure: Claude reads it in most sessions → agent-facing. Condense rather than expand; if a rule won't fit in ≤2 sentences, push detail to `architecture.md` or `KNOWLEDGE.md` with a one-line pointer.

---

## Long Document Writing

Doc files (`.md`/`.mdx`/`.rst`/`README`/`CHANGELOG`/`LICENSE`) over ~10K chars use chunked workflow: TodoWrite (one todo per section) → Write skeleton (header + ToC + headings) → Edit each section, marking todos in_progress/completed inline. Hook `.claude/hooks/long-doc-guard.js` blocks oversized single Writes. If blocked, follow the workflow — don't work around it.

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

**Code intelligence cache.** When `references/project-map.md` and `references/import-graph/<dir>.json` exist, prefer them for architecture questions ("what calls X", "what depends on Y") before grepping. Cache auto-rebuilds via the `code-graph-freshness-check` SessionStart hook and the `predev` watcher. Manual rebuild: `npm run code-graph:rebuild`. Health report: `npm run code-graph:health`. Trust source over cache if they disagree.

Agents live in `.claude/agents/`. Read their definitions before invoking them.

| Agent | One-line role |
|-------|---------------|
| `triage-agent` | Capture ideas/bugs mid-session; triage queue at next break |
| `architect` | Architecture decisions and implementation plans for Significant/Major tasks |
| `spec-conformance` | Verify code matches its spec; auto-fix mechanical gaps; runs before `pr-reviewer` on spec-driven tasks |
| `pr-reviewer` | Independent read-only code review; mandatory before marking non-trivial tasks done |
| `dual-reviewer` | Codex review loop with Claude adjudication; local-only; auto from feature-coordinator when available |
| `adversarial-reviewer` | Read-only threat-model review (tenant isolation, auth, races, injection); Phase 1 advisory |
| `reality-checker` | Post-pr-reviewer evidence-demanding verifier; read-only; demands proof before approving a build; Significant/Major only |
| `spec-reviewer` | Codex review loop for spec documents; max 5 iterations lifetime; non-blocking |
| `feature-coordinator` | Phase 2 orchestrator — plan, build chunks, branch review, doc-sync, Phase 3 handoff |
| `spec-coordinator` | Phase 1 orchestrator — intent intake, duplication/strategy check, mockup loop, spec authoring, reviews, handoff |
| `finalisation-coordinator` | Phase 3 orchestrator — S2 sync, G4 guard, ChatGPT PR review, MERGE_READY |
| `builder` | Sonnet sub-agent; implements one plan chunk and runs G1 gate; auto-invoked by feature-coordinator |
| `mockup-designer` | Sonnet sub-agent; hi-fi clickable HTML prototypes; auto-invoked by spec-coordinator |
| `chatgpt-plan-review` | Manual ChatGPT-web review of plan.md; auto-invoked by feature-coordinator |
| `audit-runner` | Codebase audits (Full/Targeted/Hotspot); runs INLINE, not via Agent tool |
| `chatgpt-pr-review` | ChatGPT PR review coordinator; run in dedicated new Claude Code session |
| `chatgpt-spec-review` | ChatGPT spec review coordinator; run in dedicated new Claude Code session |
| `hotfix` | Fast-path for time-critical fixes; bypasses pipeline; minimum review bar enforced |
| `incident-commander` | Production incident coordinator — SEV classification, scribe, post-mortem; runs INLINE; see `docs/incident-response.md` |
| `context-pack-loader` | Loads mode-scoped slice of architecture/dev-guidelines/knowledge; inline playbook |
| `codebase-explainer` | Human-readable narrative tour of the codebase; output in `docs/codebase-tour.md` |
| `validate-setup` | Read-only framework health checker; verifies fleet, hooks, ADRs, FRAMEWORK_VERSION |

Read `.claude/agents/<name>.md` for the full caller contract before invoking.

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

### Build lifecycle

Every Standard+ build follows this nine-step sequence:

> Intent → Duplication / Strategy Check → Specification → Build Planning → Construction → Review → Capability Registration → Compound Learning → Merge

- **Intent** — structured `intent.md` authored by `spec-coordinator` Step 3 (Standard+ only; Trivial builds retain `brief.md`).
- **Duplication / Strategy Check** — `spec-coordinator` Step 3a hard gate; stops or redirects builds that duplicate existing capabilities or target declining clusters.
- **Specification** — `spec-coordinator` Steps 4–6; produces `spec.md` with Lifecycle Declaration and ABCd Estimate.
- **Build Planning** — `architect` decomposes the spec into chunks; `feature-coordinator` presents the finalised plan at the plan gate.
- **Construction** — `feature-coordinator` drives per-chunk `builder` runs against the plan; G1 gate per chunk.
- **Review** — branch-level review pass: `spec-conformance` → `adversarial-reviewer` (conditional) → `pr-reviewer` → `reality-checker` → `dual-reviewer`.
- **Capability Registration** — `finalisation-coordinator` Step 6; emits a Capability Registration verdict for `docs/capabilities.md` (one of the eight §6.2.1 valid strings); blocks `MERGE_READY` until recorded.
- **Compound Learning** — `finalisation-coordinator` Step 7a; emits proposal rows that route patterns from Step 7 to a target enum for future-build learning; operator may approve later; no auto-apply and no merge block.
- **Merge** — `finalisation-coordinator` Step 9 sets `MERGE_READY`; Step 10 applies the label.

Capability Registration and Compound Learning run **during finalisation, before merge** — they precede `MERGE_READY`.

### Task Classification

Classify every task before starting:

| Class | Definition | Action |
|-------|-----------|--------|
| **Trivial** | Single file, obvious change, no design decisions | Implement directly |
| **Standard** | 2–4 files, clear approach, no new patterns | Implement, then `spec-conformance` (if spec-driven), then `pr-reviewer` |
| **Significant** | Multiple domains, design decisions, or new patterns | Invoke architect first, then implement, then apply the full GRADED review posture (§ *Review pipeline* below). Canonical Phase 2 order: `spec-conformance` if spec-driven → `adversarial-reviewer` if §5.1.2 surface → `pr-reviewer` → `reality-checker` → `dual-reviewer` (mandatory — skippable with `REVIEW_GAP`). `chatgpt-pr-review` is enforced separately at Phase 3 by `finalisation-coordinator`. |
| **Major** | New subsystem, cross-cutting concern, or architectural change | Invoke feature-coordinator to orchestrate the full pipeline (architect → implement → full GRADED review posture). `feature-coordinator` auto-invokes each review tier. See § *Review pipeline* below. |

### Common invocations

```
"triage-agent: idea: [description]"     # capture without derailing
"architect: [feature description]"       # plan before implementing (Significant/Major)
"spec-conformance: verify the current branch against its spec"
"pr-reviewer: review the changes I just made to [file list]"
"feature-coordinator: implement [feature name]"
"audit-runner: hotspot rls"              # see audit-runner.md for full mode list
"dual-reviewer: [brief description]"     # local-only, user must explicitly ask
"adversarial-reviewer: hunt holes in the changes I just made to [file list]"  # read-only, user must explicitly ask; caller provides the changed-file set
"reality-checker: verify [success criteria] with evidence [log/screenshot paths]"  # Significant/Major only; auto-invoked by feature-coordinator after pr-reviewer
"spec-reviewer: review docs/path-to-spec.md"
"spec-coordinator: <brief or rough spec topic>"   # Phase 1: spec + mockup + review
"launch feature coordinator"                       # Phase 2: build + review (new session)
"launch finalisation"                              # Phase 3: finalise + ready-to-merge (new session)
"hotfix: <what's broken>"                          # time-critical fix path
"incident-commander: prod is on fire"              # coordinate incident response, timeline, post-mortem
```

**Coordinators and `audit-runner` run INLINE in the main session — do NOT dispatch via the `Agent` tool.** Read `.claude/agents/<name>.md` and execute its instructions directly. This applies to `spec-coordinator`, `feature-coordinator`, `finalisation-coordinator`, `incident-commander`, and `audit-runner`.

For the three coordinators, this is a hard requirement, not a preference. The runtime does not allow dispatched sub-agents to dispatch further sub-agents (the platform error is `No such tool available: Task. Task is not available inside subagents.`). Each coordinator playbook dispatches multiple sub-agents (architect, builder, mockup-designer, the reviewers, chatgpt-pr-review, etc.) — nesting a coordinator as a sub-agent breaks the entire pipeline at its first dispatch step. The main session has top-level `Agent` access; the coordinator's dispatches must issue from there.

For `audit-runner`, the inline rule exists so the TodoWrite task list stays visible to the operator.

Operator entry phrases (`launch feature coordinator`, `launch finalisation`, `spec-coordinator: <brief>`) are signals for the main session to ADOPT the playbook — read the agent file and follow it. They are NOT instructions to call `Agent({subagent_type: "<coordinator>"})`.

### Review pipeline (GRADED posture)

The review pipeline uses a **GRADED posture**: reviewer requirements scale with task class. Not every reviewer applies to every task. Silently skipping a required reviewer is a policy violation — use the `REVIEW_GAP` artifact format instead.

**Three-tier mandatory/skippable matrix:**

| Reviewer | Trivial | Standard | Significant / Major |
|---|---|---|---|
| `spec-conformance` | skip | mandatory if spec-driven | mandatory if spec-driven |
| `pr-reviewer` | skip | **mandatory** | **mandatory** |
| `reality-checker` | skip | skip | **mandatory** |
| `adversarial-reviewer` | skip | skip | mandatory if diff matches §5.1.2 security surface |
| `dual-reviewer` | skip | skip | mandatory — skippable with `REVIEW_GAP` |
| `chatgpt-pr-review` | skip | skip | **mandatory at Phase 3** (enforced by `finalisation-coordinator`, not `feature-coordinator`) — skippable with `REVIEW_GAP` |

**Reviewer notes:**
- `spec-conformance`: if it returns `CONFORMANT_AFTER_FIXES`, re-run `pr-reviewer` on the expanded changed-code set.
- `reality-checker`: auto-invoked by `feature-coordinator` (§8.4). Caller must supply the implementer's stated criteria and evidence; without evidence it returns `NEEDS_WORK` immediately.
- `adversarial-reviewer`: auto-invoked when diff matches §5.1.2 security surface. Phase 1 advisory; non-blocking.
- `dual-reviewer`: auto-invoked when Codex is available; write `REVIEW_GAP` when unavailable.
- `chatgpt-pr-review`: enforced in Phase 3 by `finalisation-coordinator`, not in Phase 2. `feature-coordinator` does not invoke it; it neither needs nor records a `REVIEW_GAP` for it. Finalisation handles the manual ChatGPT-web loop.

**`REVIEW_GAP` artifact format:**

```
REVIEW_GAP: <reviewer-name> | task-class: <Trivial|Standard|Significant|Major> | reason: <one-line> | operator-override: <yes-<ISO-timestamp>|no> | remediation: <one-line remediation>
```

`remediation` is a one-line free-text field. Recommended values, in order of preference: a `tasks/todo.md`-style backlog link, the literal `accept` (we are taking the coverage hit), or a short prose plan (e.g. `run dual-reviewer manually if Codex becomes available before merge`). Prose remediation is supported; pure `<TODO-link|accept>` is not the only valid form.

Write this line to `tasks/builds/{slug}/progress.md` whenever a required reviewer is skipped.

**Trigger taxonomy — when to write `REVIEW_GAP`:**

- **Policy-not-applicable → NO `REVIEW_GAP`.** The reviewer was correctly not invoked because the policy itself does not require it for this task class or diff shape. Examples: `reality-checker` skipped for Trivial/Standard; `adversarial-reviewer` skipped because the diff does not cross the §5.1.2 security-sensitive surface; `spec-conformance` skipped because the task is not spec-driven. Coordinator writes a one-line `<reviewer>: skipped — <policy reason>` note in `progress.md`, but no `REVIEW_GAP` line.
- **Required-but-unavailable → `REVIEW_GAP` REQUIRED.** Policy says invoke; the reviewer could not run. Examples: `dual-reviewer` skipped because Codex CLI is not installed locally; `chatgpt-pr-review` skipped because the operator declined.
- **Manually skipped / operator override → `REVIEW_GAP` REQUIRED.** The `operator-override` field is `yes-<ISO-timestamp>`.
- **Ambiguous applicability → `REVIEW_GAP` with `task-class: NEEDS_DISCUSSION`.** Surface to finalisation.

*"A silent skip with no `REVIEW_GAP` entry is itself a policy violation."* This rule applies to the second, third, and fourth trigger types above. Policy-not-applicable skips are NOT silent — they carry a one-line policy-reason note — and are NOT violations.

Full caller contracts (filename convention, deferred-items routing, NON_CONFORMANT triage, log persistence) live in [`tasks/review-logs/README.md`](./tasks/review-logs/README.md). Each agent definition under `.claude/agents/` carries its own copy of the contract relevant to that agent.

### Before you write a spec

For Significant/Major specs, read [`docs/spec-authoring-checklist.md`](./docs/spec-authoring-checklist.md) before drafting. Trivial specs (typos, one-liners, pure ADRs) skip it.

**When the user asks to create a spec from a brief:** write it directly. Do not ask clarifying questions about depth, format, or location. Architecture-level is the default (domain model, service contracts, data model, integration boundaries, chunk plan — no function signatures, no SQL, no wireframes). Save to `tasks/builds/{slug}/spec.md`. The implementation plan is a separate step that comes after.

### Architecture decisions (ADRs)

For decisions where the **why** matters for years (chose X over Y, locked a contract, set a policy), write an ADR in [`docs/decisions/`](./docs/decisions/) — short, dated, immutable once accepted. KNOWLEDGE.md is for observations and gotchas; ADRs are for durable choices with rationale. Template at [`docs/decisions/_template.md`](./docs/decisions/_template.md).

### Context packs (mode-scoped loading)

For sessions where the default load (CLAUDE.md + architecture.md + KNOWLEDGE.md + DEVELOPMENT_GUIDELINES.md ≈ 6k lines) is heavier than the task needs, use a mode-scoped context pack from [`docs/context-packs/`](./docs/context-packs/). Five packs ship: `review`, `implement`, `debug`, `handover`, `minimal`. Each names the sections to load and the sections to skip.

Operator invokes via `load context pack: <mode>`. The `context-pack-loader` agent (inline playbook, see `.claude/agents/context-pack-loader.md`) reads the pack and slices `architecture.md` using the anchor IDs added in the 2026-05-03 refactor.

### Test gates are CI-only

Single source of truth: [`references/test-gate-policy.md`](./references/test-gate-policy.md). Forbidden / allowed lists live there; every agent and spec references that file rather than embedding its own copy.

### Agent lifecycle

**Add:** drop `<name>.md` in `.claude/agents/`, add fleet row, update `.claude/CHANGELOG.md` (Added). **Retire:** move to `.claude/agents/_retired/<name>-<YYYY-MM-DD>.md` (never delete — future sessions grep history), remove fleet row, update CHANGELOG (Deprecated → Removed in next version), link successor via `superseded_by` frontmatter, sweep callers in agent fleet and reference docs. Update `docs/doc-sync.md` if a new convention is introduced.

### Framework version

Canonical version + changelog: the [claude-code-framework](https://github.com/michaelhazza/claude-code-framework) repo, mounted here as a submodule at `.claude-framework/`. Adoption state: `.claude/.framework-state.json` (per-file hashes, framework version, substitutions). Deployment marker: `.claude/FRAMEWORK_VERSION` + `.claude/CHANGELOG.md` (records what's deployed; may lag the canonical submodule). Upgrade: `git submodule update --remote .claude-framework && node .claude-framework/sync.js`. Detail: `.claude-framework/.claude/CHANGELOG.md § Upgrade protocol`.

---

## Current focus

See [`tasks/current-focus.md`](./tasks/current-focus.md). Update it whenever the sprint, spec, or active branch changes. A stale pointer misleads future sessions — keep it current or set it to `none`.

> **Authoritative references live in `architecture.md`, not here.** CLAUDE.md intentionally contains no canonical file mappings, route patterns, or service contracts. Do not duplicate that content here — update `architecture.md` directly. If you find a mapping in both files that differs, `architecture.md` wins.

---

## Key files per domain

See [`architecture.md` § Key files per domain](./architecture.md). This is the index for domain entry points — update it when adding new domain areas.

---

## Replit boot procedure

See [`replit.md`](./replit.md) for the agent quick-start: `npm install && npm run dev`, required env vars (`docs/env-manifest.json`), the dual-tsconfig typecheck one-liner, and where to look next in the codebase. Read it the first time you open this repo on Replit.

---

## Capturing Ideas During Development

When an idea or "nice to have" surfaces mid-session: do NOT implement. Invoke `triage-agent: idea: <description>` to capture, continue current task. Triage queue at next natural break: `triage-agent: let's triage`. Ideas valuable in isolation may be low priority in context.

---

## Architecture Rules (Automation OS specific)

See [`architecture.md` § Architecture Rules](./architecture.md). Violations are blocking issues in any code review.

---

## Core Principles

Simplicity first — minimal code, root causes, no lazy patches. Systems over prompts. Verification over generation. Iteration over perfection. Structure over volume.

**No laziness.** Find root causes, not symptoms. No temporary fixes, no TODOs left behind, no "good enough for now." Hold yourself to senior-engineer standards on every change.

---

## Non-goals: what Automation OS is NOT

See [`docs/capabilities.md` § Non-goals](./docs/capabilities.md). These are durable product stances — review before proposing features that compete with provider primitives.

---

## Frontend Design Principles

Consumer-simple product on enterprise-grade backend. Rich backend does NOT justify rich UI. Five hard rules per UI artifact: (1) start from the user's primary task, not the data model; (2) default to hidden — dashboards, KPIs, IDs, cost views deferred unless a workflow requires them; (3) one primary action per screen; (4) inline state beats dashboards (status dot > utilization chart); (5) re-check — would a non-technical operator complete the task without feeling overwhelmed? If not, cut information.

**Full rationale, pre-design checklist, worked examples:** [`docs/frontend-design-principles.md`](./docs/frontend-design-principles.md). Read before drafting a mockup or new page.

- **Prefer named exports for React components.** Default-and-named dual exports create ambiguity that `knip` cannot reliably trace, leaving orphan components hidden until a manual audit catches them. Rename-shim cases (e.g. the subaccount-vs-client transition in `client/src/lib/auth.ts`) are time-limited exceptions: every such shim documents a sunset date in its header comment.

---

## User Preferences

- Concise communication, no emojis
- No em-dashes (—) in any UI copy, labels, or app-facing text. Use commas, colons, or rewrite the sentence.
- **CEO-level communication.** All user-facing output is short, plain-English, no jargon, no long technical reports. The user is non-technical: frame everything in business terms. When sub-agents (architect, feature-coordinator, spec-reviewer, etc.) return long technical output, summarise it before relaying — never paste raw agent reports into chat. Decision points: per-item recommendation + one-sentence rationale + a clear ask. Technical detail belongs in build artifacts (spec.md, plan.md, progress.md), not in chat.
- No auto-commits or auto-pushes from the main session — the user commits explicitly after reviewing changes. **Exception:** review agents (`spec-reviewer`, `spec-conformance`, `dual-reviewer`, `chatgpt-pr-review`, `chatgpt-spec-review`, `audit-runner`) auto-commit and auto-push within their own flows; the user has explicitly opted in so review output persists to the remote and is visible across sessions. Read-only reviewers (`pr-reviewer`) never commit.
- Stop and ask when requirements are ambiguous enough to affect architecture
