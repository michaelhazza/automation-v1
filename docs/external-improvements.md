# External Improvements — Competitive Intelligence Backlog

Source: digest of the 27-platform competitive intelligence report against the current Automation OS codebase.

This is a high-level prioritisation only. Each item gets a proper spec when we pick it up — do not treat the descriptions here as design.

Headline finding: ~60% of the report's recommended patterns are already partially in place (HITL, per-action review gates, three-tier agents, hierarchical budgets, encrypted per-subaccount credentials, two-tier memory, playbook checkpointing, depth-bounded handoffs). The list below focuses on sharpening the "Partial" systems and adding the few missing primitives that compound with what's already there.

---

## Tier 1 — Build Next (highest value, strong fit)

### 1. HITL rejection → automatic regression test capture
**Source:** Hamming
**Current state:** `reviewAuditRecords` already captures every decision with `rawFeedback`, `editedArgs`, and an LLM-classified `collapsedOutcome`. We have the data; we throw it away after writing a workspace memory lesson.
**Idea:** Persist every rejection/edit as a replayable regression case for that agent configuration. Add a CLI/CI runner that re-runs captured cases and reports drift.
**Why first:** Zero new infrastructure, compounds quality with usage, dev frameworks (CrewAI/LangGraph) don't ship this, and it's a clean sales story for agency operators ("the platform learns from your corrections").

### 2. Agent run checkpoint + resume parity with Playbooks
**Source:** LangGraph
**Current state:** Playbooks checkpoint cleanly (`workflowRuns.checkpoint`). Agent runs **restart from iteration 0** on crash. `agentRunSnapshots` is debug-only.
**Idea:** Promote snapshots to real checkpoints written between tool calls. On restart, rehydrate instead of replanning. Copy LangGraph's "one side-effect node" rule to avoid double execution on resume.
**Why:** Biggest reliability gap found. Required before we can credibly claim long-running autonomous sessions.

### 3. Three-layer fail-closed data isolation hardening
**Source:** Harvey
**Current state:** Application-layer scoping is consistent but there is **no defence in depth.** No Postgres RLS. No verification at the LLM context-assembly boundary that loaded documents belong to the right subaccount.
**Idea:** Three layers — Postgres RLS on the highest-blast-radius tables, a `context.assertScope()` guard at memory/document retrieval, and a pre-write hook on tool inputs. Fail closed everywhere.
**Why:** Trust foundation for agencies running competing clients in one org. We are currently one missed `where` clause from a P0 incident.

### 4. Confidence scoring + decision-time guidance
**Source:** Devin + Replit
**Current state:** Missing entirely. The `report_bug` skill takes a `confidence` field but it's metadata only.
**Idea (two slices):**
- LLM emits `confidence` alongside every tool call. `low` confidence auto-upgrades the HITL gate level for that single call.
- `policyEngineService.getDecisionTimeGuidance(context)` injects situational instructions at the action proposal moment instead of front-loading every rule into the master prompt.
**Why:** Both ride on systems we already have (HITL gating, policy engine) and meaningfully change reliability for long sessions.

### 5. Multi-execution-mode toggle for Playbooks
**Source:** MindPal
**Current state:** Agent runs have `executionMode` (api/headless/iee_browser/iee_dev). Playbooks have no equivalent — always deterministic step-by-step.
**Idea:** A `playbookRuns.runMode: 'auto' | 'supervised' | 'background' | 'bulk'` column. The engine reads it per tick. `supervised` synthesises an approval gate before every step; `bulk` fans out N runs in parallel against the same template version.
**Why:** Single property unlocks four product modes. Hits a direct competitor (MindPal targets our agencies). Purely additive.

---

## Tier 2 — Build After (good value, moderate effort)

### 6. Topics → Instructions → Deterministic Action Filter
**Source:** Agentforce
**Current state:** `subaccountAgents.allowedSkillSlugs` per-link allowlist exists. Missing the **Topics** layer (intent classification narrows the candidate set BEFORE the LLM reasons) and the centralised hard-removal middleware.
**Idea:** Tag skills with `topics: string[]`. A small intent classifier picks 1–2 topics; the executor filters `availableTools` to topics ∩ allowlist. Hard removal, not prompt instruction.
**Why:** Reduces hallucinated tool calls and gives agencies a clean way to expose client allowlists by topic instead of by individual skill.

### 7. Letta-style shared memory blocks
**Source:** Letta
**Current state:** Workspace memory is per-subaccount, org memory is per-org — close but not the same primitive. We don't have "named blocks attached to N agents with read/write ownership."
**Idea:** `memoryBlocks` table + `memoryBlockAttachments` join. Org policies, brand voice, and client context become read-only blocks attached to every agent in a subaccount. Per-agent persona stays private.
**Why:** Solves "all agents in this subaccount share the same brand voice" without copy-pasting `additionalPrompt`.

