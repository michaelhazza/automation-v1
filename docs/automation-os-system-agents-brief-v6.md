# \# Automation OS — System Agents Master Brief

# 

# \*\*Architecture, Roles, Skill Wiring \& Build Sequence\*\*

# 

# \- \*\*Version:\*\* 6.0

# \- \*\*Date:\*\* April 2026

# \- \*\*Status:\*\* Living document — source of truth for all system agent design decisions

# \- \*\*Predecessor:\*\* v5.0 (April 2026)

# 

# \---

# 

# \## Table of Contents

# 

# 1\. \[Changes from v5.0](#changes-from-v50)

# 2\. \[Overview](#overview)

# 3\. \[Organisational Structure](#organisational-structure)

# 4\. \[Gate Model Reference](#gate-model-reference)

# 5\. \[Full Agent Roster](#full-agent-roster)

# 6\. \[Build Sequence](#build-sequence)

# 7\. \[Product Development Team Architecture](#product-development-team-architecture)

# 8\. \[Agent 1 — Orchestrator (COO)](#agent-1--orchestrator-coo)

# 9\. \[Agent 2 — Business Analyst](#agent-2--business-analyst)

# 10\. \[Agent 3 — Dev Agent](#agent-3--dev-agent)

# 11\. \[Agent 4 — QA Agent](#agent-4--qa-agent)

# 12\. \[Agent 5 — Support Agent](#agent-5--support-agent)

# 13\. \[Agent 6 — Social Media Agent](#agent-6--social-media-agent)

# 14\. \[Agent 7 — Ads Management Agent](#agent-7--ads-management-agent)

# 15\. \[Agent 8 — Email Outreach Agent](#agent-8--email-outreach-agent)

# 16\. \[Agent 9 — Strategic Intelligence Agent](#agent-9--strategic-intelligence-agent)

# 17\. \[Agent 10 — Finance Agent](#agent-10--finance-agent)

# 18\. \[Agent 11 — Content/SEO Agent](#agent-11--contentseo-agent)

# 19\. \[Agent 12 — Client Reporting Agent](#agent-12--client-reporting-agent)

# 20\. \[Agent 13 — Onboarding Agent](#agent-13--onboarding-agent)

# 21\. \[Agent 14 — CRM/Pipeline Agent](#agent-14--crmpipeline-agent)

# 22\. \[Agent 15 — Knowledge Management Agent](#agent-15--knowledge-management-agent)

# 23\. \[Agent 16 — Portfolio Health Agent](#agent-16--portfolio-health-agent)

# 24\. \[Appendix A — Skill → Agent Cross-Reference](#appendix-a--skill--agent-cross-reference)

# 25\. \[Appendix B — Orphan Skills (unwired on disk)](#appendix-b--orphan-skills-unwired-on-disk)

# 26\. \[Appendix C — Source of Truth \& Drift Protocol](#appendix-c--source-of-truth--drift-protocol)

# 

# \---

# 

# <!-- SECTIONS APPEND BELOW IN ORDER -->

# 

# \## Changes from v5.0

# 

# Version 5.0 defined 15 agents in the abstract — schedules, gate models, and skills as design intent. Version 6.0 reconciles the brief with what actually shipped in PRs #98–#102 and subsequent follow-ups. This is a reality-sync release, not a redesign. Where v5.0 specified something the code later changed, v6.0 describes the code and notes the delta.

# 

# \*\*Key deltas from v5.0:\*\*

# 

# 1\. \*\*Sixteen agents exist on disk, not fifteen.\*\* The fifteen-agent business team is unchanged. A sixteenth agent — the \*\*Portfolio Health Agent\*\* — operates at `executionScope: org` and reports to `null` rather than the Orchestrator. It is documented as Agent 16 at the end of the per-agent section because it sits outside the business-team hierarchy.

# 2\. \*\*Schedules collapsed to on-demand for most agents.\*\* v5.0 specified cron schedules for Support (every 2h), Social (every 6h), Ads (every 6h), Email Outreach (every 6h), Finance (every 6h), CRM (every 6h), and others. The shipped implementation runs all non-MVP business agents `on-demand`, driven by the Orchestrator directive and the task board. Only four agents have schedules: `orchestrator` (06:00 and 20:00), `qa` (02:00), `portfolio-health-agent` (every 4 hours), and previously-scheduled agents retained no cron.

# 3\. \*\*Models simplified.\*\* v5.0 assigned Opus to Orchestrator, Dev, Strategic Intelligence, and Onboarding. The shipped implementation uses Opus only for Orchestrator and Dev. All other agents run on Sonnet. Strategic Intelligence and Onboarding were downgraded to Sonnet during build.

# 4\. \*\*Default gate is `review` for the thirteen business agents.\*\* Every business agent's AGENTS.md frontmatter carries `gate: review` as the default, with individual skills overriding to `auto` or `block` as needed. The scheduled agents (Orchestrator, QA, Portfolio Health) default to `auto`. This is a wiring simplification — the per-skill gate table in each agent section still holds.

# 5\. \*\*All business agents share a standard task-management skill set.\*\* Every business agent is wired with `create\_task` / `move\_task` / `update\_task` / `add\_deliverable` / `request\_approval` / `read\_workspace` / `write\_workspace`. v5.0 assigned these case-by-case; v6.0 documents the shipped convention.

# 6\. \*\*Skill inventory grew to 91 files.\*\* v5.0 projected five new skills (`draft\_requirements`, `write\_spec`, `derive\_test\_cases`, plus planned domain skills). The shipped build added 38 new skill files across growth, finance, content, CRM, knowledge management, and onboarding. \*\*14 of these 91 skills are currently orphaned\*\* — present on disk but not wired to any agent frontmatter (see Appendix B).

# 7\. \*\*Business Analyst reports to Orchestrator, not directly to the human.\*\* v5.0 placed the BA under the Orchestrator; this is preserved. Clarification: all 15 business agents report to the Orchestrator, and the Orchestrator is the only agent reporting to the human.

# 8\. \*\*Ads Management gate block scope narrowed.\*\* v5.0 specified `block` on budget increases and campaign pauses. This holds in v6.0: only `increase\_budget` and `pause\_campaign` are `block` across the entire skill library. Everything else in Ads is `review`.

# 9\. \*\*No new revision loop caps.\*\* The four loops (BA spec, Dev plan-gap, code fix-review, QA bug-fix) carry forward unchanged from v5.0.

# 10\. \*\*New master source-of-truth convention.\*\* `companies/automation-os/agents/<slug>/AGENTS.md` is the authoritative definition. This document describes the shape; AGENTS.md files define the runtime behaviour. See Appendix C.

# 

# \---

# 

# \## Overview

# 

# Automation OS runs its own business on the platform it builds. The sixteen system agents defined in this document are the first-customer team: they build the platform, run its commercial operations, monitor its clients, and file bugs against themselves. Every agent here is also a proof-of-concept for what the platform offers external customers.

# 

# The full network operates as an asynchronous team. Agents do not call each other in real time. They communicate through shared state: \*\*workspace memory\*\* (for context and insights), the \*\*task board\*\* (for work items and handoffs), \*\*Orchestrator directives\*\* (for daily coordination), and the \*\*HITL review queue\*\* (for any action with external or irreversible blast radius). Each agent is scoped to a specific function, scheduled independently, and gated appropriately for the blast radius of its actions.

# 

# The product development team (Orchestrator, Business Analyst, Dev, QA) are not a separate subsystem. They are members of the same network, subject to the same infrastructure, the same HITL gates, and the same workspace memory. They are built first — not because they are the most important agents commercially, but because they are needed to build the platform itself.

# 

# \### The v5.0 → v6.0 bridge: product development team integration (carried forward)

# 

# Version 5.0 integrated a validated Claude Code agent fleet reference architecture into the Automation OS model. That integration is preserved in v6.0 without changes:

# 

# \- \*\*Business Analyst is a full agent\*\* (not a skill inside the Orchestrator) because its outputs — user stories and Gherkin acceptance criteria — are independently consumed by both the Dev Agent and the QA Agent. Folding it into the Orchestrator would contaminate the coordination layer with product-thinking context.

# \- \*\*Architect and Builder merge into the Dev Agent.\*\* The discipline is preserved via an enforced phase sequence (plan → spec → ux → implement → self-review → submit), not via a separate agent boundary.

# \- \*\*Tech-spec, UX review, and PR review become skills\*\* invoked by the Dev Agent at the appropriate point in its pipeline: `draft\_tech\_spec`, `review\_ux`, `review\_code`.

# \- \*\*Triage is a skill\*\* (`triage\_intake`) available to the Orchestrator and Business Analyst rather than a separate agent.

# \- \*\*System Test Analyst patterns are absorbed into the QA Agent\*\* via Gherkin traceability (every test maps to an AC ID) and structured failure classification (APP BUG / TEST BUG / ENVIRONMENT).

# 

# \---

# 

# \## Organisational Structure

# 

