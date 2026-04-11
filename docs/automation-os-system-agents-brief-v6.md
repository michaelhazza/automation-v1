# Automation OS — System Agents Master Brief

**Architecture, Roles, Skill Wiring & Build Sequence**

| | |
|---|---|
| **Version** | 6.0 |
| **Date** | April 2026 |
| **Status** | Living document — source of truth for all system agent design decisions |
| **Predecessor** | v5.0 (April 2026) |

---

## Table of Contents

1. [Changes from v5.0](#1-changes-from-v50)
2. [Overview](#2-overview)
3. [Organisational Structure](#3-organisational-structure)
4. [Gate Model Reference](#4-gate-model-reference)
5. [Full Agent Roster](#5-full-agent-roster)
6. [Build Sequence](#6-build-sequence)
7. [Product Development Team Architecture](#7-product-development-team-architecture)
8. [Agent 1 — Orchestrator (COO)](#8-agent-1--orchestrator-coo)
9. [Agent 2 — Business Analyst](#9-agent-2--business-analyst)
10. [Agent 3 — Dev Agent](#10-agent-3--dev-agent)
11. [Agent 4 — QA Agent](#11-agent-4--qa-agent)
12. [Agent 5 — Support Agent](#12-agent-5--support-agent)
13. [Agent 6 — Social Media Agent](#13-agent-6--social-media-agent)
14. [Agent 7 — Ads Management Agent](#14-agent-7--ads-management-agent)
15. [Agent 8 — Email Outreach Agent](#15-agent-8--email-outreach-agent)
16. [Agent 9 — Strategic Intelligence Agent](#16-agent-9--strategic-intelligence-agent)
17. [Agent 10 — Finance Agent](#17-agent-10--finance-agent)
18. [Agent 11 — Content/SEO Agent](#18-agent-11--contentseo-agent)
19. [Agent 12 — Client Reporting Agent](#19-agent-12--client-reporting-agent)
20. [Agent 13 — Onboarding Agent](#20-agent-13--onboarding-agent)
21. [Agent 14 — CRM/Pipeline Agent](#21-agent-14--crmpipeline-agent)
22. [Agent 15 — Knowledge Management Agent](#22-agent-15--knowledge-management-agent)
23. [Agent 16 — Portfolio Health Agent](#23-agent-16--portfolio-health-agent)
24. [Appendix A — Skill → Agent Cross-Reference](#appendix-a--skill--agent-cross-reference)
25. [Appendix B — Skill Wiring Audit (v6.0)](#appendix-b--skill-wiring-audit-v60)
26. [Appendix C — Source of Truth & Drift Protocol](#appendix-c--source-of-truth--drift-protocol)
27. [Appendix D — Skill Visibility Rule](#appendix-d--skill-visibility-rule)

---

<!-- SECTIONS APPENDED BELOW -->

## 1. Changes from v5.0

v6.0 reconciles the brief with what shipped in PRs #98-#102 and follow-ups. This is a reality-sync release, not a redesign.

1. **Sixteen agents on disk, not fifteen.** The Portfolio Health Agent operates at `executionScope: org`, reports to `null`, and sits outside the business-team hierarchy.
2. **Schedules collapsed to on-demand for most agents.** Only four agents retain cron schedules: `orchestrator` (06:00 and 20:00), `qa` (02:00), `portfolio-health-agent` (every 4 hours).
3. **Models simplified.** Opus is used only for Orchestrator and Dev. Strategic Intelligence and Onboarding were downgraded to Sonnet during build.
4. **Default gate is `review` for the thirteen business agents.** Scheduled agents (Orchestrator, QA, Portfolio Health) default to `auto`. Per-skill overrides still apply.
5. **All business agents share a standard task-management skill set:** `create_task` / `move_task` / `update_task` / `add_deliverable` / `request_approval` / `read_workspace` / `write_workspace`. Portfolio Health Agent is the one exception — it operates at org scope and uses `read_org_insights` / `write_org_insight` instead. See Appendix A for the architectural reason.
6. **Skill inventory is 90 files, with 4 genuine orphans now resolved.** 10 of the initially-flagged 14 unwired skills were actually wired to non-company agents (Reporting Agent, Playbook Author) via the master seed. The 4 genuine orphans: `read_inbox` wired to Support Agent; `update_memory_block` wired to Orchestrator; `trigger_process.md` deleted (no runtime handler); `read_data_source` registry entry added — runtime now complete and the skill is available as an opt-in primitive. See Appendix B.
7. **All 15 business agents report to the Orchestrator.** The Orchestrator is the only agent reporting to the human.
8. **Ads Management block gate scope:** only `increase_budget` and `pause_campaign` carry `block`. Everything else in Ads is `review`.
9. **Revision loop caps unchanged** from v5.0 (BA spec: 3 rounds; Dev plan-gap: 2; code fix-review: 3; QA bug-fix: 3).
10. **Source-of-truth convention:** `companies/automation-os/agents/<slug>/AGENTS.md` is authoritative. See Appendix C.

---

## 2. Overview

Automation OS runs its own business on the platform it builds. The sixteen system agents are the first-customer team: they build the platform, run its commercial operations, monitor its clients, and file bugs against themselves.

The network operates asynchronously. Agents communicate through shared state: **workspace memory** (context and insights), the **task board** (work items and handoffs), **Orchestrator directives** (daily coordination), and the **HITL review queue** (any action with external or irreversible blast radius).

The product development team (Orchestrator, Business Analyst, Dev, QA) are members of the same network as every other agent — same infrastructure, same HITL gates, same workspace memory. They are built first because they are needed to build the platform itself.

**v5.0 to v6.0 integration decisions (carried forward):**
- **Business Analyst is a full agent** because its outputs are independently consumed by both Dev and QA. Folding it into the Orchestrator would contaminate the coordination layer with product-thinking context.
- **Architect and Builder merge into the Dev Agent** via enforced phase sequence (plan → spec → ux → implement → self-review → submit).
- **Tech-spec, UX review, and PR review are skills** (`draft_tech_spec`, `review_ux`, `review_code`) invoked by Dev at the appropriate phase.
- **Triage is a skill** (`triage_intake`) available to Orchestrator and Business Analyst.
- **System Test Analyst patterns are absorbed into QA** via Gherkin traceability and structured failure classification (APP BUG / TEST BUG / ENVIRONMENT).

---

## 3. Organisational Structure

The human operator is the CEO. The Orchestrator is the COO. All 15 business agents report to the Orchestrator.

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

The Portfolio Health Agent reports to `null`. It runs at `executionScope: org`, writes to org-level memory only, and is a monitoring surface — not a business-team member.

---

## 4. Gate Model Reference

| Gate | Behaviour | Used For |
|------|-----------|----------|
| `auto` | Executes immediately, logged | Reads, internal analysis, memory updates, board writes, test runs, codebase reads |
| `review` | Creates review item, pauses until approved | Outbound communications, code patches, spec documents, CRM writes, financial records, ad copy/bid changes, published content |
| `block` | Never executes autonomously | Budget increases, campaign pauses, production deploys, merges, account deletion |

Each agent has a **default gate** in its frontmatter; individual skills override per-invocation. Scheduled background workers (Orchestrator, QA, Portfolio Health) default to `auto`. All thirteen business agents default to `review`.

---

## 5. Full Agent Roster

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

> All values are read directly from AGENTS.md frontmatter files. If this table conflicts with the code, the code is right.

---

## 6. Build Sequence

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

## 7. Product Development Team Architecture

### Development pipeline

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

| Loop | Cap | Escalation |
|------|-----|------------|
| BA spec revisions | 3 rounds | Dev Agent flags ambiguity to board, escalates to human |
| Dev plan-gap reports | 2 rounds | Dev Agent escalates with gap summary |
| Code fix-review cycles | 3 rounds | Dev Agent escalates with blocking issues |
| QA bug-fix cycles | 3 rounds | QA Agent escalates, blocks release |

### Artifact handoff convention

Agents communicate through workspace memory and board task attachments, not shared context.

| Artifact | Written By | Read By | Location |
|----------|-----------|---------|----------|
| Requirements spec (user stories + Gherkin) | BA Agent | Dev Agent, QA Agent | Board task attachment or `workspace_memories` |
| Architecture plan | Dev Agent | Dev Agent (phase 2), QA Agent | Board task attachment |
| Technical spec (OpenAPI/schema) | Dev Agent | Dev Agent, QA Agent | Board task attachment |
| Code patch (diff) | Dev Agent | Human reviewer | Review queue |
| Test results | QA Agent | Orchestrator, Dev Agent | `workspace_memories` |
| Bug reports | QA Agent | Dev Agent, Orchestrator | Board tasks |

---

## 8. Agent 1 — Orchestrator (COO)

| | |
|---|---|
| **Slug** | `orchestrator` |
| **Reports to** | null |
| **Model** | `claude-opus-4-6` |
| **Schedule** | `0 6,20 * * *` |
| **Default gate** | auto |
| **Phase** | MVP |

The Orchestrator is the operational backbone of the agent network. It has visibility across everything — open tasks, recent agent activity, overnight memory, unreviewed actions, failed jobs — and synthesises this into a prioritised daily directive each morning and an evening summary each night. It does not execute: no emails, no content, no API calls. Its entire output is a structured directive injected into every other agent's context.

**Responsibilities:** read all workspace memory, task board state, and open review items; identify cross-agent patterns (recurring support issues, stalled tasks, budget anomalies, test failures); write morning directive and evening summary; flag systemic issues for human attention; adjust priorities in response to business signals; invoke `triage_intake` for new ideas or bugs arriving outside normal channels.

### Wired skills

| Skill | Gate | Purpose |
|-------|------|---------|
| `read_workspace` | auto | Full read of memory, tasks, recent runs, open review items |
| `write_workspace` | auto | Write directives and summaries to memory |
| `update_memory_block` | review | Update cross-agent shared memory blocks |
| `create_task` | auto | Create coordination tasks on the board |
| `move_task` | auto | Update task status as part of directive logic |
| `update_task` | auto | Edit task content when coordinating |
| `reassign_task` | auto | Route a task to a different agent |
| `spawn_sub_agents` | auto | Trigger parallel sub-task execution (max 2-3 independent tracks) |
| `triage_intake` | auto | Capture and route incoming ideas or bugs |
| `request_approval` | review | Escalate coordination decisions requiring human input |

**Must not:** send external communications; write or propose code; modify integration credentials; approve or reject review items; take any action with financial consequences.

**Outputs:** `orchestrator_directives` record written to DB each run and injected into all agent prompts; evening summary in `workspace_memories`; coordination tasks on the board; escalation flags for systemic failures.

---

## 9. Agent 2 — Business Analyst

| | |
|---|---|
| **Slug** | `business-analyst` |
| **Reports to** | orchestrator |
| **Model** | `claude-sonnet-4-6` |
| **Schedule** | on-demand |
| **Default gate** | review |
| **Phase** | MVP |

The BA is the translation layer between human intent and machine-executable requirements. It turns vague ideas and board tasks into user stories with Gherkin acceptance criteria that Dev can implement and QA can test against. It is a separate agent — not a skill inside the Orchestrator — because its outputs are independently consumed by two downstream agents.

The BA operates in two modes: **requirements mode** (produces a spec from a brief) and **clarification mode** (surfaces blocking questions via `ask_clarifying_question` before writing). The `review` gate on the spec output is non-negotiable — no spec drives engineering effort without human sign-off.

**Responsibilities:** read board tasks and Orchestrator directives; read the codebase for feasibility context; clarify scope ambiguities before writing; produce INVEST-format user stories with Given/When/Then Gherkin ACs including negative scenarios; rank open questions by risk (high blocks the spec); produce a Definition of Done checklist; submit for human review before notifying Dev.

### Wired skills

| Skill | Gate | Purpose |
|-------|------|---------|
| `read_workspace` | auto | Board tasks, Orchestrator directives, product context |
| `read_codebase` | auto | Technical feasibility context |
| `write_workspace` | auto | Approved specs and task record updates |
| `create_task` | auto | Clarification tasks for high-risk questions |
| `move_task` / `update_task` / `add_deliverable` | auto | Standard board ops |
| `ask_clarifying_question` | auto | Surface a blocking question |
| `draft_requirements` | auto | Internal spec drafting (INVEST + Gherkin) |
| `write_spec` | review | Submit spec for human approval — HITL gate |
| `web_search` | auto | Research conventions and competitor behaviour |
| `triage_intake` | auto | Capture out-of-scope ideas or bugs |
| `request_approval` | review | Escalate spec decisions |

**Must not:** pass a spec to Dev before human review; invent requirements; make architecture or implementation decisions; write or review code; bypass the review gate on spec output.

**Outputs:** requirements spec in review queue (user stories, Gherkin ACs, open questions, DoD); approved spec in `workspace_memories` with reference ID `SPEC-task-N-vX`; board task updated to `spec-approved`; clarification tasks for high-risk questions.

---

## 10. Agent 3 — Dev Agent

| | |
|---|---|
| **Slug** | `dev` |
| **Reports to** | orchestrator |
| **Model** | `claude-opus-4-6` |
| **Schedule** | on-demand |
| **Default gate** | review (code), block (deploys, merges) |
| **Phase** | MVP |

The Dev Agent is a developer embedded in the same agent network as every other team member — it reads the same workspace memory, sees QA bug reports on the board, and gets directed by the Orchestrator. It incorporates architect-builder discipline without a separate agent: before writing code on any non-trivial task it must produce an architecture plan. The discipline is enforced by the system prompt, not by an architecture agent.

Every code change goes through the HITL review queue before touching the codebase. The agent proposes; a human decides.

### Task classification

| Classification | Criteria | Planning Requirement |
|----------------|----------|---------------------|
| **Trivial** | Single file, obvious fix, no API impact | Skip architecture plan; implement + self-review |
| **Standard** | 2-5 files, clear requirements, no schema changes | `draft_architecture_plan` internal; no review gate |
| **Significant** | Schema changes, new API endpoints, or UI flows | `draft_architecture_plan` submitted for human review before coding |
| **Major** | New domain, cross-cutting concerns, external integrations | `draft_architecture_plan` + `draft_tech_spec` submitted; no coding until both approved |

### Wired skills

| Skill | Gate | Purpose |
|-------|------|---------|
| `read_codebase` | auto | Read files from projectRoot |
| `search_codebase` | auto | Grep and glob across the project |
| `read_workspace` | auto | Bug reports, QA findings, BA specs, Orchestrator directives |
| `write_workspace` | auto | Implementation notes and change summaries |
| `draft_architecture_plan` | auto | Internal: plan before writing code |
| `draft_tech_spec` | auto | Internal: API/schema specifications for significant changes |
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

When an ambiguity cannot be resolved from the spec, codebase, or workspace memory, raise a PLAN_GAP report rather than improvising. Write to the board task as a comment and set status to `blocked`. Maximum 2 rounds before escalating directly to the human.

```
PLAN_GAP REPORT
Task: [task reference]
Gap: [what is missing or ambiguous]
Decision needed: [what choice must be made]
Options considered: [approaches with trade-offs]
Blocked chunk: [which part of implementation is blocked]
```

**Must not:** apply code without an approved review item; run shell commands without approval; access files outside `projectRoot`; merge or deploy (always manual block gate); modify env vars or secrets without explicit instruction; skip architecture planning for Significant/Major tasks; improvise past a plan gap.

**Outputs:** architecture plans in review queue (Significant/Major tasks); technical specs in review queue (Major tasks); code patches in review queue with diff, reasoning, self-review results, and affected files; PLAN_GAP reports as board comments; PRs from batches of approved patches; implementation summaries in workspace memory.

---

## 11. Agent 4 — QA Agent

| | |
|---|---|
| **Slug** | `qa` |
| **Reports to** | orchestrator |
| **Model** | `claude-sonnet-4-6` |
| **Schedule** | `0 2 * * *` (daily regression) + on-demand |
| **Default gate** | auto |
| **Phase** | MVP |

The QA Agent is the closing sensor in the development loop. Two defining disciplines:

**Gherkin traceability:** every test case maps to a specific BA Gherkin AC. An untraceable test is noise.

**Structured failure classification:** every failure is classified as APP BUG, TEST BUG, or ENVIRONMENT — preventing the Dev Agent from chasing phantom failures caused by test infrastructure.

### Wired skills

| Skill | Gate | Purpose |
|-------|------|---------|
| `derive_test_cases` | auto | Extract test scenarios from Gherkin ACs |
| `run_tests` | auto | Execute configured test suite |
| `write_tests` | auto | Write or update test files |
| `run_playwright_test` | auto | Execute a Playwright end-to-end test |
| `capture_screenshot` | auto | Visual QA validation |
| `analyze_endpoint` | auto | Hit API endpoints, validate status, schema, timing |
| `report_bug` | auto | Create structured board task with severity and repro steps |
| `read_codebase` | auto | Read test files and source for failure context |
| `search_codebase` | auto | Find relevant code for a failing test |
| `read_workspace` | auto | Dev implementation notes, BA specs, Orchestrator context |
| `write_workspace` | auto | Test insights, fragility signals, coverage summaries |
| `create_task` / `move_task` / `update_task` / `add_deliverable` | auto | Standard board ops |
| `request_approval` | review | Escalate when test run caps hit |

### Failure classification protocol

| Classification | Definition | Action |
|----------------|-----------|--------|
| **APP BUG** | Application code is broken; test correctly identifies a defect | Create board task with severity, repro steps, Gherkin AC reference. Do not fix. |
| **TEST BUG** | Test logic is incorrect; application behaviour is as intended | Fix test immediately. Log in workspace memory. No board task. |
| **ENVIRONMENT** | Failure caused by test environment, not code or test logic | Note in workspace memory. Flag in run summary. Do not escalate unless recurring. |

When uncertain, default to APP BUG and note the uncertainty.

**Must not:** write to application source (test files only); send external communications; close or resolve bugs it raised; approve code changes; write tests not traceable to a Gherkin AC.

**Outputs:** test cases in workspace memory with spec reference ID; structured bug reports on the board (severity, classification, confidence, repro steps, Gherkin AC reference); test run summaries in workspace memory; daily regression report for Orchestrator directive; fragility and coverage insights in memory.

---

## 12. Agent 5 — Support Agent

| | |
|---|---|
| **Slug** | `support-agent` |
| **Reports to** | orchestrator |
| **Model** | `claude-sonnet-4-6` |
| **Schedule** | on-demand |
| **Default gate** | review (all outbound) |
| **Phase** | 2 |

The Support agent handles first-contact triage: reads, classifies, and drafts responses to inbound tickets. A human approves every reply before it sends. Over time, as review history builds, consistently correct categories can be promoted to `auto`. The Support agent is also the primary product quality sensor — it sees bugs before they reach the board.

### Wired skills

| Skill | Gate | Purpose |
|-------|------|---------|
| `read_workspace` | auto | Orchestrator directives, customer context, previous resolutions |
| `write_workspace` | auto | Pattern insights and resolution notes |
| `read_codebase` | auto | Code references when a ticket cites a specific feature |
| `read_inbox` | auto | Read emails from the connected inbox provider (gmail/outlook) |
| `classify_email` | auto | Tag by type, urgency, and sentiment |
| `search_knowledge_base` | auto | Reference docs, FAQs, previous resolutions |
| `draft_reply` | auto | Generate reply for human review |
| `send_email` | auto | Send reply (gated upstream via `request_approval`) |
| `request_approval` | review | HITL gate on all outbound replies |
| `move_task` / `update_task` / `add_deliverable` | auto | Standard board ops |

**Must not:** send any communication without human review; promise features, refunds, or commitments; close or archive tickets automatically; access billing data beyond what is needed for the ticket.

**Outputs:** drafted replies in review queue; recurring pattern entries in workspace memory for the Orchestrator morning directive; escalation flags for tickets needing immediate human attention.

---

## 13. Agent 6 — Social Media Agent

| | |
|---|---|
| **Slug** | `social-media-agent` |
| **Reports to** | orchestrator |
| **Model** | `claude-sonnet-4-6` |
| **Schedule** | on-demand |
| **Default gate** | review (all publishing) |
| **Phase** | 3 |

Maintains an informed social presence that reflects what is actually happening in the business — not generic content. Reads workspace context before writing: recent product updates, customer wins, active campaigns, competitor moves.

### Wired skills

| Skill | Gate | Purpose |
|-------|------|---------|
| `read_workspace` | auto | Orchestrator directives, brand voice, recent updates |
| `write_workspace` | auto | Performance insights and content ideas |
| `draft_post` | auto | Generate platform-specific content for review |
| `publish_post` | review | Publish after human approval |
| `read_analytics` | auto | Read performance data from connected social platforms |
| `request_approval` | review | HITL gate on publish actions |
| `move_task` / `update_task` / `add_deliverable` | auto | Standard board ops |

> `web_search` is not wired — trend research comes via the Orchestrator directive or handoff from Strategic Intelligence. Scheduled publishing uses `publish_post` with a timestamp parameter.

**Must not:** publish without human approval; engage with replies, comments, or DMs; run paid promotion on organic posts; post about legal matters, personnel, or incidents.

**Outputs:** drafted posts in review queue; performance summaries in workspace memory; content ideas as board task deliverables.

---

## 14. Agent 7 — Ads Management Agent

| | |
|---|---|
| **Slug** | `ads-management-agent` |
| **Reports to** | orchestrator |
| **Model** | `claude-sonnet-4-6` |
| **Schedule** | on-demand |
| **Default gate** | review (bid/copy changes), block (budget, pause) |
| **Phase** | 3 |

Reads campaign performance, forms a clear view on what is working, and proposes specific changes with explicit reasoning. A human reviews before anything changes. `increase_budget` and `pause_campaign` are the only `block`-gated skills in the entire skill library — budget cannot be un-spent and mid-promotion pauses cause real damage.

### Wired skills

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

**Must not:** change budgets without explicit human instruction; pause or resume campaigns; create new campaigns; access billing or payment methods.

**Outputs:** performance analysis in workspace memory; proposed bid and copy changes in review queue; ad copy variants for human selection; anomaly flags as board deliverables.

---

## 15. Agent 8 — Email Outreach Agent

| | |
|---|---|
| **Slug** | `email-outreach-agent` |
| **Reports to** | orchestrator |
| **Model** | `claude-sonnet-4-6` |
| **Schedule** | on-demand |
| **Default gate** | review (all outbound) |
| **Phase** | 3 |

Handles research, sequencing, and drafting at scale. Every email that leaves the system goes through a human first. Sequences are drafted in full before the first email sends, so the human reviewer evaluates the entire flow upfront.

### Wired skills

| Skill | Gate | Purpose |
|-------|------|---------|
| `read_workspace` | auto | ICP criteria, campaign priorities, Orchestrator directives |
| `write_workspace` | auto | Prospect insights, performance data, conversion signals |
| `enrich_contact` | auto | Pull contact data from enrichment integrations |
| `draft_sequence` | auto | Build full multi-touch email sequence for review |
| `send_email` | auto | Send email (individually gated via `request_approval`) |
| `update_crm` | review | Update contact records — human approves |
| `request_approval` | review | HITL gate on every email send |
| `move_task` / `update_task` / `add_deliverable` | auto | Standard board ops |

**Must not:** send any email without human approval; contact anyone on a suppression list; impersonate a named individual without explicit configuration; draft outreach for regulated industries without compliance guidance in workspace memory.

**Outputs:** full sequences in review queue with prospect context; prospect lists as board deliverables; response alerts and hot lead flags as board updates; performance insights in memory.

---

## 16. Agent 9 — Strategic Intelligence Agent

| | |
|---|---|
| **Slug** | `strategic-intelligence-agent` |
| **Reports to** | orchestrator |
| **Model** | `claude-sonnet-4-6` |
| **Schedule** | on-demand |
| **Default gate** | review |
| **Phase** | 4 |

The platform's thinking layer — merges Business Planning and Competitor Research into one agent. Does not act. Synthesises signals from Finance, Ads, Support, and Email Outreach into structured insight. Its most important function is connecting cross-domain dots: a revenue dip, rising CPAs, and more onboarding complaints are three signals that together suggest a conversion problem working through the funnel.

### Wired skills

| Skill | Gate | Purpose |
|-------|------|---------|
| `read_workspace` | auto | Full access to memory, board, and all agent run outputs |
| `write_workspace` | auto | Strategic insights, competitor profiles, summaries |
| `web_search` | auto | Competitor news, market context, industry signals |
| `generate_competitor_brief` | auto | Structured intelligence brief: positioning, pricing, moves |
| `synthesise_voc` | auto | Synthesise Voice of Customer data into themes |
| `request_approval` | review | Escalate recommendations requiring human decision |
| `move_task` / `update_task` / `add_deliverable` | auto | Standard board ops |

> `fetch_url` is wired via the master seed to the Reporting Agent template (Appendix B Group A) — not currently to Strategic Intelligence. Strategic recommendations surface via `add_deliverable`, not `create_task`.

**Must not:** take any external action; contact competitor companies; access non-public competitor data; make financial projections that could be mistaken for accounting records.

**Outputs:** strategic recommendations as task deliverables; daily cross-domain analysis in workspace memory; updated competitor profiles; weekly summary in Orchestrator directive.

---

## 17. Agent 10 — Finance Agent

| | |
|---|---|
| **Slug** | `finance-agent` |
| **Reports to** | orchestrator |
| **Model** | `claude-sonnet-4-6` |
| **Schedule** | on-demand |
| **Default gate** | review (record changes), auto (reads and analysis) |
| **Phase** | 4 |

Provides a continuous, accurate financial picture by syncing from connected integrations and writing results to workspace memory where the Orchestrator and Strategic Intelligence can read them. Its most valuable function is near-real-time anomaly detection: doubled subscriptions, failed payments, overdue retainers — surfaced within hours, not at month-end.

### Wired skills

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

**Must not:** initiate any payment or transfer; modify financial records without human review; produce anything that could be mistaken for formal accounting or tax advice; surface raw financial data to non-admin users.

**Outputs:** financial snapshot in workspace memory each run; anomaly flags as task deliverables; proposed record corrections in review queue; daily financial summary in Orchestrator directive.

---

## 18. Agent 11 — Content/SEO Agent

| | |
|---|---|
| **Slug** | `content-seo-agent` |
| **Reports to** | orchestrator |
| **Model** | `claude-sonnet-4-6` |
| **Schedule** | on-demand |
| **Default gate** | review (all published content) |
| **Phase** | 4 |

Handles long-form content: blog posts, SEO articles, case studies, landing page copy, and lead magnets. The Social Media Agent handles short-form. Reads workspace context, researches the topic, drafts, and submits for human review before anything publishes.

### Wired skills

| Skill | Gate | Purpose |
|-------|------|---------|
| `read_workspace` | auto | Brand voice, content calendar, Orchestrator directives |
| `write_workspace` | auto | Performance insights, content briefs |
| `web_search` | auto | Topic research, competitor content, keyword discovery |
| `draft_content` | auto | Long-form draft with headings, body, and SEO recommendations |
| `audit_seo` | auto | On-page SEO audit |
| `create_lead_magnet` | review | Produce a lead magnet asset — HITL |
| `update_page` | auto | Update existing page HTML, meta, or form config |
| `publish_page` | auto | Publish a draft page (gated upstream via `request_approval`) |
| `request_approval` | review | HITL gate on publish actions |
| `move_task` / `update_task` / `add_deliverable` | auto | Standard board ops |

**Must not:** publish without human review; modify published pages without explicit task reference; scrape competitor copy verbatim; auto-rewrite existing content without a deliberate brief.

**Outputs:** long-form drafts in review queue with SEO analysis; lead magnet assets in review queue; published pages (after approval); content performance summaries in workspace memory.

---

## 19. Agent 12 — Client Reporting Agent

| | |
|---|---|
| **Slug** | `client-reporting-agent` |
| **Reports to** | orchestrator |
| **Model** | `claude-sonnet-4-6` |
| **Schedule** | on-demand |
| **Default gate** | review (all report delivery) |
| **Phase** | 5 |

Turns raw performance data from Ads, Social, Finance, and CRM into client-ready narratives with executive summaries. Submits for human approval before delivery.

### Wired skills

| Skill | Gate | Purpose |
|-------|------|---------|
| `read_workspace` | auto | Client metrics, campaign results, context |
| `write_workspace` | auto | Report drafts and delivery records |
| `draft_report` | auto | Produce structured client report with exec summary |
| `deliver_report` | review | Send approved report via configured channel — HITL |
| `request_approval` | review | HITL gate on report delivery |
| `move_task` / `update_task` / `add_deliverable` | auto | Standard board ops |

**Must not:** deliver without human approval; invent metrics not in source data; produce reports for clients without an active engagement record.

**Outputs:** draft reports in review queue; delivered reports logged as board deliverables; report templates in workspace memory.

---

## 20. Agent 13 — Onboarding Agent

| | |
|---|---|
| **Slug** | `onboarding-agent` |
| **Reports to** | orchestrator |
| **Model** | `claude-sonnet-4-6` |
| **Schedule** | on-demand (per new client) |
| **Default gate** | review (all external setup) |
| **Phase** | 5 |

Guides new clients through integration setup, permission grants, and initial configuration. Every configuration step requires HITL approval — credentials are never stored without human sign-off. Currently the leanest wired agent (7 skills); richer workflows will be added in Phase 5 build.

### Wired skills

| Skill | Gate | Purpose |
|-------|------|---------|
| `read_workspace` | auto | Onboarding checklists, client context, previous configurations |
| `write_workspace` | auto | Onboarding progress and configuration notes |
| `configure_integration` | review | Integration setup with human approval — HITL |
| `request_approval` | review | HITL gate on every configuration decision |
| `move_task` / `update_task` / `add_deliverable` | auto | Standard board ops |

**Must not:** store integration credentials without human approval; complete onboarding steps on behalf of the client; skip a configuration step without explicit deferral.

**Outputs:** integration configurations in review queue; onboarding progress as board deliverables; configuration notes in workspace memory.

---

## 21. Agent 14 — CRM/Pipeline Agent

| | |
|---|---|
| **Slug** | `crm-pipeline-agent` |
| **Reports to** | orchestrator |
| **Model** | `claude-sonnet-4-6` |
| **Schedule** | on-demand |
| **Default gate** | review (all CRM writes) |
| **Phase** | 5 |

Keeps deal data current, identifies stalled opportunities, drafts follow-ups, and flags churn risk. Every CRM write goes through HITL review.

### Wired skills

| Skill | Gate | Purpose |
|-------|------|---------|
| `read_workspace` | auto | ICP criteria, pipeline rules, Orchestrator directives |
| `write_workspace` | auto | Pipeline insights, velocity metrics, at-risk account notes |
| `read_crm` | auto | Pull contact, deal, and pipeline data |
| `analyse_pipeline` | auto | Velocity, stage conversion, stale deal analysis |
| `detect_churn_risk` | auto | Score existing accounts for churn risk from CRM signals |
| `draft_followup` | auto | Draft personalised follow-up emails |
| `send_email` | auto | Send follow-up (gated via `request_approval`) |
| `update_crm` | review | Write CRM updates — human approves |
| `request_approval` | review | HITL gate on CRM writes and outbound emails |
| `move_task` / `update_task` / `add_deliverable` | auto | Standard board ops |

**Must not:** write to CRM without human approval; mark deals won or lost autonomously; delete CRM records; send outreach to contacts on a suppression list.

**Outputs:** pipeline velocity and conversion analysis in workspace memory; draft follow-ups in review queue; churn risk flags as board deliverables; proposed CRM updates in review queue.

---

## 22. Agent 15 — Knowledge Management Agent

| | |
|---|---|
| **Slug** | `knowledge-management-agent` |
| **Reports to** | orchestrator |
| **Model** | `claude-sonnet-4-6` |
| **Schedule** | on-demand |
| **Default gate** | review (doc updates) |
| **Phase** | 5 |

Keeps internal documentation aligned with code and process reality. Reads docs, diffs them against current behaviour, and proposes targeted updates through HITL review. Also authors new documentation when gaps are identified.

### Wired skills

| Skill | Gate | Purpose |
|-------|------|---------|
| `read_workspace` | auto | Documentation inventory, recent changes, open gaps |
| `write_workspace` | auto | Doc change notes and gap reports |
| `read_docs` | auto | Retrieve documentation pages from connected doc source |
| `propose_doc_update` | review | Propose a doc update as a diff — HITL |
| `write_docs` | review | Apply an approved doc update — HITL |
| `request_approval` | review | HITL gate on doc changes |
| `move_task` / `update_task` / `add_deliverable` | auto | Standard board ops |

**Must not:** publish or modify documentation without human approval; delete existing documentation; author documentation for features that do not exist.

**Outputs:** proposed doc updates in review queue (diff-style); gap reports in workspace memory; new documentation in review queue.

---

## 23. Agent 16 — Portfolio Health Agent

| | |
|---|---|
| **Slug** | `portfolio-health-agent` |
| **Reports to** | null |
| **Model** | `claude-sonnet-4-6` |
| **Schedule** | `*/4 * * *` (every 4 hours) |
| **Default gate** | auto |
| **Execution scope** | `org` (not `subaccount`) |
| **Phase** | special (ships independently) |

The only system agent operating at organisation scope. Runs against all subaccounts in an org, computes health scores, detects anomalies, scores churn risk, and generates portfolio-wide intelligence briefings. Does not coordinate with the Orchestrator — writes to a separate org-level memory surface that the human operator and Strategic Intelligence Agent can read.

Deliberately outside the business-team hierarchy because it crosses subaccount boundaries. Giving it a place in the Orchestrator-led team would muddle the per-subaccount scoping model that every other agent respects.

### Wired skills

| Skill | Gate | Purpose |
|-------|------|---------|
| `compute_health_score` | auto | Calculate composite health score (0-100) per subaccount |
| `detect_anomaly` | auto | Compare current metrics against historical baseline |
| `compute_churn_risk` | auto | Run portfolio-level churn model across all subaccounts |
| `generate_portfolio_report` | auto | Structured intelligence briefing across the portfolio |
| `query_subaccount_cohort` | auto | Read board health and memory across cohorts |
| `read_org_insights` | auto | Query cross-subaccount insights from org-level memory |
| `write_org_insight` | auto | Store cross-subaccount patterns in org-level memory |
| `trigger_account_intervention` | auto | Propose intervention action (HITL-gated upstream) |

> **Why this agent has a different skill set.** Every other agent in the roster is wired with the standard task-management bundle (`read_workspace` / `write_workspace` / `move_task` / `update_task` / `request_approval`). Portfolio Health Agent is intentionally NOT — it runs at `executionScope: org`, has `subaccountId: null` at run time, and the workspace and task primitives are subaccount-scoped. The runtime explicitly throws if `read_workspace` or `write_workspace` is invoked without a subaccount context. The org-level equivalents (`read_org_insights` / `write_org_insight`) exist precisely as the architectural workaround, and the agent uses those instead. If a future change unifies the workspace surface across subaccount and org scopes, the universal bundle can be added here.

**Must not:** write to individual subaccount workspace memory; invoke business-team agents directly; make interventions without HITL approval; expose cross-subaccount data to users without org-level permissions.

**Outputs:** health scores per subaccount in org-level memory every 4 hours; anomaly flags and churn risk scores; portfolio intelligence briefings; intervention proposals routed through HITL review.

---

## Appendix A — Skill → Agent Cross-Reference

### Universal skills (all 15 business agents)

These skills are wired to every business agent — Orchestrator (1) plus the 14 subaccount-scoped business agents — for a total of **15 agents**. They form the standard task-management and workspace-memory primitive set every business agent needs.

| Skill | Gate |
|-------|------|
| `read_workspace` | auto |
| `write_workspace` | auto |
| `move_task` | auto |
| `update_task` | auto |
| `request_approval` | review |

`add_deliverable` (review) is wired to all 14 non-Orchestrator business agents. `create_task` (auto) is wired to business-analyst, dev, orchestrator, qa.

> **Portfolio Health Agent is excluded** from the universal set. It is the only agent at `executionScope: org` and uses `read_org_insights` / `write_org_insight` instead of `read_workspace` / `write_workspace`. The runtime throws if the workspace primitives are invoked without a subaccount context. See [Agent 16](#23-agent-16--portfolio-health-agent) for the architectural detail.

### Domain-specific wiring

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
| `update_memory_block` | review | orchestrator |
| `web_search` | auto | business-analyst, content-seo-agent, strategic-intelligence-agent |
| `read_inbox` | auto | support-agent |
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

> Note that `detect_churn_risk` and `compute_churn_risk` are two distinct skills with different runtime paths. `detect_churn_risk` is the CRM-signal scorer used by `crm-pipeline-agent`. `compute_churn_risk` is the portfolio-level churn model used by `portfolio-health-agent`.

---

## Appendix B — Skill Wiring Audit (v6.0)

An initial audit of `server/skills/` found 14 skills not referenced in any of the 16 company AGENTS.md files. Closer inspection found 10 were actually wired to non-company agents via the master seed script, and 4 were genuine orphans. A subsequent pre-seed audit also found one more **broken-wire** skill — `triage_intake` — that was referenced by two agents but had no runtime implementation, plus one **runtime-complete-but-unwired** skill (`create_page`). All issues are resolved in v6.0.

### Group A — Wired via master seed to the Reporting Agent (5 skills)

Not orphans. These form the toolkit for the domain-agnostic **Reporting Agent** that the master seed creates in Phase 5 as a per-client template demonstrating the pattern for client-specific agents built on top of the system skill library. See `scripts/seed.ts` Phase 5d.

| Skill | Gate | Role |
|-------|------|------|
| `fetch_paywalled_content` | auto | Phase 1 ACQUIRE — fetches content from sources behind a login |
| `fetch_url` | auto | Phase 1 ACQUIRE — public URL counterpart |
| `transcribe_audio` | auto | Phase 2 CONVERT — Whisper transcription |
| `analyse_42macro_transcript` | auto | Phase 3 ANALYSE — domain lens for 42 Macro content |
| `send_to_slack` | auto | Phase 4 PUBLISH — posts finished report to Slack |

### Group B — Wired via master seed to the Playbook Author (5 skills)

Not orphans. These are the Studio tool set for the **Playbook Author** system agent created in Phase 3 — a system-managed Studio tool runner that helps platform admins draft and validate playbook templates via chat. All five are `visibility: none` (system-admin-only tooling).

| Skill | Role |
|-------|------|
| `playbook_read_existing` | Load an existing playbook file for reference |
| `playbook_validate` | Run the Playbook DAG validator |
| `playbook_simulate` | Static analysis pass — parallelism profile and critical path |
| `playbook_estimate_cost` | Pessimistic cost estimate defaulting to max tokens and worst-case retries |
| `playbook_propose_save` | Record the validated definition for the human admin to save via the Studio button |

### Group C — Genuine orphans + broken wires (5 skills) — RESOLVED

| Skill | Resolution | Detail |
|-------|------------|--------|
| `read_inbox` | **Wired into `support-agent/AGENTS.md`** | Had a full `actionRegistry` entry and executor case but no agent referenced it. Support Agent cannot triage inbound email without it — the wire was an unfinished handoff. Fixed. |
| `update_memory_block` | **Wired into `orchestrator/AGENTS.md`** (gate: `review`) | Sprint 4/5 shared-memory primitive with a full runtime handler via `memoryBlockService`. The Orchestrator is the natural owner for cross-agent shared-state writes. HITL-gated so the Orchestrator proposes and a human confirms. |
| `trigger_process.md` | **Deleted** | No runtime handler in `skillExecutor.ts`, no entry in `actionRegistry.ts`. A stub that matched an aspirational Orchestrator prompt but was never implemented; the shipped Orchestrator uses `spawn_sub_agents` for parallel work. Removing it prevents a future author from wiring it and getting a silent no-op. |
| `read_data_source` | **Registry entry added — runtime now complete** | Previously a broken wire: the executor handler, tool implementation at `server/tools/readDataSource.ts`, and per-run limits at `server/config/limits.ts` all existed, but there was no entry in `server/config/actionRegistry.ts`, so any agent listing the skill in its frontmatter could not actually invoke it (parameter validation and gate enforcement live in the registry). v6.0 adds a full `read_data_source` entry with the correct `list` / `read` parameter schema, `topics: ['workspace']`, `defaultGateLevel: 'auto'`, and `idempotencyStrategy: 'read_only'`. The skill is now callable by any agent that adds it to its frontmatter — opt-in primitive (see Group D below). |
| `triage_intake` | **Runtime implemented in v6.0** | Speced in commit `1529a20` ("feat: add 5 v5.0 skill specs for MVP product development team") alongside `draft_architecture_plan` / `draft_tech_spec` / `review_code` / `review_ux`. The other four siblings shipped runtimes; `triage_intake` did not — leaving Orchestrator and BA frontmatters referencing a skill the executor would have rejected as unknown. v6.0 adds the missing pieces: a registry entry in `actionRegistry.ts` with the two-mode parameter schema (`mode: capture | triage`, plus `raw_input`, `input_type`, `source`, `related_task_id`, `scope`), and a full `executeTriageIntake` handler in `skillExecutor.ts`. **Capture mode** validates inputs, builds a structured description per the spec template (idea/bug/chore variants), and creates a task in the `inbox` status column via `taskService.createTask`. Bugs whose raw input matches the data-loss escalation pattern (`data loss`, `data corruption`, `corrupted`, `lost data`, etc.) are automatically promoted to `priority: urgent` with an explicit escalation marker added to the description. **Triage mode** scans `inbox` tasks lacking a triage decision marker, infers each item's type from the structured description, and returns a proposal list `{ task_id, title, type_inferred, suggested_disposition, rationale }` grouped by disposition (`Defer`/`Assess`/`Schedule`/`Close`). The skill is a *proposer* — it does not apply dispositions itself. The orchestrator or human then applies the chosen dispositions via `move_task` / `update_task`. There is a regression test for this exact flow at [`tests/trajectories/intake-triage-standard.json`](../tests/trajectories/intake-triage-standard.json) that has been waiting for the runtime since the spec landed. |

**Dangling references:** none. Every skill slug referenced in any agent frontmatter exists on disk AND has a runtime entry point.

### Group D — Runtime-complete opt-in primitives (2 skills)

These skills are intentionally not wired to any agent's frontmatter, but their full runtime is in place. They are available as opt-in primitives for any agent that needs them — adding the slug to an `agents/<slug>/AGENTS.md` `skills:` array is the only step required.

| Skill | Visibility | Why opt-in |
|-------|-----------|-----------|
| `read_data_source` | `none` | Agents that want to query a specific attached data source mid-run beyond what the cascading-context auto-load already provides. Classified as `visibility: none` (app-foundational) because the data-source surface is a run-internal platform primitive, not a customer-facing capability. |
| `create_page` | `basic` | Has a full `actionRegistry.ts` entry, an executor case in `skillExecutor.ts`, AND a worker-adapter handler — the runtime is complete and review-gated. Currently no agent wires it, but Content/SEO Agent is the natural future owner if direct page creation (rather than the existing `update_page` / `publish_page` flow against pre-existing pages) becomes a workflow requirement. Classified as `visibility: basic` because it produces customer-visible artifacts. |

### Post-resolution skill count

- Files on disk: **90** (was 91 before `trigger_process.md` deletion)
- Wired to at least one agent via `companies/automation-os/agents/` AGENTS.md: **77** (`triage_intake` wiring is now backed by a real runtime)
- Wired via master seed to the Reporting Agent: **5**
- Wired via master seed to the Playbook Author: **5**
- Runtime complete, opt-in (not pre-wired): **2** (`read_data_source`, `create_page`)
- Broken wires (skill referenced by an agent but no runtime entry point): **0**
- Unwired and dead: **0**

Every skill file on disk now has either (a) at least one agent referencing it AND a real runtime, (b) a master-seed code path referencing it, or (c) a complete runtime that any agent can opt into. **Zero broken wires. Zero phantom skills.**

### Playbook template fix: `portfolio-health-sweep`

The `portfolio-health-sweep` system playbook template (seeded in Phase 4) previously referenced `agentRef: { kind: 'system', slug: 'reporting-agent' }` — but `reporting-agent` is a subaccount-scoped custom agent, not a system agent, so the reference would have failed to resolve at run time. It also referenced a never-built skill named `list_active_subaccounts`. v6.0 corrects both:

- **Agent reference:** now `{ kind: 'system', slug: 'portfolio-health-agent' }` — the actual system agent for org-scoped portfolio monitoring, with `executionScope: 'org'`.
- **Step 1 skill:** now `query_subaccount_cohort` with empty `tag_filters` — returns every active subaccount in the org. This skill is already wired to `portfolio-health-agent` and replaces the hypothetical `list_active_subaccounts`.
- **Step 2 skill:** still `generate_portfolio_report`, which is already wired to `portfolio-health-agent` and produces the structured briefing. Now passes explicit parameters (`reporting_period_days: 7`, `format: 'structured'`, `verbosity: 'standard'`) instead of relying on defaults.

The playbook now resolves cleanly against real system agents and real skills at run time.

---

## Appendix C — Source of Truth & Drift Protocol

### The hierarchy of truth

1. **`companies/automation-os/agents/<slug>/AGENTS.md`** — the authoritative runtime definition for each system agent. `scripts/seed.ts` reads this directly via `parseCompanyFolder` in `scripts/lib/companyParser.ts`. The database row for each agent in `system_agents` is derived from this file.
2. **`companies/automation-os/COMPANY.md`** — the top-level manifest frontmatter. Only the frontmatter is read by the parser (name, description, slug, schema, version). The body is documentation.
3. **`companies/automation-os/automation-os-manifest.json`** — human-readable index only. Not read by any code path. It exists to give a single-file view of the roster and must be updated when agents are added or removed.
4. **`server/skills/<slug>.md`** — the authoritative definition of each system skill. Read by `systemSkillService` on demand, no DB sync. Every file must have an explicit `visibility:` frontmatter value per Appendix D.
5. **This document** — the architectural brief. Describes the shape and reasoning. Must be updated when agent wiring, skill wiring, gate model, or phase assignments change.

When these sources conflict, the `.md` files (AGENTS.md and skill files) win. Everything else needs updating.

### The master seed script

`scripts/seed.ts` is the single entry point for bootstrapping a database. It runs in five phases:

| Phase | Scope | Idempotency |
|-------|-------|-------------|
| 1 | System org + system admin user | Upserts — re-running updates mutable fields; password preserved on update |
| 2 | 16 system agents from `companies/automation-os/` | Upserts via slug lookup with `isNull(deletedAt)` filter |
| 3 | Playbook Author system agent (17th) | Upsert via slug lookup |
| 4 | Playbook templates from `server/playbooks/*.playbook.ts` + `portfolio-health-sweep` | Upserts via slug |
| 5 | Dev fixtures: Breakout Solutions org + admin + `42macro-tracking` subaccount + Reporting Agent + integration placeholders + **all 16 system agents activated in the org and linked through to the subaccount** | Upserts everywhere except `integration_connections`, which use insert-if-missing to protect real credentials |

Every phase is idempotent at row level. Re-running the seed against an already-seeded DB applies drift (new agents, renamed skills, updated prompts) without manual cleanup. Three drift cases are handled explicitly:

- **Removed `reportsTo`.** If an agent's `reportsTo` is removed or set to `null` in its AGENTS.md, Phase 2 explicitly clears the `parentSystemAgentId` column. A stale parent link cannot linger.
- **Execution scope flip.** If a system agent flips from `subaccount` to `org` scope, Phase 5 deactivates any existing `subaccount_agents` row for it.
- **Password changes via UI.** `upsertUser` hashes the provided password only on INSERT. On UPDATE the `passwordHash` column is never touched, so a user who changed their password via the UI will not have it reverted by a re-seed.

The only non-upsert is `integration_connections` — those rows start as `PLACEHOLDER_...` and must not be overwritten once real credentials are filled in via the UI.

**Not atomic across phases.** Each DB write is individually committed; there is no transaction wrapping a phase or the whole seed. If the process dies mid-phase, re-running converges because every row-level operation is an upsert. Row-level idempotency is the intentional trade-off — phase-atomic transactions would add significant complexity for marginal benefit in a bootstrap workflow.

Before Phase 1 runs, the seed executes a **preflight** that verifies every `server/skills/*.md` file has an explicit `visibility:` frontmatter value matching the classification in `scripts/lib/skillClassification.ts`. If any skill has drifted, the seed aborts before touching the DB — drift is caught locally, not in production.

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

```bash
npm run seed                        # applies everything; prints upsert counts
npm run skills:verify-visibility    # fails if any skill has drifted from the classification
```

The seed script will print each agent it creates or updates. The Automation OS company count should be **16** and the Playbook Author is the 17th. The slugs should match the Full Agent Roster table exactly. If the script outputs `[warn] reportsTo slug not found`, there is a hierarchy mismatch in the corresponding AGENTS.md `reportsTo:` field.

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

`read_inbox` is easy to misclassify because the name suggests "the agent's internal inbox," but the underlying implementation reads an external email provider via a connected `integration_connections` row. Structurally identical to `read_crm` and `read_campaigns` — a customer-configurable external data source — so it belongs in the `basic` bucket.

### Where the rule lives

| File | Role |
|------|------|
| `scripts/lib/skillClassification.ts` | Single source of truth. Exports `APP_FOUNDATIONAL_SKILLS`, `FULL_VISIBILITY_EXCEPTIONS`, `classifySkill(slug)`, and `desiredVisibilityFor(slug)`. |
| `scripts/apply-skill-visibility.ts` | Bulk-applies the classification to every `.md` file. Run via `npm run skills:apply-visibility` (add `--dry-run` to preview). |
| `scripts/verify-skill-visibility.ts` | CI gate. Fails if any file is missing a `visibility:` key, carries a legacy `isVisible:` key, or has a value that doesn't match `classifySkill()`. Run via `npm run skills:verify-visibility`. |
| `scripts/seed.ts` preflight | The master seed calls the same verification logic before Phase 1, so a seed refuses to run against a codebase with drifted skill frontmatter. |

### Adding a new skill

1. Drop the `.md` file in `server/skills/` with frontmatter including at least `name`, `slug`, `description`. The `visibility:` line is optional at this point.
2. If the skill is app-foundational (task/workspace/HITL/orchestration infrastructure), add its slug to `APP_FOUNDATIONAL_SKILLS` in `scripts/lib/skillClassification.ts`.
3. Run `npm run skills:apply-visibility` — it will set the `visibility:` frontmatter to `none` or `basic` based on the classification.
4. Commit the skill file AND the classification edit (if you added to `APP_FOUNDATIONAL_SKILLS`) in the same PR. The CI gate will catch drift on subsequent PRs.

### Why this matters

Visibility is not cosmetic — it controls what org admins see in the skill-management UI. Exposing `read_workspace` or `create_task` as manageable skills would confuse org admins who cannot meaningfully configure them (they are prerequisites for every agent, not options). Hiding them keeps the org UI focused on the capabilities customers actually pay for. Conversely, hiding `draft_ad_copy` or `analyse_financials` would hide the agent's actual value. The classification rule enforces this separation mechanically so it cannot drift over time.

---

**End of Brief — v6.0**










