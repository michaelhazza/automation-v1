# Spec Review Plan — llm-observability (iteration 2)

- Spec path: `tasks/llm-observability-ledger-generalisation-spec.md`
- Spec commit at start: untracked (HEAD `feac1d3`)
- Spec-context commit: `d469871`
- Iteration: 2 of 5 (MAX_ITERATIONS)
- Lifetime iterations used so far: 1 (iteration 1 clean-exit at HITL-pending)
- Stopping heuristic notes:
  - Exit on two consecutive mechanical-only rounds (iterations N and N-1 both directional==0 AND ambiguous==0 AND reclassified==0)
  - Exit on iteration cap (5)
  - Exit when HITL decision is `stop-loop`
- Scope: review the updated spec + `prototypes/system-costs-page.html` (spec surface per §11)
- Surfaces in scope:
  - Changes applied from iteration 1 HITL decisions (findings 1.1, 1.2, 1.3)
  - Any net-new findings Codex surfaces on the updated spec
  - Rubric pass on the whole document against `docs/spec-authoring-checklist.md`

Iteration 2 outcome: 6 mechanical findings applied; 2 ambiguous findings paused for HITL in `tasks/spec-review-checkpoint-llm-observability-2-20260420T060000Z.md`. Loop blocks on human decisions for C2.4 (top-calls ranking semantic) and C2.7 (UI-control implementation scope).
