# Automation OS — Combined Improvements Roadmap

Single source of truth for platform improvements. Combines two prior analyses into one phased plan:

- **`docs/agentic-pattern-improvements.md`** — assessment against the six patterns from *Agentic Design Patterns* (Gulli, 2025)
- **`docs/external-improvements.md`** — assessment against a 27-platform competitive intelligence report

Both identified real gaps. The two lenses are complementary: the book spec is deep on loop mechanics; the competitive spec is broad on feature/architecture gaps. This document merges them, removes overlap, and sequences the work into phases that build on each other.

This is a **high-level roadmap only**. Each item gets a proper spec when it is picked up — do not treat the descriptions here as design.

## Headline findings

1. **The codebase is further along than either source spec assumed.** Roughly 60% of the recommended patterns already have load-bearing infrastructure — middleware pipeline, action registry + policy engine, playbook DAG engine, adaptive model router, typed trace/telemetry, review audit records. Most Tier 1 work is small wrappers on existing primitives.
2. **One category of work is structurally critical and non-negotiable: multi-tenant isolation hardening.** The application-layer scoping is consistent but there is no defence in depth. This is the trust foundation for agency expansion and must land before anything that increases agent autonomy or complexity.
3. **Two source docs disagreed on where to start. This one resolves it.** The book spec wanted reflection-loop enforcement first; the competitive spec wanted Playbook run modes first. Neither is wrong individually, but both are Phase 2 work — Phase 0 and Phase 1 below are the actual prerequisites.
4. **Test infrastructure is the hidden blocker.** The repo has exactly one test file. Several items in both source specs implicitly require a working test harness before they can be verified. That's why it's Phase 0.

---

## Coverage map — what the codebase already provides

Each row below is a primitive the roadmap relies on. Knowing they exist is the single biggest determinant of effort for every item below.

| Area | Status | Location / notes |
|---|---|---|
| Agentic loop with `preCall` / `preTool` / `postTool` middleware pipeline | Have it | `server/services/agentExecutionService.ts:1137-1410` — natural home for new middleware |
| Iteration counter + `MAX_LOOP_ITERATIONS = 25` | Have it | `server/config/limits.ts`; tracked in `MiddlewareContext` |
| Schema-level tool-call validator | Have it | `validateToolCalls` at `agentExecutionService.ts:1060-1095` |
| Economy→frontier cascade on invalid tool calls | Have it | `agentExecutionService.ts:1234-1261` — retries with `routingMode: 'forced'` |
| Adaptive LLM router with capability tiers + escalation tracking | Have it | `server/services/llmRouter.ts`, `llmResolver.ts` — `wasEscalated`, `escalationReason`, `callSite` |
| Central action registry | Partial | `server/config/actionRegistry.ts` — uses custom `ParameterSchema`, not Zod; binary retry policy |
| Policy engine with per-org rules + `auto/review/block` gate | Have it | `server/services/policyEngineService.ts`, `policyRules` table |
| `actionService.proposeAction` — universal action chokepoint | Have it | Covers most gated skills; some methodology skills bypass it |
| HITL review gates + `reviewService` + `hitlService.awaitDecision` | Have it | Per-action gating already drives the review queue |
| Review audit records with rich feedback fields | Have it | `reviewAuditRecords` table — `rawFeedback`, `editedArgs`, `collapsedOutcome`, `agentOutput` |
| Playbook DAG engine with parallel step dispatch | Have it | `MAX_PARALLEL_STEPS_DEFAULT = 8`, advisory locks, watchdog |
| Playbook checkpoint / resume | Have it | `workflowRuns.checkpoint` — LangGraph-style, documented in schema |
| Agent run snapshots | Partial | `agentRunSnapshots` exists but is debug-only; **agent runs do not resume on crash** |
| Trajectory capture | Have it | `actions` table ordered by `agentRunId + createdAt` + span events |
| Structured tracing / Langfuse / `llmRequests` | Have it | `server/lib/tracing.ts` with enforced `SPAN_NAMES` and `EVENT_NAMES` registries |
| Provider fallback chain + retry primitives | Have it | `withBackoff`, `TripWire`, `runCostBreaker`, `PROVIDER_FALLBACK_CHAIN` |
| Typed failure primitive + closed `FailureReason` enum | Have it | `shared/iee/failure.ts` — single emit point |
| Per-subaccount encrypted credentials | Have it | AES-256-GCM, Activepieces refresh pattern |
| Hierarchical cost circuit breakers | Have it | 8-tier hierarchy, soft reservations, per-run/daily/monthly |
| Sub-agent handoff with depth cap | Have it | `MAX_HANDOFF_DEPTH = 5`, parallel spawn, token budget per child |
| Workspace + org memory (two-tier) | Have it | Quality scoring, vector search. **No shared memory block primitive.** |
| Per-link allowlist (`subaccountAgents.skillSlugs`) | Have it | Agent-level allowlist exists; no topic-level filtering |
| Multi-tenant isolation | **Partial — danger zone** | Application-layer only. **No Postgres RLS.** One missed `where` clause from a P0. |
| Test infrastructure | **Missing** | One test file in the whole repo: `server/lib/playbook/__tests__/playbook.test.ts` |
| Confidence-driven HITL escalation | Missing | `report_bug` has a `confidence` input field but it is metadata only |
| HITL rejection → regression test capture | Missing | Data exists in `reviewAuditRecords`; no pipeline consumes it |
| Shared memory blocks | Missing | Workspace/org memory ≠ named blocks attached to N agents |
| Semantic critique gate (not just schema) | Missing | Schema validator exists; no semantic "is this output plausibly correct" check |

