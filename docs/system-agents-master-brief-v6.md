# Automation OS — System Agents Master Brief

**Architecture, Roles, Skill Wiring & Build Sequence**

- **Version:** 6.0
- **Date:** April 2026
- **Status:** Living document — source of truth for all system agent design decisions
- **Predecessor:** v5.0 (April 2026)

---

## Table of Contents

1. [Changes from v5.0](#changes-from-v50)
2. [Overview](#overview)
3. [Organisational Structure](#organisational-structure)
4. [Gate Model Reference](#gate-model-reference)
5. [Full Agent Roster](#full-agent-roster)
6. [Build Sequence](#build-sequence)
7. [Product Development Team Architecture](#product-development-team-architecture)
8. [Agent 1 — Orchestrator (COO)](#agent-1--orchestrator-coo)
9. [Agent 2 — Business Analyst](#agent-2--business-analyst)
10. [Agent 3 — Dev Agent](#agent-3--dev-agent)
11. [Agent 4 — QA Agent](#agent-4--qa-agent)
12. [Agent 5 — Support Agent](#agent-5--support-agent)
13. [Agent 6 — Social Media Agent](#agent-6--social-media-agent)
14. [Agent 7 — Ads Management Agent](#agent-7--ads-management-agent)
15. [Agent 8 — Email Outreach Agent](#agent-8--email-outreach-agent)
16. [Agent 9 — Strategic Intelligence Agent](#agent-9--strategic-intelligence-agent)
17. [Agent 10 — Finance Agent](#agent-10--finance-agent)
18. [Agent 11 — Content/SEO Agent](#agent-11--contentseo-agent)
19. [Agent 12 — Client Reporting Agent](#agent-12--client-reporting-agent)
20. [Agent 13 — Onboarding Agent](#agent-13--onboarding-agent)
21. [Agent 14 — CRM/Pipeline Agent](#agent-14--crmpipeline-agent)
22. [Agent 15 — Knowledge Management Agent](#agent-15--knowledge-management-agent)
23. [Agent 16 — Portfolio Health Agent](#agent-16--portfolio-health-agent)
24. [Appendix A — Skill → Agent Cross-Reference](#appendix-a--skill--agent-cross-reference)
25. [Appendix B — Skill Wiring Audit (v6.0)](#appendix-b--skill-wiring-audit-v60)
26. [Appendix C — Source of Truth & Drift Protocol](#appendix-c--source-of-truth--drift-protocol)
27. [Appendix D — Skill Visibility Rule](#appendix-d--skill-visibility-rule)

---

<!-- SECTIONS APPEND BELOW IN ORDER -->

## Changes from v5.0

Version 5.0 defined 15 agents in the abstract — schedules, gate models, and skills as design intent. Version 6.0 reconciles the brief with what actually shipped in PRs #98–#102 and subsequent follow-ups. This is a reality-sync release, not a redesign. Where v5.0 specified something the code later changed, v6.0 describes the code and notes the delta.

**Key deltas from v5.0:**

1. **Sixteen agents exist on disk, not fifteen.** The fifteen-agent business team is unchanged. A sixteenth agent — the **Portfolio Health Agent** — operates at `executionScope: org` and reports to `null` rather than the Orchestrator. It is documented as Agent 16 at the end of the per-agent section because it sits outside the business-team hierarchy.
2. **Schedules collapsed to on-demand for most agents.** v5.0 specified cron schedules for Support (every 2h), Social (every 6h), Ads (every 6h), Email Outreach (every 6h), Finance (every 6h), CRM (every 6h), and others. The shipped implementation runs all non-MVP business agents `on-demand`, driven by the Orchestrator directive and the task board. Only four agents have schedules: `orchestrator` (06:00 and 20:00), `qa` (02:00), `portfolio-health-agent` (every 4 hours), and previously-scheduled agents retained no cron.
3. **Models simplified.** v5.0 assigned Opus to Orchestrator, Dev, Strategic Intelligence, and Onboarding. The shipped implementation uses Opus only for Orchestrator and Dev. All other agents run on Sonnet. Strategic Intelligence and Onboarding were downgraded to Sonnet during build.
4. **Default gate is `review` for the thirteen business agents.** Every business agent's AGENTS.md frontmatter carries `gate: review` as the default, with individual skills overriding to `auto` or `block` as needed. The scheduled agents (Orchestrator, QA, Portfolio Health) default to `auto`. This is a wiring simplification — the per-skill gate table in each agent section still holds.
5. **All business agents share a standard task-management skill set.** Every business agent is wired with `create_task` / `move_task` / `update_task` / `add_deliverable` / `request_approval` / `read_workspace` / `write_workspace`. v5.0 assigned these case-by-case; v6.0 documents the shipped convention.
6. **Skill inventory is 90 files, of which 4 were genuine orphans (now resolved).** v5.0 projected five new skills (`draft_requirements`, `write_spec`, `derive_test_cases`, plus planned domain skills). The shipped build added 38 new skill files across growth, finance, content, CRM, knowledge management, and onboarding. An initial audit flagged 14 unwired skills, but a closer inspection found 10 of those were actually wired to non-company agents (Reporting Agent via its own seed path, Playbook Author via its own seed path). The 4 **genuine** orphans have been resolved: `read_inbox` is now wired to Support Agent, `update_memory_block` is now wired to Orchestrator, `trigger_process.md` has been deleted (no runtime handler existed), and `read_data_source` is left in place pending a separate fix to add its missing registry entry. See Appendix B for the full before/after.
7. **Business Analyst reports to Orchestrator, not directly to the human.** v5.0 placed the BA under the Orchestrator; this is preserved. Clarification: all 15 business agents report to the Orchestrator, and the Orchestrator is the only agent reporting to the human.
8. **Ads Management gate block scope narrowed.** v5.0 specified `block` on budget increases and campaign pauses. This holds in v6.0: only `increase_budget` and `pause_campaign` are `block` across the entire skill library. Everything else in Ads is `review`.
9. **No new revision loop caps.** The four loops (BA spec, Dev plan-gap, code fix-review, QA bug-fix) carry forward unchanged from v5.0.
10. **New master source-of-truth convention.** `companies/automation-os/agents/<slug>/AGENTS.md` is the authoritative definition. This document describes the shape; AGENTS.md files define the runtime behaviour. See Appendix C.

---

## Overview

Automation OS runs its own business on the platform it builds. The sixteen system agents defined in this document are the first-customer team: they build the platform, run its commercial operations, monitor its clients, and file bugs against themselves. Every agent here is also a proof-of-concept for what the platform offers external customers.

The full network operates as an asynchronous team. Agents do not call each other in real time. They communicate through shared state: **workspace memory** (for context and insights), the **task board** (for work items and handoffs), **Orchestrator directives** (for daily coordination), and the **HITL review queue** (for any action with external or irreversible blast radius). Each agent is scoped to a specific function, scheduled independently, and gated appropriately for the blast radius of its actions.

The product development team (Orchestrator, Business Analyst, Dev, QA) are not a separate subsystem. They are members of the same network, subject to the same infrastructure, the same HITL gates, and the same workspace memory. They are built first — not because they are the most important agents commercially, but because they are needed to build the platform itself.

### The v5.0 → v6.0 bridge: product development team integration (carried forward)

Version 5.0 integrated a validated Claude Code agent fleet reference architecture into the Automation OS model. That integration is preserved in v6.0 without changes:

- **Business Analyst is a full agent** (not a skill inside the Orchestrator) because its outputs — user stories and Gherkin acceptance criteria — are independently consumed by both the Dev Agent and the QA Agent. Folding it into the Orchestrator would contaminate the coordination layer with product-thinking context.
- **Architect and Builder merge into the Dev Agent.** The discipline is preserved via an enforced phase sequence (plan → spec → ux → implement → self-review → submit), not via a separate agent boundary.
- **Tech-spec, UX review, and PR review become skills** invoked by the Dev Agent at the appropriate point in its pipeline: `draft_tech_spec`, `review_ux`, `review_code`.
- **Triage is a skill** (`triage_intake`) available to the Orchestrator and Business Analyst rather than a separate agent.
- **System Test Analyst patterns are absorbed into the QA Agent** via Gherkin traceability (every test maps to an AC ID) and structured failure classification (APP BUG / TEST BUG / ENVIRONMENT).

---

## Organisational Structure

The agent network maps to a recognisable company structure. The human operator is the CEO: strategic decision-maker, approver of all boundary actions, setter of direction. The Orchestrator functions as the COO: operational coordinator synthesising state across all agents, writing directives, and keeping the machine running between human decisions.

```
Human (CEO)
  ├── Orchestrator (COO)
  │     ├── Business Analyst              [MVP]
  │     ├── Dev Agent                     [MVP]
  │     ├── QA Agent                      [MVP]
  │     ├── Support Agent                 [Phase 2]
  │     ├── Social Media Agent            [Phase 3]
  │     ├── Ads Management Agent          [Phase 3]
  │     ├── Email Outreach Agent          [Phase 3]
  │     ├── Strategic Intelligence Agent  [Phase 4]
  │     ├── Finance Agent                 [Phase 4]
  │     ├── Content/SEO Agent             [Phase 4]
  │     ├── Client Reporting Agent        [Phase 5]
  │     ├── Onboarding Agent              [Phase 5]
  │     ├── CRM/Pipeline Agent            [Phase 5]
  │     └── Knowledge Management Agent    [Phase 5]
  │
  └── Portfolio Health Agent              [special — org scope, not in business team]
```

The Portfolio Health Agent reports to `null`, not to the Orchestrator. It runs at `executionScope: org` against multiple subaccounts on its own schedule and writes to org-level memory. It is a monitoring surface, not a business-team member.

---

## Gate Model Reference

| Gate | Behaviour | Used For |
|------|-----------|----------|
| `auto` | Executes immediately, logged | Reads, internal analysis, memory updates, board writes, test runs, codebase reads |
| `review` | Creates review item, pauses until approved | Outbound communications, code patches, spec documents, CRM writes, financial records, ad copy/bid changes, published content |
| `block` | Never executes autonomously | Budget increases, campaign pauses, production deploys, merges, account deletion |

Gates are defined at two levels: each agent has a **default gate** in its frontmatter, and individual skills override that default per-invocation. The shipped convention: `orchestrator`, `qa`, and `portfolio-health-agent` default to `auto` (scheduled background workers); all thirteen business agents default to `review` (nothing ships without human sign-off). Individual skills like `read_workspace` stay `auto` regardless of agent default; individual skills like `increase_budget` stay `block` regardless of agent default.

---

## Full Agent Roster

| # | Agent | Slug | Reports To | Model | Schedule | Default Gate | Phase |
|---|-------|------|------------|-------|----------|--------------|-------|
| 1 | Orchestrator (COO) | `orchestrator` | null | opus-4-6 | `0 6,20 * * *` | auto | MVP |
| 2 | Business Analyst | `business-analyst` | orchestrator | sonnet-4-6 | on-demand | review | MVP |
| 3 | Dev Agent | `dev` | orchestrator | opus-4-6 | on-demand | review | MVP |
| 4 | QA Agent | `qa` | orchestrator | sonnet-4-6 | `0 2 * * *` | auto | MVP |
| 5 | Support Agent | `support-agent` | orchestrator | sonnet-4-6 | on-demand | review | 2 |
| 6 | Social Media Agent | `social-media-agent` | orchestrator | sonnet-4-6 | on-demand | review | 3 |
| 7 | Ads Management Agent | `ads-management-agent` | orchestrator | sonnet-4-6 | on-demand | review | 3 |
| 8 | Email Outreach Agent | `email-outreach-agent` | orchestrator | sonnet-4-6 | on-demand | review | 3 |
| 9 | Strategic Intelligence Agent | `strategic-intelligence-agent` | orchestrator | sonnet-4-6 | on-demand | review | 4 |
| 10 | Finance Agent | `finance-agent` | orchestrator | sonnet-4-6 | on-demand | review | 4 |
| 11 | Content/SEO Agent | `content-seo-agent` | orchestrator | sonnet-4-6 | on-demand | review | 4 |
| 12 | Client Reporting Agent | `client-reporting-agent` | orchestrator | sonnet-4-6 | on-demand | review | 5 |
| 13 | Onboarding Agent | `onboarding-agent` | orchestrator | sonnet-4-6 | on-demand | review | 5 |
| 14 | CRM/Pipeline Agent | `crm-pipeline-agent` | orchestrator | sonnet-4-6 | on-demand | review | 5 |
| 15 | Knowledge Management Agent | `knowledge-management-agent` | orchestrator | sonnet-4-6 | on-demand | review | 5 |
| 16 | Portfolio Health Agent | `portfolio-health-agent` | null | sonnet-4-6 | `*/4 * * *` | auto | special |

All values in this table are read directly from the AGENTS.md frontmatter files on disk. If there is a conflict between this table and the code, the code is right and this table needs updating.

---

## Build Sequence

| Phase | Agents | Primary Beneficiary | Depends On |
|-------|--------|---------------------|------------|
| MVP | Orchestrator, Business Analyst, Dev, QA | Platform builders | Validates full infrastructure stack |
| 2 | Support | Platform businesses | MVP primitives proven in production |
| 3 | Social Media, Ads Management, Email Outreach | Agency clients | Phase 2 review gates validated end-to-end |
| 4 | Strategic Intelligence, Finance, Content/SEO | Agency clients | Phase 3 agents generating data signals |
| 5 | Client Reporting, Onboarding, CRM/Pipeline, Knowledge Management | Agency clients | Phase 4 stable and data-rich |
| Special | Portfolio Health | Platform operators | Independent — monitors across subaccounts |
| 6 | Docker/Playwright infrastructure | Dev and QA agents | Parallel — does not block Phase 3 onward |

---

## Product Development Team Architecture

The four MVP agents (Orchestrator, Business Analyst, Dev, QA) form a coherent product development team. Understanding how they interact as a team is necessary before reading each agent's individual definition.

### The full development pipeline

```
Human or Orchestrator creates a board task
  │
  ├── Simple bug fix or small change
  │     └── Dev Agent reads task
  │           ├── draft_architecture_plan (auto) — internal planning
  │           ├── review_code (auto) — self-review
  │           ├── write_patch (review) — HITL: human approves diff
  │           └── QA Agent runs post-patch
  │
  └── Feature or significant change
        └── Business Analyst Agent
              ├── draft_requirements (auto) — user stories + Gherkin ACs
              └── write_spec (review) — HITL: human approves spec before Dev begins
              │
              └── Dev Agent reads approved spec
                    ├── draft_architecture_plan (auto)
                    ├── draft_tech_spec (auto, if API changes involved)
                    ├── review_ux (auto, if UI changes involved)
                    ├── Implements code
                    ├── review_code (auto) — self-review
                    └── write_patch (review) — HITL: human approves diff
                    │
                    └── QA Agent
                          ├── derive_test_cases from Gherkin ACs
                          ├── run_tests (auto)
                          └── report_bug (auto) if failures found
```

### Revision loop caps

The same discipline carried forward from v5.0:

| Loop | Cap | Escalation behaviour |
|------|-----|---------------------|
| BA spec revisions | 3 rounds | Dev Agent flags unresolved ambiguity to board, escalates to human |
| Dev plan-gap reports | 2 rounds | Dev Agent escalates to human with gap summary |
| Code fix-review cycles | 3 rounds | Dev Agent escalates with unresolved blocking issues |
| QA bug-fix cycles | 3 rounds | QA Agent escalates, blocks release until human resolves |

### File-based artifact convention

Agents communicate work products through workspace memory and board task attachments, not through shared context. This keeps context windows focused and creates an audit trail.

| Artifact | Written By | Read By | Location |
|----------|-----------|---------|----------|
| Requirements spec (user stories + Gherkin) | BA Agent | Dev Agent, QA Agent | Board task attachment or `workspace_memories` |
| Architecture plan | Dev Agent (via skill) | Dev Agent (phase 2), QA Agent | Board task attachment |
| Technical spec (OpenAPI/schema) | Dev Agent (via skill) | Dev Agent, QA Agent | Board task attachment |
| Code patch (diff) | Dev Agent | Human reviewer | Review queue |
| Test results | QA Agent | Orchestrator, Dev Agent | `workspace_memories` |
| Bug reports | QA Agent | Dev Agent, Orchestrator | Board tasks |

---

## Agent 1 — Orchestrator (COO)

- **Slug:** `orchestrator`
- **Reports to:** null (top of tree)
- **Model:** `claude-opus-4-6`
- **Schedule:** `0 6,20 * * *` (06:00 and 20:00 daily)
- **Default gate:** auto
- **Phase:** MVP

### Vision

The Orchestrator is the operational backbone of the entire agent network. It functions as the COO: the only agent with visibility across everything, responsible for synthesising state and keeping all other agents directed and coordinated. Every morning it reads the full state of the business — open tasks, recent agent activity, overnight memory entries, unreviewed actions, failed jobs — and synthesises it into a prioritised daily directive. Every evening it reviews what happened, writes a summary, and updates priorities for the next cycle.

It does not execute. It does not send emails, post content, or make API calls. Its entire output is a structured directive injected into every other agent's context on their next run.

### Responsibilities

- Read all workspace memory, task board state, recent agent run outputs, and open review items
- Identify patterns across agent outputs: recurring support issues, stalled tasks, budget anomalies, failing tests
- Write a morning directive with daily priorities, active context, and per-agent instructions
- Write an evening summary covering what was completed, what needs follow-up, and what to watch tomorrow
- Flag systemic issues for human attention: multiple agents failing on the same integration, persistent test failures, revision loops hitting their caps
- Adjust priorities dynamically in response to business signals: campaign launches, incidents, releases, client onboarding
- Invoke `triage_intake` when new ideas or bugs arrive outside of normal channels

### Wired skills (from `agents/orchestrator/AGENTS.md`)

| Skill | Gate | Purpose |
|-------|------|---------|
| `read_workspace` | auto | Full read of memory, tasks, recent runs, open review items |
| `write_workspace` | auto | Write directives and summaries to memory |
| `update_memory_block` | review | Update cross-agent shared memory blocks (Sprint 4/5 shared-state primitive) |
| `create_task` | auto | Create coordination tasks on the board |
| `move_task` | auto | Update task status as part of directive logic |
| `update_task` | auto | Edit task content when coordinating |
| `reassign_task` | auto | Route a task to a different agent |
| `spawn_sub_agents` | auto | Trigger parallel sub-task execution (max 2–3 independent tracks) |
| `triage_intake` | auto | Capture and route incoming ideas or bugs |
| `request_approval` | review | Escalate coordination decisions requiring human input |

### What it should NOT do

- Never send external communications of any kind
- Never write or propose code changes
- Never modify integration credentials or workspace configuration
- Never approve or reject review items — that is always a human decision
- Never take any action with financial consequences

### Outputs

- `orchestrator_directives` record written to the database each run, injected into all other agent prompts
- Evening summary written to `workspace_memories`
- Coordination tasks on the board when patterns require human attention
- Escalation flags for systemic failures or urgent issues

---

## Agent 2 — Business Analyst

- **Slug:** `business-analyst`
- **Reports to:** orchestrator
- **Model:** `claude-sonnet-4-6`
- **Schedule:** on-demand (triggered by Orchestrator directive or board task)
- **Default gate:** review
- **Phase:** MVP

### Vision

The Business Analyst is the translation layer between human intent and machine-executable requirements. Its job is to turn vague ideas, board tasks, and feature requests into user stories with Gherkin acceptance criteria that the Dev Agent can implement and the QA Agent can test against.

This is a separate agent and not a skill inside the Orchestrator for one specific reason: the BA produces artifacts that are independently consumed by two other agents (Dev and QA). If requirements analysis happened inside the Orchestrator, the Orchestrator's context would be contaminated with product thinking before it has even delegated. Worse, the Dev Agent would receive requirements as part of a large directive context rather than as a focused, self-contained spec document.

The BA operates in two modes. In **requirements mode**, it takes a board task or human-provided brief and produces a requirements spec. In **clarification mode**, it identifies open questions that would force the Dev Agent to make assumptions, surfaces them via `ask_clarifying_question`, and only produces a spec once those questions are answered. The review gate on the output spec document is non-negotiable: a spec that has not been human-reviewed should not drive engineering effort.

### Responsibilities

- Read board tasks, Orchestrator directives, and any provided context to understand the feature or change required
- Read the codebase for technical feasibility context before committing to requirements
- Clarify scope ambiguities before writing — never invent requirements
- Produce user stories in INVEST format (Independent, Negotiable, Valuable, Estimable, Small, Testable)
- Write Gherkin acceptance criteria for every story: Given/When/Then, including negative scenarios
- Rank open questions by risk (high/medium/low) — high-risk questions block the spec from being marked complete
- Produce a Definition of Done checklist specific to the task
- Submit the completed spec for human review before notifying the Dev Agent
- Invoke `triage_intake` when out-of-scope ideas or bugs surface during requirements analysis

### Wired skills (from `agents/business-analyst/AGENTS.md`)

| Skill | Gate | Purpose |
|-------|------|---------|
| `read_workspace` | auto | Board tasks, Orchestrator directives, existing product context |
| `read_codebase` | auto | Read relevant source files for technical feasibility context |
| `write_workspace` | auto | Write approved specs to memory, update task records |
| `create_task` | auto | Create clarification tasks when high-risk questions need human input |
| `move_task` / `update_task` / `add_deliverable` | auto | Standard board ops |
| `ask_clarifying_question` | auto | Pause and surface a blocking question to the user |
| `draft_requirements` | auto | Internal analysis and spec drafting with INVEST + Gherkin output |
| `write_spec` | review | Submit completed requirements spec for human approval (HITL gate) |
| `web_search` | auto | Research industry conventions, competitor behaviour for ambiguous scope |
| `triage_intake` | auto | Capture ideas or bugs surfaced during requirements analysis |
| `request_approval` | review | Escalate spec decisions to human |

### What it should NOT do

- Never pass a spec to the Dev Agent before it has been human-reviewed
- Never invent requirements — every acceptance criterion must be traceable to the brief or a clarification response
- Never make architecture or implementation decisions — define WHAT, not HOW
- Never write test code or review code — those belong to QA and Dev
- Never bypass the review gate on the spec document under any circumstances

### Outputs

- Requirements spec in the review queue: user stories, Gherkin ACs, open questions, Definition of Done
- Approved spec written to `workspace_memories` with a spec reference ID (`SPEC-task-N-vX`) for the Dev Agent and QA Agent
- Board task updated with spec reference and status changed to `spec-approved`
- Clarification tasks on the board when high-risk questions require human input before spec can complete

---

## Agent 3 — Dev Agent

- **Slug:** `dev`
- **Reports to:** orchestrator
- **Model:** `claude-opus-4-6`
- **Schedule:** on-demand (triggered via handoff, board task, or Orchestrator directive)
- **Default gate:** review (code changes), block (deploys, merges)
- **Phase:** MVP

### Vision

The Dev Agent is where the platform starts eating its own lunch. It is not a code completion tool — it is a developer that lives inside the same agent network as everyone else, reads the same workspace memory, sees the QA agent's bug reports on the board, and gets directed by the Orchestrator like any other team member.

The Dev Agent incorporates the discipline of the architect-builder separation without requiring two separate agents. Before writing a single line of code on any non-trivial task, the Dev Agent must produce and submit an architecture plan. This plan can be reviewed by a human before implementation begins (review gate for Significant/Major tasks) or, for small tasks, can be self-approved and immediately followed up with implementation (internal planning only). The four internal skills — `draft_architecture_plan`, `draft_tech_spec`, `review_ux`, and `review_code` — are invoked in sequence as the task requires them. The discipline is enforced by the agent's system prompt, not by a separate architecture agent.

The trust model is explicit and deliberate. Every code change goes through the HITL review queue before it touches the codebase. The agent proposes; a human decides.

### Task classification

The Dev Agent must classify each task before starting work:

| Classification | Criteria | Planning Requirement |
|----------------|----------|---------------------|
| **Trivial** | Single file change, obvious fix, no API impact | Skip architecture plan; go straight to implementation + self-review |
| **Standard** | 2–5 files, clear requirements, no schema changes | `draft_architecture_plan` internal; no plan review gate required |
| **Significant** | Schema changes, new API endpoints, or UI flows | `draft_architecture_plan` submitted for human review before coding begins |
| **Major** | New domain, cross-cutting concerns, or external integrations | `draft_architecture_plan` + `draft_tech_spec` submitted; no coding until human approves both |

### Wired skills (from `agents/dev/AGENTS.md`)

| Skill | Gate | Purpose |
|-------|------|---------|
| `read_codebase` | auto | Read files from projectRoot — scoped, no writes |
| `search_codebase` | auto | Grep and glob across the project |
| `read_workspace` | auto | Bug reports, QA findings, BA specs, Orchestrator directives |
| `write_workspace` | auto | Implementation notes and change summaries |
| `draft_architecture_plan` | auto | Internal: plan before writing code |
| `draft_tech_spec` | auto | Internal: produce API/schema specifications for significant changes |
| `review_ux` | auto | Internal: UX review pass on UI-affecting changes |
| `review_code` | auto | Internal: self-review pass before submitting any patch |
| `write_patch` | review | Propose a diff — human must approve before application |
| `write_tests` | auto | Write or update test files |
| `run_tests` | auto | Execute the project test suite |
| `run_command` | auto | Execute an approved shell command in projectRoot |
| `create_pr` | auto | Open a GitHub PR from accumulated approved patches |
| `request_approval` | review | Trigger HITL review for a proposed change |
| `create_task` / `move_task` / `update_task` / `add_deliverable` | auto | Standard board ops |

### Plan-gap protocol

If at any point during implementation the Dev Agent encounters an ambiguity that cannot be resolved from the spec, codebase context, or workspace memory, it must raise a PLAN_GAP report rather than improvising:

```
PLAN_GAP REPORT
Task: [task reference]
Gap: [specific description of what is missing or ambiguous]
Decision needed: [what choice needs to be made]
Options considered: [list of approaches with trade-offs]
Blocked chunk: [which part of the implementation is blocked]
```

The PLAN_GAP report is written to the board task as a comment and the task status is updated to `blocked`. Maximum 2 plan-gap rounds before the issue escalates to the human directly.

### What it should NOT do

- Never apply any code change without an approved review item
- Never run any shell command without human approval
- Never access files outside the configured `projectRoot`
- Never merge a PR — merges are always manual (block gate)
- Never deploy — deploys are always manual (block gate)
- Never modify environment variables, secrets, or configuration files without explicit instruction
- Never skip the architecture planning phase for Significant or Major classified tasks
- Never improvise past a plan gap — always raise a PLAN_GAP report

### Outputs

- Architecture plans in the review queue (for Significant/Major tasks) before coding begins
- Technical specs in the review queue (for Major tasks with API/schema changes)
- Code patches in the review queue with diff, reasoning, self-review results, and affected files listed
- PLAN_GAP reports as board task comments when ambiguity blocks implementation
- PRs on GitHub from batches of approved patches
- Implementation summaries written to workspace memory for QA Agent context

---

## Agent 4 — QA Agent

- **Slug:** `qa`
- **Reports to:** orchestrator
- **Model:** `claude-sonnet-4-6`
- **Schedule:** `0 2 * * *` (02:00 daily regression run) + on-demand
- **Default gate:** auto (reads, tests, and reports — no external writes)
- **Phase:** MVP

### Vision

The QA Agent is the closing sensor in the development loop. After a patch is approved and applied, QA runs against it and reports. That feedback cycle — Dev proposes, human approves, QA validates — is the core of the internal development loop the platform builds for itself.

The QA Agent has two defining disciplines:

**Gherkin traceability.** Every test case is explicitly mapped to a specific BA Gherkin acceptance criterion. An untraceable test is noise. This discipline means the QA Agent's test output can be directly matched against the BA's spec to confirm the feature delivers what was promised.

**Structured failure classification.** Every test failure is classified as one of three types: **APP BUG** (the application code is broken and needs a Dev Agent fix), **TEST BUG** (the test logic itself is wrong and the QA Agent fixes it immediately), or **ENVIRONMENT** (an expected failure in the current environment, noted and not escalated). This prevents the Dev Agent from chasing phantom failures caused by test infrastructure issues.

The compounding value is in workspace memory. Over time the QA Agent builds a picture of which endpoints are fragile, which tests are flaky, and which areas of the codebase produce the most bugs.

### Wired skills (from `agents/qa/AGENTS.md`)

| Skill | Gate | Purpose |
|-------|------|---------|
| `derive_test_cases` | auto | Extract test scenarios from Gherkin ACs in a BA spec |
| `run_tests` | auto | Execute configured test suite, capture pass/fail and output |
| `write_tests` | auto | Write or update test files for a module or fix |
| `run_playwright_test` | auto | Execute a Playwright end-to-end test file |
| `capture_screenshot` | auto | Visual QA validation via Playwright |
| `analyze_endpoint` | auto | Hit API endpoints, validate status, schema, and timing |
| `report_bug` | auto | Create structured board task with severity, classification, repro steps |
| `read_codebase` | auto | Read test files and source for context when analysing failures |
| `search_codebase` | auto | Find relevant code for a failing test |
| `read_workspace` | auto | Dev Agent implementation notes, BA specs, and Orchestrator context |
| `write_workspace` | auto | Test insights, fragility signals, and coverage summaries |
| `create_task` / `move_task` / `update_task` / `add_deliverable` | auto | Standard board ops |
| `request_approval` | review | Escalate when maxTestRunsPerTask or fingerprint-unchanged caps hit |

### Failure classification protocol

| Classification | Definition | Action |
|----------------|-----------|--------|
| **APP BUG** | Application code is broken; the test correctly identifies a defect | Create board task with severity, repro steps, Gherkin AC reference, and spec reference. Do not fix. |
| **TEST BUG** | The test logic is incorrect; the application behaviour is as intended | Fix the test immediately. Log the correction in workspace memory. No board task. |
| **ENVIRONMENT** | Failure caused by the test environment, not application or test logic | Note in workspace memory. Flag in run summary. Do not escalate unless recurring. |

When classification is uncertain, the QA Agent defaults to APP BUG and notes the uncertainty. The Dev Agent will investigate and reclassify if needed.

### What it should NOT do

- Never write to the codebase — tests and test files only, never application source
- Never send any external communication about findings
- Never close or resolve bugs it has raised — only an approved patch and human confirmation closes a bug
- Never approve code changes based on its own test results — human review always sits between QA sign-off and merge
- Never write a test that cannot be traced to a specific Gherkin AC

### Outputs

- Test cases derived from BA Gherkin ACs, written to workspace memory with spec reference ID
- Structured bug reports on the board: severity, classification, confidence score, reproduction steps, Gherkin AC reference
- Test run summaries written to workspace memory after each run
- Daily regression report injected into the Orchestrator morning directive
- Fragility and coverage insights written to memory for Dev Agent and Strategic Intelligence context

---

## Agent 5 — Support Agent

- **Slug:** `support-agent`
- **Reports to:** orchestrator
- **Model:** `claude-sonnet-4-6`
- **Schedule:** on-demand (v5.0 specified every 2 hours — shipped implementation is on-demand)
- **Default gate:** review (all outbound communication)
- **Phase:** 2

### Vision

The Support agent is the first point of contact between the platform and the reality of customer problems. Its job is to make sure nothing gets missed, everything gets triaged, and responses go out faster and more consistently than any human inbox could manage.

The key design principle is that the agent does the cognitive work — reading, classifying, drafting, prioritising — but a human approves every reply before it sends. Over time, as the review history builds, the agency can identify which reply categories the agent consistently gets right and progressively move those to auto.

The Support agent is also the primary sensor for product quality. It sees the bugs before they reach the board. The self-improvement loop — Support detects a pattern, board task created, Dev Agent fixes it — starts here.

### Wired skills (from `agents/support-agent/AGENTS.md`)

| Skill | Gate | Purpose |
|-------|------|---------|
| `read_workspace` | auto | Orchestrator directives, customer context, previous resolutions |
| `write_workspace` | auto | Pattern insights and resolution notes |
| `read_codebase` | auto | Look up code references when a ticket cites a specific feature |
| `read_inbox` | auto | Read emails from the connected inbox provider (gmail / outlook) |
| `classify_email` | auto | Tag by type, urgency, and sentiment |
| `search_knowledge_base` | auto | Reference docs, FAQs, and previous resolutions |
| `draft_reply` | auto | Generate reply for human review |
| `send_email` | auto | Send reply (gated upstream via `request_approval` for outbound) |
| `request_approval` | review | HITL gate on all outbound replies |
| `move_task` / `update_task` / `add_deliverable` | auto | Standard board ops |

**Note on v5.0 delta:** v5.0 listed `read_inbox` as a Support Agent skill. An earlier build shipped the runtime handler and registry entry but never wired it into the agent's frontmatter, leaving it as an orphan on disk. v6.0 closes the loop — `read_inbox` is now in `agents/support-agent/AGENTS.md` skills list so the agent can actually read email. `create_task` is still not currently wired; Support surfaces bugs via `write_workspace` + Orchestrator synthesis rather than direct task creation.

### What it should NOT do

- Never send any communication without human review
- Never promise features, refunds, or commitments on behalf of the agency
- Never close or archive tickets automatically
- Never access billing or account data beyond what is needed to answer the ticket

### Outputs

- Drafted replies in the review queue, ready for one-click approval
- Workspace memory entries for recurring patterns, surfaced to the Orchestrator each morning
- Escalation flags for tickets that need immediate human attention

---

## Agent 6 — Social Media Agent

- **Slug:** `social-media-agent`
- **Reports to:** orchestrator
- **Model:** `claude-sonnet-4-6`
- **Schedule:** on-demand (v5.0 specified every 6 hours)
- **Default gate:** review (all publishing actions)
- **Phase:** 3

### Vision

The Social Media agent is not a content mill. Its job is to maintain a consistent, informed presence across platforms — one that reflects what is actually happening in the business, not generic filler content. It reads workspace context before writing anything, so it knows about recent product updates, customer wins, active campaigns, and competitor moves.

### Wired skills (from `agents/social-media-agent/AGENTS.md`)

| Skill | Gate | Purpose |
|-------|------|---------|
| `read_workspace` | auto | Orchestrator directives, brand voice, recent updates |
| `write_workspace` | auto | Performance insights and content ideas |
| `draft_post` | auto | Generate platform-specific content for review |
| `publish_post` | review | Publish only after human approval |
| `read_analytics` | auto | Read performance data from connected social platforms |
| `request_approval` | review | HITL gate on publish actions |
| `move_task` / `update_task` / `add_deliverable` | auto | Standard board ops |

**Note on v5.0 delta:** `web_search` is not currently wired to Social Media Agent; if trend research is needed it comes via the Orchestrator directive or a handoff from Strategic Intelligence. `schedule_post` does not exist as a separate skill — scheduled publishing is handled via `publish_post` with a scheduled timestamp parameter.

### What it should NOT do

- Never publish anything without human approval
- Never engage with replies, comments, or DMs autonomously
- Never run paid promotion on organic posts without explicit instruction
- Never post about sensitive business topics: legal matters, personnel, incidents

### Outputs

- Drafted posts in the review queue with platform context and rationale
- Performance summaries in workspace memory
- Content ideas and campaign briefs as board task deliverables

---

## Agent 7 — Ads Management Agent

- **Slug:** `ads-management-agent`
- **Reports to:** orchestrator
- **Model:** `claude-sonnet-4-6`
- **Schedule:** on-demand (v5.0 specified every 6 hours)
- **Default gate:** review (bid and copy changes), block (budget increases, campaign pause)
- **Phase:** 3

### Vision

The Ads Management agent operates as a performance analyst that can also execute. It reads campaign performance, forms a clear view on what is working and what is not, and proposes specific changes with explicit reasoning. A human reviews and approves before anything actually changes.

The `block` gate on budget increases and campaign pauses is deliberate and non-negotiable. These are effectively irreversible — you cannot un-spend budget, and pausing a campaign mid-promotion can cause real damage. `increase_budget` and `pause_campaign` are the only two skills in the entire library that carry a `block` gate.

### Wired skills (from `agents/ads-management-agent/AGENTS.md`)

| Skill | Gate | Purpose |
|-------|------|---------|
| `read_workspace` | auto | Orchestrator directives, active campaigns, brand context |
| `write_workspace` | auto | Performance summaries and trend insights |
| `read_campaigns` | auto | Pull performance data from ad platforms |
| `analyse_performance` | auto | Internal analysis and insight generation |
| `draft_ad_copy` | auto | Generate copy variants for review |
| `update_bid` | review | Propose bid change — human approves before execution |
| `update_copy` | review | Propose ad copy swap — human approves before activation |
| `pause_campaign` | **block** | Never autonomous — always manual |
| `increase_budget` | **block** | Never autonomous — always manual |
| `request_approval` | review | Escalate decisions requiring human input |
| `move_task` / `update_task` / `add_deliverable` | auto | Standard board ops |

### What it should NOT do

- Never increase or decrease campaign budgets without explicit human instruction
- Never pause or resume campaigns autonomously
- Never create new campaigns — only optimise existing ones
- Never access billing or payment methods

### Outputs

- Performance analysis written to workspace memory each run
- Proposed bid and copy changes in the review queue with reasoning
- Ad copy variants drafted and ready for human selection
- Anomaly flags and competitor findings as board task deliverables

---

## Agent 8 — Email Outreach Agent

- **Slug:** `email-outreach-agent`
- **Reports to:** orchestrator
- **Model:** `claude-sonnet-4-6`
- **Schedule:** on-demand (v5.0 specified every 6 hours)
- **Default gate:** review (all outbound sequences)
- **Phase:** 3

### Vision

The Email Outreach agent does the research, sequencing, and drafting at scale — but every email that leaves the system goes through a human first. The agent's value is in the quality of its targeting and personalisation, not the volume of its sends. Sequences are drafted in full before any single email sends, so the human reviewer can evaluate the entire flow before approving the first touch.

### Wired skills (from `agents/email-outreach-agent/AGENTS.md`)

| Skill | Gate | Purpose |
|-------|------|---------|
| `read_workspace` | auto | ICP criteria, campaign priorities, Orchestrator directives |
| `write_workspace` | auto | Prospect insights, performance data, conversion signals |
| `enrich_contact` | auto | Pull contact data from enrichment integrations |
| `draft_sequence` | auto | Build full multi-touch email sequence for review |
| `send_email` | auto | Send email (individually gated via `request_approval`) |
| `update_crm` | review | Update contact records — human approves |
| `request_approval` | review | HITL gate on every email send in a sequence |
| `move_task` / `update_task` / `add_deliverable` | auto | Standard board ops |

**Note on v5.0 delta:** `web_search` is not currently wired to Email Outreach Agent — prospect research is expected to come via `enrich_contact` and workspace memory ICP definitions.

### What it should NOT do

- Never send any email without human review and approval
- Never contact anyone on a suppression list under any circumstances
- Never impersonate a specific named individual without explicit configuration
- Never draft outreach for regulated industries without specific compliance guidance in workspace memory

### Outputs

- Full drafted sequences in the review queue with prospect context and personalisation rationale
- Prospect lists with research summaries written to the board as deliverables
- Response alerts and hot lead flags as board task updates
- Performance and conversion insights written to memory

---

## Agent 9 — Strategic Intelligence Agent

- **Slug:** `strategic-intelligence-agent`
- **Reports to:** orchestrator
- **Model:** `claude-sonnet-4-6` (v5.0 specified opus — downgraded during build)
- **Schedule:** on-demand (v5.0 specified daily 07:00)
- **Default gate:** review
- **Phase:** 4

### Vision

This agent merges what would otherwise have been two separate agents — Business Planning and Competitor Research. The Strategic Intelligence agent is the platform's thinking layer. It does not act. It synthesises signals from Finance, Ads, Support, Email Outreach, and external competitor monitoring into structured insight. Its most important function is connecting dots across domains — Finance sees a revenue dip, Ads sees rising CPAs, Support sees more onboarding complaints. On their own these are three separate signals. Together they suggest a conversion problem working its way through the funnel.

### Wired skills (from `agents/strategic-intelligence-agent/AGENTS.md`)

| Skill | Gate | Purpose |
|-------|------|---------|
| `read_workspace` | auto | Full access to memory, board, and all agent run outputs |
| `write_workspace` | auto | Strategic insights, competitor profiles, and summaries |
| `web_search` | auto | Competitor news, market context, and industry signals |
| `generate_competitor_brief` | auto | Structured intelligence brief on a competitor: positioning, pricing, moves |
| `synthesise_voc` | auto | Synthesise Voice of Customer data from multiple sources into themes |
| `request_approval` | review | Escalate recommendations requiring human decision |
| `move_task` / `update_task` / `add_deliverable` | auto | Standard board ops |

**Note on v5.0 delta:** v5.0 listed `web_fetch` for page diffing. `fetch_url` exists on disk as an orphan skill — it is not currently wired to Strategic Intelligence. `create_task` is also not wired; strategic recommendations are surfaced via `add_deliverable` on existing tasks.

### What it should NOT do

- Never take any external action of any kind
- Never contact competitor companies or their employees
- Never attempt to access non-public competitor data
- Never make financial projections that could be mistaken for accounting records
- Never surface low-relevance competitor findings as deliverables

### Outputs

- Strategic recommendations as task deliverables with supporting evidence
- Daily cross-domain analysis written to workspace memory
- Updated competitor profiles after each run
- Weekly summary injected into the Orchestrator directive

---

## Agent 10 — Finance Agent

- **Slug:** `finance-agent`
- **Reports to:** orchestrator
- **Model:** `claude-sonnet-4-6`
- **Schedule:** on-demand (v5.0 specified every 6 hours)
- **Default gate:** review (record changes), auto (reads and analysis)
- **Phase:** 4

### Vision

The Finance agent gives the agency a continuous, accurate picture of its financial position without anyone having to manually reconcile anything. Revenue, costs, margins, anomalies — it syncs from connected integrations, computes the numbers, and writes them to memory where the Orchestrator and Strategic Intelligence agent can see them.

The most valuable thing the Finance agent does is near-real-time anomaly detection. A tool subscription that doubled its price, a payment that did not process, a client retainer that is overdue — these surface within hours rather than at the end of the month.

### Wired skills (from `agents/finance-agent/AGENTS.md`)

| Skill | Gate | Purpose |
|-------|------|---------|
| `read_workspace` | auto | Budget benchmarks, Orchestrator context |
| `write_workspace` | auto | Financial summaries and anomaly findings |
| `read_revenue` | auto | Pull revenue data from payment processors |
| `read_expenses` | auto | Pull expense data from accounting integrations |
| `analyse_financials` | auto | Internal calculations and anomaly detection |
| `update_financial_record` | review | Propose expense corrections — human approves |
| `request_approval` | review | HITL gate on record changes |
| `move_task` / `update_task` / `add_deliverable` | auto | Standard board ops |

**Note on v5.0 delta:** v5.0 named the record-update skill `update_record`; the shipped skill is `update_financial_record`.

### What it should NOT do

- Never initiate any payment or transfer of any kind
- Never modify financial records without human review
- Never produce anything that could be mistaken for formal accounting records or tax advice
- Never surface raw financial data to non-admin users

### Outputs

- Financial snapshot written to workspace memory each run
- Anomaly flags as task deliverables with supporting data
- Proposed record corrections in the review queue
- Daily financial summary injected into the Orchestrator directive

---

## Agent 11 — Content/SEO Agent

- **Slug:** `content-seo-agent`
- **Reports to:** orchestrator
- **Model:** `claude-sonnet-4-6`
- **Schedule:** on-demand (v5.0 specified on-demand + weekly planning)
- **Default gate:** review (all published content)
- **Phase:** 4

### Vision

The Social Media agent handles short-form content. The Content and SEO agent handles everything else: long-form blog posts, SEO articles, case studies, landing page copy, and lead magnets. It reads workspace context, researches the topic, drafts the content, and submits it for human review before anything publishes.

### Wired skills (from `agents/content-seo-agent/AGENTS.md`)

| Skill | Gate | Purpose |
|-------|------|---------|
| `read_workspace` | auto | Brand voice, content calendar, Orchestrator directives |
| `write_workspace` | auto | Performance insights, content briefs |
| `web_search` | auto | Topic research, competitor content, SEO keyword discovery |
| `draft_content` | auto | Long-form draft with section headings, body, and SEO recommendations |
| `audit_seo` | auto | On-page SEO audit for a page or content piece |
| `create_lead_magnet` | review | Produce a lead magnet asset (checklist, template, guide, scorecard) — HITL |
| `update_page` | auto | Update existing page HTML, meta, or form config |
| `publish_page` | auto | Publish a draft page (gated upstream via `request_approval`) |
| `request_approval` | review | HITL gate on publish actions |
| `move_task` / `update_task` / `add_deliverable` | auto | Standard board ops |

### What it should NOT do

- Never publish content without human review
- Never modify published pages without explicit task reference
- Never scrape competitor copy verbatim
- Never run auto-rewrites on existing content without a deliberate brief

### Outputs

- Long-form drafts in the review queue with SEO analysis
- Lead magnet assets in the review queue ready for campaign use
- Published pages (only after approval)
- Content performance summaries in workspace memory

---

## Agent 12 — Client Reporting Agent

- **Slug:** `client-reporting-agent`
- **Reports to:** orchestrator
- **Model:** `claude-sonnet-4-6`
- **Schedule:** on-demand (v5.0 specified weekly Mon 09:00 + on-demand)
- **Default gate:** review (all report delivery)
- **Phase:** 5

### Vision

The Client Reporting agent turns raw performance data into client-ready narratives. It pulls numbers from Ads, Social, Finance, and CRM, writes a structured report with executive summary and section narratives, and submits the final deliverable for human approval before sending it to the client.

### Wired skills (from `agents/client-reporting-agent/AGENTS.md`)

| Skill | Gate | Purpose |
|-------|------|---------|
| `read_workspace` | auto | Pull all client metrics, campaign results, and context |
| `write_workspace` | auto | Report drafts and delivery records |
| `draft_report` | auto | Produce a structured client report with exec summary and sections |
| `deliver_report` | review | Send approved report via configured delivery channel — HITL |
| `request_approval` | review | HITL gate on report delivery |
| `move_task` / `update_task` / `add_deliverable` | auto | Standard board ops |

### What it should NOT do

- Never deliver a report without human approval
- Never invent metrics that are not in the source data
- Never produce reports for clients without an active engagement record

### Outputs

- Draft reports in the review queue with supporting data
- Delivered reports logged as board deliverables with delivery confirmation
- Report templates and patterns in workspace memory

---

## Agent 13 — Onboarding Agent

- **Slug:** `onboarding-agent`
- **Reports to:** orchestrator
- **Model:** `claude-sonnet-4-6` (v5.0 specified opus — downgraded during build)
- **Schedule:** on-demand (per new client)
- **Default gate:** review (all external setup)
- **Phase:** 5

### Vision

The Onboarding agent guides a new client or workspace through integration setup, permission grants, and initial configuration. Every integration configuration goes through HITL approval — the agent never stores credentials without explicit human sign-off.

### Wired skills (from `agents/onboarding-agent/AGENTS.md`)

| Skill | Gate | Purpose |
|-------|------|---------|
| `read_workspace` | auto | Onboarding checklists, client context, previous configurations |
| `write_workspace` | auto | Onboarding progress and configuration notes |
| `configure_integration` | review | Walk through integration setup with human approval — HITL |
| `request_approval` | review | HITL gate on every configuration decision |
| `move_task` / `update_task` / `add_deliverable` | auto | Standard board ops |

**Note on v5.0 delta:** The Onboarding Agent is currently the leanest wired agent on disk (7 skills). v5.0 discussed richer onboarding workflows — those remain aspirational and will be added as the Phase 5 build progresses.

### What it should NOT do

- Never store integration credentials without human approval
- Never complete onboarding steps on behalf of the client
- Never skip a configuration step without explicit deferral

### Outputs

- Integration configurations in the review queue
- Onboarding progress tracked as board deliverables
- Configuration notes in workspace memory for future reference

---

## Agent 14 — CRM/Pipeline Agent

- **Slug:** `crm-pipeline-agent`
- **Reports to:** orchestrator
- **Model:** `claude-sonnet-4-6`
- **Schedule:** on-demand (v5.0 specified every 6 hours)
- **Default gate:** review (all CRM writes)
- **Phase:** 5

### Vision

The CRM/Pipeline agent keeps deal data current, identifies stalled opportunities, drafts follow-ups for stale contacts, and flags churn risk on existing accounts. Every CRM write — contact update, deal stage change, note addition — goes through HITL review.

### Wired skills (from `agents/crm-pipeline-agent/AGENTS.md`)

| Skill | Gate | Purpose |
|-------|------|---------|
| `read_workspace` | auto | ICP criteria, pipeline rules, Orchestrator directives |
| `write_workspace` | auto | Pipeline insights, velocity metrics, at-risk account notes |
| `read_crm` | auto | Pull contact, deal, and pipeline data from connected CRM |
| `analyse_pipeline` | auto | Internal analysis of velocity, stage conversion, stale deals |
| `detect_churn_risk` | auto | Score existing accounts for churn risk from CRM signals |
| `draft_followup` | auto | Draft contextually personalised follow-up emails |
| `send_email` | auto | Send follow-up (gated upstream via `request_approval`) |
| `update_crm` | review | Write CRM updates — human approves |
| `request_approval` | review | HITL gate on CRM writes and outbound emails |
| `move_task` / `update_task` / `add_deliverable` | auto | Standard board ops |

### What it should NOT do

- Never write to the CRM without human approval
- Never mark deals as won or lost autonomously
- Never delete CRM records under any circumstances
- Never send outreach to contacts on a suppression list

### Outputs

- Pipeline velocity and conversion analysis in workspace memory
- Draft follow-up emails in the review queue for stale deals
- Churn risk flags as board task deliverables
- Proposed CRM updates in the review queue

---

## Agent 15 — Knowledge Management Agent

- **Slug:** `knowledge-management-agent`
- **Reports to:** orchestrator
- **Model:** `claude-sonnet-4-6`
- **Schedule:** on-demand (v5.0 specified daily 08:00)
- **Default gate:** review (doc updates)
- **Phase:** 5

### Vision

The Knowledge Management agent keeps internal documentation aligned with code and process reality. It reads docs, diffs them against current behaviour, and proposes targeted updates through HITL review. It also authors new documentation when gaps are identified.

### Wired skills (from `agents/knowledge-management-agent/AGENTS.md`)

| Skill | Gate | Purpose |
|-------|------|---------|
| `read_workspace` | auto | Documentation inventory, recent changes, open gaps |
| `write_workspace` | auto | Doc change notes and gap reports |
| `read_docs` | auto | Retrieve documentation pages from connected doc source |
| `propose_doc_update` | review | Propose a specific doc update as a diff — HITL |
| `write_docs` | review | Apply an approved doc update — HITL |
| `request_approval` | review | HITL gate on doc changes |
| `move_task` / `update_task` / `add_deliverable` | auto | Standard board ops |

### What it should NOT do

- Never publish or modify documentation without human approval
- Never delete existing documentation
- Never author documentation for features that do not exist

### Outputs

- Proposed doc updates in the review queue with diff-style changes
- Gap reports written to workspace memory
- New documentation in the review queue when gaps are filled

---

## Agent 16 — Portfolio Health Agent

- **Slug:** `portfolio-health-agent`
- **Reports to:** null (operates outside the business-team hierarchy)
- **Model:** `claude-sonnet-4-6`
- **Schedule:** `*/4 * * *` (every 4 hours)
- **Default gate:** auto
- **Execution scope:** `org` (not `subaccount`)
- **Phase:** special (not part of the sequential build — ships independently)

### Vision

The Portfolio Health Agent is the one system agent that operates at organisation scope rather than subaccount scope. It runs against all subaccounts in an org, computes health scores, detects anomalies, scores churn risk, and generates portfolio-wide intelligence briefings. It does not coordinate with the Orchestrator — it writes to a separate org-level memory surface (`read_org_insights` / `write_org_insight`) that the human operator and Strategic Intelligence Agent can read.

The Portfolio Health Agent is deliberately outside the business-team hierarchy because it crosses subaccount boundaries. Giving it a place in the Orchestrator-led team would muddle the per-subaccount scoping model that every other agent respects. It is an org-level monitor, and its outputs are read by the human operator to identify which subaccounts need attention.

### Wired skills (from `agents/portfolio-health-agent/AGENTS.md`)

| Skill | Gate | Purpose |
|-------|------|---------|
| `compute_health_score` | auto | Calculate composite health score (0–100) for each subaccount |
| `detect_anomaly` | auto | Compare current metrics against historical baseline |
| `compute_churn_risk` | auto | Score each subaccount for churn risk and propose intervention |
| `generate_portfolio_report` | auto | Structured intelligence briefing across the portfolio |
| `query_subaccount_cohort` | auto | Read board health and memory across cohorts of subaccounts |
| `read_org_insights` | auto | Query cross-subaccount insights from org-level memory |
| `write_org_insight` | auto | Store cross-subaccount patterns in org-level memory |
| `trigger_account_intervention` | auto | Propose an intervention action for a subaccount (HITL-gated upstream) |

### What it should NOT do

- Never write to individual subaccount workspace memory — only org-level memory
- Never invoke business-team agents directly
- Never make interventions without HITL approval via `trigger_account_intervention`
- Never expose cross-subaccount data to users who lack org-level permissions

### Outputs

- Health scores per subaccount written to org-level memory every 4 hours
- Anomaly flags and churn risk scores in org-level memory
- Portfolio intelligence briefings in org-level memory
- Intervention proposals routed through HITL review

---

## Appendix A — Skill → Agent Cross-Reference

This table lists every **wired** skill (present in at least one AGENTS.md frontmatter) and every agent that uses it. Orphan skills — those present on disk but not referenced by any agent — are listed separately in Appendix B.

### Skills shared across many agents

| Skill | Gate | Used By |
|-------|------|---------|
| `read_workspace` | auto | all 15 business agents + Orchestrator (16 total) |
| `write_workspace` | auto | all 15 business agents + Orchestrator (16 total) |
| `move_task` | auto | all 15 business agents + Orchestrator (16 total) |
| `update_task` | auto | all 15 business agents + Orchestrator (16 total) |
| `add_deliverable` | review | all 14 non-Orchestrator business agents (14 total) |
| `request_approval` | review | all 15 business agents + Orchestrator (16 total) |
| `create_task` | auto | business-analyst, dev, orchestrator, qa (4 total) |

### Domain-specific skill wiring

| Skill | Gate | Used By |
|-------|------|---------|
| `read_codebase` | auto | business-analyst, dev, qa, support-agent |
| `search_codebase` | auto | dev, qa |
| `draft_architecture_plan` | auto | dev |
| `draft_tech_spec` | auto | dev |
| `review_ux` | auto | dev |
| `review_code` | auto | dev |
| `write_patch` | review | dev |
| `write_tests` | auto | dev, qa |
| `run_tests` | auto | dev, qa |
| `run_command` | auto | dev |
| `create_pr` | auto | dev |
| `derive_test_cases` | auto | qa |
| `analyze_endpoint` | auto | qa |
| `capture_screenshot` | auto | qa |
| `run_playwright_test` | auto | qa |
| `report_bug` | auto | qa |
| `draft_requirements` | auto | business-analyst |
| `write_spec` | review | business-analyst |
| `ask_clarifying_question` | auto | business-analyst |
| `triage_intake` | auto | business-analyst, orchestrator |
| `reassign_task` | auto | orchestrator |
| `spawn_sub_agents` | auto | orchestrator |
| `web_search` | auto | business-analyst, content-seo-agent, strategic-intelligence-agent |
| `classify_email` | auto | support-agent |
| `draft_reply` | auto | support-agent |
| `search_knowledge_base` | auto | support-agent |
| `draft_post` | auto | social-media-agent |
| `publish_post` | review | social-media-agent |
| `read_analytics` | auto | social-media-agent |
| `read_campaigns` | auto | ads-management-agent |
| `analyse_performance` | auto | ads-management-agent |
| `draft_ad_copy` | auto | ads-management-agent |
| `update_bid` | review | ads-management-agent |
| `update_copy` | review | ads-management-agent |
| `pause_campaign` | **block** | ads-management-agent |
| `increase_budget` | **block** | ads-management-agent |
| `enrich_contact` | auto | email-outreach-agent |
| `draft_sequence` | auto | email-outreach-agent |
| `send_email` | auto | support-agent, email-outreach-agent, crm-pipeline-agent |
| `update_crm` | review | email-outreach-agent, crm-pipeline-agent |
| `generate_competitor_brief` | auto | strategic-intelligence-agent |
| `synthesise_voc` | auto | strategic-intelligence-agent |
| `read_revenue` | auto | finance-agent |
| `read_expenses` | auto | finance-agent |
| `analyse_financials` | auto | finance-agent |
| `update_financial_record` | review | finance-agent |
| `draft_content` | auto | content-seo-agent |
| `audit_seo` | auto | content-seo-agent |
| `create_lead_magnet` | review | content-seo-agent |
| `update_page` | auto | content-seo-agent |
| `publish_page` | auto | content-seo-agent |
| `draft_report` | auto | client-reporting-agent |
| `deliver_report` | review | client-reporting-agent |
| `configure_integration` | review | onboarding-agent |
| `read_crm` | auto | crm-pipeline-agent |
| `analyse_pipeline` | auto | crm-pipeline-agent |
| `detect_churn_risk` | auto | crm-pipeline-agent |
| `draft_followup` | auto | crm-pipeline-agent |
| `read_docs` | auto | knowledge-management-agent |
| `propose_doc_update` | review | knowledge-management-agent |
| `write_docs` | review | knowledge-management-agent |
| `compute_health_score` | auto | portfolio-health-agent |
| `detect_anomaly` | auto | portfolio-health-agent |
| `compute_churn_risk` | auto | portfolio-health-agent |
| `generate_portfolio_report` | auto | portfolio-health-agent |
| `query_subaccount_cohort` | auto | portfolio-health-agent |
| `read_org_insights` | auto | portfolio-health-agent |
| `write_org_insight` | auto | portfolio-health-agent |
| `trigger_account_intervention` | auto | portfolio-health-agent |

---

## Appendix B — Skill Wiring Audit (v6.0)

An initial audit of `server/skills/` found 14 skills that were not referenced in any of the 16 company AGENTS.md files. Closer inspection showed that 10 of those 14 are actually wired to non-company agents via the master seed script, and 4 were genuine orphans. This appendix documents both groups plus the resolution of each genuine orphan.

### Group A — Wired via the master seed to the Reporting Agent (5 skills)

These are not orphans. They form the toolkit for the domain-agnostic **Reporting Agent** that the master seed script creates in Phase 5 as a subaccount-scoped `agents` row in the Breakout Solutions demo org (see [scripts/seed.ts](../scripts/seed.ts) Phase 5d). The Reporting Agent is not part of the 16-agent company — it is a per-client template that demonstrates the pattern for building client-specific agents on top of the system skill library.

| Skill | Gate | Role in the Reporting Agent pipeline |
|-------|------|--------------------------------------|
| `fetch_paywalled_content` | auto | Phase 1 ACQUIRE — fetches content from sources behind a login using a stored `web_login` connection |
| `fetch_url` | auto | Phase 1 ACQUIRE — public URL counterpart to `fetch_paywalled_content` |
| `transcribe_audio` | auto | Phase 2 CONVERT — Whisper transcription of audio/video artifacts |
| `analyse_42macro_transcript` | auto | Phase 3 ANALYSE — domain "lens" for 42 Macro content specifically |
| `send_to_slack` | auto | Phase 4 PUBLISH — posts the finished report to a Slack channel |

### Group B — Wired via the master seed to the Playbook Author (5 skills)

These are not orphans either. They are the Studio tool set for the **Playbook Author** system agent that the master seed creates in Phase 3. The Playbook Author sits outside the `companies/automation-os/` hierarchy because it is a system-managed Studio tool runner, not a business-team member — it helps platform admins draft and validate new playbook templates via chat and never writes files itself.

| Skill | Role |
|-------|------|
| `playbook_read_existing` | Load an existing playbook file for reference during authoring |
| `playbook_validate` | Run the Playbook DAG validator against a candidate definition |
| `playbook_simulate` | Static analysis pass — parallelism profile and critical path |
| `playbook_estimate_cost` | Pessimistic cost estimate defaulting to max tokens and worst-case retries |
| `playbook_propose_save` | Record the validated definition for the human admin to save via the Studio button |

All five are marked `visibility: none` in their frontmatter per the skill classification rule (see Appendix D) — they are system-admin-only tooling and are hidden from the org-level skill UI.

### Group C — Genuine orphans (4 skills) — RESOLVED

These four skills had no wiring anywhere in the repo. v6.0 resolves each one:

| Skill | Resolution | Rationale |
|-------|------------|-----------|
| `read_inbox` | **Wired into `support-agent/AGENTS.md`** | Had a full `actionRegistry` entry and executor case at [server/services/skillExecutor.ts](../server/services/skillExecutor.ts) line 380 but no agent was referencing it. Support Agent cannot do its job (triaging inbound email) without it — the wiring was an unfinished handoff from the earlier file-based-skill migration. Fixed. |
| `update_memory_block` | **Wired into `orchestrator/AGENTS.md`** (gate: review) | Sprint 4/5 shared-memory-block primitive with a full runtime handler at [server/services/skillExecutor.ts](../server/services/skillExecutor.ts) line 1083 via `memoryBlockService`. The Orchestrator is the only agent that coordinates cross-agent state, so it is the natural owner for a "write to a named block with ownership semantics" primitive. The skill is `review`-gated so it always goes through HITL approval — the Orchestrator proposes, the human confirms. |
| `trigger_process.md` | **Deleted** | No runtime handler in `skillExecutor.ts`, no entry in `actionRegistry.ts`. This was a stub from commit `37f2184` ("feat: file-based system skills + general-purpose Orchestrator prompt") that matched an aspirational Orchestrator prompt but was never implemented. The shipped Orchestrator uses `spawn_sub_agents` for parallel work instead. Removing the stub prevents a future author from wiring it and getting a silent no-op. |
| `read_data_source` | **Registry entry added — runtime now complete** | Previously a broken wire: the executor handler at [server/services/skillExecutor.ts](../server/services/skillExecutor.ts) line 360 existed, the tool implementation at [server/tools/readDataSource.ts](../server/tools/readDataSource.ts) existed, and the per-run limits at [server/config/limits.ts](../server/config/limits.ts) line 37 referenced it — but there was no registry entry in [server/config/actionRegistry.ts](../server/config/actionRegistry.ts), so agents listing it in their frontmatter could not invoke it through the tool-call infrastructure. v6.0 closes the loop by adding a full `read_data_source` entry with the correct `list` / `read` parameter schema, `topics: ['workspace']`, `defaultGateLevel: 'auto'`, and `idempotencyStrategy: 'read_only'`. The skill is now **callable** by any agent that adds it to its `skills:` frontmatter — but is deliberately not pre-wired to any agent. It is an opt-in primitive for agents that want to query a specific attached data source mid-run beyond what the cascading-context auto-load provides. Classified as `visibility: none` (app-foundational) because the data source surface is a run-internal platform primitive, not a customer-facing capability. |

**Dangling references:** none. Every skill slug referenced in any agent frontmatter exists on disk.

### Post-resolution skill count

- Files on disk: **90** (was 91 before `trigger_process.md` deletion)
- Wired to at least one agent via `companies/automation-os/agents/` AGENTS.md: **76** (was 74; +2 from orphan wiring)
- Wired via master seed to the Reporting Agent: **5**
- Wired via master seed to the Playbook Author: **5**
- Runtime complete, not pre-wired to any agent (opt-in): **1** (`read_data_source`)
- Unwired and dead: **0** (was 1; `trigger_process` deleted)

Every skill file on disk now has either (a) at least one agent referencing it, (b) a master-seed code path referencing it, or (c) a complete runtime that any agent can opt into by adding the slug to its frontmatter. Zero broken wires.

If any future audit re-introduces an unwired skill, the pattern for resolving it is documented in Appendix D.

### Playbook template fix: `portfolio-health-sweep`

The `portfolio-health-sweep` system playbook template (seeded in Phase 4 of the master seed) previously referenced `agentRef: { kind: 'system', slug: 'reporting-agent' }` — but `reporting-agent` is a subaccount-scoped custom agent, not a system agent, so the reference would have failed to resolve at playbook run time. It also referenced a never-built skill named `list_active_subaccounts`. v6.0 corrects both:

- **Agent reference:** now `{ kind: 'system', slug: 'portfolio-health-agent' }` — the actual system agent for org-scoped portfolio monitoring, with `executionScope: 'org'`.
- **Step 1 skill:** now `query_subaccount_cohort` with empty `tag_filters` — returns every active subaccount in the org. This skill is already wired to `portfolio-health-agent` and replaces the hypothetical `list_active_subaccounts`.
- **Step 2 skill:** still `generate_portfolio_report`, which is already wired to `portfolio-health-agent` and produces the structured briefing. Now passes explicit parameters (`reporting_period_days: 7`, `format: 'structured'`, `verbosity: 'standard'`) instead of relying on defaults.

The playbook now resolves cleanly against real system agents and real skills at run time.

---

## Appendix C — Source of Truth & Drift Protocol

### The hierarchy of truth

1. **`companies/automation-os/agents/<slug>/AGENTS.md`** — the authoritative runtime definition. [`scripts/seed.ts`](../scripts/seed.ts) reads this directly via `parseCompanyFolder` in [`scripts/lib/companyParser.ts`](../scripts/lib/companyParser.ts). The database row for each agent in `system_agents` is derived from this file.
2. **`companies/automation-os/COMPANY.md`** — the top-level manifest frontmatter. Only the frontmatter is read by the parser (name, description, slug, schema, version). The body is documentation.
3. **`companies/automation-os/automation-os-manifest.json`** — human-readable index only. Not read by any code path. It exists to give a single-file view of the roster and must be updated when agents are added or removed.
4. **`server/skills/<slug>.md`** — the authoritative definition of each system skill. Read by `systemSkillService` on demand, no DB sync. Every file must have an explicit `visibility:` frontmatter value per Appendix D.
5. **`docs/system-agents-master-brief-v6.md`** (this document) — the architectural brief. Describes the shape and reasoning. Must be updated when agent wiring, skill wiring, gate model, or phase assignments change.

When these sources conflict, the `.md` files (AGENTS.md and skill files) win. Everything else needs updating.

### The master seed script

[`scripts/seed.ts`](../scripts/seed.ts) is the single entry point for bootstrapping a database. It runs in five phases:

| Phase | Scope | Idempotency |
|-------|-------|-------------|
| 1 | System org + system admin user | Upserts — re-running updates mutable fields |
| 2 | 16 system agents from `companies/automation-os/` | Upserts via slug lookup |
| 3 | Playbook Author system agent (17th) | Upsert via slug lookup |
| 4 | Playbook templates from `server/playbooks/*.playbook.ts` + `portfolio-health-sweep` | Upserts via slug |
| 5 | Dev fixtures: Breakout Solutions org + admin + `42macro-tracking` subaccount + Reporting Agent + integration placeholders + **all 16 system agents activated in the org and linked through to the subaccount** | Upserts everywhere except `integration_connections`, which use insert-if-missing to protect real credentials |

Every phase is idempotent at row level. Re-running the seed against an already-seeded DB applies drift (new agents, renamed skills, updated prompts) without manual cleanup. Three drift cases are handled explicitly:

- **Removed `reportsTo`.** If an agent's `reportsTo` is removed or set to `null` in its AGENTS.md, Phase 2 explicitly clears the `parentSystemAgentId` column in the DB row. A stale parent link cannot linger.
- **Execution scope flip.** If a system agent flips from `subaccount` to `org` scope, Phase 5 deactivates any existing `subaccount_agents` row for it — so the link doesn't linger as a false-positive "active at subaccount".
- **Password changes via UI.** `upsertUser` hashes the provided password only on INSERT. On UPDATE the `passwordHash` column is never touched, so a user who has changed their password via the UI will not have it reverted by a re-seed.

The only non-upsert is `integration_connections` — those rows start as `PLACEHOLDER_...` and must not be overwritten once real credentials are filled in via the UI.

**Not atomic across phases.** Each DB write is individually committed; there is no transaction wrapping a phase or the whole seed. If the process dies mid-phase, re-running converges because every row-level operation is an upsert. Row-level idempotency is the intentional trade-off — phase-atomic transactions would add significant complexity for a marginal benefit in a bootstrap workflow.

Before Phase 1 runs, the seed executes a **preflight** that verifies every `server/skills/*.md` file has an explicit `visibility:` frontmatter matching the classification in `scripts/lib/skillClassification.ts`. If any skill has drifted, the seed aborts before touching the DB — drift is caught locally, not in production.

**Usage:**

```bash
# Dev seed — includes Phase 5 dev fixtures
npm run seed

# Production seed — skips Phase 5
npm run seed:production
```

### Drift protocol

When making a change that touches any agent's behaviour, skill wiring, gate model, schedule, or model assignment, update the artifacts in this order:

1. Edit the corresponding `agents/<slug>/AGENTS.md` file
2. If adding or removing an agent: update `automation-os-manifest.json` AND the Full Agent Roster table in this document
3. If changing a skill's gate or wiring: update the affected agent's skill table in this document AND Appendix A
4. If adding a new skill file, classify it in `scripts/lib/skillClassification.ts` and run `npm run skills:apply-visibility` (see Appendix D)
5. Commit all affected files in the same PR — drift between them is a review-blocking issue

### Verifying the brief matches reality

To confirm this document matches the code, run:

```bash
npm run seed                          # applies everything; prints upsert counts
npm run skills:verify-visibility      # fails if any skill has drifted from the classification
```

The seed script will print each agent it creates or updates. The Automation OS company count should be **16** and the Playbook Author is the 17th. The slugs should match the Full Agent Roster table exactly. If the script outputs `[warn] reportsTo slug not found`, there is a hierarchy mismatch that needs fixing in the corresponding AGENTS.md `reportsTo:` field.

---

## Appendix D — Skill Visibility Rule

### The rule

Every file-based system skill in `server/skills/*.md` must carry an explicit `visibility:` frontmatter value. There is no default — a missing value fails the validation gate at `npm run skills:verify-visibility`.

Skills fall into two classes:

| Class | Visibility | Definition |
|-------|-----------|------------|
| **App-foundational** | `none` | Platform-infrastructure primitives agents use to operate inside this application: task board management, workspace memory, HITL escalation, sub-agent orchestration, Studio tooling. Not customer-facing. |
| **Business-visible** | `basic` | Everything else. Represents work the agent does that a customer might care about: drafting ad copy, analysing financials, publishing content, running tests, sending emails. |

`basic` visibility exposes name + description to org/subaccount tiers but keeps the full instructions and tool definition at the system tier. A third value (`full`) exists but should only be used when an org admin genuinely needs to see the complete body (currently no skill is marked `full`).

### The app-foundational set (16 skills)

These are always `visibility: none`:

| Category | Skills |
|----------|--------|
| Task board primitives | `add_deliverable`, `create_task`, `move_task`, `reassign_task`, `update_task` |
| Workspace memory & cross-agent state | `read_workspace`, `write_workspace`, `update_memory_block` |
| HITL & orchestration | `request_approval`, `spawn_sub_agents` |
| Cascading context data sources | `read_data_source` |
| Playbook Studio tools | `playbook_read_existing`, `playbook_validate`, `playbook_simulate`, `playbook_estimate_cost`, `playbook_propose_save` |

Every other skill in `server/skills/` is `visibility: basic` by default.

### The distinguishing test: internal state vs external integration

Skill names containing `read_` or `write_` are not automatically app-foundational. The test is whether the skill reads/writes **platform-internal state** or **customer-owned external state**:

| Internal (app-foundational, `none`) | External (business, `basic`) |
|-------------------------------------|------------------------------|
| `read_workspace` — reads the platform's task board + memory tables | `read_campaigns` — reads Meta/Google Ads via integration |
| `write_workspace` — writes to the platform's own tables | `read_crm` — reads HubSpot/Salesforce via integration |
| `update_memory_block` — writes to the shared memory primitive | `read_docs` — reads Notion/Confluence via integration |
| `read_data_source` — reads cascading context attachments | `read_revenue` — reads Stripe/billing via integration |
| | `read_expenses` — reads accounting system via integration |
| | `read_inbox` — reads Gmail/Outlook via integration |

`read_inbox` specifically is easy to misclassify because the name suggests "the agent's internal inbox," but the underlying implementation reads an external email provider (gmail/outlook) via a connected `integration_connections` row. It is structurally identical to `read_crm` and `read_campaigns` — a customer-configurable external data source — so it belongs in the `basic` bucket alongside them.

### Where the rule lives

| File | Role |
|------|------|
| [`scripts/lib/skillClassification.ts`](../scripts/lib/skillClassification.ts) | Single source of truth for the classification. Exports `APP_FOUNDATIONAL_SKILLS`, `FULL_VISIBILITY_EXCEPTIONS`, `classifySkill(slug)`, and `desiredVisibilityFor(slug)`. |
| [`scripts/apply-skill-visibility.ts`](../scripts/apply-skill-visibility.ts) | Bulk-applies the classification to every `.md` file. Run via `npm run skills:apply-visibility` (add `--dry-run` to preview). |
| [`scripts/verify-skill-visibility.ts`](../scripts/verify-skill-visibility.ts) | CI gate. Fails if any file is missing a `visibility:` key, carries a legacy `isVisible:` key, or has a value that doesn't match `classifySkill()`. Run via `npm run skills:verify-visibility`. |
| [`scripts/seed.ts`](../scripts/seed.ts) preflight | The master seed script calls the same verification logic before Phase 1, so a seed refuses to run against a codebase with drifted skill frontmatter. |

### Adding a new skill

1. Drop the `.md` file in `server/skills/` with frontmatter including at least `name`, `slug`, `description`. The `visibility:` line is optional at this point.
2. If the skill is app-foundational (task/workspace/HITL/orchestration infrastructure), add its slug to `APP_FOUNDATIONAL_SKILLS` in `scripts/lib/skillClassification.ts`.
3. Run `npm run skills:apply-visibility` — it will set the `visibility:` frontmatter to `none` or `basic` based on the classification.
4. Commit the skill file AND the classification edit (if you added to `APP_FOUNDATIONAL_SKILLS`) in the same PR. The CI gate will catch drift on subsequent PRs.

### Why this matters

Visibility is not cosmetic — it controls what org admins see in the skill-management UI. Exposing `read_workspace` or `create_task` as manageable skills would confuse org admins who cannot meaningfully configure them (they are prerequisites for every agent, not options). Hiding them keeps the org UI focused on the capabilities customers actually pay for. Conversely, hiding `draft_ad_copy` or `analyse_financials` would hide the agent's actual value. The classification rule enforces this separation mechanically so it cannot drift over time.

---

**End of Brief — v6.0**






