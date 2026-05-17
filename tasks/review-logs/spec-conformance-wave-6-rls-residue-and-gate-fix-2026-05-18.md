# Spec Conformance Log

**Spec:** `tasks/builds/wave-6-rls-residue-and-gate-fix/spec.md`
**Spec commit at check:** `c2b32e4b` (latest doc lock per build folder)
**Branch:** `claude/wave-6-rls-residue-and-gate-fix`
**Base:** `9fdcabd7cb8232a84ca9ed4bce5d0b1d689e95dd`
**Scope:** All chunks of the spec (caller invoked verification for entire branch — Major build completed, 537 files in changed-code set)
**Changed-code set:** 537 files
**Run at:** 2026-05-18T00:30:00Z

---

## Summary

- Requirements extracted:     22
- PASS:                       18
- MECHANICAL_GAP → fixed:     0
- DIRECTIONAL_GAP → deferred: 4
- AMBIGUOUS → deferred:       0
- OUT_OF_SCOPE → skipped:     1

**Verdict:** NON_CONFORMANT (4 directional gaps — see deferred items in `tasks/builds/wave-6-rls-residue-and-gate-fix/progress.md`)

---

## Requirements extracted (full checklist)

| REQ | Category | Spec section | Requirement | Verdict |
|-----|----------|-------------|-------------|---------|
| 1 | file | §5.1 | `scripts/lib/gate-file-enumerator.mjs` exists with `enumerateGateFiles({root,includes,excludes})` export using `glob` | PASS |
| 2 | test | §5.1 | `scripts/__tests__/gate-file-enumerator.test.ts` is a Vitest test that pins POSIX-style (`/c/Files/...`), Windows-style (`C:\Files\...`), and Linux paths | DIRECTIONAL_GAP |
| 3 | file | §5.1 | `scripts/verify-with-org-tx-or-scoped-db.sh` rewrites enumeration to Node-native `enumerateGateFiles` (removes `find → temp → existsSync`) | PASS |
| 4 | config | §5.2 | `scripts/guard-baselines.json` `with-org-tx-or-scoped-db` baseline reflects honest post-migration count | PASS (value=0, matches `Tier 1-blocked=0` per acceptance #4) |
| 5 | file | §6.1 | `scripts/verify-no-direct-boss-work.sh` uses `enumerateGateFiles` (Option B applied) | PASS |
| 6 | doc | §6.1 | `gate-audit-results.md` lists every gate invoked by `run-all-gates.sh` with required columns | PASS (84 gates audited; 2 bug-affected, 3 windows-aware, 79 not-applicable) |
| 7 | file | §6.2 | `scripts/test-gate-portability.sh` exists, runs in CI via `run-all-gates.sh` | PASS (added at run-all-gates.sh line 193) |
| 8 | behavior | §6.2 | Harness asserts seeded-fixture detection for every file-scanning gate AND exit∈{0,1,2,3} for non-file-scanning gates | DIRECTIONAL_GAP (harness covers only the 2 bug-affected gates; spec mandates broader coverage) |
| 9 | behavior | §6.2 | `GATE_ROOT` fixture-injection contract honoured by every file-scanning gate, bug-affected or not | DIRECTIONAL_GAP (only the 2 bug-affected gates honour `GATE_ROOT`; multiple file-scanning gates use `walkFiles(readdirSync)` against fixed `ROOT_DIR` without GATE_ROOT override) |
| 10 | migration | §7.3 | `migrations/0368_rls_workflow_fk_scoped_tables.sql` creates RLS policies for the 5 WF1 FK-scoped tables | PASS (all 5 tables: `workflow_step_runs`, `workflow_step_reviews`, `workflow_studio_sessions`, `workflow_run_event_sequences`, `flow_step_outputs` with FORCE RLS + EXISTS-chain policies) |
| 11 | migration | §7.3 | Companion `.down.sql` ships | PASS |
| 12 | config | §7.3 | The 5 WF1 tables added to `server/config/rlsProtectedTables.ts` in the SAME commit as the policy migration | PASS (all 5 entries present at lines 1358, 1364, 1370, 1376, 1382) |
| 13 | doc | §10 chunk 0 | `gate-fix-design.md` records Option A vs B comparison | PASS |
| 14 | doc | §10 chunk 0 | `gate-audit-results.md` lists every bug-affected gate | PASS |
| 15 | doc | §10 chunk 0 | `tier-categorisation-framework.md` defines mandatory fields + partition rules | PASS |
| 16 | doc | §10 chunk 1' | `tier-categorisation.md` lists every residue callsite with §8 mandatory fields | PASS |
| 17 | doc | §10 chunk 13 | `tier-2-audit.md` (final Tier 2 sweep) exists | PASS |
| 18 | doc | §10 chunk N+1 | `tier-1-blocked-resolutions.md` (operator deferral log) exists; documents blocked-count=0 | PASS |
| 19 | doc | §10 final | `per-service-tier-summary.md` per-domain migration accounting | PASS |
| 20 | doc | §9 acceptance #14 | `pr-body.md` includes per-service-tier summary AND per-gate verdict table AND post-migration baseline-ratchet evidence | DIRECTIONAL_GAP (pr-body links to per-service summary; does NOT embed per-gate verdict table or baseline-ratchet evidence — links only) |
| 21 | dir | caller list | `tasks/builds/wave-6-rls-residue-and-gate-fix/gate-transcripts/` directory exists | PASS (contains `verify-with-org-tx-or-scoped-db.windows.txt`; Linux transcript missing but §6.1 accepts in-cell narrative description, which gate-audit-results.md row #70 provides) |
| 22 | merge-commit | §9 acceptance #13 | `tasks/todo.md` items F3/F4/F7/WF1/WF3/WF4/WF6/P3 + 3 Wave 6 follow-ups marked `[status:closed:pr:<num>]` in merge commit | OUT_OF_SCOPE (merge-commit task, not branch task) |

---

## Mechanical fixes applied

None. All gaps were classified as DIRECTIONAL based on the conservative fail-closed posture in the Step 3 decision order. Each gap involves either a design choice (which gates to add to the harness; whether the path-form test reshapes the helper) or a scope decision (per-gate `GATE_ROOT` rollout) that exceeds mechanical scope.

---

## Directional / ambiguous gaps (routed to progress.md)

1. **REQ #2 — Path-form simulation Vitest test** (§5.1, §6.2). Existing test exercises absolute-paths, excludes, GATE_ROOT, sort/dedupe. It does NOT pin behaviour on POSIX-style git-bash paths (`/c/Files/...`), Windows-style paths (`C:\Files\...`), and Linux paths (`/usr/...`). The helper itself does no path normalization (delegates to `glob`), so the right shape of these tests is a design call — pure-fixture roots in those three forms vs mocked glob vs reshape of the helper to add explicit normalization.

2. **REQ #8 — Portability harness scope**. `scripts/test-gate-portability.sh` only invokes the 2 bug-affected gates. §6.2 acceptance requires "For each file-scanning gate, runs against a seeded fixture directory… For each non-file-scanning gate, asserts exit ∈ {0, 1, 2, 3} AND non-empty stdout." `gate-audit-results.md` classifies 79 gates as NOT-APPLICABLE (no find→Node pipeline) and 3 as WINDOWS-AWARE-ALREADY, but many of those still do file-scanning via `walkFiles(readdirSync)`. The audit's "NOT-APPLICABLE" classification narrows the harness scope; spec mandate is broader.

3. **REQ #9 — `GATE_ROOT` fixture-injection across all file-scanning gates**. §6.2: "Gates that currently derive ROOT_DIR from the script location must be updated to honour GATE_ROOT when set — this is the one mandatory change for non-bug-affected file-scanning gates." Only `verify-with-org-tx-or-scoped-db.sh`, `verify-no-direct-boss-work.sh`, `test-gate-portability.sh`, `gate-file-enumerator.mjs`, and the path-form test reference `GATE_ROOT`. Many other file-scanning gates (`verify-loc-cap.sh`, `verify-any-budget.sh`, `verify-frontend-design-budget.sh`, `verify-types-used.sh`, `verify-marker-budget.sh`, `verify-derived-data-null-safety.sh`, `verify-critical-event-emission-awaited.sh`, plus the .mjs gates) do NOT honour `GATE_ROOT`.

4. **REQ #20 — PR body content gaps**. §9 acceptance #14 mandates the PR body include (a) per-service-tier summary, (b) per-gate verdict table, (c) post-migration baseline-ratchet evidence. Current `pr-body.md` links to per-service-tier-summary.md and gate-audit-results.md but does not embed the per-gate verdict table or baseline-ratchet evidence in the PR body itself. Whether a link satisfies "include" vs embed is a judgement call — defer to operator.

---

## Files modified by this run

None — no mechanical fixes were applied. Two files written by this run:
- `tasks/review-logs/spec-conformance-wave-6-rls-residue-and-gate-fix-2026-05-18.md` (this log)
- `tasks/builds/wave-6-rls-residue-and-gate-fix/progress.md` (directional-gap routing)

---

## Next step

NON_CONFORMANT — 4 directional gaps must be addressed by the main session before `pr-reviewer`. See `tasks/builds/wave-6-rls-residue-and-gate-fix/progress.md` under "Spec conformance gaps".

Severity assessment for operator:
- REQ #2 (path-form test) and REQ #9 (GATE_ROOT broad rollout) — these are the load-bearing claims of P3. Without them, the "OS-parity behaviour" guarantee in §9 acceptance #1 is partially unsubstantiated. Significant.
- REQ #8 (harness scope) — same family as REQ #9; minor coverage extension.
- REQ #20 (PR body content) — cosmetic and arguably already satisfied by linking. Lowest severity.

Operator may accept gaps with explicit deferral notes per spec §8 blocked-tier follow-up format, or address before merge.
