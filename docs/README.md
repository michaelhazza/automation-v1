# docs/ — spec-corpus index

If you're working on X, read Y. One canonical spec per domain — variants and historical drafts are not listed here.

For repo conventions and patterns, read [`../architecture.md`](../architecture.md) first; this index is the spec layer that sits on top of it. The Claude Code playbook lives in [`../CLAUDE.md`](../CLAUDE.md).

## Capabilities & non-goals

- [`capabilities.md`](capabilities.md) — full catalogue of product capabilities, agency capabilities, skills, and integrations. Update in the same commit as feature work.

## Spec authoring & framing

- [`spec-context.md`](spec-context.md) — framing assumptions used by `spec-reviewer` and `architect`.
- [`spec-authoring-checklist.md`](spec-authoring-checklist.md) — pre-authoring checklist for Significant/Major specs.
- [`codebase-audit-framework.md`](codebase-audit-framework.md) — framework `audit-runner` follows.

## Agent fleet & orchestration

- [`superpowers/specs/2026-04-26-system-agents-v7-1-migration-spec.md`](superpowers/specs/2026-04-26-system-agents-v7-1-migration-spec.md) — canonical spec for the v7.1 system-agents roster, wiring, and migration sequence.
- [`iee-development-spec.md`](iee-development-spec.md) — Integrated Execution Environment (IEE): architecture, execution substrate, and agent lifecycle.
- [`iee-delegation-lifecycle-spec.md`](iee-delegation-lifecycle-spec.md) — IEE Phase 0 delegation lifecycle: how tasks are handed off between orchestrator and worker agents.
- [`orchestrator-capability-routing-spec.md`](orchestrator-capability-routing-spec.md) — capability-aware routing in the Orchestrator agent (P1–P5 implementation).
- [`hierarchical-delegation-dev-spec.md`](hierarchical-delegation-dev-spec.md) — hierarchical agent delegation: parent/child agent trees, capability negotiation, and result propagation.
- [`superpowers/specs/2026-04-29-agents-as-employees-spec.md`](superpowers/specs/2026-04-29-agents-as-employees-spec.md) — "agents are employees" model: persistent identity, assignment lifecycle, and UX contract.
- [`agent-coworker-features-spec.md`](agent-coworker-features-spec.md) — agent-as-coworker feature contracts: Ops Dashboard, Work Feed, Skill Studio, Slack conversational surface, and cross-agent memory search (distinct from agents-as-employees; covers the five surface-level feature implementations).
- [`riley-observations-dev-spec.md`](riley-observations-dev-spec.md) — observation patterns and agent self-monitoring for the Riley agent persona.
- [`agent-intelligence-dev-spec.md`](agent-intelligence-dev-spec.md) — agent intelligence upgrade: reasoning depth, OSS pattern adoption, and skill gap resolution.
- [`execution-contracts.md`](execution-contracts.md) — execution contract primitives shared across all agent tiers.

## HITL (human-in-the-loop)

- [`agent-orchestration-hitl-reference.md`](agent-orchestration-hitl-reference.md) — canonical reference for HITL touchpoints: approval gates, escalation triggers, and interrupt handling.

## Skills

- [`subaccount-skills-and-history-spec.md`](subaccount-skills-and-history-spec.md) — subaccount skill assignment, version history, and analyser UI improvements.
- [`skill-analyzer-v2-spec.md`](skill-analyzer-v2-spec.md) — Skill Analyzer v2: backend classification model, DB-backed system-skills store migration, system-only rescoping, and merge-view pipeline (backend layer; the two entries below cover UX only).
- [`superpowers/specs/2026-04-13-skill-analyzer-ux-redesign.md`](superpowers/specs/2026-04-13-skill-analyzer-ux-redesign.md) — canonical Skill Analyzer UX redesign (results page).
- [`superpowers/specs/2026-04-14-skill-analyzer-processing-ux.md`](superpowers/specs/2026-04-14-skill-analyzer-processing-ux.md) — Skill Analyzer processing UX and reliability improvements.

