# SynthetOS Governed Agentic Operating System

**Master Architecture, Strategy, and Implementation Brief — v1.2**

Baseline document for future build planning, codebase stress-testing, specs, and product direction.

Date: May 2026

---

## Contents

- [0. Document Purpose](#0-document-purpose)
- [1. Executive Summary](#1-executive-summary)
- [2. Strategic Positioning](#2-strategic-positioning)
- [3. Baseline Architecture Diagram](#3-baseline-architecture-diagram)
- [4. The Core Architectural Breakthrough](#4-the-core-architectural-breakthrough)
- [5. Master Mental Model](#5-master-mental-model)
- [6. Layered Architecture](#6-layered-architecture)
- [7. Operator Controller Backends](#7-operator-controller-backends)
- [8. ChatGPT OAuth](#8-chatgpt-oauth)
- [9. Credential Broker and Identity Boundary](#9-credential-broker-and-identity-boundary)
- [10. Policy Envelope](#10-policy-envelope)
- [11. Capability Risk Tiers](#11-capability-risk-tiers)
- [12. Run Trace](#12-run-trace)
- [13. Memory Boundaries](#13-memory-boundaries)
- [14. Ownership Boundaries](#14-ownership-boundaries)
- [15. System-Level vs Customer Agents](#15-system-level-vs-customer-agents)
- [16. Final Use Case Set](#16-final-use-case-set)
- [17. Use Case Coverage Matrix](#17-use-case-coverage-matrix)
- [18. Phased Implementation Roadmap](#18-phased-implementation-roadmap)
- [19. Codebase Alignment Assumptions](#19-codebase-alignment-assumptions)
- [20. Codebase Stress-Test Outcomes](#20-codebase-stress-test-outcomes)
- [21. Enterprise Architecture Review Notes](#21-enterprise-architecture-review-notes)
- [22. UI / UX Implications](#22-ui-ux-implications)
- [23. MVP Discipline](#23-mvp-discipline)
- [24. Next Deliverables](#24-next-deliverables)
- [25. Locked Baseline Principles](#25-locked-baseline-principles)
- [26. Final Architecture Summary](#26-final-architecture-summary)
- [27. Final Positioning Statement](#27-final-positioning-statement)
- [28. Cross-References to Existing Documents](#28-cross-references-to-existing-documents)

---

## 0. Document Purpose

This document is the master baseline brief for the SynthetOS Governed Agentic Operating System architecture.

It consolidates the strategic positioning, infrastructure model, runtime abstractions, governance model, implementation roadmap, use cases, and architectural principles developed through the planning discussion.

This document should be used as the anchor for: future architecture reviews, codebase stress-testing, spec creation, build planning, product design, UI / UX planning, IEE refactor or expansion, runtime / controller / environment schema design, Run Trace alignment, Credential Broker planning, Operator Controller planning, use case flow diagrams, phased delivery planning.

The goal is to design the future architecture broadly and correctly now, while implementing it in tightly constrained phases to avoid overengineering.

### 0.1 What this brief is

This is a master architecture and strategy baseline. It defines the target architecture, ownership boundaries, core abstractions, terminology, and phased direction for SynthetOS.

It should be used to align future reviews, specs, implementation plans, UI decisions, runtime planning, and codebase stress-testing.

### 0.2 What this brief is not

This is not a Phase 1 build spec. This is not a commitment to implement every environment, controller, model provider, or use case immediately. This is not a database schema. This is not a final UI specification. This is not a runtime backend decision. This is not a mandate to build full autonomous operators before the governed deterministic execution foundation is stable.

### 0.3 What changed from v1.1

v1.2 incorporates the findings of the v1.1 codebase stress-test. The strategic positioning is unchanged. Ten substantive changes were applied:

1. New Section 4.0 (Naming map) reconciles brief terminology with existing code names.
2. Native vs Operator Controller is now first-class as a `controllerStyle` axis, explicitly separate from execution capability.
3. Capability Risk Tiers clarified as single-axis (max tier) with multi-axis overrides via the existing policy rule mechanism.
4. Run Trace clarified as a virtual view over existing decision ledgers in Phase 1; consolidation into a canonical ledger deferred to Phase 3 or later.
5. Hermes converted to a "future internal backend (TBD)" placeholder; Operator Controller backend selection deferred to a dedicated spec.
6. Phase 1 scope tightened to foundation plus two showcase MVPs. Other use cases moved to a new Phase 1.5.
7. Phase 2 sandbox features carry an explicit dependency on shipping a sandbox isolation primitive first.
8. "Full autonomy mode" in Phase 4+ marked as requiring definition before scoping.
9. Cross-references added to the OpenClaw Strategic Analysis, Hierarchical Agent Delegation contract, and IEE Delegation Lifecycle Spec already in the codebase.
10. Credential Broker, Policy Engine, and Capability-Aware Orchestrator noted as already implemented in spirit; the work is consolidation and naming, not building.

---

## 1. Executive Summary

SynthetOS should be positioned as:

> **The Governed Agentic Operating System for autonomous execution.**

SynthetOS is not merely an automation platform, a chatbot system, a browser automation tool, a workflow builder, a coding agent, an AI agent framework, or a generic orchestration tool.

SynthetOS should become the control plane for governed autonomous work, using agentic operating system language externally while keeping precise control-plane and execution-plane boundaries internally.

IEE, the Integrated Execution Environment, should become the execution plane that safely runs tasks using different execution styles, execution environments, model identities, tools, and runtime backends.

The central mental model:

```text
SynthetOS = Control Plane
IEE       = Execution Plane

Agents          = Organisational entities
Controllers     = Execution styles
Environments    = Execution capabilities
Model Access    = Provider / identity layer
Run Trace       = Governed execution observability
Credential Broker = Identity boundary
```

This architecture allows SynthetOS to support deterministic automations today while evolving toward long-running autonomous operators, AI workforce orchestration, and enterprise-grade governed execution over time.

---

## 2. Strategic Positioning

### 2.1 Primary positioning

> **SynthetOS is the Governed Agentic Operating System for autonomous execution.**

### 2.2 Category

> **Governed Agentic Operating System.**

### 2.3 Expanded positioning

SynthetOS enables organisations to deploy AI agents safely across deterministic workflows, controlled environments, and adaptive operator modes with policy, identity, approvals, and Run Trace observability built in from the ground up.

### 2.4 Internal architecture thesis

```text
SynthetOS = Control Plane
IEE       = Execution Plane
```

The operating principle:

> **SynthetOS decides. IEE executes.**

### 2.5 Strategic thesis

The opportunity is not to build another AI agent product. The opportunity is to standardise governed autonomous execution across organisations by combining:

- agents as organisational actors
- deterministic workflows
- adaptive autonomous operators
- policy-constrained execution routing
- controlled execution environments
- secure credential boundaries
- model and provider abstraction
- human approval gates
- Run Trace observability
- multi-tenant governance
- phased runtime extensibility

This places SynthetOS between two flawed extremes:

| Extreme | Problem |
|---|---|
| Traditional workflow automation | Too rigid, deterministic only, weak adaptive execution |
| Generic AI agent frameworks | Too chaotic, weak governance, weak auditability |

SynthetOS should become the platform that allows organisations to use AI agents safely, observably, and operationally.

---

## 3. Baseline Architecture Diagram

The current visual baseline is the v1.1 master diagram. Diagram updates required for v1.2 are listed in the v1.1 to v1.2 change list (separate document, `docs/synthetos-brief-v1.1-to-v1.2-changes.md`). Apply those updates before treating the diagram as v1.2-aligned.

---

## 4. The Core Architectural Breakthrough

The architecture becomes clear only after separating six concepts that are often blurred together:

- Agents
- Controllers
- Execution Environments
- IEE Infrastructure
- Model Access and Identity
- Run Trace

Most agent platforms collapse these into one object called an "agent." That creates long-term problems: unclear ownership, weak governance, unpredictable routing, hidden memory, runtime lock-in, poor auditability, poor tenant boundaries, inability to swap execution backends, difficulty scaling from deterministic workflows to autonomous operators.

SynthetOS should avoid this by treating each abstraction separately.

### 4.0 Naming map (existing code to brief terminology)

The codebase already implements much of what the brief proposes, sometimes under different names. v1.2 locks one name per concept. The mapping is:

| Concept | Existing code name | Brief name (locked) |
|---|---|---|
| Routing engine | Capability-Aware Orchestrator (`orchestratorFromTaskJob`, paths A / B / C / D) | Router and Execution Planner |
| Routing decisions | `routing_outcomes` table | Run Trace event |
| Execution capability | `executionMode` enum (`api`, `headless`, `claude-code`, `iee_browser`, `iee_dev`) | Execution Environment |
| Execution style | (not present today) | Controller (`controllerStyle: native or operator`) |
| Action gate | `actions.gateLevel` (`auto`, `review`, `block`) | Approval level (derived from Risk Tier) |
| Execution substrate | IEE worker (browser plus dev) | IEE Execution Plane (expanded scope) |
| Credential storage | `integration_connections` plus `connectionTokenService` | Credential Broker and Identity Boundary |
| Decision audit | `agent_execution_events`, `routing_outcomes`, `delegation_outcomes`, `tool_call_security_events`, `reviewAuditRecords` | Run Trace (Phase 1: virtual view; Phase 3+: canonical ledger) |
| Policy rule store | `policyRules` plus `policyEngineService` | Policy Engine (component of Policy Envelope) |
| Run-time constraints | `subaccountAgents.tokenBudgetPerRun`, `maxToolCallsPerRun`, `maxCostPerRunCents`, `spendingPolicies` | Policy Envelope (run-time snapshot) |
| HITL approval flow | `actions` to `reviewItems` to `reviewAuditRecords` plus Slack Block Kit | Approval Workflow |
| Capability discovery | `list_platform_capabilities`, `check_capability_gap`, `list_connections`, `request_feature` skills | Capability Matching (component of Router) |
| Per-agent capability snapshot | `subaccountAgents.capabilityMap` (JSONB) | Agent Capability Map |
| Three-tier agent model | `system_agents`, `agents`, `subaccount_agents` | Three-tier Agent Model (unchanged) |
| Hierarchical delegation | Root agent contract, `DelegationScope` enum, derived skills, run-trace delegation graph | Agent Hierarchy (cross-reference to existing spec) |
| LLM router | `llmRouter.routeCall` (single entry point) | Model Invocation Capability |
| Cost ledger | `llm_requests` plus `cost_aggregates` | Billing and Usage |

### 4.1 Terminology baseline

| Term | Meaning |
|---|---|
| Agent | Organisational role or entity that owns work, responsibility, permissions, and accountability. |
| Controller | Execution style selected for a task: deterministic Native execution or adaptive Operator execution. Encoded as a `controllerStyle` field, separate from execution capability. |
| Execution Environment | Capability surface invoked by a controller: browser, sandbox, API and tool, terminal and repo, or local and BYO. |
| IEE | Integrated Execution Environment. The execution substrate responsible for sessions, workers, isolation, artifacts, telemetry, and runtime execution. |
| Model Access | Provider or identity layer used for inference: platform APIs, BYO keys, local endpoints, or session identities. |
| Model Invocation Capability | The runtime act of calling a model during execution. Distinct from model provider identity and access policy. |
| Operator Session Identity | Session-based model identity, such as ChatGPT OAuth, used for approved Operator Controller workflows. |
| Policy Envelope | The constraint set that governs routing, execution permissions, risk tiers, approvals, data handling, and cost boundaries for a given run. |
| Run Trace | Governed execution record showing what happened, why, under whose authority, using which systems, and with what outcome. |
| Credential Broker and Identity Boundary | Governance and runtime boundary for credentials, session identities, scoping, injection, audit, revocation, and tenant isolation. |

---

## 5. Master Mental Model

### 5.1 Agents are organisational entities

Agents represent roles, responsibilities, goals, and ownership within an organisation. They belong to the organisation structure. They are not tied to a controller or runtime.

Agents may additionally be owned by a specific user. User-owned agents act under that user's identity for credential resolution, run attribution, and privacy boundary. The Executive Assistant (§16.1) is the first consumer; the Dev Agent (§16.3) is the second. Subaccount-owned agents (the existing default) are unaffected.

Examples include: Executive Assistant, Support Agent, Revenue Ops Assistant, Research Intelligence Agent, Paid Ads Monitoring Agent, Appointment Setter, Dev Agent, COO / Orchestrator Agent, QA Agent, Platform Engineering Agent.

Agents answer:

> **Who owns this work?**

Agents should have role, goals, domain, memory scope, permissions, escalation rules, tools, connected systems, allowed controllers, allowed environments, model access preferences, approval requirements, run policies, cost limits, and accountability.

Do not define agents as `Native Agent`, `Operator Agent`, `Sandbox Agent`, `Browser Agent`. Those are execution concepts, not organisational roles.

The codebase already implements a three-tier agent model (System, Org, Subaccount) plus hierarchical delegation with a root agent contract and a `DelegationScope` enum. The agent definitions in the brief should align with these existing primitives rather than create parallel concepts.

### 5.2 Controllers are execution styles

Controllers define the style of execution used for a task. They answer:

> **How should this task be executed?**

The two initial controllers are:

| Controller | Role |
|---|---|
| Native Controller | Deterministic, structured, short-lived workflows |
| Operator Controller | Autonomous, adaptive, long-running, investigative workflows |

A single organisational agent may use either controller depending on the task.

```text
Executive Assistant Agent
    Summarise inbox                  → Native Controller
    Investigate complex client issue → Operator Controller
```

**Controller style is orthogonal to execution capability.** A deterministic browser flow, for example a fixed login plus fixed download plus fixed processing pipeline, is Native style on a Browser environment. An autonomous browser operator investigating a paywall or a complex booking flow is Operator style on the same Browser environment.

Today's `executionMode` enum encodes capability (api, browser, dev), not style. v1.2 adds `controllerStyle` as a first-class field on the agent run record. Loop limits, budgets, and approval defaults differ between styles. Native runs default to short loops with strict templating. Operator runs default to longer loops with adaptive tool use and stronger Run Trace requirements.

### 5.3 Execution environments are capabilities

Execution environments provide capabilities used by controllers. They answer:

> **What capabilities are needed to complete this task?**

Examples: Browser Environment, Sandbox Environment, Terminal and Repo Environment, API and Tool Environment, Model Invocation Capability, Local and BYO Environment.

Execution environments are not agents. They are not controllers. They are capabilities that controllers invoke.

### 5.4 IEE is the execution substrate

IEE stands for Integrated Execution Environment. IEE today refers narrowly to the existing browser plus dev worker. v1.2 expands the meaning of IEE to the shared execution substrate that manages sessions, workers, environments, queues, containers, runtime nodes, isolation, credentials, artifacts, execution telemetry, and Run Trace event publication.

This expansion is deliberate. Expect to find references to "IEE" in existing code and docs that mean the narrow definition; a naming pass is part of the Phase 1 foundation work.

IEE answers:

> **Where and how does the work physically execute?**

### 5.5 Model access is identity and provider infrastructure

Model access determines which model, provider, or identity is used. It is separate from the agent, the controller, the environment, the runtime backend, and the IEE node.

Model access answers:

> **Which model or model identity provides intelligence for this task?**

This includes platform OpenAI API, platform Anthropic API, platform Google and Gemini API, BYO API keys, ChatGPT OAuth, future session identities, local and self-hosted models.

The codebase already routes all LLM calls through a single `llmRouter.routeCall` entry point with statically and runtime-enforced provider attribution. The Model Invocation Capability concept maps cleanly to this router; the Model Access and Identity Layer adds the provider identity and routing policy layer above it.

### 5.6 Run Trace is governed execution observability

SynthetOS already has a Run Trace concept and a `RunTracePage.tsx` UI. v1.2 aligns the brief's Run Trace meaning with the existing surface.

Run Trace is the governed record of what happened during a run. It should capture: who or what initiated the run, intent captured, policy envelope evaluated, routing decision, controller selected, environments used, model identity and provider used, credentials injected, tools and APIs called, approvals requested, actions executed, artifacts produced, memory updates, errors and retries, and final outcome.

Run Trace answers:

> **What happened, why, using what, under whose authority, with what outcome?**

In Phase 1, Run Trace is implemented as a **virtual view** over existing decision ledgers (`agent_execution_events`, `routing_outcomes`, `delegation_outcomes`, `tool_call_security_events`, `reviewAuditRecords`). A canonical Run Trace event table that consolidates these into one ledger is deferred to Phase 3 or later when scale and audit requirements justify the migration cost.

**Universal controller invariant (V2):** All controllers — native, operator-mode, and future controller styles — surface through the same `OpenTaskView` primitives and the same event renderer. No controller-specific UI chrome is introduced. V2 adds four event variants (`file.created`, `file.modified`, `cross_owner_substep.awaiting_initiator_decision`, `cross_owner_substep.completed`) to the run-trace event stream; all four render through the existing event renderer.

---

## 6. Layered Architecture

### 6.1 Layer 1: SynthetOS Control Plane

The SynthetOS Control Plane owns business-level orchestration and governance. It includes organisations, subaccounts, agents, workflows, tasks, memory, knowledge, policies, approvals, audit, billing, usage, identity bindings, integration catalog, permissions, role hierarchy, routing policy, run ownership, and customer-facing UX.

SynthetOS owns:

```text
policy
identity
memory
approvals
audit
billing
task ownership
agent hierarchy
business context
governance
```

The Control Plane is where intent and governance live.

### 6.2 Layer 2: Policy-Constrained Router and Execution Planner

The Router and Execution Planner is the dynamic decision engine. It performs intent understanding, task decomposition, capability matching, controller selection, environment selection, model access selection, risk tier evaluation, cost evaluation, approval requirement detection, and route and dispatch.

The router must operate within a Policy Envelope. The key principle:

> **Routing is policy-constrained, not unconstrained autonomy.**

The router should only select execution paths allowed by agent permissions, allowed controllers, allowed environments, allowed tools, allowed integrations, risk tier limits, cost and budget limits, approval requirements, data handling rules, organisation and subaccount policy, credential availability, and system-level safety rules.

The codebase already implements this routing engine as the **Capability-Aware Orchestrator** (`orchestratorFromTaskJob`, paths A, B, C, D). v1.2 retains the Capability-Aware Orchestrator as the implementation of this layer. The "Router and Execution Planner" name is the brief-level name; the code keeps "Orchestrator" as the file and service prefix to avoid a service-wide rename.

### 6.3 Layer 3: Controllers

Controllers are execution styles.

#### Native Controller

The Native Controller is the default. It is used for deterministic workflows, known process flows, event-driven automations, scheduled jobs, API orchestration, templated generation, simple classifications, structured triage, and predictable business processes.

Characteristics: deterministic, structured, short-lived, lower cost, reliable, reproducible, easier to audit, easier to test, easier to retry.

Native Controller should be used whenever possible. Examples include the 42 Macro Task, support inbox triage, revenue ops invoice follow-up, research summaries MVP, paid ads monitoring MVP, deterministic CRM updates, and scheduled reports.

#### Operator Controller

The Operator Controller is used only when autonomy is justified. It is used for ambiguous tasks, long-running tasks, exploratory tasks, investigation, iterative reasoning, complex judgement, adaptive tool use, exception handling, tasks with uncertain outcomes, and tasks requiring persistence.

Characteristics: autonomous, adaptive, long-running, investigative, judgement-based, higher cost, more powerful, harder to test, requires stronger governance, requires richer Run Trace, requires stricter approval controls.

Examples include Executive Assistant as standing operator, Dev Agent / Bug Fixing, complex support investigation, advanced research operator, operator-led paid ads investigation, and complex appointment setting / re-engagement.

Important principle:

> Native Controller is default. Operator Controller is escalation and adaptive mode.

### 6.4 Layer 4: Execution Environments / Capabilities

Execution environments provide capability surfaces to controllers.

#### Browser Environment

Purpose: web automation, portal login, navigation, screenshots, file download, content extraction, scraping where appropriate, session and cookie handling, browser workflow execution.

Likely current implementation: Dockerised Playwright browser environment within IEE (`iee_browser` mode).

Used by 42 Macro Task, research, support investigation, executive assistant workflows, subscriptions and travel workflows, paid ads troubleshooting.

#### Sandbox Environment

Purpose: isolated code execution, file processing, data transformation, generated script execution, safe compute jobs, temporary execution labs, attachment analysis, controlled untrusted code execution.

Implementation path: Docker first, Firecracker or microVM later for stronger isolation.

Important clarification: the Sandbox Environment is generally not a controller. It does not plan or own work. It is a secure disposable execution environment used by a controller.

```text
Native Controller   → Sandbox Environment → transform CSV
Operator Controller → Sandbox Environment → run isolated test script
```

The codebase today does not have a separate Sandbox Environment. Today's `iee_dev` mode collapses sandbox-style execution and terminal and repo execution into one path. Phase 2 sandbox features depend on shipping a sandbox isolation primitive first; see Section 18.2.

#### Terminal and Repo Environment

Purpose: shell access, git operations, repo inspection, code editing, builds, tests, debugging, CI workflows, filesystem access.

Risk: very high. This should be restricted mainly to system and internal agents, Platform Engineering org, SynthetOS Dev Agent, tightly scoped advanced workflows.

#### API and Tool Environment

Purpose: API orchestration, webhooks, MCP tools, external SaaS integrations, internal services, CRM, accounting, ads, email, calendar, docs tools.

Examples: Gmail, Outlook, Google Calendar, Outlook Calendar, HubSpot, Salesforce, GoHighLevel, Xero, QuickBooks, Meta and Facebook Ads, Google Ads, GitHub, GitLab, Google Drive, SharePoint, internal APIs.

#### Model Invocation Capability

Purpose: LLM inference, embeddings, reranking, classification, summarisation, generation, tool-calling, streaming, inference caching.

This capability is the runtime act of invoking a model. It should remain separate from the Model Access and Identity Layer, which owns provider identity, OAuth and session identity, API keys, BYO credentials, and local and self-hosted endpoint configuration.

#### Local and BYO Environment

Purpose: local and on-prem execution, customer-owned compute, private model endpoints, edge execution, GPU nodes, sovereign workloads, offline execution.

This is a future phase, not part of the immediate MVP.

### 6.5 Layer 5: IEE Execution Plane and Infrastructure Layer

IEE is the execution substrate. IEE owns session manager, worker scheduler, artifact store, credential injection mechanics, runtime isolation, telemetry and observability, Run Trace event publishing, containers and VMs, queues, event bus and streams, network and egress controls, storage and artifacts, runtime health, execution state, environment lifecycle.

IEE should not own business policy, task ownership, durable organisational memory, approval semantics, billing ownership, agent hierarchy, or customer-facing role definitions.

The rule:

> **SynthetOS decides. IEE executes.**

### 6.6 Layer 6: Model Access and Identity Layer

Model access is separate from runtime infrastructure. There are two major classes.

#### Platform Model Providers

These power standard system inference. Examples include OpenAI API, Anthropic API, Google and Gemini API, BYO API keys.

Used by Native Controller, normal workflows, system-level inference, summarisation, classification, drafts, research summaries, paid ads analysis, support triage.

#### Operator Session Identities

These support long-running operator workflows. Examples include ChatGPT OAuth, future desktop and session identities, future authenticated app identities.

ChatGPT OAuth should be treated as **Operator Session Identity**, not as a generic platform API provider. It may provide generous usage and be highly valuable for Operator Controller tasks, but it should not become the default inference architecture.

Implementation context: the OpenClaw Strategic Analysis (`docs/openclaw-strategic-analysis.md`) already proposes this exact pattern as Phase 3 of the OpenClaw integration roadmap, including OAuth session state machine, relink UX, and loud-failure events on session expiry. v1.2 aligns with that proposal rather than duplicating it.

---

## 7. Operator Controller Backends

Operator Controller should be backend-agnostic. Possible backend implementations include:

- OpenClaw (covered in detail by the OpenClaw Strategic Analysis)
- Future internal backend (TBD; selection deferred to a dedicated Operator Controller backend spec)

These are implementation examples, not customer-facing architecture. Avoid exposing `OpenClaw Agent` or backend-specific names in the normal UI. Use product language such as `Operator Mode`, `Operator Controller`, `Operator Session`, `Autonomous Operator`.

Backends can change over time without changing the SynthetOS agent model.

The architectural prerequisite for any Operator Controller backend is the **ExecutionBackend adapter contract**, called out as Phase 1 of the OpenClaw Strategic Analysis. This contract defines a single pluggable interface so OpenClaw, future internal backends, and any other operator runtime become participating implementations rather than hardcoded branches in agent execution.

---

## 8. ChatGPT OAuth

ChatGPT OAuth is a valuable capability but should be carefully positioned. It is not the same as the OpenAI API. It is best understood as:

> **a session-based model identity for Operator Controller workflows.**

It may be used by an Operator Controller backend such as OpenClaw. It should live in the Model Access and Identity Layer under `Operator Session Identities`.

Potential UI location:

```text
Subaccount Settings
    AI and Models
        Operator Session Identities
            Connect ChatGPT
```

Important principles:

- configured at subaccount level
- scoped to that subaccount
- available to approved agents within the subaccount
- injected only into approved operator sessions
- governed by Credential Broker and Identity Boundary
- visible in Run Trace when used
- revocable
- auditable
- fallback options should exist

Fallbacks may include platform OpenAI API, Anthropic API, Gemini API, BYO API keys, future local model.

Implementation reference: the OpenClaw Strategic Analysis defines OAuth session state, relink UX, fallback chain semantics, and loud-failure events. v1.2 references that document rather than restating it.

---

## 9. Credential Broker and Identity Boundary

The Credential Broker is core governance infrastructure. It should be named:

> **Credential Broker and Identity Boundary**

Credential policy, scope, approval, audit, and revocation are owned by the SynthetOS Control Plane. Credential injection mechanics are executed by IEE at runtime. The Credential Broker and Identity Boundary spans both layers, but governance authority remains with SynthetOS.

It governs API keys, OAuth tokens, ChatGPT OAuth identities, Gmail credentials, Calendar credentials, browser cookies, SSH keys, certificates, temporary credentials, runtime secrets, session identities, credential injection, credential revocation, credential rotation, tenant and subaccount boundaries, audit access, approval-based access.

Its job is to allow shared IEE infrastructure while preventing credential leakage or cross-tenant exposure.

For user-owned agents, the broker resolves credentials by (subaccount_id, owner_user_id, provider). A mismatch between the requested ownerUserId and the credential's owner_user_id raises OWNER_MISMATCH and fails the run closed.

It should enforce subaccount scoping, agent scoping, session scoping, environment scoping, time-limited access, policy-based injection, auditability, revocation.

The codebase already implements most of this in the existing `integration_connections` table, `connectionTokenService` (AES-256-GCM encryption, OAuth refresh with advisory locks, drop-after-use for web login), per-subaccount and per-agent scoping, RLS plus service-layer plus worker-side enforcement, and audit logging through `auditEvents`. The Phase 1 work is to expose this as a single named facade (`CredentialBrokerService`) and add an explicit `auth_type` for Operator Session Identity, not to build the underlying mechanics from scratch.

---

## 10. Policy Envelope

Every execution should operate inside a Policy Envelope. The Policy Envelope controls what the router can choose and what the execution may do. It includes agent permissions, allowed controllers, allowed environments, allowed integrations, allowed tools, model access options, risk tier limits, data handling rules, budget and cost limits, approval requirements, runtime availability, credential availability, human-in-the-loop rules.

The Policy Envelope prevents the system from turning into unconstrained autonomy.

The codebase already implements most envelope components in scattered locations (`policyRules`, `actions.gateLevel`, `subaccountAgents` budget fields, `spendingPolicies`, `toolRestrictionMiddleware`, `proposeActionMiddleware`). v1.2 introduces the Policy Envelope as the **named per-run snapshot** that captures the resolved constraint set for a given run, so every Run Trace can replay the envelope that was in force.

### 10.1 Default routing rules

Default routing should be conservative, governed, and explainable.

- Use Native Controller when the task is deterministic, short-lived, repeatable, and policy-covered.
- Use API and Tool Environment when a supported API or integration can complete the task safely.
- Use Browser Environment only when API or tool access is insufficient or the target system requires browser interaction.
- Use Sandbox Environment only when isolated code execution, file processing, data transformation, or temporary compute is required.
- Use Operator Controller only when ambiguity, investigation, persistence, exception handling, or adaptive tool use is required.
- Use Terminal and Repo Environment only for system or internal agents or explicitly approved advanced workflows.
- Require approval for Tier 6 actions by default.
- Record the policy reason for controller, environment, model access, approval, and denial decisions in Run Trace.

---

## 11. Capability Risk Tiers

Capability risk tiers should drive approvals, observability, and allowed execution.

Recommended tiers:

| Tier | Capability |
|---|---|
| Tier 0 | Model reasoning only |
| Tier 1 | Internal data reads |
| Tier 2 | External API reads and writes |
| Tier 3 | Browser actions and web extraction |
| Tier 4 | Sandboxed code execution |
| Tier 5 | Terminal, repo, filesystem access |
| Tier 6 | Deploy, funds, client messaging, high-impact actions |

Risk tiers should affect whether Native Controller is sufficient, whether Operator Controller is allowed, whether approval is required, whether credential injection is permitted, what Run Trace detail is required, whether human review is mandatory, and whether a task can be executed at all.

### 11.1 Tier dimensionality

The default model is **single-axis: each action is assigned a single max-tier value**. The action's tier is the highest applicable level across technical capability and audience impact. For example, "send email to client" has technical capability of Tier 2 (external API write) and audience impact of Tier 6 (client messaging). The action's max-tier is Tier 6, so the default approval level is "review required."

Edge cases that need finer control (for example, "draft an internal Slack message" at Tier 1 versus "send a Slack message to a client channel" at Tier 6) are handled through the existing `policyRules` mechanism, which already supports condition-based overrides. The brief does not introduce a parallel multi-axis tier schema.

### 11.2 Mapping to existing approval gates

The existing `actions.gateLevel` (`auto`, `review`, `block`) becomes a **derivation** from Risk Tier plus Policy Envelope:

- Tier 0 to 2: default `auto`
- Tier 3 to 5: default `review`
- Tier 6: default `block` unless explicit policy approves

Policy rules can override the default in either direction (raise to `block` or lower to `auto`) but the derivation must be visible in Run Trace.

---

## 12. Run Trace

Run Trace should be treated as the governed execution observability layer. It should capture both operational events and decision events.

Run Trace should answer:

- who initiated this?
- what was the intent?
- what policy envelope was evaluated?
- what risk tier was assigned?
- what permissions were checked?
- what was allowed, blocked, escalated, or sent for approval?
- what policies applied?
- why was this controller selected?
- why were these environments selected?
- what model, provider, identity was used?
- what credentials were injected?
- what tools and APIs were called?
- what artifacts were produced?
- what approvals were requested?
- what actions were taken?
- what memory was updated?
- what was the final outcome?

Every governed execution should record the policy decision that allowed, blocked, escalated, or required approval for the run. The Run Trace should capture the policy envelope evaluated, risk tier assigned, permissions checked, controller, environment, model access allowed or denied, approval requirement triggered, and final routing decision.

Run Trace should become the trust layer for governed autonomous execution. It should be queryable, inspectable, linked to logs, linked to artifacts, linked to approvals, linked to costs and usage, tied to tasks and agents, suitable for debugging, suitable for compliance, suitable for user-facing transparency.

### 12.1 Implementation in Phase 1: virtual view

The codebase already writes decision audit to multiple tables: `agent_execution_events`, `routing_outcomes`, `delegation_outcomes`, `tool_call_security_events`, `reviewAuditRecords`, plus the `actions` table for proposed actions and `llm_requests` for cost.

In Phase 1, Run Trace is implemented as a **virtual view**: an API contract that returns a unified, ordered, queryable event stream by joining these tables. The existing `RunTracePage.tsx` already does this client-side; Phase 1 formalises the contract on the server side.

### 12.2 Phase 3+ consolidation: canonical ledger

A canonical `run_trace_events` table that consolidates all decision types into one ledger is **deferred to Phase 3 or later**. The migration cost is high and the virtual view is sufficient until either scale (event volume per run grows materially) or audit requirements (single-export compliance reports, replayable envelope reconstruction at high fidelity) force the consolidation.

When the consolidation lands, the virtual-view API contract stays stable so consumers do not break.

---

## 13. Memory Boundaries

Memory must be carefully separated.

| Memory Type | Owner | Purpose |
|---|---|---|
| Organisational Memory | SynthetOS | Durable business knowledge |
| Agent Memory | SynthetOS | Role-specific context and learned preferences |
| Task Context | SynthetOS or Run | Short-term execution context |
| Runtime Session State | IEE or backend | Browser profiles, workspace state, local cache |
| Model Context | Provider or runtime | Prompt and inference context |

Important rule:

> Durable memory belongs to SynthetOS, not runtime backends.

OpenClaw, future internal backends, or other operator backends may maintain runtime-local execution state, but they should not become hidden durable memory silos.

---

## 14. Ownership Boundaries

### SynthetOS owns

policy and governance, identity and permissions, memory and knowledge, approvals and guardrails, audit semantics, Run Trace meaning, billing and usage ownership, task ownership, agent hierarchy, organisation and subaccount context, integration catalog, customer-facing UX, routing policy, compliance posture.

### IEE owns

runtime infrastructure, session lifecycle, environment lifecycle, worker scheduling, execution isolation, credential injection mechanics, event streaming, artifacts and outputs, telemetry, runtime health, queue execution, container and VM orchestration.

Critical principle:

> IEE must not become a second control plane.

---

## 15. System-Level vs Customer Agents

### Customer and Subaccount Agents

Customer-facing agents should live inside the org and subaccount structure. Examples: Executive Assistant, Support Agent, Revenue Ops Assistant, Appointment Setter, Paid Ads Monitoring Agent, Research Intelligence Agent.

They inherit subaccount policies, subaccount credentials, subaccount memory, subaccount integrations, subaccount billing, subaccount approval rules.

### System and Internal Agents

System and internal agents should live in a dedicated system or internal workspace. Examples: SynthetOS Dev Agent, Platform Engineering Agent, QA Agent, Runtime Infrastructure Agent, Security Review Agent.

Recommended conceptual hierarchy:

```text
System Workspace
    Platform Engineering Org
        SynthetOS Dev Agent
```

These agents may use Terminal and Repo Environment, Sandbox Environment, GitHub and CI integrations, internal observability, internal infrastructure tools. They should not live inside a normal customer subaccount.

---

## 16. Final Use Case Set

The agreed showcase set contains seven use cases. These cover a broad cross-section of architectural capability and real-world business value. v1.2 narrows Phase 1 delivery to two showcase MVPs and reslots the remaining five to Phase 1.5; the use cases themselves are unchanged.

### 16.1 Executive Assistant

Purpose: a personal and business assistant for high-value operators.

Capabilities: manage email, summarise inbox, draft replies, manage calendar, schedule meetings, book travel, manage itineraries, handle subscriptions, track renewals and cancellations, manage reimbursements and receipts, follow up clients, create internal tasks, remind user of commitments, research topics, prepare daily briefings.

Architectural pattern: standing autonomous operator.

Primary components: Operator Controller, Model Access, Operator Session Identity, ChatGPT OAuth later, API and Tool Environment, Browser Environment, Credential Broker and Identity Boundary, Run Trace, approvals, memory.

Phase: Phase 3 full delivery (limited summaries possible earlier inside other phases).

### 16.2 Support Inbox Workflow

Purpose: business support workflow for managing support inboxes and support channels.

Capabilities: monitor support inbox, classify tickets, prioritise issues, draft recommended replies, search knowledge base, recommend help articles, escalate complex issues, track SLAs, summarise unresolved issues, detect recurring support problems, require human approval before sending responses.

Architectural pattern: hybrid deterministic plus operator escalation.

Phase: Phase 1 (triage plus drafts plus approval, showcase MVP).

### 16.3 Dev Agent and Bug Fixing

Purpose: internal SynthetOS engineering assistant.

Capabilities: investigate recurring bugs, inspect codebase, reproduce issues, run tests, edit code, prepare PRs, interpret CI, update documentation, recommend fixes, route for human review.

Architectural pattern: autonomous engineering operator.

Phase: Phase 3 full delivery.

### 16.4 Revenue Ops Assistant

Purpose: finance and admin workflow for invoice follow-up and payment operations.

Capabilities: detect overdue invoices, draft reminders, follow up clients, summarise payment status, escalate overdue accounts, identify churn or payment risk, suggest payment plan options, notify finance and admin team, track follow-up outcomes.

Architectural pattern: event-driven business operations.

Phase: Phase 1.5 MVP (depends on Xero or QuickBooks integration build).

### 16.5 Research Intelligence Agent

Purpose: Breakout Solutions digital asset research and market intelligence engine.

Capabilities: monitor crypto and digital asset market developments, identify blockchain, DeFi, AI, and macro trends, research new narratives and protocols, summarise market developments, generate newsletter source material, draft market intelligence updates, create research reports, identify opportunities and risks, maintain research knowledge base, support thought leadership content.

Architectural pattern: research and intelligence workflow.

Phase: Phase 1.5 MVP (scheduled summaries and newsletter source material).

### 16.6 42 Macro Task

Purpose: reference workflow for deterministic browser automation.

Capabilities: log into portal or website, download latest video or files, process and transcribe, generate report, store artifacts, produce Run Trace.

Architectural pattern: deterministic browser automation.

Phase: Phase 1 (full MVP, showcase MVP).

### 16.7 Paid Ads Monitoring Agent

Purpose: monitor and manage paid ads performance across Meta and Facebook initially, with future expansion to Google Ads, TikTok, LinkedIn, YouTube.

Capabilities: pull campaign, ad set, ad performance data, monitor spend, monitor leads, monitor CPL, CTR, CPM, conversions, detect anomalies, identify underperforming campaigns, summarise daily and weekly performance, recommend budget changes, recommend pausing poor performers, recommend creative or message tests, generate internal action reports, notify team when attention is required, later draft ad copy or creative angles, later create ads as drafts, later execute controlled optimisations with approval.

Architectural pattern: API analytics plus anomaly detection plus recommendation engine plus controlled optimisation.

Phase: Phase 1.5 MVP (depends on Meta Ads or Google Ads integration build).

---

## 17. Use Case Coverage Matrix

| Use Case | Phase 1 | Phase 1.5 | Phase 2 | Phase 3 |
|---|---|---|---|---|
| 42 Macro Task | Full MVP | (polish) | Stronger processing | Operator troubleshooting |
| Support Inbox | Triage plus drafts plus approval (showcase) | Richer automation | Attachment analysis, richer KB | Complex support investigation |
| Revenue Ops |  | Invoice follow-up MVP | Reconciliation and reporting | Complex negotiation and escalation |
| Research Intelligence |  | Scheduled summaries MVP | Richer reports and data processing | Long-running research operator |
| Paid Ads Monitoring |  | Monitoring plus recommendations MVP | Advanced ads analysis | Operator-led investigation and optimisation |
| Executive Assistant |  |  | Limited summaries plus richer integrations | Full standing operator |
| Dev Agent and Bug Fixing |  |  | Sandbox-assisted scripts and tests | Full autonomous engineering operator |

---

## 18. Phased Implementation Roadmap

### 18.1 Phase 1: Current Target / Foundation MVP

Status:

> **Current target, in progress. Foundation refactor work is partially complete; showcase MVP work pending.**

Theme:

> Governed deterministic execution foundation, validated by two showcase MVPs.

Core architecture:

```text
SynthetOS Control Plane
↓
Capability-Aware Orchestrator (the Router and Execution Planner)
↓
Native Controller
↓
Existing Browser Environment (formalised under IEE)
↓
Credential Broker (facade exposing existing infrastructure)
↓
Run Trace (virtual view contract)
```

Phase 1 should deliver the governed deterministic execution foundation and validate it across two showcase use cases. The remaining five use cases move to Phase 1.5 because each requires either a new external integration the codebase does not have today (Xero, QuickBooks, Meta Ads, Google Ads) or a separate use case build on top of the foundation.

#### Phase 1 foundation work

- Naming pass: align existing code names with brief terminology per Section 4.0
- `controllerStyle` field added to agent runs (`native` or `operator`); routing logic explicitly picks style
- Risk Tier sweep: assign Tier 0 to 6 across the existing action registry; derive `gateLevel` from tier plus policy
- `CredentialBrokerService` facade exposing existing credential infrastructure as a single named primitive
- Run Trace canonical API contract: server-side endpoint that returns the unified, ordered event stream as a virtual view
- Policy Envelope per-run snapshot: capture the resolved constraint set for each run
- Cross-reference existing infrastructure that already implements the layers (Capability-Aware Orchestrator, Hierarchical Agent Delegation, IEE delegation lifecycle)

#### Phase 1 showcase MVPs

- **42 Macro Task** (Full MVP), deterministic browser automation; mostly built today, requires polish and production hardening
- **Support Inbox Workflow** (Triage plus drafts plus approval), exercises Native Controller plus light Operator escalation, plus the existing HITL plus Slack approval flow plus Gmail integration

#### Phase 1 does not deliver

- Executive Assistant as standing operator
- Dev Agent and Bug Fixing
- Full Operator Controller
- ChatGPT OAuth operator sessions
- Terminal and Repo Environment as a customer-facing capability
- Long-running autonomous execution
- Any use case requiring integrations not currently in the codebase

### 18.1.5 Phase 1.5: Use case fan-out

Theme:

> Apply the Phase 1 foundation across additional use cases.

Phase 1.5 ships the use cases the brief originally placed in Phase 1 but which require new integrations or net-new use case builds:

- **Revenue Ops Assistant** (invoice follow-up MVP), requires Xero or QuickBooks OAuth integration, canonical mapping, overdue detection, follow-up template, approval flow
- **Research Intelligence Agent** (scheduled summaries and newsletter source material MVP), requires research source connectors and summarisation skill
- **Paid Ads Monitoring Agent** (monitoring plus recommendations MVP), requires Meta Ads OAuth and API integration, anomaly detection, recommendation output

Each use case ships independently once its integration is in place. Phase 1.5 has no foundation work; it consumes the Phase 1 foundation.

### 18.2 Phase 2: Extended Capabilities

Theme:

> Sandbox plus richer processing plus stronger artifacts.

Build:

- **Sandbox isolation primitive** (prerequisite, see below)
- Sandbox Environment in IEE
- Stronger file and document processing
- Attachment analysis
- Richer reports
- Data transformations
- Advanced scheduled jobs
- Stronger artifact store usage
- Deeper analysis capabilities
- Broader integrations
- Stronger credential handling
- Better approval flows

Expands: Support Inbox, Revenue Ops, Research Intelligence, Paid Ads Monitoring, 42 Macro.

Prepares for: Dev Agent, Operator Controller workflows.

#### Phase 2 prerequisite: sandbox isolation primitive

The codebase today does not have per-task sandbox isolation. Every dev-mode execution runs in the same Node worker process, with container-wide resource limits. Phase 2 sandbox features (attachment analysis, data transformations, untrusted user-uploaded content processing) **cannot ship safely without a per-task isolation primitive**.

The choice is between Docker-per-task, gVisor, Firecracker microVMs, or a hosted execution provider. The decision needs a dedicated spec before Phase 2 work begins.

### 18.3 Phase 3: Autonomous Operators

Theme:

> Long-running autonomous execution.

Build:

- ExecutionBackend adapter contract (the substrate insertion described in the OpenClaw Strategic Analysis Phase 1)
- Operator Controller
- Operator Controller backend integration
- OpenClaw backend example
- Future internal backend path
- Operator Session Identities
- ChatGPT OAuth (per OpenClaw Strategic Analysis Phase 3)
- Terminal and Repo Environment surfaced to advanced agents
- Persistent sessions
- Advanced memory and tool usage
- Strict approval gates
- Long-running Run Trace
- Operator lifecycle management

Unlocks: Executive Assistant, Dev Agent and Bug Fixing, complex support investigation, advanced research operator, operator-led ads investigation, advanced appointment setting and re-engagement.

### 18.4 Future Phases

Potential future capabilities:

- Additional controllers
- Additional execution environments
- Additional model providers
- BYO local compute
- Dedicated enterprise runtime nodes
- Marketplace of agents, skills, tools
- Multi-region IEE execution
- Customer-owned IEE nodes
- Advanced cost optimisation
- High availability runtime pools
- Regulated and sovereign execution
- Full AI workforce orchestration

#### Note on "Full autonomy mode"

"Full autonomy mode" appears in the Phase 4+ vision but is not yet defined. The whole brief is built around governed, observable execution; an undefined "full autonomy" risks drifting toward exactly the unconstrained autonomy the brief positions against. Before this capability is scoped, "Full autonomy mode" must be defined explicitly. One reasonable starting definition: high-trust agents operating at Risk Tiers 0 to 2 only, without per-action approval requirements, but still under Run Trace observability and Policy Envelope constraints. This is a placeholder; the actual definition is a product decision required before Phase 4+ scoping begins.

---

## 19. Codebase Alignment Assumptions

This brief defines the target architecture. The Phase 1 codebase stress-test confirmed that the architecture is mostly already implemented in the codebase under different names. The remaining work splits across:

1. Already exists and aligns cleanly: Control Plane components, three-tier agent model, hierarchical delegation, Capability-Aware Orchestrator, IEE worker (browser plus dev), HITL plus Slack approval flow, RLS plus principal model, LLM router with full attribution.

2. Exists but needs renaming or boundary clarification: IEE meaning expanded to "execution substrate," Policy Engine subsumed under Policy Envelope, Run Trace as a unified surface over multiple existing audit tables.

3. Exists but conflicts with the target architecture: `iee_dev` mode collapses Sandbox and Terminal and Repo (Phase 2 prerequisite to split), `executionMode` is capability-axis only (Phase 1 to add `controllerStyle` axis).

4. Does not exist and is required for Phase 1: `controllerStyle` first-class field, Risk Tier annotation across action registry, `CredentialBrokerService` facade, Run Trace canonical API contract, Policy Envelope per-run snapshot.

5. Does not exist and should be deferred: per-task sandbox isolation primitive (Phase 2), ExecutionBackend adapter contract (Phase 3), `auth_type: 'operator_session'` for ChatGPT OAuth (Phase 3), canonical Run Trace ledger consolidation (Phase 3+), per-task containers, Firecracker, Kubernetes (Phase 3+).

The stress-test identified **the smallest safe path from the current codebase to the Phase 1 governed deterministic execution foundation**. That path is documented in the Phase 1 foundation work list above.

---

## 20. Codebase Stress-Test Outcomes

The Phase 1 codebase stress-test was completed in May 2026. Headline findings:

- **IEE today** is the browser plus dev worker; the brief expands the meaning to the full execution substrate. Naming pass required.
- **Router today** is the Capability-Aware Orchestrator with paths A, B, C, D, decomposition pipeline, capability budget. The brief renames it to Router and Execution Planner; functionally identical.
- **Native Controller** is implicit in `executionMode='api'` plus the agentic loop middleware pipeline. v1.2 makes it explicit via `controllerStyle`.
- **Browser Environment** is `iee_browser`, cleanly separated, multi-tenant scoped, contract-enforced, ready for formalisation as the brief's Browser Environment.
- **Sandbox Environment** is not separated from `iee_dev` today. Phase 2 must split first, then add isolation.
- **Operator Controller** has three implementations (Claude Code, IEE browser, IEE dev) but no unified abstraction. The ExecutionBackend adapter contract is the missing piece.
- **Model Access** is fully implemented via single-entry `llmRouter.routeCall` plus six OAuth providers. ChatGPT OAuth as Operator Session Identity is genuinely net-new.
- **Credential Broker** is fully implemented in spirit (`integration_connections`, `connectionTokenService`, audit, RLS). Phase 1 adds the named facade.
- **Run Trace** has a UI page (`RunTracePage.tsx`) and at least five backing tables. Phase 1 adds the canonical API contract.
- **Risk and Policy** today is split between `actions.gateLevel` (3-level), `policyRules`, `subaccountAgents` budget fields, and middleware. Risk Tier annotation across the action registry plus Policy Envelope snapshot fills the gap.

---

## 21. Enterprise Architecture Review Notes

The architecture was critically reviewed and refined with the following concerns and resolutions.

| Concern | Resolution |
|---|---|
| Router could become too magical | Routing must be policy-constrained. Native Controller is default. Operator Controller requires justification. Decisions must be visible in Run Trace. |
| Controllers needed crisp contracts | Native = deterministic, structured, short-lived. Operator = adaptive, autonomous, investigative, long-running. Encoded as a `controllerStyle` field, separate from execution capability. |
| Environments have different risk levels | Introduce Capability Risk Tiers (single-axis max-tier model with multi-axis policy overrides). Tie approvals and trace requirements to risk. |
| ChatGPT OAuth could be misrepresented | Treat it as Operator Session Identity. Keep it separate from platform model APIs. Reference OpenClaw Strategic Analysis for full lifecycle design. |
| Credential Broker was underrepresented | Promote to Credential Broker and Identity Boundary. Make it a core governance layer. Acknowledge that the underlying mechanics already exist; Phase 1 work is the named facade plus Operator Session Identity addition. |
| Memory boundaries were ambiguous | SynthetOS owns durable memory. Runtime backends may cache execution and session state only. |
| IEE could become a second platform | SynthetOS decides. IEE executes. |
| Operator Controller could be overused | Native Controller first. Operator Controller only when autonomy is justified. |
| Audit model needed stronger alignment | Run Trace becomes the unified surface (Phase 1 virtual view, Phase 3+ canonical ledger). Cross-reference all existing audit tables. |

---

## 22. UI / UX Implications

### 22.1 Agent configuration

Agent configuration should be role-based and capability-aware.

Possible sections: role and purpose, organisation and subaccount scope, connected systems, allowed controllers, allowed environments, allowed tools, model access, approvals, risk limits, escalation rules, memory access, usage and billing limits.

Users should not need to know whether the backend is OpenClaw or another future backend. They configure what the agent can do, what systems it can access, whether it can use operator mode, when it needs approval, which model access it uses, what risk limits apply.

### 22.2 AI and Model settings

Likely location:

```text
Subaccount Settings
    AI and Models
```

Potential tabs:

- Model Access
- Routing
- Limits
- Cost Controls
- Operator Identities

Model Access could include OpenAI API, Anthropic API, Google and Gemini API, BYO API keys, ChatGPT OAuth (in Operator Identities), Local and Self-hosted endpoint later.

ChatGPT OAuth should be described as: used for approved Operator Controller tasks in this subaccount.

### 22.3 Approval UX

Approvals should be triggered by risk tier and policy.

Examples:

- send email to client: approval required unless policy allows template-based send
- paid ads budget change: approval required
- campaign pause or resume: approval required
- GitHub PR creation: approval optional depending on policy
- merge or deploy: approval mandatory
- invoice follow-up: approval may be required depending on template or risk
- terminal access: restricted to system or internal agents

The existing HITL plus Slack approval flow already implements the underlying mechanics; Phase 1 work is wiring Risk Tier-derived defaults into the approval prompt.

---

## 23. MVP Discipline

The architecture is broad by design. The first implementation should be narrow by discipline.

Do not build in Phase 1: full Operator Controller, all model providers, BYO compute, all environments, full marketplace, all seven use cases at full maturity, autonomous write access everywhere.

Build in Phase 1:

```text
Foundation refactor (naming, controllerStyle, Risk Tier sweep, CredentialBrokerService, Run Trace virtual view, Policy Envelope snapshot)
plus
42 Macro Task (Full MVP)
plus
Support Inbox Workflow (triage plus drafts plus approval)
```

Then Phase 1.5: Revenue Ops, Research Intelligence, Paid Ads Monitoring use case MVPs once integrations are in place.

Then Phase 2: Sandbox isolation primitive plus Sandbox Environment plus richer processing.

Then Phase 3: ExecutionBackend adapter contract plus Operator Controller plus Operator Session Identities plus Terminal and Repo for advanced agents.

This protects against overengineering while preserving the correct future architecture.

---

## 24. Next Deliverables

After this master brief, the recommended next deliverables are, in dependency order:

1. **Naming map and nomenclature decisions document**, closes naming and Run Trace surface choices
2. **Phase 1 foundation refactor spec**: `controllerStyle`, Risk Tier sweep, `CredentialBrokerService` facade, Policy Envelope per-run snapshot, naming pass
3. **Run Trace canonical API contract spec**: server-side virtual view endpoint
4. **ExecutionBackend adapter contract spec**: Phase 3 prerequisite (already proposed in OpenClaw Strategic Analysis Phase 1)
5. **Sandbox isolation strategy spec**: Phase 2 prerequisite
6. **Showcase use case spec**: 42 Macro Task production hardening plus Support Inbox MVP
7. **Operator Controller backend spec**: selection criteria, OpenClaw plus future internal evaluation
8. **Operator Session Identity spec** (Phase 3, defer until Phase 1 ships)

Each spec should go through the spec-reviewer loop before implementation.

---

## 25. Locked Baseline Principles

These should be treated as architectural anchors.

1. SynthetOS is the Governed Agentic Operating System for autonomous execution.
2. Agents are organisational entities, not execution runtimes.
3. Controllers are execution styles selected per task.
4. Execution environments are capabilities invoked by controllers.
5. Native Controller is the default.
6. Operator Controller is used only when autonomy is justified.
7. SynthetOS owns policy, identity, memory, approvals, audit, billing, and task ownership.
8. IEE owns session lifecycle, execution isolation, worker scheduling, telemetry, and artifacts.
9. Model access is separate from runtime infrastructure.
10. ChatGPT OAuth is an Operator Session Identity, not the default system inference layer.
11. Routing is policy-constrained, not unconstrained autonomy.
12. Every governed execution should produce a Run Trace.
13. Durable memory belongs to SynthetOS, not runtime backends.
14. Credential Broker and Identity Boundary is core governance infrastructure.
15. Capability risk tiers drive approvals and constraints.
16. IEE must not become a second control plane.
17. Shared infrastructure is acceptable only with strict tenant and session isolation.
18. Architecture should be broad, implementation should be phased.
19. Backend and runtime implementation names should remain internal where possible.
20. OpenClaw and future internal backends are possible Operator Controller backends, not the architecture itself.
21. System and internal agents should be separated from customer and subaccount agents.
22. Use cases should demonstrate execution patterns, not merely agent labels.
23. The platform should be observable, governable, auditable, and extensible by design.

---

## 26. Final Architecture Summary

```text
SynthetOS Control Plane
    owns organisations, agents, workflows, policies, approvals, memory,
    identity, audit, billing, and task ownership

Router and Execution Planner (implemented as the Capability-Aware Orchestrator)
    evaluates intent, policy, cost, risk, controller, environments, and model access
    operates within the Policy Envelope

Controllers
    Native Controller   = deterministic execution
    Operator Controller = autonomous adaptive execution
    encoded as a controllerStyle field, orthogonal to execution capability

Execution Environments
    Browser
    Sandbox (Phase 2 onward, gated on isolation primitive)
    Terminal and Repo
    API and Tool
    Model Invocation Capability
    Local and BYO (future)

IEE Execution Plane
    session manager
    worker scheduler
    runtime isolation
    credential injection
    artifacts
    telemetry
    Run Trace events

Model Access and Identity
    Platform Model Providers
    Operator Session Identities (ChatGPT OAuth in Phase 3)

Credential Broker and Identity Boundary
    governs all credential storage, scoping, injection, audit, revocation
    facade exposed in Phase 1 over existing infrastructure

Run Trace
    governed execution observability and decision record
    Phase 1: virtual view across existing audit tables
    Phase 3+: canonical ledger consolidation
```

---

## 27. Final Positioning Statement

> **SynthetOS is the Governed Agentic Operating System for autonomous execution, enabling organisations to deploy AI agents safely across deterministic workflows, controlled environments, and adaptive operator modes with policy, identity, approvals, and Run Trace observability built in from the ground up.**

---

## 28. Cross-References to Existing Documents

The following documents in the repository complement this brief and should be read alongside it:

- `docs/openclaw-strategic-analysis.md`: strategic positioning of OpenClaw integration, full 5-phase roadmap, Operator Session Identity lifecycle, ExecutionBackend adapter contract definition.
- `docs/iee-delegation-lifecycle-spec.md`: the existing Phase 0 IEE delegation lifecycle that established the pattern for delegated-execution backends.
- `architecture.md` sections "Orchestrator Capability-Aware Routing", "Agent Execution Middleware Pipeline", "Policy Engine", "Review Gates and HITL", "Hierarchical Agent Delegation", "IEE Integrated Execution Environment": current implementation reference for the components this brief renames or formalises.
- `docs/synthetos-brief-v1.1-to-v1.2-changes.md`: the change list document accompanying v1.2, including diagram update guidance for the source editor.
