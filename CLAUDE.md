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
| `dual-reviewer` | Codex review loop with Claude adjudication — second-phase **code** review. **Local-dev only — requires the local Codex CLI; unavailable in Claude Code on the web.** | After `pr-reviewer` on Significant and Major tasks — **only when the user explicitly asks**, never auto-invoked |
| `spec-reviewer` | Codex review loop with Claude adjudication — for **spec documents**, not code. Classifies findings as mechanical / directional / ambiguous, auto-applies mechanical fixes, pauses for HITL on anything directional. Max iterations configured via MAX_ITERATIONS in `.claude/agents/spec-reviewer.md` (currently 5), stops early on two consecutive mechanical-only rounds. Reads `docs/spec-context.md` as framing ground truth. | After a draft spec is written, before starting implementation against it |
| `feature-coordinator` | End-to-end pipeline for planned multi-chunk features | Starting a new planned feature from scratch |

### Task Classification

Classify every task before starting:

| Class | Definition | Action |
|-------|-----------|--------|
| **Trivial** | Single file, obvious change, no design decisions | Implement directly |
| **Standard** | 2–4 files, clear approach, no new patterns | Implement, then invoke pr-reviewer |
| **Significant** | Multiple domains, design decisions, or new patterns | Invoke architect first, then implement, then pr-reviewer. `dual-reviewer` optionally — **only if the user explicitly asks and the session is running locally** (see note below). |
| **Major** | New subsystem, cross-cutting concern, or architectural change | Invoke feature-coordinator to orchestrate the full pipeline; pr-reviewer before PR. `dual-reviewer` optionally — **only if the user explicitly asks and the session is running locally** (see note below). |

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

**Before creating any PR** — regardless of task size — always run `pr-reviewer` before creating the pull request.

### `dual-reviewer` is a local-development-only optional add-on

`dual-reviewer` runs a Codex CLI review loop with Claude adjudicating each recommendation. It is **only available when the session is running locally** on a machine with the Codex CLI installed and authenticated — it does **not** run in Claude Code on the web, in CI, or in any remote sandbox.

**Never auto-invoke `dual-reviewer`.** The main session must not spawn this agent on its own judgement, even for Significant or Major tasks. Auto-invocation in a non-local environment hangs the session waiting on a command that cannot execute, and silently burns time on a review the user did not ask for.

**Only invoke `dual-reviewer` when:**

1. The user **explicitly** asks for it (e.g. "run dual-reviewer", "do the Codex pass"), AND
2. The session is local. If uncertain, ask the user before spawning.

The PR-ready bar for this project is: `pr-reviewer` has passed and any blocking findings are addressed. `dual-reviewer` is a power-user add-on for an extra pass when the local environment supports it — not a gate on the PR.

### Review logs must be persisted

Every `pr-reviewer` and `dual-reviewer` invocation produces a durable log on disk — the same convention the spec-review loop already uses (`tasks/spec-review-log-*`). The logs exist so recurring findings can be mined across many reviews and folded back into the review rubrics, `CLAUDE.md`, or `architecture.md`.

- **`pr-reviewer` caller contract.** `pr-reviewer` is read-only — it emits its complete review inside a fenced markdown block tagged `pr-review-log`. **Before fixing any issues**, the caller (main session or `feature-coordinator`) must extract the block verbatim and write it to `tasks/pr-review-log-<slug>-<timestamp>.md`, where `<slug>` is the feature slug (if working under `tasks/builds/<slug>/`) or a short kebab-case name otherwise, and `<timestamp>` is ISO 8601 UTC with seconds. Persist first, then fix — this captures the raw reviewer voice before code changes overwrite the context.
- **`dual-reviewer` self-writes.** `dual-reviewer` writes its own log to `tasks/dual-review-log-<slug>-<timestamp>.md` per its agent spec. The caller does not need to persist anything — just read the log path the agent returns.

If a reviewer ran, the log must exist. This applies regardless of task classification (Trivial / Standard / Significant / Major).

