# Agent Workspace, Implementation Brief

> **Status:** Rev 8. Pre-spec, mockups attached. **Considered ready for spec.** Audited against Rev 5 strategic brief, Phase 1 auto-knowledge-retrieval spec, Trust & Verification Layer spec, two reviewer passes on §5/§6/§8, a simplification pass that removed redundant cards and scaffolding, a differentiator-coverage pass (Rev 7), and a final architectural-invariants pass (Rev 8) that locked the unified `AgentPresenceState` enum, the source-of-truth hierarchy, the Working Time accounting rule, the Knowledge-in-use mechanical constraints, the anti-fake-progress rule for Current focus, the home widget deterministic ordering, and the immutable-reference invariant for run-trace file chips.
> **Date:** 2026-05-08
> **Branch:** `claude/add-agent-cloud-compute-Kb4ii` (continues here after Phase 1 splits off)
> **Audience:** Internal stakeholders, plus LLM and external reviewers without prior context.
> **Posture:** Implementation-level. Strategic argument is settled in the locked `docs/agent-cloud-compute-dev-brief.md` (Rev 5). This brief covers what to actually build to deliver that strategy on this branch, post Phase 1 split.
>
> **Relationship to other work:**
> - **Strategic spine:** `docs/agent-cloud-compute-dev-brief.md` (Rev 5, locked). Everything in this brief implements §10.1 (Persistent Agent Workspace UI as the embodiment layer) and §10.2 (session-scoped runtime persistence) of that brief.
> - **Phase 1 dependency:** `docs/auto-knowledge-retrieval-dev-brief.md`. The Knowledge → Files tab, the per-agent Data Sources tab refresh, and the underlying retrieval observability hooks all ship there. This brief consumes those surfaces, does not duplicate them.
> - **Concurrent work:** AI agent quality verification is in flight on a separate branch. Coordination is minimal (both touch Run trace; no logical conflict). See §11.
>
> **Mockups attached** (in `prototypes/agent-workspace/`):
> - [Index of all mockups](../prototypes/agent-workspace/index.html)
> - **Mockup 1:** [Home page: Active Agents widget enhancement](../prototypes/agent-workspace/home-active-agents.html)
> - **Mockup 2:** [Agent Overview tab, active state](../prototypes/agent-workspace/agent-overview-active.html)
> - **Mockup 3:** [Agent Overview tab, idle state](../prototypes/agent-workspace/agent-overview-idle.html)
> - **Mockup 4:** [Agent Overview tab, first-run state](../prototypes/agent-workspace/agent-overview-first-run.html)
> - **Mockup 5:** [Run trace: inline file lineage](../prototypes/agent-workspace/run-trace-lineage.html)

---

## Contents

1. What this brief is and the question it answers
2. Strategic spine recap (one paragraph)
3. Scope: what is in, what is out
4. Dependencies on Phase 1 (knowledge retrieval)
5. The Agent Overview tab (the centerpiece)
6. Home Active Agents widget enhancement
7. Session-scoped runtime persistence
8. Run trace inline file lineage
9. Decisions made
10. UI patterns adopted
11. Coordination with concurrent work streams
12. Spec-risk areas to watch
13. Out of scope for v1
14. Success criteria for v1

---

## 1. What this brief is and the question it answers

