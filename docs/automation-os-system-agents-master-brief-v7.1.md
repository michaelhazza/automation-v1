# Automation OS — System Agents Master Brief
Architecture, Roles, Skill Wiring & Build Sequence

| Field | Value |
|-------|-------|
| Version | 7.1 |
| Date | April 2026 |
| Status | Living document — source of truth for all system agent design decisions |
| Predecessor | v7.0 (April 2026) |

---

## Table of Contents

1. [Changes from v7.0](#1-changes-from-v70)
2. [Overview](#2-overview)
3. [Organisational Structure](#3-organisational-structure)
4. [Manager Agent Design Principles](#4-manager-agent-design-principles)
5. [Gate Model Reference](#5-gate-model-reference)
6. [Full Agent Roster](#6-full-agent-roster)
7. [Build Sequence](#7-build-sequence)
8. [Product Development Team Architecture](#8-product-development-team-architecture)
9. [Agent 1 — Orchestrator (COO)](#9-agent-1--orchestrator-coo)
10. [Agent 2 — Head of Product Engineering (CTO)](#10-agent-2--head-of-product-engineering-cto)
11. [Agent 3 — Head of Growth (CMO)](#11-agent-3--head-of-growth-cmo)
12. [Agent 4 — Head of Client Services (CCO)](#12-agent-4--head-of-client-services-cco)
13. [Agent 5 — Head of Commercial (CRO)](#13-agent-5--head-of-commercial-cro)
14. [Agent 6 — Admin-Ops Agent](#14-agent-6--admin-ops-agent)
15. [Agent 7 — Business Analyst](#15-agent-7--business-analyst)
16. [Agent 8 — Dev Agent](#16-agent-8--dev-agent)
17. [Agent 9 — QA Agent](#17-agent-9--qa-agent)
18. [Agent 10 — Knowledge Management Agent](#18-agent-10--knowledge-management-agent)
19. [Agent 11 — Support Agent](#19-agent-11--support-agent)
20. [Agent 12 — Onboarding Agent](#20-agent-12--onboarding-agent)
21. [Agent 13 — Retention/Success Agent](#21-agent-13--retentionsuccess-agent)
22. [Agent 14 — Social Media Agent](#22-agent-14--social-media-agent)
23. [Agent 15 — Ads Management Agent](#23-agent-15--ads-management-agent)
24. [Agent 16 — Email Outreach Agent](#24-agent-16--email-outreach-agent)
25. [Agent 17 — Content/SEO Agent](#25-agent-17--contentseo-agent)
26. [Agent 18 — Strategic Intelligence Agent](#26-agent-18--strategic-intelligence-agent)
27. [Agent 19 — Finance Agent](#27-agent-19--finance-agent)
28. [Agent 20 — CRM/Pipeline Agent](#28-agent-20--crmpipeline-agent)
29. [Agent 21 — SDR/Lead-Qualification Agent](#29-agent-21--sdrlead-qualification-agent)
30. [Agent 22 — Portfolio Health Agent](#30-agent-22--portfolio-health-agent)
- [Appendix A — Skill to Agent Cross-Reference](#appendix-a--skill-to-agent-cross-reference)
- [Appendix B — Skill Wiring Audit (v6.0, carried forward)](#appendix-b--skill-wiring-audit-v60-carried-forward)
- [Appendix C — Source of Truth & Drift Protocol](#appendix-c--source-of-truth--drift-protocol)
- [Appendix D — Skill Visibility Rule](#appendix-d--skill-visibility-rule)
- [Appendix E — Hierarchy Infrastructure Dependencies](#appendix-e--hierarchy-infrastructure-dependencies)
- [Appendix F — Content/SEO + Social Media Merge Investigation Brief](#appendix-f--contentseo--social-media-merge-investigation-brief)

---

## 1. Changes from v7.0

v7.1 applies findings from a structural review against multi-agent best practices (Anthropic multi-agent guidance, LangGraph/CrewAI/AutoGen patterns, Mintzberg's simple-structure configuration, McKinsey/BCG/Deloitte SME operating-model research). Three agents are added, one is retired, and one is rescoped. The three-tier hierarchy from v7.0 is preserved.

**Twenty-two agents on disk, not twenty.** Three new agents added; one retired. Net change: +2.

**Admin-Ops Agent added** (`admin-ops-agent`). New T2 staff agent reporting directly to the Orchestrator. Covers invoicing, Stripe/Xero reconciliation, AR dunning and late-payment chase, AP/bill pay, expense and receipt capture, vendor onboarding, SaaS subscription tracking, and month-end close prep. This was the single biggest capability gap identified in the structural review: the highest-frequency, highest-ROI back-office function was entirely absent. Admin-Ops is a COO function, not a CRO function. Placing it under Commercial would create incentive conflicts (a CRO-owned agent is structurally biased against chasing a strategic customer's overdue invoice).

**SDR/Lead-Qualification Agent added** (`sdr-agent`). New T3 worker under Head of Commercial (CRO). Covers outbound prospecting, inbound lead triage and enrichment, and meeting booking. This is one of the most mature agent use cases (Apollo, Clay, Smartlead, 11x-class workflows) and closes a revenue-generation gap. The boundary with Email Outreach (under CMO) is clean: CMO Email Outreach handles nurture, broadcast, and newsletter sequences. CRO SDR handles 1:1 prospecting with reply handling.

**Retention/Success Agent added** (`retention-success-agent`). New T3 worker under Head of Client Services (CCO). Covers proactive churn-risk scoring, NPS/CSAT, renewal prep, and QBR support. Absorbs Client Reporting's skills (`draft_report`, `deliver_report`) since reporting is a format-transformation skill, not a distinct role with its own tools or stakeholders.

**Client Reporting Agent retired.** Its two domain-specific skills (`draft_report`, `deliver_report`) are absorbed into the Retention/Success Agent. Reporting remains available; it is now part of a broader customer-success function rather than a standalone agent.

**Finance Agent rescoped.** Bookkeeping, AR/AP, reconciliation, and expense management responsibilities move to Admin-Ops. Finance retains revenue analytics, anomaly detection, and financial snapshot generation. It remains under the CRO as a revenue-intelligence function. Renamed in the roster to clarify scope but slug unchanged for backward compatibility.

**Orchestrator direct reports now 6.** Four department heads + Strategic Intelligence + Admin-Ops. This sits at the upper edge of the 4–7 ideal span of control identified in the structural review but within the hard ceiling of 8.

**Agent count.** Automation OS company count is now 22 (was 20). The Playbook Author remains the 23rd.

**Investigation pending: Content/SEO + Social Media merge.** These two agents share calendar, brand voice, source material, and analytics. A merge investigation is documented in Appendix F for Claude Code to evaluate based on combined skill count and context-window impact.

**SDR agent gains `discover_prospects` skill.** Google Places API caller that finds SMB prospects matching geo + vertical + size criteria. Implementation spec in `docs/dev-briefs/sdr-lead-discovery.md`.

---

## 2. Overview

Automation OS runs its own business on the platform it builds. The twenty-two system agents are the first-customer team: they build the platform, run its commercial operations, monitor its clients, and file bugs against themselves.

The network operates asynchronously. Agents communicate through shared state: workspace memory (context and insights), the task board (work items and handoffs), Orchestrator directives (daily coordination), and the HITL review queue (any action with external or irreversible blast radius).

The three-tier hierarchy provides genuine departmental coordination. The Orchestrator delegates to department heads and staff agents, who decompose work and route it to the right worker. The Orchestrator's fan-out is 6 direct reports (four department heads, Strategic Intelligence, and Admin-Ops).

**v5.0 to v6.0 integration decisions (carried forward):**
- Business Analyst is a full agent because its outputs are independently consumed by both Dev and QA. Folding it into the Orchestrator would contaminate the coordination layer with product-thinking context.
- Architect and Builder merge into the Dev Agent via enforced phase sequence (plan > spec > ux > implement > self-review > submit).
- Tech-spec, UX review, and PR review are skills (`draft_tech_spec`, `review_ux`, `review_code`) invoked by Dev at the appropriate phase.
- Triage is a skill (`triage_intake`) available to Orchestrator and Business Analyst.
- System Test Analyst patterns are absorbed into QA via Gherkin traceability and structured failure classification (APP BUG / TEST BUG / ENVIRONMENT).

**v7.0 hierarchy rationale (carried forward):**
- Product Engineering is the largest natural cluster (4 agents, full build pipeline). The manager earns their keep immediately by coordinating the BA > Dev > QA handoff chain.
- Growth groups four marketing-adjacent agents that benefit from campaign-level coordination (Social, Ads, Email, Content/SEO).
- Client Services covers the full client lifecycle: land (Support) > onboard (Onboarding) > retain and report (Retention/Success).
- Commercial pairs revenue ops (CRM/Pipeline, SDR) with revenue intelligence (Finance).
- Strategic Intelligence stays direct-to-COO because it is a meta/advisory function, not a department.
- Admin-Ops stays direct-to-COO because it is a back-office staff function that serves every department.
- Portfolio Health stays orthogonal. It is the watchdog and should not be in the delivery tree.

**v7.1 structural review rationale:**
- Admin-Ops closes the money-movement gap (highest-ROI addition).
- SDR closes the revenue-generation gap (most mature agent use case).
- Retention/Success closes the recurring-revenue gap (material for any SaaS business).
- Client Reporting dissolved because reporting is a skill, not a role (no distinct tools, metrics, or stakeholders).
- Finance rescoped to avoid overlap with Admin-Ops (bookkeeping/AR/AP vs revenue analytics).

---

## 3. Organisational Structure

The human operator is the CEO. The Orchestrator is the COO. Four department heads and two staff agents report to the Orchestrator. Workers report to their department head.

```
Human (CEO)
  ├── Orchestrator (COO)
  │     ├── Head of Product Engineering (CTO)              [MVP]
  │     │     ├── Business Analyst                         [MVP]
  │     │     ├── Dev Agent                                [MVP]
  │     │     ├── QA Agent                                 [MVP]
  │     │     └── Knowledge Management Agent               [Phase 5]
  │     │
  │     ├── Head of Growth (CMO)                           [Phase 3]
  │     │     ├── Social Media Agent                       [Phase 3]
  │     │     ├── Ads Management Agent                     [Phase 3]
  │     │     ├── Email Outreach Agent                     [Phase 3]
  │     │     └── Content/SEO Agent                        [Phase 4]
  │     │
  │     ├── Head of Client Services (CCO)                  [Phase 2]
  │     │     ├── Support Agent                            [Phase 2]
  │     │     ├── Onboarding Agent                         [Phase 5]
  │     │     └── Retention/Success Agent                  [Phase 5]
  │     │
  │     ├── Head of Commercial (CRO)                       [Phase 4]
  │     │     ├── Finance Agent                            [Phase 4]
  │     │     ├── CRM/Pipeline Agent                       [Phase 5]
  │     │     └── SDR/Lead-Qualification Agent             [Phase 5]
  │     │
  │     ├── Admin-Ops Agent                                [Phase 4]
  │     │
  │     └── Strategic Intelligence Agent                   [Phase 4]
  │
  └── Portfolio Health Agent                               [special — org scope, not in business team]
```

The Portfolio Health Agent reports to `null`. It runs at `executionScope: org`, writes to org-level memory only, and is a monitoring surface, not a business-team member.

Strategic Intelligence Agent and Admin-Ops Agent both report directly to the Orchestrator as staff functions. Strategic Intelligence is cross-cutting advisory. Admin-Ops is back-office operations that serves every department.

---

## 4. Manager Agent Design Principles

Manager agents are fundamentally different from workers. Their masterPrompt encodes a coordination role, not a domain execution role. Every manager follows the same operational pattern:

1. **Vet incoming requests.** Is this work in scope for this department? If not, kick back to COO with a re-route suggestion.
2. **Decompose the request.** Break it into discrete tasks the team can execute. For compound requests, identify dependencies and sequencing.
3. **Pick the right subordinate.** Use `list_my_subordinates` to see available workers, then select based on the work's nature and each worker's role definition.
4. **Delegate.** Use `spawn_sub_agents` (scope=children) for parallel independent tracks, or `reassign_task` (scope=children) for single-worker routing.
5. **Aggregate and synthesise.** Take outputs back from workers, produce a single department-level deliverable. Add department-level judgement: did the outputs meet the request? Are there cross-worker conflicts or gaps?
6. **Report back to the COO.** Not a pass-through. The manager adds value by summarising, flagging risks, and providing a departmental perspective the COO would not get from raw worker output.

### Delegation skill bundle (all managers)

Every manager agent is wired with the following skills in addition to the standard workspace/board primitives:

| Skill | Gate | Purpose |
|-------|------|---------|
| `list_my_subordinates` | auto | Query available workers in this department (scope=children) |
| `spawn_sub_agents` | auto | Trigger parallel sub-task execution scoped to children |
| `reassign_task` | auto | Route a task to a specific subordinate (scope=children) |
| `read_workspace` | auto | Full read of memory, tasks, recent runs |
| `write_workspace` | auto | Write department-level summaries and coordination notes |
| `create_task` | auto | Create coordination and sub-tasks on the board |
| `move_task` | auto | Update task status as part of delegation logic |
| `update_task` | auto | Edit task content when coordinating |
| `add_deliverable` | auto | Attach department-level deliverables to tasks |
| `request_approval` | review | Escalate coordination decisions requiring human input |

### Design decisions

**On-demand only.** A manager with a heartbeat schedule mostly burns tokens. Managers wake when the COO delegates to them, not on a clock. Workers keep their existing schedules where applicable.

**Always delegate, never execute.** If the manager "just does it," the hierarchy loses meaning. Even trivially small work is routed to the appropriate worker. The manager cites its reasoning and delegates. Cheap to do, but preserves the invariant.

**Lower token budget.** Manager runs are decompose-delegate-aggregate. Set `tokenBudgetPerRun` to roughly 30% of a standard worker's budget to reflect the shorter execution profile.

**Domain-specific read skills.** Beyond the delegation bundle, each manager gets read-only access to relevant domain data so it can make informed routing decisions. The Head of Growth reads campaign metrics. The Head of Commercial reads revenue data. These are listed in each manager's individual definition below.

---

## 5. Gate Model Reference

| Gate | Behaviour | Used For |
|------|-----------|---------|
| `auto` | Executes immediately, logged | Reads, internal analysis, memory updates, board writes, test runs, codebase reads |
| `review` | Creates review item, pauses until approved | Outbound communications, code patches, spec documents, CRM writes, financial records, ad copy/bid changes, published content, invoicing actions |
| `block` | Never executes autonomously | Budget increases, campaign pauses, production deploys, merges, account deletion, payment initiation |

Each agent has a default gate in its frontmatter; individual skills override per-invocation. Scheduled background workers (Orchestrator, QA, Portfolio Health) default to `auto`. All four manager agents default to `auto` (their work is internal coordination). Admin-Ops defaults to `review` (back-office actions with financial consequences). All remaining business worker agents default to `review`.

---

## 6. Full Agent Roster

| # | Agent | Slug | Tier | Reports To | Model | Schedule | Default Gate | Phase |
|---|-------|------|------|------------|-------|----------|--------------|-------|
| 1 | Orchestrator (COO) | `orchestrator` | T1 | null | opus-4-6 | `0 6,20 * * *` | auto | MVP |
| 2 | Head of Product Engineering (CTO) | `head-of-product-engineering` | T2 | orchestrator | sonnet-4-6 | on-demand | auto | MVP |
| 3 | Head of Growth (CMO) | `head-of-growth` | T2 | orchestrator | sonnet-4-6 | on-demand | auto | 3 |
| 4 | Head of Client Services (CCO) | `head-of-client-services` | T2 | orchestrator | sonnet-4-6 | on-demand | auto | 2 |
| 5 | Head of Commercial (CRO) | `head-of-commercial` | T2 | orchestrator | sonnet-4-6 | on-demand | auto | 4 |
| 6 | Admin-Ops Agent | `admin-ops-agent` | T2 | orchestrator | sonnet-4-6 | on-demand | review | 4 |
| 7 | Business Analyst | `business-analyst` | T3 | head-of-product-engineering | sonnet-4-6 | on-demand | review | MVP |
| 8 | Dev Agent | `dev` | T3 | head-of-product-engineering | opus-4-6 | on-demand | review | MVP |
| 9 | QA Agent | `qa` | T3 | head-of-product-engineering | sonnet-4-6 | `0 2 * * *` | auto | MVP |
| 10 | Knowledge Management Agent | `knowledge-management-agent` | T3 | head-of-product-engineering | sonnet-4-6 | on-demand | review | 5 |
| 11 | Support Agent | `support-agent` | T3 | head-of-client-services | sonnet-4-6 | on-demand | review | 2 |
| 12 | Onboarding Agent | `onboarding-agent` | T3 | head-of-client-services | sonnet-4-6 | on-demand | review | 5 |
| 13 | Retention/Success Agent | `retention-success-agent` | T3 | head-of-client-services | sonnet-4-6 | on-demand | review | 5 |
| 14 | Social Media Agent | `social-media-agent` | T3 | head-of-growth | sonnet-4-6 | on-demand | review | 3 |
| 15 | Ads Management Agent | `ads-management-agent` | T3 | head-of-growth | sonnet-4-6 | on-demand | review | 3 |
| 16 | Email Outreach Agent | `email-outreach-agent` | T3 | head-of-growth | sonnet-4-6 | on-demand | review | 3 |
| 17 | Content/SEO Agent | `content-seo-agent` | T3 | head-of-growth | sonnet-4-6 | on-demand | review | 4 |
| 18 | Strategic Intelligence Agent | `strategic-intelligence-agent` | T2 | orchestrator | sonnet-4-6 | on-demand | review | 4 |
| 19 | Finance Agent | `finance-agent` | T3 | head-of-commercial | sonnet-4-6 | on-demand | review | 4 |
| 20 | CRM/Pipeline Agent | `crm-pipeline-agent` | T3 | head-of-commercial | sonnet-4-6 | on-demand | review | 5 |
| 21 | SDR/Lead-Qualification Agent | `sdr-agent` | T3 | head-of-commercial | sonnet-4-6 | on-demand | review | 5 |
| 22 | Portfolio Health Agent | `portfolio-health-agent` | -- | null | sonnet-4-6 | `*/4 * * *` | auto | special |

> **Tier key:** T1 = Executive (Orchestrator). T2 = Department Head / Staff Agent / Direct Report. T3 = Worker. Portfolio Health Agent is outside the tier system.
> All values are read directly from AGENTS.md frontmatter files. If this table conflicts with the code, the code is right.
> **Retired in v7.1:** Client Reporting Agent (`client-reporting-agent`). Skills absorbed into Retention/Success Agent. See [Changes from v7.0](#1-changes-from-v70).

---

## 7. Build Sequence

| Phase | Agents | Primary Beneficiary | Depends On |
|-------|--------|---------------------|------------|
| MVP | Orchestrator, Head of Product Engineering, Business Analyst, Dev, QA | Platform builders | Validates full infrastructure stack including hierarchy routing |
| 2 | Head of Client Services (CCO), Support | Platform businesses | MVP primitives proven in production |
| 3 | Head of Growth, Social Media, Ads Management, Email Outreach | Agency clients | Phase 2 review gates validated end-to-end |
| 4 | Head of Commercial, Strategic Intelligence, Admin-Ops, Finance, Content/SEO | Agency clients | Phase 3 agents generating data signals |
| 5 | Onboarding, Retention/Success, CRM/Pipeline, SDR/Lead-Qual, Knowledge Management | Agency clients | Phase 4 stable and data-rich |
| Special | Portfolio Health | Platform operators | Independent — monitors across subaccounts |
| 6 | Docker/Playwright infrastructure | Dev and QA agents | Parallel — does not block Phase 3 onward |

> Each manager agent deploys in the same phase as its earliest worker. Admin-Ops deploys at Phase 4 alongside its first integration dependencies (Stripe, Xero).

---

## 8. Product Development Team Architecture

### Development pipeline

The Head of Product Engineering coordinates this pipeline. The COO delegates product work to the Head of Product Engineering, who decomposes it, routes to the right worker, and aggregates the result.

```
COO delegates product work to Head of Product Engineering
  │
  ├── Simple bug fix or small change
  │     └── Head routes directly to Dev Agent
  │           ├── draft_architecture_plan (auto) — internal planning
  │           ├── review_code (auto) — self-review
  │           ├── write_patch (review) — HITL: human approves diff
  │           └── Head routes to QA Agent for post-patch validation
  │
  └── Feature or significant change
        └── Head routes to Business Analyst
              ├── draft_requirements (auto) — user stories + Gherkin ACs
              └── write_spec (review) — HITL: human approves spec before Dev begins
              │
              └── Head routes approved spec to Dev Agent
                    ├── draft_architecture_plan (auto)
                    ├── draft_tech_spec (auto, if API changes involved)
                    ├── review_ux (auto, if UI changes involved)
                    ├── Implements code
                    ├── review_code (auto) — self-review
                    └── write_patch (review) — HITL: human approves diff
                    │
                    └── Head routes to QA Agent
                          ├── derive_test_cases from Gherkin ACs
                          ├── run_tests (auto)
                          └── report_bug (auto) if failures found
                    │
                    └── Head aggregates results, reports to COO
```

### Revision loop caps

| Loop | Cap | Escalation |
|------|-----|------------|
| BA spec revisions | 3 rounds | Dev Agent flags ambiguity to board, escalates to Head of Product Engineering, then human |
| Dev plan-gap reports | 2 rounds | Dev Agent escalates with gap summary via Head |
| Code fix-review cycles | 3 rounds | Dev Agent escalates with blocking issues via Head |
| QA bug-fix cycles | 3 rounds | QA Agent escalates, blocks release via Head |

### Artifact handoff convention

Agents communicate through workspace memory and board task attachments, not shared context.

| Artifact | Written By | Read By | Location |
|----------|-----------|---------|----------|
| Requirements spec (user stories + Gherkin) | BA Agent | Dev Agent, QA Agent, Head of Product Eng | Board task attachment or `workspace_memories` |
| Architecture plan | Dev Agent | Dev Agent (phase 2), QA Agent, Head of Product Eng | Board task attachment |
| Technical spec (OpenAPI/schema) | Dev Agent | Dev Agent, QA Agent | Board task attachment |
| Code patch (diff) | Dev Agent | Human reviewer | Review queue |
| Test results | QA Agent | Head of Product Eng, Dev Agent | `workspace_memories` |
| Bug reports | QA Agent | Dev Agent, Head of Product Eng | Board tasks |
| Department summary | Head of Product Eng | Orchestrator | `workspace_memories` |

---

## 9. Agent 1 — Orchestrator (COO)

| Field | Value |
|-------|-------|
| Slug | `orchestrator` |
| Tier | T1 (Executive) |
| Reports to | null |
| Model | `claude-opus-4-6` |
| Schedule | `0 6,20 * * *` |
| Default gate | auto |
| Phase | MVP |

The Orchestrator is the operational backbone of the agent network. It has visibility across everything: open tasks, recent agent activity, overnight memory, unreviewed actions, failed jobs. It synthesises this into a prioritised daily directive each morning and an evening summary each night. It does not execute: no emails, no content, no API calls. Its entire output is a structured directive injected into every other agent's context.

v7.1 change: The Orchestrator's direct reports are now 6 (four department heads + Strategic Intelligence + Admin-Ops). Admin-Ops is a staff function that reports directly because it serves every department and its back-office scope does not belong under any single department head.

**Responsibilities:** read all workspace memory, task board state, and open review items; identify cross-agent patterns (recurring support issues, stalled tasks, budget anomalies, test failures); write morning directive and evening summary; flag systemic issues for human attention; adjust priorities in response to business signals; invoke `triage_intake` for new ideas or bugs arriving outside normal channels; delegate departmental work to the appropriate head; route back-office tasks to Admin-Ops.

### Wired skills

| Skill | Gate | Purpose |
|-------|------|---------|
| `read_workspace` | auto | Full read of memory, tasks, recent runs, open review items |
| `write_workspace` | auto | Write directives and summaries to memory |
| `update_memory_block` | review | Update cross-agent shared memory blocks |
| `create_task` | auto | Create coordination tasks on the board |
| `move_task` | auto | Update task status as part of directive logic |
| `update_task` | auto | Edit task content when coordinating |
| `reassign_task` | auto | Route a task to a department head, staff agent, or (emergency) directly to a worker |
| `spawn_sub_agents` | auto | Trigger parallel sub-task execution (max 2-3 independent tracks) |
| `triage_intake` | auto | Capture and route incoming ideas or bugs |
| `request_approval` | review | Escalate coordination decisions requiring human input |

**Must not:** send external communications; write or propose code; modify integration credentials; approve or reject review items; take any action with financial consequences.

**Outputs:** `orchestrator_directives` record written to DB each run and injected into all agent prompts; evening summary in `workspace_memories`; coordination tasks on the board; escalation flags for systemic failures.

---

## 10. Agent 2 — Head of Product Engineering (CTO)

| Field | Value |
|-------|-------|
| Slug | `head-of-product-engineering` |
| Tier | T2 (Department Head) |
| Reports to | orchestrator |
| Model | `claude-sonnet-4-6` |
| Schedule | on-demand |
| Default gate | auto |
| Phase | MVP |
| Token budget | 30% of worker default |

Coordinates the entire build pipeline: requirements (BA), implementation (Dev), quality (QA), and documentation (Knowledge Management). The most active manager agent because the product development loop has the tightest handoff chain. Owns the BA > Dev > QA sequence: decides when a spec is ready for Dev, when Dev output is ready for QA, and when QA results need to loop back.

**Responsibilities:** receive product work from COO; classify work as bug fix vs feature (informs which workers are needed); route to BA for requirements on features, directly to Dev for simple fixes; monitor the revision loop counters (spec revisions, plan-gap rounds, fix-review cycles, bug-fix cycles); escalate when caps are hit; aggregate test results and implementation summaries into a department-level status for the COO; identify cross-worker bottlenecks (e.g., BA spec backlog blocking Dev).

### Wired skills

| Skill | Gate | Purpose |
|-------|------|---------|
| `list_my_subordinates` | auto | See available workers: BA, Dev, QA, Knowledge Management |
| `spawn_sub_agents` | auto | Parallel execution scoped to children (e.g., Dev + QA simultaneously) |
| `reassign_task` | auto | Route task to specific child worker |
| `read_workspace` | auto | Implementation notes, test results, spec status, Orchestrator directives |
| `write_workspace` | auto | Department summaries, coordination notes, pipeline status |
| `read_codebase` | auto | Technical context for routing decisions |
| `create_task` | auto | Create sub-tasks for workers |
| `move_task` | auto | Update task status during coordination |
| `update_task` | auto | Edit task content |
| `add_deliverable` | auto | Attach department-level deliverables |
| `request_approval` | review | Escalate decisions requiring human input |

**Must not:** write code; run tests; draft specs; perform any worker-level domain execution; bypass the revision loop caps; approve review items.

**Outputs:** department status summaries in workspace memory; coordination tasks routed to workers; escalation flags when loop caps are hit; aggregated pipeline health reports for the COO directive.

---

## 11. Agent 3 — Head of Growth (CMO)

| Field | Value |
|-------|-------|
| Slug | `head-of-growth` |
| Tier | T2 (Department Head) |
| Reports to | orchestrator |
| Model | `claude-sonnet-4-6` |
| Schedule | on-demand |
| Default gate | auto |
| Phase | 3 |
| Token budget | 30% of worker default |

Coordinates the marketing function: social presence (Social Media Agent), paid acquisition (Ads Management Agent), outbound outreach (Email Outreach Agent), and long-form content (Content/SEO Agent). The primary value is campaign-level coordination. When the COO says "launch a campaign for feature X," the Head of Growth decomposes it into social posts, ad copy, email sequences, and blog content, then routes each to the right worker with consistent messaging.

**Responsibilities:** receive marketing briefs from COO; decompose into channel-specific tasks; route to the right worker(s); ensure messaging consistency across channels; read campaign performance data to inform routing decisions; aggregate cross-channel performance into a department-level view for the COO; identify channel conflicts (e.g., email and ads promoting different offers simultaneously).

### Wired skills

| Skill | Gate | Purpose |
|-------|------|---------|
| `list_my_subordinates` | auto | See available workers: Social, Ads, Email, Content/SEO |
| `spawn_sub_agents` | auto | Parallel execution scoped to children (e.g., Social + Email simultaneously) |
| `reassign_task` | auto | Route task to specific child worker |
| `read_workspace` | auto | Campaign context, brand voice, Orchestrator directives |
| `write_workspace` | auto | Department summaries, campaign coordination notes |
| `read_campaigns` | auto | Campaign performance data for routing decisions |
| `read_analytics` | auto | Social performance data for routing decisions |
| `create_task` | auto | Create channel-specific sub-tasks |
| `move_task` | auto | Update task status during coordination |
| `update_task` | auto | Edit task content |
| `add_deliverable` | auto | Attach department-level deliverables |
| `request_approval` | review | Escalate decisions requiring human input |

**Must not:** draft content; publish posts; change ad bids; send emails; perform any worker-level domain execution; approve review items.

**Outputs:** campaign coordination plans in workspace memory; channel-specific tasks routed to workers; cross-channel performance summaries for the COO; messaging consistency flags when channel outputs diverge.

---

## 12. Agent 4 — Head of Client Services (CCO)

| Field | Value |
|-------|-------|
| Slug | `head-of-client-services` |
| Tier | T2 (Department Head) |
| Reports to | orchestrator |
| Model | `claude-sonnet-4-6` |
| Schedule | on-demand |
| Default gate | auto |
| Phase | 2 |
| Token budget | 30% of worker default |

Covers the full client lifecycle: first-contact support (Support Agent), integration setup (Onboarding Agent), and proactive retention with reporting (Retention/Success Agent). The primary value is lifecycle continuity. Support patterns that indicate onboarding gaps get routed to the Onboarding Agent. Retention insights that reveal support issues get flagged. The Head ensures the three lifecycle stages talk to each other.

v7.1 change: Client Reporting Agent retired. Its reporting skills are now part of the Retention/Success Agent, giving this department a proactive retention capability alongside the existing reactive support and transactional onboarding functions.

**Responsibilities:** receive client-related work from COO; route support tickets to Support Agent; route new client setup to Onboarding Agent; route retention, reporting, and success tasks to Retention/Success Agent; identify cross-lifecycle patterns (e.g., recurring support tickets from recently onboarded clients indicating a gap in the onboarding process); aggregate client health into a department-level view for the COO.

### Wired skills

| Skill | Gate | Purpose |
|-------|------|---------|
| `list_my_subordinates` | auto | See available workers: Support, Onboarding, Retention/Success |
| `spawn_sub_agents` | auto | Parallel execution scoped to children |
| `reassign_task` | auto | Route task to specific child worker |
| `read_workspace` | auto | Client context, support patterns, Orchestrator directives |
| `write_workspace` | auto | Department summaries, lifecycle coordination notes |
| `create_task` | auto | Create client-related sub-tasks |
| `move_task` | auto | Update task status during coordination |
| `update_task` | auto | Edit task content |
| `add_deliverable` | auto | Attach department-level deliverables |
| `request_approval` | review | Escalate decisions requiring human input |

**Must not:** reply to support tickets; configure integrations; draft reports; perform any worker-level domain execution; approve review items.

**Outputs:** lifecycle coordination notes in workspace memory; client-related tasks routed to workers; cross-lifecycle pattern alerts for the COO; department-level client health summaries.

---

## 13. Agent 5 — Head of Commercial (CRO)

| Field | Value |
|-------|-------|
| Slug | `head-of-commercial` |
| Tier | T2 (Department Head) |
| Reports to | orchestrator |
| Model | `claude-sonnet-4-6` |
| Schedule | on-demand |
| Default gate | auto |
| Phase | 4 |
| Token budget | 30% of worker default |

Coordinates revenue operations: deal pipeline management (CRM/Pipeline Agent), outbound prospecting and lead qualification (SDR Agent), and revenue intelligence (Finance Agent). The v7.1 restructuring gives this department three workers (up from two), making it a genuinely capable revenue function.

v7.1 change: SDR/Lead-Qualification Agent added as a third worker. Finance Agent rescoped to revenue analytics and anomaly detection (bookkeeping/AR/AP moved to Admin-Ops).

**Responsibilities:** receive revenue and commercial work from COO; route pipeline tasks to CRM/Pipeline Agent; route prospecting and lead qualification to SDR Agent; route financial analysis to Finance Agent; correlate deal pipeline signals with financial data and prospecting activity; aggregate into a unified commercial picture for the COO; flag revenue anomalies that span multiple domains (e.g., SDR generating leads but pipeline stalling at qualification).

### Wired skills

| Skill | Gate | Purpose |
|-------|------|---------|
| `list_my_subordinates` | auto | See available workers: Finance, CRM/Pipeline, SDR |
| `spawn_sub_agents` | auto | Parallel execution scoped to children |
| `reassign_task` | auto | Route task to specific child worker |
| `read_workspace` | auto | Pipeline metrics, financial context, Orchestrator directives |
| `write_workspace` | auto | Department summaries, commercial coordination notes |
| `read_revenue` | auto | Revenue data for informed routing decisions |
| `read_crm` | auto | Pipeline data for informed routing decisions |
| `create_task` | auto | Create commercial sub-tasks |
| `move_task` | auto | Update task status during coordination |
| `update_task` | auto | Edit task content |
| `add_deliverable` | auto | Attach department-level deliverables |
| `request_approval` | review | Escalate decisions requiring human input |

**Must not:** update CRM records; modify financial records; send follow-up emails; prospect directly; perform any worker-level domain execution; approve review items; make financial projections.

**Outputs:** unified commercial status in workspace memory; revenue, pipeline, and prospecting tasks routed to workers; cross-domain anomaly flags for the COO; aggregated deal-to-revenue correlation reports.

---

## 14. Agent 6 — Admin-Ops Agent

| Field | Value |
|-------|-------|
| Slug | `admin-ops-agent` |
| Tier | T2 (Staff Agent) |
| Reports to | orchestrator |
| Model | `claude-sonnet-4-6` |
| Schedule | on-demand |
| Default gate | review |
| Phase | 4 |

New in v7.1. The back-office operations agent. Covers the highest-frequency, highest-ROI operational functions that were entirely absent from v7.0: invoicing, payment reconciliation, accounts receivable, accounts payable, expense management, vendor onboarding, SaaS subscription tracking, and month-end close preparation.

This is a COO function, not a CRO function. Placing it under the Head of Commercial would create incentive conflicts: a CRO-owned agent is structurally biased against chasing a strategic customer's overdue invoice. Admin-Ops reports directly to the Orchestrator as a staff function that serves every department.

Unlike department heads, Admin-Ops does not manage subordinate workers. It is a T2 staff agent that executes directly. This is the correct topology because its functions are tightly coupled (invoicing feeds reconciliation feeds AR follow-up) and do not benefit from decomposition into separate workers at current scale. If back-office volume grows to warrant decomposition, the first split would be AR/AP into a separate worker.

**Responsibilities:** generate and send invoices based on active engagement records and billing schedules; reconcile Stripe transactions against Xero/accounting records; chase overdue payments via dunning sequences; process incoming bills and expense receipts; track SaaS subscriptions and flag renewals/cancellations; onboard new vendors with compliance checks; prepare month-end close packages for human review; flag financial discrepancies and reconciliation failures.

### Wired skills

| Skill | Gate | Purpose |
|-------|------|---------|
| `read_workspace` | auto | Billing schedules, client engagement records, Orchestrator directives |
| `write_workspace` | auto | Reconciliation results, AR status, expense summaries |
| `read_revenue` | auto | Pull payment data from Stripe/payment processors |
| `read_expenses` | auto | Pull expense and bill data from accounting integrations |
| `generate_invoice` | review | Create invoice from engagement record and billing schedule |
| `send_invoice` | review | Deliver invoice to client via configured channel |
| `reconcile_transactions` | auto | Match Stripe transactions against accounting records |
| `chase_overdue` | review | Draft and send AR dunning communications |
| `process_bill` | review | Record incoming bill/expense for human approval |
| `track_subscriptions` | auto | Monitor SaaS subscriptions, flag renewals and cancellations |
| `prepare_month_end` | review | Generate month-end close package for human review |
| `send_email` | auto | Send communications (gated upstream via `request_approval`) |
| `request_approval` | review | HITL gate on all financial actions |
| `move_task` / `update_task` / `add_deliverable` | auto | Standard board ops |

**Must not:** initiate payments or transfers without human approval; modify accounting records directly; produce anything that could be mistaken for formal accounting or tax advice; approve its own invoices; override dunning sequences for specific clients without explicit human instruction.

**Outputs:** invoices in review queue; reconciliation reports in workspace memory; AR aging summaries as board deliverables; dunning communications in review queue; month-end close packages in review queue; subscription renewal alerts as board tasks; expense records pending approval.

---

## 15. Agent 7 — Business Analyst

| Field | Value |
|-------|-------|
| Slug | `business-analyst` |
| Tier | T3 (Worker) |
| Reports to | head-of-product-engineering |
| Model | `claude-sonnet-4-6` |
| Schedule | on-demand |
| Default gate | review |
| Phase | MVP |

The BA is the translation layer between human intent and machine-executable requirements. It turns vague ideas and board tasks into user stories with Gherkin acceptance criteria that Dev can implement and QA can test against. It is a separate agent because its outputs are independently consumed by two downstream agents.

The BA operates in two modes: requirements mode (produces a spec from a brief) and clarification mode (surfaces blocking questions via `ask_clarifying_question` before writing). The `review` gate on the spec output is non-negotiable: no spec drives engineering effort without human sign-off.

> **Placement rationale (v7.1):** The structural review recommended moving BA to a "Strategy & Analysis" pillar, arguing it serves non-engineering departments. This is valid for a general SME but not for Automation OS, where the BA's primary consumer is the Dev Agent and the BA > Dev > QA handoff chain is the core product development pipeline. Moving BA would add a cross-departmental coordination hop to the most frequent workflow. BA stays under the CTO. If non-engineering demand for BA services becomes demonstrably frequent, revisit the placement.

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

## 16. Agent 8 — Dev Agent

| Field | Value |
|-------|-------|
| Slug | `dev` |
| Tier | T3 (Worker) |
| Reports to | head-of-product-engineering |
| Model | `claude-opus-4-6` |
| Schedule | on-demand |
| Default gate | review (code), block (deploys, merges) |
| Phase | MVP |

The Dev Agent is a developer embedded in the same agent network as every other team member. It reads the same workspace memory, sees QA bug reports on the board, and gets directed by the Head of Product Engineering (who receives direction from the Orchestrator). It incorporates architect-builder discipline without a separate agent: before writing code on any non-trivial task it must produce an architecture plan. The discipline is enforced by the system prompt, not by an architecture agent.

Every code change goes through the HITL review queue before touching the codebase. The agent proposes; a human decides.

### Task classification

| Classification | Criteria | Planning Requirement |
|---------------|----------|---------------------|
| Trivial | Single file, obvious fix, no API impact | Skip architecture plan; implement + self-review |
| Standard | 2-5 files, clear requirements, no schema changes | `draft_architecture_plan` internal; no review gate |
| Significant | Schema changes, new API endpoints, or UI flows | `draft_architecture_plan` submitted for human review before coding |
| Major | New domain, cross-cutting concerns, external integrations | `draft_architecture_plan` + `draft_tech_spec` submitted; no coding until both approved |

### Wired skills

| Skill | Gate | Purpose |
|-------|------|---------|
| `read_codebase` | auto | Read files from projectRoot |
| `search_codebase` | auto | Grep and glob across the project |
| `read_workspace` | auto | Bug reports, QA findings, BA specs, directives |
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

When an ambiguity cannot be resolved from the spec, codebase, or workspace memory, raise a PLAN_GAP report rather than improvising. Write to the board task as a comment and set status to `blocked`. Maximum 2 rounds before escalating to the Head of Product Engineering, who escalates to the human.

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

## 17. Agent 9 — QA Agent

| Field | Value |
|-------|-------|
| Slug | `qa` |
| Tier | T3 (Worker) |
| Reports to | head-of-product-engineering |
| Model | `claude-sonnet-4-6` |
| Schedule | `0 2 * * *` (daily regression) + on-demand |
| Default gate | auto |
| Phase | MVP |

The QA Agent is the closing sensor in the development loop. Two defining disciplines:
- **Gherkin traceability:** every test case maps to a specific BA Gherkin AC. An untraceable test is noise.
- **Structured failure classification:** every failure is classified as APP BUG, TEST BUG, or ENVIRONMENT, preventing the Dev Agent from chasing phantom failures caused by test infrastructure.

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
| `read_workspace` | auto | Dev implementation notes, BA specs, directives |
| `write_workspace` | auto | Test insights, fragility signals, coverage summaries |
| `create_task` / `move_task` / `update_task` / `add_deliverable` | auto | Standard board ops |
| `request_approval` | review | Escalate when test run caps hit |

### Failure classification protocol

| Classification | Definition | Action |
|---------------|------------|--------|
| APP BUG | Application code is broken; test correctly identifies a defect | Create board task with severity, repro steps, Gherkin AC reference. Do not fix. |
| TEST BUG | Test logic is incorrect; application behaviour is as intended | Fix test immediately. Log in workspace memory. No board task. |
| ENVIRONMENT | Failure caused by test environment, not code or test logic | Note in workspace memory. Flag in run summary. Do not escalate unless recurring. |

When uncertain, default to APP BUG and note the uncertainty.

**Must not:** write to application source (test files only); send external communications; close or resolve bugs it raised; approve code changes; write tests not traceable to a Gherkin AC.

**Outputs:** test cases in workspace memory with spec reference ID; structured bug reports on the board (severity, classification, confidence, repro steps, Gherkin AC reference); test run summaries in workspace memory; daily regression report for Head of Product Engineering; fragility and coverage insights in memory.

---

## 18. Agent 10 — Knowledge Management Agent

| Field | Value |
|-------|-------|
| Slug | `knowledge-management-agent` |
| Tier | T3 (Worker) |
| Reports to | head-of-product-engineering |
| Model | `claude-sonnet-4-6` |
| Schedule | on-demand |
| Default gate | review (doc updates) |
| Phase | 5 |

Keeps internal documentation aligned with code and process reality. Reads docs, diffs them against current behaviour, and proposes targeted updates through HITL review. Also authors new documentation when gaps are identified.

> **Structural review note:** The review recommended dissolving KM as an agent and making it shared infrastructure, arguing that document ingestion and vector search are substrate. However, the platform already has shared infrastructure for these primitives (workspace memory, `read_workspace`, `write_workspace`). This agent's actual job is more specific: diffing documentation against code reality and proposing targeted updates. That is a genuine recurring business process. KM is retained but recognised as a Phase 5 agent and a candidate for demotion to a scheduled Orchestrator skill if it does not demonstrate standalone value.

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

## 19. Agent 11 — Support Agent

| Field | Value |
|-------|-------|
| Slug | `support-agent` |
| Tier | T3 (Worker) |
| Reports to | head-of-client-services |
| Model | `claude-sonnet-4-6` |
| Schedule | on-demand |
| Default gate | review (all outbound) |
| Phase | 2 |

The Support agent handles first-contact triage: reads, classifies, and drafts responses to inbound tickets. A human approves every reply before it sends. Over time, as review history builds, consistently correct categories can be promoted to `auto`. The Support agent is also the primary product quality sensor: it sees bugs before they reach the board.

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

**Outputs:** drafted replies in review queue; recurring pattern entries in workspace memory for the Head of Client Services (CCO); escalation flags for tickets needing immediate human attention.

---

## 20. Agent 12 — Onboarding Agent

| Field | Value |
|-------|-------|
| Slug | `onboarding-agent` |
| Tier | T3 (Worker) |
| Reports to | head-of-client-services |
| Model | `claude-sonnet-4-6` |
| Schedule | on-demand (per new client) |
| Default gate | review (all external setup) |
| Phase | 5 |

Guides new clients through integration setup, permission grants, and initial configuration. Every configuration step requires HITL approval: credentials are never stored without human sign-off. Currently the leanest wired agent (7 skills); richer workflows will be added in Phase 5 build.

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

## 21. Agent 13 — Retention/Success Agent

| Field | Value |
|-------|-------|
| Slug | `retention-success-agent` |
| Tier | T3 (Worker) |
| Reports to | head-of-client-services |
| Model | `claude-sonnet-4-6` |
| Schedule | on-demand |
| Default gate | review |
| Phase | 5 |

New in v7.1. Proactive customer retention and success, replacing the reactive-only Client Reporting Agent. Combines churn-risk scoring, NPS/CSAT monitoring, renewal preparation, and QBR support with the reporting capabilities previously held by the Client Reporting Agent.

The structural review identified that for any recurring-revenue SaaS business, the absence of proactive retention was a material gap. Client Reporting's skills (`draft_report`, `deliver_report`) are format-transformation functions with no distinct tools, metrics, or stakeholders that justify a standalone agent. Absorbing them into Retention/Success creates a coherent agent that can both identify at-risk clients and produce the reports needed to act on that intelligence.

**Responsibilities:** score client accounts for churn risk using engagement, support, and usage signals; monitor NPS/CSAT responses and flag declining trends; prepare renewal briefs with usage summaries and value-delivered narratives; support QBR preparation with structured performance data; draft and deliver client performance reports (absorbed from Client Reporting); flag at-risk accounts to the Head of Client Services (CCO).

### Wired skills

| Skill | Gate | Purpose |
|-------|------|---------|
| `read_workspace` | auto | Client metrics, engagement data, support patterns, Orchestrator directives |
| `write_workspace` | auto | Churn-risk scores, retention insights, report drafts |
| `detect_churn_risk` | auto | Score client accounts for churn risk from engagement signals |
| `score_nps_csat` | auto | Process and trend NPS/CSAT survey responses |
| `prepare_renewal_brief` | auto | Generate renewal package with usage summary and value narrative |
| `draft_report` | auto | Produce structured client report with exec summary (absorbed from Client Reporting) |
| `deliver_report` | review | Send approved report via configured channel — HITL (absorbed from Client Reporting) |
| `send_email` | auto | Send communications (gated upstream via `request_approval`) |
| `request_approval` | review | HITL gate on report delivery and client communications |
| `move_task` / `update_task` / `add_deliverable` | auto | Standard board ops |

> **Skill note:** `detect_churn_risk` and `compute_churn_risk` are two distinct skills with different runtime paths. `detect_churn_risk` is the engagement-signal scorer used by `crm-pipeline-agent` and `retention-success-agent`. `compute_churn_risk` is the portfolio-level churn model used by `portfolio-health-agent` only. See Appendix A for the full disambiguation.

**Must not:** deliver reports without human approval; invent metrics not in source data; contact clients without HITL review; unilaterally offer discounts or retention incentives; produce reports for clients without an active engagement record.

**Outputs:** churn-risk scores in workspace memory; at-risk account flags as board deliverables; renewal briefs in review queue; NPS/CSAT trend reports in workspace memory; draft client reports in review queue; delivered reports logged as board deliverables.

---

## 22. Agent 14 — Social Media Agent

| Field | Value |
|-------|-------|
| Slug | `social-media-agent` |
| Tier | T3 (Worker) |
| Reports to | head-of-growth |
| Model | `claude-sonnet-4-6` |
| Schedule | on-demand |
| Default gate | review (all publishing) |
| Phase | 3 |

Maintains an informed social presence that reflects what is actually happening in the business, not generic content. Reads workspace context before writing: recent product updates, customer wins, active campaigns, competitor moves.

> **Merge investigation pending:** A structural review flagged significant overlap between Social Media Agent and Content/SEO Agent (shared calendar, brand voice, source material, analytics). An investigation brief is documented in Appendix F. The outcome will determine whether these agents merge or remain separate.

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

> `web_search` is not wired. Trend research comes via the Head of Growth or handoff from Strategic Intelligence. Scheduled publishing uses `publish_post` with a timestamp parameter.

**Must not:** publish without human approval; engage with replies, comments, or DMs; run paid promotion on organic posts; post about legal matters, personnel, or incidents.

**Outputs:** drafted posts in review queue; performance summaries in workspace memory; content ideas as board task deliverables.

---

## 23. Agent 15 — Ads Management Agent

| Field | Value |
|-------|-------|
| Slug | `ads-management-agent` |
| Tier | T3 (Worker) |
| Reports to | head-of-growth |
| Model | `claude-sonnet-4-6` |
| Schedule | on-demand |
| Default gate | review (bid/copy changes), block (budget, pause) |
| Phase | 3 |

Reads campaign performance, forms a clear view on what is working, and proposes specific changes with explicit reasoning. A human reviews before anything changes. `increase_budget` and `pause_campaign` are the only `block`-gated skills in the entire skill library: budget cannot be un-spent and mid-promotion pauses cause real damage.

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
| `pause_campaign` | block | Never autonomous — always manual |
| `increase_budget` | block | Never autonomous — always manual |
| `request_approval` | review | Escalate decisions requiring human input |
| `move_task` / `update_task` / `add_deliverable` | auto | Standard board ops |

**Must not:** change budgets without explicit human instruction; pause or resume campaigns; create new campaigns; access billing or payment methods.

**Outputs:** performance analysis in workspace memory; proposed bid and copy changes in review queue; ad copy variants for human selection; anomaly flags as board deliverables.

---

## 24. Agent 16 — Email Outreach Agent

| Field | Value |
|-------|-------|
| Slug | `email-outreach-agent` |
| Tier | T3 (Worker) |
| Reports to | head-of-growth |
| Model | `claude-sonnet-4-6` |
| Schedule | on-demand |
| Default gate | review (all outbound) |
| Phase | 3 |

Handles nurture sequences, broadcast emails, and newsletter drafting at scale. Every email that leaves the system goes through a human first. Sequences are drafted in full before the first email sends, so the human reviewer evaluates the entire flow upfront.

> **Boundary with SDR Agent (v7.1):** Email Outreach (under CMO) handles nurture, broadcast, and newsletter sequences aimed at warming and educating an audience. SDR Agent (under CRO) handles 1:1 prospecting with reply handling aimed at booking meetings. The distinction is audience-scale communication vs individual-prospect engagement.

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

## 25. Agent 17 — Content/SEO Agent

| Field | Value |
|-------|-------|
| Slug | `content-seo-agent` |
| Tier | T3 (Worker) |
| Reports to | head-of-growth |
| Model | `claude-sonnet-4-6` |
| Schedule | on-demand |
| Default gate | review (all published content) |
| Phase | 4 |

Handles long-form content: blog posts, SEO articles, case studies, landing page copy, and lead magnets. The Social Media Agent handles short-form. Reads workspace context, researches the topic, drafts, and submits for human review before anything publishes.

> **Merge investigation pending:** See [Appendix F](#appendix-f--contentseo--social-media-merge-investigation-brief) for the investigation brief on a potential merge with Social Media Agent.

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

## 26. Agent 18 — Strategic Intelligence Agent

| Field | Value |
|-------|-------|
| Slug | `strategic-intelligence-agent` |
| Tier | T2 (Direct Report) |
| Reports to | orchestrator |
| Model | `claude-sonnet-4-6` |
| Schedule | on-demand |
| Default gate | review |
| Phase | 4 |

The platform's thinking layer. Merges Business Planning and Competitor Research into one agent. Does not act. Synthesises signals from Finance, Ads, Support, and Email Outreach into structured insight. Its most important function is connecting cross-domain dots: a revenue dip, rising CPAs, and more onboarding complaints are three signals that together suggest a conversion problem working through the funnel.

Reports directly to the Orchestrator because its advisory function is cross-cutting. Placing it under any single department head would limit its scope.

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

> `fetch_url` is wired via the master seed to the Reporting Agent template (Appendix B Group A), not currently to Strategic Intelligence. Strategic recommendations surface via `add_deliverable`, not `create_task`.

**Must not:** take any external action; contact competitor companies; access non-public competitor data; make financial projections that could be mistaken for accounting records.

**Outputs:** strategic recommendations as task deliverables; daily cross-domain analysis in workspace memory; updated competitor profiles; weekly summary in Orchestrator directive.

---

## 27. Agent 19 — Finance Agent

| Field | Value |
|-------|-------|
| Slug | `finance-agent` |
| Tier | T3 (Worker) |
| Reports to | head-of-commercial |
| Model | `claude-sonnet-4-6` |
| Schedule | on-demand |
| Default gate | review (record changes), auto (reads and analysis) |
| Phase | 4 |

Rescoped in v7.1. Now focused on revenue analytics and anomaly detection. Bookkeeping, AR/AP, reconciliation, and expense management responsibilities have moved to Admin-Ops Agent. Finance retains its role as the revenue intelligence function: syncing payment data from connected integrations, detecting anomalies (doubled subscriptions, failed payments, overdue retainers), and writing financial snapshots to workspace memory where the Head of Commercial, Orchestrator, and Strategic Intelligence can read them.

The boundary with Admin-Ops is clean: Finance reads and analyses financial data. Admin-Ops acts on it. Finance detects a failed payment; Admin-Ops chases it. Finance spots a reconciliation mismatch; Admin-Ops resolves it.

### Wired skills

| Skill | Gate | Purpose |
|-------|------|---------|
| `read_workspace` | auto | Budget benchmarks, Orchestrator context |
| `write_workspace` | auto | Financial summaries and anomaly findings |
| `read_revenue` | auto | Pull revenue data from payment processors |
| `read_expenses` | auto | Pull expense data from accounting integrations (read-only analysis) |
| `analyse_financials` | auto | Internal calculations and anomaly detection |
| `request_approval` | review | HITL gate on financial recommendations |
| `move_task` / `update_task` / `add_deliverable` | auto | Standard board ops |

> **v7.1 change:** `update_financial_record` removed. Financial record modifications are now handled by Admin-Ops. Finance is read-and-analyse only.

**Must not:** initiate any payment or transfer; modify financial records (now an Admin-Ops responsibility); produce anything that could be mistaken for formal accounting or tax advice; surface raw financial data to non-admin users.

**Outputs:** financial snapshot in workspace memory each run; anomaly flags as task deliverables (routed to Admin-Ops for action); revenue trend analysis for Head of Commercial; daily financial summary for the Orchestrator directive.

---

## 28. Agent 20 — CRM/Pipeline Agent

| Field | Value |
|-------|-------|
| Slug | `crm-pipeline-agent` |
| Tier | T3 (Worker) |
| Reports to | head-of-commercial |
| Model | `claude-sonnet-4-6` |
| Schedule | on-demand |
| Default gate | review (all CRM writes) |
| Phase | 5 |

Keeps deal data current, identifies stalled opportunities, drafts follow-ups, and flags churn risk. Every CRM write goes through HITL review.

> **Boundary with SDR Agent (v7.1):** CRM/Pipeline manages existing deals and contacts in the pipeline. SDR handles net-new prospecting and lead qualification before deals enter the pipeline. The handoff point is when an SDR-qualified lead is ready to become a deal: SDR creates the CRM record (via `update_crm`), and CRM/Pipeline takes over from there.

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

## 29. Agent 21 — SDR/Lead-Qualification Agent

| Field | Value |
|-------|-------|
| Slug | `sdr-agent` |
| Tier | T3 (Worker) |
| Reports to | head-of-commercial |
| Model | `claude-sonnet-4-6` |
| Schedule | on-demand |
| Default gate | review |
| Phase | 5 |

New in v7.1. Handles outbound prospecting, inbound lead triage and enrichment, and meeting booking. This is one of the most mature agent use cases in 2025-26 (Apollo, Clay, Smartlead, 11x-class workflows) and closes a revenue-generation gap that the structural review identified.

The boundary with Email Outreach (under CMO) is clean: Email Outreach handles audience-scale nurture and broadcast sequences. SDR handles 1:1 prospecting with reply handling aimed at booking meetings. The boundary with CRM/Pipeline is also clean: SDR works upstream of the pipeline, qualifying leads and creating initial CRM records. CRM/Pipeline takes over once a deal is created.

**Responsibilities:** research and identify prospects matching ICP criteria; enrich prospect data from available integrations; draft personalised outbound prospecting messages; handle inbound lead triage (score, enrich, route); book meetings via calendar integration; create qualified lead records in CRM for handoff to CRM/Pipeline Agent; track prospecting cadence and response rates.

### Wired skills

| Skill | Gate | Purpose |
|-------|------|---------|
| `read_workspace` | auto | ICP criteria, target account lists, Orchestrator directives |
| `write_workspace` | auto | Prospecting insights, lead scores, cadence tracking |
| `discover_prospects` | auto | Find candidate SMB prospects via Google Places |
| `web_search` | auto | Prospect research, company context, trigger events |
| `enrich_contact` | auto | Pull contact data from enrichment integrations |
| `draft_outbound` | auto | Generate personalised prospecting messages |
| `send_email` | auto | Send prospecting email (gated via `request_approval`) |
| `score_lead` | auto | Qualify inbound leads against ICP criteria |
| `book_meeting` | review | Schedule meeting via calendar integration — HITL |
| `update_crm` | review | Create qualified lead record in CRM — HITL |
| `request_approval` | review | HITL gate on all outbound and CRM writes |
| `move_task` / `update_task` / `add_deliverable` | auto | Standard board ops |

**Must not:** send prospecting emails without human approval; contact anyone on a suppression list; impersonate a named individual without explicit configuration; book meetings without HITL review; create CRM records without approval; bypass lead qualification criteria.

**Outputs:** personalised outbound messages in review queue; qualified lead records in review queue; prospect research summaries in workspace memory; meeting booking requests in review queue; prospecting cadence and response rate analytics in workspace memory.

---

## 30. Agent 22 — Portfolio Health Agent

| Field | Value |
|-------|-------|
| Slug | `portfolio-health-agent` |
| Tier | -- (outside tier system) |
| Reports to | null |
| Model | `claude-sonnet-4-6` |
| Schedule | `*/4 * * *` (every 4 hours) |
| Default gate | auto |
| Execution scope | `org` (not `subaccount`) |
| Phase | special (ships independently) |

The only system agent operating at organisation scope. Runs against all subaccounts in an org, computes health scores, detects anomalies, scores churn risk, and generates portfolio-wide intelligence briefings. Does not coordinate with the Orchestrator. Writes to a separate org-level memory surface that the human operator and Strategic Intelligence Agent can read.

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

> **Why this agent has a different skill set.** Every other agent in the roster is wired with the standard task-management bundle (`read_workspace` / `write_workspace` / `move_task` / `update_task` / `request_approval`). Portfolio Health Agent is intentionally NOT. It runs at `executionScope: org`, has `subaccountId: null` at run time, and the workspace and task primitives are subaccount-scoped. The runtime explicitly throws if `read_workspace` or `write_workspace` is invoked without a subaccount context. The org-level equivalents (`read_org_insights` / `write_org_insight`) exist precisely as the architectural workaround, and the agent uses those instead. If a future change unifies the workspace surface across subaccount and org scopes, the universal bundle can be added here.

**Must not:** write to individual subaccount workspace memory; invoke business-team agents directly; make interventions without HITL approval; expose cross-subaccount data to users without org-level permissions.

**Outputs:** health scores per subaccount in org-level memory every 4 hours; anomaly flags and churn risk scores; portfolio intelligence briefings; intervention proposals routed through HITL review.

---

## Appendix A — Skill to Agent Cross-Reference

### Universal skills (all 21 business agents)

These skills are wired to every business agent: Orchestrator (1), four department heads (4), two staff agents (Admin-Ops, Strategic Intelligence), and the 14 subaccount-scoped worker agents, for a total of 21 agents. They form the standard task-management and workspace-memory primitive set every business agent needs.

| Skill | Gate |
|-------|------|
| `read_workspace` | auto |
| `write_workspace` | auto |
| `move_task` | auto |
| `update_task` | auto |
| `request_approval` | review |

`add_deliverable` (auto for managers/staff, review for workers) is wired to all 20 non-Orchestrator business agents. `create_task` (auto) is wired to business-analyst, dev, orchestrator, qa, admin-ops-agent, and all four department heads.

> **Portfolio Health Agent is excluded** from the universal set. It is the only agent at `executionScope: org` and uses `read_org_insights` / `write_org_insight` instead of `read_workspace` / `write_workspace`. The runtime throws if the workspace primitives are invoked without a subaccount context. See [Agent 22](#30-agent-22--portfolio-health-agent) for the architectural detail.

### Manager delegation bundle (4 department heads)

| Skill | Gate | Used By |
|-------|------|---------|
| `list_my_subordinates` | auto | head-of-product-engineering, head-of-growth, head-of-client-services, head-of-commercial |
| `spawn_sub_agents` | auto | head-of-product-engineering, head-of-growth, head-of-client-services, head-of-commercial |
| `reassign_task` | auto | head-of-product-engineering, head-of-growth, head-of-client-services, head-of-commercial |

### Manager domain-specific reads

| Skill | Gate | Used By |
|-------|------|---------|
| `read_codebase` | auto | head-of-product-engineering |
| `read_campaigns` | auto | head-of-growth |
| `read_analytics` | auto | head-of-growth |
| `read_revenue` | auto | head-of-commercial |
| `read_crm` | auto | head-of-commercial |

### Admin-Ops specific skills

| Skill | Gate | Used By |
|-------|------|---------|
| `generate_invoice` | review | admin-ops-agent |
| `send_invoice` | review | admin-ops-agent |
| `reconcile_transactions` | auto | admin-ops-agent |
| `chase_overdue` | review | admin-ops-agent |
| `process_bill` | review | admin-ops-agent |
| `track_subscriptions` | auto | admin-ops-agent |
| `prepare_month_end` | review | admin-ops-agent |
| `read_revenue` | auto | admin-ops-agent |
| `read_expenses` | auto | admin-ops-agent |

### SDR/Lead-Qualification specific skills

| Skill | Gate | Used By |
|-------|------|---------|
| `discover_prospects` | auto | sdr-agent |
| `draft_outbound` | auto | sdr-agent |
| `score_lead` | auto | sdr-agent |
| `book_meeting` | review | sdr-agent |

### Retention/Success specific skills

| Skill | Gate | Used By |
|-------|------|---------|
| `score_nps_csat` | auto | retention-success-agent |
| `prepare_renewal_brief` | auto | retention-success-agent |

### Domain-specific wiring (workers)

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
| `web_search` | auto | business-analyst, content-seo-agent, strategic-intelligence-agent, sdr-agent |
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
| `pause_campaign` | block | ads-management-agent |
| `increase_budget` | block | ads-management-agent |
| `enrich_contact` | auto | email-outreach-agent, sdr-agent |
| `draft_sequence` | auto | email-outreach-agent |
| `send_email` | auto | support-agent, email-outreach-agent, crm-pipeline-agent, sdr-agent, admin-ops-agent, retention-success-agent |
| `update_crm` | review | email-outreach-agent, crm-pipeline-agent, sdr-agent |
| `generate_competitor_brief` | auto | strategic-intelligence-agent |
| `synthesise_voc` | auto | strategic-intelligence-agent |
| `read_revenue` | auto | finance-agent, admin-ops-agent |
| `read_expenses` | auto | finance-agent, admin-ops-agent |
| `analyse_financials` | auto | finance-agent |
| `draft_content` | auto | content-seo-agent |
| `audit_seo` | auto | content-seo-agent |
| `create_lead_magnet` | review | content-seo-agent |
| `update_page` | auto | content-seo-agent |
| `publish_page` | auto | content-seo-agent |
| `draft_report` | auto | retention-success-agent |
| `deliver_report` | review | retention-success-agent |
| `detect_churn_risk` | auto | crm-pipeline-agent, retention-success-agent |
| `configure_integration` | review | onboarding-agent |
| `read_crm` | auto | crm-pipeline-agent |
| `analyse_pipeline` | auto | crm-pipeline-agent |
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

> **`detect_churn_risk` and `compute_churn_risk` are two distinct skills with different runtime paths.** `detect_churn_risk` is the CRM-signal scorer used by `crm-pipeline-agent` and the engagement-signal scorer used by `retention-success-agent`. `compute_churn_risk` is the portfolio-level churn model used by `portfolio-health-agent` only.

> **Retired skill wiring:** `update_financial_record` (previously wired to `finance-agent`) is removed in v7.1. Financial record modifications are now handled by Admin-Ops via `process_bill`, `reconcile_transactions`, and `prepare_month_end`.

---

## Appendix B — Skill Wiring Audit (v6.0, carried forward)

Carried forward from v6.0 without changes. The audit findings and resolutions remain valid. v7.0 introduced three manager skills (`list_my_subordinates`, scoped `spawn_sub_agents`, scoped `reassign_task`). v7.1 introduces additional new skills for Admin-Ops (`generate_invoice`, `send_invoice`, `reconcile_transactions`, `chase_overdue`, `process_bill`, `track_subscriptions`, `prepare_month_end`), SDR (`discover_prospects`, `draft_outbound`, `score_lead`, `book_meeting`), and Retention/Success (`score_nps_csat`, `prepare_renewal_brief`).

### Group A — Wired via master seed to the Reporting Agent (5 skills)

Not orphans. These form the toolkit for the domain-agnostic Reporting Agent that the master seed creates in Phase 5 as a per-client template. See `scripts/seed.ts` Phase 5d.

| Skill | Gate | Role |
|-------|------|------|
| `fetch_paywalled_content` | auto | Phase 1 ACQUIRE: fetches content from sources behind a login |
| `fetch_url` | auto | Phase 1 ACQUIRE: public URL counterpart |
| `transcribe_audio` | auto | Phase 2 CONVERT: Whisper transcription |
| `analyse_42macro_transcript` | auto | Phase 3 ANALYSE: domain lens for 42 Macro content |
| `send_to_slack` | auto | Phase 4 PUBLISH: posts finished report to Slack |

### Group B — Wired via master seed to the Playbook Author (5 skills)

Not orphans. Studio tool set for the Playbook Author system agent created in Phase 3. All five are `visibility: none`.

| Skill | Role |
|-------|------|
| `playbook_read_existing` | Load an existing playbook file for reference |
| `playbook_validate` | Run the Playbook DAG validator |
| `playbook_simulate` | Static analysis pass: parallelism profile and critical path |
| `playbook_estimate_cost` | Pessimistic cost estimate defaulting to max tokens and worst-case retries |
| `playbook_propose_save` | Record the validated definition for the human admin to save via the Studio button |

### Group C — Genuine orphans + broken wires (5 skills) — RESOLVED

| Skill | Resolution |
|-------|-----------|
| `read_inbox` | Wired into `support-agent/AGENTS.md` |
| `update_memory_block` | Wired into `orchestrator/AGENTS.md` (gate: `review`) |
| `trigger_process.md` | Deleted |
| `read_data_source` | Registry entry added, runtime now complete |
| `triage_intake` | Runtime implemented in v6.0 |

Dangling references: none.

### Group D — Runtime-complete opt-in primitives (2 skills)

| Skill | Visibility | Why opt-in |
|-------|------------|------------|
| `read_data_source` | `none` | Opt-in for agents needing mid-run data source queries |
| `create_page` | `basic` | Full runtime complete. Content/SEO Agent is the natural future owner. |

### Post-resolution skill count (v7.1)

- Files on disk: 90 base (from v6.0) + 13 new (7 Admin-Ops + 4 SDR + 2 Retention/Success) = 103 (pending implementation)
- Wired to at least one agent: all new skills listed above
- Wired via master seed: 10 (5 Reporting Agent + 5 Playbook Author)
- Runtime complete, opt-in: 2 (`read_data_source`, `create_page`)
- Broken wires: 0
- Unwired and dead: 0
- Retired: 1 (`update_financial_record`, removed from finance-agent)

---

## Appendix C — Source of Truth & Drift Protocol

### The hierarchy of truth

1. `companies/automation-os/agents/<slug>/AGENTS.md` — the authoritative runtime definition for each system agent.
2. `companies/automation-os/COMPANY.md` — the top-level manifest frontmatter.
3. `companies/automation-os/automation-os-manifest.json` — human-readable index only. Not read by any code path.
4. `server/skills/<slug>.md` — the authoritative definition of each system skill.
5. This document — the architectural brief.

When these sources conflict, the `.md` files (AGENTS.md and skill files) win. Everything else needs updating.

### The master seed script

`scripts/seed.ts` runs in five phases:

| Phase | Scope | Idempotency |
|-------|-------|-------------|
| 1 | System org + system admin user | Upserts; password preserved on update |
| 2 | 22 system agents from `companies/automation-os/` | Upserts via slug lookup with `isNull(deletedAt)` filter |
| 3 | Playbook Author system agent (23rd) | Upsert via slug lookup |
| 4 | Playbook templates + `portfolio-health-sweep` | Upserts via slug |
| 5 | Dev fixtures: all 22 system agents activated in the org and linked through to the subaccount | Upserts everywhere except `integration_connections` |

Every phase is idempotent at row level. Drift cases handled: removed `reportsTo` clears `parentSystemAgentId`; execution scope flip deactivates stale `subaccount_agents` rows; passwords preserved on update.

Usage:
```bash
npm run seed               # Dev seed — includes Phase 5 dev fixtures
npm run seed:production    # Production seed — skips Phase 5
```

### Drift protocol

1. Edit `agents/<slug>/AGENTS.md`
2. If adding or removing an agent: update `automation-os-manifest.json` AND the Full Agent Roster table
3. If changing skill wiring: update affected agent's skill table AND Appendix A
4. If adding a new skill file: classify in `scripts/lib/skillClassification.ts`, run `npm run skills:apply-visibility`
5. Commit all affected files in the same PR

### Verifying the brief matches reality

```bash
npm run seed                       # prints upsert counts
npm run skills:verify-visibility   # fails if any skill has drifted
```

The Automation OS company count should be 22 and the Playbook Author is the 23rd.

---

## Appendix D — Skill Visibility Rule

### The rule

Every file-based system skill in `server/skills/*.md` must carry an explicit `visibility:` frontmatter value. No default. Missing values fail `npm run skills:verify-visibility`.

| Class | Visibility | Definition |
|-------|------------|------------|
| App-foundational | `none` | Platform-infrastructure primitives: task board, workspace memory, HITL escalation, orchestration, delegation bundle, Studio tooling. Not customer-facing. |
| Business-visible | `basic` | Everything else. Work a customer might care about. |

### The app-foundational set (19 skills)

| Category | Skills |
|----------|--------|
| Task board primitives | `add_deliverable`, `create_task`, `move_task`, `reassign_task`, `update_task` |
| Workspace memory & cross-agent state | `read_workspace`, `write_workspace`, `update_memory_block` |
| HITL & orchestration | `request_approval`, `spawn_sub_agents` |
| Delegation bundle | `list_my_subordinates` |
| Cascading context data sources | `read_data_source` |
| Playbook Studio tools | `playbook_read_existing`, `playbook_validate`, `playbook_simulate`, `playbook_estimate_cost`, `playbook_propose_save` |

All new v7.1 skills (`generate_invoice`, `send_invoice`, `reconcile_transactions`, `chase_overdue`, `process_bill`, `track_subscriptions`, `prepare_month_end`, `discover_prospects`, `draft_outbound`, `score_lead`, `book_meeting`, `score_nps_csat`, `prepare_renewal_brief`) are `visibility: basic` (business-visible).

### The distinguishing test: internal state vs external integration

| Internal (app-foundational, `none`) | External (business, `basic`) |
|-------------------------------------|------------------------------|
| `read_workspace` | `read_campaigns` |
| `write_workspace` | `read_crm` |
| `update_memory_block` | `read_docs` |
| `read_data_source` | `read_revenue` |
| `list_my_subordinates` | `read_expenses` |
| | `read_inbox` |

### Where the rule lives

| File | Role |
|------|------|
| `scripts/lib/skillClassification.ts` | Single source of truth |
| `scripts/apply-skill-visibility.ts` | Bulk-applies classification |
| `scripts/verify-skill-visibility.ts` | CI gate |
| `scripts/seed.ts` preflight | Aborts seed on drift |

---

## Appendix E — Hierarchy Infrastructure Dependencies

The three-tier hierarchy works today as a pure reorganisation. To make it functionally enforceable, four infrastructure items are needed:

| Item | Description | Status |
|------|-------------|--------|
| `parentAgentId` in SkillExecutionContext | Pass the invoking manager's agent ID into the worker's execution context | Required for scoped delegation |
| scope param on `config_list_agents` | Allow `list_my_subordinates` to query only direct children | Required for manager routing decisions |
| Parent-scoping in `spawn_sub_agents` / `reassign_task` | Scope to own children only | Required for enforced hierarchy |
| `delegation_kit` skill bundle | `list_my_subordinates`, scoped `spawn_sub_agents`, scoped `reassign_task` | Required for all four managers |

Without these, managers are organisationally correct but not enforcement-scoped. The hierarchy is demonstrably a tree but not yet enforceably one.

**Recommendation:** implement before or during MVP.

---

## Appendix F — Content/SEO + Social Media Merge Investigation Brief

### Context

The v7.1 structural review identified significant overlap between Social Media Agent (`social-media-agent`) and Content/SEO Agent (`content-seo-agent`). They share calendar, brand voice, source material, and analytics. HubSpot/Buffer/Jasper-style workflows treat them as one function. The review recommended merging them at SME scale and splitting only when social volume exceeds daily posting across three or more platforms.

### Decision deferred

The merge is not actioned in v7.1 because the split exists for a reason: short-form (Social) and long-form (Content/SEO) have different tool sets, different review cadences, and different success metrics. A premature merge that later needs to be re-split is more expensive than maintaining two lean agents.

### Investigation brief for Claude Code

**Objective:** Determine whether merging Social Media Agent and Content/SEO Agent into a single "Content & Social Agent" is feasible without losing capability or exceeding practical context-window limits.

**Steps:**

1. **Inventory both agents' skills.** List every skill slug wired to `social-media-agent` and `content-seo-agent` from their respective `AGENTS.md` files. Include the universal skills.
2. **Count unique skills in the merged set.** Deduplicate (both agents share `read_workspace`, `write_workspace`, etc.). Report the total unique skill count.
3. **Assess context-window impact.** For each unique skill, check the `.md` file size in `server/skills/`. Sum the total token footprint that would be loaded into a merged agent's context. Compare against the model's practical working context budget (leaving room for workspace memory, directives, and task content).
4. **Check for tool-selection conflicts.** Identify any pair of skills where the names or descriptions are similar enough that the model might confuse routing (e.g., `draft_post` vs `draft_content`). Flag these as merge risks.
5. **Evaluate the skill gap analysis.** Check the skill gap analysis document for any pending skills planned for either agent. If either agent is projected to grow to 15+ skills (including planned additions), flag this as a merge blocker.
6. **Report.** Produce a structured recommendation: MERGE (with combined agent definition), DO NOT MERGE (with specific blockers), or DEFER (with conditions that would trigger re-evaluation).

**Decision criteria:**
- If combined unique skill count exceeds 18: DO NOT MERGE (too skill-heavy, will degrade tool-selection accuracy)
- If total skill token footprint exceeds 40% of practical context budget: DO NOT MERGE
- If 2+ tool-selection conflict pairs found: DO NOT MERGE unless resolvable via skill renaming
- If gap analysis projects either agent growing past 15 skills: DEFER
- Otherwise: MERGE and produce a combined agent definition

**Output location:** `docs/investigations/content-social-merge.md`

---

*End of Brief — v7.1*