### Before you write a spec

For any Significant or Major spec, read `docs/spec-authoring-checklist.md` before drafting. It is a pre-authoring checklist derived from patterns the `spec-reviewer` has caught across 15+ production specs — primitives-reuse search, file-inventory lock, contracts, RLS/permissions, execution model, phase sequencing, deferred items, self-consistency, and testing posture.

The checklist points back at the deep references in `architecture.md` and `docs/spec-context.md`; it does not restate them. Authors who work through the appendix checklist before invoking `spec-reviewer` shorten the review loop — every unchecked box is a finding the reviewer will raise anyway.

Trivial specs (typos, one-line clarifications, pure ADRs) do not need the checklist — just write and move on.

### Spec review is the equivalent pipeline for spec documents

When a draft spec document is written (roadmaps, implementation specs, architecture plans, phased build plans), invoke `spec-reviewer` before starting implementation against it. This is the spec-document equivalent of the `dual-reviewer` loop for code (and, like `dual-reviewer`, requires the local Codex CLI — only invoke when the user asks and the session is local). The agent:

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

**In-flight spec:** none. LLM observability & ledger generalisation (`tasks/llm-observability-ledger-generalisation-spec.md`, all five phases) merged to main via PR #158 on 2026-04-20; deferred items tracked in spec §17.
**Active items:** PR #159 on `bugfixes-april26` — skill-analyzer crash-resume + Windows dev-restart hardening (graceful shutdown doesn't fire under `node --watch` on Windows; added EADDRINUSE retry + DB-sourced resume in Stage 5; tracked follow-up `tasks/ideas.md` IDEA-1 for the DB UNIQUE constraint). ClientPulse Session 2 merged to main 2026-04-20 (real CRM wiring + drilldown + polish, 8 ship gates passed, S2-D.1/D.4 core paths shipped). Durable primitives landed from that session: `canonicaliseJson` recursive walker + present-vs-absent collapse (`server/services/actionService.ts`); retry-vs-replay boundary pinned on `buildActionIdempotencyKey`; `executionLayer.precondition_block` structured log. ClientPulse next up: Session 3 (Chunks 9 wizard cadence + 12 panel extraction, plus S2-D.1 modal rebuild + S2-D.4 integration tests).

This pointer is hand-maintained. Update it whenever the current spec or sprint changes. **A stale pointer is worse than no pointer** because it actively misleads future agent sessions about what to focus on. If the project has no in-flight spec, set both fields to `none` rather than leaving them stale.

---

## Key files per domain

Quick reference for "where do I start when adding X". This is the index, not the deep reference — `architecture.md` is the deep reference for everything below.

