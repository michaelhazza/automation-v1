# Development Brief — Home Dashboard Reactivity Polish

**Status:** Pre-spec, refined after stakeholder feedback. Ready to progress to technical specification.

**Origin:** Multi-week strategic analysis triggered by Anthropic's Claude Cowork Live Artifacts launch (April 2026). Builds on prior decisions captured across the parent thread and incorporates round-1 review feedback.

---

## Contents

1. Problem
2. What's already in place
3. The proposed work — three pieces, two in scope
4. What we're explicitly NOT doing
5. Implementation constraints (hard rules)
6. Risks
7. Open questions — resolved
8. Success criteria
9. Sequencing recommendation
10. Next step

---

## 1. Problem

**Strategic context.** When Anthropic launched Live Artifacts — persistent, self-refreshing dashboards inside Claude's desktop app — there was a real risk that AutomationOS's exposed surface (dashboards, client-facing views) would feel dated by comparison. The original analysis identified this as a perception problem, not a capability problem. We don't lose on operational depth; we lose if our first-touch surface doesn't reflect the reactivity the rest of the system already exhibits.

**The sharpened framing — reactivity inconsistency across surfaces.**

Most of the product is genuinely live. `ClientPulseDashboardPage` updates without refresh. Agent run detail pages stream events. The Pulse review queue surfaces incoming items in real time. But the home page — the first thing every operator sees on login — still loads once and stays static. That inconsistency is what creates the perception gap, both versus Claude and within our own product.

The framing matters because it's a reusable design principle, not a one-off fix:

> **Every dashboard-style surface must reflect underlying system reactivity. If it can change, it must visibly change.**

Apply that principle here, and we get a reusable rule for subaccount and client portal dashboards in Phase 2.

## 2. What's already in place

So this brief doesn't accidentally re-propose existing work:

- **Component library** — `PendingApprovalCard`, `WorkspaceFeatureCard`, `UnifiedActivityFeed`, `MetricCard`, shimmer skeletons, fade-in animations.
- **WebSocket infrastructure** — Socket.IO rooms including `org:{orgId}` and `system:sysadmin`. Server-side emitters for execution, agent runs, workflow runs, brief updates.
- **The live-update pattern itself** — proven in `ClientPulseDashboardPage`. REST snapshot loads instantly; WebSocket pushes deltas into local state.
- **Approval routing + telemetry** — `handleAct` flow, intent tracking, deep-linking.

## 3. The proposed work — three pieces, two in scope

Pieces 1 and 2 are the active scope. Piece 3 is deferred but layout-reserved.

### Piece 1 — Event-driven, block-level live updates

**What:** Wire deterministic, scope-limited live updates into `DashboardPage`. Each WebSocket event maps to specific blocks; only those blocks refetch.

**Event → block contract** (locked at brief level, finalised in spec):

| Event | Updates |
|---|---|
| `approval.changed` | `PendingApprovalCard` list + `MetricCard(Pending Approval)` |
| `agent.run.completed` | `UnifiedActivityFeed` + `MetricCard(Runs 7d)` |
| `workflow.run.updated` | `UnifiedActivityFeed` |
| `client.health.changed` | `MetricCard(Clients Needing Attention)` + `WorkspaceFeatureCard(ClientPulse)` |

No generic `dashboard:update` catch-all. The spec must enumerate every event-to-block mapping; anything not enumerated does not trigger a refetch.

**Refetch granularity rule (hard):**

> No full-dashboard refetch on socket events. Block-level refetch only.

Locked at brief level so no engineer can shortcut it later for "simplicity."

**Concurrency and ordering rule:**

When events arrive close together or responses return out of order:

- Each block tracks its own version/timestamp on every fetch response.
- Newer responses overwrite older ones; older responses arriving late are discarded.
- Latest-data-wins applied per-block, not globally.

**Idempotency expectation:**

> Re-processing the same socket event must not produce duplicate UI state or inconsistent counts.

Handlers must be safe to invoke multiple times for the same logical event.

**Why this matters.** The single biggest perception lever. An operator approves something, navigates to the detail view, comes back — and the count is stale until they refresh. With this change, the home page feels equally as alive as ClientPulse already does.

**What it isn't.** Not real-time streaming. Not polling. Event-driven invalidation: scoped, ordered, idempotent.

**Cost.** No LLM cost. WebSocket connections already established. Marginal database read load is small — a fraction of the full-page reloads users would otherwise trigger.

### Piece 2 — Standardised freshness indicator

**What:** A small, reusable component placed below the home greeting. Displays "updated 12s ago" with the timestamp incrementing live and pulsing briefly when new data arrives.

**Component contract:**

```
<FreshnessIndicator lastUpdatedAt={Date} />
```

Single prop. No abstractions beyond that. The component owns the "X ago" formatting, the live timestamp tick, and the debounced pulse animation.

**Update semantics — locked:**

> "Updated X ago" represents the **last successful UI state sync** — the most recent moment any block on the page received a successful refetch response, whether from the initial load or a socket-triggered refetch.

