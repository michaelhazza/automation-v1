# Spec review plan — wave-6-rls-residue-and-gate-fix

- Spec path: `tasks/builds/wave-6-rls-residue-and-gate-fix/spec.md`
- Branch: `claude/wave-6-rls-residue-and-gate-fix`
- Spec commit at start: `9fdcabd7cb8232a84ca9ed4bce5d0b1d689e95dd`
- Spec-context commit at start: `62497257bb53bc99cf55b9f442af951cf4ddd318`
- HEAD at start: `9fdcabd7cb8232a84ca9ed4bce5d0b1d689e95dd`
- MAX_ITERATIONS: 5
- Stopping heuristic: two consecutive mechanical-only rounds exits before cap
- Spec-context staleness: GREEN (last_reviewed_at 2026-05-11, age 6 days, warn at 60, block at 120)
- Pre-loop context cross-reference: spec framing in §4 explicitly states pre-prod; matches `pre_production: yes`. No staged-rollout language. No feature-flag asks. No mismatches found.

## Operator-required deliverables to verify in §10:
1. `gate-fix-design.md` (Option A vs B, B preferred) — VERIFIED at §10 chunk 0
2. `tier-categorisation.md` per-callsite verdict — VERIFIED at §10 chunk 0
3. `gate-audit-results.md` for verify-*.sh bug pattern — VERIFIED at §10 chunk 0
4. Migration order: highest-traffic first — VERIFIED at §10 chunk 0 and §13 closing line
5. Chunk 1 = gate honesty fix landing first — VERIFIED at §10 chunk 1 and §5.1

## Operator hard rules to verify present and prominent:
- Tenant-isolation merge conflicts require operator review, no automation — VERIFIED at §13 closing line
