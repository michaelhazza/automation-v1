# Spec Review Plan — Iteration 3

**Spec:** `tasks/llm-observability-ledger-generalisation-spec.md`
**Spec commit at start:** untracked (HEAD `d469871`, working copy has iteration 2 edits)
**Spec-context commit:** `00a67e9`
**Iteration:** 3 of 5 (lifetime cap)
**Timestamp:** 2026-04-20T06:23:08Z

## Entry state

- Iterations 1 and 2 complete.
- Iteration 2 HITL checkpoint (`tasks/spec-review-checkpoint-llm-observability-2-20260420T060000Z.md`) has both decisions set to `apply`:
  - **C2.4 (Top calls ranking)** — rename to "Top calls by cost", keep non-billable rows.
  - **C2.7 (Mockup UI controls)** — spec minimally per recommendation (refetchInterval 60s, client-side CSV, View all as anchor scroll, decorative footer links).
- 6 mechanical findings from iteration 2 applied to working copy.
- Spec-context file unchanged from iteration 2.

## Iteration 3 plan

1. Honour iteration 2's resolved `apply` decisions by applying the concrete edits listed in the checkpoint body.
2. Update `prototypes/system-costs-page.html` to match C2.4 (rename header, keep non-billable rows in the list, reorder rows by cost descending if different).
3. Run Codex review against the updated spec.
4. Classify findings; auto-apply mechanical; pause for HITL on directional/ambiguous.
5. Stopping heuristic — two consecutive mechanical-only rounds → exit. Iteration 2 had 2 ambiguous (resolved now by HITL as `apply`). If iteration 3 produces zero new HITL findings (i.e. mechanical-only or no-findings), apply judgement on exit per the agent contract: the resolved HITL from iteration 2 plus a mechanical-only iteration 3 is sufficient evidence of convergence.

## Framing ground truth

`docs/spec-context.md` unchanged since iteration 1. Committed prototype at `prototypes/system-costs-page.html` is part of the spec surface.