# The agent network maps to a recognisable company structure. The human operator is the CEO: strategic decision-maker, approver of all boundary actions, setter of direction. The Orchestrator functions as the COO: operational coordinator synthesising state across all agents, writing directives, and keeping the machine running between human decisions.

# 

# ```

# Human (CEO)

# &#x20; ├── Orchestrator (COO)

# &#x20; │     ├── Business Analyst              \[MVP]

# &#x20; │     ├── Dev Agent                     \[MVP]

# &#x20; │     ├── QA Agent                      \[MVP]

# &#x20; │     ├── Support Agent                 \[Phase 2]

# &#x20; │     ├── Social Media Agent            \[Phase 3]

# &#x20; │     ├── Ads Management Agent          \[Phase 3]

# &#x20; │     ├── Email Outreach Agent          \[Phase 3]

# &#x20; │     ├── Strategic Intelligence Agent  \[Phase 4]

# &#x20; │     ├── Finance Agent                 \[Phase 4]

# &#x20; │     ├── Content/SEO Agent             \[Phase 4]

# &#x20; │     ├── Client Reporting Agent        \[Phase 5]

# &#x20; │     ├── Onboarding Agent              \[Phase 5]

# &#x20; │     ├── CRM/Pipeline Agent            \[Phase 5]

# &#x20; │     └── Knowledge Management Agent    \[Phase 5]

# &#x20; │

# &#x20; └── Portfolio Health Agent              \[special — org scope, not in business team]

# ```

# 

# The Portfolio Health Agent reports to `null`, not to the Orchestrator. It runs at `executionScope: org` against multiple subaccounts on its own schedule and writes to org-level memory. It is a monitoring surface, not a business-team member.

# 

# \---

# 

# \## Gate Model Reference

# 

# | Gate | Behaviour | Used For |

# |------|-----------|----------|

# | `auto` | Executes immediately, logged | Reads, internal analysis, memory updates, board writes, test runs, codebase reads |

# | `review` | Creates review item, pauses until approved | Outbound communications, code patches, spec documents, CRM writes, financial records, ad copy/bid changes, published content |

# | `block` | Never executes autonomously | Budget increases, campaign pauses, production deploys, merges, account deletion |

# 

# Gates are defined at two levels: each agent has a \*\*default gate\*\* in its frontmatter, and individual skills override that default per-invocation. The shipped convention: `orchestrator`, `qa`, and `portfolio-health-agent` default to `auto` (scheduled background workers); all thirteen business agents default to `review` (nothing ships without human sign-off). Individual skills like `read\_workspace` stay `auto` regardless of agent default; individual skills like `increase\_budget` stay `block` regardless of agent default.

# 

# \---

# 

# \## Full Agent Roster

# 

# | # | Agent | Slug | Reports To | Model | Schedule | Default Gate | Phase |

# |---|-------|------|------------|-------|----------|--------------|-------|

# | 1 | Orchestrator (COO) | `orchestrator` | null | opus-4-6 | `0 6,20 \* \* \*` | auto | MVP |

# | 2 | Business Analyst | `business-analyst` | orchestrator | sonnet-4-6 | on-demand | review | MVP |

# | 3 | Dev Agent | `dev` | orchestrator | opus-4-6 | on-demand | review | MVP |

# | 4 | QA Agent | `qa` | orchestrator | sonnet-4-6 | `0 2 \* \* \*` | auto | MVP |

# | 5 | Support Agent | `support-agent` | orchestrator | sonnet-4-6 | on-demand | review | 2 |

# | 6 | Social Media Agent | `social-media-agent` | orchestrator | sonnet-4-6 | on-demand | review | 3 |

# | 7 | Ads Management Agent | `ads-management-agent` | orchestrator | sonnet-4-6 | on-demand | review | 3 |

# | 8 | Email Outreach Agent | `email-outreach-agent` | orchestrator | sonnet-4-6 | on-demand | review | 3 |

# | 9 | Strategic Intelligence Agent | `strategic-intelligence-agent` | orchestrator | sonnet-4-6 | on-demand | review | 4 |

# | 10 | Finance Agent | `finance-agent` | orchestrator | sonnet-4-6 | on-demand | review | 4 |

# | 11 | Content/SEO Agent | `content-seo-agent` | orchestrator | sonnet-4-6 | on-demand | review | 4 |

# | 12 | Client Reporting Agent | `client-reporting-agent` | orchestrator | sonnet-4-6 | on-demand | review | 5 |

# | 13 | Onboarding Agent | `onboarding-agent` | orchestrator | sonnet-4-6 | on-demand | review | 5 |

# | 14 | CRM/Pipeline Agent | `crm-pipeline-agent` | orchestrator | sonnet-4-6 | on-demand | review | 5 |

# | 15 | Knowledge Management Agent | `knowledge-management-agent` | orchestrator | sonnet-4-6 | on-demand | review | 5 |

# | 16 | Portfolio Health Agent | `portfolio-health-agent` | null | sonnet-4-6 | `\*/4 \* \* \*` | auto | special |

# 

# All values in this table are read directly from the AGENTS.md frontmatter files on disk. If there is a conflict between this table and the code, the code is right and this table needs updating.

# 

# \---

# 

# \## Build Sequence

# 

# | Phase | Agents | Primary Beneficiary | Depends On |

# |-------|--------|---------------------|------------|

# | MVP | Orchestrator, Business Analyst, Dev, QA | Platform builders | Validates full infrastructure stack |

# | 2 | Support | Platform businesses | MVP primitives proven in production |

# | 3 | Social Media, Ads Management, Email Outreach | Agency clients | Phase 2 review gates validated end-to-end |

# | 4 | Strategic Intelligence, Finance, Content/SEO | Agency clients | Phase 3 agents generating data signals |

# | 5 | Client Reporting, Onboarding, CRM/Pipeline, Knowledge Management | Agency clients | Phase 4 stable and data-rich |

# | Special | Portfolio Health | Platform operators | Independent — monitors across subaccounts |

# | 6 | Docker/Playwright infrastructure | Dev and QA agents | Parallel — does not block Phase 3 onward |

# 

# \---

# 

# \## Product Development Team Architecture

# 

# The four MVP agents (Orchestrator, Business Analyst, Dev, QA) form a coherent product development team. Understanding how they interact as a team is necessary before reading each agent's individual definition.

# 

# \### The full development pipeline

# 

# ```

# Human or Orchestrator creates a board task

# &#x20; │

# &#x20; ├── Simple bug fix or small change

# &#x20; │     └── Dev Agent reads task

# &#x20; │           ├── draft\_architecture\_plan (auto) — internal planning

# &#x20; │           ├── review\_code (auto) — self-review

# &#x20; │           ├── write\_patch (review) — HITL: human approves diff

# &#x20; │           └── QA Agent runs post-patch

# &#x20; │

# &#x20; └── Feature or significant change

# &#x20;       └── Business Analyst Agent

# &#x20;             ├── draft\_requirements (auto) — user stories + Gherkin ACs

# &#x20;             └── write\_spec (review) — HITL: human approves spec before Dev begins

# &#x20;             │

# &#x20;             └── Dev Agent reads approved spec

# &#x20;                   ├── draft\_architecture\_plan (auto)

# &#x20;                   ├── draft\_tech\_spec (auto, if API changes involved)

# &#x20;                   ├── review\_ux (auto, if UI changes involved)

# &#x20;                   ├── Implements code

# &#x20;                   ├── review\_code (auto) — self-review

# &#x20;                   └── write\_patch (review) — HITL: human approves diff

# &#x20;                   │

# &#x20;                   └── QA Agent

# &#x20;                         ├── derive\_test\_cases from Gherkin ACs

# &#x20;                         ├── run\_tests (auto)

# &#x20;                         └── report\_bug (auto) if failures found

# ```

# 

# \### Revision loop caps

# 

# The same discipline carried forward from v5.0:

# 

# | Loop | Cap | Escalation behaviour |

# |------|-----|---------------------|

# | BA spec revisions | 3 rounds | Dev Agent flags unresolved ambiguity to board, escalates to human |

# | Dev plan-gap reports | 2 rounds | Dev Agent escalates to human with gap summary |

# | Code fix-review cycles | 3 rounds | Dev Agent escalates with unresolved blocking issues |

# | QA bug-fix cycles | 3 rounds | QA Agent escalates, blocks release until human resolves |

# 

# \### File-based artifact convention

# 

# Agents communicate work products through workspace memory and board task attachments, not through shared context. This keeps context windows focused and creates an audit trail.

# 

# | Artifact | Written By | Read By | Location |

# |----------|-----------|---------|----------|

# | Requirements spec (user stories + Gherkin) | BA Agent | Dev Agent, QA Agent | Board task attachment or `workspace\_memories` |

# | Architecture plan | Dev Agent (via skill) | Dev Agent (phase 2), QA Agent | Board task attachment |

# | Technical spec (OpenAPI/schema) | Dev Agent (via skill) | Dev Agent, QA Agent | Board task attachment |

# | Code patch (diff) | Dev Agent | Human reviewer | Review queue |

# | Test results | QA Agent | Orchestrator, Dev Agent | `workspace\_memories` |