| Task | Start here |
|------|------------|
| Add a new agent skill | `server/skills/`, `server/config/actionRegistry.ts` |
| Add a new tool action | `server/config/actionRegistry.ts`, `server/services/skillExecutor.ts` |
| Add a new ClientPulse intervention primitive | `server/config/actionRegistry.ts` (namespace as `crm.*` or `clientpulse.*`), `server/services/skillExecutor.ts` (review-gated via `proposeReviewGatedAction`), `server/skills/<slug>ServicePure.ts` (payload validator + provider-call builder), update `INTERVENTION_ACTION_TYPES` in `server/services/clientPulseInterventionContextService.ts` + the `actionType` enum in `server/services/interventionActionMetadata.ts` |
| Modify the ClientPulse intervention proposer | `server/jobs/proposeClientPulseInterventionsJob.ts` (orchestration) + `server/services/clientPulseInterventionProposerPure.ts` (matcher logic) — never bypass `enqueueInterventionProposal()` |
| Modify the outcome measurement job | `server/jobs/measureInterventionOutcomeJob.ts` + `measureInterventionOutcomeJobPure.ts` (decision pure fn) — band attribution + cooldown integrity hinge on the args passed to `interventionService.recordOutcome()` |
| Add a Configuration Assistant config-write skill | `server/skills/<slug>.md` + service in `server/services/<slug>Service.ts` + pure validation in `<slug>Pure.ts` — sensitive paths must route through `actions` row with `gateLevel='review'` per `SENSITIVE_CONFIG_PATHS` |
| Add a new database table | `server/db/schema/`, `migrations/` (next free sequence number) |
| Add a new pg-boss job | `server/jobs/`, `server/jobs/index.ts` (registration) |
| Add an LLM consumer (non-agent) | `llmRouter.routeCall({ context: { sourceType: 'system' \| 'analyzer', sourceId, featureTag, systemCallerPolicy, ... } })` — NEVER import a provider adapter directly (the `verify-no-direct-adapter-calls.sh` gate + runtime `assertCalledFromRouter()` block this). Use `postProcess` + `ParseFailureError` for schema-validation failures; AbortController for cancellation. |
| View System-level LLM P&L | `/system/llm-pnl` (system-admin only). Service: `server/services/systemPnlService.ts`; routes: `server/routes/systemPnl.ts`; shared types: `shared/types/systemPnl.ts`; P&L math: `systemPnlServicePure.ts`. Reference UI: `prototypes/system-costs-page.html`. |
| Modify LLM ledger retention | `env.LLM_LEDGER_RETENTION_MONTHS` (default 12). Archive job: `server/jobs/llmLedgerArchiveJob.ts` + `llmLedgerArchiveJobPure.ts` (pure cutoff math). Registered in `server/services/queueService.ts` as `maintenance:llm-ledger-archive` at 03:45 UTC. |
| Add a new agent middleware | `server/services/middleware/`, `server/services/middleware/index.ts` |
| Add a new client page | `client/src/pages/`, router config in `client/src/App.tsx` |
| Add a new permission key | `server/lib/permissions.ts` |
| Add a new static gate | `scripts/verify-*.sh`, `scripts/run-all-gates.sh` |
| Add a new run-time test | `server/services/__tests__/` (pure file pattern: `*Pure.test.ts`) |
| Modify the agent execution loop | `server/services/agentExecutionService.ts`, `agentExecutionServicePure.ts` |
| Add a new workspace health detector | `server/services/workspaceHealth/detectors/`, then re-export from `detectors/index.ts` |
| Add a new feature or skill (docs) | `docs/capabilities.md` — update in the same commit as the code change |
| Add or update an integration capability | `docs/integration-reference.md` (structured YAML block) + update `OAUTH_PROVIDERS` in `server/config/oauthProviders.ts` or `MCP_PRESETS` in `server/config/mcpPresets.ts` — `scripts/verify-integration-reference.mjs` catches drift in CI |
| Modify Orchestrator routing logic | `migrations/0157_orchestrator_system_agent.sql` (masterPrompt), `server/jobs/orchestratorFromTaskJob.ts` (trigger handler), `server/tools/capabilities/` (discovery skill handlers) |
| Add a capability discovery skill | `server/tools/capabilities/` + register in `server/config/actionRegistry.ts` + `server/services/skillExecutor.ts` + decrement `SkillExecutionContext.capabilityQueryCallCount` |
| Add a canonical data table | `server/db/schema/`, migration with `UNIQUE(organisation_id, provider_type, external_id)`, add to `rlsProtectedTables.ts`, add RLS policy, update `server/config/canonicalDictionary.ts` |
| Add a connector adapter | `server/services/connectorPollingService.ts` (adapter wiring), `server/config/connectorPollingConfig.ts` (intervals) |
| Modify principal/RLS context | `server/db/withPrincipalContext.ts`, `server/config/rlsProtectedTables.ts`, migration for new policies |
| Modify a ClientPulse adapter dispatch path | `server/services/adapters/apiAdapter.ts` (dispatch) + `apiAdapterClassifierPure.ts` (retry classifier) + `ghlEndpoints.ts` (5 endpoint mappings) + `executionLayerService.ts` (precondition gate + per-subaccount advisory lock) |
| Modify canonical-JSON or idempotency-key derivation | `server/services/actionService.ts` — `canonicaliseJson`, `hashActionArgs`, `buildActionIdempotencyKey`, `computeValidationDigest`. Pinned by `actionServiceCanonicalisationPure.test.ts` — nested-key sort + present-vs-absent collapse + null-distinction + array-positional semantics. Retry-vs-replay contract is non-negotiable (see `buildActionIdempotencyKey` header comment) |
| Modify the ClientPulse drilldown | `server/routes/clientpulseDrilldown.ts` (4 routes) + `server/services/drilldownService.ts` + `server/services/drilldownOutcomeBadgePure.ts` (badge rules) + `client/src/pages/ClientPulseDrilldownPage.tsx` + `client/src/components/clientpulse/drilldown/` — always scope reads by `organisationId` + `subaccountId` |
| Modify a ClientPulse live-data picker | `server/services/crmLiveDataService.ts` (60s in-memory cache, MAX_CACHE_ENTRIES=500) + `server/services/adapters/ghlReadHelpers.ts` (scoped GHL calls) + `client/src/components/clientpulse/pickers/LiveDataPicker.tsx` (debounce + keyboard + 429 backoff) |
| Modify notify_operator fan-out | `server/services/notifyOperatorFanoutService.ts` (orchestrator) + `server/services/notifyOperatorChannels/*.ts` (in-app/email/slack) + pure `availabilityPure.ts` + `server/services/skillExecutor.ts` notify_operator case |

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
- **Tables: column-header sort + filter by default** — every data table must have Google Sheets-style column headers: clicking a header opens a dropdown with sort (A→Z / Z→A) and, for columns with a finite value set, filter checkboxes. Sort applies to all columns. Filters apply to columns whose values are categorical (status, visibility, boolean flags, etc.). Active sort shows ↑/↓ next to the label; active filters show an indigo dot. A "Clear all" button appears in the page header when any sort or filter is active. Implementation pattern: `SystemSkillsPage.tsx` — `ColHeader` + `NameColHeader` components, `Set<T>`-based filter state, client-side sort/filter computed before render.

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