Unambiguous, observable, and what users actually mean when they think "live."

**Pulse guardrail — locked:**

> Pulse animation debounced to once per 1.5 seconds maximum.

Without this, busy orgs produce constant flicker. With it, the indicator feels alive without becoming noise.

**Why standardise now:** This pattern will propagate to subaccount and portal dashboards in Phase 2. Cost is trivial today, painful to retrofit later.

### Piece 3 — Operationally distinctive blocks (deferred, but layout-reserved)

**What (deferred):** One or two new blocks surfacing state Claude Live Artifacts cannot — strongest candidates being cross-client spend / margin (this week) and a workflow / playbook health rollup.

**Status:** Out of scope for this build. Mixing it with Pieces 1 and 2 muddies the success criteria — perception parity vs. product expansion are different bets.

**Layout reservation (in scope):** Reserve a layout slot in `DashboardPage` for a future "Operational metrics" section between "Pending your approval" and "Your workspaces." Empty in the current build, ready for Piece 3 without a redesign.

## 4. What we're explicitly NOT doing

- **No generalised "Views" framework.** Page-specific React components composing reusable cards is working; no widget registry, no layout engine.
- **No client portal redesign.** Phase 2.
- **No system-admin dashboard build.** Effectively shipped via existing pages plus the role-conditional Queue Health block.
- **No MCP server in this work.** Separate track.
- **No new state management library.** Codebase has deliberately stayed on `api + useState` plus targeted WebSocket merges.
- **No global event bus / global socket abstraction.** Tempting to "clean up sockets properly" mid-task — explicitly out of scope. Each block subscribes to the events it needs.

## 5. Implementation constraints (hard rules)

Non-negotiable for the spec phase. Every constraint exists to prevent a specific class of execution drift.

1. **Block-level refetch only.** No full-page reloads on socket events.
2. **Deterministic event → block mapping.** Every event has a documented destination set; nothing is generic.
3. **Cross-block consistency.** Blocks deriving from the same underlying data must update together or not at all.
4. **Latest data wins per block.** Per-block versioning/timestamping; out-of-order responses discarded.
5. **Idempotent updates.** Same event processed twice must not corrupt state.
6. **No new state management library.**
7. **No global socket abstraction.**
8. **Pulse animation debounced ≥1.5s.**
9. **System admins receive identical live-update behaviour.** Consistency over role differences. The role-conditional `QueueHealthSummary` block also live-updates.

## 6. Risks

**Toast spam.** Solved by replacing toast notifications with the debounced pulse on `<FreshnessIndicator>`. Toast reserved for state changes the user must be told about (e.g. "Your trial has ended").

**Emitter coverage.** Some home-page events may not have server-side emitters today. Inventory and gap-fill is a spec-level task; expected to be small (1–2 emitters).

**Expectation creep.** Once home feels live, users expect every page to feel live. Internal rule: dashboard-style pages get the pattern; transactional pages (forms, settings) don't.

**Partial state desync (the big one).** If `MetricCard(Pending Approval)` shows 4 but `PendingApprovalCard` list shows 5, trust collapses faster than any visual polish can recover. Rule locked in §5: blocks deriving from the same underlying data must update together or not at all. Spec must define which blocks share state and update them in a single transaction.

**Reconnection gaps.** If the WebSocket disconnects briefly, missed events leave the dashboard stale until the next manual fetch. Spec must define reconnect behaviour: on reconnect, refetch all blocks once.

## 7. Open questions — resolved

| Question | Answer |
|---|---|
| Piece 3 now or later? | **Defer.** Layout slot reserved, content out of scope. |
| Standardise `<FreshnessIndicator>` now? | **Yes.** Trivial cost now, painful retrofit later. |
| System admin live-update behaviour? | **Yes, identical.** Consistency wins over role differences. |

## 8. Success criteria

- Operator logs into the home page, leaves it open, and sees pending-approval count and recent activity update without a refresh.
- Freshness indicator visibly moves and pulses, communicating currency.
- No regression in initial load time. Snapshot loads as fast as today.
- **No visible UI inconsistency between related data blocks during updates** (e.g. metric and list always agree).
- Internal operators stop refreshing the home page out of habit.
- Side-by-side: home dashboard feels visually as alive as `ClientPulseDashboardPage`.

## 9. Sequencing recommendation

1. Pieces 1 and 2 together as one ticket — they're effectively one user-visible change. ~3–5 days.
2. Defer Piece 3 to a follow-up sprint. Reserve layout slot in this build.
3. Capture standardisation work (freshness component, common emitter helper) inline; only refactor out if implementation suggests reuse is needed.

## 10. Next step

Move to technical specification. The spec must enumerate:

- Complete event-to-block mapping table
- Server emitter inventory and any gaps to fill
- Per-block refetch endpoint + version/timestamp contract
- `<FreshnessIndicator>` component contract and behaviour states
- Reconnect handling
- Test plan covering ordering, concurrency, idempotency, partial-state consistency, reconnect

All hard rules in §5 carry into the spec verbatim.
