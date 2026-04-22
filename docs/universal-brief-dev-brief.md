# Universal Brief — Development Brief

**Status:** Draft development brief — intended for external LLM critique before becoming a spec
**Author:** Design session on `claude/research-questioning-feature-ddKLi`
**Audience:** architect, spec-reviewer, external LLM review, then implementation session
**Date:** 2026-04-22
**Related artefacts:**
- `docs/brief-result-contract.md` (v1 cross-branch contract — merged to main)
- `shared/types/briefResultContract.ts` (TypeScript types — merged to main)
- `tasks/research-questioning-design-notes.md` (prior session notes — now superseded by this brief)
- Universal Chat Entry Brief (prior session thinking document — supersedes details herein)
- CRM Query Planner Brief (separate branch; this document aligns with it)

---

## Contents

1. What this is
2. Why now
3. The north star
4. The Brief — entity, lifecycle, naming
5. The COO — agent persona and routing brain
6. Conversation scopes (v1: seven scopes)
7. Scope routing (subaccount / organisation / system)
8. The four capability workstreams
   - 8.1 Triage classifier
   - 8.2 Clarifying + Sparring Partner skills
   - 8.3 User-triggered memory capture
   - 8.4 Retrieval audit
9. End-to-end flow — how it all plugs together
10. Rationale — decisions we deliberately made
11. Cost and safety posture
12. Non-goals
13. Relationship to other in-flight work
14. Sequencing
15. Open questions for external review
16. Success criteria

---

## 1. What this is

A coordinated redesign of how users interact with Synthetos — unifying the entry point, the entity model, the conversation surfaces, and the intelligence primitives (clarification, challenge, memory) around a single concept called a **Brief**.

A Brief is the unit of interaction between a business operator and their virtual **COO** (the user-facing persona for the existing Orchestrator). It's where intent enters the system, where the conversation happens, where outcomes (answers, proposals, sub-tasks, feature requests) attach, and where memory is captured and cited.

This brief covers four linked pieces of work:
1. **The Brief entity and conversation surface** — elevating the existing "tasks" table's top-level record into a first-class "Brief" with a chat thread attached. Seven scopes get conversation surfaces in v1.
2. **Scope-aware routing** — Briefs can target subaccount, organisation, or system scope. The system detects scope from intent + UI context; falls back to a clarifying question when ambiguous.
3. **Four intelligence primitives** — a cheap triage classifier, two new capability skills (Clarifying Questions, Sparring Partner), a user-triggered memory capture flow with a Learned Rules library, and a retrieval audit.
4. **A shared cross-branch contract** — for renderable results (already merged to main as `docs/brief-result-contract.md` + `shared/types/briefResultContract.ts`) so the CRM Query Planner and other downstream capabilities can plug in without integration drift.

The combined effect: a business operator can speak plain English to the platform from anywhere in the app, get a conversational response from their virtual COO, and trust that the system will ask when it's uncertain, push back when the plan is weak, remember decisions they explicitly commit to, and show them exactly which rules influenced any action.

---

## 2. Why now

Three things have converged to make this the right moment:

**The platform primitives are ready.** The Orchestrator's capability-aware routing (Path A / B / C / D) shipped. Agent Live Execution Logs shipped. The LLM router, cost ledger, and run-level cost breakers are trustworthy. Memory infrastructure exists (memoryBlocks, workspaceMemoryEntries, belief extraction, weekly synthesis, citation scoring). None of this is new — but none of it is *reachable* to the user without going through the right form, the right page, the right agent.

**The front door is missing.** Today, users interact with the Orchestrator only through a "New Issue" form attached to a subaccount. There's no global "ask anything" surface. There's no conversational follow-up. There's no way to steer a Brief mid-execution. Users who know the magic phrases ("ask clarifying questions until 95% confident," "be my sparring partner, identify blind spots") get substantially more value from LLMs than users who don't — and platform-level adoption of these patterns means every user benefits, not just the tuned few.

**External guides are teaching our users to leave.** Agency owners are being taught to install LLM CLI tools with MCP servers locally to query their CRM in English. If we don't absorb this category into our product under our governance layer, our users leak out to terminal-based workflows with no multi-tenancy, no audit, no cost control. The CRM Query Planner brief (separate branch) is the direct response; this brief is the front door that surfaces the Planner and many other capabilities alongside it.

**Why the combined shape.** Each of the four workstreams above has standalone value, but they compound: the classifier needs a chat surface to route in; the skills need conversational context to produce useful output; memory capture needs a moment of decision to attach to; retrieval audit validates the substrate they all depend on. Building them as separate features across separate branches produces four unfinished corners. Building them as one coherent surface ships a product.

---

## 3. The north star

**One entry point. One entity. One conversation. Three scopes.**

- **One entry point** — a free-text "ask anything" surface reachable from any page in the app. Users never have to know which form to fill in.
- **One entity** — a Brief. It's the unit of interaction. Every free-text submission creates one. It may produce an answer inline, a proposal to approve, sub-tasks that execute, or a feature request — all attached to the same record.
- **One conversation** — the Brief has a chat thread. The user and their COO talk in that thread. When the COO delegates to a specialist agent, the user still sees the conversation in one place.
- **Three scopes** — subaccount (default), organisation, system. Intelligent routing picks; user confirms when ambiguous.

This is not a chat product. It's an operations layer with a conversational surface. The chat is subordinate to the work — every Brief has an outcome, an audit trail, and a structured record. The conversation is how that work gets shaped, not what the product is.

## 4. The Brief — entity, lifecycle, naming