# | Bug reports | QA Agent | Dev Agent, Orchestrator | Board tasks |

# 

# \---

# 

# \## Agent 1 — Orchestrator (COO)

# 

# \- \*\*Slug:\*\* `orchestrator`

# \- \*\*Reports to:\*\* null (top of tree)

# \- \*\*Model:\*\* `claude-opus-4-6`

# \- \*\*Schedule:\*\* `0 6,20 \* \* \*` (06:00 and 20:00 daily)

# \- \*\*Default gate:\*\* auto

# \- \*\*Phase:\*\* MVP

# 

# \### Vision

# 

# The Orchestrator is the operational backbone of the entire agent network. It functions as the COO: the only agent with visibility across everything, responsible for synthesising state and keeping all other agents directed and coordinated. Every morning it reads the full state of the business — open tasks, recent agent activity, overnight memory entries, unreviewed actions, failed jobs — and synthesises it into a prioritised daily directive. Every evening it reviews what happened, writes a summary, and updates priorities for the next cycle.

# 

# It does not execute. It does not send emails, post content, or make API calls. Its entire output is a structured directive injected into every other agent's context on their next run.

# 

# \### Responsibilities

# 

# \- Read all workspace memory, task board state, recent agent run outputs, and open review items

# \- Identify patterns across agent outputs: recurring support issues, stalled tasks, budget anomalies, failing tests

# \- Write a morning directive with daily priorities, active context, and per-agent instructions

# \- Write an evening summary covering what was completed, what needs follow-up, and what to watch tomorrow

# \- Flag systemic issues for human attention: multiple agents failing on the same integration, persistent test failures, revision loops hitting their caps

# \- Adjust priorities dynamically in response to business signals: campaign launches, incidents, releases, client onboarding

# \- Invoke `triage\_intake` when new ideas or bugs arrive outside of normal channels

# 

# \### Wired skills (from `agents/orchestrator/AGENTS.md`)

# 

# | Skill | Gate | Purpose |

# |-------|------|---------|

# | `read\_workspace` | auto | Full read of memory, tasks, recent runs, open review items |

# | `write\_workspace` | auto | Write directives and summaries to memory |

# | `create\_task` | auto | Create coordination tasks on the board |

# | `move\_task` | auto | Update task status as part of directive logic |

# | `update\_task` | auto | Edit task content when coordinating |

# | `reassign\_task` | auto | Route a task to a different agent |

# | `spawn\_sub\_agents` | auto | Trigger parallel sub-task execution (max 2–3 independent tracks) |

# | `triage\_intake` | auto | Capture and route incoming ideas or bugs |

# | `request\_approval` | review | Escalate coordination decisions requiring human input |

# 

# \### What it should NOT do

# 

# \- Never send external communications of any kind

# \- Never write or propose code changes

# \- Never modify integration credentials or workspace configuration

# \- Never approve or reject review items — that is always a human decision

# \- Never take any action with financial consequences

# 

# \### Outputs

# 

# \- `orchestrator\_directives` record written to the database each run, injected into all other agent prompts

# \- Evening summary written to `workspace\_memories`

# \- Coordination tasks on the board when patterns require human attention

# \- Escalation flags for systemic failures or urgent issues

# 

# \---

# 

# \## Agent 2 — Business Analyst

# 

# \- \*\*Slug:\*\* `business-analyst`

# \- \*\*Reports to:\*\* orchestrator

# \- \*\*Model:\*\* `claude-sonnet-4-6`

# \- \*\*Schedule:\*\* on-demand (triggered by Orchestrator directive or board task)

# \- \*\*Default gate:\*\* review

# \- \*\*Phase:\*\* MVP

# 

# \### Vision

# 

# The Business Analyst is the translation layer between human intent and machine-executable requirements. Its job is to turn vague ideas, board tasks, and feature requests into user stories with Gherkin acceptance criteria that the Dev Agent can implement and the QA Agent can test against.

# 

# This is a separate agent and not a skill inside the Orchestrator for one specific reason: the BA produces artifacts that are independently consumed by two other agents (Dev and QA). If requirements analysis happened inside the Orchestrator, the Orchestrator's context would be contaminated with product thinking before it has even delegated. Worse, the Dev Agent would receive requirements as part of a large directive context rather than as a focused, self-contained spec document.

# 

# The BA operates in two modes. In \*\*requirements mode\*\*, it takes a board task or human-provided brief and produces a requirements spec. In \*\*clarification mode\*\*, it identifies open questions that would force the Dev Agent to make assumptions, surfaces them via `ask\_clarifying\_question`, and only produces a spec once those questions are answered. The review gate on the output spec document is non-negotiable: a spec that has not been human-reviewed should not drive engineering effort.

# 

# \### Responsibilities

# 

# \- Read board tasks, Orchestrator directives, and any provided context to understand the feature or change required

# \- Read the codebase for technical feasibility context before committing to requirements

# \- Clarify scope ambiguities before writing — never invent requirements

# \- Produce user stories in INVEST format (Independent, Negotiable, Valuable, Estimable, Small, Testable)

# \- Write Gherkin acceptance criteria for every story: Given/When/Then, including negative scenarios

# \- Rank open questions by risk (high/medium/low) — high-risk questions block the spec from being marked complete

# \- Produce a Definition of Done checklist specific to the task

# \- Submit the completed spec for human review before notifying the Dev Agent

# \- Invoke `triage\_intake` when out-of-scope ideas or bugs surface during requirements analysis

# 

# \### Wired skills (from `agents/business-analyst/AGENTS.md`)

# 

# | Skill | Gate | Purpose |

# |-------|------|---------|

# | `read\_workspace` | auto | Board tasks, Orchestrator directives, existing product context |

# | `read\_codebase` | auto | Read relevant source files for technical feasibility context |

# | `write\_workspace` | auto | Write approved specs to memory, update task records |

# | `create\_task` | auto | Create clarification tasks when high-risk questions need human input |

# | `move\_task` / `update\_task` / `add\_deliverable` | auto | Standard board ops |

# | `ask\_clarifying\_question` | auto | Pause and surface a blocking question to the user |

# | `draft\_requirements` | auto | Internal analysis and spec drafting with INVEST + Gherkin output |

# | `write\_spec` | review | Submit completed requirements spec for human approval (HITL gate) |

# | `web\_search` | auto | Research industry conventions, competitor behaviour for ambiguous scope |

# | `triage\_intake` | auto | Capture ideas or bugs surfaced during requirements analysis |

# | `request\_approval` | review | Escalate spec decisions to human |

# 

# \### What it should NOT do

# 

# \- Never pass a spec to the Dev Agent before it has been human-reviewed

# \- Never invent requirements — every acceptance criterion must be traceable to the brief or a clarification response

# \- Never make architecture or implementation decisions — define WHAT, not HOW

# \- Never write test code or review code — those belong to QA and Dev

# \- Never bypass the review gate on the spec document under any circumstances

# 

# \### Outputs

# 

# \- Requirements spec in the review queue: user stories, Gherkin ACs, open questions, Definition of Done

# \- Approved spec written to `workspace\_memories` with a spec reference ID (`SPEC-task-N-vX`) for the Dev Agent and QA Agent

# \- Board task updated with spec reference and status changed to `spec-approved`

# \- Clarification tasks on the board when high-risk questions require human input before spec can complete

# 

# \---

# 

# \## Agent 3 — Dev Agent

# 

# \- \*\*Slug:\*\* `dev`

# \- \*\*Reports to:\*\* orchestrator

# \- \*\*Model:\*\* `claude-opus-4-6`

# \- \*\*Schedule:\*\* on-demand (triggered via handoff, board task, or Orchestrator directive)

# \- \*\*Default gate:\*\* review (code changes), block (deploys, merges)

# \- \*\*Phase:\*\* MVP

# 

# \### Vision

# 

# The Dev Agent is where the platform starts eating its own lunch. It is not a code completion tool — it is a developer that lives inside the same agent network as everyone else, reads the same workspace memory, sees the QA agent's bug reports on the board, and gets directed by the Orchestrator like any other team member.

# 

# The Dev Agent incorporates the discipline of the architect-builder separation without requiring two separate agents. Before writing a single line of code on any non-trivial task, the Dev Agent must produce and submit an architecture plan. This plan can be reviewed by a human before implementation begins (review gate for Significant/Major tasks) or, for small tasks, can be self-approved and immediately followed up with implementation (internal planning only). The four internal skills — `draft\_architecture\_plan`, `draft\_tech\_spec`, `review\_ux`, and `review\_code` — are invoked in sequence as the task requires them. The discipline is enforced by the agent's system prompt, not by a separate architecture agent.

# 

# The trust model is explicit and deliberate. Every code change goes through the HITL review queue before it touches the codebase. The agent proposes; a human decides.

# 

# \### Task classification

# 

# The Dev Agent must classify each task before starting work:

# 

# | Classification | Criteria | Planning Requirement |

# |----------------|----------|---------------------|

