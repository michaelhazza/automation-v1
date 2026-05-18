# Spec Review Plan — memory-outcome-feedback

- Spec path: `tasks/builds/memory-outcome-feedback/spec.md`
- Spec commit at start: `335e9a7761134f54ddaba2409c98ec4917f94b97`
- Spec-context commit at start: `62497257bb53bc99cf55b9f442af951cf4ddd318`
- Spec-context age: 8 days (green — under 60-day warn)
- MAX_ITERATIONS: 5 (lifetime cap)
- Prior iterations: 0
- Stopping heuristic: two consecutive mechanical-only rounds = stop before cap
- Class: Significant
- Caller context: spec extends three shipped systems; introduces one new tenant-scoped table, one new pg-boss job, fourth signal in PromotionSignals; reuses MEMORY_CONSOLIDATION_TIER_ENABLED; no new flag
- Pre-author self-audit gaps already fixed (do NOT re-raise):
  - (1) §3 numeric count drift
  - (2) missing example instances in §6.2 and §6.5
  - (3) missing intent.md file
- §3 grounding pass against commit 6e48183 encodes seven locked decisions; serves in lieu of a grill-me transcript.
