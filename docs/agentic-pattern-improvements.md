# Agentic Pattern Improvements — Prioritised Roadmap

Assessment of Automation OS against the six patterns from *Agentic Design Patterns* (Gulli, 2025). Grouped by value/effort tier. High-level only — detailed specs to follow when each item is picked up.

**Headline:** The codebase is further along than the source brief assumed. Four of the six patterns already have load-bearing infrastructure in place. The Tier 1 items below are small wrappers on existing primitives.

---

## Relevant primitives already in place

| Primitive | Location |
|---|---|
| Agentic loop with `preCall` / `preTool` / `postTool` middleware pipeline | `server/services/agentExecutionService.ts:1137-1410` |
| Iteration counter + `MAX_LOOP_ITERATIONS = 25` | `server/config/limits.ts`, `agentExecutionService.ts:1115-1138` |
| Schema-level tool-call validator | `agentExecutionService.ts:1060-1095` |
| Economy→frontier cascade on invalid tool calls | `agentExecutionService.ts:1234-1261` |
| Adaptive Intelligence Router with capability tiers + escalation tracking | `server/services/llmRouter.ts`, `llmResolver.ts` |
| `actionService.proposeAction` + `policyEngineService` (auto/review/block gate) | `server/services/policyEngineService.ts`, `server/db/schema/actions.ts` |
| `policyRules` table (per-org, per-tool, per-subaccount, priority-ordered) | `server/db/schema/policyRules.ts` |
| Provider fallback chain + retry (`withBackoff`, `TripWire`, `runCostBreaker`) | `server/lib/withBackoff.ts`, `tripwire.ts`, `runCostBreaker.ts` |
| Playbook DAG engine with parallel step dispatch (`MAX_PARALLEL_STEPS_DEFAULT = 8`) | `server/services/playbookEngineService.ts` |
| Trajectory capture via `actions` table + `agentRunSnapshots.toolCallsLog` | `server/db/schema/actions.ts`, `agentRunSnapshots.ts` |
| Structured tracing (`SPAN_NAMES`, `EVENT_NAMES`) + Langfuse + `llmRequests` | `server/lib/tracing.ts`, `server/db/schema/llmRequests.ts` |
| Typed failure primitive + closed `FailureReason` enum | `shared/iee/failure.ts`, `failureReason.ts` |
| Prompt-level self-review loop in `review_code` skill ("max 3 iterations") | `server/skills/review_code.md` |

---

## Tier 1 — Build now

High value, small lift, dependencies already present.

### 1. Deterministic Dev/QA Reflection Loop (Pattern 1)

**Why:** `review_code` already instructs the model to iterate up to 3 times with a structured `APPROVE | BLOCKED` verdict, but enforcement is vibes-based. Making it deterministic reduces review-queue pressure before agency expansion and gives the verdict a mechanical role.

**Scope:**
- New middleware in the `postTool` pipeline that watches for `write_patch` / `create_pr` attempts and the preceding `review_code` verdict.
- If verdict is `BLOCKED`, inject the critique back into the loop (reuses existing `inject_message` middleware action).
- After `MAX_REFLECTION_ITERATIONS` (config: 3), escalate to HITL review via existing `reviewService.createReviewItem`.
- Do **not** build a separate QA agent in the first pass — the `review_code` skill is already structured. Reassess after measurement.

**Rough effort:** ~1 day. Low risk.

---

### 2. Before-Tool Tenant Authorisation Hook + Security Audit (Pattern 6)

**Why:** Multi-tenant hard requirement. `actionService.proposeAction` + `policyEngineService` already implements most of the pattern; the remaining gap is (a) declarative scope metadata per tool, (b) moving the hook into the universal `preTool` middleware so every skill passes through it uniformly, (c) a dedicated security audit stream.

**Scope:**
- Add `scopeRequirements` metadata to `actionRegistry` entries (e.g. `{ validateArgFieldAgainstTenant: 'sub_account_id' }`).
- Wire scope validation into the existing `policyEngineService.evaluate()` call path.
- Move `proposeAction` invocation from per-skill cases in `skillExecutor.ts` into the `preTool` middleware at `agentExecutionService.ts:1283`.
- Extend `actionEvents` (or new `tool_call_security_events` table) to capture scope checks — pass and fail.
- GHL connector skills declare `requires_tenant_scoped_sub_account: true`.

**Rough effort:** ~1–2 days. Additive to an existing chokepoint.

---

### 3. Parallel Fan-Out for Portfolio Health (Pattern 3)

**Why:** Portfolio Health latency scales linearly with sub-account count today. The Playbook DAG engine already does parallel dispatch with pg-boss dedup, advisory locks, and a watchdog — reuse it rather than build a new fan-out mechanism. Intake triage parallelisation is skipped (low measured value).

**Scope:**
- Model Portfolio Health as a system playbook template with an `agent_call` step per sub-account plus a synthesis step.
- Sub-account enumeration at dispatch time (may require a new step type or a pre-step that writes the sub-account list into run context).
- Per-org concurrency cap (new column on `organisations` or similar) to protect GHL rate limits.
- Use existing `playbookRuns.contextJson` as the named-output store.