# | \*\*Trivial\*\* | Single file change, obvious fix, no API impact | Skip architecture plan; go straight to implementation + self-review |

# | \*\*Standard\*\* | 2–5 files, clear requirements, no schema changes | `draft\_architecture\_plan` internal; no plan review gate required |

# | \*\*Significant\*\* | Schema changes, new API endpoints, or UI flows | `draft\_architecture\_plan` submitted for human review before coding begins |

# | \*\*Major\*\* | New domain, cross-cutting concerns, or external integrations | `draft\_architecture\_plan` + `draft\_tech\_spec` submitted; no coding until human approves both |

# 

# \### Wired skills (from `agents/dev/AGENTS.md`)

# 

# | Skill | Gate | Purpose |

# |-------|------|---------|

# | `read\_codebase` | auto | Read files from projectRoot — scoped, no writes |

# | `search\_codebase` | auto | Grep and glob across the project |

# | `read\_workspace` | auto | Bug reports, QA findings, BA specs, Orchestrator directives |

# | `write\_workspace` | auto | Implementation notes and change summaries |

# | `draft\_architecture\_plan` | auto | Internal: plan before writing code |

# | `draft\_tech\_spec` | auto | Internal: produce API/schema specifications for significant changes |

# | `review\_ux` | auto | Internal: UX review pass on UI-affecting changes |

# | `review\_code` | auto | Internal: self-review pass before submitting any patch |

# | `write\_patch` | review | Propose a diff — human must approve before application |

# | `write\_tests` | auto | Write or update test files |

# | `run\_tests` | auto | Execute the project test suite |

# | `run\_command` | auto | Execute an approved shell command in projectRoot |

# | `create\_pr` | auto | Open a GitHub PR from accumulated approved patches |

# | `request\_approval` | review | Trigger HITL review for a proposed change |

# | `create\_task` / `move\_task` / `update\_task` / `add\_deliverable` | auto | Standard board ops |

# 

# \### Plan-gap protocol

# 

# If at any point during implementation the Dev Agent encounters an ambiguity that cannot be resolved from the spec, codebase context, or workspace memory, it must raise a PLAN\_GAP report rather than improvising:

# 

# ```

# PLAN\_GAP REPORT

# Task: \[task reference]

# Gap: \[specific description of what is missing or ambiguous]

# Decision needed: \[what choice needs to be made]

# Options considered: \[list of approaches with trade-offs]

# Blocked chunk: \[which part of the implementation is blocked]

# ```

# 

# The PLAN\_GAP report is written to the board task as a comment and the task status is updated to `blocked`. Maximum 2 plan-gap rounds before the issue escalates to the human directly.

# 

# \### What it should NOT do

# 

# \- Never apply any code change without an approved review item

# \- Never run any shell command without human approval

# \- Never access files outside the configured `projectRoot`

# \- Never merge a PR — merges are always manual (block gate)

# \- Never deploy — deploys are always manual (block gate)

# \- Never modify environment variables, secrets, or configuration files without explicit instruction

# \- Never skip the architecture planning phase for Significant or Major classified tasks

# \- Never improvise past a plan gap — always raise a PLAN\_GAP report

# 

# \### Outputs

# 

# \- Architecture plans in the review queue (for Significant/Major tasks) before coding begins

# \- Technical specs in the review queue (for Major tasks with API/schema changes)

# \- Code patches in the review queue with diff, reasoning, self-review results, and affected files listed

# \- PLAN\_GAP reports as board task comments when ambiguity blocks implementation

# \- PRs on GitHub from batches of approved patches

# \- Implementation summaries written to workspace memory for QA Agent context

# 

# \---

# 

# \## Agent 4 — QA Agent

# 

# \- \*\*Slug:\*\* `qa`

# \- \*\*Reports to:\*\* orchestrator

# \- \*\*Model:\*\* `claude-sonnet-4-6`

# \- \*\*Schedule:\*\* `0 2 \* \* \*` (02:00 daily regression run) + on-demand

# \- \*\*Default gate:\*\* auto (reads, tests, and reports — no external writes)

# \- \*\*Phase:\*\* MVP

# 

# \### Vision

# 

# The QA Agent is the closing sensor in the development loop. After a patch is approved and applied, QA runs against it and reports. That feedback cycle — Dev proposes, human approves, QA validates — is the core of the internal development loop the platform builds for itself.

# 

# The QA Agent has two defining disciplines:

# 

# \*\*Gherkin traceability.\*\* Every test case is explicitly mapped to a specific BA Gherkin acceptance criterion. An untraceable test is noise. This discipline means the QA Agent's test output can be directly matched against the BA's spec to confirm the feature delivers what was promised.

# 

# \*\*Structured failure classification.\*\* Every test failure is classified as one of three types: \*\*APP BUG\*\* (the application code is broken and needs a Dev Agent fix), \*\*TEST BUG\*\* (the test logic itself is wrong and the QA Agent fixes it immediately), or \*\*ENVIRONMENT\*\* (an expected failure in the current environment, noted and not escalated). This prevents the Dev Agent from chasing phantom failures caused by test infrastructure issues.

# 

# The compounding value is in workspace memory. Over time the QA Agent builds a picture of which endpoints are fragile, which tests are flaky, and which areas of the codebase produce the most bugs.

# 

# \### Wired skills (from `agents/qa/AGENTS.md`)

# 

# | Skill | Gate | Purpose |

# |-------|------|---------|

# | `derive\_test\_cases` | auto | Extract test scenarios from Gherkin ACs in a BA spec |

# | `run\_tests` | auto | Execute configured test suite, capture pass/fail and output |

# | `write\_tests` | auto | Write or update test files for a module or fix |

# | `run\_playwright\_test` | auto | Execute a Playwright end-to-end test file |

# | `capture\_screenshot` | auto | Visual QA validation via Playwright |

# | `analyze\_endpoint` | auto | Hit API endpoints, validate status, schema, and timing |

# | `report\_bug` | auto | Create structured board task with severity, classification, repro steps |

# | `read\_codebase` | auto | Read test files and source for context when analysing failures |

# | `search\_codebase` | auto | Find relevant code for a failing test |

# | `read\_workspace` | auto | Dev Agent implementation notes, BA specs, and Orchestrator context |

# | `write\_workspace` | auto | Test insights, fragility signals, and coverage summaries |

# | `create\_task` / `move\_task` / `update\_task` / `add\_deliverable` | auto | Standard board ops |

# | `request\_approval` | review | Escalate when maxTestRunsPerTask or fingerprint-unchanged caps hit |

# 

# \### Failure classification protocol

# 

# | Classification | Definition | Action |

# |----------------|-----------|--------|

# | \*\*APP BUG\*\* | Application code is broken; the test correctly identifies a defect | Create board task with severity, repro steps, Gherkin AC reference, and spec reference. Do not fix. |

# | \*\*TEST BUG\*\* | The test logic is incorrect; the application behaviour is as intended | Fix the test immediately. Log the correction in workspace memory. No board task. |

# | \*\*ENVIRONMENT\*\* | Failure caused by the test environment, not application or test logic | Note in workspace memory. Flag in run summary. Do not escalate unless recurring. |

# 

# When classification is uncertain, the QA Agent defaults to APP BUG and notes the uncertainty. The Dev Agent will investigate and reclassify if needed.

# 

# \### What it should NOT do

# 

# \- Never write to the codebase — tests and test files only, never application source

# \- Never send any external communication about findings

# \- Never close or resolve bugs it has raised — only an approved patch and human confirmation closes a bug

# \- Never approve code changes based on its own test results — human review always sits between QA sign-off and merge

# \- Never write a test that cannot be traced to a specific Gherkin AC

# 

# \### Outputs

# 

# \- Test cases derived from BA Gherkin ACs, written to workspace memory with spec reference ID

# \- Structured bug reports on the board: severity, classification, confidence score, reproduction steps, Gherkin AC reference

# \- Test run summaries written to workspace memory after each run

# \- Daily regression report injected into the Orchestrator morning directive

# \- Fragility and coverage insights written to memory for Dev Agent and Strategic Intelligence context

# 

# \---

# 

# \## Agent 5 — Support Agent

# 

# \- \*\*Slug:\*\* `support-agent`

# \- \*\*Reports to:\*\* orchestrator

# \- \*\*Model:\*\* `claude-sonnet-4-6`

# \- \*\*Schedule:\*\* on-demand (v5.0 specified every 2 hours — shipped implementation is on-demand)

# \- \*\*Default gate:\*\* review (all outbound communication)

# \- \*\*Phase:\*\* 2

# 

# \### Vision

# 

# The Support agent is the first point of contact between the platform and the reality of customer problems. Its job is to make sure nothing gets missed, everything gets triaged, and responses go out faster and more consistently than any human inbox could manage.

# 

# The key design principle is that the agent does the cognitive work — reading, classifying, drafting, prioritising — but a human approves every reply before it sends. Over time, as the review history builds, the agency can identify which reply categories the agent consistently gets right and progressively move those to auto.

# 

