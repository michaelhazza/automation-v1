# Memory System Scaling, Automation & Onboarding Spec

**Status:** Draft
**Branch:** `claude/task-memory-context-retrieval-Mr5Mn`
**Author:** Claude Code session
**Date:** 2026-04-16

---

## Table of Contents

1. [Overview](#1-overview)
2. [Background & Current State](#2-background--current-state)
3. [Scope & Dependencies](#3-scope--dependencies)
4. [Memory Scaling Fixes](#4-memory-scaling-fixes)
5. [Automation Enhancements](#5-automation-enhancements)
6. [Tier Model & Client Portal Toggles](#6-tier-model--client-portal-toggles)
7. [Weekly Briefing & Digest Playbooks](#7-weekly-briefing--digest-playbooks)
8. [Subaccount Onboarding Flow](#8-subaccount-onboarding-flow)
9. [Configuration Document Workflow](#9-configuration-document-workflow)
10. [Reusable DeliveryChannels Component](#10-reusable-deliverychannel-component)
11. [Portfolio Rollup Briefings & Digests](#11-portfolio-rollup-briefings--digests)
12. [Success Criteria](#12-success-criteria)
13. [Risks & Mitigations](#13-risks--mitigations)
14. [Open Questions](#14-open-questions)

---

## 1. Overview

This spec covers four interconnected workstreams that together make the Automation OS memory system scale-ready, reduce human management overhead to near-zero for non-technical users, and deliver immediate value to every new subaccount from day one.

**Workstream A — Memory Scaling Fixes.** Address the gaps that will degrade retrieval quality as memory volume grows: entry lifecycle management, conflict resolution, retrieval self-tuning, and recency-aware scoring.

**Workstream B — Automation Enhancements.** Ten enhancements that shift the platform from "configure once and hope" to "infer continuously and ask only when uncertain." Covers onboarding, relevance-driven retrieval, confidence-tiered HITL, real-time clarification, document drop zones, chat-based task creation, auto-synthesised blocks, self-tuning retrieval, natural-language memory inspector, and health digests.

**Workstream C — Tier Model & Client Portal.** Formalise the four-tier visibility model (System / Organisation / Subaccount / Client Portal) and build per-client portal toggles (Hidden / Transparency / Collaborative) so agencies control exactly what their clients see.

**Workstream D — Onboarding & Playbooks.** Rename the existing Daily Intelligence Brief playbook to a cadence-agnostic Intelligence Briefing (defaulting to weekly Monday 7am), create a new Weekly Digest playbook (defaulting to Friday 5pm), wire both into a new subaccount onboarding flow via the Configuration Assistant, and build the async Configuration Document workflow so agencies can collect client information offline.

These workstreams are presented separately for clarity but are designed to ship as a cohesive whole. The tier model informs where every feature fires. The onboarding flow depends on the automation enhancements. The scaling fixes underpin all of it.

---

## 2. Background & Current State

### What exists today

The memory system is a multi-table architecture with five complementary stores:

| Store | Table | Purpose |
|---|---|---|
| Memory Entries | `workspace_memory_entries` | Individual insights with pgvector(1536) embeddings, domain/topic classification, quality scoring, task scoping |
| Briefings | `agent_briefings` | Per-agent cross-run summary, auto-regenerated after each run, capped at 1200 tokens |
| Beliefs | `agent_beliefs` | Per-agent discrete facts with confidence scores, supersession support, capped at 1500 tokens |
| Memory Blocks | `memory_blocks` + `memory_block_attachments` | Letta-pattern shared named contexts attached to agents with read/read_write permissions |
| Workspace Memory | `workspace_memories` | Compiled summary + board summary + quality threshold per subaccount |

**Retrieval pipeline** (in `workspaceMemoryService.getMemoryForPrompt()`): If task context exists and is >= 20 chars, generates an embedding and runs hybrid retrieval (vector + keyword + HyDE expansion + RRF fusion). Returns top-5 results above 0.75 similarity within a 90-day recency window. Falls back to compiled summary otherwise. Optional external reranker (configurable).

**Context injection** (in `agentExecutionService.ts:678-760`): At run start, injects briefing, beliefs, task instructions, memory blocks, workspace memory, known entities, board context, and subaccount state summary. All injected upfront before the agentic loop begins.

**Token budgeting**: Briefing 1200 tokens, beliefs 1500 tokens, run budget configurable (default 30000). Context pressure middleware warns at 70% and 85%.

**Existing UI**: Memory blocks CRUD lives as a tab on `SubaccountKnowledgePage.tsx`. Full backend routes and service exist.

**Existing playbook**: `daily-intelligence-brief.playbook.ts` — schedule-configurable briefing with `autoStartOnOnboarding: true`. Steps: research, draft, publish to portal, email digest.

**Existing Configuration Assistant**: Fully architected system agent with 28 configuration tools, plan-approve-execute flow, config history, and restore capability. Runs in org subaccount. Frontend at `ConfigAssistantPage.tsx`. Runtime guidelines loaded from the `config-agent-guidelines` protected memory block (Three C's framework, priority order, tier model, safety gates).

**Protected memory blocks infrastructure**: `server/lib/protectedBlocks.ts` defines an allowlist of system-managed block names. Route guards in `server/routes/memoryBlocks.ts` prevent creation with reserved names, deletion, rename, ownership change, and detachment of protected blocks. Content edits are permitted for org admins and logged for observability. Seed mechanism (`scripts/seedConfigAgentGuidelines.ts`) performs idempotent create-if-absent on deploy, logs divergence warnings if runtime content differs from canonical. This infrastructure is reusable for any future protected blocks.

### What does not exist

- Memory entry lifecycle management (pruning, decay, cleanup)
- Retrieval self-tuning based on actual usage signals
- Conflict resolution for contradictory beliefs
- Relevance-driven block retrieval (blocks are manually attached today)
- Confidence-tiered HITL for auto-promoted blocks
- Real-time clarification routing during agent runs
- Universal document drop zone with multi-destination filing
- Chat-based task creation (Configuration Assistant exists but subaccount-scoped task creation via chat is not wired)
- Auto-synthesised memory blocks from recurring high-quality entries
- Natural-language memory inspector
- Health digests (per-subaccount or portfolio)
- Client portal visibility toggles
- Weekly Digest playbook (only the Daily Intelligence Brief exists)
- Subaccount onboarding conversational flow
- Async Configuration Document workflow (offline doc generation and upload)
- Reusable DeliveryChannels component
- Portfolio-level rollup briefings/digests
- Memory block governance UI affordances (version history, diff vs canonical, reset-to-canonical, sandbox testing) — note: the protection layer (allowlist, route guards, seed-with-divergence-logging) is already shipped; what remains is the UI for version history, diff, and reset

## 3. Scope & Dependencies

### In scope

| ID | Item | Workstream |
|---|---|---|
| S1 | Memory entry decay scoring + pruning background job | A |
| S2 | Recency boost in RRF scoring using `lastAccessedAt` | A |
| S3 | Belief conflict resolution (supersession logic) | A |
| S4 | Self-tuning retrieval (utility-based quality adjustment) | A |
| S5 | Onboarding agent (Config Assistant subaccount-onboarding mode) | B, D |
| S6 | Relevance-driven block retrieval (kill manual auto-attach rules) | B |
| S7 | Confidence-tiered HITL (>0.85 auto / 0.6-0.85 propose / <0.6 discard) | B |
| S8 | Real-time clarification routing during agent runs | B |
| S9 | Universal document drop zone with multi-destination checkboxes | B |
| S10 | Chat-based task creation via Configuration Assistant | B |
| S11 | Auto-synthesised memory blocks from recurring entries | B |
| S12 | Self-tuning retrieval metrics (cited-vs-ignored tracking) | B |
| S13 | Natural-language memory inspector | B |
| S14 | Memory health digest (per-subaccount + portfolio rollup) | B |
| S15 | Four-tier visibility model (System / Org / Subaccount / Client Portal) | C |
| S16 | Per-client portal toggles (Hidden / Transparency / Collaborative) | C |
| S17 | Per-feature, per-client visibility gating | C |
| S18 | Rename `daily-intelligence-brief` to `intelligence-briefing` (cadence-agnostic) | D |
| S19 | New `weekly-digest` playbook | D |
| S20 | Default schedules: briefing Mon 7am, digest Fri 5pm, user-configurable | D |
| S21 | Configuration Document workflow (async doc generation + upload + parse) | D |
| S22 | Reusable DeliveryChannels component | D |
| S23 | Portfolio rollup briefings and digests for agency owners | D |
| S24 | Memory block governance affordances (version history, diff vs canonical, reset-to-canonical) — builds on existing protected blocks infrastructure | A |

### Out of scope

- Cross-subaccount memory sharing / org-wide memory pool (future)
- ML-based domain/topic classification (current keyword-based approach is adequate for now)
- Dynamic memory adjustment mid-run (briefing/beliefs injected upfront; lazy-load via `recall(query, k)` tool is a future enhancement to evaluate after this spec ships)
- Memory block sandbox / "test against this scenario" feature (evaluate after governance affordances land)
- New agents (this spec extends the Configuration Assistant; it does not create new agents)

### Dependencies

| Dependency | Required by | Status |
|---|---|---|
| Configuration Agent runtime guidelines branch merged | S5 (onboarding mode), S10 (chat-based task creation) | **Shipped** — canonical doc at `docs/agents/config-agent-guidelines.md`, seeded as protected memory block `config-agent-guidelines`, auto-attached to Configuration Agent |
| Existing memory block infrastructure (service, routes, schema, UI tab) | S6, S7, S11, S24 | Shipped |
| Existing `daily-intelligence-brief.playbook.ts` | S18 | Shipped |
| Existing Configuration Assistant (28 tools, plan-approve-execute) | S5, S10 | Shipped |
| pgvector + HNSW index on `workspace_memory_entries` | S1, S2, S4, S12 | Shipped |
| Existing `task_attachments` table and `runContextLoader` | S9 | Shipped |

### Phasing recommendation

Implementation should follow this order to minimise risk and maximise incremental value:

**Phase 1 — Foundations (no user-facing changes, de-risks everything else)**
S1 (decay/pruning), S2 (recency boost), S3 (conflict resolution), S22 (DeliveryChannels component), S15 (tier model data layer)

**Phase 2 — Core automation (user-facing, high-value)**
S6 (relevance retrieval), S7 (confidence HITL), S8 (real-time clarification), S12 (self-tuning metrics), S4 (self-tuning quality adjustment)

**Phase 3 — Playbooks & onboarding**
S18 (rename briefing), S19 (new digest), S20 (default schedules), S5 (onboarding mode), S10 (chat-based task creation), S21 (config doc workflow)

**Phase 4 — Portal & rollups**
S16 (portal toggles), S17 (per-feature gating), S23 (portfolio rollups), S14 (health digests), S9 (drop zone), S11 (auto-synthesised blocks), S13 (NL inspector)

**Phase 5 — Governance**
S24 (memory block version history, diff, reset-to-canonical)

---

## 4. Memory Scaling Fixes

These are invisible infrastructure changes. No user-facing UI. They prevent retrieval quality degradation as memory volume grows.

### 4.1 Entry Decay Scoring & Pruning (S1)

**Problem:** `workspace_memory_entries` accumulate indefinitely. The HNSW index degrades with unbounded growth, and old entries with stale facts pollute retrieval results.

**Design:**

A pg-boss background job (`memory-entry-decay`) runs nightly per subaccount:

1. **Decay pass:** For each entry, compute a decay factor based on `lastAccessedAt` and `createdAt`. Entries not accessed within `DECAY_WINDOW_DAYS` (default 90) have their `qualityScore` reduced by `DECAY_RATE` (default 0.05 per week of inactivity). Minimum floor: 0.1 (entries never auto-decay to zero — only explicit deletion removes them).

2. **Pruning pass:** Entries with `qualityScore` below `PRUNE_THRESHOLD` (default 0.15) and `lastAccessedAt` older than `PRUNE_AGE_DAYS` (default 180) are soft-deleted. A weekly summary of pruned entries is logged for audit.

3. **HNSW re-index trigger:** If more than `REINDEX_THRESHOLD` (default 500) entries were pruned in a single run, schedule a background HNSW re-index job.

**Config location:** All thresholds in `server/config/limits.ts` alongside existing memory constants.

### 4.2 Recency Boost in RRF Scoring (S2)

**Problem:** `lastAccessedAt` is tracked but unused in retrieval scoring. Old, stale entries can outrank fresh, relevant signal.

**Design:**

Modify the RRF fusion step in `workspaceMemoryService.getRelevantMemories()` to add a recency boost factor:

```
recencyBoost = max(0, 1 - (daysSinceLastAccess / RECENCY_BOOST_WINDOW))
finalScore = rrf_score * (1 + RECENCY_BOOST_WEIGHT * recencyBoost)
```

Where `RECENCY_BOOST_WINDOW` defaults to 60 days and `RECENCY_BOOST_WEIGHT` defaults to 0.15 (modest — recency informs but does not dominate). Both configurable in `limits.ts`.

### 4.3 Belief Conflict Resolution (S3)

**Problem:** Two agents can write contradictory beliefs about the same entity (e.g., different phone numbers for a client). Both persist; the consuming agent sees both and may act on the wrong one.

**Design:**

The `agent_beliefs` table already has `supersededBy` and `supersededAt` columns (scaffolded but unwired). Wire the supersession logic:

1. **On belief write:** Before inserting, query existing active beliefs for the same `subaccountId` + `entityKey` (a new indexed column, derived from the belief's subject). If a match exists with contradicting content:
   - If the new belief's `confidence` > existing by more than `CONFLICT_CONFIDENCE_GAP` (default 0.2): auto-supersede the old belief, log the action.
   - If confidence gap is <= 0.2: flag both as `conflicted`, add to the review queue (S7), and inject a real-time clarification (S8) if an agent run is in progress.

2. **On belief read:** Filter out superseded beliefs. For conflicted beliefs, present both with a note: "These contradict each other — which is current?"

### 4.4 Self-Tuning Retrieval (S4, S12)

**Problem:** Static quality scores assigned at write time do not reflect actual utility. An entry might score 0.8 on write but never be useful in practice.

**Design (two parts):**

**S12 — Utility tracking:** After each agent run, compare the memory entries that were injected into context against what the agent actually cited or used in its output (tool calls, generated text). Track a `citedCount` and `injectedCount` per entry. Compute `utilityRate = citedCount / injectedCount` over a rolling window.

**S4 — Quality adjustment:** A weekly background job adjusts `qualityScore` based on `utilityRate`:
- Entries with `utilityRate` > 0.5 get a quality boost (capped at 1.0)
- Entries with `utilityRate` < 0.1 over 10+ injections get a quality reduction
- Entries never injected are unaffected (no data, no adjustment)

This creates a feedback loop: useful memories surface more; unused memories fade. No human involvement.

---

## 5. Automation Enhancements

Ten enhancements that shift the platform from "configure and hope" to "infer continuously and ask only when uncertain." Each is designed for non-technical users with minimal human involvement.

### 5.1 Onboarding Agent — Config Assistant Subaccount-Onboarding Mode (S5)

See [Section 8](#8-subaccount-onboarding-flow) for full design. Summary: when a new subaccount is created, the Configuration Assistant enters a structured conversational flow that collects client information, generates memory blocks, connects integrations, configures the Intelligence Briefing and Weekly Digest playbooks, and sets portal mode. ~5-10 minutes of conversation replaces manual form-filling. Also supports an async path via Configuration Documents (Section 9).

### 5.2 Relevance-Driven Block Retrieval (S6)

**Today:** Memory blocks are manually attached to agents via `memory_block_attachments`. Someone must decide which blocks each agent should see.

**Target:** Every agent's retrieval pipeline scores all blocks in scope (subaccount + org) by semantic relevance to the current task context and pulls the top-K within token budget. No attachment configuration exists as the default path.

**Design:**

1. At run start, after loading the task context, call a new `memoryBlockService.getRelevantBlocks(taskContext, subaccountId, orgId, tokenBudget)`.
2. Generate an embedding for the task context (reuse the existing embedding from workspace memory retrieval if available).
3. Score each block's content embedding against the task context embedding (cosine similarity).
4. Return top-K blocks (default 5) above a similarity threshold (default 0.65, lower than memory entries because blocks are curated and generally higher quality).
5. Token budget enforcement: blocks are added in relevance order until the block token budget is exhausted.

**Manual pinning preserved as override:** Explicit attachments via `memory_block_attachments` still work and are always included (they bypass relevance scoring). This handles cases where the agency knows a block is always relevant regardless of task context. Protected blocks (e.g., `config-agent-guidelines`) are always included via their explicit attachment — the relevance engine never drops them.

**Migration:** Add an `embedding` column (vector(1536)) to `memory_blocks`. Backfill embeddings for existing blocks via a one-time migration job.

### 5.3 Confidence-Tiered HITL (S7)

**Problem:** All promoted blocks, conflicts, and uncertain decisions currently need manual review, creating queue fatigue.

**Design — three tiers based on confidence:**

| Confidence | Action | User experience |
|---|---|---|
| **High** (>0.85) | Auto-apply, log it, surface in weekly digest only | Zero friction |
| **Medium** (0.6-0.85) | Batched into weekly review queue, one-click approve/reject per item | Low friction, batched |
| **Low** (<0.6) | Discard or ask the agent to re-verify on next run | Zero friction (auto-handled) |

**Trust-builds-over-time mechanism:** Track approval rate per agent per domain. After N consecutive auto-applies are retrospectively validated (not overridden within 30 days), raise that agent's auto-threshold by 0.05. Cap at 0.95. This means the review queue shrinks every week as the system earns trust.

**Queue location:** Lives at subaccount level. Agency staff see their assigned subaccounts' queues. An org-level rollup view shows counts + flagged items across all subaccounts (not individual items — prevents flooding).

### 5.4 Real-Time Clarification Routing (S8)

**Problem:** When an agent finds a contradiction or ambiguity during a run, it has no way to ask a human in real-time. The issue either gets silently resolved (risking a wrong answer) or blocks the run.

**Design:**

1. Agents can call a `request_clarification` tool during a run. Parameters: question text, context snippet, urgency (blocking / non-blocking), suggested answers (optional).

2. **Routing logic:**
   - Default route: subaccount manager (the agency staffer assigned to this client).
   - If subaccount manager is offline and urgency is blocking: escalate to agency owner.
   - If client portal mode is Collaborative and the question is client-domain (brand, product, audience): route to the client contact via portal notification.
   - Routing rules are configurable per subaccount.

3. **Delivery:** Real-time notification via WebSocket (existing `useSocket` infrastructure) + email fallback if no WebSocket session is active. The notification includes the question, context, and one-tap answer buttons (for suggested answers) or a free-text reply field.

4. **Timeout:** If no response within `CLARIFICATION_TIMEOUT` (default 30 minutes for non-blocking, 5 minutes for blocking), the agent falls back to its best-guess answer with a flag: "Answered without confirmation — please review."

5. **Non-blocking clarifications** do not pause the run. The agent continues with its best guess and the answer is reconciled on the next run if it arrives later.

### 5.5 Universal Document Drop Zone (S9)

**Problem:** Uploading a document to the right place requires navigating to the correct task/block/subaccount. Non-technical users get lost.

**Design:**

1. **Single upload surface** per subaccount — a drag-and-drop inbox accessible from the subaccount dashboard and (if portal mode allows) the client portal.

2. **On upload:** The system reads the document (text extraction for PDF/DOCX/images via OCR), generates a summary, and proposes 1-N destinations with confidence scores and pre-ticked checkboxes:
   - Specific task attachment(s) — e.g., "Attach to Weekly Newsletter task?"
   - Memory block content — e.g., "Add to Brand Voice block?"
   - Subaccount reference document — e.g., "Store as general reference?"
   - Agency-wide reference — e.g., "This looks like it applies across clients — make it org-level?"

3. **Multi-select with user control:** All high-confidence destinations (>0.8) are pre-ticked. Medium-confidence destinations (0.5-0.8) are shown but unticked. Low-confidence destinations are hidden behind "Show more." User can also add custom destinations the system did not suggest.

4. **One-click confirm:** User reviews the checkboxes, adjusts if needed, confirms. System files the document to all selected destinations in one transaction.

5. **Client portal exposure:** If portal mode is Collaborative, the client sees the drop zone and can upload. Routing proposals are shown to the agency staffer for approval (the client does not self-file — the agency approves the filing).

---

### 5.6 Chat-Based Task Creation via Configuration Assistant (S10)

**Problem:** Creating a new task requires navigating forms (agent picker, RRULE schedule, instructions, KPIs). Non-technical users struggle with RRULE syntax and agent assignment.

**Design:**

Extend the Configuration Assistant with a `task-creation` mode. User describes intent in plain English: *"I want to send a weekly newsletter recap to each client every Monday morning."*

The agent:
1. Parses intent into structured task config: agent assignment, RRULE schedule, instructions, success criteria, default attachments.
2. Presents the proposed config as a review card.
3. Asks the DeliveryChannels question (Section 10) for task outputs.
4. On approval, creates the scheduled task via existing `config_create_scheduled_task` tool.

No new infrastructure — this uses the existing Configuration Assistant toolset and the existing scheduled task creation path. The enhancement is a guided system prompt that translates natural language → structured task config.

### 5.7 Auto-Synthesised Memory Blocks (S11)

**Problem:** Valuable insights accumulate as individual memory entries but never get promoted to durable, curated memory blocks unless a human manually does it.

**Design:**

A weekly background job (`memory-block-synthesis`) per subaccount:

1. Scans high-quality memory entries (`qualityScore` > 0.7, `citedCount` > 2) that are not already associated with a block.
2. Clusters entries by topic using embedding similarity (agglomerative clustering, threshold 0.82).
3. For clusters with 5+ entries: generates a candidate block via LLM summarisation.
4. Scores candidate confidence based on cluster coherence, entry quality, and citation frequency.
5. Applies confidence-tiered HITL (S7): high-confidence candidates auto-create as draft blocks; medium go to the review queue; low are discarded.

Draft blocks are flagged `source: 'auto_synthesised'` and are not auto-attached to agents until reviewed or until they survive 2 weekly cycles without being rejected.

### 5.8 Self-Tuning Retrieval Metrics (S12)

Covered in Section 4.4. Summary: track `citedCount` and `injectedCount` per memory entry per run, compute `utilityRate`, use it to adjust `qualityScore` over time. Creates a feedback loop that requires zero human involvement.

### 5.9 Natural-Language Memory Inspector (S13)

**Problem:** Debugging "why did the agent do X?" requires navigating database tables, understanding embeddings, and reading raw run logs. Non-technical support staff and agency operators cannot do this.

**Design:**

A chat interface (accessible per-subaccount) where the user asks questions like: *"Why did the agent send that email?"* or *"What does the system know about this client's refund policy?"*

The inspector agent:
1. Parses the question and identifies the relevant scope (specific run, specific agent, general memory).
2. If run-specific: retrieves the run's injected context, the retrieved memories, the reasoning chain, and the actions taken. Walks through the chain and explains in plain English.
3. If memory-specific: runs a semantic search over the subaccount's memory entries, beliefs, and blocks. Presents what the system "knows" with provenance (which run wrote it, when, confidence).
4. Presents results in a structured, readable format with citations.

**Tier exposure:**
- Agency staff: always available per subaccount.
- Client portal (Transparency or Collaborative mode): available as a "Ask about your agent" chat box. The inspector's responses are filtered to exclude internal operational details (task configurations, agent instructions) and only show memory-derived facts and actions taken.

### 5.10 Memory Health Digest (S14)

See [Section 11](#11-portfolio-rollup-briefings--digests) for the portfolio rollup design. Per-subaccount digest is a weekly summary:

- New memories captured (count + top 3 by quality)
- Conflicts auto-resolved (count + summary of most significant)
- Entries pruned (count)
- Beliefs updated (count + any flagged as uncertain)
- Block proposals pending review (count, link to queue)
- Memory coverage gaps ("No memories about [topic] despite 3 recent tasks in that area")

Delivered via the DeliveryChannels component (Section 10). Default: inbox only. Agency can enable email delivery.

---

## 6. Tier Model & Client Portal Toggles

### 6.1 The Four-Tier Visibility Model (S15)

Every feature in this spec fires at one or more tiers. This model formalises where each surface lives and who sees it.

| Tier | Who | What they manage |
|---|---|---|
| **System** | Platform engineering | Self-tuning plumbing — invisible to all users. Threshold tuning, embedding model, background job schedules. |
| **Organisation** | Agency staff (agency admins + managers) | Cross-client view: agency-wide memory blocks, templates, portfolio rollups, HITL queue rollup, Configuration Assistant org-admin mode. |
| **Subaccount** | Agency staff acting for one client | Day-to-day: that client's agents, tasks, runs, deliverables, memory inspector, HITL queue, drop zone, Configuration Assistant subaccount mode. |
| **Client Portal** | The client themselves (opt-in, agency-controlled) | A configurable window into the subaccount — from nothing to full collaboration. |

**Data layer:** Add a `visibility_tier` enum column to relevant tables (or a `tier_config` JSONB column on features that need per-client gating). Each UI surface declares which tiers it can render in. Visibility at each tier is gated by (a) the surface's declared support and (b) the per-client portal toggle.

### 6.2 Per-Client Portal Toggles (S16)

Three modes per subaccount, stored as a `portalMode` column on the `subaccounts` table:

| Mode | What the client sees | Default for |
|---|---|---|
| **Hidden** | No portal — client sees nothing | All new subaccounts (default) |
| **Transparency** | Read-only: deliverables, "what your agent learned this week" digest, memory inspector ("why did my agent do X?"), run status | Hands-off retainer clients |
| **Collaborative** | All of Transparency + drop zone (uploads filed by agency approval), clarification questions routed to client, task requests | Engaged clients who want to participate |

**Setting portal mode:** Configured during subaccount onboarding (Section 8, step 8) or updated anytime via Configuration Assistant or subaccount settings page.

### 6.3 Per-Feature, Per-Client Visibility Gating (S17)

Within Collaborative mode, not every client should see every surface. Add a `portalFeatures` JSONB column on `subaccounts` with feature-level toggles:

```json
{
  "dropZone": true,
  "clarificationRouting": true,
  "taskRequests": false,
  "memoryInspector": true,
  "healthDigest": true
}
```

Defaults: all features ON when portal mode is Collaborative. Agency can turn individual features off per client. When portal mode is Hidden or Transparency, all Collaborative-only features are automatically off regardless of the JSONB values.

**UI pattern:** A simple toggle grid on the subaccount settings page. Each row is a feature; each has an on/off switch. Only shown when portal mode is Collaborative.

**Inheritance:** Every new UI surface built in the future must declare its minimum portal mode (Hidden / Transparency / Collaborative) and register in the `portalFeatures` schema. This ensures future features inherit the gating model automatically.

---

## 7. Weekly Briefing & Digest Playbooks

### 7.1 Rename Intelligence Briefing (S18)

**Current state:** `server/playbooks/daily-intelligence-brief.playbook.ts` — schedule-configurable, `autoStartOnOnboarding: true`, steps: research → draft → publish to portal → email digest.

**Change:** Rename to `intelligence-briefing.playbook.ts`. Update all references (imports, seed data, UI labels). The playbook remains cadence-agnostic — the RRULE schedule is set during configuration, not hardcoded. Internal name: `intelligence-briefing`. User-facing label: "Intelligence Briefing."

**Default schedule when autostarted:** `RRULE:FREQ=WEEKLY;BYDAY=MO` at 07:00 in the subaccount's configured timezone. Configurable during onboarding (Section 8) and anytime via Configuration Assistant.

### 7.2 New Weekly Digest Playbook (S19)

**Purpose:** Backward-looking summary of the week's activity for a subaccount. Complements the forward-looking Intelligence Briefing.

**Content sections:**

1. **Work completed** — tasks run, deliverables produced, actions taken (aggregated from run logs)
2. **What the system learned** — new memory entries, beliefs updated, blocks created/modified (aggregated from memory write events)
3. **KPI movement** — key metrics tracked for this subaccount, week-over-week change
4. **Items pending** — blocked clarifications, review queue items, failed tasks awaiting retry
5. **Memory health summary** — conflicts resolved, entries pruned, coverage gaps (from S14 data)
6. **Next week preview** — upcoming scheduled tasks and their expected outputs

**Playbook structure (mirrors intelligence-briefing):**

| Step | Type | Description |
|---|---|---|
| 1. Gather | `skill_call` | Aggregate run logs, memory events, KPI data, pending items for the subaccount over the past 7 days |
| 2. Draft | `skill_call` | LLM generates a structured digest from the gathered data |
| 3. Deliver | `action_call` | Route via DeliveryChannels (Section 10) — default: inbox + email |

**Playbook file:** `server/playbooks/weekly-digest.playbook.ts`
**`autoStartOnOnboarding: true`**
**Internal name:** `weekly-digest`
**User-facing label:** "Weekly Digest"

### 7.3 Default Schedules & User Configuration (S20)

| Playbook | Default day | Default time | User-configurable? |
|---|---|---|---|
| Intelligence Briefing | Monday | 07:00 subaccount TZ | Yes — day and time, via onboarding or Config Assistant |
| Weekly Digest | Friday | 17:00 subaccount TZ | Yes — day and time, via onboarding or Config Assistant |

**Configuration questions (asked during onboarding):**

For each playbook:
1. "When should [playbook name] arrive? Default: [day] at [time]."
2. "Where should it be delivered?" — renders the DeliveryChannels component (Section 10).
3. "Who should receive it?" — recipient list (defaults to subaccount manager's email).

These questions are also part of each playbook's Configuration Schema (Section 9), so they appear in the async Configuration Document if the user chooses that path.

---

## 8. Subaccount Onboarding Flow

### 8.1 Trigger

Agency staff clicks "+ New Client" (or equivalent) → instead of a form, opens a chat with the Configuration Assistant in **subaccount-onboarding mode**.

Alternative entry: agency staff creates a blank subaccount first, then clicks "Set up this client" to enter onboarding mode for an existing subaccount.

### 8.2 Implementation Pattern

The Configuration Assistant gets a new `mode` parameter. In `subaccount-onboarding` mode it has:

- A different system prompt (the structured conversation arc below)
- A scoped toolset (memory block creation, playbook autostart, integration kickoff, portal config, DeliveryChannels, Configuration Document generation)
- A different completion criterion (subaccount must be in "ready" state with both playbooks configured, not just "agent answered the question")

Same plumbing as the existing Configuration Assistant org-admin mode. New mode, not new agent. The agent inherits its runtime guidelines from the platform-level memory block (`config-agent-guidelines` — shipped, canonical doc at `docs/agents/config-agent-guidelines.md`). The guidelines encode the Three C's diagnostic framework, priority order (configure existing > create new skills > create new agents), tier-edit permissions, confidence-tiered action policy, and safety gates. The onboarding mode's system prompt builds on top of these guidelines, not replaces them.

### 8.3 Two Paths — Live and Async

The user chooses their path at the start:

**Path A — Live conversation.** Config Assistant walks through the steps below, one at a time, with smart skipping of questions it can answer from context (e.g., if a website URL is provided, the agent scrapes and pre-fills brand voice, services, audience).

**Path B — Async Configuration Document.** User clicks "Generate Configuration Brief" → system renders a downloadable DOCX containing all questions from all onboarding playbooks' Configuration Schemas (Section 9). Agency sends to client, client fills out, agency uploads. System parses, maps answers, and either auto-completes or asks follow-up questions for gaps.

**Path C — Hybrid.** Agency starts live, answers what they know, hits "Generate doc for remaining questions" → system renders a partial Configuration Document with only the unanswered questions. Client fills in the rest.

### 8.4 Conversation Arc (Live Path)

| Step | Topic | What the agent does | Output |
|---|---|---|---|
| 1 | **Identity** | Asks: name, website, industry, what they do. If website provided, scrapes and pre-fills. | Subaccount overview block (draft) |
| 2 | **Audience & positioning** | Asks: target customer, problems solved, competitive differentiators. | Audience/ICP block (draft) |
| 3 | **Voice & brand** | Asks: tone, formality, examples. Offers to analyse past content if URLs provided. | Brand-voice block (draft) |
| 4 | **Integrations** | Asks: what tools they use (presents a checklist of supported integrations). Initiates OAuth flows for selected. | Connected integrations |
| 5 | **Goals & KPIs** | Asks: what success looks like, what metrics matter, what frequency they want to track. | KPI block (draft) |
| 6 | **Intelligence Briefing config** | Confirms or changes Monday 7am default. Renders DeliveryChannels component. Asks for recipients. | Scheduled task (intelligence-briefing) |
| 7 | **Weekly Digest config** | Confirms or changes Friday 5pm default. Renders DeliveryChannels component. Asks for recipients. | Scheduled task (weekly-digest) |
| 8 | **Portal mode** | Asks: "Should this client see a portal?" Explains the three modes briefly. Default: Hidden. | `portalMode` set on subaccount |
| 9 | **Review & provision** | Presents a single summary card showing all drafted blocks, scheduled tasks, integrations, and portal mode. Agency reviews and confirms. | Subaccount marked "ready"; all blocks created; both playbooks autostarted |

### 8.5 Smart Skipping

If the agent can infer an answer from context already provided (e.g., brand voice derived from scraped website, integrations detected from connected accounts), it pre-fills the answer and presents it for confirmation rather than asking the question from scratch. This reduces the ~9 steps to as few as 3-4 for agencies that provide a rich starting point.

### 8.6 Drop-Out and Resume

If the conversation is interrupted (browser closed, session timeout), state persists per-subaccount. When the user returns, the agent resumes from the last completed step. State is stored in a `onboarding_state` JSONB column on the subaccount record (or a dedicated `onboarding_sessions` table if cleaner).

### 8.7 Onboarding as a Playbook Bundle

Conceptually, the onboarding flow is a **bundle of playbooks**: memory bootstrap + intelligence briefing + weekly digest + integration setup + portal config. Each playbook declares a Configuration Schema (Section 9). The onboarding flow aggregates them.

This means:
- Adding a new playbook to the onboarding bundle requires only: (a) creating the playbook with a Configuration Schema, and (b) registering it in the onboarding bundle manifest.
- The Configuration Document for onboarding (Path B) automatically includes the new playbook's questions.
- No changes to the onboarding conversation logic — the Config Assistant reads the bundle manifest and asks the right questions.

**Bundle manifest:** A configuration file or database record listing which playbooks are included in onboarding and in what order. Default bundle: `[memory-bootstrap, intelligence-briefing, weekly-digest, integration-setup, portal-config]`. Customisable per organisation (agencies can add their own playbooks to onboarding).

---

## 9. Configuration Document Workflow

### 9.1 Concept

Every playbook declares a **Configuration Schema** — a structured declaration of the questions it needs answered before it can run. This schema is the single source of truth for both the live conversational path and the async document path.

From any Configuration Schema (or a bundle of them), the system can generate a **Configuration Document** — a downloadable file the agency can send to a client, have them fill out offline, and upload back for automated processing.

### 9.2 Configuration Schema Format

Each playbook declares its schema as a typed array of questions:

```typescript
interface ConfigQuestion {
  id: string;                          // Unique key, e.g. "briefing.schedule_day"
  section: string;                     // Grouping label, e.g. "Intelligence Briefing"
  question: string;                    // Human-readable question text
  helpText?: string;                   // Additional context / examples
  type: 'text' | 'select' | 'multiselect' | 'datetime' | 'url' | 'email' | 'boolean';
  options?: string[];                  // For select/multiselect types
  default?: string | string[];         // Default value
  required: boolean;
  validationHint?: string;             // E.g. "Must be a valid URL"
  derivableFrom?: string[];            // Hints for smart-skipping, e.g. ["website_url"]
}
```

Schemas live alongside their playbook files: e.g., `server/playbooks/intelligence-briefing.schema.ts`.

### 9.3 Document Generation

**Trigger:** User clicks "Generate Configuration Brief" from either:
- The onboarding flow (generates an aggregated doc from the onboarding bundle's schemas)
- A specific playbook's settings page (generates a doc for just that playbook)

**Output formats:**

| Format | When | Notes |
|---|---|---|
| **DOCX** (default) | Always available | Universal, editable in Word + Google Docs. Generated server-side via a templating library (e.g., `docx` npm package). |
| **Google Doc** | If Google Workspace integration is connected | Created via Google Docs API, auto-shared to a specified email address. |
| **Markdown** | On request | For technical users or internal use. |

**Document structure:**
1. Header: agency name, subaccount name, generated date.
2. Instructions: "Fill in the sections below. Leave blank if unknown — the system will follow up."
3. Sections: one per playbook in the bundle, each containing its questions with help text, defaults shown, and space for answers.
4. Footer: "Upload this completed document at [URL] or email it to [magic address]."

### 9.4 Document Upload & Processing

**Upload channels:**
- Drag-and-drop on the subaccount's onboarding page (or the document drop zone from S9).
- Email to a per-subaccount magic address (if email integration is connected).

**Processing pipeline:**

1. **Extract text** from uploaded file (DOCX parser, PDF OCR, or plain text).
2. **LLM parsing:** Map extracted answers back to Configuration Schema field IDs. The LLM receives the schema + the document text and returns a structured JSON of `{ fieldId: answer }` pairs.
3. **Validation:** Check each answer against its schema constraints (required, type, validation hints). Flag invalid or missing answers.
4. **Confidence scoring:** Each parsed answer gets a confidence score based on extraction clarity.
5. **Gap analysis:** Identify unanswered required questions.

**Outcome routing:**

| Scenario | Action |
|---|---|
| All required questions answered, all high confidence | Auto-apply configuration. Notify agency: "Client onboarding complete — review the summary." |
| Some questions unanswered or low confidence | Open a short follow-up conversation (live path) with only the remaining questions pre-loaded. Agency or client completes the gaps. |
| Document is unrecognisable or mostly empty | Reject with message: "Could not parse this document. Please use the generated template or contact support." |

### 9.5 Generalisation Beyond Onboarding

This workflow applies to **any playbook**, not just onboarding. Any playbook with a Configuration Schema can generate a Configuration Document. Use cases:

- Agency wants to set up a new campaign playbook for a client — sends the config doc, client fills in campaign brief, uploads, playbook auto-configures.
- Agency onboards 10 clients at once — generates 10 config docs from the same onboarding bundle, sends in bulk, processes uploads as they come back.
- Internal use — agency staff fills out their own config docs for clients they manage, as a structured way to capture information before entering it live.

---

## 10. Reusable DeliveryChannels Component

### 10.1 Purpose

A single, reusable UI component used anywhere the system asks "where should this be delivered?" Built once, used by briefings, digests, health summaries, task outputs, alerts, and future features.

### 10.2 Behaviour

**Inbox is implicit and always-on.** Every generated artefact lands in the relevant subaccount inbox regardless of channel selection. Inbox is not a checkbox — it is a system guarantee. The component controls additional delivery channels only.

**Channel list (multi-select checkboxes):**

| Channel | Shown when | Default state |
|---|---|---|
| Email | Always | ON (pre-ticked) |
| Client Portal | Portal mode is Transparency or Collaborative | ON |
| Slack | Slack integration connected for this org/subaccount | OFF |
| Discord | Discord integration connected | OFF |
| SMS | SMS integration connected | OFF |
| Microsoft Teams | Teams integration connected | OFF |
| Webhook | Custom webhook configured | OFF |

Channels that are not connected do not appear (no greyed-out placeholders — clean list). If only Email is available, the component still renders (for recipient configuration) but feels minimal.

**Per-channel configuration:**
- **Email:** recipient list (multiple addresses), with a "+" button to add. Default: subaccount manager's email.
- **Client Portal:** no additional config (delivery is automatic if portal mode allows).
- **Slack/Discord/Teams:** channel picker (dropdown of available channels from the connected workspace).
- **SMS:** phone number list.
- **Webhook:** URL (pre-configured in integration settings, not editable here).

### 10.3 Data Model

Store delivery preferences as a `deliveryChannels` JSONB column on the entity being configured (e.g., `scheduled_tasks`, `playbook_runs`, or a future `notification_preferences` table):

```json
{
  "email": { "enabled": true, "recipients": ["alice@agency.com", "bob@agency.com"] },
  "portal": { "enabled": true },
  "slack": { "enabled": true, "channelId": "C04XXXXXX" },
  "sms": { "enabled": false }
}
```

### 10.4 Component API (Client)

```tsx
<DeliveryChannels
  subaccountId={subaccountId}
  value={deliveryConfig}
  onChange={setDeliveryConfig}
  context="briefing"  // optional — used for smart defaults
/>
```

The component queries connected integrations for the subaccount/org to determine which channels to show. No prop-drilling of integration state — the component is self-contained.

### 10.5 Server-Side Delivery Service

A `deliveryService.deliver(artefact, deliveryConfig, subaccountId)` function that:
1. Always writes to inbox (system guarantee).
2. Iterates enabled channels and dispatches via the appropriate integration service.
3. Logs delivery attempts and outcomes per channel.
4. Retries failed deliveries (email: 3 retries with backoff; Slack/Teams: 2 retries; SMS: 1 retry).

This service is called by every playbook's "Deliver" step, by the health digest job, and by any future feature that produces deliverables.

---

## 11. Portfolio Rollup Briefings & Digests

### 11.1 Problem

Agency owners with 50-180+ subaccounts cannot read individual briefings and digests for every client. A naïve implementation floods their inbox with hundreds of items per week.

### 11.2 Design — Two Agency-Level Artefacts

| Artefact | Cadence | Fires after | Content |
|---|---|---|---|
| **Portfolio Briefing** | Monday (configurable) | Individual intelligence briefings have completed | Cross-client forward-looking summary |
| **Portfolio Digest** | Friday (configurable) | Individual weekly digests have completed | Cross-client backward-looking summary |

**Two inbox items per week, not N * 2.** Agency owner sees the forest; subaccount managers see the trees.

### 11.3 Portfolio Briefing Content

1. **Portfolio health overview:** X clients healthy, Y at risk, Z need attention. Traffic-light indicators.
2. **Top themes this week:** Aggregated from individual briefings — common priorities, recurring patterns.
3. **Decisions awaiting you:** Items escalated from subaccount-level queues that need agency-owner input.
4. **Client spotlight:** 2-3 clients highlighted for exceptional performance or concern.
5. **Drill-through:** Each client name is a link that opens that client's full individual briefing.

### 11.4 Portfolio Digest Content

1. **Week in numbers:** Total deliverables shipped, total runs completed, total memories captured across all clients.
2. **Highlights and lowlights:** Best-performing client this week, most-improved, client with most issues.
3. **Memory system health:** Conflicts resolved, entries pruned, blocks synthesised, coverage gaps — aggregated across portfolio.
4. **Review queue summary:** N items pending across all clients, N auto-resolved, N rejected.
5. **Drill-through:** Same as Portfolio Briefing — client names link to individual digests.

### 11.5 Auto-Enable Threshold

Portfolio rollups are available to all organisations. Auto-enabled (opt-out) when subaccount count >= 3. For organisations with 1-2 subaccounts, available but opt-in. Configurable in org settings.

### 11.6 Delivery

Uses the DeliveryChannels component (Section 10). Default: inbox + email to the agency owner. Configurable — agency owner can add other recipients (e.g., operations manager, account leads).

### 11.7 Implementation

A scheduled job (`portfolio-rollup`) runs after the last individual briefing/digest has completed for the week (or at a fixed time, e.g., Monday 8am / Friday 6pm — 1 hour after individual defaults to allow completion).

The job:
1. Queries all subaccounts for the org.
2. Fetches completed briefings/digests for each.
3. LLM generates the rollup summary from the individual artefacts.
4. Delivers via DeliveryChannels.

---

## 12. Success Criteria

### Functional

| ID | Criterion | Verifiable by |
|---|---|---|
| F1 | New subaccount can be fully onboarded via live conversation in under 10 minutes | Timed test with realistic inputs |
| F2 | New subaccount can be fully onboarded via async Configuration Document round-trip | Upload a completed doc, verify all config is applied |
| F3 | Intelligence Briefing lands in inbox at configured time (default Mon 7am) | Scheduled task + delivery log |
| F4 | Weekly Digest lands in inbox at configured time (default Fri 5pm) | Scheduled task + delivery log |
| F5 | Portfolio Briefing and Digest each produce exactly one inbox item for the agency owner | Run with 10+ subaccounts, verify 2 items not 20+ |
| F6 | Document drop zone proposes multi-destination checkboxes with confidence scores | Upload a test doc, verify proposals render |
| F7 | Real-time clarification reaches the correct recipient within 30 seconds | Trigger a clarification, verify WebSocket delivery |
| F8 | Confidence-tiered HITL auto-applies high-confidence items and queues medium | Generate test items at various confidence levels, verify routing |
| F9 | Memory entries decay over time and pruned entries no longer appear in retrieval | Seed entries with old timestamps, run decay job, query retrieval |
| F10 | Self-tuning retrieval adjusts quality scores based on citation data | Run 10+ agent runs, verify quality scores change |
| F11 | Client portal respects mode toggles (Hidden shows nothing, Transparency is read-only, Collaborative allows interaction) | Test each mode with a client-role user |
| F12 | DeliveryChannels component renders conditionally based on connected integrations | Connect/disconnect Slack, verify channel appears/disappears |

### Non-Functional

| ID | Criterion | Target |
|---|---|---|
| NF1 | Memory decay + pruning job completes in < 60s for 10,000 entries | Load test |
| NF2 | Retrieval latency (embedding + hybrid search + rerank) < 500ms p95 | Benchmark with 50,000 entries |
| NF3 | Configuration Document generation (DOCX) < 5s | Benchmark with 20-question schema |
| NF4 | Configuration Document upload processing < 30s | Benchmark with 5-page filled doc |
| NF5 | Portfolio rollup generation < 30s for 200 subaccounts | Load test |
| NF6 | Zero human involvement required for standard weekly operation (briefing + digest + memory maintenance) | Observe a 4-week period with no manual intervention |

---

## 13. Risks & Mitigations

| Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|
| **Relevance-driven block retrieval (S6) returns wrong blocks for edge-case tasks** | Agent operates with irrelevant context, produces poor output | Medium | Manual pinning preserved as override; similarity threshold tunable; monitor retrieval quality via S12 metrics |
| **Confidence-tiered HITL auto-applies a wrong decision** | Incorrect configuration persists until noticed | Low | 30-day retrospective validation window; agency can lower auto-threshold per domain; audit log for all auto-applies |
| **Configuration Document LLM parsing misinterprets client answers** | Wrong configuration applied | Medium | Confidence scoring on each parsed field; gap analysis flags low-confidence parses for follow-up; never auto-apply below 0.7 confidence |
| **Portfolio rollup LLM hallucination** | Agency owner sees incorrect cross-client summary | Low | Rollup cites source briefings; drill-through lets owner verify against originals; structured data (counts, KPIs) pulled from DB not LLM |
| **Memory decay prunes an entry that was actually valuable** | Lost institutional knowledge | Low | Soft-delete only (recoverable for 90 days); entries with high citation count exempt from pruning; weekly digest reports pruned entries |
| **Client portal exposes sensitive operational details** | Client sees internal agency processes | Medium | Portal mode defaults to Hidden; Transparency mode explicitly filters out agent instructions, task configs, and internal notes; per-feature toggles (S17) provide granular control |
| **Onboarding conversation is too long for busy agency staff** | Abandonment, incomplete setup | Medium | Smart skipping reduces steps; hybrid path (start live, finish async); drop-out and resume; minimum viable onboarding = just Steps 1 + 6 + 7 (identity + both playbooks) |
| **DeliveryChannels component becomes a maintenance burden as integrations grow** | Every new integration requires component changes | Low | Component queries connected integrations dynamically; new integrations register in a channel registry, not in the component itself |

---

## 14. Open Questions

| # | Question | Impact | Recommended default |
|---|---|---|---|
| 1 | Should the `recall(query, k)` tool (lazy memory retrieval mid-run) be included in this spec or deferred? | Would reduce upfront memory injection and improve token budget under pressure | Defer — evaluate after this spec ships. Current upfront injection is adequate for current run complexity. |
| 2 | Should belief conflict resolution (S3) trigger a real-time clarification (S8) during an active run, or only queue for batch review? | Real-time is better UX but adds complexity to the run loop | Real-time for blocking conflicts (same entity, opposing facts); batch for non-blocking (different entity or low-impact) |
| 3 | What is the maximum number of memory blocks the relevance-driven retrieval (S6) should inject? | Too many wastes tokens; too few misses context | Default 5, configurable in limits.ts, same as memory entries |
| 4 | Should the Configuration Document workflow support Google Docs native creation in Phase 3, or defer to a later phase? | Google Docs is better UX for agencies already in Google Workspace | Include in Phase 3 if Google Workspace integration exists; otherwise defer |
| 5 | Should the portfolio rollup be a playbook (configurable, extensible) or a hardcoded background job? | Playbook is more flexible; background job is simpler to implement | Start as background job in Phase 4; migrate to playbook if agencies request customisation |
| 6 | Should the health digest (S14) be merged into the weekly digest (S19) as a section, or remain a separate artefact? | Separate is cleaner but adds another inbox item | Merge as a section within the weekly digest; offer a standalone version only if agencies request it |
| 7 | For the document drop zone (S9), should client uploads via Collaborative portal require agency approval before filing, or auto-file with notification? | Auto-file is faster; approval prevents misfiling | Require agency approval for first 5 uploads from a new client; after that, auto-file with notification (trust-builds-over-time, same pattern as S7) |
| 8 | Should the onboarding bundle manifest be stored in code (static, version-controlled) or in the database (dynamic, per-org customisable)? | Static is simpler; dynamic lets agencies customise their onboarding | Database — agencies should be able to add their own playbooks to onboarding without code changes |