### 8. Typed action I/O with per-action error directives
**Source:** Make / Sema4.ai
**Current state:** `ActionDefinition.parameterSchema` is JSON Schema, not Zod. `retryPolicy` is binary (retry/no-retry). No skip/fallback/break directives.
**Idea:** Convert action parameter schemas to Zod (already used everywhere else). Extend `retryPolicy` with `onFailure: 'retry' | 'skip' | 'fail_run' | 'fallback'` and a `fallbackValue?`. Wire skip/fallback into the executor; reuse pg-boss DLQ for break-like behaviour.
**Why:** Make is the de facto baseline for agency operators — they expect this granularity.

### 9. Plan-then-execute with intermediate inspection
**Source:** Perplexity
**Current state:** Playbooks already do this for structured workflows. Single-shot agent runs do not.
**Idea:** A `'planning'` phase in `agentExecutionService.ts` for runs above a complexity threshold. Persist the plan to `agentRuns.planJson`, emit a WebSocket event, optionally gate execution behind plan approval when `runMode='supervised'`.
**Why:** Massive observability and trust win for orchestrator runs. Reuses the `phase` field already computed in the loop.

---

## Tier 3 — Nice to Have (lower priority)

### 10. ElevenLabs-style tool execution timing modes
**Source:** ElevenLabs
**Idea:** Per-skill `executionTiming: 'immediate' | 'post_message' | 'async'`.
**When:** Build alongside voice integration. Limited value until then.

### 11. Forced-delegation orchestrator constraint
**Source:** Factory
**Idea:** Make orchestrator agents structurally unable to execute work directly — only delegate.
**Recommendation:** **Skip.** The optionality is more valuable for agencies where some tasks shouldn't fan out. Document the pattern, let operators choose.

### 12. Workforce Canvas visual DAG
**Source:** Relevance AI
**Idea:** Visual drag-and-drop alternative to Playbook Studio's chat-driven authoring.
**When:** Defer until users explicitly ask. Chat-driven authoring is hot and we already have it.

---

## Don't Build

| Recommendation | Source | Why skip |
|---|---|---|
| Copy-on-write DB checkpoints for agent runs | Replit | Massive infra cost; only valuable for code-gen agents. |
| Natural language IDE for agent authoring | Wordware | The company itself pivoted away. Strong negative signal. |
| Pre-execution plan review UX | Bardeen | Already covered by Tier 2 #9. |
| Knowledge Base verification UI | Cassidy | Marginal value vs Tier 1 #3. |
| Connector Press-style SDK | Tray.io | We already have a working skill system. SDK formalisation is premature. |
| Embedded white-label iPaaS | Tray.io | Out of scope — we're an agent platform, not an iPaaS. |
| Column-level AI Field agents | Airtable | Doesn't map to our task/agent/playbook data model. |
| Memory configuration UI | Lyzr | We already have richer memory than Lyzr exposes. |

---

## Suggested Sequencing (one possible order)

1. Tier 1 #5 — Playbook execution-mode toggle (fastest operator-visible win)
2. Tier 1 #1 — HITL → regression cases (compounds with everything else)
3. Tier 1 #3 — Fail-closed isolation, three layers (trust foundation; architect first)
4. Tier 1 #4 — Confidence + decision-time guidance (small but high impact)
5. Tier 1 #2 — Agent run checkpointing (biggest reliability gap; architect first)
6. Tier 2 in any order, driven by user feedback.

**Sequencing note:** Tier 1 #3 (isolation) and Tier 1 #2 (checkpointing) both touch `agentExecutionService.ts` deeply. Finish #3 first so #2 checkpoints into RLS-hardened tables rather than retrofitting afterwards.

---

## Coverage Map — what already exists vs the report

| Report area | Status | Notes |
|---|---|---|
| HITL / Review Gates | Have it | Per-action gating via `hitlService.awaitDecision()`. Gap: no confidence-driven escalation. |
| Action / Skill Registry | Partial | JSON Schema (not Zod), binary retry policy, allowlist at agent level only. |
| Multi-tenant Isolation | Partial | Application-level only. No RLS, no context-assembly verification. |
| Checkpoint / Resume | Partial | Playbooks yes, agent runs no. |
| Memory Tiers | Have it | Workspace + org memory, quality scoring, vector search. Gap: no shared-block primitive. |
| Confidence Scoring | Missing | No gate; `report_bug` confidence is metadata only. |
| Execution Mode Toggle | Partial | Agent modes exist, Playbooks have none. |
| Regression Test Capture | Missing | Rejections audited but never converted to tests. |
| Per-tenant Credential Isolation | Have it | AES-256-GCM, per-subaccount precedence, Activepieces refresh pattern. |
| Cost Circuit Breakers | Have it | 8-tier hierarchy, soft reservations, per-run/daily/monthly. |
| Sub-Agent Handoff | Have it | `MAX_HANDOFF_DEPTH=5`, parallel spawn, token budget per child. Gap: orchestrator not forced to delegate (intentional). |