# The Support agent is also the primary sensor for product quality. It sees the bugs before they reach the board. The self-improvement loop — Support detects a pattern, board task created, Dev Agent fixes it — starts here.

# 

# \### Wired skills (from `agents/support-agent/AGENTS.md`)

# 

# | Skill | Gate | Purpose |

# |-------|------|---------|

# | `read\_workspace` | auto | Orchestrator directives, customer context, previous resolutions |

# | `write\_workspace` | auto | Pattern insights and resolution notes |

# | `read\_codebase` | auto | Look up code references when a ticket cites a specific feature |

# | `classify\_email` | auto | Tag by type, urgency, and sentiment |

# | `search\_knowledge\_base` | auto | Reference docs, FAQs, and previous resolutions |

# | `draft\_reply` | auto | Generate reply for human review |

# | `send\_email` | auto | Send reply (gated upstream via `request\_approval` for outbound) |

# | `request\_approval` | review | HITL gate on all outbound replies |

# | `move\_task` / `update\_task` / `add\_deliverable` | auto | Standard board ops |

# 

# \*\*Note on v5.0 delta:\*\* v5.0 listed a separate `read\_inbox` skill for the Support Agent. The shipped implementation does not wire `read\_inbox` — it exists on disk as an orphan skill. Inbox integration is currently pending wiring in Phase 2 build. `create\_task` is also not currently wired; the Support Agent currently surfaces bugs via `write\_workspace` + Orchestrator synthesis rather than direct task creation.

# 

# \### What it should NOT do

# 

# \- Never send any communication without human review

# \- Never promise features, refunds, or commitments on behalf of the agency

# \- Never close or archive tickets automatically

# \- Never access billing or account data beyond what is needed to answer the ticket

# 

# \### Outputs

# 

# \- Drafted replies in the review queue, ready for one-click approval

# \- Workspace memory entries for recurring patterns, surfaced to the Orchestrator each morning

# \- Escalation flags for tickets that need immediate human attention

# 

# \---

# 

# \## Agent 6 — Social Media Agent

# 

# \- \*\*Slug:\*\* `social-media-agent`

# \- \*\*Reports to:\*\* orchestrator

# \- \*\*Model:\*\* `claude-sonnet-4-6`

# \- \*\*Schedule:\*\* on-demand (v5.0 specified every 6 hours)

# \- \*\*Default gate:\*\* review (all publishing actions)

# \- \*\*Phase:\*\* 3

# 

# \### Vision

# 

# The Social Media agent is not a content mill. Its job is to maintain a consistent, informed presence across platforms — one that reflects what is actually happening in the business, not generic filler content. It reads workspace context before writing anything, so it knows about recent product updates, customer wins, active campaigns, and competitor moves.

# 

# \### Wired skills (from `agents/social-media-agent/AGENTS.md`)

# 

# | Skill | Gate | Purpose |

# |-------|------|---------|

# | `read\_workspace` | auto | Orchestrator directives, brand voice, recent updates |

# | `write\_workspace` | auto | Performance insights and content ideas |

# | `draft\_post` | auto | Generate platform-specific content for review |

# | `publish\_post` | review | Publish only after human approval |

# | `read\_analytics` | auto | Read performance data from connected social platforms |

# | `request\_approval` | review | HITL gate on publish actions |

# | `move\_task` / `update\_task` / `add\_deliverable` | auto | Standard board ops |

# 

# \*\*Note on v5.0 delta:\*\* `web\_search` is not currently wired to Social Media Agent; if trend research is needed it comes via the Orchestrator directive or a handoff from Strategic Intelligence. `schedule\_post` does not exist as a separate skill — scheduled publishing is handled via `publish\_post` with a scheduled timestamp parameter.

# 

# \### What it should NOT do

# 

# \- Never publish anything without human approval

# \- Never engage with replies, comments, or DMs autonomously

# \- Never run paid promotion on organic posts without explicit instruction

# \- Never post about sensitive business topics: legal matters, personnel, incidents

# 

# \### Outputs

# 

# \- Drafted posts in the review queue with platform context and rationale

# \- Performance summaries in workspace memory

# \- Content ideas and campaign briefs as board task deliverables

# 

# \---

# 

# \## Agent 7 — Ads Management Agent

# 

# \- \*\*Slug:\*\* `ads-management-agent`

# \- \*\*Reports to:\*\* orchestrator

# \- \*\*Model:\*\* `claude-sonnet-4-6`

# \- \*\*Schedule:\*\* on-demand (v5.0 specified every 6 hours)

# \- \*\*Default gate:\*\* review (bid and copy changes), block (budget increases, campaign pause)

# \- \*\*Phase:\*\* 3

# 

# \### Vision

# 

# The Ads Management agent operates as a performance analyst that can also execute. It reads campaign performance, forms a clear view on what is working and what is not, and proposes specific changes with explicit reasoning. A human reviews and approves before anything actually changes.

# 

# The `block` gate on budget increases and campaign pauses is deliberate and non-negotiable. These are effectively irreversible — you cannot un-spend budget, and pausing a campaign mid-promotion can cause real damage. `increase\_budget` and `pause\_campaign` are the only two skills in the entire library that carry a `block` gate.

# 

# \### Wired skills (from `agents/ads-management-agent/AGENTS.md`)

# 

# | Skill | Gate | Purpose |

# |-------|------|---------|

# | `read\_workspace` | auto | Orchestrator directives, active campaigns, brand context |

# | `write\_workspace` | auto | Performance summaries and trend insights |

# | `read\_campaigns` | auto | Pull performance data from ad platforms |

# | `analyse\_performance` | auto | Internal analysis and insight generation |

# | `draft\_ad\_copy` | auto | Generate copy variants for review |

# | `update\_bid` | review | Propose bid change — human approves before execution |

# | `update\_copy` | review | Propose ad copy swap — human approves before activation |

# | `pause\_campaign` | \*\*block\*\* | Never autonomous — always manual |

# | `increase\_budget` | \*\*block\*\* | Never autonomous — always manual |

# | `request\_approval` | review | Escalate decisions requiring human input |

# | `move\_task` / `update\_task` / `add\_deliverable` | auto | Standard board ops |

# 

# \### What it should NOT do

# 

# \- Never increase or decrease campaign budgets without explicit human instruction

# \- Never pause or resume campaigns autonomously

# \- Never create new campaigns — only optimise existing ones

# \- Never access billing or payment methods

# 

# \### Outputs

# 

# \- Performance analysis written to workspace memory each run

# \- Proposed bid and copy changes in the review queue with reasoning

# \- Ad copy variants drafted and ready for human selection

# \- Anomaly flags and competitor findings as board task deliverables

# 

# \---

# 

# \## Agent 8 — Email Outreach Agent

# 

# \- \*\*Slug:\*\* `email-outreach-agent`

# \- \*\*Reports to:\*\* orchestrator

# \- \*\*Model:\*\* `claude-sonnet-4-6`

# \- \*\*Schedule:\*\* on-demand (v5.0 specified every 6 hours)

# \- \*\*Default gate:\*\* review (all outbound sequences)

# \- \*\*Phase:\*\* 3

# 

# \### Vision

# 

# The Email Outreach agent does the research, sequencing, and drafting at scale — but every email that leaves the system goes through a human first. The agent's value is in the quality of its targeting and personalisation, not the volume of its sends. Sequences are drafted in full before any single email sends, so the human reviewer can evaluate the entire flow before approving the first touch.

# 

# \### Wired skills (from `agents/email-outreach-agent/AGENTS.md`)

# 

# | Skill | Gate | Purpose |

# |-------|------|---------|

# | `read\_workspace` | auto | ICP criteria, campaign priorities, Orchestrator directives |

# | `write\_workspace` | auto | Prospect insights, performance data, conversion signals |

# | `enrich\_contact` | auto | Pull contact data from enrichment integrations |

# | `draft\_sequence` | auto | Build full multi-touch email sequence for review |

# | `send\_email` | auto | Send email (individually gated via `request\_approval`) |

# | `update\_crm` | review | Update contact records — human approves |

# | `request\_approval` | review | HITL gate on every email send in a sequence |

# | `move\_task` / `update\_task` / `add\_deliverable` | auto | Standard board ops |

# 

# \*\*Note on v5.0 delta:\*\* `web\_search` is not currently wired to Email Outreach Agent — prospect research is expected to come via `enrich\_contact` and workspace memory ICP definitions.

# 

# \### What it should NOT do

# 

# \- Never send any email without human review and approval

# \- Never contact anyone on a suppression list under any circumstances

# \- Never impersonate a specific named individual without explicit configuration

# \- Never draft outreach for regulated industries without specific compliance guidance in workspace memory

# 

# \### Outputs

# 

# \- Full drafted sequences in the review queue with prospect context and personalisation rationale

# \- Prospect lists with research summaries written to the board as deliverables

# \- Response alerts and hot lead flags as board task updates

# \- Performance and conversion insights written to memory

# 

# \---

# 

# \## Agent 9 — Strategic Intelligence Agent

# 

# \- \*\*Slug:\*\* `strategic-intelligence-agent`