## Canonical data platform

- [`canonical-data-platform-p1-p2-p3-impl.md`](canonical-data-platform-p1-p2-p3-impl.md) — canonical data platform implementation across P1–P3 phases.

## ClientPulse

- [`superpowers/specs/2026-04-24-clientpulse-ui-simplification-spec.md`](superpowers/specs/2026-04-24-clientpulse-ui-simplification-spec.md) — ClientPulse UI simplification (canonical; supersedes `clientpulse-dev-spec.md` for UI surface).
- [`clientpulse-dev-spec.md`](clientpulse-dev-spec.md) — ClientPulse backend contracts and data model (still canonical for non-UI behaviour).

## GEO / SEO

- [`geo-seo-spec.md`](geo-seo-spec.md) — GEO/SEO feature spec: content optimisation, ranking signals, and agent integration.

## Onboarding & configuration

- [`onboarding-playbooks-spec.md`](onboarding-playbooks-spec.md) — onboarding flow and daily intelligence brief spec (new-user playbook primitives and UI surfaces).
- [`config-agent-guidelines-spec.md`](config-agent-guidelines-spec.md) — Configuration Agent guidelines: what the agent may and may not change, guardrails.
- [`configuration-assistant-spec.md`](configuration-assistant-spec.md) — Configuration Assistant spec: conversational setup flow and data-collection contract.

## Briefs, memory, context

- [`universal-brief-dev-spec.md`](universal-brief-dev-spec.md) — Universal Brief: unified briefing surface across all agent tiers (canonical brief spec).
- [`brief-result-contract.md`](brief-result-contract.md) — Brief Result Contract v1: typed schema and version invariants for brief outputs.
- [`memory-and-briefings-spec.md`](memory-and-briefings-spec.md) — memory and briefings build plan: storage model, retrieval, and surfacing.
- [`cascading-context-data-sources-spec.md`](cascading-context-data-sources-spec.md) — cascading context data sources and scheduled task instruction injection.
- [`cached-context-infrastructure-spec.md`](cached-context-infrastructure-spec.md) — cached context infrastructure: prompt-cache warming, invalidation, and cost attribution.
- [`superpowers/specs/2026-04-28-pre-test-brief-and-ux-spec.md`](superpowers/specs/2026-04-28-pre-test-brief-and-ux-spec.md) — pre-test Universal Brief follow-up and dashboard error UX fixes.

## Routines & reporting

- [`routines-response-dev-spec.md`](routines-response-dev-spec.md) — Routines feature: response structure, scheduling model, and Anthropic-launch alignment.
- [`reporting-agent-paywall-workflow-spec.md`](reporting-agent-paywall-workflow-spec.md) — Reporting Agent paywall → video → transcript → Slack workflow spec (final v3.4).

## Scraping & beliefs

- [`robust-scraping-engine-spec.md`](robust-scraping-engine-spec.md) — robust scraping engine: retry model, proxy strategy, and failure classification.
- [`beliefs-spec.md`](beliefs-spec.md) — beliefs subsystem: how the platform stores, updates, and queries persistent agent beliefs.

## MCP & integrations

- [`mcp-tool-invocations-spec.md`](mcp-tool-invocations-spec.md) — MCP tool invocation cost attribution and observability.
- [`integration-reference.md`](integration-reference.md) — integration reference: supported providers, capability matrix, and connection lifecycle.

## Tenancy & permissions

- [`superpowers/specs/2026-04-29-pre-prod-tenancy-spec.md`](superpowers/specs/2026-04-29-pre-prod-tenancy-spec.md) — pre-production tenancy hardening (canonical; covers RLS gaps and tenant isolation invariants).
- [`superpowers/specs/2026-04-29-pre-prod-boundary-and-brief-api-spec.md`](superpowers/specs/2026-04-29-pre-prod-boundary-and-brief-api-spec.md) — pre-production boundary security and Brief API hardening.
- [`org-subaccount-refactor-spec.md`](org-subaccount-refactor-spec.md) — org/subaccount data model refactor: schema changes and migration path.
- [`soft-delete-filter-gaps-spec.md`](soft-delete-filter-gaps-spec.md) — soft-delete filter gap fixes: audit findings and remediation spec.

