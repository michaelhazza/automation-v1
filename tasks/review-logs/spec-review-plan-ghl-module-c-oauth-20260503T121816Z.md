# Spec Review Plan — ghl-module-c-oauth

- **Spec path:** `docs/ghl-module-c-oauth-spec.md`
- **Spec commit at start:** d62e7539ec2c5001f9a5589ec229dbcc5e0427f6
- **Spec-context commit at start:** 1eb4ad72f73deb0bd79ad333b3f8caef23418392
- **Branch:** ghl-agency-oauth
- **HEAD at start:** 4ff8609182154b66a64a2d5103b836c8606ac488
- **Iteration cap (MAX_ITERATIONS):** 5
- **Lifetime iterations already used:** 0 (no prior `spec-review-*-ghl-module-c-oauth-*` files exist)
- **Stopping heuristic:** exit on (a) cap reached, (b) two consecutive mechanical-only rounds, (c) Codex + rubric produce no findings, (d) two consecutive rounds with zero acceptance.

## Context-freshness check (Step B)

- `docs/spec-context.md` last touched: 2026-04-21 (commit 1eb4ad72)
- Spec last touched: 2026-05-03 12:17 (HEAD)
- Spec is newer than spec-context → no staleness concern.
- Spec framing scan (lines 1–214): no contradictions with spec-context.
  - Pre-production assumed: spec mentions "5-agency cap" (private listing) and "no installs yet" — consistent with `live_agencies: no`.
  - Risk register includes one "ship behind a feature flag for the partner-only later" line — flagged for review (potential framing drift). Spec-context says `feature_flags: only_for_behaviour_modes` and `staged_rollout: never_for_this_codebase_yet`. Will surface as a rubric finding in iteration 1.
  - Two-stage verification (trial → design partner) is verification process, not staged rollout — not a framing conflict.

## Codex invocation

Codex CLI `codex review` only operates on diffs/commits, not arbitrary files. We use `codex exec` with the spec contents inlined and a focused review rubric prompt. Output captured to per-iteration scratch under `tasks/review-logs/_codex_iter<N>_ghl-module-c-oauth.txt`.
