# Agent Workspace, Implementation Brief

> **Status:** Rev 1. Pre-spec, mockups attached.
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

For full reasoning see `docs/agent-cloud-compute-dev-brief.md`.

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
- **Tab strip after change:** Overview (new default), Configure, Behaviour, Personality, Skills, Data sources, Schedule, Budget, Runs.

### What the tab shows

Two surfaces composed onto one page:

**State surface** (what the agent has):
- Memory snapshot, top entries the agent uses most, with a link to the workspace Knowledge page filtered by this agent.
- Files snapshot, recent files this agent produced or used, with a link to Knowledge → Files filtered by this agent.
- Schedule peek, when the agent runs next, what triggers it.
- Connections health, at-a-glance status of the credentials this agent depends on.
- **Working Time chart**, a per-agent activity chart with timeframe pills (Today / This week / This month / This quarter), matching the visual pattern of the Home page Runs widget. Shows when the agent has been working, with success/failure colouring on bars. Compact stat row underneath: runs in period, total working time, success rate, average run duration. Gives the operator a single visual answer to "how busy is this agent and how is it trending?"
- Performance, small stat block as a compact summary alongside the chart.

**Presence surface** (what the agent is doing or about to do):
- **Status pill**: *Working*, *Idle*, *Scheduled*, *Failing*. Single source of truth for liveness.
- **Current focus**, one-line plain-language summary of what the agent is thinking about *right now*. Backed by the latest step in the active run (if any) or the next scheduled action.
- **Live elapsed time**, for active runs.
- **Recent observations**, last 3-5 things the agent learned, decided, or noticed. Plain language, not raw tool calls. Backed by the run trace summary.
- **Active goals**, open task or schedule the agent is currently advancing toward. Visible even when the agent is idle, so the workspace never feels empty.
- **Recent activity feed**, short timeline: *3 minutes ago started run X*, *2 hours ago completed task Y*, *yesterday updated memory entry Z*.

### Three states the tab must handle

1. **Active state** (Mockup 2): agent is currently running. Status pill is *Working*. Hero shows current focus and elapsed time. Active session card is visible.
2. **Idle state** (Mockup 3): agent is not running but has a recent history. Status pill is *Idle* or *Scheduled*. Hero shows last seen and next scheduled run. Activity feed prominent.
3. **First-run / empty state** (Mockup 4): agent was created recently and has no run history. Status pill is *Just created*. Sections show empty states with helpful copy. **The page must still feel like an entity that exists.** This is the identity-instantiation demo per the Rev 5 strategic spine.

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
| 8 | Recent observations | Last 3-5 in v1. Updated continuously while a run is active, not only at run end. Backed by Phase 1 retrieval observability + run trace summary. |
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

## 11. Coordination with concurrent work streams

### Phase 1 (auto knowledge retrieval)

Owned by separate branch. Cloud compute consumes Phase 1 surfaces via deep links (Knowledge → Files filtered by agent, Knowledge → Documents filtered by agent). Cloud compute does not modify the Data Sources tab on Agent edit; Phase 1 owns it.

If Phase 1 ships first: integration is clean.

If parallel: coordinate the merge order; Phase 1 lands first because cloud compute references its surfaces.

### AI agent quality verification

Both streams add features to Run trace (cloud compute: file lineage chips; verification: pass/fail markers). Both are additive composition. Whoever ships second adapts visually but no logic conflict.

If the verification work touches the Behaviour tab significantly, that's adjacent to the Configure / Personality tabs but not the Overview tab; no conflict on the centerpiece.

### Practical merge protocol

- AgentEditPage tab order is locked at: Overview, Configure, Behaviour, Personality, Skills, Data sources, Schedule, Budget, Runs.
- Run trace step renderer accepts composable extensions (file chips, verification markers, future additions).
- Each branch adds its hooks via composition. PR review checks for visual fit; no shared mutable state.

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

## 13. Out of scope for v1

- **Workspace artifact store** (Rev 5 §10.3). Owned by Phase 1.
- **Dedicated Agent Runtime tier** (Rev 5 §10.5). Reserved for validated future demand.
- **Always-on compute** for any agent. Sessions are bounded by tasks; no idle compute outside scheduled runs.
- **Cross-task container reuse.** Sessions live for one task only.
- **Live workspace mutation** (e.g. dragging files into the agent's view to add them to memory). Drag-and-drop is a Phase 3 polish concern.
- **Active Session drill-in modal** as a separate surface. The existing Run trace page already handles live runs; if the operator wants step-by-step detail, they click through.
- **Multi-agent shared workspaces** (a workspace shared by N agents on the same task). Distinct from per-agent embodiment; future work.
- **Per-agent memory editing surface.** Memory editing happens at the workspace level on the Knowledge page; per-agent slice is read-only in Overview.

## 14. Success criteria for v1

A non-technical operator can:

- Open an agent and immediately see what it's doing or just did, in plain language, without learning a new vocabulary.
- See an agent that is currently running, with current step and elapsed time, on both the Home page and the agent's Overview tab.
- Open a brand-new agent and feel that the agent is *a thing that exists*, not *a placeholder that will exist once configured*.
- Drill from a current focus line into the live run trace and back without losing context.
- See files this agent recently produced, with one click to the full Files tab.

A reasonable internal observer can:

- Verify that no idle compute cost is introduced (sessions are torn down on idle).
- Verify that the AgentEditPage Overview tab loads fast (under 500ms p95) regardless of the size of the agent's history, by virtue of paging the activity feed and lazy-loading the snapshots.
- Verify that the Home Active Agents widget streams updates without polling the server in a tight loop (websocket or SSE; spec picks).
- Verify that Run trace renders file lineage chips inline without significantly increasing page weight.

The competitive frame, plain English: *"Open your agent and see it working. Or see what it just did. Or see what it's about to do. The agent has a workspace, files, memory, and a schedule, and you can see all of it without thinking about servers."*

---

> **Brief is final at Rev 1, ready for spec.** Strategic argument is in the locked Rev 5 of `docs/agent-cloud-compute-dev-brief.md`. Implementation invariants are in §5-§8 here. Risk surface is in §12. The mockups linked in the header capture the UX. The next move is invoking the architect agent against this brief, producing an implementation spec, and shipping in chunks against that spec.
