# Spec Review Plan — wave-4-audit-absorber

- Spec path: `tasks/builds/wave-4-audit-absorber/spec.md`
- Spec commit at start: `77b70f82`
- Spec-context commit: `62497257`
- Spec-context age: 5 days (green; warn at 60, block at 120)
- MAX_ITERATIONS: 5
- Stopping heuristic: two consecutive mechanical-only rounds = stop before cap.

## Pre-loop context check

- Spec frontmatter says `pre-production` posture is implicit; framing assumptions §4 reference `docs/spec-context.md` and `static_gates_primary` posture directly. No mismatch.
- Spec scope explicitly bounded — does NOT touch CD1, DUP1-5/7-9, FE1/4/5/6, LAEL, PA-V2, Hermes, iee-browser, OSI-DEF (caller confirmed those are Sessions H/I or v2-backlog).
- Chunk 0 is a scope-verification + operator-decision sweep handled by architect; do not flag missing operator decisions as a spec gap.
- HandlerContext interface is Session H scope; SK1-3 must work without it.

No mismatches found — proceed to iteration 1.