**Rough effort:** ~2–3 days. Medium lift due to dynamic step enumeration.

---

## Tier 2 — Build after Tier 1

Valuable, but gated on prerequisites, measurement, or higher risk.

### 4. Agent Test Harness + Structural Trajectory Comparison (Pattern 5)

**Why:** Testing phase is imminent but the repo has exactly one test file (`server/lib/playbook/__tests__/playbook.test.ts`). Trajectory *capture* already exists via `actions` + `agentRunSnapshots.toolCallsLog`; what's missing is the harness and the comparison layer.

**Split into two phases:**
- **Phase A — Harness:** vitest setup, LLM stub that replays recorded responses, fixture sub-account, CI wiring. Prerequisite for any serious testing, not just this pattern. Do it regardless of whether Phase B is prioritised.
- **Phase B — Trajectory comparison:** 3–5 reference trajectories as JSON per workflow (intake triage, dev patch cycle, QA review, portfolio sweep), `trajectoryService` to read `actions` by `agentRunId` and diff against reference, match modes (`exact | in-order | any-order | single-tool`).

**Defer:** LLM-as-Judge. Structural comparison captures most of the value; add judge model only after volume justifies the cost.

**Rough effort:** Phase A ~1 week, Phase B ~2–3 days on top.

---

### 5. Semantic Critique Gate in LLM Router (Pattern 4)

**Why:** The schema-level critique gate is already done. The book's version adds a semantic check (flash model asks *"is this output plausibly correct?"*) — real value but real cost. Build in **shadow mode first** to gather data before committing to active gating.

**Scope:**
- `postCall` middleware (new pipeline phase) that runs a flash-tier model with a minimal rubric when `phase === 'execution'` AND `response.routing.wasDowngraded` AND action is flagged `requiresCritiqueGate: true`.
- **Shadow mode first:** log gate decision to `llmRequests.metadataJson.critique_gate_result`, do not reroute.
- Activate after 2–4 weeks of data if the disagreement rate justifies it.
- Per-org gate config in a new `model_routing_config` table or extend existing policy tables.

**Rough effort:** ~2 days shadow mode, ~1 day to activate.

---

## Tier 3 — Defer or skip

Limited value today, or speculative without telemetry to justify.

### 6. Per-Skill Fallback Cascade (Pattern 2)

**Why defer:** Provider fallback chain already exists (`PROVIDER_FALLBACK_CHAIN` in `server/config/limits.ts:128`). The economy→frontier cascade handles model unreliability. `withBackoff` handles transient failures. `TripWire` handles deterministic retryables. HITL handles everything else. The book's pattern adds "primary skill → degraded alternative skill → HITL" — valuable only if there are specific failure modes where a *different skill* would work. No telemetry shows this today.

**Revisit when:** Testing phase surfaces recurring failure modes that a skill substitution would actually solve. At that point, add `fallback_skill_slug` + `fallback_error_codes` to the `skills` table and wrap in `skillExecutor`.

**Rough effort (if justified):** ~1–2 days.

---

### Items explicitly not to build

| Item | Reason |
|---|---|
| Separate QA system agent for Pattern 1 | `review_code` is already structured. Wrap it first, measure, reassess. |
| Parallelising Intake triage | BA is already cheap; invest the effort in Portfolio Health where scaling pain is real. |
| LLM-as-Judge on day one | Expensive and hard to calibrate. Structural trajectory comparison is higher-leverage. |
| Activating semantic Critique Gate without shadow data | Risk of doubling execution-phase LLM cost for a failure mode not yet measured. |
| Full typed state schema per workflow | Overkill for current needs. Stash counters / feedback arrays in `actions.metadataJson` or extend `agentRuns` with a single `reflectionStateJson` column. |

---

## Cross-cutting notes

- **State persistence:** Don't introduce a typed state schema per workflow type yet. Reuse `actions.metadataJson` or add a targeted `reflectionStateJson` column to `agentRuns` if needed.
- **Telemetry:** `llmRequests` already captures model, tier, cost, `wasEscalated`, `callSite`. Sufficient for Tier 1 and Pattern 4 shadow mode. Add a `trajectory` view joining `actions` + span events by `agentRunId` when Pattern 5 Phase B is picked up.
- **Config storage:** Extend `policyRules`, `actionRegistry`, `skills`. Do not create new config tables per pattern.
- **Wrapper location:** `server/services/middleware/` is the right home. Add a `postCall` phase for the semantic Critique Gate when built.

---

## Suggested build order

| # | Item | Tier | Dependency |
|---|---|---|---|
| 1 | Reflection loop middleware | 1 | — |
| 2 | Before-tool scope validation + audit | 1 | — |
| 3 | Test harness (Phase A only) | 2 | — (prerequisite for everything else) |
| 4 | Portfolio Health fan-out playbook | 1 | — |
| 5 | Trajectory comparison (Phase B) | 2 | #3 |
| 6 | Shadow-mode Critique Gate | 2 | #3 (to measure impact) |
| 7 | Per-skill fallback cascade | 3 | Deferred until telemetry justifies |