# \- \*\*Reports to:\*\* orchestrator

# \- \*\*Model:\*\* `claude-sonnet-4-6` (v5.0 specified opus — downgraded during build)

# \- \*\*Schedule:\*\* on-demand (v5.0 specified daily 07:00)

# \- \*\*Default gate:\*\* review

# \- \*\*Phase:\*\* 4

# 

# \### Vision

# 

# This agent merges what would otherwise have been two separate agents — Business Planning and Competitor Research. The Strategic Intelligence agent is the platform's thinking layer. It does not act. It synthesises signals from Finance, Ads, Support, Email Outreach, and external competitor monitoring into structured insight. Its most important function is connecting dots across domains — Finance sees a revenue dip, Ads sees rising CPAs, Support sees more onboarding complaints. On their own these are three separate signals. Together they suggest a conversion problem working its way through the funnel.

# 

# \### Wired skills (from `agents/strategic-intelligence-agent/AGENTS.md`)

# 

# | Skill | Gate | Purpose |

# |-------|------|---------|

# | `read\_workspace` | auto | Full access to memory, board, and all agent run outputs |

# | `write\_workspace` | auto | Strategic insights, competitor profiles, and summaries |

# | `web\_search` | auto | Competitor news, market context, and industry signals |

# | `generate\_competitor\_brief` | auto | Structured intelligence brief on a competitor: positioning, pricing, moves |

# | `synthesise\_voc` | auto | Synthesise Voice of Customer data from multiple sources into themes |

# | `request\_approval` | review | Escalate recommendations requiring human decision |

# | `move\_task` / `update\_task` / `add\_deliverable` | auto | Standard board ops |

# 

# \*\*Note on v5.0 delta:\*\* v5.0 listed `web\_fetch` for page diffing. `fetch\_url` exists on disk as an orphan skill — it is not currently wired to Strategic Intelligence. `create\_task` is also not wired; strategic recommendations are surfaced via `add\_deliverable` on existing tasks.

# 

# \### What it should NOT do

# 

# \- Never take any external action of any kind

# \- Never contact competitor companies or their employees

# \- Never attempt to access non-public competitor data

# \- Never make financial projections that could be mistaken for accounting records

# \- Never surface low-relevance competitor findings as deliverables

# 

# \### Outputs

# 

# \- Strategic recommendations as task deliverables with supporting evidence

# \- Daily cross-domain analysis written to workspace memory

# \- Updated competitor profiles after each run

# \- Weekly summary injected into the Orchestrator directive

# 

# \---

# 

# \## Agent 10 — Finance Agent

# 

# \- \*\*Slug:\*\* `finance-agent`

# \- \*\*Reports to:\*\* orchestrator

# \- \*\*Model:\*\* `claude-sonnet-4-6`

# \- \*\*Schedule:\*\* on-demand (v5.0 specified every 6 hours)

# \- \*\*Default gate:\*\* review (record changes), auto (reads and analysis)

# \- \*\*Phase:\*\* 4

# 

# \### Vision

# 

# The Finance agent gives the agency a continuous, accurate picture of its financial position without anyone having to manually reconcile anything. Revenue, costs, margins, anomalies — it syncs from connected integrations, computes the numbers, and writes them to memory where the Orchestrator and Strategic Intelligence agent can see them.

# 

# The most valuable thing the Finance agent does is near-real-time anomaly detection. A tool subscription that doubled its price, a payment that did not process, a client retainer that is overdue — these surface within hours rather than at the end of the month.

# 

# \### Wired skills (from `agents/finance-agent/AGENTS.md`)

# 

# | Skill | Gate | Purpose |

# |-------|------|---------|

# | `read\_workspace` | auto | Budget benchmarks, Orchestrator context |

# | `write\_workspace` | auto | Financial summaries and anomaly findings |

# | `read\_revenue` | auto | Pull revenue data from payment processors |

# | `read\_expenses` | auto | Pull expense data from accounting integrations |

# | `analyse\_financials` | auto | Internal calculations and anomaly detection |

# | `update\_financial\_record` | review | Propose expense corrections — human approves |

# | `request\_approval` | review | HITL gate on record changes |

# | `move\_task` / `update\_task` / `add\_deliverable` | auto | Standard board ops |

# 

# \*\*Note on v5.0 delta:\*\* v5.0 named the record-update skill `update\_record`; the shipped skill is `update\_financial\_record`.

# 

# \### What it should NOT do

# 

# \- Never initiate any payment or transfer of any kind

# \- Never modify financial records without human review

# \- Never produce anything that could be mistaken for formal accounting records or tax advice

# \- Never surface raw financial data to non-admin users

# 

# \### Outputs

# 

# \- Financial snapshot written to workspace memory each run

# \- Anomaly flags as task deliverables with supporting data

# \- Proposed record corrections in the review queue

# \- Daily financial summary injected into the Orchestrator directive

# 

# \---

# 

# \## Agent 11 — Content/SEO Agent

# 

# \- \*\*Slug:\*\* `content-seo-agent`

# \- \*\*Reports to:\*\* orchestrator

# \- \*\*Model:\*\* `claude-sonnet-4-6`

# \- \*\*Schedule:\*\* on-demand (v5.0 specified on-demand + weekly planning)

# \- \*\*Default gate:\*\* review (all published content)

# \- \*\*Phase:\*\* 4

# 

# \### Vision

# 

# The Social Media agent handles short-form content. The Content and SEO agent handles everything else: long-form blog posts, SEO articles, case studies, landing page copy, and lead magnets. It reads workspace context, researches the topic, drafts the content, and submits it for human review before anything publishes.

# 

# \### Wired skills (from `agents/content-seo-agent/AGENTS.md`)

# 

# | Skill | Gate | Purpose |

# |-------|------|---------|

# | `read\_workspace` | auto | Brand voice, content calendar, Orchestrator directives |

# | `write\_workspace` | auto | Performance insights, content briefs |

# | `web\_search` | auto | Topic research, competitor content, SEO keyword discovery |

# | `draft\_content` | auto | Long-form draft with section headings, body, and SEO recommendations |

# | `audit\_seo` | auto | On-page SEO audit for a page or content piece |

# | `create\_lead\_magnet` | review | Produce a lead magnet asset (checklist, template, guide, scorecard) — HITL |

# | `update\_page` | auto | Update existing page HTML, meta, or form config |

# | `publish\_page` | auto | Publish a draft page (gated upstream via `request\_approval`) |

# | `request\_approval` | review | HITL gate on publish actions |

# | `move\_task` / `update\_task` / `add\_deliverable` | auto | Standard board ops |

# 

# \### What it should NOT do

# 

# \- Never publish content without human review

# \- Never modify published pages without explicit task reference

# \- Never scrape competitor copy verbatim

# \- Never run auto-rewrites on existing content without a deliberate brief

# 

# \### Outputs

# 

# \- Long-form drafts in the review queue with SEO analysis

# \- Lead magnet assets in the review queue ready for campaign use

# \- Published pages (only after approval)

# \- Content performance summaries in workspace memory

# 

# \---

# 

# \## Agent 12 — Client Reporting Agent

# 

# \- \*\*Slug:\*\* `client-reporting-agent`

# \- \*\*Reports to:\*\* orchestrator

# \- \*\*Model:\*\* `claude-sonnet-4-6`

# \- \*\*Schedule:\*\* on-demand (v5.0 specified weekly Mon 09:00 + on-demand)

# \- \*\*Default gate:\*\* review (all report delivery)

# \- \*\*Phase:\*\* 5

# 

# \### Vision

# 

# The Client Reporting agent turns raw performance data into client-ready narratives. It pulls numbers from Ads, Social, Finance, and CRM, writes a structured report with executive summary and section narratives, and submits the final deliverable for human approval before sending it to the client.

# 

# \### Wired skills (from `agents/client-reporting-agent/AGENTS.md`)

# 

# | Skill | Gate | Purpose |

# |-------|------|---------|

# | `read\_workspace` | auto | Pull all client metrics, campaign results, and context |

# | `write\_workspace` | auto | Report drafts and delivery records |

# | `draft\_report` | auto | Produce a structured client report with exec summary and sections |

# | `deliver\_report` | review | Send approved report via configured delivery channel — HITL |

# | `request\_approval` | review | HITL gate on report delivery |

# | `move\_task` / `update\_task` / `add\_deliverable` | auto | Standard board ops |

# 

# \### What it should NOT do

# 

# \- Never deliver a report without human approval

# \- Never invent metrics that are not in the source data

# \- Never produce reports for clients without an active engagement record

# 

# \### Outputs

# 

# \- Draft reports in the review queue with supporting data

# \- Delivered reports logged as board deliverables with delivery confirmation

# \- Report templates and patterns in workspace memory

# 

# \---

# 

# \## Agent 13 — Onboarding Agent

# 

# \- \*\*Slug:\*\* `onboarding-agent`

# \- \*\*Reports to:\*\* orchestrator

# \- \*\*Model:\*\* `claude-sonnet-4-6` (v5.0 specified opus — downgraded during build)

