# Spec Review Plan

- Spec path: `tasks/builds/feat-split-usagepage/spec.md`
- Spec commit at start: uncommitted (working tree)
- Spec-context commit: 645a2462e90a722a170ab5bed9718ddab17d6f15
- Spec-context staleness: GREEN (3 days; warn at 60, block at 120)
- Iteration cap (MAX_ITERATIONS): 5
- Stopping heuristic: two consecutive mechanical-only rounds → stop before cap

## Pre-loop context check

- spec-context.md staleness: green
- Framing cross-check: no contradictions found
  - Spec is frontend-only refactor
  - Testing plan adds ONE Vitest file for 7 pure helpers — consistent with `runtime_tests: pure_function_only` (pure helpers ARE allowed; `frontend_tests: none_for_now` rejects UI tests, which the spec deliberately avoids)
  - No feature flags, no staged rollout, no new abstractions invented
  - Caller-supplied framing notes confirm: pure refactor; preserve behaviour; `formatMoney.ts` consolidation deliberately deferred (§11)

## Spec at a glance (for the agent's own use)

- 385 LOC spec, 14 sections
- Spec frontmatter (Status / Spec date / etc.) present per Checklist Section 11
- Spec opens with a Goals / Non-goals / Existing primitives / Current vs Target / Component tree / Data-fetch / Prop contracts / Helper extraction / Migration plan / Deferred / Self-consistency / Acceptance / Open questions structure
- Author explicitly notes Sections 0, 4, 5, 10 of the spec-authoring checklist are N/A (frontend-only refactor)