## Pre-launch hardening & dev tooling

- [`pre-launch-hardening-spec.md`](pre-launch-hardening-spec.md) — consolidated pre-launch hardening spec: 6-phase plan across 78 deferred items (canonical; supersedes mini-spec).
- [`pre-launch-hardening-invariants.md`](pre-launch-hardening-invariants.md) — 43 hardening invariants across 7 categories with typed enforcement owners.
- [`superpowers/specs/2026-04-25-codebase-audit-remediation-spec.md`](superpowers/specs/2026-04-25-codebase-audit-remediation-spec.md) — codebase audit remediation implementation spec.
- [`superpowers/specs/2026-04-26-audit-remediation-followups-spec.md`](superpowers/specs/2026-04-26-audit-remediation-followups-spec.md) — post-merge audit remediation follow-ups backlog.
- [`superpowers/specs/2026-04-28-pre-test-backend-hardening-spec.md`](superpowers/specs/2026-04-28-pre-test-backend-hardening-spec.md) — pre-test backend hardening: targeted fixes before integration test activation.
- [`superpowers/specs/2026-04-28-system-monitoring-coverage-spec.md`](superpowers/specs/2026-04-28-system-monitoring-coverage-spec.md) — system monitoring coverage gaps and observability additions.
- [`superpowers/specs/2026-04-28-dev-mission-control-spec.md`](superpowers/specs/2026-04-28-dev-mission-control-spec.md) — Dev Mission Control: unified developer dashboard for build-pipeline visibility.
- [`investigate-fix-protocol.md`](investigate-fix-protocol.md) — Investigate-Fix Protocol v1: structured approach for diagnosing and resolving production incidents.
- [`run-continuity-and-workspace-health-spec.md`](run-continuity-and-workspace-health-spec.md) — run continuity and workspace health: handoff documents, execution plans, and session log UI.

## Testing

- [`testing-conventions.md`](testing-conventions.md) — canonical testing posture and conventions (read before adding any test).
- [`test-migration-spec.md`](test-migration-spec.md) — Vitest migration spec: plan for moving from ad-hoc runners to a unified Vitest pipeline.
- [`superpowers/specs/2026-04-28-pre-test-integration-harness-spec.md`](superpowers/specs/2026-04-28-pre-test-integration-harness-spec.md) — integration test harness spec: fixtures, seed data, and CI job wiring.
- [`superpowers/specs/2026-04-30-integration-tests-fix-brief.md`](superpowers/specs/2026-04-30-integration-tests-fix-brief.md) — dev brief for fixing integration CI test failures (2026-04-30).

## Frontend design

- [`frontend-design-principles.md`](frontend-design-principles.md) — frontend design principles (read before any UI mockup or new page design).
- [`superpowers/specs/2026-04-13-activity-page-consolidation-design.md`](superpowers/specs/2026-04-13-activity-page-consolidation-design.md) — unified Activity Page consolidation design spec.

## Playbooks & decision steps

- [`playbook-agent-decision-step-spec.md`](playbook-agent-decision-step-spec.md) — `agent_decision` step type for playbooks: schema, engine changes, and validation rules.

## What's NOT here

- Historical drafts and superseded versions of the above (the canonical link is the latest).
- Per-domain "how to extend" recipes (deferred per `agentic-engineering-notes-dev-spec.md` § 9).
- Implementation notes that live as comments in the code or as commit messages.
- `improvements-roadmap-spec.md` — broad pre-test restructuring plan written against a specific `main` snapshot; historical planning artifact now superseded by per-domain superpowers/specs entries.
