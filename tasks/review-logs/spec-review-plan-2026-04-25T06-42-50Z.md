# Spec Review Plan

**Spec:** `docs/superpowers/specs/2026-04-25-codebase-audit-remediation-spec.md`
**Spec commit at start:** `887ece3986bc486535eaf5f4ea4a8459b1af5d65` (2026-04-25 06:40 UTC)
**Spec-context commit:** `03cf81883b6c420567c30cfc509760020d325949` (2026-04-21 22:23 UTC)
**Branch:** `feat/codebase-audit-remediation-spec`
**Spec size:** 1,643 lines, ~128 KB

## Iteration cap

`MAX_ITERATIONS = 5` (per `.claude/agents/spec-reviewer.md`).
This is a brand-new spec — no prior `spec-review-checkpoint-*` files exist for this slug.
Lifetime iteration counter starts at 1.

## Stopping heuristic

Loop exits early on:
- Two consecutive iterations with `directional == 0 AND ambiguous == 0 AND reclassified == 0`.
- Codex output produces no findings AND rubric pass surfaces nothing.
- Two consecutive iterations with zero acceptance and only mechanical rejections.
- Iteration cap reached (N == 5).

## Pre-loop context check

- `docs/spec-context.md` exists and is current (2026-04-21).
- Spec framing section (§1) explicitly affirms `pre_production: yes`, `live_users: no`, `static_gates_primary`, `pure_function_only`, `prefer_existing_primitives_over_new_ones: yes`. No drift detected.
- No mismatches to log to `tasks/todo.md`.

## Notes

- Spec is large (1,643 lines). Codex CLI reviews accept stdin; chunking may be needed if Codex truncates.
- Spec is tightly framed — author explicitly cites `docs/spec-context.md`, `docs/spec-authoring-checklist.md`, and the audit findings backlog. Mechanical findings expected to dominate; directional findings should be rare given the strong framing.
- Audit findings backlog (`tasks/todo.md § Deferred from codebase audit — 2026-04-25`) is the sister artifact — cross-reference if Codex flags missing items.