---

## Phase 0 — Foundations

Prerequisites. Small, low-risk, load-bearing. Every later phase assumes these are in place.

### P0.1 — Agent test harness (Phase A only)

**Source:** `agentic-pattern-improvements.md` (Tier 2 #4 Phase A), implicit prerequisite for `external-improvements.md` Tier 1 #1.

**Why first:** The repo has one test file. Several later items (HITL→regression, checkpoint/resume verification, trajectory comparison) cannot be verified without a harness. Unblocks everything.

**Scope (high-level):**
- Vitest configuration at repo root
- LLM stub that can replay recorded provider responses from fixtures
- Fixture organisation + subaccount + agent + action definitions
- CI wiring (add `npm test` to the verification command set in `CLAUDE.md`)

**Explicit non-goals at this stage:** Trajectory comparison, LLM-as-Judge, reference trajectories — those are Phase 3.

### P0.2 — Typed action registry refactor

**Source:** `external-improvements.md` Tier 2 #8 (Make/Sema4), dovetails with `agentic-pattern-improvements.md` Tier 1 #2 (scope metadata needed a home).

**Why here:** Every Phase 1 item needs richer `ActionDefinition` metadata. Bundling the refactor into Phase 0 means Phase 1 consumers get the shape they need from day one.

**Scope (high-level):**
- Convert `ActionDefinition.parameterSchema` from the custom `ParameterSchema` type to Zod (Zod is already used throughout the repo)
- Extend `retryPolicy` beyond the current binary to `onFailure: 'retry' | 'skip' | 'fail_run' | 'fallback'` with an optional `fallbackValue`
- Add `scopeRequirements` field (Phase 1 consumes it) — e.g. `{ validateArgFieldAgainstTenant: 'sub_account_id' }`
- Add `requiresCritiqueGate` flag (Phase 4 consumes it)
- Add `topics: string[]` tags (Phase 4 consumes it)

**Note:** This is a schema-only refactor. Behaviour changes are deferred to the consuming phases.

---

## Phase 1 — Trust Foundation

**Non-negotiable before agency expansion.** Nothing in later phases increases agent autonomy until this is done.

### P1.1 — Three-layer fail-closed data isolation (Harvey pattern)

**Source:** `external-improvements.md` Tier 1 #3 (Harvey), absorbs `agentic-pattern-improvements.md` Tier 1 #2 (before-tool scope hook) as Layer 3 of the three-layer model.

**Why critical:** Current isolation is application-layer only — one missed `where` clause from a P0 cross-tenant leak. Agencies running competing clients in one org cannot be onboarded until defence-in-depth exists.

**Three layers (all required):**

- **Layer 1 — Database query layer: Postgres RLS** on highest-blast-radius tables (`tasks`, `workspaceMemories`, `actions`, `agentRuns`, `llmRequests`, `reviewItems`, `reviewAuditRecords`). Session-level `set_config('app.organisation_id', ...)` populated by middleware.
- **Layer 2 — Context-assembly layer: `context.assertScope()` guard** at every memory / document / workspace retrieval point. Fails closed if scope cannot be confirmed.
- **Layer 3 — Pre-write action layer: universal before-tool authorisation hook.** Move `actionService.proposeAction` invocation from per-skill cases in `skillExecutor.ts` into the `preTool` middleware at `agentExecutionService.ts:1283` so every skill — methodology or not — flows through it. Validate `scopeRequirements` (from P0.2) against `req.orgId`'s owned subaccounts.

**Security audit stream:** Every scope check (pass and fail) writes to a dedicated audit table — separate from the functional job log, retained for compliance.

**Architecture note:** This must land before P2.1 (agent run checkpointing). Checkpointing into unisolated tables creates tech debt that is expensive to unwind later.

### P1.2 — HITL rejection → automatic regression test capture

**Source:** `external-improvements.md` Tier 1 #1 (Hamming).

**Why here:** Depends on Phase 0 test harness. Compounds with Phase 1.1 by making the trust foundation observable over time (every rejection becomes a test case).

**Scope (high-level):**
- Persist every `reviewAuditRecords` row with `decision IN ('rejected', 'edited')` as a replayable regression case keyed by `(agentId, toolSlug, inputHash)`.
- The regression case stores: snapshot of `agentOutput` (proposed args), the human's `editedArgs` or `rawFeedback`, and the surrounding agent run state.
- CLI/CI runner (built on Phase 0 harness) re-runs captured cases against the current agent config and reports drift.
- Zero new infrastructure — the data is already in `reviewAuditRecords`, it just has no consumer today.

**Agency sales story:** "The platform learns from your corrections." This is a differentiator vs CrewAI / LangGraph / Lindy, none of which ship this.

---

## Phase 2 — Reliability Primitives

Changes to how the agentic loop fundamentally operates. Three items cluster here because they all improve the same thing — HITL efficiency and long-session reliability — and they reinforce each other.

### P2.1 — Agent run checkpoint + resume parity with Playbooks

**Source:** `external-improvements.md` Tier 1 #2 (LangGraph).

**Why here (not Phase 1):** Needs Phase 1.1 complete first — checkpoints must write into RLS-hardened tables. This is the biggest reliability gap in the codebase: Playbooks checkpoint cleanly (`workflowRuns.checkpoint`), agent runs restart from iteration 0 on crash.

**Scope (high-level):**
- Promote `agentRunSnapshots` from debug-only to first-class checkpoints, written between tool calls.
- Rehydrate on restart instead of replanning from the initial message.
- Adopt LangGraph's "one side-effect per node" rule: any tool with irreversible effects gets its own checkpoint boundary so it cannot double-execute on resume.
- Integration with existing `withBackoff` and DLQ: checkpoints are the resume point for DLQ replay, not just crash recovery.

**Required for** the credible claim of long-running autonomous sessions (200+ minute sessions referenced in the Replit pattern).

### P2.2 — Deterministic reflection loop enforcement

**Source:** `agentic-pattern-improvements.md` Tier 1 #1 (Gulli Pattern 1).

**Why here:** `review_code` already instructs "max 3 self-review iterations" in the skill methodology, but enforcement is prompt-based. Making it mechanical is small but meaningful.

**Scope (high-level):**
- New middleware in the `postTool` pipeline that watches for `write_patch` / `create_pr` attempts and the preceding `review_code` verdict.
- If verdict is `BLOCKED`, inject the critique back into the loop via existing `inject_message` middleware action.
- After `MAX_REFLECTION_ITERATIONS` (config: 3), escalate to HITL review via the existing `reviewService.createReviewItem` path.
- Iteration count persisted to `actions.metadataJson` — no schema change.
- **Not in this pass:** a separate QA system agent. The `review_code` skill is structured enough; reassess only after measurement.

### P2.3 — Confidence scoring + decision-time guidance

**Source:** `external-improvements.md` Tier 1 #4 (Devin + Replit).

**Why here:** Pairs naturally with P2.2. Where P2.2 enforces review *after* the fact, confidence scoring catches risky calls *before* they happen.

**Two slices:**
- **Confidence gate:** LLM emits a `confidence` score alongside every tool call. Low confidence automatically upgrades the HITL gate level for that single call (auto → review). Rides on the existing `policyEngineService` gate logic — no new gate machinery.
- **Decision-time guidance:** New `policyEngineService.getDecisionTimeGuidance(context)` method injects situational instructions at the action proposal moment instead of front-loading every rule into the master prompt. Scales reliably past the 3-4 rule threshold where static prompts degrade.

Both ride on systems already in place; together they meaningfully improve reliability for long sessions without requiring new data models.

---

## Phase 3 — Scale & Operational Modes

Phase 1 and 2 harden the loop. Phase 3 makes it scale and gives operators explicit control over how autonomous it is.

### P3.1 — Playbook multi-execution-mode toggle

**Source:** `external-improvements.md` Tier 1 #5 (MindPal).

**Why here:** Directly hits a competitor (MindPal targets our agencies). Single column unlocks four product modes and is purely additive.

**Scope (high-level):**
- New `playbookRuns.runMode: 'auto' | 'supervised' | 'background' | 'bulk'` column.
- Engine reads it per tick:
  - `auto` — current behaviour (deterministic step-by-step).
  - `supervised` — synthesises an approval gate before every step.
  - `background` — fully async, no websocket updates, caller notified on completion.
  - `bulk` — fans out N runs in parallel against the same template version (consumed by P3.2).
- Operator surfaces the mode as a workflow-level property at run kick-off, not per-step configuration.

### P3.2 — Portfolio Health as a bulk-mode Playbook

**Source:** `agentic-pattern-improvements.md` Tier 1 #3 (Gulli Pattern 3) — reframed to ride on P3.1.

**Why here:** Originally a standalone fan-out item; now it's the canonical consumer of the `bulk` run mode from P3.1. One feature serves both use cases.

**Scope (high-level):**
- Port Portfolio Health Agent to a system Playbook template — one step per sub-account (dispatched at run time by enumerating the org's active sub-accounts) plus a final synthesis step.
- Cap concurrency via `MAX_PARALLEL_STEPS_DEFAULT` (already 8) plus a new per-org rate cap protecting GHL's API limits.
- Use `playbookRuns.contextJson` as the named-output store.
- **Intake triage is explicitly not parallelised** — BA is already cheap; invest the effort where scaling pain is real.

### P3.3 — Structural trajectory comparison (test harness Phase B)

**Source:** `agentic-pattern-improvements.md` Tier 2 #4 Phase B.

**Why here:** Depends on P0.1 harness and on P1.2 regression capture having produced enough signal. By the time Phase 3 lands, there is real trajectory data to compare against.

**Scope (high-level):**
- `trajectoryService` reads `actions` by `agentRunId` ordered by `createdAt` and produces a typed trajectory array.
- 3–5 reference trajectories defined as JSON under `tests/trajectories/` — one per critical workflow (intake triage, dev patch cycle, QA review, portfolio sweep, reporting agent morning run).
- Match modes: `exact | in-order | any-order | single-tool`.
- Comparison runs as part of the test harness; mismatches flagged as structural regressions.
- **LLM-as-Judge is still deferred** — structural comparison captures most of the value at a fraction of the cost. Revisit only if a specific failure mode needs subjective evaluation.

---

## Phase 4 — Polish & Competitive Features

With the trust foundation, reliability, and scale pieces in place, Phase 4 adds features that differentiate on quality of authoring and depth of control. Order within this phase is flexible and should be driven by user feedback.

### P4.1 — Topics → Instructions → Deterministic Action Filter

**Source:** `external-improvements.md` Tier 2 #6 (Agentforce).

**Why here:** `subaccountAgents.skillSlugs` already provides a per-link allowlist; this adds intent-based narrowing on top. Consumes the `topics: string[]` field added to `ActionDefinition` in P0.2.

**Scope (high-level):**
- Tag skills with `topics: string[]` in the action registry.
- Small intent classifier (can be a flash-model call or a keyword rule) picks 1–2 topics for the current user message.
- Executor filters `availableTools` to `topics ∩ allowlist` before the main LLM reasons — hard removal, not prompt instruction.
- Reduces hallucinated tool calls and gives agencies a clean way to expose client allowlists by topic.

### P4.2 — Shared memory blocks (Letta pattern)

**Source:** `external-improvements.md` Tier 2 #7 (Letta).

**Why here:** Workspace and org memory are close but not the same primitive as "named blocks attached to N agents with read/write ownership." Solves the "all agents in this subaccount share the same brand voice" problem without copy-pasting `additionalPrompt`.

**Scope (high-level):**
- New `memoryBlocks` table (id, name, content, ownerAgentId, isReadOnly).
- New `memoryBlockAttachments` join table linking blocks to agents.
- Org policies, brand voice, and client context become read-only blocks attached to every agent in a subaccount.
- Per-agent persona stays private.
- Blocks merged into the system prompt at agent execution time, after `additionalPrompt`.

### P4.3 — Plan-then-execute for single-shot agent runs

**Source:** `external-improvements.md` Tier 2 #9 (Perplexity).

**Why here:** Playbooks already have this for structured workflows; single-shot agent runs do not. Reuses the `phase` field already computed in the agentic loop at `agentExecutionService.ts:1196-1208`.

**Scope (high-level):**
- A dedicated `'planning'` phase runs first for agent runs above a complexity threshold.
- Persist the plan to a new `agentRuns.planJson` column; emit a WebSocket event for the UI.
- When the parent Playbook `runMode === 'supervised'` (from P3.1), gate execution behind plan approval via the existing HITL review path.
- Dynamic replanning on execution failure — agent can revise the plan mid-run based on what it finds.

### P4.4 — Semantic Critique Gate (shadow mode)

**Source:** `agentic-pattern-improvements.md` Tier 2 #5 (Gulli Pattern 4 extension).

**Why here:** The schema-level critique gate is already working. The book's version adds a semantic pass — real value but real cost. Build in shadow mode first to gather data before committing to active gating.

**Scope (high-level):**
- New `postCall` middleware phase in the agentic loop pipeline.
- Runs a flash-tier model with a minimal rubric *only* when `phase === 'execution'` AND `response.routing.wasDowngraded` AND the action is flagged `requiresCritiqueGate: true` (flag added in P0.2).
- **Shadow mode first:** log gate decision to `llmRequests.metadataJson.critique_gate_result`, do not reroute yet.
- After 2–4 weeks of data, activate rerouting if the disagreement rate justifies the cost.

---

## Phase 5 — Deferred / Conditional

Not scheduled. Each item has an explicit trigger condition — when the condition is met, the item enters the regular roadmap.

### P5.1 — ElevenLabs-style tool execution timing modes

**Source:** `external-improvements.md` Tier 3 #10.

**Trigger to build:** Only when voice integration work begins. Per-skill `executionTiming: 'immediate' | 'post_message' | 'async'` mainly matters for conversational UX. Limited value until the platform has a voice agent story.

### P5.2 — Per-skill fallback cascade

**Source:** `agentic-pattern-improvements.md` Tier 3 #6 (Gulli Pattern 2).

**Trigger to build:** When telemetry from P3.3 trajectory comparison surfaces recurring failure modes where a *different* skill would have worked. Until then, the existing provider fallback chain, economy→frontier cascade, `withBackoff`, and `TripWire` cover the real failure modes.

**Partially addressed by P0.2** — the `onFailure: 'fallback'` directive already adds per-action fallback values. A full cross-skill cascade is the next step if justified.

### P5.3 — Workforce Canvas visual DAG

**Source:** `external-improvements.md` Tier 3 #12 (Relevance AI).

**Trigger to build:** Only if users explicitly ask. Chat-driven Playbook authoring is already working and is the more modern pattern. Visual DAG authoring is a nice-to-have, not a differentiator.

### P5.4 — Separate QA system agent for reflection loop

**Source:** reassessment point from P2.2.

**Trigger to build:** Only if measurement after P2.2 shows the self-review approach has a ceiling that a distinct critic persona would break through. The working assumption is that `review_code` is already structured enough.

### P5.5 — LLM-as-Judge for trajectory eval

**Source:** reassessment point from P3.3.

**Trigger to build:** Only if a specific failure class needs subjective evaluation that structural comparison cannot catch. Expensive to run continuously and hard to calibrate — structural trajectory comparison is the higher-leverage starting point.

---

## Don't Build

Merged rejection list from both source specs. These are explicit decisions, not oversights.

| Item | Source | Why skip |
|---|---|---|
| Copy-on-write DB checkpoints for agent runs | Replit | Massive infra cost; only valuable for code-gen agents. P2.1 checkpointing delivers the reliability without the cost. |
| Natural language IDE for agent authoring | Wordware | The company itself pivoted away. Strong negative signal. Chat-driven Playbook authoring already covers the non-technical audience. |
| Pre-execution plan review UX | Bardeen | Already covered by P4.3 (plan-then-execute). |
| Knowledge Base verification UI | Cassidy | Marginal value vs P1.1 fail-closed isolation, which is the actual trust problem. |
| Connector Press-style SDK | Tray.io | The existing skill system works. SDK formalisation is premature. |
| Embedded white-label iPaaS | Tray.io | Out of scope — we're an agent platform, not an iPaaS. |
| Column-level AI Field agents | Airtable | Doesn't map to the task / agent / playbook data model. |
| Memory configuration UI | Lyzr | Current memory system is already richer than what Lyzr exposes. |
| Forced-delegation orchestrator constraint | Factory | Optionality is more valuable for agencies where some tasks shouldn't fan out. Document the pattern, let operators choose. |
| Full typed state schema per workflow | Gulli book | Overkill. `actions.metadataJson` or a targeted `reflectionStateJson` column is sufficient. |
| Parallelising Intake triage | Gulli book | BA is already cheap. Invest the effort in Portfolio Health where the scaling pain is real (covered by P3.2). |
| Activating semantic Critique Gate without shadow data | Gulli book | Risk of doubling execution-phase LLM cost for a failure mode not yet measured. P4.4 is shadow-mode only. |

---

## Dependency graph

```
Phase 0 (Foundations)
  P0.1 Test harness ─────────────────────┐
  P0.2 Typed action registry ──────────┐ │
                                       │ │
Phase 1 (Trust Foundation)             │ │
  P1.1 Three-layer isolation ◀─────────┘ │
       (Layer 3 consumes scopeReqs)      │
  P1.2 HITL → regression capture ◀───────┤
       (needs harness to run replays)    │
                                         │
Phase 2 (Reliability)                    │
  P2.1 Agent checkpoint/resume ◀─── P1.1 │  (must checkpoint into RLS-hardened tables)
  P2.2 Reflection loop middleware        │
  P2.3 Confidence + decision-time        │
                                         │
Phase 3 (Scale & Modes)                  │
  P3.1 Playbook runMode toggle           │
  P3.2 Portfolio Health bulk playbook ◀─ P3.1
  P3.3 Trajectory comparison ◀──────────┘ (consumes harness + real run data from P1.2)

Phase 4 (Polish & Competitive)
  P4.1 Topics filter ◀──────────── P0.2 (topics field)
  P4.2 Shared memory blocks
  P4.3 Plan-then-execute ◀──────── P3.1 (uses supervised mode)
  P4.4 Shadow-mode Critique Gate ◀ P0.2 (requiresCritiqueGate flag)
```

**Critical edges:**
- **P1.1 before P2.1** — checkpointing into unisolated tables creates tech debt that is expensive to unwind later.
- **P0.2 before P1.1 Layer 3** — scope metadata is the contract between the action registry and the before-tool hook.
- **P0.1 before P1.2** — regression capture has no value without a harness to replay the captured cases.
- **P3.1 before P3.2 and P4.3** — both consume the runMode column.

---

## Sequencing notes

- **Phase 0 items can run in parallel.** P0.1 (test harness) and P0.2 (typed action registry) have no overlap.
- **Phase 1 items can run in parallel after Phase 0.** P1.1 is the larger effort; P1.2 is smaller and can be done opportunistically by a second contributor.
- **Phase 2 items land sequentially** — they all touch `agentExecutionService.ts` deeply and the middleware pipeline is easier to change one concern at a time.
- **Phase 3 P3.1 is the fastest operator-visible win in the whole roadmap** — a single column change that unlocks four product modes. Consider it the first "marketing-ready" ship.
- **Phase 4 order is flexible** — driven by user feedback once Phases 0–3 are stable.
- **Phase 5 items are not on the roadmap** until their trigger conditions are met. They are listed so they do not get rediscovered as "new" ideas later.

## Source references

- **`docs/agentic-pattern-improvements.md`** — original assessment against the six patterns from *Agentic Design Patterns* (Gulli, 2025). Superseded by this document but retained for the detailed per-pattern reasoning.
- **`docs/external-improvements.md`** — original assessment against the 27-platform competitive intelligence report. Superseded by this document but retained for the competitive landscape context and the source-attribution detail on each pattern.
- Both source docs remain canonical references for the reasoning behind individual items. This roadmap is the canonical build sequence.

## Status marker convention

When an item starts, change its heading from `### P1.1 — …` to `### P1.1 [IN PROGRESS] — …`. When it ships, change to `### P1.1 [SHIPPED] — …` with a one-line note of the commit/PR. Do not delete completed items — the history is useful context for future reassessments.
