# Spec Review Plan — personal-assistant-v2-operator

**Spec path:** `docs/superpowers/specs/2026-05-13-personal-assistant-v2-operator-spec.md`
**Spec commit at start:** untracked (new file at HEAD `ffd9a08a`)
**Spec-context commit:** `62497257bb53bc99cf55b9f442af951cf4ddd318`
**Spec-context staleness:** last_reviewed_at 2026-05-11; age 2 days; GREEN (< stale_after_days = 60)
**Branch:** `claude/personal-assistant-post-merge-audit`
**MAX_ITERATIONS:** 5 (lifetime cap)
**Prior iterations on this spec slug:** 0 (no `spec-review-checkpoint-personal-assistant-v2-*` files; no prior final report)
**Next iteration:** 1

## Stopping heuristic
- Two consecutive mechanical-only rounds → stop early (preferred)
- Codex finds nothing AND rubric finds nothing → stop
- Zero-acceptance for two rounds (only rejects) → stop
- Otherwise cap at MAX_ITERATIONS = 5

## Pre-loop context check (Step A/B)
- `docs/spec-context.md` present and within staleness window (GREEN).
- Spec framing section (§1 Framing assumptions, §10 Testing posture) explicitly cites and matches `spec-context.md`:
  - `pre_production: yes` — spec affirms commit-and-revert, no feature flag for migration 0343.
  - `testing_posture: static_gates_primary` / `runtime_tests: pure_function_only` — §10 stays inside the envelope; explicit out-of-scope list mirrors `convention_rejections`.
  - `prefer_existing_primitives_over_new_ones: yes` — §1 third bullet enumerates what is genuinely new (one JSONB field, one routing-context pair, one column, one CI gate, two event types, one watcher).
- No framing mismatch detected. Proceed to iteration 1 with no deferred-mismatch items.