**What it replaces.** The current product surfaces work items as "Issues" in the UI, backed by a `tasks` table in the schema. The name "Issue" reads as a bug-tracker concept, not what an agency operator actually does (brief their executive). The name "Task" reads as a to-do checklist item and has no natural fit for exploratory or read-only requests. Neither name matches the relationship we're modelling.

**The name.** A Brief. Executive parlance — agency owners already think in creative briefs, strategic briefs, client briefs. The verb matches ("brief the COO on this"). The noun handles all outcomes (a Brief can return an answer, a proposal, spawned work, or a filed feature request). And it sets the emotional register: users aren't filing tickets, they're directing their virtual executive.

**Schema impact — minimal.** The existing `tasks` table continues to be the store. Top-level records (`parentTaskId IS NULL AND isSubTask = false`) are user-facing "Briefs." Sub-tasks remain sub-tasks — agent-spawned execution units below the Brief. This is a UI relabel and a logical layering, not a schema rebuild. No data migration required.

**Lifecycle.** A Brief progresses through:

```
created (user types intent)
  → routed (COO analyses scope and capability)
    → one of four outcomes, all attached to the same Brief:
         direct answer (read-only, rendered in chat)
         proposal (inline approval card, awaits user confirmation)
         sub-tasks spawned (agent executes, reports back)
         feature request filed (Path D — capability gap)
  → closed (outcome rendered; conversation may continue for follow-ups)
```

The Brief remains browseable after closing. The conversation is preserved. Users can re-open Briefs to ask follow-ups, which create new turns in the same thread.

**Status model.** Briefs carry a richer status than tasks today: `open`, `awaiting_clarification`, `awaiting_approval`, `in_progress` (sub-tasks running), `closed_with_answer`, `closed_with_action`, `closed_no_action` (feature request filed), `cancelled`. This lets the UI filter and segment the Brief board without treating exploratory "what's my pipeline velocity" queries the same as operational "email these 14 contacts" actions.

**Naming of related concepts:**
- A Brief has **sub-tasks** (existing schema — agent-spawned execution units).
- A Brief has a **conversation** (the chat thread).
- A Brief may produce an **approval card** (proposal awaiting confirmation).
- A Brief may produce a **result** (structured data rendered inline).
- The user's **COO** is who the user briefs.

---

## 5. The COO — agent persona and routing brain

**What it is.** The Orchestrator (existing system-managed agent, migrations 0157 + 0158) is the routing brain: it receives a Brief, decomposes intent, runs capability-aware routing (Path A / B / C / D), and either answers directly or dispatches to specialist agents. Internally, everything stays named "Orchestrator" — the technical identity is unchanged.

**Why rename for users.** "Orchestrator" is technically correct but emotionally cold. An agency owner needs a mental model of *who they're talking to*, not *what routing engine the platform uses*. "COO" fits the relationship: the user is the CEO of their agency; they lack a Chief Operating Officer who can actually execute. The platform fills that gap.

**Why COO, not CEO.** Most agency owners *are* the CEO. Calling the AI "CEO" creates ambiguity and implies the AI outranks the user. "COO" is clearly the user's executor — runs the day-to-day, reports up. Natural relationship, no ambiguity.

**Configurability.** The user-facing label should be configurable at org level. Some teams will want "COO," others "Operations Lead," others will brand it ("Acme Ops Director"). The default is "COO." The backend identity stays "Orchestrator" for all technical references (masterPrompt, skill registry, logs).

**What the COO does inside a Brief:**
- Reads the user's input
- Asks clarifying questions if intent is ambiguous (threshold-triggered, not always)
- Routes to the appropriate capability (existing Path A–D logic)
- Challenges weak assumptions when stakes are high (threshold-triggered)
- Proposes structured actions with approval cards for writes
- Cites memory that influenced its decisions (provenance)
- Reports back with outcomes

**What the COO does NOT do:**
- Write directly to external systems without approval
- Guess silently when intent is ambiguous
- Flatter the user's plan when it has obvious weaknesses

---

## 6. Conversation scopes (v1: seven scopes)

Chat surfaces exist today only for Agents (per-agent chat at `/agents/{agentId}`, backed by `agentConversations` + `agentMessages`). V1 expands chat to six additional scopes, so users can converse with the system at the level that matches their current context.

**V1 scopes:**

| Scope | Use case | Counterparty |
|---|---|---|
| **Agent** | "Why did you decide X?" / general agent ops | The agent itself (exists today) |
| **Brief** | "Refine this proposal" / "add context" / "what's the status" | The COO, who delegates |
| **Task (sub-task)** | "Override how you're doing this" / "I have new info" | The agent assigned to the sub-task |
| **Recurring task** | "Change the cadence" / "skip this run" / "why did last run fail" | The recurring task's configured agent |
| **Playbook run** | "Diagnose this failure" / "why did the run stop here" | The playbook's owning agent |
| **Proposal / approval card** | "Discuss before I approve" / "what are the risks" | The agent that produced the proposal |
| **Agent run (execution log)** | "Why did you do this?" / "Why didn't you do that?" | Q&A over a specific run's log |

**Schema shape — polymorphic, extensible.** `agentConversations` is renamed to `conversations` and generalised with `scopeType` + `scopeId`. Adding a new scope later is one enum value + one service-layer handler, no schema migration.

