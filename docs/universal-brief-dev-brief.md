# Universal Brief — Development Brief

**Status:** Draft development brief — revision 4 (final iteration pass before spec)
**Author:** Design session on `claude/research-questioning-feature-ddKLi`
**Audience:** architect, spec-reviewer, further external review rounds, then implementation session
**Date:** 2026-04-22
**Related artefacts:**
- `docs/brief-result-contract.md` (cross-branch contract — merged to main, amended for `confidence` field)
- `shared/types/briefResultContract.ts` (TypeScript types — merged to main, amended for `confidence` field)
- `tasks/research-questioning-design-notes.md` (prior session notes — now superseded by this brief)
- Universal Chat Entry Brief (prior session thinking document — supersedes details herein)
- CRM Query Planner Brief (separate branch; this document aligns with it)

**Revision history:**
- **rev 1** (initial draft) — captured full session's design thinking on Brief entity, COO persona, seven conversation scopes, triage classifier, clarifying/sparring skills, three-phase memory capture, retrieval audit.
- **rev 2** (post external review round 1) — incorporated external critique:
  1. Reframed W1 from "classifier in front of Orchestrator" to "Orchestrator's fast path" (triage + scope detection is architecturally part of the Orchestrator, not a separate concern).
  2. Reduced v1 conversation scopes from seven to four (Brief, Agent, Task, Agent run log).
  3. Tightened Brief framing as "control plane, not work plane" — Brief coordinates; surfaces attached to it (memory, approvals, execution) live in their own systems.
  4. Added new sub-phase §8.3.2 — rule precedence model + conflict detection + quality scoring + auto-deprecation — before the memory capture scales.
  5. Added classifier safety nets — shadow-eval logging, risk-aware second-look, confidence decay.
  6. Added optional `confidence` field to `BriefStructuredResult` and `BriefApprovalCard` (contract amended on main) + §11.4 UX guidance.
  7. Added §11.5 observability and failure visibility — instrumentation as a day-zero concern.
  8. Updated sequencing (§14) to reflect the new sub-phase and four-scope v1.
  9. Updated open questions (§15) — marked resolved items, reframed remaining ones.
- **rev 3** (post external review round 2) — contract extensions accepted pre-build rather than retrofitted later:
  1. **Artefact lifecycle primitives.** Added `artefactId` (required), optional `status` (`final` / `pending` / `updated` / `invalidated`), `parentArtefactId`, `relatedArtefactIds`, per-artefact `contractVersion`. Enables streaming, refresh flows, and loose artefact relationships without contract churn later. See §11.1.
  2. **Structured result — `columns` + `freshnessMs`.** Soft schema hint for deterministic UI rendering; data-freshness signal that disambiguates cached provider data (still `live`, non-zero `freshnessMs`) from true canonical reads. See §11.2.
  3. **Approval card — `executionId` + `executionStatus`.** Execution linkage so approvals transition through pending → running → completed/failed on a single artefact chain. See §11.2.
  4. **Error — `severity` + `retryable`.** Drives UX treatment (toast / banner / modal) and retry affordance. See §11.2.
  5. **Budget context on structured + approval artefacts.** Optional `budgetContext` populated by the orchestrator for "you've used N% of your limit" UX. See §11.2.
  6. **RLS defence in depth.** Added §11.3 recommending an orchestrator-level sanity-check backstop in addition to capability-layer primary enforcement. One mis-implemented capability shouldn't be able to leak tenant data.
  7. **Tightened `source` semantics.** Cached provider data is `live` with non-zero `freshnessMs`, not mis-classified as canonical. Freshness is what users care about; classification is internal bookkeeping.
  8. **Declined: per-filter confidence.** Feedback suggested per-filter confidence on `filtersApplied`. Rejected for v1 — artefact-level confidence from rev 2 is sufficient; per-filter granularity is over-engineering at this stage.
  9. **Updated open questions and sequencing notes** to reflect contract expansion.
- **rev 4** (this version — post external review rounds 3 + 4, final pass before spec) — closed out developer-ergonomics gap:
  1. **Contract additions (round 3):** `confidenceSource?: 'llm' | 'heuristic' | 'deterministic'` on structured + approval artefacts; `window?: 'per_run' | 'per_day' | 'per_month' | 'unknown'` on `BriefBudgetContext`. Both optional.
  2. **Contract rules (round 3):** single-active-artefact rule for lifecycle chains, execution reuse rule (latest-only), relationship directionality rule (not automatically bidirectional), RLS backstop expanded to cover aggregate invariants, `freshnessMs` hybrid rule (maximum age across contributors).
  3. **§9 expanded (round 4):** three canonical flows, artefact-by-artefact with explicit IDs, parent links, related links, and status transitions. Pressure-tests the contract end-to-end against read refinement, write + execution, and failure + retry.
  4. **New §12 Implementation guidance (round 4):** golden implementation guidelines (directive SHOULD/MUST rules), implementation boundaries (capability / orchestrator / execution / client), failure handling principles (invalid artefacts, missing parents, out-of-order updates), contract test requirements (gate for every capability).
  5. **New §15.1 Build sequence (round 4):** contract-layer implementation order within product phases. Each step is independently shippable; avoids the "half-done everything" failure mode.
  6. **Tone shift in new sections (round 4):** directive language ("capabilities SHOULD...", "MUST", "MUST NOT") in implementation guidance sections. Existing rationale sections retain explanatory tone — they serve a different audience.
  7. **This is the last iteration pass.** Further feedback is welcome but the brief is now treated as build-ready. The next step after this is `architect` → implementation spec → `spec-reviewer`.

---

## Contents

1. What this is
2. Why now
3. The north star
4. The Brief — entity, lifecycle, naming
5. The COO — agent persona and routing brain
6. Conversation scopes (v1: four scopes)
7. Scope routing (subaccount / organisation / system)
8. The four capability workstreams
   - 8.1 Orchestrator fast path (triage + scope detection)
   - 8.2 Clarifying + Sparring Partner skills
   - 8.3 User-triggered memory capture
   - 8.4 Retrieval audit
9. Canonical flows — artefact-by-artefact
   - 9.1 Flow A — Read with refinement
   - 9.2 Flow B — Write with approval and execution
   - 9.3 Flow C — Failure and retry
10. Rationale — decisions we deliberately made
11. Cost and safety posture
12. Implementation guidance
    - 12.1 Golden implementation guidelines
    - 12.2 Implementation boundaries — who does what
    - 12.3 Failure handling principles
    - 12.4 Contract test requirements
13. Non-goals
14. Relationship to other in-flight work
15. Sequencing
16. Open questions for external review
17. Success criteria

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

**Architectural stance: Brief is a control plane, not a work plane.** This is the most important framing in the document. The Brief coordinates and displays; it does not execute, does not own memory, does not own approval logic. Each of those lives in its own system, and the Brief is the surface where they converge for the user. Reading the Brief as an "everything-entity that owns six roles" would be wrong — it's a thin coordination record with many attached surfaces.

