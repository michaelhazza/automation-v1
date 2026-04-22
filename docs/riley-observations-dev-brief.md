# Riley Observations — Dev Brief

_Date: 2026-04-22_
_Status: draft for external review_
_Related: `docs/openclaw-strategic-analysis.md` (2026-04-18)_

---

## TL;DR

A mainstream AI-agent explainer video (Riley Brown, "OpenClaw workflows for non-technical users") surfaced five tactical observations worth testing against Automation OS. We ran the analysis twice across independent branches and reconciled the results. **Three observations are real gaps worth shipping; one is a lightweight doc edit; one is confirmation only.**

This brief is written to be read cold by someone who does not have the repo open. It includes enough codebase context that an external LLM can pushback on the recommendations. Nothing here has been built yet — we want external review before committing to the scope.

**The five proposed changes, in priority order:**

| # | Change | Why | Effort | Type |
|---|---|---|---|---|
| 1 | **Dry-run / sandbox mode** on agent and Playbook runs | Non-technical agency owners have no user-visible "try safely" affordance — they run against live data and trust the review queue to catch mistakes. Closes the #1 onboarding failure mode. | ~2h after spec | UX + small backend |
| 2 | **Rename "Playbook" → "Workflow"** in user-visible UI strings only | "Playbook" is friendly jargon; GHL agency owners recognise "Workflow" from Zapier / Make / HighLevel. ~6 user-visible strings. Internals (types, tables, API routes, skills) stay as `playbook`. | ~1h | UI strings |
| 3 | **Heartbeat decision-step** before Portfolio Health Agent dispatches its 4-hourly tick | Current heartbeat is schedule-driven — it runs every 4h regardless of whether anything changed, paying full LLM cost on every tick. Add a cheap pre-check that can skip the tick if there's no signal. Reuses existing agent-decision-step primitive. | ~4h after spec | Backend + config |
| 4 | **`context.assembly.complete` telemetry event** emitted from `agentExecutionService.ts` after context injection, before the agent loop starts | Today we can't answer "why did this run fail — bad prompt or missing context?" post-hoc. Context assembly is a real phase in code but has no named trace event. | ~3h | Backend telemetry |
| 5 | **"Agent decomposition" rule** in `docs/spec-authoring-checklist.md` | Codifies a heuristic the v6 agent roster already follows: *"Agents that share context and have aligned goals stay together; divergent context or goals justify a split."* | ~5min | Docs |

**Non-actions:**
- **Skill-count ceiling (~20 per agent):** after the 41 queued skills land, no agent exceeds 20. Ads Management projects 17–19 (depending on which merges we apply). No action required; revisit only if Ads Agent regresses in production.

**Total effort:** ~10 hours of engineering + 5 minutes of doc + spec drafting time.

**Nothing in this brief requires an architectural change.** Every recommendation is strings, flags, one event, one config field, or one doc edit. If any of the five looks like it's growing teeth during the spec phase, that's a signal we've misread the scope — escalate before building.

---

## Contents

