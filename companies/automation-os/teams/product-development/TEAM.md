---
name: Product Development
description: The MVP product development team — orchestrated dev/QA loops with BA-driven requirements and human-in-the-loop review gates. This is the team that builds the platform itself.
slug: product-development
manager: ../../agents/orchestrator/AGENTS.md
includes:
  - ../../agents/business-analyst/AGENTS.md
  - ../../agents/dev/AGENTS.md
  - ../../agents/qa/AGENTS.md
  - ../../skills/draft-architecture-plan/SKILL.md
  - ../../skills/draft-tech-spec/SKILL.md
  - ../../skills/review-code/SKILL.md
  - ../../skills/review-ux/SKILL.md
  - ../../skills/triage-intake/SKILL.md
tags:
  - engineering
  - product
  - mvp
---

# Product Development Team

The four MVP agents form a coherent product development team. The Orchestrator coordinates, the BA translates intent into requirements, the Dev Agent implements with plan-then-build discipline, and the QA Agent validates with Gherkin-traceable tests.

## Development Pipeline

```
Human or Orchestrator creates a board task
  │
  ├── Simple bug fix or small change
  │     └── Dev Agent reads task
  │           └── draft_architecture_plan (auto)
  │           └── review_code (auto)
  │           └── write_patch (review) — HITL approval
  │           └── QA Agent runs post-patch
  │
  └── Feature or significant change
        └── Business Analyst Agent
              └── draft_requirements (auto)
              └── write_spec (review) — HITL approval
              │
              └── Dev Agent reads approved spec
                    └── draft_architecture_plan (auto)
                    └── draft_tech_spec (auto, if API changes)
                    └── review_ux (auto, if UI changes)
                    └── Implements code
                    └── review_code (auto)
                    └── write_patch (review) — HITL approval
                    │
                    └── QA Agent
                          └── derive_test_cases from Gherkin ACs
                          └── run_tests (auto)
                          └── report_bug (auto) if failures
                          └── QA pass/fail to memory
```

## File-Based Artifact Convention

| Artifact | Written By | Read By |
|----------|-----------|---------|
| Requirements spec (stories + Gherkin) | BA Agent | Dev Agent, QA Agent |
| Architecture plan | Dev Agent | Dev Agent, QA Agent |
| Technical spec (OpenAPI/schema) | Dev Agent | Dev Agent, QA Agent |
| Code patch (diff) | Dev Agent | Human reviewer |
| Test results | QA Agent | Orchestrator, Dev Agent |
| Bug reports | QA Agent | Dev Agent, Orchestrator |
