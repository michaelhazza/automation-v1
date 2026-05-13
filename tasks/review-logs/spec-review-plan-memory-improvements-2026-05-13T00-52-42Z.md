# Spec Review Plan — memory-improvements

- **Spec path:** `docs/superpowers/specs/2026-05-13-memory-improvements-spec.md`
- **Spec commit at start:** untracked (newly authored, not yet committed)
- **HEAD commit at start:** `b5729f4876f8793d0e0808c3c01b6955a84bee75`
- **Spec-context commit at start:** `62497257bb53bc99cf55b9f442af951cf4ddd318`
- **Spec-context staleness:** GREEN (last_reviewed_at 2026-05-11; today 2026-05-13 → 2 days old, < 60 stale_after_days)
- **Iterations cap (MAX_ITERATIONS):** 5
- **Previous iterations for this spec:** 0 (fresh review)
- **Stopping heuristic:** two consecutive mechanical-only rounds → stop before cap; zero-acceptance drought → stop; no findings → stop.
- **Caller hint:** ChatGPT-pr-review will run after this. SSL cert issues blocked git fetch / npm install elsewhere in the session; check Codex CLI tolerates them.

## Scope summary

- Major / UI-touching spec; 813 lines, 16 sections.
- Three proposals (A lineage, B1+B2 utility, D semantic ranker) plus opportunistic cleanup.
- Brief is locked Rev 6.3; spec's job is translation, not redesign.
- Special framing emphasis: `staged_rollout: never_for_this_codebase_yet` and `feature_flags: only_for_behaviour_modes` — D's Rev 6 simplification is load-bearing on these.