# \- \*\*Schedule:\*\* on-demand (per new client)

# \- \*\*Default gate:\*\* review (all external setup)

# \- \*\*Phase:\*\* 5

# 

# \### Vision

# 

# The Onboarding agent guides a new client or workspace through integration setup, permission grants, and initial configuration. Every integration configuration goes through HITL approval — the agent never stores credentials without explicit human sign-off.

# 

# \### Wired skills (from `agents/onboarding-agent/AGENTS.md`)

# 

# | Skill | Gate | Purpose |

# |-------|------|---------|

# | `read\_workspace` | auto | Onboarding checklists, client context, previous configurations |

# | `write\_workspace` | auto | Onboarding progress and configuration notes |

# | `configure\_integration` | review | Walk through integration setup with human approval — HITL |

# | `request\_approval` | review | HITL gate on every configuration decision |

# | `move\_task` / `update\_task` / `add\_deliverable` | auto | Standard board ops |

# 

# \*\*Note on v5.0 delta:\*\* The Onboarding Agent is currently the leanest wired agent on disk (7 skills). v5.0 discussed richer onboarding workflows — those remain aspirational and will be added as the Phase 5 build progresses.

# 

# \### What it should NOT do

# 

# \- Never store integration credentials without human approval

# \- Never complete onboarding steps on behalf of the client

# \- Never skip a configuration step without explicit deferral

# 

# \### Outputs

# 

# \- Integration configurations in the review queue

# \- Onboarding progress tracked as board deliverables

# \- Configuration notes in workspace memory for future reference

# 

# \---

# 

# \## Agent 14 — CRM/Pipeline Agent

# 

# \- \*\*Slug:\*\* `crm-pipeline-agent`

# \- \*\*Reports to:\*\* orchestrator

# \- \*\*Model:\*\* `claude-sonnet-4-6`

# \- \*\*Schedule:\*\* on-demand (v5.0 specified every 6 hours)

# \- \*\*Default gate:\*\* review (all CRM writes)

# \- \*\*Phase:\*\* 5

# 

# \### Vision

# 

# The CRM/Pipeline agent keeps deal data current, identifies stalled opportunities, drafts follow-ups for stale contacts, and flags churn risk on existing accounts. Every CRM write — contact update, deal stage change, note addition — goes through HITL review.

# 

# \### Wired skills (from `agents/crm-pipeline-agent/AGENTS.md`)

# 

# | Skill | Gate | Purpose |

# |-------|------|---------|

# | `read\_workspace` | auto | ICP criteria, pipeline rules, Orchestrator directives |

# | `write\_workspace` | auto | Pipeline insights, velocity metrics, at-risk account notes |

# | `read\_crm` | auto | Pull contact, deal, and pipeline data from connected CRM |

# | `analyse\_pipeline` | auto | Internal analysis of velocity, stage conversion, stale deals |

# | `detect\_churn\_risk` | auto | Score existing accounts for churn risk from CRM signals |

# | `draft\_followup` | auto | Draft contextually personalised follow-up emails |

# | `send\_email` | auto | Send follow-up (gated upstream via `request\_approval`) |

# | `update\_crm` | review | Write CRM updates — human approves |

# | `request\_approval` | review | HITL gate on CRM writes and outbound emails |

# | `move\_task` / `update\_task` / `add\_deliverable` | auto | Standard board ops |

# 

# \### What it should NOT do

# 

# \- Never write to the CRM without human approval

# \- Never mark deals as won or lost autonomously

# \- Never delete CRM records under any circumstances

# \- Never send outreach to contacts on a suppression list

# 

# \### Outputs

# 

# \- Pipeline velocity and conversion analysis in workspace memory

# \- Draft follow-up emails in the review queue for stale deals

# \- Churn risk flags as board task deliverables

# \- Proposed CRM updates in the review queue

# 

# \---

# 

# \## Agent 15 — Knowledge Management Agent

# 

# \- \*\*Slug:\*\* `knowledge-management-agent`

# \- \*\*Reports to:\*\* orchestrator

# \- \*\*Model:\*\* `claude-sonnet-4-6`

# \- \*\*Schedule:\*\* on-demand (v5.0 specified daily 08:00)

# \- \*\*Default gate:\*\* review (doc updates)

# \- \*\*Phase:\*\* 5

# 

# \### Vision

# 

# The Knowledge Management agent keeps internal documentation aligned with code and process reality. It reads docs, diffs them against current behaviour, and proposes targeted updates through HITL review. It also authors new documentation when gaps are identified.

# 

# \### Wired skills (from `agents/knowledge-management-agent/AGENTS.md`)

# 

# | Skill | Gate | Purpose |

# |-------|------|---------|

# | `read\_workspace` | auto | Documentation inventory, recent changes, open gaps |

# | `write\_workspace` | auto | Doc change notes and gap reports |

# | `read\_docs` | auto | Retrieve documentation pages from connected doc source |

# | `propose\_doc\_update` | review | Propose a specific doc update as a diff — HITL |

# | `write\_docs` | review | Apply an approved doc update — HITL |

# | `request\_approval` | review | HITL gate on doc changes |

# | `move\_task` / `update\_task` / `add\_deliverable` | auto | Standard board ops |

# 

# \### What it should NOT do

# 

# \- Never publish or modify documentation without human approval

# \- Never delete existing documentation

# \- Never author documentation for features that do not exist

# 

# \### Outputs

# 

# \- Proposed doc updates in the review queue with diff-style changes

# \- Gap reports written to workspace memory

# \- New documentation in the review queue when gaps are filled

# 

# \---

# 

# \## Agent 16 — Portfolio Health Agent

# 

# \- \*\*Slug:\*\* `portfolio-health-agent`

# \- \*\*Reports to:\*\* null (operates outside the business-team hierarchy)

# \- \*\*Model:\*\* `claude-sonnet-4-6`

# \- \*\*Schedule:\*\* `\*/4 \* \* \*` (every 4 hours)

# \- \*\*Default gate:\*\* auto

# \- \*\*Execution scope:\*\* `org` (not `subaccount`)

# \- \*\*Phase:\*\* special (not part of the sequential build — ships independently)

# 

# \### Vision

# 

# The Portfolio Health Agent is the one system agent that operates at organisation scope rather than subaccount scope. It runs against all subaccounts in an org, computes health scores, detects anomalies, scores churn risk, and generates portfolio-wide intelligence briefings. It does not coordinate with the Orchestrator — it writes to a separate org-level memory surface (`read\_org\_insights` / `write\_org\_insight`) that the human operator and Strategic Intelligence Agent can read.

# 

# The Portfolio Health Agent is deliberately outside the business-team hierarchy because it crosses subaccount boundaries. Giving it a place in the Orchestrator-led team would muddle the per-subaccount scoping model that every other agent respects. It is an org-level monitor, and its outputs are read by the human operator to identify which subaccounts need attention.

# 

# \### Wired skills (from `agents/portfolio-health-agent/AGENTS.md`)

# 

# | Skill | Gate | Purpose |

# |-------|------|---------|

# | `compute\_health\_score` | auto | Calculate composite health score (0–100) for each subaccount |

# | `detect\_anomaly` | auto | Compare current metrics against historical baseline |

# | `compute\_churn\_risk` | auto | Score each subaccount for churn risk and propose intervention |

# | `generate\_portfolio\_report` | auto | Structured intelligence briefing across the portfolio |

# | `query\_subaccount\_cohort` | auto | Read board health and memory across cohorts of subaccounts |

# | `read\_org\_insights` | auto | Query cross-subaccount insights from org-level memory |

# | `write\_org\_insight` | auto | Store cross-subaccount patterns in org-level memory |

# | `trigger\_account\_intervention` | auto | Propose an intervention action for a subaccount (HITL-gated upstream) |

# 

# \### What it should NOT do

# 

# \- Never write to individual subaccount workspace memory — only org-level memory

# \- Never invoke business-team agents directly

# \- Never make interventions without HITL approval via `trigger\_account\_intervention`

# \- Never expose cross-subaccount data to users who lack org-level permissions

# 

# \### Outputs

# 

# \- Health scores per subaccount written to org-level memory every 4 hours

# \- Anomaly flags and churn risk scores in org-level memory

# \- Portfolio intelligence briefings in org-level memory

# \- Intervention proposals routed through HITL review

# 

# \---

# 

# \## Appendix A — Skill → Agent Cross-Reference

# 

# This table lists every \*\*wired\*\* skill (present in at least one AGENTS.md frontmatter) and every agent that uses it. Orphan skills — those present on disk but not referenced by any agent — are listed separately in Appendix B.

# 

# \### Skills shared across many agents

# 

# | Skill | Gate | Used By |

# |-------|------|---------|

# | `read\_workspace` | auto | all 15 business agents + Orchestrator (16 total) |

# | `write\_workspace` | auto | all 15 business agents + Orchestrator (16 total) |

# | `move\_task` | auto | all 15 business agents + Orchestrator (16 total) |

# | `update\_task` | auto | all 15 business agents + Orchestrator (16 total) |

