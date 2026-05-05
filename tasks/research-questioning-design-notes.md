# Chat Intelligence & Memory Capture — Design Notes

**Branch:** `claude/research-questioning-feature-ddKLi`
**Status:** Research + design notes only. No code changes in this branch.
**Intended next step:** Finish ClientPulse Phase 4+4.5 on the other branch, merge to main, then return here (or start a fresh session) to produce a full implementation spec from these notes.

---

## How to use this document

This is a **standalone design note** intended to survive session context loss. A fresh session should be able to pick this up and:
1. Understand the full vision and why we're building this
2. See exactly which parts of the proposal reuse existing infrastructure vs. introduce new work
3. Read the key design decisions we've already made (so they don't get re-litigated)
4. Kick off a formal implementation spec (`architect` agent, then `spec-reviewer`) without needing to re-derive anything

When resuming:
- Read this note end-to-end before invoking `architect`
- Re-verify the gap analysis sections against current code — the codebase will have moved
- Treat every "Key design decision" as a commitment unless there's a strong reason to revisit
- Treat every "Open question" as genuinely open — don't silently pick an answer

---

## Table of contents

1. [Context & scope](#1-context--scope)
2. [Workstream 1 — Triage classifier](#2-workstream-1--triage-classifier)
3. [Workstream 2 — Clarifying + Sparring Partner skills](#3-workstream-2--clarifying--sparring-partner-skills)
4. [Workstream 3 — User-triggered memory capture](#4-workstream-3--user-triggered-memory-capture)
5. [Workstream 4 — Retrieval audit](#5-workstream-4--retrieval-audit)
6. [Reuse vs new — infrastructure mapping](#6-reuse-vs-new--infrastructure-mapping)
7. [Key design decisions](#7-key-design-decisions)
8. [Mockups](#8-mockups)
9. [Phased implementation plan](#9-phased-implementation-plan)
10. [Open questions](#10-open-questions)
11. [Session handoff](#11-session-handoff)

---

## 1. Context & scope

### Origin

This design emerged from watching a YouTube tutorial on using Claude effectively, which distilled three prompting tips:

1. **Clarifying questions** — append "ask me clarifying questions until you're 95% confident you can complete the task" to a prompt; Claude interrogates vague inputs before acting.
2. **Sparring partner** — ask the LLM to "identify my blind spots, risks, and assumptions"; flips the LLM from sycophant to adversary.
3. **Conversation → skill** — have Claude generate a reusable skill from a chat, so the pattern can be triggered by name later without re-prompting.

The question was whether these *individual-user prompt tricks* could be elevated into **platform primitives** inside Automation OS — so every agent, every chat surface, and every team member benefits automatically, not just users who know the magic phrases.

### Business driver

The agency-facing value proposition in `docs/capabilities.md` ("LLM providers sell capability; Synthetos sells the business") depends on agents being *trustworthy operators*, not just eager responders. An agent that silently proceeds with a half-specified task, or glazes a flawed plan, is actively harmful in a multi-client setting — bad work gets billed, reputations get dented, clients churn.

Embedding "clarify when uncertain" and "challenge when weak" as platform behaviour is a direct lever on output quality across every client engagement. It's also model-agnostic — the behaviour is in our layer, not the LLM's, so it applies identically whether we route to Claude, GPT, or open-source models.

### What's in scope

Four workstreams, detailed in sections 2–5:
- **W1** — cheap triage classifier in front of the Orchestrator
- **W2** — Clarifying + Sparring as capability skills with masterPrompt gating
- **W3** — user-triggered memory capture (3 phases: slash command + library, approval-gate suggestion, provenance trail)
- **W4** — retrieval audit (investigation, not a build)

### What's explicitly out of scope

- **YouTube tip #3 verbatim — "turn this conversation into a skill."** We considered this and decided not to build it directly. Skills in Automation OS are system-level primitives authored by developers or admins, not per-user artefacts generated on the fly. Letting every user mint skills from chat creates a governance/safety mess (naming collisions, quality drift, audit burden, scope confusion). The *intent* behind tip #3 — "let the system learn from our conversations" — is addressed via W3 (memory capture) instead, which is better scoped and safer.
- **A general-purpose "memory" surface separate from existing memory infrastructure.** The codebase already has `memoryBlocks`, `agentBeliefs`, `workspaceMemoryEntries`, `orgMemories` and their associated services. Building a parallel memory system would be duplication and a governance nightmare. W3 reuses existing tables (see section 6).
- **Auto-extraction from every chat message.** Considered and rejected. Signal-to-noise is poor, it floods the human review queue, and it duplicates the weekly synthesis pipeline. Capture fires only at high-signal moments (user-triggered, or approval-gate teachable moments).
- **Fixing retrieval problems.** W4 audits retrieval but doesn't fix it. If the audit reveals retrieval is broken, that becomes its own workstream — not folded in silently.

### Relationship to other in-flight work

At the time of writing, the active project focus per `CLAUDE.md` is **ClientPulse Phase 4 + 4.5** on branch `claude/clientpulse-phase-4-development-ED1D9`. This design note branch (`claude/research-questioning-feature-ddKLi`) is a deliberate pause on that focus to capture this thinking before context evaporates.

**Explicit sequencing recommendation:** ClientPulse Phase 4+4.5 should ship first, then return to this note to produce a full implementation spec. Reasoning in section 11.


## 2. Workstream 1 — Triage classifier

### Problem it solves

Today, chat surfaces either dispatch directly to the Orchestrator (full LLM run, ~seconds + real tokens) or don't engage an agent at all. There's no middle ground — no cheap way to decide "this message is coordination chatter, reply simply" vs "this needs Orchestrator routing" vs "this needs clarifying questions before anything else."

Without a triage step, either we over-invoke the Orchestrator (expensive, slow, overkill) or under-invoke it (miss opportunities to deliver value). A cheap classifier in front lets us make that call per-message at ~millisecond cost.

### Shape of the solution

Two-tier router, both tiers minimal:

**Tier 1 — Heuristic (zero LLM cost, ~1ms):**
- Keyword patterns (question marks, decision verbs, @-mentions, action keywords)
- Message length thresholds
- Surface context (task comment vs issue creation vs orchestrator chat)
- Recency patterns (is this a reply to an agent output, or a new thread?)
- Output: `{route: "simple_reply" | "needs_orchestrator" | "needs_clarification", confidence: 0–1}`

**Tier 2 — Cheap model fallback (~100ms, cents):**
- Haiku-tier model call with a tight structured output schema
- Triggered only when Tier 1 confidence < threshold
- Same output shape

### Existing in-house patterns to mirror

- `server/lib/queryIntentClassifier.ts` — regex-based intent classifier (temporal/factual/relational/exploratory). Zero LLM calls. Direct precedent for Tier 1.
- `server/services/topicClassifier.ts` + `topicClassifierPure.ts` — keyword-based topic classification with a pure-function twin for testing. Direct precedent for the pure-function pattern.
- `server/services/pulseLaneClassifier.ts` — cost/irreversibility/scope heuristics for routing pulse items. Direct precedent for heuristic tiering.

### File layout (proposal, subject to spec review)

- `server/services/chatTriageClassifier.ts` — the service entry point
- `server/services/chatTriageClassifierPure.ts` — pure function for testability
- `server/services/__tests__/chatTriageClassifierPure.test.ts` — test suite
- Wire-in: wherever chat messages currently dispatch to the Orchestrator — we insert the classifier as the gate

### Design decisions already made

- **Tier 1 before Tier 2, always.** Never call Haiku if heuristics can decide. Cost discipline.
- **Classifier output drives Orchestrator invocation, not replaces it.** The Orchestrator still does the real work; the classifier just decides whether it runs.
- **"Simple reply" route is a valid outcome.** Not every message needs an agent. A one-line reply from the system (or no reply) is often the right answer.

### Risks to watch

- **Heuristic drift.** Regex-based routers always drift as language/surface usage evolves. Mitigation: log every classification decision, review weekly for drift, tune thresholds.
- **Tier 2 false negatives.** A cheap model deciding "no Orchestrator needed" when it was needed is a quality regression. Mitigation: bias Tier 2 toward "when in doubt, invoke Orchestrator." Cost of false-positive invocation is tokens; cost of false-negative is missed value.
- **Latency on cold paths.** Haiku fallback adds 100ms. Acceptable for chat surfaces; worth measuring on the real-time ones (task comments, subaccount chat).


## 3. Workstream 2 — Clarifying + Sparring Partner skills

### Problem it solves

Agents currently tend toward two failure modes:
- **Over-eager acceptance** — take a vague request and fabricate specifics to proceed, producing plausible-looking output that doesn't match user intent
- **Sycophancy** — validate the user's plan even when it has obvious weaknesses, because the LLM is trained to be helpful and agreeable

Both erode trust. W2 introduces two platform primitives that counteract them — available app-wide, triggered intelligently, not per-prompt-trick.

### Shape of the solution

Two new capability skills live alongside the existing four in `server/tools/capabilities/`:

1. **`ask_clarifying_questions`** — given a task/request, drafts a targeted set of clarifying questions (≤5, ranked by ambiguity-reduction impact), posts them back to the user surface, pauses execution until answered.
2. **`challenge_assumptions`** — given a plan/proposal/decision, runs an adversarial analysis: identifies weakest assumptions, missing evidence, plausible counter-arguments. Returns structured output (not a reply — surfaces the challenges so the Orchestrator or downstream agents can decide what to do with them).

### The *when-to-invoke* logic lives in the Orchestrator masterPrompt

Critical design call: **masterPrompt = when; skill = what.** The skills themselves have no "should I run?" logic — they're pure capabilities. The Orchestrator's masterPrompt (migration 0157, Path A–D routing) gets extended with two gating heuristics:

**Clarifying gate:**
- When a task description is ambiguous, scope-unclear, or missing required context, invoke `ask_clarifying_questions` before routing to an executing agent
- Threshold: Orchestrator's self-assessed confidence in task specification (<95%, echoing the video's framing) triggers clarification
- Budget: counts against the existing capability-query budget (currently 8 calls max per Orchestrator run)

**Challenge gate:**
- When a proposed plan crosses a cost/irreversibility/scope threshold, invoke `challenge_assumptions` before final approval or execution
- Threshold patterns: external-facing actions, monetary cost above a floor, multi-subaccount scope, decisions that touch regulatory/compliance surfaces
- Output flows into the approval surface — challenges become first-class content on the approval card, not buried

### Existing in-house patterns to mirror

- `server/tools/capabilities/capabilityDiscoveryHandlers.ts` — four existing capability skills (`list_platform_capabilities`, `list_connections`, `check_capability_gap`, `request_feature`). Direct precedent for skill shape, registration, and execution.
- `migrations/0157_orchestrator_system_agent.sql` — masterPrompt structure with Path A–D routing, loop guards, and budget. Direct precedent for where to add the new gates.

### File layout (proposal, subject to spec review)

- `server/tools/capabilities/askClarifyingQuestionsHandler.ts` — new skill handler
- `server/tools/capabilities/challengeAssumptionsHandler.ts` — new skill handler
- Register in `server/config/actionRegistry.ts` and `server/services/skillExecutor.ts` (per `CLAUDE.md` "Add a capability discovery skill" row)
- Migration: update Orchestrator system agent masterPrompt (new migration, don't edit 0157 in place)
- Decrement/increment `SkillExecutionContext.capabilityQueryCallCount` consistent with existing capabilities

### Design decisions already made

- **These are not always-on.** Threshold-triggered, not default. Overriding the video's "add to every prompt" framing, because platform-level overuse creates friction.
- **Skills are inspectable and toggleable.** Per-org settings should allow disabling either skill (though defaults-on recommended).
- **Challenge outputs are surfaced, not silenced.** If the sparring partner finds blind spots, the user sees them — we don't let the Orchestrator discard challenges because they're inconvenient.
- **No separate user-facing "I want you to challenge me" command.** The gating logic decides. Exception: a power-user escape hatch (e.g. `/challenge` slash command) may be added later, but not in the initial build.

### Risks to watch

- **Threshold calibration.** Too aggressive → dialog fatigue. Too conservative → never fires and we ship a dead feature. Mitigation: log invocation rate per org, review after 2 weeks of real traffic, tune thresholds.
- **Clarifying loop-back.** User answers a clarifying question ambiguously → do we ask again? Bounded retries (max 2 rounds) with a graceful "proceed with best guess and flag uncertainty" fallback.
- **Challenge tone.** Sparring-partner output that reads as condescending will tank adoption. Tone spec is part of the skill prompt design. Target: "trusted colleague pushing back," not "pedantic reviewer."
- **Interaction with the triage classifier (W1).** W1 routes to "needs_clarification" as a signal — but the skill itself lives inside the Orchestrator. Make sure these two systems aren't duplicating the clarifying decision. Likely pattern: W1 flags "probably needs clarification," Orchestrator makes the final call and invokes the skill.


## 4. Workstream 3 — User-triggered memory capture

### Problem it solves

The codebase has substantial memory infrastructure (`memoryBlocks`, `agentBeliefs`, `workspaceMemoryEntries`, `orgMemories`, synthesis service, belief extraction) but users can't **see, author, or undo** memories directly. The existing review queue is admin-facing governance UX, not everyday-user UX.

Result: memory exists but is opaque. Users can't:
- Teach the system a durable rule in-the-moment ("I keep approving template A for cold outreach — remember that")
- Browse what the system has learned about their accounts
- Edit or delete a rule that's gone stale or wrong
- Understand *why* an agent acted a particular way (which rule influenced it?)

W3 closes that gap. Three sub-phases, each independently shippable.

### Architectural principle

**Reuse over rebuild.** The existing memory tables and services cover ~85% of what we need. W3 is primarily a UX layer on top of existing infrastructure, plus one genuinely new capability (provenance tracking on agent runs). See section 6 for the full reuse mapping.

---

### 4a. Phase W3a — Slash command + Learned Rules library

**Goal:** Give users a way to explicitly save a rule, browse all saved rules, and edit/delete them. No auto-suggestion; no approval-gate integration. Pure user-initiated capture + visibility.

**Scope:**

1. **`/remember` slash command** in chat surfaces (Orchestrator chat, task comments, subaccount chat, issue threads). Example: `/remember prefer template A for cold outreach, scope: Cold Outreach Agent`. Opens the capture dialog with prefilled text.
2. **Capture dialog** — see Mockup C in section 8. Plain-English rule text + scope picker (subaccount / agent / org) + optional context notes. On save, writes to existing `memoryBlocks` with a new source marker (e.g. `source='user_triggered'` or a boolean flag — design call for spec).
3. **Learned Rules library page** — new client page at e.g. `/rules` or `/memory/rules`. Filterable by scope (agent, subaccount, org), active/paused status, date added, creator. Lists every user-triggered rule with edit/pause/delete controls.
4. **5-second undo toast** after save. Low-friction safety net.

**What's new vs reused:**
- **Storage: 95% reuse.** `memoryBlocks` + `memoryBlockVersions` cover everything except the `source='user_triggered'` marker (one-field addition).
- **Library UI: new client page.** Admin memory UIs exist (`MemoryReviewQueuePage`, `MemoryBlockDetailPage`) but are governance-scoped. A user-facing "my rules" library needs a new presentational layer.
- **Slash command handler: new.** Needs wire-up in every chat surface.
- **Capture dialog: new component.** Reusable across surfaces.

**Explicit decisions already made:**
- User-triggered rules **skip the existing admin review queue** — they go live at their chosen scope immediately. Rationale: user explicitly vouched for them; an extra review gate at this phase is overkill. (If teams want governance at org scope later, add a light admin-confirmation step just for `scope=org` rules.)
- Scope picker is **mandatory**, not optional. Defaulting rules to unspecified scope is a recipe for stale context injection.

---

### 4b. Phase W3b — Approval-gate suggestion + teachability heuristic

**Goal:** When a user approves or rejects a proposal through the existing HITL approval gate, offer an optional in-context "teach the system?" prompt with LLM-drafted candidate rules.

**Scope:**

1. **Teachability filter** — a pre-check that decides whether to surface the capture prompt on a given approval/rejection. Not every approval triggers it. Heuristic inputs: novelty (is this decision different from recent patterns?), specificity (does it imply a durable rule?), scope (cross-cutting vs. one-off).
2. **Candidate drafter** — a cheap LLM call (Haiku-tier) that reads the approval context and drafts 2–3 plain-English candidate rules fitting a fixed set of categories (preference, targeting, content, timing, approval, scope). Categories are the "drawers" in the filing cabinet — AI fills in the blanks.
3. **In-approval suggestion panel** — see Mockup B in section 8. Appears below the approval action after the approval/rejection lands. Three candidate options + "custom" text field + scope picker. Prominent "Not now" dismiss.
4. **Rejection path** — Mockup E. Mirror of approval path, reworded to "avoid next time" framing. Rejections are often higher-signal than approvals.
5. **Auto-backoff** — if user skips N suggestions in a row, pause suggestions for a cooldown window. Per-user frequency setting in user prefs (off / occasional / frequent).

**What's new vs reused:**
- **Teachability heuristic: new.** The existing `memoryBlockSynthesisService` has quality-scoring logic we can learn from, but it's a clustering-quality filter, not a capture-worthiness filter. New heuristic.
- **Candidate drafter: new.** Patterned after `agentBeliefService` (belief extraction from runs) but operates on approval context, not full runs.
- **Suggestion panel: new component.** Rendered inside the existing approval-gate surface.
- **Backoff state: new, but lives in user prefs.** Small schema addition or reused settings table.

**Explicit decisions already made:**
- **Hybrid candidate generation.** Fixed category taxonomy (preferences, targeting, content, timing, approval, scope) + LLM fill-in. Not pure LLM freeform (quality drift), not pure hardcoded (brittle).
- **"Not now" is always first-class.** Never modal. Never blocks the approval flow. The approval completes whether or not the user engages with the suggestion.
- **Rejection capture uses "avoid" framing, not "remember" framing.** Matches the user's mental state.

---

### 4c. Phase W3c — Provenance trail on agent outputs

**Goal:** When an agent acts on a remembered rule, surface *which rule* influenced the output — so bad rules are discoverable at the moment they misfire.

**Scope:**

1. **Log which rules were injected into an agent's context** on every run. Today, runs track `citedEntryIds` for `workspaceMemoryEntries` but not for `memoryBlocks`. New field: `appliedMemoryBlockIds` on `agentRuns` (or equivalent).
2. **Extend the memory citation detector** to score `memoryBlocks` against agent outputs, not just `workspaceMemoryEntries`. Reuses `server/services/memoryCitationDetector.ts` patterns.
3. **Prompt modification** — agents are prompted to reference rules when they act on them ("I applied rule X because..."). Lightweight; doesn't require major prompt restructure.
4. **UI surfacing** — see Mockup D in section 8. Agent output card shows "Rules applied" list with clickable links that jump to the Learned Rules library with that rule highlighted for editing.

**What's new vs reused:**
- **Citation infrastructure for blocks: partial new.** `memoryCitationScores` + `citedEntryIds` pattern exists for entries; extending to blocks needs schema + scorer changes.
- **Prompt modification: new, lightweight.** Part of the agent execution loop's context-injection step.
- **UI component: new.** Attaches to existing agent output surfaces.

**Explicit decisions already made:**
- **Provenance is read-only from the agent output surface.** Click-through goes to the Learned Rules library (where editing happens). Don't duplicate rule-edit UX on every agent output card.
- **Applied ≠ cited.** A rule might be injected into context but not actually influence output. Ideally we track both, but MVP: log injection; cite when confidence is high that the rule shaped output.

**Why this phase is the most ambitious:**

Touches the agent execution loop (`server/services/agentExecutionService.ts`), run logs (schema change), citation detection (service extension), prompt templates, and a new UI component. Likely a separate session's worth of work. Depends on W4 (retrieval audit) to scope correctly — if the audit reveals retrieval is leaky, W3c's scope grows to include retrieval fixes.


## 5. Workstream 4 — Retrieval audit

### Problem it solves

All the capture work in W3 only matters if memory actually reaches agents at the right moment. Capture without retrieval is a silent failure mode: users save rules, trust the system to apply them, and the system quietly doesn't. That's worse than no memory at all — it erodes trust asymmetrically.

### What the audit should answer

A short (half-day to one-day) investigation, not a build. Answers these questions:

1. **When a task is assigned to an agent that has relevant `memoryBlocks`, are those blocks actually injected into the agent's context?** Trace the path from `memoryBlocks` → context assembly → LLM prompt. Find gaps.
2. **When `agentBeliefs` exist for an agent-subaccount pair, do they influence the agent's decisions?** Sample recent runs where beliefs exist and compare behaviour vs. similar runs without beliefs. Are beliefs surfacing?
3. **Do `workspaceMemoryEntries` (insights) get cited in outputs at the expected rate?** The `memoryCitationDetector` exists; pull citation rates from the last 30 days of runs. What's the baseline?
4. **Scope resolution — when an agent runs for subaccount X, does context assembly correctly pull (a) subaccount-scoped rules, (b) agent-scoped rules, (c) org-scoped rules, and prioritise correctly?** Likely the biggest risk area. Scope hierarchy in the schema doesn't guarantee correct retrieval in practice.
5. **Is there a "too much memory" problem?** When many blocks/beliefs exist, are they all injected (context bloat) or is there relevance ranking? What are the thresholds today?

### Deliverable

A short report (1–2 pages) at `tasks/research-questioning-retrieval-audit.md` covering:
- Current retrieval behaviour, surface by surface
- Gaps found (with severity: critical / moderate / minor)
- Recommendations for W3c scope adjustment (does provenance alone suffice, or do we need retrieval fixes too?)

### Why this goes first

Cheap insurance. Half a day of investigation before committing to W3c (the most expensive phase) can save a week of building on a broken foundation. Also informs W3a/b — if retrieval is fine today, we can focus on capture UX with confidence.

---

## 6. Reuse vs new — infrastructure mapping

This section is the honest accounting of what we're actually building. The design's defensibility rests on most of it being reuse, not new infrastructure.

### Existing infrastructure the design leverages

**Memory tables and services (all already exist, all in use):**
- `memoryBlocks` + `memoryBlockVersions` — named, versioned, scoped memory blocks with status (active/draft/pending_review/rejected), source (manual/auto_synthesised), confidence (low/normal). Scope fields: `organisationId`, `subaccountId`, `ownerAgentId`.
- `agentBeliefs` — per-agent-per-subaccount discrete facts with confidence + evidence counts + supersession tracking.
- `workspaceMemoryEntries` + `workspaceMemories` — References (manual) vs Insights (auto-captured), with promotion/demotion flow.
- `orgMemories` + `orgMemoryEntries` — org-level insights with entry types (observation/decision/preference/issue/pattern).
- `memoryBlockSynthesisService` — weekly clustering + LLM summarisation + confidence-tier gating.
- `agentBeliefService` — per-run belief extraction with supersession.
- `memoryCitationScores` + `memoryCitationDetector` — citation tracking for workspace entries.
- `MemoryReviewQueuePage`, `MemoryBlockDetailPage`, `WorkspaceMemoryPage`, `OrgMemoryPage` — admin-facing memory UIs.

**Orchestrator and routing infrastructure:**
- `orchestratorFromTaskJob.ts` — dispatches tasks to Orchestrator
- `capabilityDiscoveryHandlers.ts` — four existing capability skills + patterns for adding more
- Migration 0157 masterPrompt — structured routing with Path A–D, capability-query budget, loop guards
- `server/config/actionRegistry.ts`, `server/services/skillExecutor.ts` — skill registration and execution

**Classifier patterns:**
- `queryIntentClassifier.ts` — regex-based intent classification
- `topicClassifier.ts` + pure twin — keyword-based topic classification
- `pulseLaneClassifier.ts` — heuristic-tier routing

### Per-workstream reuse ledger

| Workstream | Storage | UI | Logic | Net new |
|---|---|---|---|---|
| **W1 Classifier** | N/A | N/A | New (mirrors 3 existing classifiers) | 1 new service + pure twin + tests; integration points at existing chat dispatchers |
| **W2 Clarifying + Sparring** | N/A | N/A | New skills (mirrors existing 4 capability handlers) | 2 new skill handlers + masterPrompt migration + registry wire-up |
| **W3a Slash + Library** | 95% reuse (one `source` enum value) | New client page | Slash command handler (new) | 1 schema-diff, 1 new page, 1 slash command, 1 new dialog component |
| **W3b Approval suggestion** | Reuse (same tables as W3a) | New component, attached to existing approval surface | Teachability filter (new); candidate drafter (new, small LLM call) | 2 new services + UI component + user-prefs update |
| **W3c Provenance** | `agentRuns` schema change; `memoryCitationScores` extension | New provenance panel on agent output | Citation detector extension; prompt modification in execution loop | Biggest — schema change + service extension + prompt change + new UI |
| **W4 Retrieval audit** | No changes | No changes | Investigation only | Written report |

### The honest summary

- **W1 and W2** are net-new but pattern-matched to existing precedents. Low architectural risk.
- **W3a and W3b** are mostly UX on top of existing data. Minimal schema impact.
- **W3c** is the genuinely ambitious piece — the most novel work, the most failure modes, and the feature that most determines whether this whole effort delivers value.
- **W4** is the insurance. Don't skip it.

The design is defensible precisely because it doesn't rebuild what the codebase already has. If a reviewer ever asks "why are we building yet another memory system?" — the answer is "we're not. We're making the existing one usable."

## 7. Key design decisions

Decisions made during this session that should be treated as commitments unless there's strong reason to revisit. Each is a closed question so downstream work doesn't re-litigate them.

### D1 — Tip #3 (conversation → skill) is out of scope

**Decision:** We don't build a "turn this conversation into a skill" feature directly.
**Rationale:** Skills in Automation OS are system-level primitives authored by developers/admins. Per-user skill generation creates naming collisions, quality drift, audit burden, and scope confusion. The intent behind the tip — "let the system learn" — is served better by W3 memory capture.

### D2 — Clarifying and Sparring are threshold-triggered, not default-on

**Decision:** Both skills fire only when Orchestrator masterPrompt gates say so, not on every interaction.
**Rationale:** Platform-wide "always ask clarifying questions" creates dialog fatigue. The *value* of clarification is highest on ambiguous, high-stakes requests — not on every hello. Gating preserves the signal.

### D3 — When to invoke lives in masterPrompt; what to do lives in skills

**Decision:** Trigger logic (confidence thresholds, cost/irreversibility thresholds) belongs in Orchestrator masterPrompt. Execution logic (drafting questions, generating challenges) belongs in capability skill handlers.
**Rationale:** Separation of concerns. Skills stay pure and reusable; masterPrompt is the policy surface that can evolve without touching skill code.

### D4 — Classifier is two-tier heuristic + Haiku fallback, not pure LLM

**Decision:** Tier 1 heuristic runs first; Tier 2 Haiku-tier model only for ambiguous cases.
**Rationale:** Cost discipline + latency. Existing in-house classifiers (three of them) all use this pattern — don't break from it without reason.

### D5 — User-triggered rules skip the admin review queue

**Decision:** When a user clicks "remember this," the rule goes live at its chosen scope immediately. No second-pair-of-eyes gate.
**Rationale:** The user explicitly vouched for the rule. An extra review gate at phase 1 is overkill friction. If governance concerns emerge at org scope, add a light admin confirmation specifically for `scope=org` rules — not a blanket gate.

### D6 — Scope picker is mandatory

**Decision:** Every user-triggered rule requires an explicit scope (subaccount / agent / org). No default-unspecified scope.
**Rationale:** Scope determines where the rule gets injected later. Unspecified scope is a stale-context-injection landmine. Forcing the choice at capture is cheap and eliminates the ambiguity permanently.

### D7 — Capture is user-triggered or approval-gated; not per-message

**Decision:** We do not auto-extract rules from every chat message. Capture fires only on explicit user action (W3a) or on high-signal decision moments (W3b).
**Rationale:** Per-message extraction has poor signal-to-noise, floods the review queue, and duplicates the existing weekly synthesis pipeline. Three arguments rejected during design, preserved here so the question doesn't resurface.

### D8 — Candidate generation in W3b is hybrid (fixed categories + LLM fill-in)

**Decision:** Approval-gate suggestions use a fixed taxonomy of rule categories (preference, targeting, content, timing, approval, scope) with LLM drafting the specific wording.
**Rationale:** Pure LLM freeform → quality drift. Pure hardcoded templates → brittle and irrelevant. Hybrid gives consistency with relevance.

### D9 — Provenance is read-only on agent output surface

**Decision:** Clicking a rule in the "Rules applied" provenance panel navigates to the Learned Rules library with that rule focused for editing. No inline edit on the agent output card.
**Rationale:** Single source of truth for rule edits. Duplicating edit UX on every agent output card creates maintenance burden and inconsistent state.

### D10 — Phase 1 scope does not require W3c to ship

**Decision:** W3a (slash command + library) is shippable without W3c (provenance). Users can capture and browse rules before the system can cite them.
**Rationale:** Ship value early. Provenance is important but not gating. Allows stopping after any phase and leaving the app in a coherent state.

### D11 — Reuse over rebuild for memory infrastructure

**Decision:** W3 must use existing `memoryBlocks`, `workspaceMemoryEntries`, `memoryBlockVersions`. No parallel memory system.
**Rationale:** The existing memory system is ~85% of what we need. Building a parallel system creates two sources of truth, doubles the governance burden, and wastes engineering capacity on duplicated infrastructure.

### D12 — ClientPulse Phase 4+4.5 ships before this work begins

**Decision:** Finish the in-flight ClientPulse spec + implementation on its dedicated branch. Return to this note to write the full implementation spec only after ClientPulse merges.
**Rationale:** Two half-shipped features is worse than one done + one queued. Context-switch cost is asymmetric (returning to ClientPulse later is more expensive than returning to this design note later). See section 11 for the full handoff.

---

## 8. Mockups

ASCII mockups capturing the UI intent. Treat these as guidance for the implementation spec, not pixel-perfect specifications — the real design should be done in the client's design system (Tailwind + shadcn/ui per existing pages).

### Mockup A — Routine approval (no teach prompt)

Most approvals remain clean. The teachability filter judged this routine; no prompt appears.

```
┌──────────────────────────────────────────────────┐
│ Agent proposes: Send follow-up email to          │
│ contact Jane Miller (standard 48h cadence)       │
│                                                  │
│ [ Reject ]                    [ Approve ]        │
└──────────────────────────────────────────────────┘
```

### Mockup B — Teachable approval

Only when the system spots a pattern worth generalising. "Suggestion" header makes clear this is secondary to the primary action (approval already happened).

```
┌──────────────────────────────────────────────────┐
│ ✓ Approved: Cold-outreach campaign to            │
│   50 Phoenix dentists, template A                │
│                                                  │
│ ──────────────────────────────────────────       │
│ 💡 Suggestion — teach the system?                │
│                                                  │
│  ○ Prefer template A for cold outreach           │
│  ○ Phoenix dentists are an approved target       │
│  ○ Custom...                                     │
│                                                  │
│ Scope: [ Cold Outreach Agent ▾ ]                 │
│                                                  │
│ [ Not now ]                  [ Save rule ]       │
└──────────────────────────────────────────────────┘
```

### Mockup C — Slash-command capture dialog

Triggered by `/remember <text>` or the chat "Remember" affordance.

```
┌──────────────────────────────────────────────────┐
│ Remember a rule                                  │
│                                                  │
│ Rule: ┌──────────────────────────────────────┐   │
│       │ Prefer template A for cold outreach. │   │
│       │ Phoenix dentists are a valid target. │   │
│       └──────────────────────────────────────┘   │
│                                                  │
│ Scope: [ Cold Outreach Agent ▾ ]                 │
│                                                  │
│ Context (optional):                              │
│ ┌────────────────────────────────────────────┐   │
│ │ From approval of task #4721                │   │
│ └────────────────────────────────────────────┘   │
│                                                  │
│ [ Cancel ]                   [ Save rule ]       │
└──────────────────────────────────────────────────┘
```

### Mockup D — Provenance panel on agent output

Clickable rule links jump to the Learned Rules library with that rule focused for editing. The key scalability surface — makes bad rules *findable* the moment they misfire.

```
┌──────────────────────────────────────────────────┐
│ Agent: Sending template A to 18 Phoenix          │
│        dentists at 10am Tuesday.                 │
│                                                  │
│        Rules applied:                            │
│        • Phoenix dentists approved target 🔗     │
│        • Prefer template A for cold outreach 🔗  │
│        • Never email on weekends 🔗              │
│                                                  │
│ [ Approve ]   [ Reject ]   [ Edit rules ]        │
└──────────────────────────────────────────────────┘
```

### Mockup E — Rejection capture

Higher-signal than approvals. "Avoid" framing matches user's mental state.

```
┌──────────────────────────────────────────────────┐
│ ✗ Rejected: "Email blast 50 Phoenix dentists"    │
│                                                  │
│ ──────────────────────────────────────────       │
│ What should the system avoid next time?          │
│                                                  │
│  ○ Nothing — this one was just wrong             │
│  ○ Never email > 20 contacts at once             │
│  ● Template A is too aggressive for cold leads   │
│  ○ Custom: ________________________________      │
│                                                  │
│ Scope: [ Cold Outreach Agent ▾ ]                 │
│                                                  │
│ [ Skip ]                    [ Save as rule ]     │
└──────────────────────────────────────────────────┘
```

### Mockup F — Learned Rules library

One library per scope (or unified with scope filter). *Used N times* helps spot low-value rules ("used 0 times in 3 months — probably delete"). Links back to originating task/chat.

```
┌────────────────────────────────────────────────────────────┐
│ Learned Rules — Phoenix Dental (subaccount)                │
│                                                            │
│ Filter: [ All ▾ ]  [ All agents ▾ ]  [ Active ▾ ]          │
│                                                            │
│ ─────────────────────────────────────────────────────────  │
│ 🎯 Phoenix dentists are an approved cold-outreach target   │
│    Scope: Cold Outreach Agent · Active · Used 14 times     │
│    Added by Mike · 3 days ago · From task #4721            │
│    [ Edit ]  [ Pause ]  [ Delete ]                         │
│ ─────────────────────────────────────────────────────────  │
│ 📝 Prefer template A for cold outreach                     │
│    Scope: Cold Outreach Agent · Active · Used 9 times      │
│    Added by Mike · 3 days ago · From task #4721            │
│    [ Edit ]  [ Pause ]  [ Delete ]                         │
│ ─────────────────────────────────────────────────────────  │
│ ⏰ Never email contacts on weekends                        │
│    Scope: All agents · Paused · Used 0 times               │
│    Added by Sarah · 2 weeks ago · From rejection #2110     │
│    [ Edit ]  [ Resume ]  [ Delete ]                        │
└────────────────────────────────────────────────────────────┘
```

### Mockup G — Undo toast after save

5-second toast in corner. Low-friction safety net for misclicks.

```
    ┌────────────────────────────────────────────┐
    │ ✓ Rule saved                         [Undo]│
    │   "Prefer template A for cold outreach"    │
    └────────────────────────────────────────────┘
                                        (fades in 8s)
```


## 8. Mockups

_(see section below)_

## 9. Phased implementation plan

Six phases, ordered cheapest-and-highest-leverage first. Each phase leaves the app in a coherent, shippable state — you can stop after any phase and the work still delivers value.

### Phase 0 — Retrieval audit (W4)

**Shape:** Half-day to one-day investigation.
**Deliverable:** `tasks/research-questioning-retrieval-audit.md` — findings + gap severity + recommendations for W3c scope.
**Success criteria:** Clear answer to "is existing memory actually reaching agents today?" with evidence.
**Risk:** Low. Investigation only; no code changes.
**Gates:** None.

### Phase 1 — Triage classifier (W1)

**Shape:** New service + pure twin + tests + integration points at existing chat dispatchers.
**Deliverable:** `chatTriageClassifier.ts`, `chatTriageClassifierPure.ts`, test suite, wire-in at dispatch points.
**Success criteria:** Every chat message in target surfaces gets a classification decision in <1ms (heuristic tier) or <150ms (Haiku fallback). Log shows sensible distribution of routing decisions over a week.
**Risk:** Low. Pattern-matched to existing classifiers.
**Gates:** `npm run lint`, `npm run typecheck`, `npm test` on pure twin.

### Phase 2 — Clarifying + Sparring skills (W2)

**Shape:** Two new capability skill handlers + `actionRegistry`/`skillExecutor` registration + masterPrompt migration.
**Deliverable:** `askClarifyingQuestionsHandler.ts`, `challengeAssumptionsHandler.ts`, migration extending Orchestrator masterPrompt with two gating heuristics.
**Success criteria:** Skills invokable from Orchestrator; threshold-triggered behaviour visible in real task flows; clarifying-question depth bounded to 2 rounds; challenge output surfaced on approval cards when triggered.
**Risk:** Medium — threshold calibration will need tuning post-launch.
**Gates:** Lint, typecheck, test; `pr-reviewer` agent pass; manual verification in a test subaccount.

### Phase 3 — Memory capture W3a (slash + library)

**Shape:** Schema diff (source marker); `/remember` slash command; Learned Rules library page; capture dialog component.
**Deliverable:** Migration for source marker; slash command handler; new client page at `/rules` (or chosen path); `CaptureRuleDialog` component; wire-up in chat surfaces.
**Success criteria:** Users can capture a rule from any chat surface; browse all captured rules per scope; edit/pause/delete rules; undo within 8s.
**Risk:** Low-medium. Mostly reuse; library UI is the main new surface.
**Gates:** Lint, typecheck, test; `npm run db:generate` for migration; `pr-reviewer` pass; UI verification in browser per `CLAUDE.md` frontend rules.

### Phase 4 — Memory capture W3b (approval suggestion)

**Shape:** Teachability filter service; candidate drafter service (Haiku call); approval-gate UI extension; user-prefs for backoff/frequency.
**Deliverable:** `ruleTeachabilityClassifier.ts`, `ruleCandidateDrafter.ts`, suggestion panel component, user pref fields for suggestion frequency + backoff state.
**Success criteria:** Approval-gate surface shows suggestion panel only on teachable decisions; candidates are relevant (manually verified); skip-rate tracked; backoff triggers after configured skip count.
**Risk:** Medium — candidate quality is the feature's make-or-break. May need iteration.
**Gates:** Lint, typecheck, test; `pr-reviewer` pass; manual verification of suggestion quality in real approvals (minimum 20 sample approvals).

### Phase 5 — Memory capture W3c (provenance)

**Shape:** `agentRuns` schema extension; `memoryCitationDetector` extension; prompt modification in `agentExecutionService`; provenance UI component on agent output surfaces.
**Deliverable:** Migration adding `appliedMemoryBlockIds` to `agentRuns`; citation detector update to score blocks; execution-loop prompt extension; `RulesAppliedPanel` component.
**Success criteria:** Every agent output that used a remembered rule shows which rules it applied; click-through to Learned Rules library works; citation rate (blocks cited / blocks injected) tracked and reasonable.
**Risk:** High — touches agent execution loop, schema, services, prompts, UI. Depends on Phase 0 findings.
**Gates:** Lint, typecheck, test; `architect` agent review of execution-loop changes; `pr-reviewer` pass; `dual-reviewer` strongly recommended (local dev only); verification on a controlled set of agent runs before enabling broadly.

### Session-realism honesty

- Phase 0 + Phase 1 + Phase 2 is a plausible single-session scope for an engaged developer.
- Phase 3 is a plausible second session.
- Phase 4 is borderline — possibly bundled with Phase 3 if the candidate drafter comes together cleanly, more likely its own session.
- **Phase 5 is almost certainly its own session minimum.** Treat any plan that bundles Phase 5 with earlier phases with suspicion.

### Not included in this plan

- ClientPulse Phase 4+4.5 comes first (see D12). This plan starts after ClientPulse merges.
- Any work discovered during Phase 0 that requires retrieval fixes is its own workstream, not folded silently into Phase 5.
- Per-user skill authoring (tip #3) is explicitly out of scope (see D1).

---

## 10. Open questions

Questions the design did not resolve and that require a decision before Phase 1 begins. Listed here so they don't get forgotten or silently answered by the first person to touch the code.

### Q1 — What's the right source marker for user-triggered rules in `memoryBlocks`?

Options:
- New enum value in `memoryBlocks.source` (e.g., `'manual' | 'auto_synthesised' | 'user_triggered'`) — requires migration, discriminates cleanly
- New boolean column (e.g., `isUserCaptured`) alongside existing `source='manual'` — less disruptive, slightly messier semantics
- Reuse existing `source='manual'` and rely on `createdByUserId` + UI context — no schema change, but loses a clean filter for "rules I saved"

**Recommendation:** Enum value. Cleanest for filtering the library UI and future analytics. Cost is one migration.

### Q2 — Where does the Learned Rules library live in the nav?

Options:
- Top-level `/rules`
- Nested under `/memory/rules`
- Per-subaccount section
- Org-settings section

Depends on existing IA patterns. Need to audit current nav structure before deciding.

### Q3 — Does W3b's candidate drafter call a model on every teachable approval, or is it batched/cached?

Cost implication: small per-call, but approvals happen frequently. Options:
- Per-approval Haiku call (simplest, most relevant)
- Cached draft per "approval pattern" (complex but cheaper)
- Pre-draft on approval creation, not approval action (latency-friendlier)

**Recommendation:** Per-approval for MVP. Measure cost; optimise if needed.

### Q4 — Scope default when capturing via slash command with no explicit scope

When a user types `/remember prefer template A for cold outreach` without specifying scope, what's the default?
Options:
- Current agent (if chat is with an agent)
- Current subaccount
- Require explicit scope — reject with error
- Prompt for scope in the dialog

**Recommendation:** Prompt in dialog. Don't infer silently — scope is too load-bearing to guess.

### Q5 — Who can edit/delete rules?

RBAC question. Options:
- Only the user who created the rule
- Any user with subaccount/org edit permissions
- Admins only

**Recommendation:** Anyone with the scope's edit permission. Ownership by creator is a governance anti-pattern at scale — teams need to be able to clean up each other's rules.

### Q6 — How does W1 interact with non-Orchestrator chat surfaces?

Not every chat surface dispatches to the Orchestrator today. Some may just post messages. Does the classifier run on those surfaces? Does it have a meaningful output there?

**Recommendation:** Phase 1 scope only covers Orchestrator-dispatching surfaces. Expanding to pure chat surfaces is a future phase.

### Q7 — Challenge-skill output tone

The sparring partner must push back without being condescending. Who owns the tone spec? Options:
- Fixed in skill handler prompt
- Configurable per org
- Configurable per user

**Recommendation:** Fixed for MVP. Iterate based on feedback. Don't over-engineer tone-customisation from day one.

### Q8 — Rule expiry / decay

Should rules expire automatically if unused? The existing `memoryEntryQualityService` applies nightly decay to entries. Do user-captured rules participate?

**Recommendation:** No automatic expiry in MVP. Users can manually pause/delete. Auto-decay of user-authored rules risks eroding trust ("the system forgot what I told it"). Revisit after real usage.

---

## 11. Session handoff

### Where this branch stands

- **Branch:** `claude/research-questioning-feature-ddKLi`
- **Code changes:** None. This branch contains only this design note.
- **Commit status:** Design note committed and pushed (if user initiates).
- **Next action:** Switch back to `claude/clientpulse-phase-4-development-ED1D9` and complete ClientPulse Phase 4+4.5.

### Why ClientPulse goes first (recap)

1. ClientPulse has a reviewed spec (5/5 spec-reviewer passes), plan, and progress tracker — substantial sunk design effort with momentum.
2. Half-shipped features rot. Two half-done is worse than one done + one queued.
3. This work doesn't block anything downstream — deferring costs nothing.
4. Context-switch cost is asymmetric. Returning to ClientPulse later is much more expensive than returning to this note later (which is the whole point of writing the note).

### How to resume this work (for a fresh session)

1. **Read this note end-to-end.** Especially sections 1, 7 (design decisions), and 10 (open questions).
2. **Re-verify the gap analysis in section 6.** The codebase will have moved since this note was written; reuse claims need to be re-checked against current code. Use the `Explore` agent with the same prompts that informed the original survey (see this file's git history for the prompts).
3. **Resolve the open questions in section 10** before invoking the `architect` agent. Write the answers into this note as an amendment (don't silently edit section 10 — append a "Resolved open questions" subsection).
4. **Invoke the `architect` agent** with Phase 0 and Phase 1 as the initial scope (retrieval audit + classifier). Don't try to spec all phases at once.
5. **After the architect plan lands, invoke `spec-reviewer`** to pass the spec through the Codex review loop before implementation.
6. **Implement Phase 0 first.** Its findings may reshape Phase 5's scope and should be known before committing to Phases 1–4.
7. **For Phases 3–5, expect to invoke `architect` again** per phase — the open questions get sharper as each phase lands.

### Files referenced in this note that should exist when resuming

These are reference points to sanity-check the codebase hasn't drifted:

- `server/jobs/orchestratorFromTaskJob.ts`
- `server/tools/capabilities/capabilityDiscoveryHandlers.ts`
- `migrations/0157_orchestrator_system_agent.sql`
- `server/lib/queryIntentClassifier.ts`
- `server/services/topicClassifier.ts` + `topicClassifierPure.ts`
- `server/services/pulseLaneClassifier.ts`
- `server/db/schema/memoryBlocks.ts`, `memoryBlockVersions.ts`, `workspaceMemories.ts`, `orgMemories.ts`, `agentBeliefs.ts`, `memoryCitationScores.ts`, `agentRuns.ts`
- `server/services/memoryBlockSynthesisService.ts`, `memoryBlockSynthesisServicePure.ts`
- `server/services/agentBeliefService.ts`
- `server/services/memoryCitationDetector.ts`
- `server/services/memoryEntryQualityService.ts`
- `client/src/pages/MemoryBlockDetailPage.tsx`, `MemoryReviewQueuePage.tsx`, `OrgMemoryPage.tsx`, `WorkspaceMemoryPage.tsx`
- `server/config/actionRegistry.ts`, `server/services/skillExecutor.ts`

If any of these have moved or been renamed at resume time, update this note's references before writing the spec.

### Governance notes for resumption

- This design note is itself a candidate for `spec-reviewer` before it becomes a formal spec. When writing the implementation spec, run it through `spec-reviewer` per `CLAUDE.md` workflow.
- Per `CLAUDE.md`, document updates are part of the task — when implementation lands, `docs/capabilities.md`, `architecture.md`, and relevant `references/` files must update in the same commit as the code change.
- Skills added in W2 should appear in `docs/capabilities.md` Skills Reference section.
- Memory capture UX in W3 should appear in the Product Capabilities section with vendor-neutral language per the editorial rules.

---

*End of design notes.*


## 10. Open questions

_(see section below)_

## 11. Session handoff

_(see section below)_
