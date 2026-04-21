# Spec Review Plan — Iteration 5 (final reserve)

**Spec:** `tasks/llm-observability-ledger-generalisation-spec.md`
**Spec commit at start:** `ee299de` (iter-3+4 closeout) + 7 uncommitted edits this session
**Spec-context commit:** `00a67e9`
**Iteration:** 5 of 5 (lifetime cap — HARD)
**Timestamp (start):** 2026-04-20T07:08:33Z

## Why this iteration runs

Human applied a post-iter-4 round of 6 external-feedback edits in the working tree and requested a final review pass before implementation. All 4 prior iterations cleanly exited; iter-5 is the last reserve slot per the 5-iteration lifetime cap in `CLAUDE.md`.

## Focus areas (from caller invocation)

1. Consistency §7.4 ↔ §7.5 ↔ §19.2 ↔ §19.11 ↔ §15.1 (new margin location).
2. §8.5 runtime assert whitelist semantics consistent with §9.4 static gate whitelist.
3. §11.5 overhead rule (`revenueCents === null`) propagation to §19.5.2 and cross-section consistency.
4. §17 deferred items — "future" language cross-linked where referenced.
5. File-inventory drift — `callerAssert.ts` + `pricingService.resolveMarginMultiplier` in §14.3 referenced without drift elsewhere.

## Exit criterion (hardcoded by caller)

This is the last iteration. After this iter the loop halts regardless of outcome.

- If mechanical-only: apply, clean-exit, final report.
- If directional surfaces: resolve inline (human watching) OR apply most conservative per agent contract.
- No iter-6 under any circumstances.

## Stopping-heuristic note

Not applicable — iter-5 is forced-terminate. Rubric pass + Codex pass both run; any directional findings must be adjudicated within iter-5.
