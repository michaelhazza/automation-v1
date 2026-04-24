# Spec Review Plan — Iteration 4

**Spec:** `tasks/llm-observability-ledger-generalisation-spec.md`
**Spec commit at start of iteration 4:** `2b5668c` + 4 uncommitted edits from resolved iter-3 checkpoint
**Spec-context commit:** `00a67e9`
**MAX_ITERATIONS cap:** 5 (lifetime)
**Iterations used:** 3 (iter-1, iter-2, iter-3 complete)
**This iteration:** 4 of 5
**Timestamp:** 2026-04-20T06:48:36Z

## Entry state

- Iter-3 resolved HITL checkpoint (Finding 3.1) landed four edits just before this iteration:
  - §8.1 line 778 — `caller_cancel` claim narrowed; explicit reference to §17 deferral.
  - §10.5 verification step 4 — switched to timeout-only.
  - §16.3 P3 manual checklist — switched to timeout-only.
  - §17 Deferred — added entry for user-cancel wiring.
- 8 mechanical fixes from iter-3 (listed in iter-3 log) also landed: P2 gate whitelist, §11.3 envelope, §19.5a profitCents, §19.6 CallDetail enrichment, §19.5 split into 19.5.1/.2/.3, prototype KPI margin alignment, §14.2 TASK_TYPES language, §12.4 archive cutoff helper.
- 1 iter-3 finding was rejected (duplicate of iter-2 C2.6).

## Stopping-heuristic state

- Iter-2: had directional findings (resolved via HITL in iter-2 checkpoint).
- Iter-3: had 1 directional/ambiguous finding (resolved via this iter-3 checkpoint).
- Iter-4 (this iteration): if Codex + rubric surface only mechanical findings (zero directional, zero ambiguous), the loop exits — iter-3 (resolved) + iter-4 (clean) = two consecutive mechanical-only rounds.
- If iter-4 surfaces any directional/ambiguous finding, write HITL checkpoint and halt; iter-5 would be the last permitted iteration by lifetime cap.

## Framing reference

`docs/spec-context.md` — pre-production, rapid-evolution, static-gates-first testing posture, commit-and-revert rollout, no feature flags, prefer existing primitives. Prototype at `prototypes/system-costs-page.html` is part of the spec surface.

## Scope of iteration 4

Re-review the full spec. Expect Codex to focus on residual contradictions, under-specified contracts, file-inventory drift, and any remaining stale language. Cross-check:

- §8.1 vs §17 new deferred entry — consistent? (should be; both say the same thing about user-cancel wiring)
- §10.5 and §16.3 — now timeout-only; any other section that still claims user-cancel verification?
- §17 has now 9 entries — all with concrete reasons?
- §19 contracts — any stale fields after iter-3 split?
- Prototype alignment post-KPI-margin fix.
