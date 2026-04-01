---
name: Automation OS
description: The platform's own agent team — the team that builds the platform. Four MVP agents forming a product development team with orchestrated dev/QA loops, BA-driven requirements, and human-in-the-loop review gates.
slug: automation-os
schema: agentcompanies/v1
version: 5.0.0
license: proprietary
authors:
  - name: Michael Hazza
goals:
  - Orchestrate end-to-end product development with human-in-the-loop review gates
  - Translate product intent into precise requirements with Gherkin acceptance criteria
  - Implement code changes with plan-then-build discipline and structured self-review
  - Validate all changes with Gherkin-traceable tests and structured failure classification
  - Maintain tight dev/QA feedback loops with capped revision cycles and automatic escalation
---

# Automation OS — Product Development Team

This is the MVP agent company for Automation OS. These four agents are the platform's first use case — the team that runs the business that builds the platform.

## Team Structure

```
Human (CEO)
  └── Orchestrator (COO)
        ├── Business Analyst
        ├── Dev Agent
        └── QA Agent
```

## Operating Model

Agents communicate through shared state: workspace memory, the task board, orchestrator directives, and the HITL review queue. They do not call each other in real time.

## Gate Model

| Gate | Behaviour | Used For |
|------|-----------|----------|
| `auto` | Executes immediately, logged | Read operations, internal analysis, memory updates |
| `review` | Creates review item, pauses until approved | Code changes, outbound actions, specification documents |
| `block` | Never executes autonomously | Production deploys, merges, account deletion |

## Revision Loop Caps

| Loop | Cap | Escalation |
|------|-----|------------|
| BA spec revisions | 3 rounds | Dev flags unresolved ambiguity, escalates to human |
| Dev plan-gap reports | 2 rounds | Dev escalates with gap summary |
| Code fix-review cycles | 3 rounds | Dev escalates with unresolved blocking issues |
| QA bug-fix cycles | 3 rounds | QA escalates, blocks release until human resolves |