Concrete separation:
- **Brief** — intent container + conversation record + status tracker. Thin.
- **Sub-tasks** — execution units. Spawned by the Brief; execute independently; report back.
- **Approval layer** — `actionRegistry` + existing review gates. Cards *render* in the Brief; dispatch goes through the existing path.
- **Memory system** — `memoryBlocks` + synthesis + quality scoring + citation (existing infrastructure). Brief is an observation surface and a trigger surface for memory events; it doesn't own memory.
- **Analytics** — aggregation queries over `tasks`. Brief doesn't own these; analytics surfaces query the same tables.

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

## 6. Conversation scopes (v1: four scopes)

Chat surfaces exist today only for Agents (per-agent chat at `/agents/{agentId}`, backed by `agentConversations` + `agentMessages`). V1 expands chat to three additional scopes, so users can converse with the system at the level that matches their current context.

**V1 scopes:**

| Scope | Use case | Counterparty |
|---|---|---|
| **Agent** | "Why did you decide X?" / general agent ops | The agent itself (exists today) |
| **Brief** | "Refine this proposal" / "add context" / "what's the status" | The COO, who delegates |
| **Task (sub-task)** | "Override how you're doing this" / "I have new info" | The agent assigned to the sub-task |
| **Agent run (execution log)** | "Why did you do this?" / "Why didn't you do that?" | Q&A over a specific run's log |

**Why four, not seven.** Earlier drafts proposed seven scopes (adding Recurring Task, Playbook Run, Proposal/Approval card). External review flagged this as UX weight without proven demand. V1 ships the four scopes that cover the vast majority of conversations; additional scopes become one-enum-value additions when usage demand is evident.

**Schema shape — polymorphic, extensible.** `agentConversations` is renamed to `conversations` and generalised with `scopeType` + `scopeId`. The polymorphic design means adding a new scope is one enum value + one service-layer handler, not a schema migration. This is deliberate: we're committing to four scopes for v1 behaviour, but the schema is future-proofed for the other three (and beyond) without rework.

**Deferred to v2 (add when demand surfaces):**
- **Recurring task** — "change the cadence" use case likely better served via the recurring task's config page; revisit if users specifically ask for conversational access
- **Playbook run** — diagnostics currently rendered via run trace viewer; add chat when users request conversational diagnosis
- **Proposal / approval card** — discussion before approval currently inline in the Brief's chat; dedicated scope added only if that's insufficient
- **Organisation** (covered by org-scope Briefs in most cases)
- **Playbook definition** / **Integration** / **Memory block** (config concerns, not conversation concerns)
- **Subaccount and canonical-entity conversations** — covered by the global input field with the relevant context auto-attached to a Brief. No dedicated pane needed.

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

**Why this isn't new infrastructure.** Scope detection is one of the outputs of the Orchestrator's fast path (§8.1). It's a dimension of the existing routing decision, not a separate system.

## 8. The four capability workstreams

Four pieces of intelligence infrastructure make the Brief surface useful. Each has standalone value, but they compound: together, they transform the COO from a passive router into an active thinking partner.

These workstreams were originally conceived before the Universal Brief surface was on the table — in response to YouTube tutorials teaching individual users to coax better output from LLMs by prompting for clarifying questions, sparring-partner mode, and saved skills. The ambition here is to elevate those patterns from per-prompt tricks into platform primitives, reachable from every interaction without users needing to know the magic phrases.

---

### 8.1 Orchestrator fast path (triage + scope detection)

**Reframe note:** earlier drafts referred to this as a "classifier in front of the Orchestrator." That framing implied a separate concern that decides whether to invoke the Orchestrator. The correct framing is: **this is the Orchestrator's own fast path** — a cheap pre-LLM step owned by the Orchestrator that decides whether the full LLM pipeline is needed. Code is a separate service file for reusability; conceptually it's part of the Orchestrator.

**What it is.** The Orchestrator's cheap pre-LLM decision layer. Per Brief, it decides: does this need the full planning pipeline, a direct reply, a clarifying question, or a cheap canned answer? And: what scope does it target (subaccount / org / system)?

**Why it matters.** Today the Orchestrator's LLM pipeline runs on every eligible task. With a conversational front door, that's wasteful — users will type "thanks" and "got it" as fillers; simple routine queries don't need full decomposition; ambiguous queries should be clarified before anything happens. The fast path triages cheaply and only escalates to the full Orchestrator LLM when planning is genuinely needed.

**Shape — two tiers.**
- **Tier 1 — heuristic (zero LLM cost, ~1ms).** Keyword patterns, message length, UI context. Decides `simple_reply` / `needs_clarification` / `needs_orchestrator` / `cheap_answer` with a confidence score. Scope detection is a dimension of the same output.
- **Tier 2 — Haiku fallback (~100ms, cents).** Triggered only when Tier 1's confidence is below threshold. Small structured output call; same decision space.

The full Orchestrator LLM pipeline (Paths A/B/C/D decomposition) runs only when Tier 1 or Tier 2 returns `needs_orchestrator`.

**Safety nets against the worst failure mode.** Tier 1 returning a high-confidence wrong answer is the worst case — the system commits to a wrong path without surfacing uncertainty. Three mitigations:

1. **Shadow evaluation logging.** Every classification decision logged alongside the user's follow-up behaviour: did they re-issue the Brief (misroute indicator), clarify (ambiguity indicator), abandon (wrong route), or proceed (correct route)? Creates a drift-detection feedback loop reviewable weekly for the first month post-launch, monthly thereafter.
2. **Risk-aware second-look.** Even when Tier 1 is confident, certain categories force a second look: detected writes, cost above a threshold, scope ≠ UI context, known-brittle keyword patterns. Second-look is a cheap structured LLM confirmation or an explicit user-prompt — cost of misrouting these categories is too high to trust heuristics alone.
3. **Confidence decay + periodic recalibration.** Heuristic thresholds are not static. Tier 1 confidence scores decay toward "escalate to Tier 2" when recent patterns show drift. Thresholds get tuned from the shadow-eval logs on a regular cadence.

**In-house precedent.** `queryIntentClassifier`, `topicClassifier`, `pulseLaneClassifier` — all three are existing heuristic-tier routers. The new fast path follows the same pattern (pure function + thin service wrapper + tests).

**Net new work.** One new service + pure twin + tests + shadow-eval logging schema + risk-aware second-look helper. Integration at the Orchestrator's entry point.

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

#### 8.3.2 Rule precedence + conflict detection

**Why this exists as a distinct sub-phase.** External review flagged that user-authored rules are system-behaviour modifiers without built-in conflict resolution. Ship W3a (capture) without this, and the Learned Rules library becomes a field of contradictions at scale — two rules that overlap, with no deterministic answer to "which wins." Agent behaviour becomes inconsistent; users lose trust.

This sub-phase lands before W3.3 (approval-gate suggestion) and W3.4 (provenance) so every downstream rule-consuming surface has a clean substrate.

**Three components:**

**1. Rule precedence model.**
- **Scope specificity wins.** More specific scope trumps less specific: subaccount-scoped > agent-scoped > org-scoped. Within a scope, an explicit `priority` field (nullable, default `medium`) breaks ties.
- **Paused rules don't participate.** A user who paused a rule is explicitly opting out; the rule stays in the library but doesn't get injected or cited.
- **Deprecated rules don't participate.** Rules auto-deprecated for low quality (see component 3) are removed from retrieval; user can resurrect them from the library.
- **Explicit override trumps precedence.** A rule tagged `authoritative=true` by the user wins regardless of scope — for cases where "this is an org policy, don't let subaccount rules override it."

