# Riley Observations — Dev Brief (v2)

_Date: 2026-04-22_
_Status: post-ChatGPT-review revision; draft for second external pass_
_Related: `docs/openclaw-strategic-analysis.md` (2026-04-18)_

---

## TL;DR

A mainstream AI-agent explainer video (Riley Brown, "OpenClaw workflows for non-technical users") surfaced five tactical observations worth testing against Automation OS. We ran the analysis twice across independent branches, reconciled the results, and sent the v1 brief to ChatGPT for external review. This v2 integrates the reviewer's feedback where it sharpens the work, pushes back where the reviewer didn't know we're pre-launch, and adds one item (the naming pass) that grew teeth during discussion.

**The proposed changes, in priority order:**

| # | Change | Why | Effort | Type |
|---|---|---|---|---|
| 1 | **Explore Mode / Execute Mode** — a two-mode system for agent and Playbook runs, not a dry-run toggle | Non-technical agency owners have no user-visible "try safely" affordance today. Reviewer correctly pushed us to elevate this from a toggle to a core interaction model. Default new agents to Explore; users opt into Execute. | ~6–8h after spec | UX + core interaction model |
| 2 | **Full naming pass: Playbooks → Workflows, current Workflows → Automations** — including schema migration, types, routes, services, UI, docs, skills | Pre-launch window makes this cheap now and expensive forever. Collapses three overlapping "workflow"-named concepts in the schema (see §3.6). Clear mental model for agency buyers: *Automations are external tools we call; Workflows are native multi-step orchestrations we run.* | ~2–3 days | Schema + codebase-wide rename |
| 3 | **Heartbeat activity-gate (deterministic-first)** before Portfolio Health Agent dispatches its 4-hourly tick | Reviewer was right: v1 should be rules-based (event deltas, time thresholds, state flags), not an LLM decision-step. Cheaper, predictable, easier to debug. LLM fallback deferred to v2 only if deterministic signal proves insufficient. | ~3–4h after spec | Backend + config |
| 4 | **Minimal context-assembly telemetry event** emitted from `agentExecutionService.ts` after context injection | v1 ships with tokens, memory counts, latency, gap flags only. Richer fields (per-skill authorization, per-source memory breakdown) deferred to v2 once we know what we actually need to query. | ~2h | Backend telemetry |
| 5 | **"Agent decomposition" rule** in `docs/spec-authoring-checklist.md` | Demoted to a hygiene item, not a product initiative. Reviewer was right that it doesn't belong in a prioritised dev brief. Keeping it only because the doc edit is free. | ~5min | Docs |

**Non-actions:**
- **Skill-count ceiling (~20 per agent):** after the 41 queued skills land, no agent exceeds 20. Ads Management projects 17–19. No action required; revisit only if Ads Agent regresses in production.

