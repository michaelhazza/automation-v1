# Reality Check Log: memory-tiered-consolidation

**Build slug:** memory-tiered-consolidation
**Branch:** memory-tiered-consolidation
**Timestamp (UTC):** 2026-05-18T06:10:00Z
**Spec:** `docs/superpowers/specs/2026-05-18-memory-tiered-consolidation-spec.md`
**Caller:** main session, post pr-reviewer round-2 APPROVED

**Verdict:** NEEDS_DISCUSSION (12/13 verified; criterion 11 partially fulfilled with operator-acknowledged deferral; not a code defect but a goal-statement vs delivered-behaviour mismatch worth surfacing to finalisation)

Verified: 12 / Unverified: 1

## Per-criterion classification

- Criterion 1 (G1 Flag-default-OFF everywhere) — deterministic check, VERIFIED
- Criterion 2 (G2 Observability built into v1) — deterministic check, VERIFIED (with caveat in criterion 11)
- Criterion 3 (G3 Audit script + flag-flip gate) — deterministic check, VERIFIED
- Criterion 4 (Goal 1: consolidation_tier on retrieval table) — deterministic check, VERIFIED
- Criterion 5 (Goal 2: memoryDecayJob logging-only; decay at retrieval) — deterministic check, VERIFIED
- Criterion 6 (Goal 3: Batched reinforcement tracker; no per-retrieval sync writes) — deterministic check, VERIFIED
- Criterion 7 (Goal 4: Tier multipliers from config; queryIntent.ts untouched) — deterministic check, VERIFIED
- Criterion 8 (Goal 5: evaluatePromotion architecturally separate from decideTier) — deterministic check, VERIFIED
- Criterion 9 (Goal 6: Auto for working→episodic / episodic→semantic; operator-confirmed for *→procedural) — deterministic check, VERIFIED
- Criterion 10 (Goal 7: Every promotion writes durable audit row) — deterministic check, VERIFIED (per OQ-2 deviation: workspace_memory_entry_tier_transitions table replaces memory_block_versions mint)
- **Criterion 11 (Goal 8: memory.block.promoted events emit) — UNVERIFIED (partial fulfilment, deferral)**
- Criterion 12 (Goal 9: Audit script with 7 checks) — deterministic check, VERIFIED
- Criterion 13 (Goal 10: Flag flip gated on 4 consecutive weekly pass runs) — deterministic check, VERIFIED

## Criterion 11 detail — Goal 8 emit verb unmet

`memory.retrieved` carries tier fields — verified (MemoryRetrievedTopEntry extended with five nullable tier fields).

`memory.block.promoted` events emit on promotion — NOT verified:
- Event TYPE is registered in `shared/types/agentExecutionLog.ts:475-492`
- No producer in the codebase calls `tryEmitAgentEvent({ eventType: 'memory.block.promoted', ... })`
- Deferral routed to `tasks/todo.md`: AppendEventInput.runId requires a valid agent_runs.id FK that doesn't exist in background-job context, and AgentExecutionSourceService doesn't include the new producer literal
- Spec OQ-2 deviation note at spec line 220 reframes the LAEL event as "supplementary observability" and relies on Audit Check 2 reconciliation against workspace_memory_entry_tier_transitions rows

Goal 8's text still uses the verb "emit". Spec text and shipped behaviour disagree on this point. This is a goal-statement vs delivered-behaviour mismatch, NOT a code defect.

## Recommendation

Either:
1. **Amend Goal 8 wording** to align with the OQ-2 deviation note (the cleanest path — the deviation note already exists and the audit script's Check 2 reconciliation IS the canonical observability path)
2. **Add an explicit REVIEW_GAP** acknowledging the deferred runtime emission with the dependency on resolving the runId-FK + AgentExecutionSourceService union work already routed to tasks/todo.md

No code change is requested by reality-checker; this is a documentation/governance resolution belonging to the operator.

## Cross-cutting evidence

- pr-reviewer round 2 APPROVED — all 7 round-1 Blocking findings closed
- spec-conformance CONFORMANT_AFTER_FIXES — 43 PASS, 3 mechanical fixes in-session, 3 directional gaps routed to tasks/todo.md
- Two formally Accepted Implementation Deviations recorded in spec body (OQ-1 + OQ-2)
- G2 integrated-state gate PASS
- Pure-helper Vitest tests passing: 14 + 7 + 8 + 22 + 19 + 18 = 88 total

**Verdict:** NEEDS_DISCUSSION (Goal 8 text alignment)