**2. Conflict detection at capture time.**
- **LLM-assisted overlap check.** When a user saves a new rule, a Haiku-tier call checks for overlap with existing rules in the same scope + adjacent scopes.
- **Surface inline.** If overlap detected, the capture dialog pauses and shows: *"This rule contradicts an existing one: [quoted rule]. Pick which wins, or edit both."* — with options: keep-new-deprecate-old / keep-old-discard-new / keep-both-with-priorities / edit-new-to-remove-overlap.
- **Don't auto-resolve silently.** Silent auto-resolution is what destroys trust at scale. User is always in the loop when conflicts are detected.
- **False positives are the risk.** The LLM may flag as "conflict" things that aren't truly conflicting. Mitigation: bias toward false-positives (flag more, resolve interactively) — annoying is recoverable; silent conflict is not.

**3. Rule quality scoring.**
- **Folds into existing `memoryEntryQualityService`.** Avoids a parallel quality system.
- **Inputs:** usage frequency (how often cited in agent outputs), recency (when last cited), outcome alignment (did runs citing this rule succeed? — uses existing `runResultStatus` signal), user corrections (did a user edit/pause this rule after citation?).
- **Low-score auto-deprecation.** Rules that score below a threshold for N weeks enter a `deprecated` state — removed from retrieval but retained in the library. User is notified once via the existing notification channel; they can resurrect or delete.
- **User-authored rules decay more slowly than auto-synthesised ones.** Explicit user intent carries more weight than auto-extraction — asymmetric decay half-lives are already supported by `memoryEntryQualityServicePure` per-entryType configuration.

**Schema additions.** `memoryBlocks` gets: `priority` (nullable enum), `isAuthoritative` (boolean, default false), `deprecatedAt` (nullable timestamp), `deprecationReason` (nullable enum: 'low_quality' / 'user_replaced' / 'conflict_resolved'). All backward-compatible with existing rows.

**Why this can't wait until v2.** The approval-gate suggestion flow (8.3.3) generates candidate rules; if those candidates overlap with existing rules, we need conflict detection at that moment. And the provenance trail (8.3.4) is only meaningful if the system can say "I applied rule X because it was authoritative / more specific / higher priority than rule Y." Without precedence + conflict detection, W3.3 and W3.4 ship into an inconsistent substrate.

#### 8.3.3 Approval-gate suggestion + teachability heuristic

**Goal.** When the user approves or rejects a proposal through an approval card, offer an optional in-context "teach the system?" prompt with LLM-drafted candidate rules.

**Scope.**
- **Teachability filter** — decides whether to surface the capture prompt at all. Novel decisions trigger it; routine approvals don't.
- **Candidate drafter** — a Haiku-tier LLM call reads the approval context and drafts 2–3 plain-English rule candidates, each fitting one of a fixed set of categories (preference, targeting, content, timing, approval, scope).
- **In-approval suggestion panel** — appears below the approve/reject action after the decision lands. Candidate options + "custom" text field + scope picker. Prominent "Not now" dismiss.
- **Rejection path** — reworded to "avoid next time" framing. Rejections are often higher-signal than approvals.
- **Auto-backoff** — if the user skips N suggestions in a row, pause suggestions for a cooldown window. Per-user frequency setting (off / occasional / frequent).

**Important design decision: hybrid candidate generation.** A fixed category taxonomy + LLM fill-in. Not pure LLM freeform (quality drift). Not hardcoded templates (brittle). Hybrid gives consistency with relevance.

**Important design decision: "Not now" is always first-class.** The suggestion panel is secondary to the approval action — the approval completes whether or not the user engages.

#### 8.3.4 Provenance trail on agent outputs

**Goal.** When an agent acts on a remembered rule, show *which rule* influenced the output — so bad rules are discoverable at the moment they misfire.

**Scope.**
- **Log which rules were injected into an agent's context on every run.** New field on `agentRuns`: `appliedMemoryBlockIds`. Today, runs track `citedEntryIds` for workspace entries but not for named memory blocks.
- **Extend the citation detector** to score `memoryBlocks` against agent outputs. Reuses existing `memoryCitationDetector` patterns.
- **Prompt modification** — agents are prompted to cite rules when they act on them.
- **UI surfacing** — agent output cards show "Rules applied: [rule X], [rule Y]." Clicking jumps to the Learned Rules library with that rule focused for editing.

**Why this phase is the most ambitious.** Touches the agent execution loop, run logs (schema change), citation detection (service extension), prompt templates, and a new UI component. Likely a separate session's worth of work. Depends on the retrieval audit (§8.4) to scope correctly — if retrieval is leaky, scope grows. Also depends on §8.3.2 (precedence + conflict) to produce coherent "this rule applied because X" explanations.

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

## 9. Canonical flows — artefact-by-artefact

Three canonical flows pressure-test the contract end-to-end. Each shows artefact IDs, `parentArtefactId` chains, `relatedArtefactIds`, and `status` transitions explicitly. If a flow can't be modelled cleanly in these artefact primitives, the contract has a gap. If these three can, the contract is sound for v1.

Every capability implementer MUST be able to map their surface into at least one of these flows. The spec's contract-test harness (§12.4) validates this mapping.

---

### 9.1 Flow A — Read with refinement

Scenario: User types *"Show me VIP contacts inactive 30 days"* while viewing a subaccount dashboard. Then clicks a suggestion to narrow the query.

**Turn 1 — initial result:**

```
Artefact A (BriefStructuredResult)
  artefactId:           "art_001"
  status:               "final"
  parentArtefactId:     (none)
  relatedArtefactIds:   []
  kind:                 "structured"
  entityType:           "contacts"
  summary:              "14 VIP contacts inactive 30 days"
  filtersApplied:       [tag=VIP, lastActivity<30d]
  rows:                 [14 contact records]
  rowCount:             14
  columns:              [name, email, lastActivityAt, owner]
  suggestions:          ["Narrow to last 7d", "Sort by oldest activity"]
  source:               "canonical"
  freshnessMs:          180000       // 3 min old
  confidence:           0.95
  confidenceSource:     "deterministic"
  costCents:            2
```

**Turn 2 — user clicks "Narrow to last 7d" suggestion:**

A new Brief turn is initiated with the suggestion's `intent` as input. The COO interprets, the CRM Planner re-runs with the narrower filter, and emits an updated artefact:

```
Artefact B (BriefStructuredResult)
  artefactId:           "art_002"
  status:               "updated"
  parentArtefactId:     "art_001"         // ← supersedes Artefact A
  relatedArtefactIds:   []
  kind:                 "structured"
  entityType:           "contacts"
  summary:              "3 VIP contacts inactive 7 days"
  filtersApplied:       [tag=VIP, lastActivity<7d]
  rows:                 [3 contact records]
  rowCount:             3
  columns:              [same]
  suggestions:          ["Broaden to 30d", "Group by owner"]
  source:               "canonical"
  freshnessMs:          180000
  confidence:           0.95
  confidenceSource:     "deterministic"
  costCents:            2
```