The locked Rev 5 strategic brief argues that Synthetos should ship a *persistent agent workspace* (an embodiment layer for an agent's identity), not a per-agent VM. That argument is settled. This brief does not re-litigate it.

The question this brief answers: **what do we actually build on this branch to deliver the embodiment layer, given that Phase 1 (auto knowledge retrieval) is now its own feature on its own branch?**

Three things, plus one small enhancement:

1. The **Agent Overview tab** as the new default landing on the per-agent page. This is the embodiment surface. It composes the agent's state (memory, files, tools, schedule, run history) with the agent's *presence* (what it's doing right now, what it just learned, what it's about to do).
2. The **Home page Active Agents widget**, currently shipped as a single number tile, expanded into a live status list that delivers workspace-level presence.
3. **Session-scoped runtime persistence** in IEE: the same container survives across multiple steps of a single multi-step task, with state summarised back to the workspace at session end.
4. A small enhancement to **Run trace**: when a step produced a file, show that inline with a link to the file (which lives in Phase 1's Files tab).

This is a brief, not a spec. Engineering detail belongs in the spec(s) that follow.

## 2. Strategic spine recap

Synthetos is building **a persistent operational identity layer for AI workers**, not a compute platform. The agent is an entity that exists; compute is interchangeable underneath. The Workspace UI is the *embodiment layer* for that identity, not an admin dashboard. Memory persists in the database, files in object storage, runtime is ephemeral, and the experience the customer feels is *"my agent is alive in my workspace."*

The one-line principle from Rev 5 §6.4 that this brief operationalises:

> **Compute is something Synthetos uses. Identity is something Synthetos builds.**

Every component in this brief follows from that. The Agent Overview tab is the visible carrier of identity. The Home Active Agents widget is the workspace-level view of identities currently in motion. The session-scoped runtime is the implementation detail that makes the felt-aliveness real. The Run trace file lineage is the audit trail of what each identity has produced.

For full reasoning see `docs/agent-cloud-compute-dev-brief.md` (Rev 5, locked).

## 3. Scope: what is in, what is out

### In scope for this brief and v1

- **Agent Overview tab** on the per-agent page (`AgentEditPage.tsx`). New default tab; appears first in the tab strip. Composes existing primitives plus the new presence surface.
- **Home page Active Agents widget** expansion from a number tile to a live status list (per the consolidation prototype, never built).
- **Session-scoped runtime persistence** in IEE (`server/services/ieeExecutionService.ts` and adjacent). Backend change with thin UI surface (the Active Session card on Overview).
- **Run trace inline file lineage**: small enhancement that shows files produced by each step inline with a link to the file in Phase 1's Files tab.
- **Capabilities and positioning rewrite** (Rev 5 §10.4). No code, just copy.

### Out of scope for this brief

- Workspace artifact store (Rev 5 §10.3). **Phase 1 owns this** via the Knowledge → Files tab and underlying Execution Files infrastructure.
- Per-agent Data Sources tab refresh (Rev 5 §10.1 implied). **Phase 1 owns this.**
- Memory tab refresh on Agent edit. Phase 1 already exposes per-agent memory via the relevance signal on Data Sources; no separate tab needed in v1.
- Dedicated Agent Runtime tier (Rev 5 §10.5). Reserved for validated future demand. Not in v1.
- Validation interviews (Rev 5 §15 Phase 0). Run separately by product, not implemented as code.

### Positioning rewrite, what "shipped" means

§10.4 of the Rev 5 strategic brief calls for a capabilities and positioning rewrite. This brief lists it as in scope above; "shipped" means the following concrete deliverables, all of which land in the same PR cycle as the Overview tab. They are non-negotiable; without them, the differentiator argument in §11 of the strategic brief stays internal and never reaches the buyer.

| Deliverable | Where | What changes |
|---|---|---|
| Persistent Agent Workspace capability section | New top-level entry in `docs/capabilities.md` | Names the workspace as a first-class product. Composes Workspace UI, Memory, Files, Connections, Tools, Schedule, Run History, Continuity. |
| IEE intro reframe | Existing IEE entry in `docs/capabilities.md` | Lead with *"on-demand sandboxed compute that picks up where the last run left off"*, not *"Docker containers for browser automation"*. |
| Replaces / Consolidates row for hosted-VM-per-agent platforms | New row in `docs/capabilities.md § Replaces / Consolidates` | Addresses Manus, OpenClaw, and equivalents directly with the positive pitch: *"Persistent workspace, on-demand compute. Your agent remembers, continues, and only burns compute when work happens."* No anti-VM language; the row leads with what we have, not what they have. |
| Always-on capability reframe | Existing entry in `docs/capabilities.md` | Reframed as schedule + workspace state, not idle compute. The 24/7 promise is delivered through schedulers + persistent identity, made visible by the Home Active Agents widget (§6) and the Schedule peek on Overview (§5). |
| Marketing-language audit on customer surfaces | Sales decks, product copy, blog drafts touching the workspace | Sweep for any mention of *container*, *runtime*, *VM*, *scheduler*, *job* in customer surfaces; replace with workspace-language equivalents per the Rev 5 §10.1 language discipline. Engineering surfaces (run logs, IEE diagnostics, cost breakdowns) keep their precise terms. |
| Sales-conversation enablement one-pager | Internal note for the buyer who asks *"do you give the agent its own VM?"* | Single-paragraph answer that pivots to workspace + on-demand compute without ever using the words *"we don't have VMs"*. Follows Rev 5 §14.1 discipline. |

**Acceptance criterion:** a non-technical reviewer can read the updated `docs/capabilities.md` and answer *"what does Synthetos give my agent?"* in workspace-language, without reaching for infrastructure language. A second reviewer can read the same surface and locate the answer to *"how does this compare to Manus / OpenClaw?"* without finding any sentence that begins *"we don't have…"*.

### Non-UI dependencies tracked elsewhere

Two non-UI tracks ride alongside this brief and are explicitly NOT in v1 scope here. Naming them so the spec author and the reviewer know where they live, and so this brief does not silently absorb work it can't carry.

- **Language discipline review on PRs touching customer-facing surfaces.** Per-PR check that any change to `docs/capabilities.md`, customer-visible product copy, marketing pages, or sales decks does not drift back into infrastructure language. Owned by docs-sync (`docs/doc-sync.md`) and the `chatgpt-pr-review` agent's pattern-extraction step. Mechanism, not deliverable.
- **Capability-depth tracking.** Rev 5 §12.2 and §16.13 flag that the workspace abstraction only wins if underlying agent capability stays competitive (planning, autonomy, reliability, long-horizon goal pursuit). This brief operationalises the embodiment layer; capability depth is a separate roadmap track. The Overview tab's UX expectation ceiling (Rev 5 §12.2 last bullet) means **every component shipped here implicitly commits the agent to behave consistent with the surface**. If capability depth slips, the surface needs to be ratcheted back, not the other way around. Owned by the agent-capability roadmap, not by this brief; flagged here so spec author and reviewer know the dependency exists.

### Coverage of the Rev 5 strategic brief

This implementation brief delivers the strategic concepts from `docs/agent-cloud-compute-dev-brief.md` (Rev 5, locked) as follows:

| Rev 5 concept | Status here | Where |
|---|---|---|
| Path C: architecture from B, presentation from A | Operationalised | Whole brief; embodiment via Overview tab + Home widget. |
| Identity layer composition: workspace, memory, files, tools, credentials, history, continuity, orchestration | Mostly covered | Overview tab state surface (§5). Orchestration (hierarchical delegation) is an adjacent concern not built here. |
| Workspace UI as embodiment layer (Rev 5 §10.1) | Built | §5 Agent Overview tab; Mockups 2-4. |
| Ambient presence: heartbeat, current focus, recent observations, active goals, activity feed | Built | §5 Presence surface; visible in Mockup 2. |
| Three states: active / idle / first-run | Built | §5; Mockups 2, 3, 4. |
| Workspace exists by default (identity instantiation) | Built | §5 + Mockup 4 first-run state demonstrates it. |
| Session-scoped runtime persistence (Rev 5 §10.2) | Built | §7. |
| Workspace artifact store (Rev 5 §10.3) | **Owned by Phase 1** | Auto-knowledge-retrieval brief. Cloud compute consumes Phase 1 surface. |
| Capabilities and positioning rewrite (Rev 5 §10.4) | Built (copy only) | §3 in-scope; ships with this brief. |
| Dedicated Agent Runtime tier (Rev 5 §10.5) | **Deferred** | §13 out of scope; reserved for validated demand. |
| Multi-tenant agency fit | Honoured | Per-agent Overview composes cleanly with the agency / sub-account / agent hierarchy. |
| State as moat | Honoured | Memory, files, history all persist in the app, visible in Overview. |
| Local / edge execution trajectory | Not addressed (out of scope) | Future work. Architectural separation in this brief preserves the option. |
| Reversibility | Honoured | Sessions are bounded; no idle compute commitments; Dedicated Runtime tier is an additive future option. |
| Architectural separation (memory in DB, credentials in Connections, runtime ephemeral, skills separate) | Honoured | All four primitives stay separate; Overview composes them in the UI without collapsing them. |
| Cost-of-goods advantage / no idle compute | Honoured + visible in product | Sessions tear down on idle (§7); no always-on compute primitives introduced. The Working Time chart caption (§5) makes the no-idle-compute pitch visible inline, every time the operator opens Overview. |
| Ephemeral compute as evolved architecture | Honoured | Session-scoped runtime is on-demand by design; positioning rewrite (§3) reframes IEE in these terms. |
| "Always-on" via schedulers + persistent state | Honoured | Schedule peek (Overview) and Scheduled-next agents (Home widget) make this visible without idle compute. |
| Embodiment language discipline (no container / runtime / VM in customer surfaces) | Honoured | Mockups use Files / Tools / Memory / Schedule / Knowledge in use. Engineering language sits behind operator surfaces. |
| Internal discipline: this is not a "workspace UI project" | Honoured at scope level + non-UI deliverables itemised | Strategic spine in §2 keeps the framing as identity-layer-first. The non-UI work (positioning rewrite, capabilities-doc reframe, language audit, sales-conversation enablement) is itemised in §3 *Positioning rewrite, what "shipped" means*. The capability-depth and language-discipline-review tracks that ride alongside this brief are named in §3 *Non-UI dependencies tracked elsewhere*. |
| Coordination with Trust & Verification Layer | Captured in §11 with concrete spec details | Run-trace, Agent edit tab order, and Inbox feed all coordinated. Trust owns its surfaces; cloud compute owns its surfaces; both compose without shared state. |
| Coordination with Phase 1 (auto knowledge retrieval) | Captured in §11 with concrete spec details | Phase 1 ships Files / Documents / Data sources surfaces; cloud compute consumes them via deep links. Phase 1 ships the retrieval observability events that power cloud compute's Overview Knowledge-in-use card. |

**Bottom line:** every concept from Rev 5 is either (a) built by this brief, (b) owned by Phase 1 (auto knowledge retrieval), (c) owned by Trust & Verification Layer, or (d) explicitly deferred out of scope with a documented reason. Nothing strategic is silently dropped, and nothing collides with concurrent work.

## 4. Dependencies on Phase 1 (knowledge retrieval)

This brief consumes Phase 1 surfaces. If Phase 1 ships first, the build here is straightforward. If they ship in parallel, integration points are clear:

| What this brief needs | Provided by Phase 1 |
|---|---|
| Files surface (per-agent slice) | Knowledge → Files tab, filterable by agent. Cloud compute consumes via deep links from the Overview tab and Run trace lineage. |
| Per-document relevance / usage telemetry | Phase 1's retrieval observability infrastructure (§9 of the Phase 1 brief). Cloud compute uses it to populate the *recent observations* and *files-this-agent-uses* sections of the Overview tab. |
| Refreshed Data Sources tab | Phase 1 owns the tab itself. Cloud compute does NOT modify it. |
| Add to Knowledge flow | Phase 1 owns. Cloud compute may surface a *"promote to knowledge"* shortcut on agent-produced files inline in Overview, but the modal itself lives in Phase 1. |

If Phase 1 slips, the Agent Overview tab can ship a degraded version (no per-document relevance signals; Files section uses raw Execution Files instead of Phase 1's surface). Coordination is the cleaner path.

## 5. The Agent Overview tab (the centerpiece)

### Position and naming

- **Name:** "Overview" (per the existing `frontend-design-principles.md` Recurring UI Patterns guidance, neutral term that doesn't collide with "Workspace" already used in the ViewModeSwitcher).
- **Position:** Leftmost tab on the per-agent edit page tab strip. Default landing.
- **Tab strip today** (per `prototypes/consolidation-2026-05-06/agent-edit.html` and shipped code): Configure (default), Behaviour, Personality, Skills, Data sources, Schedule, Budget, Runs. **There is no current Overview tab.** The page today lands on Configure, which is an authoring surface, not a status surface.
- **Tab strip after change:** Overview (new default), Configure, Behaviour, Personality, Skills, **Scorecards** (added by Trust spec, Stage 2), Data sources, Schedule, Budget, Runs. **Locked at 10 tabs.** Scorecards sits adjacent to Skills because both are about agent capability and quality. Confirmed with the trust-verification-layer spec to avoid concurrent-merge collision.

### What the tab shows

Two surfaces composed onto one page:

**State surface** (what the agent has):
- **Identity card** (first-run only or always-visible compact form): name, role, reports-to, sub-account. Establishes the agent as an entity from the moment it is created, before any history exists. See Mockup 4.
- **Knowledge in use**, top entries the agent uses most. Surfaces as the "Knowledge in use" card. Renamed from earlier draft "Memory snapshot" because *Knowledge in use* is clearer, less anthropomorphic, and is the term we standardised on in mockups. Linked out to the workspace Knowledge page filtered by this agent.
  - **Each entry shows contextual metadata: why this entry is surfaced.** Without metadata, the card looks archival; with it, the card looks active. Examples: *"Used in last 3 runs"*, *"Referenced during outreach drafting"*, *"Pinned behavioural rule"*, *"Recently updated"*. The metadata comes from the retrieval observability layer (Phase 1's `retrieval.summary` events, §11 of the auto-knowledge-retrieval spec). Keep the metadata short (under 30 chars per entry).
  - **Mechanical constraints (hard).** Without these the card silently degrades into "configured knowledge sources", which destroys the why-did-the-agent-do-that trust signal it exists to provide:
    1. **Only items actually injected into the active or most recent run's context appear.** Configured-but-unused sources do NOT surface here. They live on the Data sources tab (Phase 1).
    2. **Order is retrieval/rerank weight, not alphabetic and not last-modified.** The most-influential entry sits at the top. Tie-break by most recent use.
    3. **Stale entries are visibly marked.** If an entry hasn't been retrieved in the last 30 days, badge it *"Stale"* with a tooltip showing last-used date. Stale items still appear if they were injected, but the badge is the trust signal.
    4. **Expandable provenance per entry**: source document name, last-used timestamp, retrieval/rerank score, and token contribution % (share of the prompt context this entry consumed). Click or hover surfaces the full panel. The panel reads directly from the retrieval observability event; UI MUST NOT synthesise these numbers.
  - **Source-of-truth rule**: this card reads ONLY from the actual retrieval payload of the active or most recent run, never from `agent.configured_knowledge_sources`. See §5.3.
- **Files snapshot**, recent files this agent produced or used, with a link to Knowledge → Files filtered by this agent.
- **Tools the agent uses**, qualitative usage bands rather than precise counts. Three bands: *Frequently used*, *Occasionally used*, *Rarely used*, classified from rolling 30-day usage. Precise numbers stay available on hover and in the Skills tab for the rare cases an operator wants exact data. Rationale: rolling usage windows shift fast, and exact counts ("28 of 30 runs") cause unstable mental models week-to-week. Qualitative bands are stable enough to anchor a mental model and still informative enough to spot drift.
- **Schedule peek**, when the agent runs next, what triggers it.
- **Connections health**, at-a-glance status of the credentials this agent depends on.
- **Working Time chart**, a per-agent activity chart with timeframe pills (Today / This week / This month / This quarter). **Caption mandatory** (two lines):
  - Line 1: *"Time spent actively executing runs"*, surfaced under the chart title so semantic ambiguity (runs vs minutes vs CPU vs success-weighted work) is closed before the operator infers wrong.
  - Line 2: *"You're billed for this time only, not while the agent is idle."* This is the in-product surface of Rev 5's *"you only pay when work happens"* differentiator. Without it, the cost-attribution narrative lives only in the Capabilities doc and the operator never sees it inline. With it, the chart becomes the visible expression of the no-idle-compute pitch, every time anyone opens the Overview tab.
  - Bar colour: indigo for successful execution, red overlay for failed.
  - Compact stat row underneath: runs in period, total working time, success rate, average run duration. **The chart's stat row is the single source of performance metrics on Overview**, no separate Performance card. Earlier draft had both; the chart already covers the same ground at every timeframe, so a parallel Performance card was redundant.

**Presence surface** (what the agent is doing or about to do):
- **Status pill** — driven by the unified `AgentPresenceState` enum (see §5.3 Source-of-truth hierarchy). 7 closed states, internal name on the left, display copy on the right:
  - `idle` → *Idle* — no run in flight, has recent history. Last seen X minutes ago.
  - `running` → *Working* — actively executing a step. The agent is consuming compute and producing output right now.
  - `waiting_on_human` → *Waiting on you* — run is in flight but paused on a HITL approval, a clarification request, or an operator decision. Operator action is required to unblock.
  - `waiting_on_dependency` → *Waiting on system* — run is in flight but paused on something the operator can't act on: external API call in progress, dependency lock, retry backoff, sub-agent delegation.
  - `scheduled` → *Scheduled* — no run in flight, next run is upcoming and known.
  - `degraded` → *Status uncertain* — presence telemetry has degraded (event stream delayed, worker heartbeat stale, orchestration disconnected). The agent may still be working; the system can't currently confirm. See §5.2.
  - `failed` → *Failing* — terminal error state requiring operator attention. Distinct from a one-off failed run within an otherwise healthy agent (that's surfaced in the activity feed, not the pill).
  - **Why split `waiting_on_human` from `waiting_on_dependency`**: the operator's required action is fundamentally different. Conflating them ("Waiting") makes HITL bottlenecks invisible at scale. *Waiting on you* says *I need you*. *Waiting on system* says *I'm fine, just blocked elsewhere*. The home widget orders by this distinction (§6).
  - **Why split `running` from `waiting_*`**: most competitor surfaces conflate them, which inflates apparent utilisation and obscures cost. *Running* consumes compute; *Waiting* does not. At >5 agents this matters for COGS visibility (Rev 5 §11.6).
  - **Single source of truth**: every presence-aware surface (Overview hero pill, Home Active Agents widget, sidebar agent list, run trace header, activity badges, Inbox notifications) MUST read from the same `AgentPresenceState` value. UI MUST NOT re-derive state from raw signals. See §5.3.
- **Current focus**, one-line plain-language summary of what the agent is thinking about *right now*. Backed by the latest step in the active run (if any) or the next scheduled action. **First-class invariants pinned in §5.1.**
- **Live elapsed time**, for active runs.
- **Recent observations**, default 3 typed entries with a *"Show more"* expand to reach the full set (up to 5). **Type-discriminated** (closed enum, no freeform):
  - *Learned* — a fact the agent extracted and stored in memory ("Acme Corp has 12 directors")
  - *Detected* — a state change or anomaly ("VP Ops changed roles 3 weeks ago")
  - *Decided* — an autonomous choice the agent made ("Disqualified 365 contacts as out-of-ICP")
  - *Flagged* — something the agent paused on for review ("3 contacts have stale phone numbers")
  - *Produced* — an artifact the agent generated ("Drafted 47 outreach emails")
  - **Provenance invariant**: every observation MUST trace to a concrete source: a `agent_execution_events` row id (a step in the run trace), a `retrieval.summary` event id, a structured tool result, or a memory_block insert. Freeform LLM summarisation is NOT the source of truth. The category guides the LLM-side summarisation but the underlying event id is the canonical anchor.
  - **Why typed**: vague summaries damage the alive-and-trustworthy feeling; categories force the agent to actually have something to say; the trace-back lets the operator drill in and confirm.
- **Active goals**, open task or schedule the agent is currently advancing toward. Visible even when the agent is idle, so the workspace never feels empty.
- **Recent activity feed**, short timeline: *3 minutes ago started run X*, *2 hours ago completed task Y*, *yesterday updated memory entry Z*. Capped at 5 rows in any state (active / idle / first-run); *"View all"* in the card head links to full activity.

### 5.1 Current focus invariants (first-class)

Current focus is the emotional centre of the product. If it drifts, lags, or becomes generic, the illusion breaks immediately. The spec author MUST treat these as hard contracts, not best-effort:

- **Update latency.** When status is *Working*, the focus line MUST update within 5 seconds of the latest `agent_execution_events` row landing for the active run. SSE or websocket; spec picks. Polling is acceptable as a fallback but with a tighter cadence (2-3s) so the perceived latency stays under the 5s budget.
- **Allowed sources** (closed list, in priority order):
  1. The latest non-idle step in the active run trace (LLM call, tool call, tool result), summarised in plain language.
  2. The agent's own emitted "current focus" string if the agent self-narrates (future capability, not v1).
  3. The next scheduled action when status is *Scheduled* (e.g. "Next: weekly Acme outreach in 18 hours").
  4. A static fallback when none of the above is available (see below).
- **Stale-state handling.** If no event has arrived in the last 30 seconds while status is *Working*, the focus line falls back to one of:
  - *"Waiting on approval"* if the run is paused at a HITL gate.
  - *"Idle between steps"* if the run is in-flight but in a known wait state.
  - *"No recent activity"* with the actual last-event timestamp, if the run appears stalled.
- **Hard rule**: never display focus copy older than 60 seconds while status is *Working*. After 60s without an event, the status pill flips to *Failing* (or *Idle* if the run actually completed and the UI just hadn't caught up).
- **Verbosity ceiling.** Focus copy is a single sentence. No multi-line summaries.
- **Truncation discipline (hard).** The focus line is **1-line ellipsis** by default. Full text on hover (tooltip). Click expands inline OR navigates to the run trace step that produced the focus. Truncation length: **140 characters before ellipsis** for desktop; tighter on narrower viewports per the existing responsive pattern. This prevents layout blowout on long company names, localised copy, and dense agent rows.
- **No marketing-language drift.** Copy is operator-readable plain English ("Drafting email body using retrieved contact data") not anthropomorphic ("The agent is thinking carefully about Sarah Chen's preferences"). Mockup 2 is the tone reference.
- **Anti-fake-progress rule (hard).** Generic cognition-language is forbidden. Every focus line MUST reference at least one of:
  - a concrete step (*"Step 7 of 14: drafting outreach email"*),
  - a concrete entity or object (*"Acme Corp VP Operations"*, *"contact 4719"*, *"invoice INV-2026-0142"*),
  - or a concrete blocking condition (*"Awaiting your approval on draft email to Acme Corp VP Operations"*, *"HubSpot rate limit, retrying in 12s"*).

  **Forbidden** (generic, unfalsifiable, decorative): *"Thinking…"*, *"Analysing data…"*, *"Working on task…"*, *"Reasoning about contact selection"*, *"Preparing outreach strategy"*, *"Processing"*, any *-ing* verb without an object.

  **Why hard:** generic copy is the signature failure mode of agent platforms; it lets a stuck or shallow agent look busy. The focus line is the most-watched surface in the product, so it carries the highest trust load. The rule is enforced at the summarisation step that produces the focus copy: if the latest event has no concrete subject, the focus line falls back to the explicit stale-state copy (§5.1 Stale-state handling) rather than synthesising filler.

### 5.2 Presence degradation states (infrastructure-aware)

§5.1 covers the happy path. This subsection covers the unhappy path: when the event stream is delayed, the worker is unhealthy, or orchestration is disconnected. **Without these states, users will interpret infra problems as agent behaviour problems**, which destroys the embodiment-layer trust quickly.

The Overview tab and the Home Active Agents widget MUST surface degradation explicitly. Closed list of degraded conditions and their UI behaviour:

| Condition | Detection | UI behaviour |
|---|---|---|
| Event stream delayed >10 seconds | No new event from this run for 10s while we expect activity | Status pill stays at current state; subtitle shows *"Presence delayed…"*; elapsed timer paused with a small dotted underline indicating uncertainty |
| Worker heartbeat stale (>30s) | The IEE worker handling this run has not pinged in 30s | Status pill shows *"Status uncertain"* (visually similar to Failing but distinct copy); operator-facing toast suggests viewing the run trace |
| Focus source unavailable | The latest event has no summarisable content (e.g. raw tool dump that the summariser couldn't parse) | Focus line falls back to the last successful focus snapshot with a small "as of X ago" suffix |
| Orchestration disconnected | Connection between client and run-event stream lost | Freeze all timers, show a degraded pill (*"Reconnecting…"*) at the page level (not per-agent), retry connection, snap back to live state on reconnect |

These states are visible to the operator. They are NOT silent fallbacks. Trust depends on the system being honest about uncertainty. Spec author should mock each degraded state explicitly.

The seven `AgentPresenceState` values from §5 (`idle / running / waiting_on_human / waiting_on_dependency / scheduled / degraded / failed`) are the closed primary taxonomy. The conditions in the table above are the *causes* that drive a transition into `degraded`; the table's "UI behaviour" column is how that single state surfaces (subtitle for sub-conditions, distinct pill for the primary state).

### 5.3 Source-of-truth hierarchy (cross-cutting invariant)

The Overview tab (and every other presence-aware surface) composes data from multiple subsystems: run trace events, retrieval observability events, scheduler state, materialised observation rows, append-only activity rows. Without a strict precedence model, builders will inevitably synthesise UI state from mixed sources and visible drift will appear. This subsection pins the rules.

**`AgentPresenceState`** — derived once, server-side, from the priority list below. Every UI surface reads the resolved state; UI MUST NOT re-derive presence from raw signals.

```
AgentPresenceState resolution order (first match wins):
  1. degraded            — any §5.2 degradation condition is currently true
  2. failed              — agent is in terminal error state
  3. waiting_on_human    — active run is paused at a HITL gate
  4. running             — active run has at least one step in flight
  5. waiting_on_dependency — active run is paused on external system / lock / retry / sub-agent
  6. scheduled           — no active run, next run time is known
  7. idle                — none of the above
```

**`Current focus`** — single value, resolved from this fallback chain (first match wins):
1. `run_execution_state.current_step` of the active run (the latest non-idle step).
2. `pending_hitl_gate` description, when status is `waiting_on_human`.
3. `scheduled_next_run` description, when status is `scheduled`.
4. `last_completed_run` summary, when status is `idle`.
5. Static fallback per §5.1 stale-state handling.

The focus line MUST NEVER be synthesised from raw event content the summariser can't anchor; if no source resolves, fall back to stale-state copy, never to filler.

**`Recent observations`** — materialised observation rows only. Each observation is a typed row written at the moment the underlying event landed (run trace step, retrieval summary, structured tool result, memory_block insert). Observations MUST NEVER be inferred from activity-feed text or summarised post-hoc. The provenance invariant in §5 applies: every row traces to a concrete event id.

**`Knowledge in use`** — actual retrieval payload from the active or most recent run only. Reads from the retrieval observability layer. MUST NOT read from `agent.configured_knowledge_sources` or any "what knowledge could the agent use" view. *Configured* is on the Data sources tab; *In use* is here, and the distinction is the point.

**`Activity feed`** — append-only audit/event stream only. Rows are written by the systems that own each event class (run lifecycle, scheduler, memory, connections). The feed is a projection of the audit log filtered to this agent. UI MUST NOT compose the feed from inferred or summarised state.

**`Working time` chart** — `agent_execution_events` rows of type `step_started` / `step_completed` for this agent, summed per timeframe bucket. See §5.4 for the accounting invariant.

**Why this matters.** Three concrete drift modes this hierarchy prevents:
- Synthesising *Current focus* from activity-feed text (drifts from real run state, lags, lies).
- Treating *configured knowledge* as *Knowledge in use* (looks active, isn't, destroys the why-did-the-agent-do-that signal).
- Inferring *Recent observations* from LLM summaries of the run trace (no provenance, no trace-back, breaks operator trust the moment they try to drill in).

Spec author should treat this section as load-bearing. If a future surface needs a piece of presence-shaped data and the source isn't named here, the answer is to extend §5.3, not to invent a side channel.

### 5.4 Working Time accounting (formal definition)

The Working Time chart caption commits the product to *"you're billed for this time only, not while the agent is idle."* Without a hard backend definition, support tickets become inevitable as soon as an operator reconciles the chart against an invoice. The spec author MUST pin the accounting rule before the chart ships.

**Working Time is the sum of intervals during which an `agent_execution_events.step_started` event has fired and the matching `step_completed` event has not yet fired, for runs owned by this agent.**

Inclusion / exclusion rules (closed list):

| Condition | Included in Working Time? | Billed? | Rationale |
|---|---|---|---|
| Active LLM call or tool call (state = `running`) | **Yes** | Yes | This is the work. |
| Queue wait before a step starts | No | No | Pre-work; not the agent's labour. |
| HITL pause (state = `waiting_on_human`) | No | No | Operator-blocked; the agent is not consuming compute. |
| External API in flight (state = `waiting_on_dependency`) | No | No | The agent is suspended; matches Rev 5's no-idle-compute pitch. |
| Retry backoff between attempts | No | No | The agent is not consuming compute during the backoff. |
| Sub-agent delegation (this agent invoked another) | **Yes for the parent**, also Yes for the sub-agent | Yes for both, attributed separately | Both agents are working. Cost is attributed to each line item; reconciliation rolls up to the parent run for invoice purposes. |
| Failed step | **Yes**, up to the moment the failure is recorded | Yes | Failed work still consumed compute. |
| Concurrent runs of the same agent | Time intervals are **summed, not deduplicated** | Yes | Two parallel runs do twice the work. |
| Time spent in `degraded` state | **Best-effort included** based on last known step timestamps | Yes (matches Working Time) | Honest about uncertainty; if the spec author finds a case where this over-charges, document it as an exception. |

**Reconciliation invariant.** The Working Time chart total for any timeframe MUST exactly equal the billable time the operator sees on the invoice for that same timeframe. If the two ever drift, the chart is wrong, not the invoice.

**Hover affordance.** Each bar in the chart, when hovered, shows the run id(s) contributing to that bucket. This is the operator's escape hatch when reconciling against the invoice.

### Three states the tab must handle

1. **Active state** (Mockup 2): agent is currently running. Status pill is *Working*. Hero shows current focus and elapsed time. Active session card is visible.
2. **Idle state** (Mockup 3): agent is not running but has a recent history. Status pill is *Idle* or *Scheduled*. Hero shows last seen and next scheduled run. Activity feed prominent.
3. **First-run / empty state** (Mockup 4): agent was created recently and has no run history. Status pill is *Just created*. Sections show empty states with helpful copy. **The page must still feel like an entity that exists.** This is the identity-instantiation demo per the Rev 5 strategic spine.

### Workspace exists from creation (identity instantiation)

A core principle from Rev 5 §6.3 that this brief operationalises:

> **The workspace is identity instantiation, not infrastructure provisioning.** Every agent gets a workspace the moment it is created. There is no "spin up workspace" step, no provisioning delay, no "your workspace is ready" notification. The agent now exists as an entity with its own state, and the Overview tab is its visible carrier.

Implementation consequences:
- Creating an agent must *immediately* render a usable Overview tab. No async provisioning.
- The Overview tab's first-run state is a real surface, not a placeholder. Identity card is populated. Quick actions guide the next steps. Empty states explain what each section will hold.
- The customer should never see a "workspace not ready" condition.

**Copy discipline for first-run state.** The first-run mockup (Mockup 4) MUST use identity-instantiation language, not configuration-software language. Concretely:

| Avoid (config language) | Prefer (identity language) |
|---|---|
| "Pick a role" | "Role: Account Health Manager" *(presented as already assigned, not asked)* |
| "Choose a model" | (omit from operator-facing checklist; the agent is already cognitively capable) |
| "Cognitively ready (Sonnet 4.6)" | *"Reasoning system ready"* (model-neutral) |
| "Link knowledge documents" | "Teach the agent" |
| "Configure schedule or trigger" | "Decide when it should work" |
| "Run a test" | "Watch it work" |

The shift is from *"this software needs configuring"* to *"this entity exists and is ready; here is how to give it context, decide its working hours, and see it in action."* The setup checklist still exists as a guide, but the verbs are about teaching, deciding, and watching, not picking and configuring. Mockup 4 is the canonical reference.

**Critical: do not couple model branding to the identity layer.** Earlier draft had "Cognitively ready (Sonnet 4.6)" on the first-run state. That was emotionally effective but introduces a fragile coupling: when the underlying model changes (Sonnet 4.6 → 4.7 → GPT → local model → multi-model routing), the identity-layer copy needs updating too, and the user's mental model of *"my agent's personhood is tied to which model is under the hood"* gets disrupted on every migration. **Identity-layer copy stays model-neutral.** Operator-facing language references *reasoning system*, *inference engine*, or *core cognition*, never the specific model brand. The exact model lives in the Configure or Behaviour tab where it belongs.

**First-run page shape (lean, not scaffolded).** Earlier draft of the first-run state included a setup checklist (5 rows: 2 done, 3 todo) and several empty-state cards (Recent activity / Schedule / Knowledge each showing "no X yet"). Both were removed in the simplification pass. **Reasons:**
- The setup checklist duplicated the three quick-action cards. Two surfaces telling the operator the same thing felt like a progress bar of how-configured-the-software-is, which works against the *"this entity already exists"* principle.
- Empty placeholder cards (Schedule / Files / Knowledge each saying "nothing here yet") added visual scaffolding without information. The agent felt half-built rather than "newly arrived and ready."

**First-run shape (canonical):**
- Welcome banner (dismissable).
- Three quick action cards: *Teach the agent / Decide when it should work / Watch it work*.
- Identity card (full-width or prominent): name, role, reports-to, sub-account.
- Tools card (compact): one-line summary of inherited default skills + link to Skills tab.
- Connections card (compact): inherited connections summary.

That's it. No checklist. No empty cards for sections that will populate naturally as the agent runs. The page is confident about what already exists and clear about what comes next; it doesn't surface placeholders for things that haven't happened yet.

### What the tab is NOT

- Not a configuration page. Configure / Behaviour / Personality / Skills / Schedule / Budget tabs already cover authoring; Overview is read-mostly.
- Not a debugging surface. Run trace (existing) handles debug; Overview is the operator-facing summary.
- Not a duplicate of the Home page Active Agents widget. Home is workspace-level (all agents); Overview is per-agent (this agent's full picture).

## 6. Home Active Agents widget enhancement

The shipped Home page (`client/src/pages/operate/HomePage.tsx`) currently has Active Agents as a single number tile (just the count). The consolidation prototype (`prototypes/consolidation-2026-05-06/home.html`) shows the richer pattern that was specced but not built: per-agent live-status rows with current step, elapsed time, and pulsing dot.

This brief ships that richer widget.

**The widget:**
- Header: *Active agents* + count ("3 of 18 running now").
- Row per running agent: status dot (pulsing), agent name, current step in plain language, elapsed time.
- Below the running agents: scheduled-next agents, with next-run time.
- Footer link: *All agents* → Agents list.

**Visible-row cap and overflow rule.** Agencies routinely run 20+ agents simultaneously, especially during scheduled bursts. Without a cap the widget grows unbounded.

**Section order (top to bottom, deterministic):**

1. **Waiting on you** (`waiting_on_human`) — operator action required to unblock. Listed first because *the operator is the bottleneck*; surfacing this anywhere else hides the queue. Top 5 visible; overflow collapses into *"+N more waiting on you"*.
2. **Working now** (`running`) — actively executing. Top 5 visible; overflow collapses into *"+N more working"*.
3. **Failing** (`failed`) — terminal error state requiring attention. Top 5 visible; overflow collapses into *"+N more failing"*. Hidden when empty.
4. **Scheduled next** (`scheduled`) — soonest first. Top 5 visible; overflow collapses into *"+N more scheduled today"*.
5. **Idle** (`idle`) — NOT shown by default in this widget. Accessed via the All-agents link. The widget is for *what's in motion, blocked, or about to be*.

Within each section, sort by `updated_at DESC` (most-recently-changed first). For `Scheduled next` only, override with `next_run_at ASC` (soonest first), since scheduled-time ordering is more useful than recency.

`waiting_on_dependency` agents are intentionally NOT a visible section. They consume no operator attention and no budget; surfacing them as a peer to *Waiting on you* dilutes the urgency signal. Count is rolled into the *Working now* footer (e.g. *"3 working, 2 paused on system"*).

`degraded` agents float up into whichever section their primary state would have been (a degraded-but-running agent appears in *Working now* with the *Status uncertain* badge). The badge is the trust signal; the section placement preserves the operator's mental model of where the agent normally lives.

This keeps the widget at most ~17 rows tall (5 + section header, four times, plus footer) regardless of agency size. Spec author should mock the 20-running case before declaring layout shippable.

**Why this widget delivers the "always-on" promise without idle compute.** Per Rev 5 §10.4, "always-on" is delivered via schedulers + persistent state, not via continuously running compute. This widget makes that visible: the operator sees what's running NOW (3 of 18) plus what's scheduled to run next (5 today). The workspace feels staffed even though no compute is idle. The cost story (you only pay when work is happening) ships alongside the perceptual story.

**Data source:** the same source that powers the Agent Overview tab's presence surface, exposed at workspace scope (filter by current sub-account).

**Constraint:** must use the existing `MetricCard` component or extend it. No new pattern. Loading-error state per the existing tile-level error handling rule (Home page locked invariant, see HomePage.tsx).

## 7. Session-scoped runtime persistence

### What we ship

A *session* primitive in IEE: a logical envelope that holds the same container alive across multiple step invocations within one task, then tears it down at task end and writes summarised state back to the workspace.

**Lifecycle:**
- Task begins → new `iee_sessions` row referencing the run, the actor, the budget context.
- Each step within the task checks for the active session before spawning a new container; if the session exists and is alive, dispatch into the existing container.
- Idle timeout (default: minutes, not hours) tears the container down to control cost.
- Heartbeat from the agent extends the lease.
- Session end → structured summary written to the run record. Durable artifacts (files) uploaded to Phase 1's Execution Files store.
- Per-run cost tracking continues to apply; bill the session under the parent task's compute budget.

### Why this matters for the workspace UI

Session-scoped persistence is what makes the *current focus* line on the Agent Overview tab real. Without it, the agent has no "current step in a multi-step task" because every step is a fresh container. With it, the live focus line is meaningful and the felt-aliveness of the surface lands.

### Engineering risk

This is the highest-risk piece in the brief. Container lifecycle is hairy: heartbeats, idle timeouts, leaked containers, cleanup races, orphaned resources. The spec author should treat this as a Significant task with explicit incident-handling tests.

## 8. Run trace inline file lineage

Small. The existing Run trace surface (`prototypes/consolidation-2026-05-06/run-trace.html`) is a 3-column layout: run chain on the left, event list in the middle, event detail panel on the right. Each event shows seq, type, content, time. Some events produce files. Today, those files are not visible inline; you have to navigate to a separate surface.

**Change:** when an event produced a file, show a "📎 Output" chip row inline below the event content. Each chip is a clickable file (icon + filename) that deep-links to the file in Knowledge → Files (Phase 1 surface). Sub-agent events that produced files surface them too (labeled "📎 From sub-agent"). The Event detail panel on the right also surfaces produced files in a dedicated section so they are visible whether you scan or drill in.

**This is complementary, not a replacement.** The existing run trace structure (run chain, event types, event detail panel, live/historical mode toggle, Trace/Delegation graph tabs) is unchanged. The file lineage is one additional row inside the `event-row`. See Mockup 5 for the visual.

**Immutable-reference invariant (hard).** Every file chip resolves to the **exact artifact produced at that event**, not to "the current version of the file with this name". Without this, reruns, regenerated files, corrected outputs, and promoted-to-knowledge artifacts create temporal ambiguity inside the trace ("which version of `acme-contacts.csv` did this step actually use?"), and the trace stops being a faithful record of what happened.

Each chip is keyed on the tuple:

```
(run_id, event_id, produced_file_id, produced_version_id)
```

Click resolution behaviour:
- Default click: opens the artifact at `produced_version_id` in Knowledge → Files. The file chrome shows *"As produced by Outreach Agent run 1283, step 7 — 2 days ago"* and a *"View latest"* affordance for the operator who genuinely wants the current version.
- The chip itself never silently re-binds to a newer version. If the source file is later corrected, regenerated, or superseded, the chip still resolves to the version produced at this event. A small *"Newer version available"* badge MAY appear on the chip when the version is no longer current, but the link target stays bound.
- "Promote to knowledge" promotes the *exact version* the chip points at. The promoted knowledge entry stores the same tuple as its origin reference.

Spec implication: the artifact store schema MUST surface a stable `produced_version_id` per write. The Phase 1 Files tab MUST accept the four-part tuple in its deep-link URL shape. Lock this query-parameter contract with the Phase 1 spec author before mockup-to-spec conversion.

**Chip wrapping and row-height constraints (hard).** Without explicit caps, worst-case event rows (8+ files, long filenames, sub-agent outputs, Trust badges, Correct hover) get visually noisy fast. Spec must pin:

- **Maximum visible chips per event**: 4. Beyond 4, render the first 4 chips followed by *"+N more"* that expands inline on click.
- **Chronological ordering invariant** (hard). Chips render in **causal order**: the order in which the parent event produced them. **NEVER alphabetically. NEVER grouped by file type / MIME.** Causality is the more useful axis for a run trace; alphabetisation destroys the operator's ability to reason about *what happened, then what happened next* on this step.
- **Filename truncation**: 36 characters. Truncate from the middle (preserving extension): `acme-contacts-enriched-2026-...csv`. Tooltip on hover shows full filename.
- **Maximum event-row height before overflow**: 3 lines of content. Beyond that, content is truncated with a *"Show more"* affordance that expands inline.
- **Detail panel is the spillover.** Selecting an event in the trace opens the right-hand detail panel where the full set of produced files, full filenames, full content, and Trust runtime-check details all live un-truncated. The inline event row is a scan-friendly summary, not a complete record.

These constraints prevent layout entropy as runs accumulate complexity, and keep the trace scannable on dense screens.

**Coordination with verification work:** the verification team is also touching Run trace (adding Pass/Fail/Pending markers per event, runtime check summary, "Correct this output" action). Both changes are additive composition: file chips appear in the event content area; verification markers appear next to the event type label or in the detail panel. No blocking conflict.

## 9. Decisions made

| # | Decision | Direction |
|---|---|---|
| 1 | Tab name | "Overview" (not Workspace, Home, Status, Live, Pulse, Dashboard). |
| 2 | Tab position | Leftmost on Agent edit; default landing. |
| 3 | Files surface ownership | Phase 1 owns Knowledge → Files tab. Cloud compute consumes via filter / deep-link, does not duplicate. |
| 4 | Per-agent memory tab | Not a separate tab in v1. Memory snapshot lives inside Overview. |
| 5 | Connections section in Overview | Read-only health snapshot. Editing happens on Connections page, not here. |
| 6 | Status pill values | *Working / Idle / Scheduled / Failing*. First-run state shows *Idle* with empty-state copy. |
| 7 | Current focus copy | One sentence, plain language, sourced from the latest step in the active run. Not raw tool-call output. |
| 8 | Recent observations | Default 3 visible with *"Show more"* expand to 5. Updated continuously while a run is active, not only at run end. Backed by Phase 1 retrieval observability + run trace summary. |
| 9 | Empty / first-run hero copy | *"Just created. No activity yet."* + suggested first actions (run a test, configure schedule, link documents). The page is still a real surface, not a placeholder. |
| 10 | Home widget shape | Per-agent live-status rows (per the consolidation prototype). Not a chart, not aggregated metrics. |
| 11 | Session container lifetime | Bounded by one logical task. Idle timeout in minutes, not hours. Heartbeat extends. No cross-task container reuse in v1. |
| 12 | Run trace lineage shape | Inline file chips per step. Click deep-links to the file in Knowledge → Files. |
| 13 | Verification overlap | Coordinate at PR-merge time, not at design time. Both surfaces are additive on Run trace. |
| 14 | Capabilities and positioning rewrite | Ships when this brief lands. Reframes IEE as on-demand sandboxed compute that picks up where the last run left off. |

## 10. UI patterns adopted

This brief follows the patterns codified in `docs/frontend-design-principles.md` § Recurring UI patterns (added during Phase 1 mockup work). Key applications:

- **No token / cost / size info in default views.** Performance section on Overview shows runs and success rate, not token counts.
- **Stat tiles capped at 2** on the Performance section.
- **Three-dot menus** (where present, e.g. on individual file chips) max 6 items, sub-options as flyouts.
- **Default-case source badges suppressed.** Activity feed entries don't badge "manually triggered" runs (the default); they badge unusual sources (heartbeat, scheduled, automated).
- **Explainer banners dismissable.** First-run state has a helpful banner that closes per-user.
- **No em-dashes in any UI copy or sample data.** Use commas, colons, or rewrite.
- **Sub-text trimmed.** Activity feed rows are one line. Detail in modal.
- **NEW badges are review-only.** The "NEW" badges and yellow annotation banners visible on mockups (e.g. the highlighted Active Agents widget on Mockup 1) are review affordances for stakeholder feedback. They MUST NOT ship in production. New surfaces should land without "NEW" decoration; if a feature tour is genuinely needed, it lives in the existing onboarding system, not as a permanent badge.

## 11. Coordination with concurrent work streams

### Phase 1 (auto knowledge retrieval)

Spec at `tasks/builds/auto-knowledge-retrieval/spec.md` (draft 2026-05-08). Owned by separate branch.

What Phase 1 ships that this brief consumes:

- **Knowledge → Files tab**, with per-agent filtering. Cloud compute deep-links into this from the Overview tab and Run trace lineage.
- **Knowledge → Documents tab refresh** with mode chips and scope chips.
- **Agent edit → Data sources tab refresh.** Cloud compute does NOT modify this tab; Phase 1 owns it.
- **`retrieval.summary` events on `agent_execution_events`** (Phase 4 of the auto-knowledge-retrieval build). These power "why was this loaded?" tooltips on documents. Cloud compute's Overview tab "Knowledge in use" card consumes the same data.
- **`reference_document_data_sources` table** (Phase 1 schema). Cloud compute does not write to it.

If Phase 1 ships first: integration is clean. If parallel: Phase 1 lands first because cloud compute references its surfaces.

### Trust & Verification Layer

Spec at `tasks/builds/trust-verification-layer/spec.md` (draft 2026-05-08). Three stages, each ships independently. **Material overlap with this brief on Run trace and Agent edit.**

#### What Trust ships that affects this brief

| Trust stage | Surface affected by this brief | Coordination |
|---|---|---|
| **Stage 1: Runtime checks** | **Run trace** | Adds Pass/Fail/Pending badge per step + summary strip + "Correct this output" affordance. **Visually coexists with cloud compute's file lineage chips on the same event row.** Cloud compute's chips appear under event content; Trust's badge appears next to event type label. Both are additive composition. |
| **Stage 1: Runtime checks** | **Inbox** | Trust feeds runtime-check failures (external blast-radius) into Inbox. Cloud compute's Home Active Agents widget shows Inbox preview; sample data should reflect this. |
| **Stage 1: Runtime checks** | **Agent execution path** | `agentExecutionService.dispatchAction()` extension. Cloud compute's session-scoped runtime (§7) is at a different layer (container lifecycle), no logic conflict. |
| **Stage 2: Scorecards + library + bench** | **Agent edit tab strip** | **Adds Scorecards tab.** Brief tab order updated to include it (§5): Overview, Configure, Behaviour, Personality, Skills, Scorecards, Data sources, Schedule, Budget, Runs. **10 tabs locked.** |
| **Stage 2: Scorecards + library + bench** | **Govern surface** | New Quality page as 4th Govern primitive (Knowledge / Spending / Connections / **Quality**). No conflict with this brief; Govern is workspace-level, this brief is per-agent. |
| **Stage 2: Scorecards + library + bench** | **Run trace** | Trust adds `scorecard_judgements` per run; visible as a quality score chip in the run summary or detail panel. Coexists with cloud compute's file lineage. |
| **Stage 3: Correction-sourced auto-memory** | **Run trace** | Inline "Correct" hover action per step (per Round 5 mockup). Coexists with cloud compute's file chips and Trust Stage 1 badges. Three additive features per event row. |
| **Stage 3: Correction-sourced auto-memory** | **Knowledge page** | Trust adds correction-source filter chip and Source column. Owned by Phase 1 (Knowledge page) + Trust together. No conflict with this brief. |

#### Run-trace event row visual budget

Three additive features land on every event row:

```
[seq] [type-dot] [type-label + Trust badge] [event content + cloud-compute file chips + Trust Correct hover] [event time]
```

- **Trust Stage 1 badge** sits next to or after the event type label. Three states: Pass / Fail / Pending. Small (10-12px text in a chip).
- **Cloud compute file chips** appear in a "📎 Output" row inside event content, below the main text. One row per event that produced files; chips wrap.
- **Trust Stage 3 Correct action** is a hover-only affordance (not visible at rest). Appears on hover near the event content.

Visual coordination: both teams add via composition, neither replaces. PR review confirms layout; no shared mutable state.

### Practical merge protocol

- **AgentEditPage tab order locked at 10 tabs** (§5). Cloud compute owns the Overview tab insertion; Trust owns the Scorecards tab insertion. Sequence: cloud compute lands Overview, Trust lands Scorecards in its position.
- **Run trace event renderer accepts composable extensions.** Cloud compute adds file chips below event content; Trust adds badges next to event labels and Correct hover affordance. PR-merge review confirms visual fit.
- **Inbox feed.** Trust populates runtime-check failures; cloud compute's Home widget surfaces them via the existing Inbox preview pattern.
- **Phase 1 deep links.** Cloud compute's file chips link into Phase 1's Knowledge → Files tab. The query parameter shape (`?agentId=...&runId=...`) needs to be locked between this brief and Phase 1 spec author before mockup-to-spec conversion.

### What this brief explicitly does NOT do

To prevent ambiguity at merge time:

- Cloud compute does NOT add Pass/Fail badges to event rows. (Trust Stage 1)
- Cloud compute does NOT add a Correct hover action to event rows. (Trust Stage 3)
- Cloud compute does NOT add a Quality page or Scorecards tab. (Trust Stage 2)
- Cloud compute does NOT add quality-score chips to the run summary. (Trust Stage 2)
- Cloud compute does NOT modify the Inbox surface itself. (existing Inbox + Trust Stage 1 feed)
- Cloud compute does NOT modify the Knowledge page. (Phase 1)
- Cloud compute does NOT modify the Data Sources tab. (Phase 1)

## 12. Spec-risk areas to watch

The implementation spec author should treat these as the messy areas. Each is more likely than average to require iteration.

| Area | Risk |
|---|---|
| Session container lifecycle | Heartbeats, idle timeouts, leaked containers, cleanup races. Highest engineering risk in the brief. Needs incident-handling tests. |
| Current focus rendering latency | The hero line must update fast enough to feel live (sub-second). Slow refresh kills the felt-aliveness. Needs a clear refresh contract with the run trace event stream. |
| Recent observations source quality | Plain-language summaries depend on the run trace having something summarisable. Garbage-in-garbage-out. May need a small LLM summarisation pass per step (cheap model). |
| Home widget refresh | Multiple agents running concurrently means N parallel refresh streams. Polling vs websocket vs server-sent events: spec must pick. Lock invariant from existing HomePage stays: each tile / row owns its own state, one failure does not blank the others. |
| First-run state empty copy | If the empty state feels like a placeholder, the identity-instantiation argument fails. Copy and visual treatment must communicate *"this agent exists and is ready"*, not *"nothing here yet, configure it."* |
| Tab order migration | Existing users land on Configure (the current default). Switching default to Overview is a behavioural change for returning users. Decide: hard cutover, or per-user preference, or a one-time tour. |
| Files snapshot on Overview | Phase 1's Files tab is workspace-scoped; the per-agent filter is a query parameter. Cloud compute relies on that query parameter being stable. Lock the contract with Phase 1 spec author. |
| Run trace lineage rendering | Files can be large; chips must show metadata only. No image previews inline. |
| Run trace event-row visual budget | Three additive features land on every event row: cloud compute's file chips, Trust Stage 1 Pass/Fail/Pending badges, Trust Stage 3 Correct hover action. Without explicit visual coordination, the row gets noisy fast. Layout contract pinned in §11; merge-time PR review must confirm. Spec author should mock the worst-case row (failed runtime check + multiple file outputs + visible Correct affordance) before declaring the integrated layout shippable. |
| AgentEditPage tab strip width | 10 tabs is at the edge of comfortable. If the page is rendered at narrow widths, tabs need horizontal scroll (already implemented per the existing pattern). Verify the new Scorecards tab doesn't push above an acceptable threshold; if it does, consider tab grouping or condensing labels. |

## 13. Out of scope for v1

- **Workspace artifact store** (Rev 5 §10.3). Owned by Phase 1.
- **Dedicated Agent Runtime tier** (Rev 5 §10.5). Reserved for validated future demand.
- **Always-on compute** for any agent. Sessions are bounded by tasks; no idle compute outside scheduled runs.
- **Cross-task container reuse.** Sessions live for one task only.
- **Live workspace mutation** (e.g. dragging files into the agent's view to add them to memory). Drag-and-drop is a Phase 3 polish concern.
- **Active Session drill-in modal** as a separate surface. The existing Run trace page already handles live runs; if the operator wants step-by-step detail, they click through.
- **Multi-agent shared workspaces** (a workspace shared by N agents on the same task). Distinct from per-agent embodiment; future work.
- **Per-agent memory editing surface.** Memory editing happens at the workspace level on the Knowledge page; per-agent slice is read-only in Overview.
- **Confidence surface** (future-native concept; breadcrumbs only). The system is becoming increasingly trust-mediated: typed observations, retrieval observability, Trust verification, lineage, HITL gates. Eventually operators will want to see *"how certain is this agent about what it thinks?"* — qualitative bands like *Verified / Inferred / Assumed / Conflicted*, not raw probabilities. This is **not built in v1**, but the architecture should accommodate it: the typed Recent observations enum (§5) and the Trust judgement events (Trust spec Stage 2) are the two anchors that a future confidence surface will read from. Schema additions for confidence are deferred. Spec author should not foreclose the option (e.g. don't make `observation_type` a closed string check that's hard to extend; use an enum table).

## 14. Success criteria for v1

A non-technical operator can:

- Open an agent and immediately see what it's doing or just did, in plain language, without learning a new vocabulary.
- See an agent that is currently running, with current step and elapsed time, on both the Home page and the agent's Overview tab.
- Open a brand-new agent and feel that the agent is *a thing that exists*, not *a placeholder that will exist once configured*.
- Drill from a current focus line into the live run trace and back without losing context.
- See files this agent recently produced, with one click to the full Files tab.
- Articulate, after one look at the Overview tab, that compute is billed only for time the agent is actively working, not while it sits idle. The Working Time chart caption is the surface where this lands.

A reasonable internal observer can:

- Verify that no idle compute cost is introduced (sessions are torn down on idle).
- Verify that the AgentEditPage Overview tab loads fast (under 500ms p95) regardless of the size of the agent's history, by virtue of paging the activity feed and lazy-loading the snapshots.
- Verify that the Home Active Agents widget streams updates without polling the server in a tight loop (websocket or SSE; spec picks).
- Verify that Run trace renders file lineage chips inline without significantly increasing page weight.

The competitive frame, plain English: *"Open your agent and see it working. Or see what it just did. Or see what it's about to do. The agent has a workspace, files, memory, and a schedule, and you can see all of it without thinking about servers."*

---

> **Brief is final at Rev 8, ready for spec.** Strategic argument is in the locked Rev 5 of `docs/agent-cloud-compute-dev-brief.md`. Implementation invariants are in §5-§8 here, with the architectural-invariants pass (Rev 8) pinning the unified `AgentPresenceState`, the source-of-truth hierarchy (§5.3), the Working Time accounting rule (§5.4), and the immutable file-lineage tuple (§8). Positioning-rewrite deliverables and non-UI dependencies are itemised in §3. Risk surface is in §12. The mockups linked in the header capture the UX. The next move is invoking the architect agent against this brief, producing an implementation spec, and shipping in chunks against that spec.
