# Spec Review Plan — sandbox-isolation

- **Spec path:** `tasks/builds/sandbox-isolation/spec.md`
- **Spec commit at start of review:** `45122837` (HEAD of `claude/evolve-sandbox-isolation-brief-Q51hc`)
- **Spec-context commit:** `a49d73d0`
- **Max iterations (lifetime cap):** 5
- **Prior iterations found:** 0 (no `spec-review-checkpoint-sandbox-isolation-*` files exist)
- **Stopping heuristic note:** Two consecutive mechanical-only rounds (or zero directional/ambiguous + zero accepted) ends the loop early.
- **Codex CLI:** `/c/Users/Michael/AppData/Roaming/npm/codex` v0.118.0 — authenticated via ChatGPT.

## Framing check

- `docs/spec-context.md` `last_reviewed_at: 2026-05-10` (today is 2026-05-11) — green, fresh.
- Spec framing section (§1, §4) declares: pre-production, `commit-and-revert`, `static_gates_primary`, prefer existing primitives. Matches `docs/spec-context.md` ground truth. No HITL pause required.
- Brief explicitly forbids fallback to worker / inline; matches `docs/spec-context.md` framing on default-deny.

## Iteration plan

1. Iteration 1 — Codex review + rubric pass; apply mechanical fixes; auto-decide directional.
2. Subsequent iterations only run if changes were made and Codex/rubric still surface new findings.
