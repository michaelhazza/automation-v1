# SynthetOS Brief v1.1 to v1.2 Change List

This document is the change list to apply when updating the SynthetOS brief from v1.1 to v1.2. It is structured for hand-off to the source editor (the AI that drafts the brief and the diagram). Three parts:

1. **Terminology mapping table** — apply to both brief text and diagram labels.
2. **Brief text changes** — section-by-section.
3. **Diagram update guidance** — what changes to apply to the v1.1 master architecture diagram.

The full v1.2 brief is published at `docs/synthetos-governed-agentic-os-brief-v1.2.md` for reference.

---

## Contents

- [Part 1 — Terminology Mapping](#part-1--terminology-mapping)
- [Part 2 — Brief Text Changes](#part-2--brief-text-changes)
- [Part 3 — Diagram Update Guidance](#part-3--diagram-update-guidance)
- [Summary](#summary)

---

## Part 1 — Terminology Mapping

This is the canonical naming reconciliation. Use these names everywhere in the v1.2 brief and on the v1.2 diagram.

| Concept | v1.1 brief / diagram label | v1.2 locked name | Existing code name (engineering reference) |
|---|---|---|---|
| Routing engine | "Router and Execution Planner" | **Router and Execution Planner** | Capability-Aware Orchestrator (`orchestratorFromTaskJob`, paths A / B / C / D) |
| Routing decisions surfaced in audit | (implicit in Run Trace) | **Run Trace event** | `routing_outcomes` table |
| Execution capability dimension | (implicit, mixed with controllers) | **Execution Environment** | `executionMode` enum (`api`, `headless`, `claude-code`, `iee_browser`, `iee_dev`) |
| Execution style dimension | "Native Controller" / "Operator Controller" | **Controller** with `controllerStyle: native or operator` field | (not present in code today; new in Phase 1) |
| Action approval gate | "Approvals" (mixed with HITL) | **Approval Level** (derived from Risk Tier plus Policy Envelope) | `actions.gateLevel` (`auto`, `review`, `block`) |
| Execution substrate | "IEE Infrastructure Layer" | **IEE Execution Plane** (expanded scope: full execution substrate, not just browser plus dev) | IEE worker (today: browser plus dev only) |
| Credential layer | "Credential Broker and Identity Boundary" | **Credential Broker and Identity Boundary** (unchanged name; clarify it is a facade over existing infrastructure) | `integration_connections` plus `connectionTokenService` |
| Decision audit surface | "Run Trace (Decision Ledger)" | **Run Trace** (Phase 1 = virtual view; Phase 3+ = canonical ledger) | `agent_execution_events`, `routing_outcomes`, `delegation_outcomes`, `tool_call_security_events`, `reviewAuditRecords` |
| Policy enforcement runtime | "Policies and Approvals" | **Policy Engine** (a component of Policy Envelope) | `policyRules` plus `policyEngineService` |
| Per-run constraint snapshot | (implicit in Policy Envelope) | **Policy Envelope** (the named per-run snapshot of resolved constraints) | `subaccountAgents.tokenBudgetPerRun`, `maxToolCallsPerRun`, `maxCostPerRunCents`, `spendingPolicies` |
| HITL approval flow | "Approvals" | **Approval Workflow** | `actions` to `reviewItems` to `reviewAuditRecords` plus Slack Block Kit |
| Capability lookup | (implicit in Router) | **Capability Matching** (component of Router) | `list_platform_capabilities`, `check_capability_gap`, `list_connections`, `request_feature` skills |
| Per-agent capability snapshot | (implicit in Agent config) | **Agent Capability Map** | `subaccountAgents.capabilityMap` (JSONB) |
| Agent hierarchy | "Agents" | **Three-tier Agent Model** (System, Org, Subaccount) plus **Agent Hierarchy** (delegation tree) | `system_agents`, `agents`, `subaccount_agents`; root agent contract; `DelegationScope` enum |
| LLM call entry point | "Model Invocation Capability" | **Model Invocation Capability** (unchanged) | `llmRouter.routeCall` (single entry point) |
| Cost ledger | "Billing and Usage" | **Billing and Usage** (unchanged) | `llm_requests` plus `cost_aggregates` |
| Operator backend | "OpenClaw / Hermes / Future Backend" | **OpenClaw** plus **Future internal backend (TBD)** — strike Hermes as a named backend | (not present in code today; ExecutionBackend adapter contract is Phase 3) |

---

## Part 2 — Brief Text Changes

The following changes are applied in v1.2. Each entry says what changed, why, and what the source editor should do.

### Section 0 (Document Purpose)

**Add Section 0.3 "What changed from v1.1"** listing the ten substantive changes (already drafted in v1.2 brief). No other changes to Section 0.

### Section 1 (Executive Summary)

No content changes. Minor tightening of formatting only.

### Section 2 (Strategic Positioning)

No changes. The strategic positioning is unchanged from v1.1.

### Section 3 (Baseline Architecture Diagram)

**Replace** the diagram caption to point to this change list. Note that the v1.1 diagram is the visual baseline, and v1.2 diagram updates are listed in `docs/synthetos-brief-v1.1-to-v1.2-changes.md`.

### Section 4 (Core Architectural Breakthrough)

**Add Section 4.0 "Naming map (existing code to brief terminology)"** as a new subsection at the top. Use the table from Part 1 above. This is the largest single addition in v1.2 and the most important change. It prevents spec drift.

No changes to Section 4.1 terminology baseline beyond minor formatting.

### Section 5.1 (Agents are organisational entities)

**Add a paragraph at the end** noting that the codebase already implements a three-tier agent model plus hierarchical delegation, and the brief's agent definitions should align with these existing primitives.

### Section 5.2 (Controllers are execution styles)

**Add a paragraph after the "Native vs Operator" example** clarifying:

- Controller style is **orthogonal to execution capability**.
- A deterministic browser flow is Native style on a Browser environment.
- An autonomous browser operator is Operator style on the same Browser environment.
- Today's `executionMode` enum encodes capability (api / browser / dev), not style.
- v1.2 adds `controllerStyle` as a first-class field on the agent run record, separate from `executionMode`.
- Loop limits, budgets, and approval defaults differ between styles.

This is the most important conceptual fix in v1.2.

### Section 5.4 (IEE is the execution substrate)

**Add a sentence** noting the meaning of IEE is being expanded from "browser plus dev worker" to "full execution substrate," and a naming pass is part of Phase 1 work.

### Section 5.5 (Model access)

**Add a paragraph at the end** noting the codebase already routes all LLM calls through `llmRouter.routeCall` and the Model Invocation Capability concept maps cleanly to this router.

### Section 5.6 (Run Trace)

**Add a paragraph at the end** noting:

- The codebase already has a Run Trace concept and a `RunTracePage.tsx` UI.
- v1.2 aligns the brief's Run Trace meaning with the existing surface.
- In Phase 1, Run Trace is implemented as a virtual view over existing decision ledgers.
- A canonical consolidated Run Trace ledger is deferred to Phase 3 or later.

### Section 6.2 (Policy-Constrained Router)

**Add a paragraph at the end** noting the codebase already implements this routing engine as the Capability-Aware Orchestrator. The brief-level name is "Router and Execution Planner"; the code keeps "Orchestrator" as the file and service prefix.

### Section 6.4 (Sandbox Environment)

**Add a sentence** noting that the codebase today does not have a separate Sandbox Environment, and that today's `iee_dev` mode collapses sandbox-style execution and terminal / repo execution. **Cross-reference Section 18.2** for the Phase 2 sandbox isolation primitive prerequisite.

### Section 7 (Operator Controller Backends)

**Strike Hermes as a named backend.** Replace the current bullet list with:

- OpenClaw (covered in detail by the OpenClaw Strategic Analysis)
- Future internal backend (TBD; selection deferred to a dedicated Operator Controller backend spec)

**Add a paragraph at the end** noting the architectural prerequisite is the **ExecutionBackend adapter contract**, called out as Phase 1 of the OpenClaw Strategic Analysis.

### Section 8 (ChatGPT OAuth)

**Add a paragraph at the end** noting that the OpenClaw Strategic Analysis defines OAuth session state, relink UX, fallback chain semantics, and loud-failure events; v1.2 references that document rather than restating it.

### Section 9 (Credential Broker)

**Add a paragraph at the end** noting that the codebase already implements most of this in `integration_connections`, `connectionTokenService`, RLS, audit logging through `auditEvents`. The Phase 1 work is to expose this as a single named facade (`CredentialBrokerService`) and add an explicit `auth_type` for Operator Session Identity, not to build the underlying mechanics from scratch.

### Section 10 (Policy Envelope)

**Add a paragraph at the start** noting that the codebase already implements most envelope components in scattered locations (`policyRules`, `actions.gateLevel`, `subaccountAgents` budget fields, `spendingPolicies`, middleware). v1.2 introduces the Policy Envelope as the **named per-run snapshot** of the resolved constraint set so every Run Trace can replay the envelope that was in force.

### Section 11 (Capability Risk Tiers)

**Add Section 11.1 "Tier dimensionality"** clarifying:

- Default model is single-axis: each action assigned a single max-tier value.
- The action's tier is the highest applicable level across technical capability and audience impact.
- Example: "send email to client" has technical capability of Tier 2 and audience impact of Tier 6; max-tier is Tier 6.
- Multi-axis edge cases are handled via the existing `policyRules` mechanism, which already supports condition-based overrides.
- The brief does not introduce a parallel multi-axis tier schema.

**Add Section 11.2 "Mapping to existing approval gates"** clarifying the derivation:

- Tier 0 to 2: default `auto`
- Tier 3 to 5: default `review`
- Tier 6: default `block` unless explicit policy approves
- Policy rules can override the default in either direction; derivation must be visible in Run Trace.

### Section 12 (Run Trace)

**Add Section 12.1 "Implementation in Phase 1: virtual view"** noting the implementation is a server-side API contract that returns a unified, ordered, queryable event stream by joining the existing decision ledger tables.

**Add Section 12.2 "Phase 3+ consolidation: canonical ledger"** noting that consolidation into a single `run_trace_events` table is deferred until either scale or audit requirements force it. The virtual-view API contract stays stable when consolidation lands.

### Section 13 (Memory Boundaries)

No content changes. Minor formatting only.

### Section 14 (Ownership Boundaries)

No content changes. The SynthetOS-vs-IEE ownership card is the cleanest single statement of separation.

### Section 15 (System-level vs Customer Agents)

No content changes. The hierarchy and examples are correct.

### Section 16 (Final Use Case Set)

**Update phase labels per use case** to reflect the new Phase 1 / Phase 1.5 split:

- Executive Assistant: Phase 3 full delivery (was: Phase 3 with Phase 1 limited summaries)
- Support Inbox: Phase 1 (showcase MVP) (was: Phase 1)
- Dev Agent: Phase 3 (unchanged)
- Revenue Ops: Phase 1.5 MVP (was: Phase 1)
- Research Intelligence: Phase 1.5 MVP (was: Phase 1)
- 42 Macro: Phase 1 (showcase MVP) (was: Phase 1)
- Paid Ads Monitoring: Phase 1.5 MVP (was: Phase 1)

**Add a one-line note at the top** of Section 16 clarifying: "v1.2 narrows Phase 1 delivery to two showcase MVPs and reslots the remaining five to Phase 1.5; the use cases themselves are unchanged."

### Section 17 (Use Case Coverage Matrix)

**Add a "Phase 1.5" column** between Phase 1 and Phase 2. Move Revenue Ops, Research Intelligence, and Paid Ads MVP entries from the Phase 1 column to the Phase 1.5 column. The 42 Macro and Support Inbox remain in Phase 1. Executive Assistant and Dev Agent remain unchanged.

### Section 18 (Phased Implementation Roadmap)

**Section 18.1 (Phase 1)**: Replace the deliverables list with the new tighter scope:

- Foundation work: naming pass, `controllerStyle` field, Risk Tier sweep, `CredentialBrokerService` facade, Run Trace virtual view contract, Policy Envelope per-run snapshot.
- Showcase MVPs: 42 Macro Task (Full MVP) and Support Inbox Workflow (triage plus drafts plus approval).

**Add Section 18.1.5 "Phase 1.5: Use case fan-out"** as a new subsection between 18.1 and 18.2. Lists Revenue Ops, Research Intelligence, Paid Ads Monitoring as MVPs gated on integration build.

**Section 18.2 (Phase 2)**: Add a new subsection at the end titled "Phase 2 prerequisite: sandbox isolation primitive" stating that Phase 2 sandbox features cannot ship safely without per-task isolation, and the choice between Docker-per-task / gVisor / Firecracker / hosted needs a dedicated spec before Phase 2 work begins.

**Section 18.3 (Phase 3)**: Add a bullet at the top: "ExecutionBackend adapter contract (the substrate insertion described in the OpenClaw Strategic Analysis Phase 1)."

**Section 18.4 (Future Phases)**: Add a subsection at the end titled "Note on Full autonomy mode" noting it is undefined today and must be defined explicitly before Phase 4+ scoping. Suggested starting definition: high-trust agents operating at Risk Tiers 0 to 2 only, without per-action approval, but still under Run Trace and Policy Envelope. Mark as placeholder.

### Section 19 (Codebase Alignment Assumptions)

**Replace** the simple five-category list with the more detailed v1.2 version that names the specific primitives in each category. Closes the loop with the Section 4.0 naming map.

### Section 20 (Codebase Stress-Test Questions)

**Replace** with **Section 20 "Codebase Stress-Test Outcomes"** — a summary of what the May 2026 stress-test found, instead of a list of questions to ask. The full stress-test results are referenced as a separate document (see Section 28 cross-references).

### Section 21 (Enterprise Architecture Review Notes)

**Update** the table to reflect the v1.2 resolutions: Controllers needed crisp contracts now references `controllerStyle` field; Risk tiers now references single-axis with multi-axis policy overrides; ChatGPT OAuth references OpenClaw Strategic Analysis; Credential Broker acknowledges existing mechanics; Audit model references Phase 1 virtual view plus Phase 3+ canonical ledger.

### Section 22 (UI / UX Implications)

**Add a sentence at the end of Section 22.3** noting that the existing HITL plus Slack approval flow already implements the underlying mechanics; Phase 1 work is wiring Risk Tier-derived defaults into the approval prompt.

### Section 23 (MVP Discipline)

**Update** the "Build in Phase 1" code block to list the new tighter Phase 1 scope. Add subsequent paragraphs for Phase 1.5, Phase 2 (with sandbox isolation prerequisite), and Phase 3 (with ExecutionBackend adapter contract).

### Section 24 (Next Deliverables)

**Replace** the deliverables list with the v1.2 dependency-ordered list:

1. Naming map and nomenclature decisions document
2. Phase 1 foundation refactor spec
3. Run Trace canonical API contract spec
4. ExecutionBackend adapter contract spec (Phase 3 prerequisite)
5. Sandbox isolation strategy spec (Phase 2 prerequisite)
6. Showcase use case spec (42 Macro plus Support Inbox)
7. Operator Controller backend spec
8. Operator Session Identity spec (Phase 3, defer)

### Section 25 (Locked Baseline Principles)

**Update principle 20** to remove Hermes specifics: "OpenClaw and future internal backends are possible Operator Controller backends, not the architecture itself."

No other changes.

### Section 26 (Final Architecture Summary)

**Update** the architecture summary block to reflect v1.2 naming:

- "Router and Execution Planner (implemented as the Capability-Aware Orchestrator)"
- Controllers section notes `controllerStyle` is orthogonal to execution capability
- Sandbox notes "Phase 2 onward, gated on isolation primitive"
- Operator Session Identities notes "ChatGPT OAuth in Phase 3"
- Credential Broker notes "facade exposed in Phase 1 over existing infrastructure"
- Run Trace notes "Phase 1: virtual view; Phase 3+: canonical ledger consolidation"

### Section 27 (Final Positioning Statement)

No changes.

### Section 28 (NEW: Cross-References to Existing Documents)

**Add new Section 28** referencing:

- `docs/openclaw-strategic-analysis.md`
- `docs/iee-delegation-lifecycle-spec.md`
- Specific sections of `architecture.md`
- This change list document

---

## Part 3 — Diagram Update Guidance

Apply the following updates to the v1.1 master architecture diagram. Most are label changes, with a few additions and one strike.

### Box 2 (Router and Execution Planner)

- **Label addition**: under "Router and Execution Planner", add a small subscript "(implemented as Capability-Aware Orchestrator)" so engineering can map the diagram to code.
- **Pipeline labels**: keep the five-step flow ("Intent Understanding", "Task Decomposition", "Capability Matching", "Execution Planning", "Route and Dispatch"). No changes to these labels.
- **Policy Envelope row**: keep the seven-element constraint list ("Agent Permissions", "Allowed Controllers", "Allowed Environments", "Risk Tier Limits", "Budget / Cost Limits", "Approval Requirements", "Data Handling Rules", "Context and Intent Rules"). No changes.

### Box 3 (Controllers)

- **Add a subscript under each controller box**: under "Native Controller", add "(controllerStyle: native)". Under "Operator Controller", add "(controllerStyle: operator)". This is the key v1.2 change.
- **Operator Controller Backend box**: **strike Hermes**. Replace the three-backend list ("OpenClaw / Hermes / Future Backend") with two: "OpenClaw / Future Internal Backend (TBD)".

### Box 4 (Execution Environments)

- **Sandbox Environment box**: add a small "(Phase 2 onward — requires isolation primitive)" subscript so the diagram reflects the dependency.
- **Terminal / Repo Environment box**: add a small "(Tier 5 — system / internal agents only by default)" subscript.
- All other environment boxes unchanged.

### Box 5 (IEE Infrastructure Layer)

- **Heading addition**: under "IEE Infrastructure Layer", add a small subscript "(Phase 1: existing browser plus dev worker; expanded to full execution substrate over later phases)".
- **Sub-boxes**: keep all eight sub-boxes (Kubernetes, Dedicated Runtimes, Isolation and Tenancy, Compute Profile, Storage and Artifacts, Credential Injection Runtime, Event Bus / Queue, Network and Egress). Add a small "(future)" annotation to Kubernetes and Dedicated Runtimes since the codebase ships Docker Compose today.

### Box 6 (Model Access and Identity Layer)

- **Operator Session Identities box**: add a small "(Phase 3)" subscript next to "ChatGPT OAuth".
- **Credential Broker and Identity Boundary box**: add a small "(Phase 1: facade over existing infrastructure)" subscript.

### Box 7 (Run Trace / Decision Ledger)

- **Subtitle**: change "(Decision Ledger)" to "(Decision Ledger — Phase 1: virtual view; Phase 3+: canonical ledger)".
- **All eight pipeline steps unchanged.**

### Capability Risk Tiers (right panel)

- **No changes** to the seven tiers (0 to 6). Tiers and colours stay as drawn.
- **Add a small footnote below the tier table**: "Default model is single-axis (max tier per action). Multi-axis edge cases handled via policyRules overrides."

### Use Cases Targeted in Phase 1 (right panel)

- **Update the Phase 1 list** to reflect the v1.2 narrower scope:
  - Show **42 Macro Task** as "Full MVP" (unchanged)
  - Show **Support Inbox Workflow** as "Partial MVP" (unchanged)
  - **Remove** Dev Agent / Bug Fixing from the Phase 1 list (move to Phase 3 visual)
  - **Remove** Revenue Ops Assistant from the Phase 1 list (move to a new "Phase 1.5" column or footnote)
  - **Remove** Research Intelligence Agent from the Phase 1 list (move to Phase 1.5)
  - **Remove** Paid Ads Monitoring Agent from the Phase 1 list (move to Phase 1.5)
  - **Remove** Executive Assistant from the Phase 1 list (move to Phase 3)

### Phase Roadmap (bottom-right card)

- **Insert a new column "PHASE 1.5"** between Phase 1 and Phase 2.
- Move Revenue Ops (Partial MVP), Research Intelligence (Partial MVP), and Paid Ads Monitoring (Partial MVP) entries from Phase 1 column into Phase 1.5 column.
- Move Executive Assistant and Dev Agent entries from Phase 1 column into Phase 3 column.
- Update Phase 1 column to show only: 42 Macro Task (Full MVP), Support Inbox Workflow (Partial MVP), and the foundation components (Existing browser execution, Policy-constrained routing, Native Controller, Basic Credential Broker, Run Trace aligned).
- **Phase 4+ column**: add small footnote "Full autonomy mode requires definition before scoping."

### Ownership Boundary (right panel)

- **No changes**. The SynthetOS-vs-IEE ownership card is the cleanest single statement of separation in the diagram and stays as-is.

### Architectural Principles (right panel)

- **No changes**. The seven principles are accurate.

### Stress-Test Focus (bottom-left)

- **Update text** to reflect the stress-test was completed in May 2026: replace the question list with a one-line note: "Codebase stress-test completed May 2026. Findings incorporated into v1.2. See `docs/synthetos-brief-v1.1-to-v1.2-changes.md` for details."

### Title bar

- **Update the version number** from "Version 1.1" to "Version 1.2" in the bottom-right corner.

---

## Summary

The v1.1 to v1.2 transition is mostly **renaming, consolidation, and Phase 1 scope tightening**. Strategic positioning is unchanged. The diagram changes are concentrated in the Controllers section (controllerStyle subscripts, Hermes strike), the Phase Roadmap (new Phase 1.5 column, Phase 1 narrowing), and small annotations elsewhere noting which boxes depend on later-phase infrastructure.

The biggest single addition in the brief is **Section 4.0 (Naming map)**, which closes the loop between brief terminology and existing code names. Without it, every spec author downstream would re-litigate the naming.

The biggest single conceptual fix is **Section 5.2 controllerStyle clarification**, which separates execution style (Native vs Operator) from execution capability (api / browser / dev). Without it, "Native first, Operator only when justified" cannot be enforced because every IEE run is structurally an Operator-style loop today.

The full v1.2 brief lives at `docs/synthetos-governed-agentic-os-brief-v1.2.md`.