**UI behaviour:** Artefact B renders in place of A. A is accessible via history (parent link) but is no longer the "active" artefact — per the single-active-artefact rule, only the tip of the chain (B, since nothing supersedes it) renders as primary content.

**What this flow validates:**
- Lifecycle chain via `parentArtefactId` works for refinement
- `status: 'updated'` replaces in-place cleanly
- Single-active rule resolves the chain deterministically
- Suggestions are re-parseable as new Brief turns (suggestion's `intent` becomes the next turn's input)
- `costCents` accumulates per-turn (Brief's total spend is the sum)

---

### 9.2 Flow B — Write with approval and execution

Scenario: From the refined result in Flow A, user types *"Email these 3 contacts a check-in."*

**Turn 3 — result + approval card:**

The COO interprets as a write intent. Since the write targets the 3 records from Artefact B, the approval card references B via `relatedArtefactIds`:

```
Artefact C (BriefApprovalCard)
  artefactId:           "art_003"
  status:               "final"                // initial state before user action
  parentArtefactId:     (none)
  relatedArtefactIds:   ["art_002"]           // ← refers to the result that spawned it
  kind:                 "approval"
  summary:              "Send 'Check-in' email to 3 VIP contacts"
  actionSlug:           "crm.send_email"
  actionArgs:           { templateId: "quarterly-check-in", contactIds: [...] }
  affectedRecordIds:    [3 contact UUIDs]
  riskLevel:            "medium"
  estimatedCostCents:   3
  confidence:           0.9
  confidenceSource:     "llm"
  budgetContext:        { remainingCents: 98, limitCents: 100, window: "per_run" }
  executionId:          (none — not yet dispatched)
  executionStatus:      (none)
```

**Sparring gate fires on the approval.** Since the action crosses the challenge threshold (external-facing write, multi-recipient), the `challenge_assumptions` skill runs. Output surfaces on Artefact C inline — the UI renders it adjacent to the approval card, not as a separate artefact.

**User approves → Turn 4 — execution linkage:**

The orchestrator emits an updated approval card with `executionId` + `executionStatus`:

```
Artefact D (BriefApprovalCard)
  artefactId:           "art_004"
  status:               "updated"
  parentArtefactId:     "art_003"             // ← supersedes original card
  relatedArtefactIds:   ["art_002"]           // ← preserved from parent
  kind:                 "approval"
  summary:              "Send 'Check-in' email to 3 VIP contacts"
  actionSlug:           "crm.send_email"
  actionArgs:           [same]
  affectedRecordIds:    [same]
  riskLevel:            "medium"
  executionId:          "exec_xyz123"         // ← populated on dispatch
  executionStatus:      "running"
  ... (other fields inherited/replicated)
```

As the execution progresses, further updates fire: `executionStatus: 'completed'` (with a final `status: 'updated'` artefact). Each transition is a new artefact superseding the prior via `parentArtefactId`.

**Final state — Turn 5:**

```
Artefact E (BriefApprovalCard)
  artefactId:           "art_005"
  status:               "updated"
  parentArtefactId:     "art_004"
  relatedArtefactIds:   ["art_002"]
  executionId:          "exec_xyz123"
  executionStatus:      "completed"
  ... (with any return value summary)
```

**What this flow validates:**
- Approval → execution → completion is one linked artefact chain (art_003 → art_004 → art_005)
- Related artefact link (Artefact B, the source result) preserved across the chain
- Execution status transitions are first-class artefact updates, not out-of-band UI state
- Sparring skill output surfaces inline on the approval, not as a separate artefact
- Single-active rule: the current active artefact is always the tip (art_005)

---

### 9.3 Flow C — Failure and retry

Scenario: The send in Flow B fails because the SMTP provider rate-limits. User retries.

**Turn 5 — execution failure:**

The orchestrator emits a failure artefact referencing the approval that failed:

```
Artefact F (BriefApprovalCard)
  artefactId:           "art_005"
  status:               "updated"
  parentArtefactId:     "art_004"
  relatedArtefactIds:   ["art_002"]
  executionId:          "exec_xyz123"
  executionStatus:      "failed"
```

Accompanied by an error artefact describing the failure:

```
Artefact G (BriefErrorResult)
  artefactId:           "art_006"
  status:               "final"
  parentArtefactId:     (none)
  relatedArtefactIds:   ["art_005"]           // ← links to the failed approval
  kind:                 "error"
  errorCode:            "rate_limited"
  message:              "Email provider rate-limited the send. Try again in 30s."
  severity:             "medium"
  retryable:            true
  suggestions:          ["Retry now", "Retry in 1min"]
```

**UI behaviour:** the failed approval (art_005) stays visible with a red ✗; the error (art_006) renders below it with a "Retry" affordance.

**Turn 6 — user clicks Retry:**

The orchestrator emits a new approval artefact — NOT by re-activating art_005, but by creating a fresh chain. Per the execution reuse rule, retries emit new approval artefacts via the `parentArtefactId` chain:

```
Artefact H (BriefApprovalCard)
  artefactId:           "art_007"
  status:               "final"
  parentArtefactId:     "art_005"             // ← the failed approval is the parent
  relatedArtefactIds:   ["art_002", "art_006"] // ← related to both the original result and the error
  kind:                 "approval"
  summary:              "Retry: Send 'Check-in' email to 3 VIP contacts"
  actionSlug:           "crm.send_email"
  actionArgs:           [same]
  executionId:          (none — awaiting dispatch)
  executionStatus:      (none)
```

On approval, the chain continues: art_007 → art_008 (running) → art_009 (completed or failed).

**What this flow validates:**
- Failures are first-class artefacts, not hidden UI state
- Error artefacts carry enough context (severity, retryable, suggestions) for the UI to act without custom per-error logic
- Retries emit NEW approval chains — history preserved via `parentArtefactId`, current attempt via latest `executionId`
- `relatedArtefactIds` captures cross-chain context (the retry knows about both the original result AND the error that caused the retry)
- Single-active rule still applies: at any moment, the tip of the current chain is authoritative

---

**What these three flows collectively demonstrate:**
- The contract holds for read refinement, write-with-execution, and failure-with-retry without UI guesswork
- Every UI state transition is a new artefact with a deterministic parent link
- Relationships across chains are explicit via `relatedArtefactIds`
- No contract primitive is unused; no common user flow is unmodelable

If any future capability produces a flow that can't be modelled this cleanly, the contract has a gap — that's the signal to revisit, not to work around.

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
- **Read-only-by-default.** When the fast path is ambiguous between a read and a write, the COO picks read. Writes require an explicit verb ("send," "create," "schedule," "update").
- **Per-subaccount rate-limit awareness.** A noisy Brief thread shouldn't starve ClientPulse polling or outcome-measurement jobs. Existing `getProviderRateLimiter` budgets apply; consider a per-subaccount-per-minute cap on free-text provider reads.
- **Scope + RLS enforcement at capability boundaries.** Capabilities emit results already scoped — no post-filtering at the chat layer, because post-filtering is brittle for aggregates.
- **User-triggered rules still audit-trailed.** Even though they skip review, every save writes to `memoryBlockVersions` with `createdByUserId` — full audit trail preserved.
- **The Orchestrator's capability-query budget (8 calls / run) is preserved.** Clarifying and sparring invocations count against this budget.

### 11.1 Artefact lifecycle and relationships — why we added them now

External review highlighted that the v1 artefact contract treated every artefact as a static snapshot. That works for a demo; it breaks the moment real usage introduces:

- A long-running query that needs to refine its initial partial result (streaming precursor)
- An approval card that needs to reflect execution state back into chat (approved → running → completed)
- A result that becomes stale because underlying data changed
- Multiple artefacts from a single turn that are semantically related (approval card → the result that spawned it)

Rather than retrofit these concepts under production pressure, the contract now includes:

- **`artefactId` (required)** — every artefact has an identity, so other artefacts can reference it.
- **`status`, `parentArtefactId`** — lifecycle signalling. An artefact can be `'updated'` by another (supersedes in place) or `'invalidated'` (marks predecessor stale). Enables refresh flows and streaming precursors without contract breakage.
- **`relatedArtefactIds`** — loose sibling relationships. Lets a turn's artefacts signal relatedness to the UI without inventing a rigid relationship graph.
- **`contractVersion` (per-artefact)** — enables mixed-version rollouts where different capabilities are on different contract versions during migration.

**The strategic framing that drove this:** the artefact contract is effectively the "UI protocol" for every capability and agent in the system. Getting lifecycle and relationship primitives right early is the difference between a clean long-term substrate and a bolted-on mess of ad-hoc updates. Pre-launch is the cheapest moment to fix it.

Full field semantics live in `docs/brief-result-contract.md`; the dev brief only captures the rationale.

### 11.2 Kind-specific contract extensions — also from review round 2

Also added in response to external review:

- **Structured result — `columns` hint + `freshnessMs`.** `columns` is a soft schema hint (key, label, optional type) that lets the UI render deterministically without per-`entityType` defensive logic. `freshnessMs` replaces an ambiguous `source` classification — a cached provider response reports `source: 'live'` with `freshnessMs: 60000` rather than being mis-classified as canonical.
- **Approval card — `executionId`, `executionStatus`.** Approval cards are no longer dead-ends after the user clicks "approve." The card transitions through `'pending' → 'running' → 'completed' / 'failed'`, with the `executionId` providing the audit linkage back to the run. The UI shows approval → execution → outcome on one linked artefact chain.
- **Error — `severity`, `retryable`.** Not every error is equal. `severity` drives UX treatment (toast / banner / modal). `retryable` drives whether the "Try again" button appears. Prevents the "every error looks the same" failure mode.
- **Budget context on structured + approval.** Both artefact kinds can carry an optional `budgetContext` with `remainingCents` / `limitCents` — populated by the orchestrator post-capability. Enables "you've used 80% of your budget" UX.

### 11.3 RLS — defence in depth, not single-point enforcement

Review flagged that "every capability must enforce RLS correctly" is a risk, not a guarantee. One mis-implemented capability can leak data across tenants.

**The contract preserves primary enforcement at the capability layer** (capabilities are the only place that knows the semantic meaning of "these rows"). But the orchestrator should implement a **lightweight backstop** that sanity-checks artefact outputs against the Brief's scope — e.g., verify all `organisationId` references in the output match the Brief's, flag unexpected `subaccountId` values.

This isn't replacement; it's safety net. One mis-implemented capability shouldn't be able to leak. Implementation detail belongs in the spec; the principle belongs in every capability's review checklist.

### 11.4 Confidence surfaces — a trust mechanism

The contract (§8 and `docs/brief-result-contract.md`) carries an optional `confidence` field on structured results and approval cards. This is a deliberate UX and safety mechanism, not a debugging artifact.

**Principle:** users given a 70%-confident answer know to verify; users given a 100%-confident wrong answer don't. Admitting uncertainty builds trust; hiding it erodes it.

**Where confidence is set:**
- Orchestrator fast path emits confidence with routing + scope decisions.
- Capabilities that interpret ambiguous intent (CRM Query Planner, approval-card synthesis, teachability candidate drafter) report their own confidence.
- Deterministic operations (canonical reads with well-formed filters, direct API calls) omit the field — effectively 1.0.

**Where confidence is surfaced:**
- `confidence >= 0.85` — rendered normally, no badge.
- `0.60 <= confidence < 0.85` — subtle indicator ("~70% confident this is what you meant"), prompts spot-check.
- `confidence < 0.60` — prominent indicator + refinement prompt. On approval cards, forces explicit-approval-required mode regardless of `riskLevel`.

This makes risky interpretations hard to miss without spamming users on confident ones.

### 11.5 Observability and failure visibility

Observability is a day-zero concern, not something that gets bolted on after things break. Without the following instrumentation, the system cannot be tuned, debugged, or safely iterated:

**Classification / routing:**
- Every fast-path decision logged with `{input, route, scope, confidence, tier_used}` + the user's subsequent behaviour (re-issued? clarified? abandoned? proceeded?) — this is the shadow-eval feedback loop for drift detection.
- Rate of Tier 2 (Haiku) fallback — a rising rate indicates Tier 1 drift.

**Clarification / challenge:**
- Clarification-loop rounds per Brief (how many back-and-forths before user converged).
- Challenge-skill outputs: accepted (user refined their plan) vs. dismissed (user proceeded unchanged).

**Memory:**
- Capture-rate per user / subaccount (how often `/remember` is used).
- Suggestion panel engagement (offered / accepted / dismissed / "Not now"-skipped) — drives auto-backoff.
- Rule conflict detection: false-positive rate (user resolved as "keep both — no real conflict") vs. true-positive rate (user resolved one of the real-conflict options).
- Quality-score distribution + auto-deprecation rate.
- Citation rate per rule (is this rule ever actually used?).

**Brief lifecycle:**
- Outcomes by status: `closed_with_answer` / `closed_with_action` / `closed_no_action` / `cancelled` — proportions inform the Brief-board pollution question (§15).
- Time-to-close percentiles.
- Cost-per-Brief distribution — surfaces outliers.

**Principle:** anything the team will need to see to decide "is this feature working" must be logged from day one. Instrumentation is cheaper to add up-front than to retrofit after a metric is needed.

---

## 12. Implementation guidance

This section exists because a contract without implementation guidance produces inconsistent implementations. Different developers interpret the same rules differently and ship subtly divergent artefacts. The sections below are the **directives** that turn this brief from a spec-shaped document into a build-ready one.

**Every capability implementation MUST be reviewed against this section.** The `architect` agent will reference these rules when producing the implementation spec; the `pr-reviewer` agent will cite them when reviewing capability implementations.

### 12.1 Golden implementation guidelines

Directive rules for any capability producing artefacts. Phrased as SHOULD / MUST per standard RFC 2119 convention.

- **Capabilities MUST emit `artefactId` on every artefact.** Never absent. Deterministic derivation is preferred — e.g., `hash(brief_id, turn_index, kind, sequence)` — so retries don't produce divergent IDs for logically identical artefacts. Random UUIDs on retry break the lifecycle chain.
- **Capabilities MUST populate `relatedArtefactIds` when an artefact originates from another.** Approval cards MUST reference the result they're offering action over. Errors MUST reference the failed operation's source artefact. Silence here creates UI grouping inconsistency.
- **Capabilities MUST use `status: 'updated'` rather than mutating a prior artefact.** Artefacts are immutable once emitted. Updates are new artefacts with a `parentArtefactId` pointing to the predecessor. In-place mutation breaks the single-active-artefact rule and makes history unreliable.
- **Capabilities MUST NOT emit multiple active artefacts for the same logical result.** Per the single-active rule, only the tip of any chain is authoritative. Emitting two `kind: 'structured'` artefacts with overlapping scope from one turn creates ambiguity; one MUST supersede the other.
- **Capabilities SHOULD populate `columns` when emitting tabular data.** Deterministic UI rendering. Omitting `columns` works but forces per-`entityType` UI logic — acceptable when the UI already has entity-specific rendering; avoid otherwise.
- **Capabilities SHOULD omit `confidence` only when truly deterministic.** Any LLM-interpretation-based output emits confidence. Omission implies ~1.0 — claim it only when you can defend it.
- **Capabilities MUST NOT bypass `actionRegistry` for approval cards.** Every `actionSlug` on an approval card resolves to a registered action. The approval UI dispatches through the standard review gate; the approval card is a UX affordance, not a parallel dispatch path.
- **Capabilities SHOULD surface refinement `suggestions[]` on broad or truncated results.** Users given a 1,482-row truncated result with no suggestions have no productive next step. Three narrowing suggestions turn a dead-end into a conversation.
- **Capabilities MUST honour RLS at the read boundary.** No post-filtering at the artefact layer. If a capability emits a count that exceeds the caller's scoped total, it has leaked data — the orchestrator-level backstop (§11.3) catches this, but prevention at the capability is primary.

### 12.2 Implementation boundaries — who does what

Responsibilities across the system. When in doubt about where logic belongs, this table is the answer.

| Layer | Responsibility |
|---|---|
| **Capability** | Constructs base artefact with all semantic content (summary, rows, filtersApplied, confidence, suggestions). Enforces RLS at the read boundary. Assigns initial `artefactId` and populates `relatedArtefactIds` for any artefact spawned from another. Does NOT populate `budgetContext` or execution linkage fields — those are orchestrator-owned. |
| **Orchestrator** | Assigns `artefactId` only if the capability omitted one (fallback). Injects `budgetContext` after capability returns (capability doesn't know caller's broader budget posture). Enforces lifecycle rules — rejects invalid artefacts, logs orphan `parentArtefactId` references, resolves out-of-order updates. Runs the RLS defence-in-depth backstop (aggregate invariants + ID scope). Emits `status: 'updated'` execution-progress artefacts on approval cards during action dispatch. |
| **Execution layer** | Updates approval artefacts with `executionId` on dispatch. Transitions `executionStatus` through `pending → running → completed / failed` via new artefacts in the chain. Emits error artefacts on failure with appropriate `severity` + `retryable` based on the underlying failure class. |
| **Client** | Resolves lifecycle chains — finds the tip of each `parentArtefactId` chain and renders only that. Visually marks predecessors as superseded (history available). Handles `status: 'invalidated'` by marking the predecessor stale; does not render the invalidation artefact as primary content. Renders `relatedArtefactIds` as grouping affordances. Surfaces `confidence`, `freshnessMs`, `budgetContext.window` per §11.1 thresholds. Never invents state — every UI update reflects a new artefact the server emitted. |

**Principle.** State lives in artefacts. The client doesn't fabricate; the server emits. When a UI state change is needed, a new artefact is emitted and the client's lifecycle-resolution logic picks it up. This invariant makes the system replayable and debuggable — "what did the user see at time T?" is answered by "what was the tip of each chain at time T?"

### 12.3 Failure handling principles

System-level rules for failure modes. These prevent the chaos that emerges when each team handles failure differently.

- **Invalid artefact shape → rejected at orchestrator boundary.** Artefacts failing schema validation (wrong types, missing required fields) are rejected before reaching the client. The orchestrator emits a `BriefErrorResult` with `errorCode: 'internal_error'` + `severity: 'high'` in their place. The capability's log gets a structured error record.
- **Missing `parentArtefactId` references → ignored, logged.** When an artefact's `parentArtefactId` points to an unknown artefact (never emitted, or already garbage-collected from history), the orchestrator accepts the artefact as a new chain root and logs the orphan reference for investigation. No user-visible error — don't fail the user for an internal bookkeeping issue.
- **Multiple artefacts claiming the same parent → latest timestamp wins, others logged.** When two artefacts both set `parentArtefactId: X`, the one with the latest `createdAt` becomes the tip. Earlier claimants are retained but not active. Producers responsible for this get a warning log.
- **Out-of-order execution status updates → latest state wins if it's terminal; else the tip rule applies.** If `completed` arrives before `running`, the `completed` is authoritative. If `running` arrives after `completed`, it's logged and ignored (the action has already terminated). Terminal states (`completed`, `failed`) are sticky.
- **Capability emission failures → orchestrator emits substitute error artefact.** If a capability throws, times out, or returns malformed output, the orchestrator emits a `BriefErrorResult` with an appropriate `errorCode` (`provider_error` for external failures, `internal_error` for capability bugs) in its place. The Brief chat never shows a blank turn; there's always an artefact.
- **Lifecycle conflicts → logged, not escalated.** The orchestrator's job is to produce a consistent user experience, not to bubble producer bugs to users. Conflicts emit structured logs for producers to review; users see coherent state.

### 12.4 Contract test requirements

Every capability MUST pass the following tests before shipping. These are not suggested; they are the gate. The `architect` agent's spec template will include a testing section mirroring these.

1. **Valid artefact schema.** Every emitted artefact validates against the TypeScript types in `shared/types/briefResultContract.ts`. Runtime validation at the capability boundary — producers emit through a type-checked path.
2. **Lifecycle chain validation.** For any artefact chain the capability produces (refinement flows, approval → execution flows), all `parentArtefactId` references resolve within the chain, and exactly one artefact in each chain is the tip (no children).
3. **RLS scope validation.** Every emitted artefact's referenced entity IDs fall within the caller's scope. Aggregate invariants (counts, sums) fall within scoped totals. Automated via a harness that runs capability queries against multiple test subaccounts and asserts no cross-scope leakage.
4. **Relationship integrity.** Every `relatedArtefactIds` entry points to an artefact that was emitted earlier in the same Brief turn or an earlier turn. No forward references. No broken references.
5. **Canonical flow coverage.** The capability provides at least one worked example matching at least one of the three canonical flows in §9 (read refinement, write with execution, failure with retry). The example runs end-to-end in the test harness and produces valid artefacts at every step.
6. **Lifecycle rules — single active tip.** Given any artefact chain, a deterministic function identifies the single active tip. No chain produces ambiguous tips. No chain has zero tips.
7. **Directive rules from §12.1.** Every directive is verifiable: test emits an artefact, assert `artefactId` is present, assert `relatedArtefactIds` is populated for spawned artefacts, assert `columns` present for tabular data, etc.

**Test harness location.** A shared capability-test harness lives in `server/lib/briefContractTestHarness.ts` (to be created in Phase 0) providing reusable assertions for each of the above. Capability-specific tests import from it. No capability ships without passing these assertions.

**Principle.** The contract's value comes from consistency. The test harness is how consistency is enforced; without it, "everyone follows the rules" is an unenforced aspiration.

---

## 13. Non-goals

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

## 14. Relationship to other in-flight work

### 14.1 ClientPulse (in-flight, other branch)

ClientPulse Phase 4 + 4.5 has merged via PR #152, but ClientPulse remains mid-flight overall — refactors and follow-on changes are in progress. This brief does not interfere with ClientPulse execution; it waits.

**Dependency direction:** none either way. ClientPulse's intervention + outcome measurement loops are internal to ClientPulse; the Brief surface doesn't touch them. Later, a Brief could query ClientPulse's outcome data ("how did our intervention do last month?") — that's a read query against canonical data, no integration work.

### 14.2 Tier-1 tech-debt paydown (foundational, other branch)

Four ghost features from a recent audit need fixing before the Brief work starts:
1. Per-run cost panel in agent run detail pages
2. Success-gated memory promotion (`extractRunInsights` currently fires unconditionally)
3. Per-agent `maxCostPerRunCents` enforcement
4. System P&L client page

**Dependency direction:** (2) is a hard prerequisite for W3. If the memory substrate is writing low-quality auto-extractions, user-triggered rules will land alongside garbage and the Learned Rules library will be polluted.

### 14.3 CRM Query Planner (separate branch, parallel)

The CRM Query Planner is a *capability* that plugs into the Brief surface. It's UI-agnostic by design — v1 can ship as a dedicated "Ask CRM" panel while the universal Brief surface is being built in parallel, and converge later.

**Dependency direction:** two-way contract dependency, already resolved.
- `docs/brief-result-contract.md` + `shared/types/briefResultContract.ts` merged to main define the shared shape.
- The CRM Planner branch emits `BriefStructuredResult` / `BriefApprovalCard` / `BriefErrorResult` per contract.
- The Brief surface branch renders those artefacts per contract.
- Both branches can develop independently after the contract landed.

### 14.4 Agent Live Execution Logs (shipped, PR #166)

Shipped. The Brief surface benefits — a Brief's "agent run" conversation scope (§6) reads from the execution log. No duplication; the chat is a conversational layer over the already-persisted log.

### 14.5 Hermes Tier 1 (shipped)

Shipped. Per-run cost panels, `runCostBreaker` enforcement, cost aggregates, ledger-based cost reads — all live. The Brief surface can surface cost information to users (the "$0.04 used" display) because this infrastructure is ready.

---

## 15. Sequencing

### Prerequisite: finish ClientPulse + Tier 1 paydown

Do these first. This brief's work starts after they land.

### Proposed phase order

Each phase is independently shippable. Stop after any phase and the app remains coherent.

| Phase | Scope | Effort |
|---|---|---|
| **P0** | Retrieval audit (§8.4) | Half-day — investigation only |
| **P1** | Entity relabel: "Issue" → "Brief" in UI; COO persona label; Brief detail page layout (chat + sub-tasks + artefacts) | ~1 week |
| **P2** | Universal Brief entry bar in global header; free-text submission creates a Brief; `conversations` polymorphic schema for v1 four scopes (Brief, Agent, Task, Agent run log) | ~1–2 weeks |
| **P3** | Orchestrator fast path (§8.1) — triage + scope detection + shadow-eval logging + risk-aware second-look | ~1 week |
| **P4** | Clarifying + Sparring Partner capability skills (§8.2) + masterPrompt gates | ~1 week |
| **P5** | Memory capture §8.3.1 — `/remember` + Learned Rules library + scope picker UI | ~1 week |
| **P6** | Memory capture §8.3.2 — rule precedence + conflict detection + quality scoring + auto-deprecation | ~1–2 weeks |
| **P7** | Memory capture §8.3.3 — teachability heuristic + approval-gate suggestion + candidate drafter | ~1–2 weeks |
| **P8** | Memory capture §8.3.4 — provenance trail on agent outputs | ~2–3 weeks (depends on P0 audit) |
| **P9** | CRM Query Planner integration with Brief surface (converging from separate branch's dedicated panel) | Coordination, not code — ~days |

**Total effort estimate:** ~10–14 weeks, multi-session. This is not a single-session build.

**Parallelism opportunities:**
- P3, P4, P5 can run in parallel with different owners (minimal shared surface).
- CRM Query Planner's separate branch runs throughout; convergence at P9.
- P6 is a hard gate in front of P7 and P8 — don't ship user-capture-at-scale without precedence + conflict detection.
- P8 is intentionally late — it touches the agent execution loop and requires P0's findings plus P6's precedence model.

### 15.1 Contract-layer build sequence (within P1 + P2)

The phased table above describes product-level phases. Within those phases — especially P1 (Brief entity + chat) and P2 (universal Brief entry) — implementing the artefact contract itself has its own internal order. Attempting to build every contract primitive in parallel is the fastest path to inconsistency.

Recommended internal build order for the contract layer:

1. **Base artefact types + validation.** `BriefArtefactBase` + runtime schema validation at the orchestrator boundary. Nothing emits until validation works.
2. **`BriefStructuredResult` rendering, no lifecycle.** Simplest artefact, simplest flow — just render the table. No `parentArtefactId` handling yet. Validates the end-to-end pipe.
3. **Lifecycle resolution client-side.** Single-active-tip rule. `status: 'updated'` replacing in place. `status: 'invalidated'` marking stale. Before this, the contract doesn't actually deliver refinement.
4. **`BriefApprovalCard` without execution linkage.** Approval cards that render + dispatch through `actionRegistry`, but without `executionId` tracking yet. Validates the approval path.
5. **Execution lifecycle updates.** `executionId`, `executionStatus`, the full approved → running → completed chain. Completes Flow B (§9.2).
6. **`BriefErrorResult` + retry flow.** Error rendering, `severity` / `retryable` driving UX, retry affordance emitting fresh chains. Completes Flow C (§9.3).
7. **`relatedArtefactIds` grouping.** UI grouping based on relationships. Comes late because until there are multiple artefact kinds flowing, there's nothing to group.
8. **`confidence` + `confidenceSource` surfaces.** Trust indicators. Requires threshold tuning against real capability output — too early and the UI thresholds are guesses.
9. **`budgetContext` + `freshnessMs` surfaces.** Depend on real cost data flowing through the ledger and real timing data from canonical/live reads. Ship last because the signals are only meaningful once there's usage.

**Why this order.** Each step produces a shippable increment. A team that stops at step 2 has a working Brief → result UI. Stopping at step 5 gives the full read + write loop. The later steps enrich the experience but aren't gating. Building them in this order avoids the "half-done everything, working nothing" failure mode.

**Gate: step 1 must pass the §12.4 contract test harness before step 2 begins.** This is the non-negotiable. Without validation at step 1, every later step accumulates silent bugs.

---

## 16. Open questions for external review

Some questions from the first review round have been resolved; remaining questions invite further critique.

### Resolved after review rounds 1 + 2 + 3 + 4

- **~~Is seven conversation scopes in v1 too many?~~** (rev 2) Resolved — v1 reduced to four. Others become one-enum-value additions when demand surfaces.
- **~~Does the "everything routes through the COO" framing hold?~~** (rev 2) Resolved — triage is the Orchestrator's own fast path. The three-role separation (triage, plan, execute) exists in architecture already.
- **~~Is Brief overloaded with six roles?~~** (rev 2) Resolved via reframing — Brief is a control plane, not a work plane.
- **~~Classifier worst-case: high-confidence wrong classification?~~** (rev 2) Addressed via shadow-eval logging, risk-aware second-look, confidence decay.
- **~~Memory rule conflicts + precedence?~~** (rev 2) Addressed via new sub-phase §8.3.2 — precedence model + conflict detection + quality scoring + auto-deprecation.
- **~~Lifecycle for artefacts?~~** (rev 3) Addressed via `status` / `parentArtefactId` / `artefactId` / `relatedArtefactIds` on `BriefArtefactBase`. Enables streaming, refresh, invalidation, and artefact relationships.
- **~~Loose schema for rows?~~** (rev 3) Addressed via optional `columns` hint on structured results. Prevents UI defensive logic sprawl.
- **~~Approval execution linkage?~~** (rev 3) Addressed via `executionId` / `executionStatus` on approval cards — approval → execution → outcome chain.
- **~~Error severity + retry?~~** (rev 3) Addressed via `severity` + `retryable` on error artefacts — drives UX treatment differentiation.
- **~~Budget context on artefacts?~~** (rev 3) Addressed via optional `budgetContext` on structured + approval kinds.
- **~~Source ambiguity (is cached API data canonical or live?)~~** (rev 3) Tightened semantics in the contract doc: cached provider data is `'live'` with non-zero `freshnessMs`. Freshness is the user-facing signal.
- **~~RLS enforcement risk (one mis-implemented capability leaks)?~~** (rev 3) Added §11.3 — primary enforcement stays at capability layer; orchestrator adds a sanity-check backstop.
- **~~Lifecycle chain ambiguity (out-of-order updates)?~~** (rev 4) Addressed via single-active-artefact rule — only the tip of the chain is authoritative. Out-of-order updates logged but don't re-activate superseded artefacts.
- **~~Approval reuse / re-run semantics?~~** (rev 4) Addressed via execution reuse rule — retries emit new approval artefacts via `parentArtefactId` chain. Latest `executionId` is current; history preserved in chain.
- **~~Relationship directionality?~~** (rev 4) Addressed — `relatedArtefactIds` is not automatically bidirectional; capabilities include reciprocal links when symmetric.
- **~~Confidence provenance?~~** (rev 4) Addressed via `confidenceSource` field — consumers weigh LLM-derived confidence differently from deterministic.
- **~~Budget window ambiguity?~~** (rev 4) Addressed via `window` field on `BriefBudgetContext` — per_run / per_day / per_month / unknown.
- **~~freshnessMs hybrid rule?~~** (rev 4) Tightened — for `source: 'hybrid'`, `freshnessMs` represents the maximum age across contributors. Conservative by design.
- **~~Inconsistent implementations across capabilities?~~** (rev 4) Addressed via §12 (Implementation guidance) — directive rules, boundaries, failure handling, and contract test requirements. Plus §12.4 test harness gating every capability.
- **~~How do we model read refinement / write+execution / failure+retry?~~** (rev 4) Addressed via three canonical flows in §9, artefact-by-artefact. Any capability's flow must map to one of the three; if it can't, the contract has a gap.
- **~~Where does the contract implementation begin?~~** (rev 4) Addressed via §15.1 build sequence — base types + validation first, lifecycle resolution second, then progressively enrich.

### Still open — invite critique

**15.1 Is "Brief" the right name?**
Chosen for agency-native fit and executive parlance. Alternatives considered: Directive, Ask, Objective, Matter. Does "Brief" clash unhelpfully with engineering usage (design briefs, implementation briefs)? Will non-English markets translate it cleanly?

**15.2 Is three-level scope routing (subaccount / org / system) over-engineered for v1?**
The alternative is "subaccount only, use a dedicated org page for cross-client queries." We rejected it on UX grounds. Is system-level scope especially premature? Should we defer it to v2?

**15.3 Is the polymorphic `conversations` schema the right call?**
`scopeType` + `scopeId` is flexible but sacrifices DB-enforced referential integrity. Alternative: distinct tables per scope. Given v1 has only four scopes, is polymorphism over-engineered here?

**15.4 Can the teachability heuristic work without training data?**
§8.3.3's pre-filter decides which approvals are "teachable." Without labelled data, the initial heuristic is rule-based. Is that sufficient to avoid false-positive suggestions (annoying users) and false-negatives (missing learning moments)?

**15.5 Is the conflict detection LLM call robust enough?**
§8.3.2 uses a Haiku-tier call to detect rule overlap at capture time. False-positives (flagging non-conflicts) are recoverable but annoying; false-negatives (missing real conflicts) are the failure mode that erodes trust silently. What's the expected accuracy? How do we validate it?

**15.6 Is provenance trail (§8.3.4) achievable without re-architecting context injection?**
The existing context injection pipeline may not cleanly expose "which blocks were injected." If it doesn't, §8.3.4 grows to include a context-injection refactor — possibly a multi-week scope expansion. The retrieval audit (§8.4) should answer this; any judgement on whether we're underestimating the work?

**15.7 Does the unified Brief entity scale?**
Every free-text query becomes a Brief. Read-only queries ("what's my pipeline") create records that close with an answer. Will the Brief board get polluted with exploratory queries, making actionable Briefs hard to find? Is the `closed_with_answer` status + UI filtering enough, or does the UX need something stronger (e.g. "ephemeral" Briefs that don't show on the main board)?

**15.8 Is the CRM Query Planner contract flexible enough?**
The contract now covers `BriefStructuredResult` + `BriefApprovalCard` + `BriefErrorResult` with lifecycle primitives (rev 3), execution linkage (rev 3), columns hints (rev 3), and confidence (rev 2). Is this flexible enough for complex CRM query results (charts, time series, multi-entity joins), or will we still need additions for those? Are there trust affordances beyond `confidence` and `freshnessMs` that warrant inclusion?

**15.9 Is the sequencing realistic given everything else in flight?**
Pre-launch context means ClientPulse is the active focus; this work waits. Ten to fourteen weeks of this work after ClientPulse stabilises — is that the right priority order given the product's launch runway? What should be descoped or deferred to v2?

**15.10 Is the observability stack the right shape?**
§11.2 lists the metrics and logs we want in place from day one. Is any of it over-instrumented (cost noise)? Is any of it missing (will regret retrofitting)? Is shadow-eval logging genuinely practical at scale, or will it produce unread data lakes?

**15.11 What are we missing?**
The most valuable response to this document is a question we haven't asked ourselves. Please look for those.

---

## 17. Success criteria

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