**Total engineering effort:** ~3–4 days across all items. The naming pass (#2) is the single biggest chunk and carries the most unknowns — see §4 for why.

**What this brief is NOT.** The reviewer flagged that the brief optimises mechanics (safety, efficiency, observability), not outcomes (time-to-first-win, guided onboarding, outcome-first UX). That is correct and deliberately deferred. See §10 for how we capture that gap without letting it swamp this wave.

---

## UI mockups — 2026-04-23 addendum

Since this brief was drafted, the UI surfaces have been mocked and reviewed against [`docs/frontend-design-principles.md`](./frontend-design-principles.md). The full mockup set lives in [`prototypes/riley-observations/`](../prototypes/riley-observations/index.html); the locked design decisions live in the spec's [§3a.2](./riley-observations-dev-spec.md#3a-ui-surface-decisions).

**All 10 mockups:**

| # | Mockup | Recommendation | Primary user task |
|---|---|---|---|
| 01 | [Sidebar post-rename](../prototypes/riley-observations/01-sidebar-post-rename.html) | Rec 2 | Navigate to the right primitive |
| 02 | [Agent chat · Explore Mode](../prototypes/riley-observations/02-agent-chat-explore-mode.html) | Rec 1 | Chat safely — see what will change before it runs |
| 03 | [Workflow Run Modal — pick a mode](../prototypes/riley-observations/03-workflow-run-modal-step2.html) | Rec 1 | Pick a safety mode and run the Workflow |
| 04 | [Promote-to-Execute prompt](../prototypes/riley-observations/04-promote-to-execute-prompt.html) | Rec 1 | Decide whether to stop reviewing every action |
| 05 | [Workflow Studio — "Call Automation" step picker](../prototypes/riley-observations/05-workflow-studio-step-picker.html) | Rec 2 (composition) | Add a step to the Workflow |
| 06 | [Automation picker + input mapping](../prototypes/riley-observations/06-automation-picker-drawer.html) | Rec 2 (composition) | Pick an Automation and fill in its inputs |
| 07 | [Failed step inline in run log](../prototypes/riley-observations/07-invoke-automation-run-detail.html) | Rec 2 (composition) | Know what to do when something broke |
| 08 | [Workflows library](../prototypes/riley-observations/08-workflows-library.html) | Rec 2 | Find or create a Workflow |
| 09 | [Automations library](../prototypes/riley-observations/09-automations-library.html) | Rec 2 | Find or register an Automation |
| 10 | [Agent settings — safety + schedule](../prototypes/riley-observations/10-agent-config-page.html) | Recs 1 + 3 | Set the agent's defaults on the existing Agent Edit page |

**Binding resolution rule.** Where this brief prescribes UI behaviour that differs from the mockups (mode chip rendering, Run Modal wizard shape, Agent config page placement, "Check now" button, heartbeat-gate threshold inputs, etc.), the mockups and the spec's §3a.2 are the authoritative version. This brief is the originating narrative; §3a.2 is the implementation contract.

**The key simplifications** (full list in spec §3a.2): no new agent-config page — `default_safety_mode` and heartbeat-gate toggle extend existing `AdminAgentEditPage.tsx` / `SubaccountAgentEditPage.tsx`; no new run-detail page for failed `invoke_automation` steps — they render as one row in the existing run log with one "Fix" CTA; heartbeat gate ships the toggle only (thresholds stay in the schema with defaults, not exposed in v1 UI); `WorkflowRunModal` drops the multi-step wizard framing; Promote-to-Execute drops the trust-receipts list.

---

## Contents

1. [Background, provenance, and reviewer reconciliation](#1-background-provenance-and-reviewer-reconciliation)
2. [Codebase primer — what you need to know](#2-codebase-primer--what-you-need-to-know)
3. [Recommendation 1 — Explore Mode / Execute Mode](#3-recommendation-1--explore-mode--execute-mode)
4. [Recommendation 2 — Full naming pass with schema migration](#4-recommendation-2--full-naming-pass-with-schema-migration)
5. [Recommendation 3 — Heartbeat activity-gate (deterministic-first)](#5-recommendation-3--heartbeat-activity-gate-deterministic-first)
6. [Recommendation 4 — Minimal context-assembly telemetry](#6-recommendation-4--minimal-context-assembly-telemetry)
7. [Recommendation 5 — Agent-decomposition heuristic (hygiene)](#7-recommendation-5--agent-decomposition-heuristic-hygiene)
8. [Skill-count ceiling — confirmation only](#8-skill-count-ceiling--confirmation-only)
9. [Build plan and sequencing](#9-build-plan-and-sequencing)
10. [What we deliberately aren't building in this wave](#10-what-we-deliberately-arent-building-in-this-wave)
11. [Open questions for external review](#11-open-questions-for-external-review)

---

## 1. Background, provenance, and reviewer reconciliation

### Where this came from

A mainstream creator-audience YouTube explainer — Riley Brown, creator of a self-hostable agent runtime called "OpenClaw" — walked through agent workflows for non-technical users. The framing is pitched at solo operators and small agencies, not engineers, which makes it directly relevant to Automation OS's core buyer: **GoHighLevel (GHL) agency owners running a handful to a hundred sub-accounts**.

We already have a detailed strategic analysis of the OpenClaw category at `docs/openclaw-strategic-analysis.md` (2026-04-18). That document covers the big structural angles: cost narrative, substrate adapter, IEE delegation-lifecycle stability, progressive Simple / Advanced / Raw abstraction. **This brief is an addendum, not a replacement** — it captures narrower tactical observations the strategic doc didn't cover.

### How the observations were derived

Two independent analyses ran on separate branches against the same transcript, then were reconciled against the actual codebase. The v1 brief (committed earlier on this branch) captured the reconciled output. This v2 integrates external ChatGPT review feedback on top.

### Reviewer reconciliation (what changed between v1 and v2)

ChatGPT reviewed the v1 brief and raised several calls that sharpened the work. Summary of what we adopted, what we pushed back on, and why:

**Adopted from reviewer:**

- **Dry-run elevated to a Mode system.** Reviewer was right that "toggle" frames safety as a feature, not a core interaction. Renamed to **Explore Mode / Execute Mode** and promoted to a first-class product concept with defaults that favour safety for new users. See §3.
- **Heartbeat goes deterministic-first.** Reviewer correctly flagged that proposing an LLM decision-step for "should I run?" is LLM-first thinking when rules can solve 80% of it cheaper and more predictably. v1 ships with event-delta / time-threshold / state-flag rules; LLM fallback only if rules prove insufficient. See §5.
- **Telemetry simplified.** Reviewer warned against over-designing the event schema upfront. v1 ships with tokens, memory counts, latency, and gap flags only. Richer per-source / per-skill breakdowns land in v2 once we know which questions we actually ask in practice. See §6.
- **Decomposition heuristic demoted.** Reviewer correctly noted this is "write down a thing we already know" — doesn't belong in a prioritised dev brief. Keeping as a footnote-class hygiene edit because it costs five minutes; removing it from the priority table. See §7.

**Pushed back on reviewer:**

- **Rename stays in scope.** Reviewer recommended cutting or bundling later. The reviewer didn't know we're **pre-launch with no live users**. That changes the cost curve completely: a rename is cheap today and expensive forever. We upgraded it from "rename UI strings" to a **full naming pass including database schema migration, types, routes, services, and skills**. During the discussion we also realised the two primitives we were renaming (Playbooks and Workflows) are genuinely different concepts with overlapping terminology debt across three schema families; the naming pass collapses that into one clean mental model. See §4.
- **"Add first-run / time-to-first-win / outcome-first UX" — acknowledged but scope-deferred.** Reviewer's strongest structural critique: the brief optimises mechanics, not outcomes. We agree that's the next strategic bet — but fusing it into this wave would turn a tactical sweep into a product re-architecture. The honest move is to flag it explicitly and come back to it next. See §10.

### What's explicitly out of scope for this wave

- OpenClaw as an execution substrate. Already addressed in the strategic analysis doc.
- Agent delegation lifecycle fixes. Separate workstream.
- Progressive Simple / Advanced / Raw abstraction. Separate workstream.
- Cost-transparency UI surface. Marketing-adjacent, separate scope.
- Memory-block retrieval (Phase 8 of Universal Brief). Already specced, in flight.
- Time-to-first-win / guided onboarding / outcome-first UX. See §10.

### Who this brief is for

1. **Second-pass external LLM reviewer** — you. Critique the v2 recommendations. We are specifically looking for: remaining design flaws, places where our reviewer reconciliation went wrong, and items still worth cutting.
2. **Automation OS engineering team** — will execute after this review lands.
3. **Product / founder** — final sequencing decision.

---

## 2. Codebase primer — what you need to know

External reviewers often push back on proposals without full context. This section is the shared vocabulary.

### 2.1 What Automation OS is

A multi-tenant backend + client application that runs AI agents on behalf of marketing agencies managing many GoHighLevel sub-accounts. Agencies are the customer; GHL sub-accounts are the tenants-of-tenants. **The product is pre-launch — no live users yet.** This materially changes what changes are expensive (migrations, renames: cheap now) versus what stays expensive (real architectural work).

The three product layers relevant to this brief:

1. **Orchestrator and agents.** 15+ system-defined agents (Dev, QA, Ads Management, CRM & Pipeline, Portfolio Health, etc.) each scoped to a capability area. A capability-aware Orchestrator (`server/jobs/orchestratorFromTaskJob.ts`, `docs/orchestrator-capability-routing-spec.md`) receives tasks and routes them to the right agent or delegates to a Configuration Assistant if a capability is missing.
2. **Skills.** ~152 markdown files in `server/skills/` plus per-company overrides in `companies/*/skills/`. Each skill is a bounded capability an agent can invoke. Skills are **statically bound to agents** via YAML frontmatter in `companies/automation-os/agents/{slug}/AGENTS.md`. They are *not* pooled — each agent sees only its assigned subset.
3. **Two execution primitives that sit side-by-side, which this brief's naming pass will clean up:**
   - **Playbooks** — native, in-product multi-step orchestrations with HITL gates, memory integration, agent decision-steps, scheduling, simulation. Files, types, tables, routes, and skills all carry `playbook` / `Playbook` today. After the rename, this primitive becomes **Workflows**.
   - **"Workflows" (currently) / `processes` (in schema)** — webhook-backed wrappers around external automation engines (Make.com, n8n, Zapier, GoHighLevel native workflows, custom webhooks). Each row is a configured integration. The term debt here is significant: the UI says "Workflows," the URL says `/processes`, the lazy-loaded component file is `TasksPage.tsx`, and the DB table is `processes`. After the rename, this primitive becomes **Automations**.

### 2.2 The execution loop

When a task is dispatched to an agent, the flow is:

1. **Fast-path triage** (Universal Brief, `server/services/briefCreationService.ts`, `server/services/chatTriageClassifier.ts`). A two-layer classifier (heuristic tier 1 + Haiku LLM tier 2) decides whether to handle the task inline (`simple_reply`, `cheap_answer`), ask for clarification, or escalate to the Orchestrator. Every decision is logged to a `fast_path_decisions` table for shadow-eval.
2. **Orchestrator routing** (if the fast-path escalates). The Orchestrator inspects available capabilities and either dispatches directly, asks a clarifying sub-call, or routes to the Configuration Assistant.
3. **Agent execution** (`server/services/agentExecutionService.ts`). Context is assembled: briefing + beliefs + memory blocks (with `memoryBlockRetrievalServicePure.ts` precedence: subaccount > agent > org) + workspace memory (via `workspaceMemoryService.getMemoryForPrompt`, which does hybrid vector + keyword + HyDE + RRF retrieval) + known entities. This is injected **once, before the agent loop starts** — it is not re-fetched mid-loop.
4. **The agent loop.** Model + tools + skill invocations, running until the agent decides it's done or hits a gate.

### 2.3 HITL gates — the existing safety model

Every skill declares a `defaultGateLevel`: `auto` (runs immediately), `review` (creates a review item; human must approve before execution), or `block` (never runs, not even with approval — typically reserved for irreversible destructive actions).

Gate levels can be overridden at the agent level, sub-account level, or per-run. There's also a **Supervised mode** toggle on the Playbook Run modal (`client/src/components/PlaybookRunModal.tsx:339–344`) that forces a pause before every side-effecting step regardless of declared gate level.

**Critical for Rec 1:** Supervised mode still runs against live data — it just asks for approval first. There is no "run this but don't touch anything real" primitive today. The closest thing is a `playbook_simulate` skill that does **static analysis only** (step count, parallelism, critical path, reversible/irreversible counts) and is **system-admin only** via the Playbook Studio page.

### 2.4 Heartbeat

Portfolio Health Agent has proactive-wake infrastructure that most competitors don't have:

- Per-agent config: `agents.heartbeatEnabled`, `agents.heartbeatIntervalHours` (migrated in `migrations/0068_portfolio_health_agent_seed.sql`)
- Per-subaccount override: `subaccount_agents.heartbeatEnabled/Interval/Offset`
- Registered into pg-boss via `server/services/agentScheduleService.ts`
- Projected for UI via `server/services/scheduleCalendarService.ts`
- User-facing toggle at `client/src/pages/AdminAgentEditPage.tsx:1422`

**But** — when the tick fires, the agent runs unconditionally. It reads state and decides *what to surface*, but it does not decide *whether to run at all*. This is the gap Recommendation 3 addresses (with deterministic rules first, not an LLM call).

### 2.5 Existing primitives this brief reuses

| Primitive | File | What it does |
|---|---|---|
| HITL gate resolution | `server/services/agentExecutionService.ts` | Resolves effective gate level for a skill given agent + subaccount + run overrides |
| Review queue | Existing review-item UI + backend | Collects pending-approval actions, routes to approvers |
| Supervised mode | `PlaybookRunModal.tsx`, `runMode: 'supervised' \| 'auto'` | Forces pause before each side-effecting step |
| Simulate | `server/skills/playbook_simulate.md`, `/api/system/playbook-studio/simulate` | Static analysis, admin-only |
| Tracing registry | `server/lib/tracing.ts` | Named event emitter for structured observability |
| Fast-path telemetry | `fast_path_decisions` table, `fastPathDecisionLogger.ts` | Shadow-eval logging for Universal Brief classifier |
| Workspace memory | `workspaceMemoryService.getMemoryForPrompt` | Hybrid retrieval; append-only log |

Every recommendation in this brief uses one or more of these. None introduce a new subsystem.

### 2.6 Naming debt — three "workflow"-named concepts in the schema

This is the structural problem Rec 2 solves. Today the schema has **three** different concepts all using "workflow"-family words, inherited from distinct historical layers:

| Schema surface | What it actually is | Rec 2 rename target |
|---|---|---|
| `processes` table + `subaccount_process_links` + `process_categories` + `process_connection_mappings` + `processedResources` (unrelated — resource processing) + `processResolutionService.ts` + `processService.ts` + `/api/processes/*` + UI label "**Workflows**" + URL `/processes` + component `TasksPage.tsx` | Webhook wrappers around external engines. A user-created "Workflow" is a row that points at a Make scenario / n8n flow / GHL workflow / Zapier zap via a webhook path. | **`automations` table and everything downstream. UI label: "Automations".** |
| `workflow_engines` table + `engineType` enum of `n8n/ghl/make/zapier/custom_webhook` | The registry of external engines that `processes` point at. Infrastructure, not user-facing. | **`automation_engines`** (same shape, renamed for consistency with the feature they power). |
| `workflow_runs` table + `workflow_step_outputs` + `workflowExecutorService.ts` + `canonicalWorkflowDefinitions` + `server/types/workflow.ts` | A separate **internal flow-execution stack** (schema comment: "Flows pattern") used by `actionService.ts` and `scanIntegrationFingerprintsService.ts`. Migrated in `0037_phase1c_memory_and_workflows.sql` — predates Playbooks (0076). Not user-facing. | **`flow_runs` / `flowExecutorService` / `canonicalFlowDefinitions`** — renamed out of the `workflow*` namespace so it doesn't collide with Rec 2's new `workflow*` tables (renamed from `playbook*`). |
| `playbooks` / `playbook_runs` / `playbook_step_runs` / `playbook_step_reviews` / `playbook_template_versions` / `playbook_studio_sessions` / `playbook_run_event_sequences` / `playbookStudioService.ts` / `.playbook.ts` files / `playbook_*` skill files / UI label "**Playbooks**" | Native multi-step agent orchestration with HITL gates, scheduling, memory, simulation. | **`workflows` / `workflow_runs` / `workflow_step_runs` / etc. UI label: "Workflows".** |

**The collision.** Naively renaming `playbook_runs → workflow_runs` hits an existing table of the same name (the internal flow stack). Rec 2 resolves this by renaming the *internal flow stack* out of the `workflow*` namespace first, then renaming Playbooks into the cleared space. Details in §4.

### 2.7 Things that may surprise an external reviewer

- **Agents are not pooled.** Each agent only sees its assigned skills. The "152 skills total" figure is cross-agent; no agent has 152 skills resolvable at runtime.
- **The UI labels and schema names disagree.** The sidebar nav shows "Workflows"; the URL says `/processes`; the component file is `TasksPage.tsx`. Three historical renames layered on top of each other. Rec 2 is also about collapsing this debt.
- **Fast-path telemetry ≠ context-assembly telemetry.** Universal Brief logs classification decisions (which agent/scope). `agentExecutionService.ts` assembles run context (briefing + beliefs + memory) but emits no named event. These are different phases. Recommendation 4 adds the missing one.
- **Heartbeat is real, not a roadmap item.** Portfolio Health Agent ticks every 4h in production. Rec 3 is a refinement of an existing mechanism, not a greenfield build.
- **Pre-launch posture.** No live users, no paying customers, no in-place data to preserve. Migrations run against dev/staging environments only. This is the only window in which a schema-level rename is cheap.

---

## 3. Recommendation 1 — Explore Mode / Execute Mode

### Problem

The video's single most repeated refrain from Riley's non-technical audience: *"I ran the agent against my real Notion / real Gmail / real CRM and it did something I didn't want."* His workaround is to manually duplicate databases, create dummy email accounts, and point test runs at the duplicates.

Automation OS has stronger safeguards architecturally — HITL gates (`auto` / `review` / `block`), Supervised mode, per-action gate overrides — but **none of them are surfaced as a single, visible mental model** for when it's safe to let an agent loose. A non-technical agency owner configures an agent, hits Run, and trusts the review queue to catch mistakes. They have to understand the gate model before they feel safe.

v1 of this brief proposed a **Dry Run toggle**. The external reviewer correctly pushed back: framing safety as a toggle makes it a feature, not a core interaction pillar. A toggle is discoverable only if the user already knows to look for it. A mode is always visible, always answering the question "am I safe right now?"

### Recommendation

Promote the safety affordance from a toggle to a **two-mode system** visible on every agent and Workflow (née Playbook) run surface:

- **Explore Mode** — the default for new agents, for unfamiliar agents, and for any run launched against a sub-account the user hasn't used this agent on before. All side-effecting skills are forced to `review` gate level for the run, regardless of declared default. Read-only skills run unimpeded (no review-queue noise). A banner reads: *"Explore Mode — nothing will change until you approve."*
- **Execute Mode** — the opt-in mode where declared gate levels apply as configured. Banner reads: *"Execute Mode — auto-gated actions will run without approval."*

**Not a toggle — a mode.** The current mode is always displayed at the top of the run surface. Switching modes requires an explicit click, not a hidden checkbox. The mode persists across messages in a conversation but resets to Explore Mode on a new agent/sub-account pairing.

### Where it lives in the UI

- `client/src/pages/AgentChatPage.tsx` — persistent header chip showing current mode with a switch affordance
- `client/src/components/PlaybookRunModal.tsx` (now WorkflowRunModal after Rec 2) — step 2 of the run wizard explicitly asks "Explore or Execute?" with Explore pre-selected
- Each agent's config page — a default-mode setting for that agent (Explore for new agents; owner can change to Execute once they trust it)

### Defaults and escalation

- **New agents default to Explore Mode.** A fresh agent the user just configured can never, on first run, auto-execute side-effecting actions. The user must deliberately switch to Execute.
- **Mode persistence is per-user, per-agent, per-subaccount.** A user who has run Agent X against Sub-account A in Execute Mode 10 times retains Execute as default. Starting with a new sub-account resets to Explore.
- **"Promote to Execute" prompt.** After N successful Explore-Mode runs of the same agent against the same sub-account, the UI prompts: *"This agent has run N times in Explore Mode with your approvals. Switch to Execute Mode for future runs?"* — frictionless promotion with an audit trail.

### Implementation shape

- Reuses existing gate resolution (`agentExecutionService.ts`). One override in the resolver: if `runMode === 'explore'` and skill's `sideEffects === true`, force `gateLevel: 'review'`.
- Reuses the existing review queue. No new approval surface.
- One new enum column on the run record: `run_mode: 'explore' | 'execute'`.
- One new field on agent config: `default_run_mode: 'explore' | 'execute'`.
- One small store on user preferences / browser local state to remember last mode per (user, agent, subaccount).
- Read-only skill detection: use declared `sideEffects` frontmatter on skills. If a skill doesn't declare, default to `true` (safe). During the spec, audit the 152 skills and annotate missing flags.

### Why not a true data sandbox?

Because it's massively more work and the value is marginal. Real sandbox needs: copies of every integration's state, synthetic data, a mapping layer, teardown logic, lifecycle UI. For 95% of the "did the agent do something I didn't want?" fear, Explore Mode solves it by forcing review-before-execute. The 5% where you genuinely want to see destructive output without consequences is better served by skill-level unit tests, not a product surface.

### Edge cases

1. **Explore Mode ⊃ Supervised Mode.** The existing Supervised-mode checkbox is redundant once Explore Mode ships. Remove it. Supervised = a subset of Explore's behaviour. Don't create a matrix of modes-within-modes.
2. **Read-only skills under Explore Mode.** They run without approval pauses. Criterion: declared `sideEffects: false` on the skill. Names like `list_*`, `get_*`, `read_*` are a fallback heuristic but shouldn't be load-bearing — audit and annotate during the spec.
3. **Chained skills.** If skill A (side-effecting) is paused for approval and skill B depends on A's output, B waits. The existing review queue handles this cleanly. Worth spot-checking with a real Playbook / Workflow during the spec.
4. **Scheduled runs.** Scheduled runs (Rec 2 renames this scope to "scheduled Workflows") cannot be in Explore Mode — review items would pile up with nobody looking. Scheduled runs are always Execute Mode. UI should surface this explicitly when a user configures a schedule.
5. **Mixing modes in a Workflow.** A single Workflow runs entirely in one mode — no per-step mode switching. If a Workflow has some steps you want to auto-run and some you want reviewed, use per-skill `defaultGateLevel` in Execute mode rather than fracturing the mode model.

### Success criteria

1. A first-time user launching a new agent **cannot** accidentally auto-execute a side-effecting action. The default-Explore posture makes that structurally impossible.
2. ≥80% of users promote to Execute Mode on at least one agent within their first week. Promotion rate is a proxy for trust — if it stays low, Explore Mode is either too friction-heavy or the escalation UX is hidden.
3. Zero production support tickets filed as "agent did thing I didn't expect" traceable to a first-N-runs mistake.
4. The mode is visible on 100% of run surfaces. A user who doesn't know what mode they're in is the failure case.

### What an external reviewer should push back on

- Is "Explore / Execute" the right naming? Alternatives: "Review / Run," "Preview / Run," "Safe / Live." Test naming with an actual GHL agency owner before locking.
- Should Explore Mode let the user override review for a specific action mid-run (*"actually, go ahead"*) as a one-shot approval, or does every Explore action require the full review-queue flow? First is faster; second is more consistent.
- Does the "promote to Execute" prompt create a psychological trap — users clicking through without reading, then being surprised when actions auto-execute? Worth considering whether we should require re-confirmation of Execute every time rather than letting it persist.
- Is there a third mode worth naming explicitly — "Scheduled" — or is that a property of a run rather than a user-visible mode?

---

## 4. Recommendation 2 — Full naming pass with schema migration

### Why now

Pre-launch. No live users. No API consumers. No in-place data to preserve. The only friction is coordinating in-flight branches and one careful migration. After launch, this rename would be a multi-quarter migration. Right now it's days.

The reviewer recommended cutting or bundling this later. The reviewer didn't know we're pre-launch. With that context, the cost/benefit flips: doing it now prevents naming debt from calcifying.

### The rename in one sentence

*"**Automations** are external tools we call; **Workflows** are native multi-step orchestrations we run with our agents."*

That framing is the test for every label, column, file, and docstring we touch.

### The two-way rename

| Concept | From | To |
|---|---|---|
| Native multi-step agent orchestration | Playbook(s) | Workflow(s) |
| External engine wrapper | Workflow(s) / process(es) | Automation(s) |

### Settling the triple-workflow collision first

Per §2.6, the schema today has three "workflow"-named concepts. The rename order matters because `playbook_runs → workflow_runs` collides with an existing `workflow_runs` table used by the internal flow stack.

**Resolution plan (executed in this order):**

1. **Step 1 — Rename the internal flow stack out of the `workflow*` namespace.**
   - `workflow_runs` → `flow_runs`
   - `workflow_step_outputs` → `flow_step_outputs`
   - `canonicalWorkflowDefinitions` → `canonicalFlowDefinitions`
   - `workflowExecutorService.ts` → `flowExecutorService.ts`
   - `server/types/workflow.ts` → `server/types/flow.ts`
   - Downstream references in `actionService.ts`, `scanIntegrationFingerprintsService.ts`, `queueService.ts`
   - This is the prerequisite step that clears the namespace. It has no user-visible surface — purely internal.
2. **Step 2 — Rename Processes → Automations.**
   - Schema tables: `processes → automations`, `process_categories → automation_categories`, `subaccount_process_links → subaccount_automation_links`, `process_connection_mappings → automation_connection_mappings`. Leave `processedResources` alone — unrelated, it's about resource-ingestion book-keeping.
   - `workflow_engines → automation_engines`. Update the `engineType` enum name if it's exported.
   - Services: `processService.ts → automationService.ts`, `processResolutionService.ts → automationResolutionService.ts`
   - Routes: `/api/processes/* → /api/automations/*`, `/api/system/processes/* → /api/system/automations/*`, `processConnectionMappings.ts → automationConnectionMappings.ts`, `systemProcesses.ts → systemAutomations.ts`
   - Pages + components: `SystemProcessesPage → SystemAutomationsPage`. The lazy-loaded aliases in `App.tsx` (`ProcessesPage → TasksPage`, etc.) get renamed in both alias and target — `TasksPage.tsx → AutomationsPage.tsx`, etc. Same with `AdminTasksPage`, `TaskExecutionPage`, `AdminTaskEditPage` — historical debt swept up in the same pass.
   - UI strings: "Workflows" → "Automations" throughout sidebar, studio, calendar badges, portal cards, run modals, empty states, tooltips.
   - URL paths: `/processes → /automations`, `/admin/processes → /admin/automations`, `/system/processes → /system/automations`, portal path `/portal/:id/processes/:pid → /portal/:id/automations/:aid`.
   - Permissions: `ORG_PERMISSIONS.PROCESSES_* → ORG_PERMISSIONS.AUTOMATIONS_*`.
   - DB migration files: unchanged (historical). New migration is additive.
3. **Step 3 — Rename Playbooks → Workflows.**
   - Schema tables (the newly cleared `workflow*` namespace): `playbooks → workflows`, `playbook_runs → workflow_runs`, `playbook_step_runs → workflow_step_runs`, `playbook_step_reviews → workflow_step_reviews`, `playbook_template_versions → workflow_template_versions`, `playbook_templates → workflow_templates`, `system_playbook_templates → system_workflow_templates`, `system_playbook_template_versions → system_workflow_template_versions`, `playbook_studio_sessions → workflow_studio_sessions`, `playbook_run_event_sequences → workflow_run_event_sequences`.
   - Services: `playbookStudioService.ts → workflowStudioService.ts`, `playbookRunService.ts → workflowRunService.ts` (and any sibling services — audit).
   - Routes: `/api/playbooks/* → /api/workflows/*`, `/api/system/playbook-studio/* → /api/system/workflow-studio/*`.
   - Pages + components: `PlaybooksLibraryPage → WorkflowsLibraryPage`, `PlaybookStudioPage → WorkflowStudioPage`, `PlaybookRunDetailPage → WorkflowRunDetailPage`, `PlaybookRunModal → WorkflowRunModal`, etc. Audit client/src for the full list.
   - UI strings: "Playbook(s)" → "Workflow(s)" throughout sidebar, library, studio, run modal, portal cards, empty states, tooltips, email templates, portal messages, calendar badges.
   - URL paths: `/playbooks → /workflows`, `/system/playbook-studio → /system/workflow-studio`.
   - Permissions: `ORG_PERMISSIONS.PLAYBOOKS_* → ORG_PERMISSIONS.WORKFLOWS_*` (and sidebar visibility keys like `hasSidebarItem('workflows')` stay as `'workflows'`).
   - File naming convention: `*.playbook.ts → *.workflow.ts` for built-in workflow definitions.
   - Skill names: `playbook_validate → workflow_validate`, `playbook_simulate → workflow_simulate`, `playbook_propose_save → workflow_propose_save`, `playbook_read_existing → workflow_read_existing`, `playbook_estimate_cost → workflow_estimate_cost`, `config_publish_playbook_output_to_portal → config_publish_workflow_output_to_portal`, `config_send_playbook_email_digest → config_send_workflow_email_digest`. Skills reference each other by name — grep all skill files for `playbook_` and update mutually.
   - Docs and specs under `docs/`: `playbooks-spec.md`, `onboarding-playbooks-spec.md`, `playbook-agent-decision-step-spec.md`, etc. Strings in surrounding brief/spec docs updated for consistency.

### DB migration shape

One migration file per renaming step, in the correct order:

- `0172_rename_workflow_runs_to_flow_runs.sql` — step 1
- `0173_rename_processes_to_automations.sql` — step 2
- `0174_rename_playbooks_to_workflows.sql` — step 3

Each migration uses `ALTER TABLE ... RENAME TO ...` and `ALTER TABLE ... RENAME COLUMN ...` — no data copy, no downtime concerns (pre-launch). Drizzle schema file commits happen in lockstep with each migration. Foreign-key constraints renamed to match (Postgres renames them implicitly when you rename the referenced table, but constraint names stay until explicitly renamed — cleanup pass in the same migration).

Migration verification step: after each migration runs on dev, verify `drizzle-kit introspect` yields a clean diff against the updated Drizzle schema files. No lingering references to old table names.

### Ripple zones outside schema

- **Review logs** (`tasks/review-logs/*playbook*`). Historical artefacts — **leave as-is**. They reference a primitive that existed at the time they were written. Rewriting history here is churn with no benefit.
- **Specs and briefs** that reference the rename subject: updated in the same wave (high-signal engineering docs that will be re-read).
- **Type exports** at the top of `shared/schema/` or equivalent. Renamed.
- **Test fixtures and test names.** Grep test files for `playbook` / `process` / `workflow_runs` and update. Green tests before merging.
- **Generated OpenAPI / TS client** if any. Regenerate.
- **Environment variables, feature flag names.** Grep `.env*` and `server/config/`.
- **Seed data and demo content.** Any seeded processes/playbooks need renamed table references.
- **Agent config YAML frontmatter.** If any agent's `skills:` list references renamed skill slugs, those need updating too.

### What does NOT rename

- **Migration files themselves.** History stays; new migrations are additive.
- **Commit messages, PR titles, branch names** from before the rename. History stays.
- **The review-logs already written** (see above).
- **`workflowExecutor` domain terminology in the code comments referring to the old flow stack's behaviour.** After step 1, this is `flow*`; historical comments inside renamed files get updated for consistency, but this is a code-review concern, not a schema concern.
- **HighLevel terminology in integration code.** If the `ghl` engineType talks to HighLevel's "Workflows" API, that reference stays accurate — we're renaming our code, not theirs.

### Edge cases

1. **Half-applied migration.** If step 2 runs but step 3 fails, the DB is in a valid state (processes renamed, playbooks still there). Each migration is atomic; partial is never broken.
2. **In-flight branches referencing `playbook_*` or `process_*`.** Land all three migrations in one PR to main, then force a rebase on every open feature branch. Resolution is mechanical find-and-replace using the mapping table above.
3. **The `TasksPage.tsx` → `AutomationsPage.tsx` historical rename.** The component file name lies about what it renders. Rename opportunistically but not necessarily as part of this rename — could defer to a hygiene follow-up if it bloats this PR. Flag during spec.
4. **UI strings inside markdown docs consumed at runtime** (e.g., onboarding help content loaded from `.md` files). Grep `docs/` and `server/assets/` for string references.
5. **Plural vs singular consistency.** Sidebar says "Workflows" (plural); run detail page says "Workflow" (singular). Ensure consistent.
6. **Icons.** Current `Icons.automations` is generic. Consider different icons for Automations (external plug/connector) vs Workflows (branching orchestration). Small visual cue, big comprehension payoff. Flag during spec.

### Success criteria

1. After merge: `grep -rn 'playbook\|Playbook' client/src server/routes server/services server/db` returns only historical migration files and comments in review logs. User-facing strings and active code reference only `workflow`.
2. After merge: `grep -rn 'processes\|/api/processes' client/src server/routes` returns zero hits. The term "Workflows" (referring to external integrations) is gone from the live UI.
3. A new user onboarded after the rename understands immediately: *Automations bring in external tools; Workflows are built here.*
4. No in-flight branches are broken for more than a day after merge. Migration PR ships with a commit-message template for rebasing feature branches.

### What an external reviewer should push back on

- Is `flow_runs` the right name for the displaced internal stack, or does it deserve its own thought? Alternatives: `action_runs` (it's tied to `actionService.ts`), `integration_scan_runs` (it's used by scan-integration-fingerprints), or something fully different if the stack is vestigial enough to deprecate.
- Is the three-step migration the right sequencing, or would a single big atomic migration be safer (no intermediate state)? Tradeoff: one migration is harder to review; three migrations are easier but must all merge together.
- Should we opportunistically rename `TasksPage.tsx → AutomationsPage.tsx` at the same time, or leave it as separate cleanup? Argument for: one coherent pass. Argument against: scope creep.
- Are there user-facing strings in server-rendered content (email templates, Slack messages, PDF exports) we'll miss in a client-only grep? Worth explicit audit.
- Does renaming permission keys (`PROCESSES_* → AUTOMATIONS_*`) affect any role/permission seed data we need to migrate in the same step?

---

## 5. Recommendation 3 — Heartbeat activity-gate (deterministic-first)

### Problem

Riley's OpenClaw "Heartbeat" primitive: the agent wakes every N minutes, evaluates state, and **decides whether to do anything at all**. It can skip the tick entirely if nothing has changed.

Automation OS has heartbeat infrastructure (Portfolio Health Agent wakes every 4h — see §2.4), but the agent runs unconditionally each tick. It pays the full LLM cost of loading context, inspecting state, and generating a report even when nothing relevant has changed across the portfolio.

### What changed from v1

v1 of this brief proposed an LLM-based decision-step. The external reviewer correctly flagged this as LLM-first thinking: introducing another LLM call, another failure mode, another tuning problem — for a layer that should be **infrastructure-level reliability**. Rules can solve 80% of this cheaper, more predictably, and with zero trust issues.

v2 inverts the design: **v1 ships with deterministic rules only.** LLM-based signal detection is deferred to v2, and only added if rules prove insufficient after real-world data lands.

### Recommendation

A pre-dispatch **activity gate** on heartbeat ticks, driven entirely by deterministic signals. For any agent with `heartbeatEnabled: true`, before dispatching to the full agent loop, evaluate a small set of rules:

1. **Event-delta rule** — has the number of new events (portfolio entities added/modified, alerts raised, jobs completed) since the last *meaningful* tick exceeded the agent's configured threshold? If yes → run. If no → candidate for skip.
2. **Time-threshold rule** — regardless of events, if it has been N ticks (default: 6 → roughly one full-day cycle for a 4-hour cadence) since the agent last produced *any* output, run anyway. Prevents a permanent silence.
3. **Explicit-trigger rule** — was a user-initiated check requested since the last tick? Run.
4. **State-flag rule** — does the subaccount have any `requires_attention` flag set (e.g., billing issue, integration broken, failed run in review queue)? Run.

If all rules return "no signal" → skip. Otherwise → run.

**No LLM call.** The gate is pure data access + comparison. Latency: low single-digit milliseconds.

### Schema changes

One migration adds columns to the `agents` table (and corresponding overrides on `subaccount_agents`):

- `heartbeat_activity_gate_enabled: boolean DEFAULT false` — opt-in per agent
- `heartbeat_event_delta_threshold: integer DEFAULT 3` — minimum events to guarantee a run
- `heartbeat_min_ticks_before_mandatory_run: integer DEFAULT 6` — hard floor against permanent silence

These names reflect the deterministic model and slot into the existing heartbeat config surface in `AdminAgentEditPage.tsx:1422`.

No migration on `agent_runs` needed — skipped ticks don't create a run record. They emit a tracing event and optionally append a compact note to workspace memory.

### Where the code changes land

1. **Config schema**: one migration adding three columns on `agents` + mirror on `subaccount_agents`.
2. **Admin UI**: `client/src/pages/AdminAgentEditPage.tsx` — add two numeric inputs and one toggle under the existing heartbeat config. System-admin only in v1.
3. **Gate implementation**: a new small module, e.g. `server/services/heartbeatActivityGateService.ts`. Pure function — takes `(agentId, subaccountId, lastTickOutputAt, ticksSinceLastOutput)` as inputs; returns `{ shouldRun: boolean, reason: string }`. No external calls except existing DB reads.
4. **Execution hook**: wrap the heartbeat-originated dispatch path in `agentExecutionService.ts` (or the pg-boss handler that invokes it) with the gate call. Heartbeat dispatch is a distinct entry point from user-initiated or Orchestrator-initiated runs; the gate doesn't touch those.
5. **Observability**: emit `heartbeat.tick.gated` with `{agentId, subaccountId, shouldRun, reason, eventsSinceLastTick, ticksSinceLastOutput, latencyMs}`. This is where Rec 4's telemetry plugs in.

### Rollout posture

- Ship with the feature **off by default**. Opt-in per agent.
- Enable on Portfolio Health Agent first, with conservative thresholds (delta = 3, min-ticks = 6).
- Monitor skip rate + any "agent didn't surface X" complaints for 2 weeks before tuning or broader rollout.
- If the rules prove too noisy or too quiet after 2 weeks, re-tune thresholds — *not* add an LLM fallback. Re-tuning is cheap; adding an LLM call is not.

### v2 (deferred, not in this wave)

Only if the deterministic gate demonstrably misses important signals will we add an LLM reasoning step. By then we'll have real data on what it missed, which makes the LLM design straightforward rather than speculative.

### Edge cases

1. **First tick after enable.** No prior-tick context to compare against. Always run the first tick after enabling.
2. **Gate itself fails.** DB read error, service unavailable. **Default: run the tick as today.** Never skip on error. Gate is optimisation, safety posture is "when in doubt, run."
3. **Workspace-memory flooding.** If we skip 5 ticks/day per sub-account across many sub-accounts, workspace memory gets noisy. Mitigation: do not append skip notes to workspace memory in v1. Skip visibility lives entirely in the `heartbeat.tick.gated` tracing event. Only add memory notes if operator complaints surface.
4. **Manual run.** A user clicking "Check now" on the agent config page bypasses the gate entirely. Reuses the existing manual-run path.
5. **Threshold sensitivity across sub-accounts.** The "right" event threshold depends on how noisy a given sub-account is. Make thresholds per-subaccount-overridable from day one via `subaccount_agents` config rows.

### Success criteria

1. Portfolio Health Agent skip rate lands in the 20–60% range after 2 weeks of tuning.
2. Zero operator complaints traceable to a skipped tick in the first 2 weeks.
3. Average LLM cost per Portfolio Health Agent tick drops measurably (target: 40%+ reduction).
4. The gate never causes an incident because of the "when in doubt, run" error posture.

### What an external reviewer should push back on

- Are the four rules the right ones? Missing: "new manual user activity in this subaccount" (session seen in last N hours), "schedule has changed since last tick" (time-window edits), etc.
- Is a per-agent feature flag the right abstraction, or should this be built into Portfolio Health Agent specifically and generalised only if a second agent asks for it?
- Should the gate output also drive a visible "heartbeat: alive, nothing to surface" heartbeat badge in the agent dashboard, so operators see activity without seeing noise? Worth it for trust, or UI clutter?
- Are the default thresholds (delta = 3, min-ticks = 6) reasonable starting points, or should they be picked per-agent based on domain?

---

## 6. Recommendation 4 — Minimal context-assembly telemetry

### Problem

Riley's framing (borrowed from Andrej Karpathy): *"The job isn't prompt engineering, it's context engineering — assembling the right memory, skills, and tool access before the agent runs."*

Automation OS already does context engineering in `agentExecutionService.ts` (see §2.2): briefing + beliefs + memory blocks + workspace memory + known entities, all injected once before the agent loop starts. **The gap is observability** — today there's no named trace event for this phase, so debugging "why did this run produce bad output?" is multi-minute log archaeology.

### What changed from v1

v1 proposed a richly structured event with per-source memory breakdowns, full skill authorisation lists, and granular gap flags. The external reviewer correctly flagged this as over-designing upfront — risk of building "a perfect observability schema that slows shipping" before we know which questions we actually ask in practice.

v2 is minimal: **one event, small payload, pragmatic extension path.**

### Recommendation

Emit a single `context.assembly.complete` event from `agentExecutionService.ts` after context injection and before the agent loop starts.

**v1 event shape:**

```typescript
{
  eventType: 'context.assembly.complete',
  runId: string,
  agentId: string,
  subaccountId: string | null,
  orgId: string,
  timestamp: ISO8601,
  latencyMs: number,              // total time assembling context
  totalTokens: number,            // everything injected into the prompt
  contextBudget: number,          // model's context window
  contextPressure: number,        // totalTokens / contextBudget, 0..1
  memoryBlockCount: number,       // blocks included after precedence filtering
  workspaceMemoryLength: number,  // token count of workspace memory segment
  gapFlags: string[],             // e.g. ['no_workspace_memory', 'stale_beliefs']
}
```

**Not in v1 (deferred to v2 once we know we need them):**

- Per-phase token breakdown (briefing vs beliefs vs known-entities). Add if debugging traces surface "which phase blew the budget?" as a recurring question.
- Per-source memory attribution (which retrievers contributed). Add if memory retrieval debugging becomes a real pain point.
- Full skills-authorized / skills-available arrays. Large and noisy; add if silent-skill-authorization issues become a real failure mode.
- Granular sub-phase latencies. Add only if the consolidated latency proves insufficient for diagnosis.

### Where the code changes land

1. **Register the event** in `server/lib/tracing.ts` event registry.
2. **Fire the event** from `agentExecutionService.ts` at the end of the context-assembly phase. Single call site.
3. **Collect the fields** — all already exist as locals in the assembly code path. No refactoring required.
4. **Storage**: reuse the existing tracing sink. No new table.
5. **No UI in v1.** Goes to observability only. A debugging UI reading these events can follow in a later iteration.

### Relationship to existing telemetry

- **`fast_path_decisions`** (Universal Brief) — keep. Different phase (pre-dispatch), different question (which agent/scope). Complementary.
- **`agent_runs`** table — keep. Tracks run outcome (cost, tokens, status). `context.assembly.complete` tracks the setup, not the outcome.
- **`heartbeat.tick.gated`** (Rec 3) — different event, different stage. No overlap.

### Edge cases

1. **Assembly partially fails.** Memory retrieval timed out, beliefs couldn't load. Still emit the event with `gapFlags` populated and `latencyMs` reflecting what actually happened.
2. **No agent-loop runs.** Simple_reply paths from Universal Brief don't assemble agent-side context — no event emitted.
3. **Cost overhead.** Async emit, fire-and-forget. Target <5ms on the pre-loop path. Match the pattern already used in `fastPathDecisionLogger.ts`.
4. **PII.** Event records counts and totals, never bodies. Safe by construction.

### Success criteria

1. 100% of agent-loop runs emit exactly one `context.assembly.complete` event.
2. An operator debugging a failed run can answer "was the context budget exceeded? did memory retrieve anything?" in <30 seconds with a single query.
3. Event emit adds <5ms to the pre-loop latency (p95).
4. In the 2 weeks after shipping, we log any questions we couldn't answer from this minimal event — that log drives the v2 field list.

### What an external reviewer should push back on

- Is the minimal payload *too* minimal? If a recurring debugging question requires per-phase breakdown, the v2 expansion is free. But we're betting the consolidated shape is enough for most cases. Worth challenging.
- Should `gapFlags` be a strict enum, or free-form strings? Enum wins on query-ability; free-form wins on discoverability of new failure modes.
- Is `context.assembly.complete` the right event name, or should it follow a different convention already established in `server/lib/tracing.ts`? (Align during spec.)
- Does async emit genuinely hit <5ms, or does queue-depth tail risk hide latency spikes under load?

---

## 7. Recommendation 5 — Agent-decomposition heuristic (hygiene)

### Status: demoted

The external reviewer was right that this doesn't belong in a prioritised dev brief. Keeping it only because the doc edit is five minutes — cutting it entirely means the pattern gets lost when a future session proposes splitting or merging agents.

### The rule

Append to `docs/spec-authoring-checklist.md` under a new "Agent decomposition" heading:

> **Agent decomposition.** Agents that share context and have aligned goals should stay together. Divergent context or goals justify a split. Example: a Content agent handling YouTube, Instagram, TikTok shares both → keep together. A Customer Support agent has different context and different goals from Content → split. Cite this rule in any spec that proposes adding or splitting an agent.

### Success criterion

A future architect-agent invocation debating whether to split/merge finds the rule on its first read. That's it.

---

## 8. Skill-count ceiling — confirmation only

Riley claimed empirically that agents degrade above ~20 skills because they pick the wrong skill more often (7–20 sweet spot, steep drop-off above 20).

**Finding: no agent exceeds 20 post-gap.**

| Agent | Projected | Status |
|---|---|---|
| Ads Management | 17–19 | Closest to ceiling |
| Dev | 16–18 | Sweet spot |
| CRM & Pipeline, QA | 16 | Sweet spot |
| Content & SEO | 14–15 | Sweet spot |
| Others | 7–13 | Sweet spot |

**Recommendation: no action pre-launch.** If Ads Management regresses after the gap lands, mitigate via task-scoped skill visibility (filter the subset shown per task type) before splitting the agent. Don't pre-emptively split — Orchestrator routing complexity is not free.

Pushback welcome on whether "~20 skills" is a real ceiling or anecdote, but monitoring it costs nothing either way.

---

## 9. Build plan and sequencing

### Shared tracking

Build slug: `tasks/builds/riley-observations/` with one `progress.md` and child specs per non-trivial item. All PRs cite the slug so the wave is traceable as one coherent release.

### Order matters — the naming pass goes first

Unlike v1's sequencing, v2 frontloads the naming pass. Everything else in the brief references primitives by name (Workflow, Automation, run-mode enum values, schema column names). Doing the rename *before* specs for Rec 1, 3, 4 means those specs use the final vocabulary and the final column names — no post-merge rename churn on newly-written code.

### Five waves

**Wave 0 — Hygiene (1 PR, ~5 min)**

Rec 5. Append the agent-decomposition rule to `docs/spec-authoring-checklist.md`. No spec. Ships today.

**Wave 1 — Naming pass (1 PR, ~2–3 days including spec + implementation)**

Rec 2 as described in §4 — schema migration, types, routes, services, UI, docs, skills. Single coherent PR. Steps:

1. Draft `docs/naming-pass-spec.md` (on Opus) covering the three-step migration order, the flow-stack prerequisite rename, the mapping table, and the ripple zones.
2. `spec-reviewer` pass. Particularly looks for missed tables and missed user-facing strings.
3. `architect` → `tasks/builds/riley-observations/plan-naming-pass.md`.
4. **Plan gate** — human review, switch to Sonnet.
5. Execute in three commits on one branch, one per migration step (flow-stack rename, processes → automations, playbooks → workflows). Each commit is green (tests pass, types compile) before moving to the next.
6. `spec-conformance` → `pr-reviewer` → PR.
7. Coordinate landing: announce merge window, rebase in-flight branches immediately after merge using a scripted find-and-replace.

Why one PR instead of three: the intermediate states (flow stack renamed but processes not yet renamed; processes renamed but playbooks not yet) are *valid* but *confusing*. Landing them together means reviewers see the end state, not the intermediate mess.

**Wave 2 — Explore / Execute Mode (1 PR)**

Rec 1. After Wave 1 lands so the spec uses "Workflow" terminology natively.

- Draft `docs/explore-execute-mode-spec.md` (on Opus). Covers the mode enum, UI surfaces, default-on-Explore logic, promote-to-Execute flow, per-(user, agent, subaccount) persistence, and the edge-case matrix.
- `spec-reviewer` → `architect` → plan gate → Sonnet execution → `spec-conformance` → `pr-reviewer` → PR.
- Engineering estimate: 6–8 hours after plan approval (larger than v1's toggle because this is a mode system with defaults and promotion UX).

**Wave 3 — Telemetry (1 PR)**

Rec 4. Minimal event. Standard-class work — can skip architect if the tech-note is precise enough.

- Draft `docs/context-assembly-telemetry-spec.md` (lightweight tech-note).
- `spec-reviewer` → Sonnet execution → `pr-reviewer` → PR.
- Engineering estimate: 2 hours after spec approval.

**Wave 4 — Heartbeat activity-gate (1 PR)**

Rec 3. Ships last so Rec 4's telemetry is in place to measure skip-rate when we enable the gate on Portfolio Health Agent.

- Draft `docs/heartbeat-activity-gate-spec.md` (on Opus).
- `spec-reviewer` → `architect` → plan gate → Sonnet execution → `pr-reviewer` → PR.
- Engineering estimate: 3–4 hours after plan approval.

### Total effort estimate

| Wave | Spec | Engineering | Review |
|---|---|---|---|
| W0: Hygiene | — | 5min | — |
| W1: Naming pass | ~1d (draft + spec-review + plan) | ~1.5–2d | half-day |
| W2: Explore/Execute Mode | ~1d | 6–8h | 1h |
| W3: Telemetry | ~0.5d | 2h | 1h |
| W4: Heartbeat gate | ~1d | 3–4h | 1h |
| **Total** | ~3.5 days spec | ~3–4 days engineering | ~1 day review |

Calendar: roughly 1–1.5 weeks of focused work if specs and implementation sequence tightly. Longer if each spec goes through multiple spec-review rounds.

### Risks and mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Wave 1 breaks in-flight feature branches | Medium-High | Announce merge window. Provide a rebase script. Coordinate with any open PR owners. Pre-launch posture means the damage is contained. |
| Wave 1 misses a user-facing string (email template, portal, PDF export) | Medium | `spec-reviewer` pass specifically looks for server-rendered strings. Post-merge grep sweep in a follow-up PR if anything slips. |
| Wave 1 collides with active Drizzle schema generation or migrations in flight | Medium | Halt migration PRs during Wave 1's merge window. Resume after. |
| Explore Mode defaulting to on confuses experienced developers testing the app | Low | Agent config allows setting Execute as default. One-time inconvenience. |
| Heartbeat gate thresholds are wrong out of the box | Medium | Conservative defaults (delta=3, min-ticks=6). Tune after 2 weeks of real data. |
| Telemetry event payload grows between draft and ship | Low | v2 minimal payload is locked by design. Additions are a v2 change, not a v1 add. |
| Naming pass introduces subtle bugs in foreign-key constraints or triggers | Medium | `drizzle-kit introspect` diff against updated schema must be clean before merge. Integration tests cover the happy path for each renamed table. |

### Rollout posture

- **Wave 0 (hygiene)**: land on main, no flag.
- **Wave 1 (naming)**: land on main, no flag. Pre-launch means no flagging needed. One coordinated merge + rebase pass.
- **Wave 2 (Explore/Execute)**: land on main, no flag. The mode itself is the safety mechanism; no need for a feature flag on top of it.
- **Wave 3 (telemetry)**: always on. Observability shouldn't be flagged.
- **Wave 4 (heartbeat gate)**: ship with `heartbeat_activity_gate_enabled` defaulting to `false`. Enable on Portfolio Health Agent manually for a monitored rollout.

---

## 10. What we deliberately aren't building in this wave

The external reviewer's strongest structural critique: the brief optimises mechanics (safety, efficiency, observability), not outcomes (time-to-first-win, guided onboarding, outcome-first UX). That critique is **correct**, and this section exists to acknowledge it without letting it swamp the current wave.

### The gap

A new GHL agency owner signing up today lands on a product that asks them to:

1. Configure agents
2. Configure skills
3. Configure Playbooks (after Wave 1: Workflows)
4. Connect Automations
5. ...eventually run something
6. ...eventually see output

The path from signup → first visible value is measured in hours or days, not minutes. Every primitive in the sidebar is a system concept (agents, skills, workflows), not an outcome concept (leads captured, campaigns launched, revenue reported).

The reviewer's recommendation (paraphrased):

> *Turn Automation OS into a system that immediately produces results, not just executes tasks.*

Candidate changes in that direction:

- **Pre-built starter workflows** tied to concrete agency outcomes (lead qualification, pipeline reporting, creative review)
- **Guided first run** — new-user onboarding routes them into a single pre-built workflow, runs it for them in Explore Mode, surfaces the output
- **Outcome-first sidebar** — reframe navigation from agents/skills/workflows to leads/campaigns/revenue/insights
- **"What did my AI team do today?" digest** — daily portfolio summary as a default, not an opt-in
- **Clear system modes** — not just Explore/Execute on a run, but an overall agency-wide posture (onboarding mode vs. fully-trusted mode)

### Why it's not in this wave

1. **Scope.** Each of those items is a product initiative, not an implementation ticket. Fusing them into the Riley-observations wave would turn a tactical sweep into a roadmap rewrite.
2. **Dependencies.** Pre-built starter workflows are only useful if the Workflow primitive is stable. That's Wave 1 of this brief. Outcome-first UX is only meaningful if Workflows and Automations are clearly differentiated — also Wave 1.
3. **Sequencing honesty.** Shipping the current wave correctly (rename, Explore Mode, telemetry, heartbeat gate) *is* the precondition for the outcome-first work that follows. Doing Wave 1–4 right gives the next wave a clean foundation.
4. **Risk management.** We don't want to mix a 4-wave refinement pass with a product re-architecture in the same release cycle. Reviewer bandwidth is finite.

### What happens after this wave

The honest next-wave topic is *Time-to-First-Win*, not "more internal refinement." A separate brief should open on that topic once Waves 0–4 ship. Candidate scope for that future brief:

- Audit the new-user journey end-to-end
- Propose starter-workflow library with 3–5 opinionated defaults
- Redesign the sidebar around outcomes
- Build guided-first-run onboarding

Nothing in the current wave pre-commits that future scope. But the current wave removes the naming debt and safety-UX gaps that would otherwise block it.

### Reviewer-facing acknowledgement

You were right that this brief optimises mechanics. This section exists so the decision is explicit, not implicit. If the reviewer pushes back that we should still cut something from this wave to start on outcomes immediately, the honest answer is: Wave 1 (naming) is genuinely load-bearing for anything outcome-first that follows. We can't market "prebuilt Workflows" when the UI still says "Playbooks" and the schema still has three overlapping workflow namespaces.

---

## 11. Open questions for external review

Reduced set, focused on where v2's reviewer-reconciliation pass still leaves ambiguity.

### Rec 1 — Explore / Execute Mode

1. **Naming.** Is "Explore / Execute" the right pair? Alternatives: "Review / Run," "Preview / Run," "Safe / Live." One-word-each is cleaner than descriptive phrases — which pair lands best for a non-technical GHL agency owner?
2. **Mode persistence.** We proposed per-(user, agent, subaccount) persistence with reset on new subaccount. Is that the right granularity? Too granular (agencies with 100+ subaccounts may get annoyed resetting to Explore constantly) vs. not granular enough (a user who got burned on Sub-account B should still start safe on Sub-account C).
3. **Promote-to-Execute UX.** After N successful Explore runs, we prompt to promote. Does "N = 5" create a psychological trap where users click through without reading, then are surprised when actions auto-execute? Worth exploring harder confirmation or time-windowed trust decay.

### Rec 2 — Naming pass

4. **Flow-stack rename.** Is `flow_runs` / `flow_step_outputs` / `canonicalFlowDefinitions` the right target for the displaced internal stack, or should it be named after what it *does* (`action_runs`? `integration_scan_runs`?) rather than what it *is* (a "flow")? The stack is used by `actionService.ts` and `scanIntegrationFingerprintsService.ts`, so a usage-based name might be clearer. Worth external push.
5. **Single PR vs. three.** We proposed landing all three migration steps in one PR to avoid confusing intermediate states. Alternative: three sequential PRs, each green, each deployable. One-PR wins on reviewer clarity; three-PR wins on rollback granularity. Which matters more here?
6. **Opportunistic cleanup.** `TasksPage.tsx` → `AutomationsPage.tsx` (the component file that lies about what it renders) and similar historical misnamings — sweep in the same pass, or defer to a hygiene follow-up PR?
7. **Missed user-facing strings.** Email templates, Slack messages, PDF exports, portal-facing markdown content. What's the right pre-merge audit? (Current plan: spec-reviewer runs a string sweep; post-merge grep validates nothing leaked.)

### Rec 3 — Heartbeat activity-gate

8. **Rule completeness.** We listed four rules (event-delta, time-threshold, explicit-trigger, state-flag). Missing rules we should add: recent user activity in subaccount, schedule changes, failed upstream jobs. Which are critical for v1 vs. nice-to-have for v2?
9. **Generalisation.** We made the gate a per-agent feature flag. Only Portfolio Health currently uses heartbeat. Should the abstraction live inside Portfolio Health, to be generalised only when a second agent asks for it?
10. **"Alive" badge.** Should skipped ticks drive a visible "last checked: 2 min ago, nothing changed" surface in the agent dashboard so operators see activity without seeing noise? Worth UI clutter, or cruft?

### Rec 4 — Telemetry

11. **Minimal payload risk.** We trimmed aggressively to avoid over-design. Is there a specific field we already know we'll need (e.g., per-memory-source attribution) that should be in v1 rather than deferred? The v2 expansion is cheap but skipping a field we clearly need slows debugging in the first 2 weeks of data.
12. **Event vs. `agent_runs` column.** Tracing event now, dedicated column later? Or start by appending to `agent_runs` and extract to its own event only if we need cross-run aggregations?

### Structural

13. **What we're not building (§10).** Is our scope-deferral of time-to-first-win honest, or is it procrastination? If the reviewer thinks we should cut Rec 3 or Rec 4 from this wave to start on outcomes immediately, what's the specific item they'd cut?
14. **Sequencing.** We put naming pass first (Wave 1) because everything else references its vocabulary. Alternative: ship Rec 1 (Explore/Execute) first because it's the highest user-visible value, then rename later. Which is right?
15. **Is there a recommendation we should add that we missed?** Most valuable feedback of all.

### What we are NOT asking

- Implementation details (language, file organisation, test strategy). Architect territory after spec lands.
- Whether OpenClaw-as-substrate is worth building — addressed in `docs/openclaw-strategic-analysis.md`.
- Whether AI agents are a real category — past that conversation.

### How to respond

- Short answers per numbered question.
- Flag framing errors, not just answer disagreements.
- If something should be cut from this wave, say so directly.
- If we missed a recommendation entirely, that's the most valuable thing you can tell us.

---

_End of brief (v2)._