# | `add\_deliverable` | review | all 14 non-Orchestrator business agents (14 total) |

# | `request\_approval` | review | all 15 business agents + Orchestrator (16 total) |

# | `create\_task` | auto | business-analyst, dev, orchestrator, qa (4 total) |

# 

# \### Domain-specific skill wiring

# 

# | Skill | Gate | Used By |

# |-------|------|---------|

# | `read\_codebase` | auto | business-analyst, dev, qa, support-agent |

# | `search\_codebase` | auto | dev, qa |

# | `draft\_architecture\_plan` | auto | dev |

# | `draft\_tech\_spec` | auto | dev |

# | `review\_ux` | auto | dev |

# | `review\_code` | auto | dev |

# | `write\_patch` | review | dev |

# | `write\_tests` | auto | dev, qa |

# | `run\_tests` | auto | dev, qa |

# | `run\_command` | auto | dev |

# | `create\_pr` | auto | dev |

# | `derive\_test\_cases` | auto | qa |

# | `analyze\_endpoint` | auto | qa |

# | `capture\_screenshot` | auto | qa |

# | `run\_playwright\_test` | auto | qa |

# | `report\_bug` | auto | qa |

# | `draft\_requirements` | auto | business-analyst |

# | `write\_spec` | review | business-analyst |

# | `ask\_clarifying\_question` | auto | business-analyst |

# | `triage\_intake` | auto | business-analyst, orchestrator |

# | `reassign\_task` | auto | orchestrator |

# | `spawn\_sub\_agents` | auto | orchestrator |

# | `web\_search` | auto | business-analyst, content-seo-agent, strategic-intelligence-agent |

# | `classify\_email` | auto | support-agent |

# | `draft\_reply` | auto | support-agent |

# | `search\_knowledge\_base` | auto | support-agent |

# | `draft\_post` | auto | social-media-agent |

# | `publish\_post` | review | social-media-agent |

# | `read\_analytics` | auto | social-media-agent |

# | `read\_campaigns` | auto | ads-management-agent |

# | `analyse\_performance` | auto | ads-management-agent |

# | `draft\_ad\_copy` | auto | ads-management-agent |

# | `update\_bid` | review | ads-management-agent |

# | `update\_copy` | review | ads-management-agent |

# | `pause\_campaign` | \*\*block\*\* | ads-management-agent |

# | `increase\_budget` | \*\*block\*\* | ads-management-agent |

# | `enrich\_contact` | auto | email-outreach-agent |

# | `draft\_sequence` | auto | email-outreach-agent |

# | `send\_email` | auto | support-agent, email-outreach-agent, crm-pipeline-agent |

# | `update\_crm` | review | email-outreach-agent, crm-pipeline-agent |

# | `generate\_competitor\_brief` | auto | strategic-intelligence-agent |

# | `synthesise\_voc` | auto | strategic-intelligence-agent |

# | `read\_revenue` | auto | finance-agent |

# | `read\_expenses` | auto | finance-agent |

# | `analyse\_financials` | auto | finance-agent |

# | `update\_financial\_record` | review | finance-agent |

# | `draft\_content` | auto | content-seo-agent |

# | `audit\_seo` | auto | content-seo-agent |

# | `create\_lead\_magnet` | review | content-seo-agent |

# | `update\_page` | auto | content-seo-agent |

# | `publish\_page` | auto | content-seo-agent |

# | `draft\_report` | auto | client-reporting-agent |

# | `deliver\_report` | review | client-reporting-agent |

# | `configure\_integration` | review | onboarding-agent |

# | `read\_crm` | auto | crm-pipeline-agent |

# | `analyse\_pipeline` | auto | crm-pipeline-agent |

# | `detect\_churn\_risk` | auto | crm-pipeline-agent |

# | `draft\_followup` | auto | crm-pipeline-agent |

# | `read\_docs` | auto | knowledge-management-agent |

# | `propose\_doc\_update` | review | knowledge-management-agent |

# | `write\_docs` | review | knowledge-management-agent |

# | `compute\_health\_score` | auto | portfolio-health-agent |

# | `detect\_anomaly` | auto | portfolio-health-agent |

# | `compute\_churn\_risk` | auto | portfolio-health-agent |

# | `generate\_portfolio\_report` | auto | portfolio-health-agent |

# | `query\_subaccount\_cohort` | auto | portfolio-health-agent |

# | `read\_org\_insights` | auto | portfolio-health-agent |

# | `write\_org\_insight` | auto | portfolio-health-agent |

# | `trigger\_account\_intervention` | auto | portfolio-health-agent |

# 

# \---

# 

# \## Appendix B — Orphan Skills (unwired on disk)

# 

# The following 14 skill files exist in `server/skills/` but are not referenced in the `skills:` array of any agent frontmatter. They are shipped but dormant. Each needs either (a) wiring into an agent's frontmatter or (b) removal if superseded.

# 

# | Skill | Gate | Likely Owner | Status |

# |-------|------|--------------|--------|

# | `read\_inbox` | auto | support-agent | Needs wiring — Phase 2 inbox integration pending |

# | `send\_to\_slack` | auto | orchestrator / support-agent | Needs wiring or decision on Slack strategy |

# | `update\_memory\_block` | auto | any | Superseded by `write\_workspace` for most cases — consider removal |

# | `read\_data\_source` | auto | any analytical agent | Needs wiring once data-source feature lands |

# | `trigger\_process` | auto | orchestrator | Needs wiring if automation workflows are revived |

# | `fetch\_url` | auto | strategic-intelligence-agent, content-seo-agent | Needs wiring for competitor page diffs and content research |

# | `fetch\_paywalled\_content` | auto | strategic-intelligence-agent | Needs wiring — currently supersedes `fetch\_url` for auth'd sources |

# | `transcribe\_audio` | auto | knowledge-management-agent, content-seo-agent | Needs wiring or removal |

# | `analyse\_42macro\_transcript` | auto | special-purpose | Vestigial — review for removal |

# | `playbook\_estimate\_cost` | auto | Playbook Author flow | Playbook-author specific — not a system agent skill |

# | `playbook\_propose\_save` | auto | Playbook Author flow | Playbook-author specific |

# | `playbook\_read\_existing` | auto | Playbook Author flow | Playbook-author specific |

# | `playbook\_simulate` | auto | Playbook Author flow | Playbook-author specific |

# | `playbook\_validate` | auto | Playbook Author flow | Playbook-author specific |

# 

# \*\*Dangling references:\*\* none. Every skill slug referenced in agent frontmatter exists on disk.

# 

# \*\*Playbook skills note:\*\* The five `playbook\_\*` skills belong to the Playbook Author flow (separate from the system-agent roster) and are referenced by that feature's dedicated seed script. They are not orphans in the operational sense — they are just not wired to any of the 16 system agents. They are listed here for completeness so a future audit doesn't attempt to wire them into a business agent.

# 

# \---

# 

# \## Appendix C — Source of Truth \& Drift Protocol

# 

# \### The hierarchy of truth

# 

# 1\. \*\*`companies/automation-os/agents/<slug>/AGENTS.md`\*\* — the authoritative runtime definition. `scripts/seed-system.ts` reads this directly via `parseCompanyFolder` in `scripts/lib/companyParser.ts`. The database row for each agent in `system\_agents` is derived from this file.

# 2\. \*\*`companies/automation-os/COMPANY.md`\*\* — the top-level manifest frontmatter. Only the frontmatter is read by the parser (name, description, slug, schema, version). The body is documentation.

# 3\. \*\*`companies/automation-os/automation-os-manifest.json`\*\* — human-readable index only. Not read by any code path. It exists to give a single-file view of the roster and must be updated when agents are added or removed.

# 4\. \*\*`docs/system-agents-master-brief-v6.md`\*\* (this document) — the architectural brief. Describes the shape and reasoning. Must be updated when agent wiring, skill wiring, or phase assignments change.

# 

# When these four sources conflict, the AGENTS.md files win. Everything else needs updating.

# 

# \### Drift protocol

# 

# When making a change that touches any agent's behaviour, skill wiring, gate model, schedule, or model assignment, update the artifacts in this order:

# 

# 1\. Edit the corresponding `agents/<slug>/AGENTS.md` file

# 2\. If adding or removing an agent: update `automation-os-manifest.json` AND the Full Agent Roster table in this document

# 3\. If changing a skill's gate or wiring: update the affected agent's skill table in this document AND Appendix A

# 4\. Commit all three (or four) files in the same PR — drift between them is a review-blocking issue

# 

# \### Verifying the brief matches reality

# 

# To confirm this document matches the code, run:

# 

# ```bash

# npx tsx scripts/seed-system.ts

# ```

# 

# The script will print each agent it creates or updates. The count should be 16. The slugs should match the Full Agent Roster table exactly. If the script outputs `\[warn] reportsTo slug not found`, there is a hierarchy mismatch that needs fixing in the corresponding AGENTS.md `reportsTo:` field.

# 

# \---

# 

# \*\*End of Brief — v6.0\*\*

