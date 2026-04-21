# Universal Chat Entry Brief

> **Status:** Brief — not a spec. Shareable cross-branch thinking document.
> **Author:** main session on `claude/gohighlevel-mcp-integration-9SRII`
> **Audience:** the team working on the smart-router / Orchestrator front-end.
> **Date:** 2026-04-21

---

## Contents

1. What this is
2. Why now
3. Two entry modes (the user's process)
4. UX flow — end-to-end
5. Worked example A — GHL free-text CRM query (the trigger)
6. Worked examples B–F — why this is universal
7. How it plugs into the existing Orchestrator
8. Cost / safety posture
9. Non-goals
10. Open questions for the smart-router team
11. Suggested next step

---

## 1. What this is

A proposal for a single **system-wide free-text entry point** that lets any user — inside any subaccount, at any point in the product — ask "do this / find this / tell me about this" in plain English and have the Orchestrator figure out the right route.

This is the missing **front door** for the Capability-Aware Orchestrator we already shipped (`architecture.md` §Orchestrator Capability-Aware Routing). The Orchestrator today only receives tasks created through structured triggers. A universal chat entry point makes it reachable from every surface in the app without forcing the user to know which form to fill in.

This brief originated in a GHL MCP integration discussion (see the GHL worked example below), but the GHL case is one tile in a much bigger mosaic. Building this as GHL-only would be a mistake — the value is universal.

---

## 2. Why now

Three things have converged:

1. **Orchestrator is real.** Capability-aware routing ships, with four deterministic paths (A/B/C/D), `check_capability_gap`, and a budget-bounded decomposition loop. The decision layer exists; it needs a conversational UX.
2. **Free-text CRM querying is table stakes.** External guides are teaching agency owners to install Claude Code + MCP servers in their terminals to query their CRM in English. If users have to leave our product to get that ergonomic, we're leaking them. A universal chat entry point absorbs that category under our governance layer.
3. **Cost telemetry is trustworthy.** Hermes Tier 1 shipped per-run cost panels and `runCostBreaker` hard ceilings (`server/lib/runCostBreaker.ts`). We can now route free-text queries through the LLM router without fearing silent budget blow-up.

---

## 3. Two entry modes (the user's process)

The same free-text box supports two commit levels, chosen by where it's placed:

### Mode 1 — Fire-and-forget (task creation)

User types a request in a context that implies "do this and report back" — e.g. a floating action button, a dashboard CTA, an "assign to Orchestrator" flow. Submitting:

- Creates a `tasks` row (same path as any other org task).
- `org_task_created` trigger fires `orchestratorFromTaskJob`.
- Orchestrator classifies it (Path A/B/C/D) and dispatches.
- User gets a notification when the task resolves.

This is the zero-interaction path. Good for "research this lead", "book a follow-up with Sam", "draft a proposal email" — things the user trusts the system to handle.

### Mode 2 — Conversational (chat UX)

User types in a persistent search bar at the top of the app. Submitting **transitions the screen into a chat UX** with:

- Previous conversations listed on the left (same pattern as any mainstream LLM chat product).
- The current thread on the right, starting with the user's query.
- Orchestrator responds with its interpretation + proposed next step.

The key divergence from Mode 1: **the Orchestrator vets the query and proposes before acting**, with the threshold for auto-dispatch vs human-approval tied to the cost/risk of being wrong.

Three response shapes the Orchestrator can return:

| Response | When | Example |
|---|---|---|
| **Direct answer** | Read-only, cheap, confidence high | "You have 14 VIP contacts with no activity in 30 days. Here they are:" (renders table inline) |
| **Proposal + approval** | Write path, or read path with non-trivial cost, or ambiguous intent | "I can send a follow-up email to all 14 contacts using the 'Quarterly Check-in' template. Review the list, then approve." |
| **Clarification** | Intent is ambiguous between multiple capability slugs | "Did you mean contacts with no *engagement* in 30 days, or no *pipeline activity*? The first checks emails/SMS, the second checks deal stage changes." |

Once the user approves (or the Orchestrator self-approves a safe read), the chat continues — follow-up queries, refinements, further tasks — all within the same thread, with rolling context.

---

## 4. UX flow — end-to-end

Step-by-step, as a user would experience it:

1. **Entry** — user sees a persistent "Ask anything" bar in the global header. Placeholder rotates between concrete examples ("Find VIP contacts inactive 30d", "Draft the weekly client report", "What's blocking our deals?").
2. **Type + submit** — plain English, no operators, no dropdowns.
3. **Two branch points, transparent to user:**
   - If the query reads like a one-shot fire-and-forget (detected by length, imperative mood, reference to external delivery), Orchestrator treats it as task creation (Mode 1) and shows a toast: *"Task filed. I'll report back."*
   - Otherwise, the page slides into chat mode (Mode 2). Left rail shows prior conversations; right shows the new thread.
4. **Orchestrator classifies** — runs the existing decomposition pipeline (`list_platform_capabilities` → draft slugs → `check_capability_gap` → classify A/B/C/D).
5. **Orchestrator responds** with one of the three response shapes above.
6. **User acts** — approves, refines, or starts a follow-up. Every write action still goes through the review layer; the chat just surfaces the review step inline instead of buried in a notifications panel.
7. **Thread persists** — conversations are saved per user, searchable, sharable with team (later).
8. **Outcome telemetry** — every resolved thread writes a `routing_outcomes` row so the Orchestrator's decision quality can be measured (the machinery for this already exists).

The headline UX promise: **one box, anywhere in the app, solves the question in as few clicks as the question warrants.**

---

## 5. Worked example A — GHL free-text CRM query (the trigger)

Original context: external guides teach users to run Claude Code + GHL MCP in a terminal to query their CRM in English. We want the same ergonomics **inside** our product, so users don't leave.

Concrete flow:

1. User in subaccount `acme-main` types: *"Show me contacts active in the last 60 days who haven't been assigned to anyone yet."*
2. Orchestrator decomposition extracts capabilities: `contact_list` (read, CRM) + filter predicates.
3. `check_capability_gap` → Path A (connected agent `Revenue Ops` has `contact_list` on the `ghl` integration, token active, scopes sufficient).
4. Orchestrator routes to a helper skill — call it `crm.live_query` — backed by `ghlAdapter` under the existing per-location rate limiter. **No structured canonical schema is needed for this query.** The free-text surface is specifically for long-tail reads canonical doesn't cover.
5. Results stream into the chat as a table.
6. User clicks a row → drills into the canonical contact page (canonical data is still the record of truth for anything we've ingested).
7. User types follow-up: *"Email them a check-in."* → Orchestrator proposes the structured `crm.send_email` action with the template picker filled in. **This is a write, so the review gate is mandatory.** User approves inline.

**What this demonstrates:** live-query is a read-only escape hatch. Writes stay structured, stay review-gated, stay auditable. The chat layer just makes them conversational.

This pattern generalises to every CRM we integrate — one `crm.live_query` action dispatches to whichever adapter matches the subaccount's connected provider.

---

## 6. Worked examples B–F — why this is universal

The same entry point, same Orchestrator, very different downstream capabilities:

| Query | Route | Downstream |
|---|---|---|
| *"What's our pipeline velocity vs last month?"* | Path A — canonical read | `canonical_metrics` + ClientPulse drilldown render inline |
| *"Set up a nurture sequence for trial signups."* | Path B — configurable narrow | Handoff to Configuration Assistant with structured context |
| *"Summarise every open PR on the product-dev repo."* | Path A — dev integration read | Dev integration skill + rendered summary in chat |
| *"Book Sarah for a demo next Tuesday at 2pm."* | Path A — calendar write | Review-gated `crm.create_task` or calendar-write skill; user approves, task fires |
| *"Can you make an MCP connector for Xero?"* | Path D — unsupported | `request_feature` with `category: 'new_capability'`; user sees *"Filed as a feature request — here's the tracking link"* |
| *"Why did agent X fail run 4219?"* | Path A — observability read | Run trace + cost panel rendered inline (LLM-obs primitives already shipped) |

Every row uses the same UI, the same Orchestrator, the same review layer. The heavy lifting is already built; the smart-router / chat UX is the binding layer.

---

## 7. How it plugs into the existing Orchestrator

Today `orchestratorFromTaskJob` is triggered by `org_task_created`. To support Mode 2 (conversational), the smart router needs:

1. **A conversation entity** — `chat_threads` + `chat_messages` (or re-use the observability run table, TBD). Each user turn creates a message; each Orchestrator turn runs the decomposition pipeline and either answers directly or creates a proposal.
2. **A "pending proposal" state** — a proposal that's been drafted but not yet approved. UI renders it as an approve/refine/reject card.
3. **A cost preview** — before dispatching, the Orchestrator asks `runCostBreaker` + any provider cost estimator for a predicted spend. If it exceeds a user-configurable threshold, approval is required regardless of write-vs-read status.
4. **Tool-call transparency** — every tool the Orchestrator chooses to invoke renders as an expandable step in the chat (same pattern as any mainstream agent chat). Users can see *what's happening*, not just the final answer.
5. **Context roll-over** — follow-up messages carry the prior turn's intent into the next decomposition. Implementation: pass the prior `routing_outcomes` decision record as context to the next LLM call.

None of this contradicts the existing Path A/B/C/D routing. It adds an **interactive loop** around it.

---

## 8. Cost / safety posture

What the smart-router team should build with from day one:

- **Every chat turn routes through `llmRouter.routeCall`.** No direct provider calls. This keeps the in-flight registry, cost ledger, and budget breaker wired in automatically.
- **Per-thread cost ceiling.** Surfaced in the chat UI as "$0.04 used / $1.00 cap". User can raise the cap; default is conservative.
- **Review gating stays sacred.** Any action marked `defaultGateLevel: 'review'` in `actionRegistry` surfaces as an approval card in chat. Never auto-dispatched, even inside conversation context.
- **Read-only-by-default classification.** If intent is ambiguous between read and write, Orchestrator picks read. Writes require an explicit verb ("send", "create", "schedule", "update").
- **Per-subaccount rate-limit budget for live queries.** One noisy chat thread shouldn't starve ClientPulse polling. Reuse `getProviderRateLimiter(providerKey)` and consider adding a per-subaccount-per-minute MCP-call cap.

---

## 9. Non-goals

- **Not a replacement for structured UIs.** Dashboards, pipelines, reports, config pages — all stay. Chat is a shortcut, not a substitute.
- **Not a general-purpose LLM chat.** The chat surface is scoped to operating the user's own Synthetos environment. "Write me a haiku" gets politely declined.
- **Not exposed externally yet.** External MCP clients hitting the Orchestrator from outside the product is a later conversation. v1 is in-product only.
- **Not a replacement for the Orchestrator's task-trigger path.** Existing triggers (webhooks, scheduled jobs, agent handoffs) keep creating tasks exactly as they do today. Chat is an additional entry mode, not the only one.

---

## 10. Open questions for the smart-router team

1. **Thread storage model** — new `chat_threads` tables, or layer on top of existing `runs` / `tasks`? Preference: reuse, because every chat turn already maps to an agent run.
2. **Inline rendering primitives** — tables, charts, approval cards, tool-call expanders. Which exist, which need building? The run-trace viewer has half of these already.
3. **Conversation search** — full-text over prior threads. Postgres `tsvector` or something heavier?
4. **Cost preview UX** — every agent chat product struggles with this. What's our posture? "Likely costs $0.02" up-front, or retrospective display only?
5. **Hand-off to specialist agents mid-thread** — when the Orchestrator Path-B's a query to the Configuration Assistant, does the chat thread transfer to that agent or stay with the Orchestrator? Preference: stay with Orchestrator (single conversational surface), Orchestrator invokes the specialist as a sub-call.
6. **Multi-user threads** — can a team member pick up a colleague's thread? Not v1, but schema should not foreclose it.

---

## 11. Suggested next step

The smart-router team runs this through `architect` + `spec-reviewer` before starting implementation. The GHL MCP work on `claude/gohighlevel-mcp-integration-9SRII` will land `crm.live_query` as a concrete downstream capability for the chat layer to exercise on day one. The two branches should coordinate on the contract between the chat front-end and the `crm.live_query` action so one isn't blocked on the other.
