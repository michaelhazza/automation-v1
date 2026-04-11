---
name: Automation OS
description: The platform's own agent company — a 16-agent team spanning product development, customer operations, growth, finance, and portfolio health. Every agent runs through the same workspace memory, task board, and HITL review queue.
slug: automation-os
schema: agentcompanies/v1
version: 6.0.0
license: proprietary
authors:
  - name: Michael Hazza
goals:
  - Orchestrate end-to-end product development with human-in-the-loop review gates
  - Translate product intent into precise requirements with Gherkin acceptance criteria
  - Implement code changes with plan-then-build discipline and structured self-review
  - Validate all changes with Gherkin-traceable tests and structured failure classification
  - Run customer-facing growth, support, and finance operations with explicit review gates on every outbound action
  - Maintain portfolio-wide health monitoring and cross-subaccount intelligence
---

# Automation OS — System Agent Company

This is the agent company that both runs the business that builds Automation OS and acts as the reference implementation customers see. The full roster is 16 agents: a 15-agent business team reporting through the Orchestrator, plus a separate Portfolio Health Agent operating at org scope.

## Team Structure

```
Human (CEO)
  ├── Orchestrator (COO)
  │     ├── Product Development Team (MVP)
  │     │     ├── Business Analyst
  │     │     ├── Dev Agent
  │     │     └── QA Agent
  │     │
  │     ├── Customer Operations (Phase 2)
  │     │     └── Support Agent
  │     │
  │     ├── Growth (Phase 3)
  │     │     ├── Social Media Agent
  │     │     ├── Ads Management Agent
  │     │     └── Email Outreach Agent
  │     │
  │     ├── Insight & Finance (Phase 4)
  │     │     ├── Strategic Intelligence Agent
  │     │     ├── Finance Agent
  │     │     └── Content/SEO Agent
  │     │
  │     └── Client Lifecycle (Phase 5)
  │           ├── Client Reporting Agent
  │           ├── Onboarding Agent
  │           ├── CRM/Pipeline Agent
  │           └── Knowledge Management Agent
  │
  └── Portfolio Health Agent (org scope, independent)
```

The Portfolio Health Agent does not report to the Orchestrator. It runs at `executionScope: org` against multiple subaccounts on its own schedule and writes to org-level memory.

## Operating Model

Agents communicate through shared state: workspace memory, the task board, Orchestrator directives, and the HITL review queue. They do not call each other in real time. Each agent is scoped to a specific function, scheduled independently, and gated appropriately for the blast radius of its actions.

## Gate Model

| Gate | Behaviour | Used For |
|------|-----------|----------|
| `auto` | Executes immediately, logged | Reads, internal analysis, memory updates, board writes |
| `review` | Creates review item, pauses until approved | Code changes, outbound communications, spec documents, CRM writes, financial record updates |
| `block` | Never executes autonomously | Budget increases, campaign pauses, production deploys, merges, account deletion |

## Revision Loop Caps

| Loop | Cap | Escalation |
|------|-----|------------|
| BA spec revisions | 3 rounds | Dev flags unresolved ambiguity, escalates to human |
| Dev plan-gap reports | 2 rounds | Dev escalates with gap summary |
| Code fix-review cycles | 3 rounds | Dev escalates with unresolved blocking issues |
| QA bug-fix cycles | 3 rounds | QA escalates, blocks release until human resolves |

## Source of Truth

This `COMPANY.md` describes the high-level shape of the company. The authoritative per-agent definition lives in `agents/<slug>/AGENTS.md` — that is what the master seed script (`scripts/seed.ts`) reads via `parseCompanyFolder` to populate `system_agents`. For the full architecture brief covering vision, build sequence, and per-agent skill wiring, see `docs/system-agents-master-brief-v6.md`.