**Deferred (Tier 3 — add when use case appears):**
- Organisation (covered by org-scope Briefs in most cases)
- Playbook definition (more a config concern)
- Integration / connection (config concern)
- Memory block / Learned Rule (edit the rule via library; don't chat about it)
- Subaccount and canonical-entity conversations — these are covered by the global input field with the relevant context auto-attached to a Brief. No dedicated pane needed.

**Inter-scope notifications.** A message in a sub-task conversation can surface as a notification on the parent Brief ("Sub-task #4 has a question"). Lets the COO orchestrate without the user having to hunt across surfaces.

---

## 7. Scope routing (subaccount / organisation / system)

Every Brief targets one of three scopes:

- **Subaccount** — operational queries about one client (the default, ~90% of Briefs)
- **Organisation** — cross-client queries ("total revenue across all clients," "which subaccounts had failed runs this week")
- **System** — platform-wide administration ("change the model router config," "add a new integration") — restricted to system admins

**Why three, not one.** A "subaccount-only" model would force the awkward "create a fake org subaccount" workaround for cross-client questions. Agency owners genuinely need cross-client visibility — it's part of the value proposition. The schema already supports this (tasks carry `organisationId` always + `subaccountId` nullable); the UI just needs to route accordingly.

**How routing works — layered, cheap first:**

1. **UI context (free).** Where the user is when they type. Inside a subaccount view → default subaccount. Inside org dashboard → default org. Inside system admin → default system.
2. **Heuristic keywords (free).** Scan intent for scope signals. Named client → subaccount. "All clients" / "across subaccounts" → org. "Router config" / "platform-wide" → system.
3. **Haiku fallback (cheap).** When tiers 1–2 disagree or confidence is low, a tight structured LLM call returns `{scope, confidence}`.
4. **Clarifying question (masterPrompt gate).** Triggered when the LLM's confidence is still low, or when detected scope requires permissions the user might not have. "Is this about [current subaccount] or your whole agency?"

**Permission enforcement.** If routing picks a scope the user can't access, the system downgrades silently to the highest scope they have (e.g. system → org for a non-sysadmin) or surfaces a soft refusal ("That's a platform-admin action — your Brief has been filed as a request to the platform team"). No silent failures.

**Why this isn't new infrastructure.** Scope detection is already one of the triage classifier's (W1) outputs. It's a richer output contract on the same classifier, not a separate system.

## 8. The four capability workstreams

Four pieces of intelligence infrastructure make the Brief surface useful. Each has standalone value, but they compound: together, they transform the COO from a passive router into an active thinking partner.

These workstreams were originally conceived before the Universal Brief surface was on the table — in response to YouTube tutorials teaching individual users to coax better output from LLMs by prompting for clarifying questions, sparring-partner mode, and saved skills. The ambition here is to elevate those patterns from per-prompt tricks into platform primitives, reachable from every interaction without users needing to know the magic phrases.

---

### 8.1 Triage classifier

**What it is.** A lightweight router that sits in front of the Orchestrator and decides — per Brief — what kind of handling the request needs. Not every free-text input needs a full Orchestrator run; some are one-liners that deserve a direct reply; others are ambiguous and need clarification before anything happens; others clearly need the full routing pipeline.

**Why it matters.** Today there's no triage step. Every task that meets the eligibility gates fires a full Orchestrator run — expensive, slow, overkill for simple queries. With a chat-shaped front door, this over-invocation gets worse: users will type "thanks" or "got it" as conversation fillers, and the system shouldn't dispatch an LLM run for them.

**Shape.**
- **Tier 1 — heuristic (zero LLM cost, ~1ms).** Keyword patterns, message length, UI context. Decides `simple_reply` / `needs_clarification` / `needs_orchestrator` / `cheap_answer` with a confidence score.
- **Tier 2 — Haiku fallback (~100ms, cents).** Triggered only when Tier 1's confidence is below threshold. Small structured output call; same decision space.

**Scope detection is one of its outputs.** The classifier returns `{route, scope, confidence}` — not just routing. Scope routing from §7 is a dimension of the same classifier, not a separate system.

**In-house precedent.** `queryIntentClassifier`, `topicClassifier`, `pulseLaneClassifier` — all three are existing heuristic-tier routers. The new classifier follows the same pattern (pure function + thin service wrapper + tests).

**Net new work.** One new service + pure twin + tests. Integration points at wherever Brief creation dispatches to the Orchestrator.

---

### 8.2 Clarifying + Sparring Partner skills

**What they are.** Two new capability skills alongside the existing four in `server/tools/capabilities/`:

- **`ask_clarifying_questions`** — when a Brief's intent is ambiguous or missing context, drafts ≤5 targeted questions ranked by ambiguity-reduction impact, posts them back to the user in the Brief's chat thread, pauses execution until answered.
- **`challenge_assumptions`** — when a proposed plan crosses a cost, irreversibility, or scope threshold, runs an adversarial analysis: identifies weakest assumptions, missing evidence, plausible counter-arguments. Output surfaces on the approval card.

**Why not always-on.** Platform-wide "always ask clarifying questions" creates dialog fatigue — users will learn to add noise just to get past the prompts. Platform-wide "always challenge" reads as condescension. Both lose signal if over-used. The value is threshold-triggered: ask when genuinely uncertain; challenge when stakes are genuinely high.

**Where the "when to invoke" logic lives.** In the Orchestrator's masterPrompt — the existing Path A–D routing gets two new gating heuristics:
- **Clarifying gate:** invoked when COO self-assessed confidence in task specification is below a threshold (mirroring the YouTube video's 95%-confidence framing).
- **Challenge gate:** invoked when a proposed plan crosses cost / irreversibility / scope thresholds.

**Why skills (execution) vs. masterPrompt (trigger) split.** Separation of concerns. The skills are pure capabilities — reusable from non-Orchestrator surfaces (e.g. an agent deciding to self-challenge). The masterPrompt is the policy surface that decides *when* — it can evolve without touching skill code.

**Risks.**
- **Threshold calibration.** Too aggressive = dialog fatigue; too conservative = dead feature. Mitigation: log every invocation, tune weekly for the first month post-launch.
- **Challenge tone.** Adversarial output that reads as pedantic tanks adoption. Tone spec is part of the skill prompt design. Target: "trusted colleague pushing back," not "pedantic reviewer."
- **Interaction with the triage classifier.** W1 flags "probably needs clarification" as a routing output; the masterPrompt makes the final call and invokes the skill. Both systems must agree on when to ask.

**Net new work.** Two capability skill handlers + masterPrompt migration + `actionRegistry` / `skillExecutor` registration.

---

### 8.3 User-triggered memory capture

**What it is.** A three-phase capability letting users explicitly capture durable rules from their conversations with the COO, browse and edit those rules in a library, and see which rules influenced any agent action.

**Why it matters.** The codebase has substantial memory infrastructure (`memoryBlocks`, `agentBeliefs`, `workspaceMemoryEntries`, `orgMemories`, weekly synthesis, citation scoring) but users can't see, author, or undo memories directly. The existing memory UIs are admin-facing governance surfaces, not everyday user UX. Memory exists but is opaque — users can't teach the system a rule in the moment, can't audit what's been learned, can't fix stale rules that quietly warp agent behaviour.

**Architectural principle: reuse over rebuild.** The existing memory infrastructure covers ~85% of what we need. This work is primarily a UX layer on top of existing tables (plus one new mechanism for agent-output citations).

**Three sub-phases, each independently shippable:**

#### 8.3.1 Slash command + Learned Rules library

**Goal.** Give users a way to save a rule in-the-moment, browse all saved rules, and edit / delete them.

**Scope.**
- **`/remember` slash command** in any Brief chat. Opens a capture dialog pre-filled with the immediately preceding context.
- **Capture dialog** — plain-English rule text, scope picker (this subaccount / this agent / whole org), optional context notes. Scope is mandatory, not optional.
- **Learned Rules library page** — filterable by scope, active/paused, date added, creator. Lists every user-triggered rule with edit / pause / delete controls.
- **5-second undo toast** after save — low-friction safety net.

**Reuses.** `memoryBlocks` + `memoryBlockVersions` (existing). Adds one source marker (e.g. `source='user_triggered'`) to distinguish user-captured rules from auto-synthesised ones.

**Important design decision: user-triggered rules skip the admin review queue.** They go live at their chosen scope immediately. The user explicitly vouched for them — an extra gate is overkill friction. If multi-user governance at org scope proves needed later, add a lightweight admin confirmation specifically for `scope=org` rules, not a blanket gate.

#### 8.3.2 Approval-gate suggestion + teachability heuristic

**Goal.** When the user approves or rejects a proposal through an approval card, offer an optional in-context "teach the system?" prompt with LLM-drafted candidate rules.

**Scope.**
- **Teachability filter** — decides whether to surface the capture prompt at all. Novel decisions trigger it; routine approvals don't.
- **Candidate drafter** — a Haiku-tier LLM call reads the approval context and drafts 2–3 plain-English rule candidates, each fitting one of a fixed set of categories (preference, targeting, content, timing, approval, scope).
- **In-approval suggestion panel** — appears below the approve/reject action after the decision lands. Candidate options + "custom" text field + scope picker. Prominent "Not now" dismiss.
- **Rejection path** — reworded to "avoid next time" framing. Rejections are often higher-signal than approvals.
- **Auto-backoff** — if the user skips N suggestions in a row, pause suggestions for a cooldown window. Per-user frequency setting (off / occasional / frequent).

**Important design decision: hybrid candidate generation.** A fixed category taxonomy + LLM fill-in. Not pure LLM freeform (quality drift). Not hardcoded templates (brittle). Hybrid gives consistency with relevance.

**Important design decision: "Not now" is always first-class.** The suggestion panel is secondary to the approval action — the approval completes whether or not the user engages.

#### 8.3.3 Provenance trail on agent outputs

**Goal.** When an agent acts on a remembered rule, show *which rule* influenced the output — so bad rules are discoverable at the moment they misfire.

**Scope.**
- **Log which rules were injected into an agent's context on every run.** New field on `agentRuns`: `appliedMemoryBlockIds`. Today, runs track `citedEntryIds` for workspace entries but not for named memory blocks.
- **Extend the citation detector** to score `memoryBlocks` against agent outputs. Reuses existing `memoryCitationDetector` patterns.
- **Prompt modification** — agents are prompted to cite rules when they act on them.
- **UI surfacing** — agent output cards show "Rules applied: [rule X], [rule Y]." Clicking jumps to the Learned Rules library with that rule focused for editing.

**Why this phase is the most ambitious.** Touches the agent execution loop, run logs (schema change), citation detection (service extension), prompt templates, and a new UI component. Likely a separate session's worth of work. Depends on the retrieval audit (§8.4) to scope correctly — if retrieval is leaky, scope grows.

**Why provenance is non-negotiable for long-term scalability.** A memory system you can't see is actively dangerous. A wrong rule could quietly warp agent behaviour for months. Provenance makes bad rules findable the moment they misfire — it's the mechanism that makes the whole memory system trustworthy at scale.

---

### 8.4 Retrieval audit

**What it is.** Not a build — an investigation. Half-day to one-day audit answering: "Does the existing memory infrastructure actually reach agents at the right moment, or is capture writing into a void?"

**Why it matters.** All of §8.3 only works if memory retrieval is sound. Capture without retrieval is a silent failure mode: users save rules, trust the system to apply them, and the system quietly doesn't. That's worse than no memory at all — it erodes trust asymmetrically.

**Questions the audit should answer:**
1. When a task is assigned to an agent that has relevant `memoryBlocks`, are those blocks actually injected into the agent's context? Trace the path end-to-end.
2. When `agentBeliefs` exist for an agent-subaccount pair, do they measurably influence decisions?
3. Do `workspaceMemoryEntries` (insights) get cited at expected rates? Pull citation rate from the last 30 days.
4. Scope resolution — when an agent runs for subaccount X, does context assembly correctly pull subaccount / agent / org rules in the right priority? This is the biggest risk area.
5. Is there a context-bloat problem? When many blocks / beliefs exist, are they all injected (token waste) or is there relevance ranking?

**Deliverable.** A short report at `tasks/research-questioning-retrieval-audit.md`:
- Current retrieval behaviour, surface by surface
- Gaps found (critical / moderate / minor severity)
- Recommendations for §8.3.3 scope (does provenance alone suffice, or do we need retrieval fixes too?)

**Why this goes first in the sequence.** Cheap insurance. Half a day of investigation before committing to §8.3.3 (the most expensive phase) can save a week of building on a broken foundation. Also informs §8.3.1 and §8.3.2 — if retrieval is fine today, we can focus on capture UX with confidence.

## 9. End-to-end flow

A worked example showing how the pieces compose. User types into the global ask bar while viewing a subaccount dashboard: *"Show me VIP contacts inactive 30 days and email them a check-in."*

```
1.  Global ask bar captures input + UI context (subaccount_id = "acme")
        ↓
2.  Brief created with scope = subaccount (Tier 1 UI context wins; no LLM call)
        ↓
3.  Triage classifier (W1) runs — heuristic tier first:
    - Has action verb ("email") → needs_orchestrator
    - Has data query ("VIP contacts inactive 30 days") → needs_orchestrator
    - Confidence high → skip Tier 2 Haiku
        ↓
4.  Orchestrator (COO) routes:
    - Decomposes intent: {read: VIP contact query} + {write: send email}
    - Read part → invokes crm.query_planner capability (separate branch)
    - Planner returns BriefStructuredResult (per contract):
        summary: "14 VIP contacts inactive 30 days"
        rows: [...]
        filtersApplied: [tag=VIP, lastActivity<30d]
        suggestions: ["Narrow to last 7d", "Sort by oldest activity"]
    - Write part → flags for approval (destructive action)
        ↓
5.  Brief chat renders:
    - The structured result (table + chip for filters + suggestions)
    - BELOW: an approval card for the email send:
        summary: "Send 'Quarterly Check-in' email to 14 VIP contacts"
        actionSlug: "crm.send_email"
        affectedRecordIds: [14 UUIDs]
        riskLevel: "medium"
        estimatedCostCents: 5
        ↓
6.  Orchestrator masterPrompt evaluates challenge gate:
    - 14-contact email crosses the "medium scope" threshold
    - Invokes challenge_assumptions skill
    - Output surfaces on the approval card: "Two of these 14 contacts
      opted out of bulk email in the last 30d — proceed?"
        ↓
7.  User sees the result, reviews the approval card + challenge,
    maybe clicks a suggestion ("Sort by oldest activity") to refine,
    then approves the email send
        ↓
8.  Action dispatches through existing review-gated crm.send_email action
    (same path as any structured write)
        ↓
9.  Sub-task spawned under the Brief for the send — tracked in real time
        ↓
10. On completion: teachability heuristic (W3b) evaluates:
    - Novel decision (first VIP bulk email from this user)
    - Suggestion panel appears:
        "Teach the system? 'Always exclude contacts with recent opt-outs
         from VIP bulk email' — scope: Cold Outreach Agent"
    - User clicks "Save rule"
    - Rule written to memoryBlocks with source='user_triggered'
        ↓
11. Next time the user runs a similar Brief, the COO's output surfaces:
    - "Applied rule: Always exclude contacts with recent opt-outs" 🔗
    - Provenance trail (W3c) lets the user click through if the rule misfires
        ↓
12. Brief closes with outcome attached; conversation thread preserved;
    user can re-open and ask follow-ups anytime
```

**What this flow demonstrates:**
- Single entry point (global ask bar), single entity (Brief), single conversation thread
- Classifier (W1), clarifying/sparring skills (W2), memory capture (W3a+b+c), CRM query planner all compose transparently
- Read-only results render inline; writes are always review-gated
- The user never sees the underlying routing machinery — they see a conversation with their COO

---

## 10. Rationale — decisions we deliberately made

External review is likely to question these. Each has a rationale; each has rejected alternatives.

### 10.1 Single entity (Brief), not two modes

**Rejected alternative:** the Universal Chat Entry Brief's Mode 1 (fire-and-forget task) + Mode 2 (conversational chat) split.

**Why rejected:** two parallel state models create confusion ("did I file a task or start a chat?"), force the client to render two different entity types, and artificially limit conversational follow-up on "task" paths. A user who fire-and-forgets a Brief might then want to steer it mid-execution — the separate-modes model makes that awkward.

**What we chose:** one entity (Brief), which may or may not be conversational depending on how the COO responds. If the intent is clear and low-risk, the COO just acts — it looks like fire-and-forget because no clarification was needed. If clarification or approval is needed, the chat opens for back-and-forth. Same entity; the "mode" is an emergent property, not a user-visible fork.

### 10.2 Per-message memory extraction rejected

**Rejected alternative:** background job extracting preferences/decisions from every chat message.

**Why rejected:** poor signal-to-noise (most messages are coordination chatter), floods the existing human review queue, duplicates the weekly synthesis pipeline with worse quality.

**What we chose:** two trigger points only — user-triggered (`/remember` slash command) and approval-gate suggestions on high-signal decisions. The weekly synthesis continues to do pattern-based extraction from full run transcripts where it already adds value.

### 10.3 "Turn conversation into skill" explicitly out of scope

**Rejected alternative:** mirroring the YouTube video's tip #3 directly — letting users mint reusable skills from their chat sessions.

**Why rejected:** skills in Automation OS are system-level primitives authored by developers/admins, not per-user artefacts. Per-user skill generation creates governance issues — naming collisions, quality drift, audit burden, scope confusion across subaccounts.

**What we chose:** the intent behind the tip ("let the system learn from conversations") is served better — and safer — by the W3 memory capture flow. Users accumulate rules, not skills; rules are interpretable data the agents read, not executable code the agents invoke.

### 10.4 User-triggered rules skip admin review gate

**Rejected alternative:** every user-triggered rule flows through the existing `pending_review` queue before going live.

**Why rejected:** the user explicitly vouched for the rule — adding a second gate creates friction without obvious safety gain. If the review queue gets swamped with user-captured rules, reviewers either rubber-stamp (unsafe) or fall behind (feature goes dead).

**What we chose:** user-triggered rules go live immediately at their explicit scope. If governance concerns emerge at org scope (where one user's rule affects everyone), add a lightweight admin confirmation specifically for `scope=org` rules. Scope determines the gate, not the source.

### 10.5 Reuse existing memory infrastructure (no parallel system)

**Rejected alternative:** a purpose-built "Learned Rules" table separate from `memoryBlocks`.

**Why rejected:** parallel memory systems create two sources of truth, double the governance burden, and waste engineering capacity on duplicated infrastructure. The codebase's memory tables were built exactly for this.

**What we chose:** `memoryBlocks` gains a source marker (`source='user_triggered'`). The Learned Rules library is a new *view* over existing data, not new data. Weekly synthesis and decay continue to work because they're scope-agnostic on source.

### 10.6 Triage classifier is two-tier heuristic-first, not pure LLM

**Rejected alternative:** every chat message goes through a Haiku call for triage.

**Why rejected:** cost discipline and latency. Most messages are unambiguous; an LLM is overkill. Three existing in-house classifiers (`queryIntentClassifier`, `topicClassifier`, `pulseLaneClassifier`) all use heuristic-first patterns for the same reason.

**What we chose:** Tier 1 heuristic (~1ms, zero cost) decides confidently for most cases. Tier 2 Haiku fallback (~100ms, cents) only for genuinely ambiguous cases. Logged classifications make drift visible for tuning.

### 10.7 Clarifying + Sparring are threshold-triggered, not always-on

**Rejected alternative:** every interaction gets a clarifying question / adversarial challenge pass.

**Why rejected:** platform-wide overuse kills the signal. Users learn to add noise to bypass clarification; challenges start reading as condescension. The YouTube video's "add to every prompt" framing works for individual users who know they're doing it; at platform scale it backfires.

**What we chose:** threshold gates in the Orchestrator masterPrompt. Clarify when confidence is low. Challenge when stakes are high. Log both to tune thresholds.

### 10.8 Provenance is read-only on agent output surface

**Rejected alternative:** inline rule editing from the agent output card.

**Why rejected:** single source of truth matters. Duplicating rule-edit UX on every agent output card creates maintenance burden and inconsistent state (which version is authoritative?).

**What we chose:** provenance display on agent output is read-only with click-through to the Learned Rules library, where editing happens. One edit surface; many read surfaces.

### 10.9 COO persona, not CEO

**Rejected alternative:** "CEO" as the user-facing Orchestrator label.

**Why rejected:** most agency owners *are* the CEO. Calling the AI "CEO" implies the AI outranks the user and creates relationship ambiguity.

**What we chose:** COO. Clearly the user's executor — runs the day-to-day, reports up. Configurable at org level for teams that want different branding ("Operations Lead," "Acme Ops Director"). Internally, everything stays "Orchestrator."

### 10.10 Polymorphic conversation schema, not one table per scope

**Rejected alternative:** seven distinct tables (`briefConversations`, `taskConversations`, `playbookRunConversations`, etc.) for each conversation scope.

**Why rejected:** N tables for N scopes doesn't scale. Adding a scope later (e.g. playbook definitions) requires migration, service, UI plumbing. High friction for expected evolution.

**What we chose:** single `conversations` table with `scopeType` (enum) + `scopeId` (UUID). Adding a scope is one enum value + one service-layer handler. Service layer enforces referential integrity since the FK is logical, not DB-enforced.

## 11. Cost and safety posture

Key invariants the implementation spec must preserve:

- **Every LLM call routes through `llmRouter.routeCall`.** No direct provider calls anywhere. This keeps the in-flight registry, cost ledger, and budget breaker wired in automatically.
- **Per-Brief cost ceiling.** Each Brief accrues spend; a visible "$0.04 used / $1.00 cap" surface lets the user see where they are. Default caps are conservative; user can raise.
- **Review gating stays sacred.** Any action marked `defaultGateLevel: 'review'` in `actionRegistry` surfaces as an approval card — never auto-dispatched, even inside conversation context.
- **Read-only-by-default.** When the classifier is ambiguous between a read and a write, the COO picks read. Writes require an explicit verb ("send," "create," "schedule," "update").
- **Per-subaccount rate-limit awareness.** A noisy Brief thread shouldn't starve ClientPulse polling or outcome-measurement jobs. Existing `getProviderRateLimiter` budgets apply; consider a per-subaccount-per-minute cap on free-text provider reads.
- **Scope + RLS enforcement at capability boundaries.** Capabilities emit results already scoped — no post-filtering at the chat layer, because post-filtering is brittle for aggregates.
- **User-triggered rules still audit-trailed.** Even though they skip review, every save writes to `memoryBlockVersions` with `createdByUserId` — full audit trail preserved.
- **The Orchestrator's capability-query budget (8 calls / run) is preserved.** Clarifying and sparring invocations count against this budget.

---

## 12. Non-goals

Explicit non-goals, so an external reviewer doesn't propose them as scope expansion:

- **Not a general-purpose LLM chat product.** The Brief surface is scoped to operating the user's Synthetos environment. "Write me a haiku" gets politely declined.
- **Not a replacement for structured UIs.** Dashboards, pipelines, reports, subaccount pages — all stay. The Brief is a shortcut, not a substitute.
- **Not a replacement for existing Orchestrator trigger paths.** Webhooks, scheduled jobs, agent handoffs continue to create tasks exactly as they do today. The Brief surface is an *additional* entry mode.
- **Not exposed externally yet.** External MCP clients hitting the Orchestrator from outside the product is a later conversation. V1 is in-product only.
- **Not per-user skill authoring.** Skills remain system-level primitives. The intent from the YouTube video's tip #3 is served by user-triggered memory rules instead.
- **Not automatic memory extraction from every chat message.** Capture is user-triggered (W3a) or decision-point triggered (W3b). The weekly synthesis job continues its existing cadence for pattern-based extraction.
- **Not a parallel memory system.** All user-triggered rules land in `memoryBlocks`; no new memory tables.
- **Not streaming / progressive result rendering in v1.** One-shot artefacts per turn. If streaming is needed later, it's an additive contract change.

---

## 13. Relationship to other in-flight work

### 13.1 ClientPulse (in-flight, other branch)

ClientPulse Phase 4 + 4.5 has merged via PR #152, but ClientPulse remains mid-flight overall — refactors and follow-on changes are in progress. This brief does not interfere with ClientPulse execution; it waits.

**Dependency direction:** none either way. ClientPulse's intervention + outcome measurement loops are internal to ClientPulse; the Brief surface doesn't touch them. Later, a Brief could query ClientPulse's outcome data ("how did our intervention do last month?") — that's a read query against canonical data, no integration work.

### 13.2 Tier-1 tech-debt paydown (foundational, other branch)

Four ghost features from a recent audit need fixing before the Brief work starts:
1. Per-run cost panel in agent run detail pages
2. Success-gated memory promotion (`extractRunInsights` currently fires unconditionally)
3. Per-agent `maxCostPerRunCents` enforcement
4. System P&L client page

**Dependency direction:** (2) is a hard prerequisite for W3. If the memory substrate is writing low-quality auto-extractions, user-triggered rules will land alongside garbage and the Learned Rules library will be polluted.

### 13.3 CRM Query Planner (separate branch, parallel)

The CRM Query Planner is a *capability* that plugs into the Brief surface. It's UI-agnostic by design — v1 can ship as a dedicated "Ask CRM" panel while the universal Brief surface is being built in parallel, and converge later.

**Dependency direction:** two-way contract dependency, already resolved.
- `docs/brief-result-contract.md` + `shared/types/briefResultContract.ts` merged to main define the shared shape.
- The CRM Planner branch emits `BriefStructuredResult` / `BriefApprovalCard` / `BriefErrorResult` per contract.
- The Brief surface branch renders those artefacts per contract.
- Both branches can develop independently after the contract landed.

### 13.4 Agent Live Execution Logs (shipped, PR #166)

Shipped. The Brief surface benefits — a Brief's "agent run" conversation scope (§6) reads from the execution log. No duplication; the chat is a conversational layer over the already-persisted log.

### 13.5 Hermes Tier 1 (shipped)

Shipped. Per-run cost panels, `runCostBreaker` enforcement, cost aggregates, ledger-based cost reads — all live. The Brief surface can surface cost information to users (the "$0.04 used" display) because this infrastructure is ready.

---

## 14. Sequencing

### Prerequisite: finish ClientPulse + Tier 1 paydown

Do these first. This brief's work starts after they land.

### Proposed phase order

Each phase is independently shippable. Stop after any phase and the app remains coherent.

| Phase | Scope | Effort |
|---|---|---|
| **P0** | Retrieval audit (§8.4) | Half-day — investigation only |
| **P1** | Entity relabel: "Issue" → "Brief" in UI; COO persona label; Brief detail page layout (chat + sub-tasks + artefacts) | ~1 week |
| **P2** | Universal Brief entry bar in global header; free-text submission creates a Brief; `conversations` polymorphic schema for Brief + Task scopes first | ~1–2 weeks |
| **P3** | Triage classifier (W1) including scope detection | ~1 week |
| **P4** | Clarifying + Sparring Partner capability skills (W2) + masterPrompt gates | ~1 week |
| **P5** | Memory capture W3a — `/remember` + Learned Rules library + Scope picker UI | ~1 week |
| **P6** | Memory capture W3b — teachability heuristic + approval-gate suggestion + candidate drafter | ~1–2 weeks |
| **P7** | Conversation scopes expanded to full v1 seven scopes (recurring task, playbook run, proposal, agent run log) | ~1 week |
| **P8** | Memory capture W3c — provenance trail on agent outputs | ~2–3 weeks (depends on P0 audit) |
| **P9** | CRM Query Planner integration with Brief surface (converging from separate branch's dedicated panel) | Coordination, not code — ~days |

**Total effort estimate:** ~8–12 weeks, multi-session. This is not a single-session build.

**Parallelism opportunities:**
- P3, P4, P5 can run in parallel with different owners (minimal shared surface).
- CRM Query Planner's separate branch runs throughout; convergence at P9.
- P8 is intentionally late — it touches the agent execution loop and requires P0's findings.

---

## 15. Open questions for external review

**The main purpose of this document is to invite critique on these. Please challenge any of them.**

### 15.1 Is "Brief" the right name?

We chose it for agency-native fit and executive parlance. Alternatives considered: Directive, Ask, Objective, Matter. Is there a better name? Does "Brief" clash unhelpfully with engineering usage (design briefs, implementation briefs)? Will non-English markets translate it cleanly?

### 15.2 Is three-level scope routing (subaccount / org / system) over-engineered for v1?

The alternative is "subaccount only, use a dedicated org page for cross-client queries." We rejected it on UX grounds (awkward workaround). Is system-level scope especially premature? Should we defer it?

### 15.3 Is seven conversation scopes in v1 too many?

Agent, Brief, Task, Recurring Task, Playbook Run, Proposal/Approval card, Agent Run Log. Could this be phased — e.g. Brief + Task + Agent for initial release, others following? What's the usability risk of conversing at too many levels?

### 15.4 Is the polymorphic `conversations` schema the right call?

`scopeType` + `scopeId` is flexible but sacrifices DB-enforced referential integrity. Alternative: distinct tables per scope (`briefConversations`, `taskConversations`, etc.). Worth revisiting if expected scope growth is low?

### 15.5 Does the triage classifier two-tier pattern scale?

Heuristic first, Haiku fallback. What's the expected miss rate at Tier 1? How quickly will heuristic drift make Tier 2 the dominant path? Is there a risk of Tier 1 producing high-confidence wrong answers (worst failure mode)?

### 15.6 Can the teachability heuristic work without training data?

W3b's pre-filter decides which approvals are "teachable." Without labelled data, the initial heuristic is rule-based. Is that sufficient to avoid false-positive suggestions (annoying users) and false-negatives (missing learning moments)?

### 15.7 Is provenance trail (W3c) achievable without re-architecting context injection?

The existing context injection pipeline may not cleanly expose "which blocks were injected." If it doesn't, W3c grows to include a context-injection refactor — possibly a multi-week scope expansion.

### 15.8 Does the unified Brief entity scale?

Every free-text query becomes a Brief. Read-only queries ("what's my pipeline") create Brief records that close with an answer. Will the Brief board get polluted with exploratory queries, making it hard to find actionable Briefs? Is the `closed_with_answer` status enough to filter them out, or does the UX need something stronger?

### 15.9 Is the CRM Query Planner contract flexible enough?

`BriefStructuredResult` + `BriefApprovalCard` + `BriefErrorResult`. The CRM Planner will emit these. Is the contract missing anything obvious for complex query results (charts, time series, multi-entity joins)? Is `rows: Array<Record<string, unknown>>` too loose or appropriately flexible?

### 15.10 Is the sequencing realistic given everything else in flight?

The brief assumes ClientPulse + Tier 1 paydown complete before this starts. That's a ~4-week queue in front of a ~8–12 week build. Is this the right priority given other commitments? What should be descoped or phased further?

### 15.11 Does the "everything routes through the COO" framing hold?

Is it confusing to have the COO be both the routing engine AND the persona the user talks to? Would a separate "receptionist" persona (routes) vs "COO" (decides) be clearer? Or is that over-engineering?

### 15.12 What are we missing?

The most valuable response to this document is a question we haven't asked ourselves. Please look for those.

---

## 16. Success criteria

The brief is ready to become a detailed spec when a reviewer can answer yes to all of:

1. Does the single-Brief entity model eliminate the two-mode confusion without creating new state problems?
2. Is the scope-routing layered approach (UI context → heuristic → LLM → clarify) robust enough to avoid misrouting? Does it degrade gracefully when the user lacks permissions for the detected scope?
3. Is the COO persona clear enough that users know who they're talking to, but flexible enough for orgs to rebrand?
4. Are the four capability workstreams (classifier, clarifying, sparring, memory) well-enough differentiated that they can be built and tuned independently?
5. Does the memory capture flow (W3) genuinely give users control without creating governance risks (stale rules warping behaviour, bad rules hidden from audit)?
6. Does the provenance trail (W3c) actually make bad rules discoverable at the moment they misfire, or is it cosmetic?
7. Does the end-to-end flow (§9) demonstrate that the pieces compose — or are there breakage points where the abstractions leak?
8. Does the cost + safety posture ensure no silent budget blow-ups, no direct provider calls, no bypassing of review gates?
9. Does the CRM Query Planner plug in cleanly through the shared contract, or is further integration work needed?
10. Is the sequencing honest about what's a week vs. what's a multi-week effort?

If yes to all ten, the brief is ready to become a spec via `architect` + `spec-reviewer`.

---

*End of development brief.*
