# H1 — Derived-Data Null-Safety Contract

**Build slug:** tasks/builds/audit-remediation-followups/h1-derived-data-null-safety/
**Branch:** claude/deferred-quality-fixes-ZKgVV
**Spec:** docs/superpowers/specs/2026-04-26-audit-remediation-followups-spec.md §H1
**Started:** 2026-04-26
**Phase 1 shipped:** 2026-04-26

---

## Phase 1 summary

Phase 1 ships the advisory gate, the WARN helper, and the architecture.md rule.
No code refactors were required — all in-scope call sites already handle null correctly.

### Decisions made

**Rate-limit pattern chosen: Pattern B** (first-occurrence WARN, subsequent DEBUG via `Set<string>`).

Rationale: Phase 1 found 7 in-scope consumer call sites across 4 domains, all on low-volume
paths. Pattern B is simpler and sufficient. Pattern A (time-windowed rate limiting via
`Map<string, number>`) would be appropriate if a high-frequency path is added in Phase 2.
Pattern is documented in `server/lib/derivedDataMissingLog.ts` JSDoc and in `architecture.md`.

### In-scope call sites inventory

See `null-safety-call-sites.md` for the full per-file breakdown.

| Domain | In-scope consumers | Violations | Refactors |
|--------|-------------------|------------|-----------|
| bundleUtilizationJob | 1 | 0 | 0 |
| measureInterventionOutcomeJob | 3 | 0 | 0 |
| ruleAutoDeprecateJob | 0 | 0 | 0 |
| connectorPollingSync | 3 | 0 | 0 |

**All 7 in-scope read sites already handle null gracefully.** No refactors applied.

### Files created

- `server/lib/derivedDataMissingLog.ts` — WARN helper (Pattern B, exports `logDataDependencyMissing`)
- `scripts/verify-derived-data-null-safety.sh` — advisory gate (exits 0 always)
- `scripts/derived-data-null-safety-fields.txt` — field allowlist (4 fields from 2 domains)
- `scripts/__tests__/derived-data-null-safety/fixture-with-violation.ts` — gate self-test fixture
- `tasks/builds/audit-remediation-followups/h1-derived-data-null-safety/null-safety-call-sites.md` — inventory

### Files modified

- `architecture.md` — appended derived-data null-safety rule under §Architecture Rules / Gate scripts
- `scripts/guard-baselines.json` — added `"derived-data-null-safety": 0`
- `docs/superpowers/specs/2026-04-26-audit-remediation-followups-spec.md` — §5 H1 row updated

### Gate baseline

```
[GATE] derived-data-null-safety: violations=0
Files scanned: 848
```

Baseline recorded in `scripts/guard-baselines.json` as `"derived-data-null-safety": 0`.

---

## Phase 2 promotion criteria

Promote gate from advisory to blocking when ALL of the following hold:

1. No false-positive issues filed against the gate in a 2-3 week observation window.
2. Violation count has been stable at 0 (or any non-zero count is confirmed intentional and baselined).
3. At least one `logDataDependencyMissing` call has been added to a real call site (proving the helper is exercised in production flow, not just defined).
4. The field allowlist has not needed emergency suppressions that indicate the gate is too noisy.

Phase 2 is a separate backlog item — do not absorb it into H1.

---

## Status

Phase 1 shipped. Gate is advisory (exits 0). Phase 2 promotion pending 2-3 week observation window.
