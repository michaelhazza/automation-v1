# Spec Review HITL Checkpoint — Iteration 3

**Spec:** `docs/improvements-roadmap-spec.md`
**HEAD commit at review start:** `6a8e48b33d88c1218cac7a694f746ffc8c011abd`
**Spec-context commit:** `7cc51443210f4dab6a7b407f7605a151980d2efc`
**Iteration:** 3 of 5
**Timestamp:** 2026-04-09T00:00:00Z

This checkpoint blocks the review loop. The loop will not proceed to iteration 4 until every finding below is resolved by the human. Resolve by editing this file in place, changing each `Decision:` line to `apply` / `apply-with-modification` / `reject` / `stop-loop`, then re-invoking the spec-reviewer agent.

Iteration 3 applied 5 mechanical findings in parallel with this checkpoint being written. See the "Iteration 3 Summary" section at the bottom for the list.

## Table of contents

- Finding 3.1 — P3.1 bulk mode: inline engine branching vs pg-boss-queued fan-out (directional)
- Finding 3.2 — P4.4 critique gate: sync postCall middleware vs pg-boss-queued shadow job (directional)

---

## Finding 3.1 — P3.1 bulk mode: inline engine branching vs pg-boss-queued fan-out

**Classification:** directional
**Signal matched:** Architecture signals — "Change the interface of X" / "This should be its own service" / "Introduce a new abstraction". The choice determines whether P3.1's bulk mode is an inline engine branch or a queued job pipeline — a cross-cutting execution-model decision.
**Source:** Codex (iteration 3 finding #4)
**Spec section:** P3.1 Design / Files to change vs Job idempotency keys table (`bulk-dispatch-child`, `bulk-dispatch-synthesis` rows)

### Codex's finding (verbatim)

> 4. **P3.1 vs Job idempotency keys** — The cross-cutting job table declares `bulk-dispatch-child` and `bulk-dispatch-synthesis` pg-boss jobs, but P3.1's design/files table only specifies inline engine branching and never declares the job processors, `jobConfig` entries, or enqueue call sites. Suggested fix: either formalize bulk mode as queued jobs and add the concrete files, or remove those job rows and keep P3.1 fully inline. Severity: High.

### Tentative recommendation (non-authoritative)

Two coherent options:

**Option A — keep bulk mode fully inline, delete the job rows.** P3.1 says "`playbookEngineService.ts` branches per tick on all four modes". The `bulk` branch special-cases iteration 0 to fan out children against `contextJson.bulkTargets` inside the engine tick. No new pg-boss jobs — the engine's existing tick loop is the scheduling primitive. Delete the `bulk-dispatch-child` and `bulk-dispatch-synthesis` rows from the Job idempotency keys table. Safer: leverages the existing `playbookEngineService` primitive (framing assumption 3) instead of introducing a new queued pipeline.

**Option B — formalise bulk mode as queued jobs.** Add `server/jobs/bulkDispatchChildProcessor.ts`, `server/jobs/bulkDispatchSynthesisProcessor.ts`, `jobConfig` entries, and enqueue call sites inside the `bulk` branch of the engine to P3.1's Files to change table. Keeps the Job idempotency keys table correct. More infrastructure but survives process restarts without the engine having to re-fan-out.

### Reasoning

The choice is an execution-model call: is bulk mode a feature of the playbook engine (Option A) or a feature of the job queue (Option B)? Option A is cheaper and honours "prefer existing primitives over new abstractions". Option B is more robust to worker crashes but adds queue-wiring files. Pre-production framing (no live users, commit-and-revert) argues mildly for Option A. The human owns this call because it shapes how every subsequent bulk feature in the roadmap is built.

### Decision

```
Decision: apply-with-modification
Modification (if apply-with-modification): Option A — keep bulk mode fully inline in playbookEngineService. Delete bulk-dispatch-child and bulk-dispatch-synthesis rows from the Job idempotency keys table. No new processors, jobConfig entries, or enqueue call sites. Rationale: honours framing assumption 3 (prefer existing primitives); engine tick loop is the scheduling primitive.
Reject reason (if reject): 
```

---

## Finding 3.2 — P4.4 critique gate: sync postCall middleware vs pg-boss-queued shadow job

**Classification:** directional
**Signal matched:** Architecture signals — "Change the interface of X" / "Introduce a new abstraction". Sync vs async execution model for the critique gate is a cross-cutting decision that affects latency budget, telemetry shape, and the gate script.
**Source:** Codex (iteration 3 finding #5)
**Spec section:** P4.4 Design vs Job idempotency keys table (`critique-gate-shadow` row)

### Codex's finding (verbatim)

> 5. **P4.4 vs Job idempotency keys** — The spec's job table includes a `critique-gate-shadow` pg-boss job, but P4.4 itself defines shadow critique as a synchronous `postCall` middleware flash-model call and lists no queue/worker/config files. Suggested fix: pick one execution model and align both sections; if it stays inline, delete the job entry, and if it becomes async, add the processor/config/callsite files.

### Tentative recommendation (non-authoritative)

Two coherent options:

**Option A — keep the critique gate inline in `postCall` middleware, delete the job row.** P4.4's current prose says the gate runs as a synchronous flash-model call in the `postCall` middleware phase and writes to `llmRequests.metadataJson.critique_gate_result`. Delete the `critique-gate-shadow` row from the Job idempotency keys table. Simpler — no queue, no worker, no idempotency concern because the gate is part of the request that produced the LLM call.

**Option B — formalise the shadow critique as an async pg-boss job.** Add `server/jobs/critiqueGateShadowProcessor.ts`, `jobConfig` entry, and an enqueue call site in the `postCall` middleware. The middleware fires the job and returns immediately; the worker runs the flash-model call and writes the result. Keeps the main LLM request off the critique-gate latency budget. The `critique-gate-shadow` row in the job table stays correct and the existing `verify-job-idempotency-keys.sh` gate has something to enforce.

### Reasoning

Inline shadow is fine if the flash-model call is cheap enough to sit on the hot path (typical ~200-500ms for a flash-tier call). Async shadow is preferable if you want zero latency impact on the main loop and accept the complexity cost. This is the same shape of call as Finding 3.1 — an execution-model choice. Pre-production framing doesn't obviously push either way: inline is simpler now but async is more honest about what shadow mode wants to become later. Human owns this call.

### Decision

```
Decision: apply-with-modification
Modification (if apply-with-modification): Option A — keep the critique gate inline as a synchronous postCall middleware flash-model call writing to llmRequests.metadataJson.critique_gate_result. Delete the critique-gate-shadow row from the Job idempotency keys table. No processor, jobConfig entry, or enqueue call site. Rationale: flash-tier latency is negligible vs the main LLM call; inline keeps telemetry correlation trivial.
Reject reason (if reject): 
```

---

## How to resume the loop

After editing all `Decision:` lines above:

1. Save this file.
2. Re-invoke the spec-reviewer agent with the same spec path (`docs/improvements-roadmap-spec.md`).
3. The agent will read this checkpoint file as its first action, honour each decision (`apply`, `apply-with-modification`, `reject`, or `stop-loop`), and continue to iteration 4.

If you want to stop the loop entirely without resolving every finding, set any decision to `stop-loop` and the loop will exit immediately after honouring the findings that have been marked `apply` or `apply-with-modification`.

---

## Iteration 3 Summary

- Mechanical findings accepted:  5
- Mechanical findings rejected:  0
- Directional findings:          2 (Findings 3.1, 3.2)
- Ambiguous findings:            0
- Reclassified → directional:    0
- HITL checkpoint path:          `tasks/spec-review-checkpoint-improvements-roadmap-spec-3-20260409T000000Z.md` (this file)
- HITL status:                   pending

### Mechanical findings applied in iteration 3

1. **[P0.1 Test plan]** Fixed arithmetic: "all four test files (existing two + three new)" → "all five test files (existing two + three new)".
2. **[P0.2 Files to change]** Added `scripts/dump-tool-schemas.ts` (pre-flight diff tool for Slice A) and `scripts/gates/verify-idempotency-strategy-declared.sh` (new static gate from Slice B) to the Files to change table.
3. **[P0.1 Files to change]** Added the smoke test, fixtures directory, `loadFixtures()` helper, and `verify-pure-helper-convention.sh` gate to P0.1's Files table (previously only described in the Testing strategy appendix with no owning item).
4. **[P4.3 Files to change]** Added `server/websocket/emitters.ts` with an explicit `emitAgentRunPlan(runId, plan)` emitter, and tied the `agent:run:plan` emission to `agentExecutionService.ts` in the Files table so the emitter has a named source of truth.
5. **[P4.1 Verdict / registry count]** Clarified the stale "29 entries" count — pre-change count is 29, post-change becomes 30 once the new `ask_clarifying_question` entry lands.

### Spec file at end of iteration 3

Working tree has uncommitted edits against `docs/improvements-roadmap-spec.md`. The human should review the diff alongside this checkpoint before resolving the pending decisions. No commit is created by the spec-reviewer.