1. [Background and provenance](#1-background-and-provenance)
2. [Codebase primer — what you need to know](#2-codebase-primer--what-you-need-to-know)
3. [Recommendation 1 — Dry-run / sandbox mode](#3-recommendation-1--dry-run--sandbox-mode)
4. [Recommendation 2 — Playbook → Workflow rename](#4-recommendation-2--playbook--workflow-rename)
5. [Recommendation 3 — Heartbeat decision-step](#5-recommendation-3--heartbeat-decision-step)
6. [Recommendation 4 — Context-assembly telemetry](#6-recommendation-4--context-assembly-telemetry)
7. [Recommendation 5 — Agent-decomposition heuristic](#7-recommendation-5--agent-decomposition-heuristic)
8. [Skill-count ceiling — confirmation only](#8-skill-count-ceiling--confirmation-only)
9. [Build plan and sequencing](#9-build-plan-and-sequencing)
10. [Open questions for external review](#10-open-questions-for-external-review)

---

## 1. Background and provenance

### Where this came from

A mainstream creator-audience YouTube explainer — Riley Brown, creator of a self-hostable agent runtime called "OpenClaw" — walked through agent workflows for non-technical users. The framing is pitched at solo operators and small agencies, not engineers, which makes it directly relevant to Automation OS's core buyer: **GoHighLevel (GHL) agency owners running a handful to a hundred sub-accounts**.

We already have a detailed strategic analysis of the OpenClaw category at `docs/openclaw-strategic-analysis.md` (2026-04-18). That document covers the big structural angles: cost narrative ("you saved $X vs API pricing"), substrate adapter, IEE delegation-lifecycle stability, progressive Simple / Advanced / Raw abstraction for power users. **This brief is an addendum, not a replacement** — it captures five narrower tactical observations the strategic doc didn't cover.

### How the observations were derived

We ran two independent analyses on separate branches against the same transcript, then reconciled. Disagreements were resolved by grounding in the actual codebase:

- **Branch A** initially said "heartbeat fully implemented, no action needed" — wrong. The heartbeat runs every 4 hours unconditionally; it doesn't evaluate state and decide to skip.
- **Branch A** initially said "don't rename Playbook, touches 215 files" — wrong about scope. The user-visible surface is ~6 strings; the 215 number was total references (types, tables, API routes, skills — all of which stay untouched).
- **Branch A** said "context engineering already covered by Universal Brief" — partially wrong. Universal Brief's `fast_path_decisions` telemetry covers *routing* (which agent, which scope); it does not cover the agent-side *context assembly* (briefing + beliefs + memory blocks + workspace memory) that happens in `agentExecutionService.ts` before the agent loop starts. Those are two different phases.
- **Branch B** caught all three refinements and the consolidated brief reflects its framing.

Skill-count numbers differed between branches (Branch A: 19 for Ads Management; Branch B: 17). Both land on "no action," so the discrepancy is non-blocking.

### What's explicitly out of scope

- OpenClaw as an execution substrate. Already addressed in the strategic analysis doc.
- Agent delegation lifecycle fixes. Already the biggest liability flagged in the strategic analysis; separate workstream.
- Progressive Simple / Advanced / Raw abstraction. Separate workstream.
- Cost-transparency UI surface ("$X saved vs API pricing"). Marketing-adjacent, separate scope.
- Memory-block retrieval (Phase 8 of Universal Brief). Already specced, in flight.

### Who this brief is for

1. **External LLM reviewer** — you. Critique the recommendations. We are specifically looking for: flaws in the proposed designs, simpler ways to achieve the same outcome, places where we've misread the existing codebase, and items that should be cut.
2. **Automation OS engineering team** — will execute after external review lands.
3. **Product / founder** — final sequencing decision.

---

## 2. Codebase primer — what you need to know

External reviewers often push back on proposals without full context on the existing system. This section establishes the shared vocabulary.

### 2.1 What Automation OS is

A multi-tenant backend + client application that runs AI agents on behalf of marketing agencies managing many GoHighLevel sub-accounts. Agencies are the customer; GHL sub-accounts are the tenants-of-tenants. The three layers relevant to this brief:

1. **Orchestrator and agents**. 15+ system-defined agents (Dev, QA, Ads Management, CRM & Pipeline, Portfolio Health, etc.) each scoped to a capability area. A capability-aware Orchestrator (`server/jobs/orchestratorFromTaskJob.ts`, `docs/orchestrator-capability-routing-spec.md`) receives tasks and routes them to the right agent or delegates to a Configuration Assistant if a capability is missing.
2. **Skills**. ~152 markdown files in `server/skills/` plus per-company overrides in `companies/*/skills/`. Each skill is a bounded capability an agent can invoke. Skills are **statically bound to agents** via YAML frontmatter in `companies/automation-os/agents/{slug}/AGENTS.md`. They are *not* pooled across all agents — each agent sees only its assigned subset.
3. **Playbooks**. A higher-level primitive than a single agent run — a user-defined, schedulable workflow with ordered steps, gates, inputs, and outputs (`docs/playbooks-spec.md`, `server/services/playbookStudioService.ts`). Can run on a cron or on-demand. Implemented as TypeScript `.playbook.ts` definitions plus a pg-boss DAG at execution time.

### 2.2 The execution loop

When a task is dispatched to an agent, the flow is:

1. **Fast-path triage** (Universal Brief, `server/services/briefCreationService.ts`, `server/services/chatTriageClassifier.ts`). A two-layer classifier (heuristic tier 1 + Haiku LLM tier 2) decides whether to handle the task inline (`simple_reply`, `cheap_answer`), ask for clarification, or escalate to the Orchestrator. Every decision is logged to a `fast_path_decisions` table for shadow-eval.
2. **Orchestrator routing** (if the fast-path escalates). The Orchestrator inspects available capabilities and either dispatches directly, asks a clarifying sub-call, or routes to the Configuration Assistant.
3. **Agent execution** (`server/services/agentExecutionService.ts`). Context is assembled: briefing + beliefs + memory blocks (with `memoryBlockRetrievalServicePure.ts` precedence: subaccount > agent > org) + workspace memory (via `workspaceMemoryService.getMemoryForPrompt`, which does hybrid vector + keyword + HyDE + RRF retrieval) + known entities. This is injected **once, before the agent loop starts** — it is not re-fetched mid-loop.
4. **The agent loop**. Model + tools + skill invocations, running until the agent decides it's done or hits a gate.

### 2.3 HITL gates — the existing safety model

Every skill declares a `defaultGateLevel`: `auto` (runs immediately), `review` (creates a review item; human must approve before execution), or `block` (never runs, not even with approval — typically reserved for irreversible destructive actions).

Gate levels can be overridden at the agent level, sub-account level, or per-run. There's also a **Supervised mode** toggle on the Playbook Run modal (`client/src/components/PlaybookRunModal.tsx:339–344`) that forces a pause before every side-effecting step regardless of declared gate level.

**Critical for this brief:** Supervised mode still runs against live data — it just asks for approval first. There is no "run this but don't touch anything real" primitive today. The closest thing is a `playbook_simulate` skill that does **static analysis only** (step count, parallelism, critical path, reversible/irreversible counts) and is **system-admin only** via the Playbook Studio page.

### 2.4 Heartbeat

Portfolio Health Agent has proactive-wake infrastructure that most competitors don't have:

- Per-agent config: `agents.heartbeatEnabled`, `agents.heartbeatIntervalHours` (migrated in `migrations/0068_portfolio_health_agent_seed.sql`)
- Per-subaccount override: `subaccount_agents.heartbeatEnabled/Interval/Offset`
- Registered into pg-boss via `server/services/agentScheduleService.ts`
- Projected for UI via `server/services/scheduleCalendarService.ts`
- User-facing toggle at `client/src/pages/AdminAgentEditPage.tsx:1422`

**But** — when the tick fires, the agent runs unconditionally. It reads state and decides *what to surface*, but it does not decide *whether to run at all*. This is the gap Recommendation 3 addresses.

### 2.5 Existing primitives this brief reuses

| Primitive | File | What it does |
|---|---|---|
| HITL gate resolution | `server/services/agentExecutionService.ts` | Resolves effective gate level for a skill given agent + subaccount + run overrides |
| Review queue | Existing review-item UI + backend | Collects pending-approval actions, routes to approvers |
| Supervised mode | `PlaybookRunModal.tsx`, `runMode: 'supervised' \| 'auto'` | Forces pause before each side-effecting step |
| Simulate | `server/skills/playbook_simulate.md`, `/api/system/playbook-studio/simulate` | Static analysis, admin-only |
| Agent decision-step | `docs/playbook-agent-decision-step-spec.md` | Primitive for "evaluate state, decide which branch to take" mid-Playbook |
| Tracing registry | `server/lib/tracing.ts` | Named event emitter for structured observability |
| Fast-path telemetry | `fast_path_decisions` table, `fastPathDecisionLogger.ts` | Shadow-eval logging for Universal Brief classifier |
| Workspace memory | `workspaceMemoryService.getMemoryForPrompt` | Hybrid retrieval; append-only log |

Every recommendation in this brief uses one or more of these. None of them introduce a new subsystem.

### 2.6 Things that may surprise an external reviewer

- **Agents are not pooled.** Each agent only sees its assigned skills. The "152 skills total" figure is cross-agent; no agent has 152 skills resolvable at runtime. The max is Ads Management at ~17–19 depending on which gap-analysis merges we apply.
- **"Playbook" ≠ "Workflow"** in the current UI. "Workflows" is taken — it's the name of a separate primitive for agent-chain processes (`client/src/components/Layout.tsx:74,702`). This is why Recommendation 2's rename needs care: we'd be renaming "Playbook" → "Workflow" *in user-visible strings*, and the existing "Workflows" primitive would need a distinguishing name. See §4 for how we resolve this.
- **Fast-path telemetry ≠ context-assembly telemetry.** Universal Brief logs classification decisions (which agent/scope). `agentExecutionService.ts` assembles run context (briefing + beliefs + memory) but emits no named event. These are different phases. Recommendation 4 adds the missing one.
- **Heartbeat is real, not a roadmap item.** Portfolio Health Agent ticks every 4h in production. The Recommendation 3 proposal is a refinement of an existing mechanism, not a greenfield build.

---

## 3. Recommendation 1 — Dry-run / sandbox mode

### Problem

The video's single most repeated refrain from Riley's non-technical audience: *"I ran the agent against my real Notion / real Gmail / real CRM and it did something I didn't want."* His workaround is to manually duplicate databases, create dummy email accounts, and point test runs at the duplicates.

Automation OS has stronger safeguards architecturally — HITL gates (`auto` / `review` / `block`), Supervised mode, per-action gate overrides — but **none of them are surfaced as a single user-visible "try this safely" affordance**. A non-technical agency owner configures an agent, hits Run, and trusts the review queue to catch mistakes. They have to learn the gate model to feel safe.

Grepping for the words a user might look for yields zero hits in user-facing surfaces:

- `client/src/**/*.tsx` — no results for `dry.run`, `sandbox`, `test.mode`, `preview`.
- `Simulate` exists but is at `client/src/pages/PlaybookStudioPage.tsx:210–212`, admin-only, and does *static analysis only* — it does not simulate execution, does not touch data, does not invoke the model. It tells you "this Playbook has 7 steps, 3 irreversible, max parallelism 2" and nothing more.

### Recommendation

Add a **Dry run** toggle visible to every user on both surfaces where an agent or Playbook is launched:

- `client/src/pages/AgentChatPage.tsx` (single-agent conversational run)
- `client/src/components/PlaybookRunModal.tsx` (multi-step Playbook run; the toggle sits alongside the existing Supervised-mode checkbox at line 339–344)

**Semantics when enabled for a run:**

1. All skills with side effects (anything declaring `defaultGateLevel: 'auto'` where the action mutates external state — email send, CRM write, ad-spend change, Notion update, etc.) are overridden to `gateLevel: 'review'` *for that run only*. No change is persisted to agent/sub-account config.
2. Skills declaring `defaultGateLevel: 'block'` stay blocked. Dry run cannot bypass explicit blocks.
3. The run surface banners the session: *"Dry run — all actions paused for approval. Nothing will happen until you approve."*
4. Approvals during a Dry run can still execute — the user can approve item-by-item if they want. Dry run is not "nothing executes"; it's "everything asks first, regardless of what the skill default would have said."
5. The run is tagged `isDryRun: true` in the run record so it's visible in history.

**Why this exact shape:**

- Reuses existing gate resolution (`agentExecutionService.ts`) — one override in the resolver.
- Reuses existing review queue — no new UI surface for approvals.
- Doesn't require a parallel "sandbox" execution environment. Real systems with real credentials, just paused-by-default.
- The ambiguity Riley's audience hits is "will this thing email my client without asking?" — `review`-everything answers that directly.
- Can be delivered as: one boolean on the run request, one branch in gate resolution, one UI toggle, one banner, one run-record column. No new tables.

### Why not a true sandbox (duplicated data, isolated environment)?

Because it's massively more work and the value is marginal. A real sandbox needs:
- Copies of every integration's state (GHL sub-account duplication, separate Notion workspace, test Gmail, etc.)
- Synthetic data generation
- A mapping layer so the agent's "Notion DB X" in sandbox points to the shadow DB
- Teardown logic
- User-facing UI for sandbox lifecycle

The value delta over "force review on everything" is the ability to let destructive actions actually execute to see what they'd do. For 95% of the Riley-audience concern (*"did the agent do something I didn't want?"*), review-before-execute solves it. The 5% where you genuinely want to see destructive output without consequences is better served by skill-level unit tests, not a product surface.

### Edge cases

1. **Already-supervised runs.** Dry run ⊃ Supervised. If both are checked, Dry run wins silently — don't create a matrix of modes. Product copy should say "Dry run includes supervised behaviour plus overrides auto-gated actions."
2. **Read-only skills.** Read skills (`list_deals`, `get_campaign_stats`) should run without pausing — pausing them creates review-queue noise with zero safety value. Criterion for "read-only" is the skill's declared `sideEffects: 'none'` (or equivalent frontmatter flag — we may need to audit). Note for the spec: decide whether to use declared flag, or fall back to name heuristic `read_*` / `list_*` / `get_*`.
3. **Skills that chain.** If skill A writes state and skill B reads the result, forcing A to `review` means B blocks until A is approved. This is correct behaviour for Dry run, but the UX needs to make it obvious why the run is paused mid-loop. The existing review queue UI should handle this; worth spot-checking during the spec.
4. **Playbooks with decision steps.** If a decision step branches on the output of a side-effecting skill, Dry run will pause the side-effecting skill. When approved, the decision step resumes. Same pattern — no special case.
5. **Dry run + cron-scheduled runs.** A scheduled Playbook run cannot be Dry run — it would just pile up review-queue items nobody looks at. Dry run is interactive-only. Scheduled runs use the existing gate config.

### Success criteria

1. A first-time user can launch a new agent, hit Dry run, converse with it about a task that would write to their CRM, and see every write action pending approval with a one-line preview of what it would do — without ever reading docs about gates.
2. Product analytics show ≥30% of first-week agent runs from new agencies toggling Dry run at least once. (If the number is <10%, we failed at discoverability.)
3. Zero production incidents filed as "agent did thing I didn't expect" from sub-accounts onboarded after Dry run ships. (Baseline: whatever the current rate is — needs instrumentation.)

### What an external reviewer should push back on

- Is "force everything to `review`" actually what users want, or do they want "nothing executes, show me the sequence it would have run"? The latter requires more work (mocking skill outputs) but is a cleaner mental model.
- Should Dry run default ON for the first N runs of a newly-configured agent? (Our instinct: yes, but it adds complexity — worth debating.)
- Is `AgentChatPage.tsx` the right entry point, or should the toggle live on the agent config page so it's set-and-forget per agent?
- Is there a legal / compliance concern with calling it "Dry run" when actions *can* execute after approval? "Review mode" might be more honest.

---

## 4. Recommendation 2 — Playbook → Workflow rename

### Problem

"Playbook" is friendly jargon. Our core buyer (GHL agency owners) has seen "Workflow" in Zapier, Make, n8n, and inside HighLevel itself. When they hit our sidebar and see "Playbooks," they pause. Micro-friction at first touch — not a blocker, but cumulative across onboarding.

### Important wrinkle: "Workflows" is already taken

The name "Workflows" is currently used in the nav at `client/src/components/Layout.tsx:74,702,810,826` for a separate primitive — agent-chain processes. This is the biggest risk on this recommendation and the reason it deserves careful scoping rather than a blind find-and-replace.

Two options:

**Option A — Reclaim "Workflow" for Playbooks, rename the existing "Workflows" feature.**
The existing "Workflows" surface is internal-facing agent-chain authoring, used by a much smaller audience than Playbooks. Rename it to "Processes" or "Agent chains" in UI. Playbooks become the customer-facing "Workflow." This is the cleaner long-term outcome but requires two renames instead of one.

**Option B — Rename Playbook → "Routine" or "Automation" instead.**
Sidesteps the collision entirely. "Automation" aligns with marketing vocabulary and is also recognised from Zapier/Make. "Routine" is closer to Claude Code / OpenAI's emerging vocabulary for scheduled agent work. Either avoids the Workflows collision.

**Recommendation:** Option A if we believe the existing "Workflows" primitive is minor enough to rename with little cost. Option B ("Automation") otherwise. Do not attempt this rename without resolving the collision first — a half-renamed UI where "Workflows" and "Workflow" mean different things is worse than "Playbook."

### Scope of the rename (user-visible strings only)

Regardless of which name we pick, the internal vocabulary stays `playbook` — types, DB tables, API routes, skills, file names. This keeps the PR mechanically small and avoids any API-compat break for integrations.

Known user-visible touchpoints (audit before implementation):

| File | Line(s) | Current string | Notes |
|---|---|---|---|
| `client/src/components/Layout.tsx` | 705 | "Playbooks" (sidebar nav label) | First impression |
| `client/src/components/Layout.tsx` | 825 | "Playbook Studio" (admin nav) | Admin-facing, can arguably keep |
| `client/src/pages/PlaybooksLibraryPage.tsx` | 113, 122, 132 | "Playbooks" (page heading, breadcrumb) | |
| `client/src/pages/PlaybooksLibraryPage.tsx` | 139 | "No playbook templates available yet" | Empty state |
| `client/src/pages/PortalPage.tsx` | 192 | "Playbooks" (portal section card) | Customer-visible in portal |
| `client/src/components/PlaybookRunModal.tsx` | 209, 346 | "Run playbook" (button label, helper text) | |
| `client/src/pages/AdminSubaccountDetailPage.tsx` | 1364–1365 | "About onboarding playbooks" | Admin page |
| Any schedule-calendar badge strings | — | "Playbook: X" | Audit during spec |

**Estimate:** ~6–10 user-visible strings once the Studio / admin surfaces are decided. The audit during spec may surface 2–3 more.

### What does NOT change

- Database columns, tables, foreign keys: stay `playbook_*`
- TypeScript types: `Playbook`, `PlaybookRun`, `PlaybookTemplate`, etc.
- File names: `*.playbook.ts`, `playbook_simulate.md`, `playbookStudioService.ts`
- API routes: `/api/playbooks/*`, `/api/system/playbook-studio/*`
- Skill names in `server/skills/`: `playbook_validate`, `playbook_simulate`, etc.
- Any doc, spec, or review log referring to the primitive (these are engineering artefacts, not customer-facing)
- The Playbook Studio page name — this is admin/developer surface; renaming it adds confusion for internal reviewers without user-facing benefit

### Why NOT rename internally too

- Ripples into ~2,000+ references across server/client/docs
- Breaks any third-party integration hitting the API
- Breaks every in-flight branch and open PR referencing `playbook_*`
- Zero user-visible benefit

### Edge cases

1. **Portal page Playbook card.** Customer-visible in their own portal. Rename here is the single highest-impact string.
2. **Email notifications, Slack messages, digest outputs.** Audit for "Playbook" in any user-facing copy generated server-side (e.g. `"Your playbook 'X' finished running"`). Rename strings in shared email templates and message formatters. This is easy to miss in a client-only grep.
3. **Schedule calendar.** The calendar UI shows upcoming Playbook runs; badge strings must match.
4. **Help / docs site.** Any external-facing docs (if they exist) need updating to match. Flag during spec.

### Success criteria

1. Zero remaining user-visible strings say "Playbook" (or "playbook"). A grep of client/src + email templates + portal surfaces for the word returns only internal comments / type references.
2. A new GHL agency owner onboarded after the rename doesn't ask what a Playbook is during onboarding (baseline: they ask now — anecdotal).
3. The collision with the old "Workflows" primitive is resolved (either renamed in Option A, or avoided by choosing a non-colliding name in Option B).

### What an external reviewer should push back on

- Is the Workflows / Workflow collision worth the churn? Maybe "Automation" or "Routine" is the right call without reclaiming "Workflow" at all.
- Is ~6 strings actually the right number? We may have missed surfaces — worth a fresh grep during the spec.
- Does HighLevel itself use "Workflow" for something specific? If yes, we want to either align (so agency owners see the same word in both tools) or deliberately differentiate.
- Is the rename worth doing alone, or should it ship bundled with a broader onboarding revamp so the change lands with context rather than as a surprise in the next deploy?

---

## 5. Recommendation 3 — Heartbeat decision-step

### Problem

Riley's OpenClaw "Heartbeat" primitive: the agent wakes every N minutes, evaluates state, and **decides whether to do anything at all**. It can skip the tick entirely if nothing has changed.

Automation OS has heartbeat infrastructure (Portfolio Health Agent wakes every 4h — see §2.4), but the agent runs unconditionally each tick. It pays the full LLM cost of loading context, inspecting state, and generating a report even when nothing relevant has changed across the portfolio. At N sub-accounts per agency × M agencies × 6 ticks/day, this is meaningful waste.

More importantly: the agent currently cannot say *"nothing to report this cycle"* without going through the full reasoning loop to get there. It will always produce output, even if that output is a report saying nothing changed. That's not how a good human operator would behave — they'd glance, confirm nothing's changed, and go back to work.

### Recommendation

Add an optional pre-dispatch **decision-step** for any agent with `heartbeatEnabled: true`. The decision-step is a cheap (Haiku-class or deterministic) check that answers a single question: *"Is there enough signal to justify a full run?"*

**Flow:**

1. Heartbeat tick fires (pg-boss cron, unchanged).
2. Before dispatching to the full agent loop, run the decision-step:
   - Input: a bounded context window — metrics delta since last run, count of new entities/events, any explicit user-requested checks, time since last meaningful output.
   - Output: `{ act: true | false, confidence: number, reasoning: string }`
3. If `act: false && confidence >= threshold`:
   - Skip the full dispatch.
   - Append a `heartbeat_skipped_no_signal` entry to workspace memory with reasoning.
   - Optionally emit a trace event so we can audit skip-rate during tuning.
4. If `act: true` OR confidence below threshold:
   - Dispatch the full run as today.
   - (Low confidence → run anyway. Bias toward running; skipping is only safe when the decision-step is confident.)

**Reuse existing primitive:** `docs/playbook-agent-decision-step-spec.md` already defines a decision-step pattern used mid-Playbook to branch execution. Same shape, different position in the flow. Implementation is a wiring exercise, not a new design.

### Schema changes

One column on `agents`:
- `heartbeat_decision_step_enabled: boolean DEFAULT false`
- `heartbeat_decision_threshold: numeric DEFAULT 0.7` (minimum confidence required to skip)

Same columns available at `subaccount_agents` level for override, matching the existing `heartbeatEnabled` / `heartbeatIntervalHours` / `heartbeatOffset` pattern.

No migration on `agent_runs` needed — we don't create a run record for skipped ticks. The skip is logged to workspace memory and optionally to the tracing event registry, not to the run history table (we don't want skipped ticks polluting run analytics).

### Where the code changes land

1. **Config schema**: migration adding the two columns on `agents` + `subaccount_agents`.
2. **Admin UI**: `client/src/pages/AdminAgentEditPage.tsx` — add a second toggle under the existing heartbeat toggle at line 1422, "Skip ticks when no signal detected," and a threshold input. System-admin only; not exposed to agency admins in v1.
3. **Execution hook**: `server/services/agentExecutionService.ts` — wrap the heartbeat-originated dispatch path in a decision-step call. Heartbeat dispatches already go through a distinct entry point (scheduleCalendarService + agentScheduleService pg-boss handler); adding the pre-check here does not touch user-initiated or Orchestrator-initiated runs.
4. **Decision-step implementation**: new file or extension to the existing `playbook-agent-decision-step-spec.md` implementation. Haiku-tier prompt, narrow context window, strict JSON output schema.
5. **Workspace memory entry format**: define a structured `heartbeat_skipped_no_signal` entry shape so future sessions can inspect skip reasoning.
6. **Observability**: emit a trace event `heartbeat.tick.decided` with `{agentId, subaccountId, decision, confidence, reasoning, latencyMs}`. Needed for tuning the threshold post-launch.

### Default threshold and rollout posture

- Ship with the feature **off by default** (`heartbeat_decision_step_enabled: false`). Opt-in per agent.
- Enable on Portfolio Health Agent first, with a conservative threshold (0.85) so we skip rarely.
- Monitor skip rate + false-skip complaints for 2 weeks before broader rollout or threshold relaxation.
- Provide a "replay skipped ticks" audit surface so an operator can see what the agent decided to skip and why — critical for trust.

### Edge cases

1. **Decision-step itself fails.** Network error, LLM timeout, JSON parse error. **Default: run the tick as today.** Never skip on error. The decision-step is an optimisation; safety posture is "when in doubt, run."
2. **Manual override.** A user wanting to force a tick (e.g., "something happened, check now") bypasses the decision-step. Reuse the existing manual-run path.
3. **First tick after enable.** No prior-tick context to delta against. Always run the first tick after enabling.
4. **Workspace-memory flooding.** If we skip 5 ticks/day and log all of them, workspace memory fills with noise. Mitigation: log only when the skip reasoning is *interesting* (state changed but below threshold) — not when literally nothing has changed. Or: retain skip entries for 14 days then prune.
5. **Threshold drift.** The "right" threshold depends on how noisy the input signals are per sub-account. Portfolio Health Agent across a quiet agency may need 0.9; a busy agency may need 0.6. Worth making the threshold per-subaccount-overridable from day one.

### Success criteria

1. Portfolio Health Agent skip rate lands in the 20–60% range after 2 weeks of tuning. If <10%, the decision-step isn't helping. If >80%, we're missing real signal.
2. Zero incidents where an operator complained "the agent didn't surface X" that can be traced to a skipped tick with low reasoning quality.
3. Average LLM cost per Portfolio Health Agent tick drops measurably (target: 40%+ reduction once skip rate stabilises).

### What an external reviewer should push back on

- Is the decision-step worth its own LLM call, or can the signal-detection be fully deterministic (delta counts, time thresholds, explicit trigger events)? A deterministic version is cheaper and more predictable but less flexible.
- Should skipped ticks still produce *something* — a heartbeat "I'm alive, nothing to report" entry — so the operator knows the agent is healthy? Silent skips may erode trust.
- Is confidence threshold the right tuning knob, or is it too abstract for operators? Alternative: a fixed "skip if <N events since last tick" rule.
- Does the Portfolio Health Agent use case generalise to other agents, or is this a one-off optimisation? If the former, the feature flag should live on the agent spec; if the latter, it's simpler to bake the logic into Portfolio Health directly.

---

## 6. Recommendation 4 — Context-assembly telemetry

### Problem

Riley's framing (borrowed from Andrej Karpathy): *"The job isn't prompt engineering, it's context engineering — assembling the right memory, skills, and tool access before the agent runs."*

Automation OS already does context engineering. The loop is (see §2.2):

1. Universal Brief fast-path triage classifies the request → `fast_path_decisions` table logs routing.
2. Orchestrator routes to an agent.
3. **`agentExecutionService.ts` assembles run context**: briefing + beliefs + memory blocks + workspace memory + known entities. Injected once, before the agent loop starts.
4. Agent loop runs.

**The gap is observability.** Step 3 emits no named trace event. Today, if a run produces bad output, we cannot answer:

- How saturated was the context window? (At 90% token budget, retrieval quality matters more.)
- Did memory retrieval succeed — and if so, how many memory blocks landed in the prompt? Which sources contributed?
- What skills were authorized and visible to the agent for this run? (An agent that silently lost access to a skill will behave mysteriously.)
- How long did context assembly take? (Memory retrieval is doing hybrid vector + keyword + HyDE + RRF; latency can spike.)
- Were there missing-context signals — gaps the assembler detected but couldn't fill?

Debugging currently requires reading logs, cross-referencing the run with memory retrieval logs, and inspecting the constructed prompt artefact manually. At scale, this becomes untenable.

### Recommendation

Emit a **single named telemetry event** — `context.assembly.complete` — from `agentExecutionService.ts` immediately after context injection and before the agent loop starts.

**Event shape:**

```typescript
{
  eventType: 'context.assembly.complete',
  runId: string,
  agentId: string,
  subaccountId: string | null,
  orgId: string,
  timestamp: ISO8601,
  latencyMs: number,          // total time assembling context
  tokens: {
    briefing: number,
    beliefs: number,
    memoryBlocks: number,
    workspaceMemory: number,
    knownEntities: number,
    systemPrompt: number,
    total: number,
    budget: number,           // model's context window
    pressure: number,         // total / budget, 0..1
  },
  memory: {
    blocksFetched: number,
    blocksIncluded: number,   // after precedence filtering
    sources: string[],        // which retrievers contributed
    retrievalLatencyMs: number,
  },
  skills: {
    authorized: string[],     // skill names the agent can invoke this run
    available: string[],      // all skills attached to the agent (superset)
    gatedReview: string[],    // overridden to review for this run (e.g. Dry run)
    gatedBlock: string[],     // blocked for this run
  },
  gaps: string[],              // context gaps the assembler detected
                               // e.g. 'no_workspace_memory', 'stale_beliefs', 'missing_integration'
}
```

### Where the code changes land

1. **Register the event** in `server/lib/tracing.ts` event registry.
2. **Fire the event** from `agentExecutionService.ts` at the end of the context-assembly phase, before the agent loop starts. Single call site.
3. **Collect the fields** — most already exist as locals in the assembly code path; a few (memory source list, gap signals) need to be surfaced from `memoryBlockRetrievalServicePure.ts` and the workspace-memory retrieval layer. Pass them up through the return value of each assembly helper.
4. **Storage**: reuse whatever storage the tracing registry already uses (likely the existing run-trace table or structured log sink). Do not add a new table.
5. **No UI in v1.** The event goes to observability only. A debugging UI that reads these events can follow in a later iteration.

### Why one event, not many

Granular per-phase events (memory.fetched, skills.authorized, beliefs.loaded, etc.) sound more thorough but create more noise than signal at typical run volumes. One consolidated event per run is:

- Easier to query (one event type, one row per run).
- Easier to correlate with the run record (`runId` joins to `agent_runs`).
- Cheaper to ship (one emit call).
- Sufficient for 95% of debugging questions.

If post-launch we find we need finer granularity, it's additive — we can break out phase-specific events later without rewriting the consolidated one.

### Relationship to existing telemetry

- **`fast_path_decisions`** (Universal Brief) — keep. Different phase (pre-dispatch), different question (which agent/scope). Complementary, not duplicative.
- **`agent_runs`** table — keep. Tracks run outcome (cost, tokens, status). `context.assembly.complete` tracks the setup, not the outcome.
- **Run-trace observability** (per `docs/memory-and-briefings-spec.md` and the run-trace tables added in earlier PRs) — `context.assembly.complete` slots in as one more trace event on an existing timeline.

### Edge cases

1. **Assembly partially fails.** Memory retrieval timed out, beliefs couldn't load. Still emit the event, with `gaps` populated and `latencyMs` reflecting the timeout. The event is about *what happened*, not *whether everything succeeded*.
2. **Assembly is trivial.** A simple_reply from Universal Brief may not assemble any agent-side context. Don't emit the event in that path — it's specifically for agent-loop runs.
3. **Cost overhead.** The event itself should be cheap (serialisation + write). If the tracing sink is synchronous and blocks the agent loop, that's a regression. Ensure async emit (fire-and-forget) with best-effort logging, matching the pattern in `fastPathDecisionLogger.ts`.
4. **PII in memory block content.** Do *not* log block bodies. Log counts, sources, and token totals only. Bodies stay in workspace memory.

### Success criteria

1. 100% of agent-loop runs (excluding Universal Brief simple_reply paths) emit exactly one `context.assembly.complete` event.
2. An operator debugging a failed run can answer "was context assembled correctly?" in <30 seconds by querying one event type. Baseline: today this takes multi-minute log archaeology.
3. Event emit adds <10ms to the pre-loop latency (p95). Async emit should make this trivial.

### What an external reviewer should push back on

- Is one consolidated event too coarse? Counterargument: start coarse, split if needed. We don't want to prematurely fragment.
- Are any of the listed fields not available cheaply? If gap-signal generation requires extra work in the assembler, maybe defer that field to v2.
- Should this event be append-only to the `agent_runs` row instead of its own event type? Cleaner join semantics, but couples the event to the run-record schema.
- Is the 10ms latency budget realistic, or does async emission hide a queue-depth tail risk under load?

---

## 7. Recommendation 5 — Agent-decomposition heuristic

### Problem

Riley articulated a clean rule for when to split agents vs. merge them: *"Shared context and aligned goals stay together; divergent context splits."*

Example: a Content agent handling YouTube, Instagram, and TikTok shares context and goals — keep them together. A Customer Support agent has different context from Content and different goals — split.

The v6 agent roster already follows this rule implicitly. Nobody wrote it down. The risk: a future session (human or agent) proposing a 16th agent doesn't have the rule to reason against, and proposes a split that should be a merge or vice versa.

### Recommendation

Append two sentences to `docs/spec-authoring-checklist.md`, under a new "Agent decomposition" heading:

> **Agent decomposition.** Agents that share context and have aligned goals should stay together. Divergent context or goals justify a split. Example: a Content agent handling YouTube, Instagram, TikTok shares both → keep together; a Customer Support agent has different context and different goals → split. Cite this rule in any spec that proposes adding or splitting an agent.

### Why so small

Because it is small. This is a trivial doc edit captured for future durability. It exists in this brief only so it doesn't get dropped — not because it needs a spec or a plan.

### Edge cases

None worth documenting. If the rule doesn't fit a specific proposal, the proposal owner explains why in the spec. Rules are guides, not laws.

### Success criteria

1. The rule is discoverable by the next session authoring an agent spec.
2. Future architect-agent invocations cite it when deciding splits/merges.

### What an external reviewer should push back on

- Is the rule too thin to be useful? Counterargument: the goal is capturing a pattern, not prescribing a process. A heavier rule would get ignored.
- Does "aligned goals" need a harder definition? Possibly — but we'd rather see it get bent in practice than written overly prescriptively up front.

---

## 8. Skill-count ceiling — confirmation only

### Problem (from the video)

Riley claimed empirically that agents degrade above ~20 skills because they pick the wrong skill more often. He recommends 7–20 as the sweet spot, with a steep drop-off above 20.

### Finding

After the 41 queued skills from `docs/skill-gap-analysis-v2.md` land, **no agent exceeds 20 resolvable skills**. The two branch analyses produced slightly different numbers due to how each counted; both converged on "no red lines." Consolidated projection:

| Agent | Projected skill count | Status |
|---|---|---|
| Ads Management | 17–19 | Closest to ceiling |
| Dev | 16–18 | Within sweet spot |
| CRM & Pipeline | 16 | Within sweet spot |
| QA | 16 | Within sweet spot |
| Content & SEO | 14–15 | Within sweet spot |
| Business Analyst, Finance, Support, Email Outreach, Strategic Intelligence | 11–13 | Within sweet spot |
| Orchestrator, Social Media | 10 | Within sweet spot |
| Onboarding, Knowledge Mgmt, Client Reporting, Portfolio Health | 7–10 | Within sweet spot |

### Recommendation: none

No action pre-gap. The gap analysis already distributes cleanly across the roster. Ads Management is the only agent worth watching — it's the closest to Riley's claimed ceiling.

### If Ads Management regresses in production

Two mitigations, in order of preference:

1. **Task-scoped skill visibility.** Rather than all skills being visible to the Orchestrator for every Ads task, filter the skill subset shown to the agent per task type (spend analysis ≠ creative review ≠ bid adjustment). This keeps the full skill catalogue intact while reducing decision load per run. Low implementation cost.
2. **Split the agent.** Only if skill-visibility filtering fails. Ads-Creative vs. Ads-Spend-Management would be the natural line, since their context (creative briefs, brand guidelines vs. budget, conversion metrics) diverges.

**Do not pre-emptively split.** Splitting adds Orchestrator routing complexity and doubles the agent-config surface. Only do it in response to observed regression.

### What an external reviewer should push back on

- Is "~20 skills" a real ceiling or anecdote? If anecdote, the entire ceiling conversation is premature optimisation. Counterargument: even if the number is soft, monitoring it costs nothing.
- Would a reviewer prefer we bake a runtime "too many skills" warning into the agent-config page? Possible v2 — flag if post-gap counts approach 20.

---

## 9. Build plan and sequencing

### Shared tracking

Proposed build slug: `tasks/builds/riley-observations/` with one `progress.md` and child specs for the non-trivial items. All PRs cite the slug so they're traceable as one thematic release.

### Three waves

**Wave 1 — Trivial cleanup (1 PR, ~1 hour total, no spec needed)**

Lands Recommendation 5 (agent-decomposition heuristic) and the non-collision-sensitive portion of Recommendation 2 (audit of Playbook strings, catalogued for a follow-up rename).

- Append the two sentences to `docs/spec-authoring-checklist.md`.
- Run a fresh grep to lock the definitive list of user-visible "Playbook" strings (the §4 table is a starting point; the grep is ground truth). Commit the list to the build slug's `progress.md` so Wave 2 can execute against it without re-audit.
- Does *not* do the rename yet. The rename waits on the Workflow-collision decision (external reviewer should weigh in on Option A vs. Option B before we commit either).

**Wave 2 — UX changes (2 specs, 2 PRs)**

*Recommendation 1 (Dry-run)* and *Recommendation 2 (rename)*, independently specced and shipped. These are the two customer-facing wins and should be sequenced for review economy, not dependency.

Per CLAUDE.md standard workflow for Significant tasks:
1. Draft each spec in `docs/` (on Opus) — `docs/dry-run-mode-spec.md` and `docs/playbook-rename-spec.md` (or whichever naming we pick).
2. Invoke `spec-reviewer` on each (auto-applies mechanical fixes, may find issues this brief missed).
3. Invoke `architect` to decompose each spec into an implementation plan under `tasks/builds/riley-observations/plan-<slug>.md`.
4. **Plan gate** — human review of each plan, then switch to Sonnet for execution.
5. Execute via `superpowers:subagent-driven-development`.
6. `spec-conformance` → `pr-reviewer` → PR.

Estimated calendar time: 2–3 days per item including spec review round-trips; engineering time ~2–3 hours actual implementation per item.

**Wave 3 — Backend observability and optimisation (2 specs, 2 PRs, order matters)**

*Recommendation 4 (context-assembly telemetry)* ships first. *Recommendation 3 (heartbeat decision-step)* ships second — it benefits from the telemetry being in place to measure skip-rate cleanly.

- Recommendation 4 is Standard-class (single event, known call site, no user-facing surface). Spec can be a lightweight tech-note in `docs/context-assembly-telemetry-spec.md`. May not need architect if the tech-note is precise enough.
- Recommendation 3 is Significant-class (new config fields, new execution branch, behaviour change for a live agent). Full spec + architect + plan gate workflow, same as Wave 2 items.

Estimated calendar time: 3–4 days across the pair.

### Dependencies and parallelism

- None of the waves block each other technically.
- Wave 1 can ship today.
- Waves 2 and 3 can run concurrently if we have two developers. Most likely they'll sequence Wave 1 → Wave 2 → Wave 3 in practice.
- Wave 3's Recommendation 3 should come last because its success criteria depend on Recommendation 4's telemetry being available to measure skip-rate.

### Total effort

| Item | Spec time | Engineering | Review/PR |
|---|---|---|---|
| W1: Rec 5 + string audit | — | 1h | 30min |
| W2: Rec 1 (Dry-run) | ~1d (draft + spec-review) | 2–3h | 1h |
| W2: Rec 2 (rename) | ~0.5d | 1h | 30min |
| W3: Rec 4 (telemetry) | ~0.5d | 3h | 1h |
| W3: Rec 3 (heartbeat) | ~1d | 3–4h | 1h |
| **Total** | ~3 days | ~10–12 hours | ~4 hours |

### Risks and mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| "Workflows" collision breaks Rec 2 | High — this is a real architectural concern | Resolve in external review. Do not start the rename until the collision decision is documented in a lightweight ADR under `docs/`. |
| Dry-run semantics disagree with existing Supervised mode at edge cases | Medium | Spec phase enumerates all combinations; `spec-reviewer` likely catches the rest. |
| Heartbeat decision-step increases latency beyond the skip savings | Low-Medium | Ship off-by-default; measure via Rec 4's telemetry before broader rollout. |
| Context-assembly telemetry event payload grows beyond one-row-per-run | Medium — scope creep risk during spec | Freeze the schema in the tech-note; additional fields are a v2 change, not a v1 add. |
| Rec 2 rename breaks in-flight branches / open PRs referencing user-visible strings | Low (most PRs don't touch those strings) | Grep the PR queue before landing; rebase affected PRs post-merge. |

### Rollout posture

- Wave 1: land on `main`, no feature flag.
- Wave 2 Rec 1 (Dry-run): ship behind an org-level feature flag so we can enable per-agency during soft launch. Once stable, default on.
- Wave 2 Rec 2 (rename): ship to all users at once. No flag. (String changes behind flags are a nightmare.)
- Wave 3 Rec 4 (telemetry): always on. Observability should not be flagged.
- Wave 3 Rec 3 (heartbeat): ship with `heartbeat_decision_step_enabled` defaulting to `false`. Enable on Portfolio Health Agent manually for a monitored rollout. Broader rollout via config, not release.

---

## 10. Open questions for external review

This section is where we'd most like feedback. Each question is an item we *could* answer internally but want a second opinion on before committing.

### Strategic / scope

1. **Are we scoping too tight?** This brief proposes five narrow changes. An external reviewer with fresh eyes might see a sixth or seventh that we've normalised away. What did we miss?
2. **Are we scoping too wide?** Alternatively, should we ship only Rec 1 (Dry-run) and Rec 2 (rename) — the two customer-facing items — and defer the rest? The backend items (Rec 3, Rec 4) have real value but don't move the needle on onboarding.
3. **Are we answering the right question?** Riley's audience wants "it feels like an employee." Our response is instrumentation, safety, and naming. Is that the right vector, or should we instead be prioritising time-to-first-useful-output for a new sub-account (a different framing)?

### Rec 1 — Dry-run

4. **Is force-`review`-on-everything the right primitive, or should Dry-run actually intercept skill execution and return mocked outputs?** The former is cheap and matches existing gate machinery; the latter is a truer "dry run" at the cost of needing mock generation per skill.
5. **Should Dry-run be the default for newly configured agents for the first N runs, or always opt-in?** Default-on reduces footguns for new users but adds friction for experienced ones.
6. **Is there an existing industry naming convention we should match?** "Dry run" is a DevOps term; "Preview" might land better for non-technical agency owners; "Review mode" is more honest (actions can execute post-approval).

### Rec 2 — Rename

7. **Option A (reclaim "Workflow") vs. Option B (pick a non-colliding name)** — which does HighLevel's own UI use? If HighLevel says "Workflow" for their native automation primitive, agency owners will expect it to mean the same thing in our product. Research needed before spec.
8. **Is there a "do nothing" option we're underweighting?** If Playbook is friendly jargon and GHL agency owners adapt to it within 15 minutes, maybe renaming is rearranging deck chairs. Is the friction real or imagined?

### Rec 3 — Heartbeat decision-step

9. **Deterministic signal-detection vs. LLM-based decision-step.** A rules-based pre-check (delta counts, time-since-last-meaningful-output, new-event thresholds) is cheaper and more predictable. An LLM pre-check is more flexible. Which is right for v1?
10. **Silent skips vs. "nothing to report" output.** If Portfolio Health agent is skipping 40% of ticks, does the operator lose trust that it's alive? We proposed workspace-memory logging, but maybe a visible "last checked: 2 min ago, no changes" surface would build trust more effectively.
11. **Does this generalise?** We're proposing the decision-step as a per-agent feature flag, but only Portfolio Health currently uses heartbeat. Is the abstraction premature?

### Rec 4 — Telemetry

12. **One event or many?** We argued for one consolidated `context.assembly.complete` event. A reviewer arguing for per-phase events (memory.fetched, skills.authorized, beliefs.loaded) would have good points on granularity and correlation. Where's the right line?
13. **Is this a tracing event or a run-record column?** Appending the assembly metadata onto `agent_runs` is cleaner for joins but couples the data to the run schema. Tradeoffs?
14. **PII risk.** We said "log counts, not bodies." Is that sufficient under GDPR / CCPA / SOC 2 — the shape of the context is metadata about what was in it, and in some regulatory frames that can still be PII-adjacent. Legal review worth doing before shipping.

### Rec 5 — Heuristic

15. **Is two sentences enough, or does the rule need a worked example table?** We erred on the side of tiny. A reviewer arguing for more might be right.

### Cross-cutting

16. **Sequencing.** We proposed Waves 1 → 2 → 3. Would a reviewer prefer to ship backend observability (Rec 4) before any user-facing change, so we can measure the impact of Dry-run and the rename? Or does shipping UX first matter more because customer feedback > internal metrics at this stage?
17. **Spec-before-code discipline.** Each Wave 2 / Wave 3 item assumes a formal spec pass. Is that over-engineering for changes this small, or the right bar to preserve review quality? Our default is to over-spec slightly and let `spec-reviewer` trim.
18. **Are we introducing any new consistency risks?** E.g., if Dry-run forces `review` on a side-effecting skill that a Playbook depends on, and the Playbook is scheduled, does the Playbook just stall forever? We think no (Dry run is interactive-only), but edge cases around "interactive run inside a scheduled Playbook" need enumerating.

### What we are NOT asking

- Implementation details (language, file organisation, test strategy). Those are architect-agent territory once the spec lands.
- Whether OpenClaw-as-substrate is worth building — answered in `docs/openclaw-strategic-analysis.md`.
- Whether AI agents are a real category — we're past that conversation.

### How to respond

- Short answers per numbered question are fine; don't pad.
- Flag any question where you think our framing is wrong, not just the answer.
- If a recommendation should be dropped, say so directly — we'd rather ship four well-reasoned changes than five compromised ones.
- If you see a recommendation we should add that we missed entirely, that's the most valuable feedback of all.

---

_End of brief._