These are durable product stances. When an LLM provider or horizontal agent platform ships a new primitive (routines, agent SDKs, skills, memory, hosted managed agents, team chat), the reflex should be to **absorb the category into `docs/capabilities.md` positioning, ship any UX polish that closes a demo gap, and never drift the pitch toward parity with the provider's primitive.** The moat is the operations layer, not any one feature.

- **Not a better agent SDK.** Consume LLM-provider primitives under the hood rather than competing with them.
- **Not a hosted routines / scheduled-prompt product.** We build the operations layer on top of supply from every provider — multi-tenant isolation, approval workflows, client portals, per-client P&L, model-agnostic routing — surfaces an LLM provider's hosted-agent or routine product structurally cannot ship, because their buyer is an individual or an internal team, not an agency serving many clients.
- **Not a general-purpose chat UI.** LLM-provider chat surfaces are excellent at what they do. The Synthetos chat surface exists for agent supervision and task context — not as a general-purpose LLM interface.
- **Not a standalone IDE or developer platform.** The sandboxed dev mode inside IEE exists for org-level extensibility — not as a competitor to general-purpose coding assistants.
- **Not a commodity workflow automation tool.** Commodity workflow tools compete on "connect X to Y." Synthetos competes on "run agents responsibly across many clients with approval workflows."
- **Not a public skill or playbook marketplace.** Anthropic-scale distribution isn't the agency play.
- **Not a bidirectional bridge to no-code workflow tools.** We import from them (supervised-migration wedge); we do not export back.

If a PR, marketing asset, or sales deck drifts toward a non-goal, push back. The right response to a provider shipping a new primitive is never "we have that too" — it is "we're the operations system you use on top of that."

---

## User Preferences

- Concise communication, no emojis
- No auto-commits or auto-pushes — the user commits explicitly after reviewing changes
- Stop and ask when requirements are ambiguous enough to affect architecture
