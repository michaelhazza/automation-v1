# Progress — wave-6-rls-residue-and-gate-fix

**Phase:** BUILD (post-implementation, pre-merge review)
**Branch:** claude/wave-6-rls-residue-and-gate-fix
**Spec:** tasks/builds/wave-6-rls-residue-and-gate-fix/spec.md

---

## Spec conformance gaps

Captured: 2026-05-18T00:30:00Z
Source log: `tasks/review-logs/spec-conformance-wave-6-rls-residue-and-gate-fix-2026-05-18.md`
Verdict: NON_CONFORMANT (4 directional gaps; 18 PASS; 1 OUT_OF_SCOPE; 0 mechanical fixes applied)

- [ ] REQ #2 — Path-form simulation Vitest test (§5.1, §6.2)
  - Spec section: §5.1 acceptance bullet 4; reinforced by §6.2 "Path-form simulation contract"
  - Gap: `scripts/__tests__/gate-file-enumerator.test.ts` covers absolute-paths, excludes, GATE_ROOT, sort/dedupe. It does NOT pin helper behaviour on POSIX-style git-bash paths (`/c/Files/...`), Windows-style paths (`C:\Files\...`), and Linux paths (`/usr/...`).
  - Suggested approach: add three test cases that pass each path form as `root` and assert the returned absolute paths. Alternatively, reshape the helper to add explicit path normalization with a test surface (the helper currently delegates to `glob` and does no normalization). The right shape depends on what behaviour the spec wants pinned — agent will not guess.

- [ ] REQ #8 — Portability harness scope (§6.2)
  - Spec section: §6.2 "For each file-scanning gate… For each non-file-scanning gate…"
  - Gap: `scripts/test-gate-portability.sh` only invokes the 2 bug-affected gates (`verify-with-org-tx-or-scoped-db.sh`, `verify-no-direct-boss-work.sh`). The audit classifies 79 gates as NOT-APPLICABLE and 3 as WINDOWS-AWARE-ALREADY, narrowing the harness scope, but spec mandate is to cover every file-scanning gate with a seeded-fixture assertion AND every non-file-scanning gate with the exit-code assertion.
  - Suggested approach: either (a) extend the harness to include the non-bug-affected file-scanning gates (`verify-loc-cap.sh`, `verify-any-budget.sh`, `verify-frontend-design-budget.sh`, etc.) and stub non-file-scanning gates with the exit-code assertion, or (b) document in `gate-audit-results.md` why each "NOT-APPLICABLE" gate is also excluded from the harness with explicit operator acceptance.

- [ ] REQ #9 — `GATE_ROOT` fixture-injection contract across all file-scanning gates (§6.2)
  - Spec section: §6.2 "Fixture-injection contract (REQUIRED for every file-scanning gate, bug-affected or not)"
  - Gap: Only `verify-with-org-tx-or-scoped-db.sh`, `verify-no-direct-boss-work.sh`, `test-gate-portability.sh`, `gate-file-enumerator.mjs`, and the path-form test reference `GATE_ROOT`. Many other file-scanning gates do not honour `GATE_ROOT` (`verify-loc-cap.sh`, `verify-any-budget.sh`, `verify-frontend-design-budget.sh`, `verify-types-used.sh`, `verify-marker-budget.sh`, `verify-derived-data-null-safety.sh`, `verify-critical-event-emission-awaited.sh`, etc.).
  - Suggested approach: enumerate every file-scanning gate (per gate-audit-results.md "uses bug pattern: NO" rows that still do file scanning), add `GATE_ROOT` resolution at the top of each gate, and replace `ROOT_DIR` references with `${GATE_ROOT:-$ROOT_DIR}`. This is a moderate-cardinality mechanical change but spans 10+ gates and could affect baseline behaviour — needs operator confirmation that the rollout is in-scope for Wave 6.

- [ ] REQ #20 — PR body completeness (§9 acceptance #14)
  - Spec section: §9 acceptance #14 "PR body includes a per-service-tier summary AND a per-gate verdict table (mirrors Wave 5 §9 acceptance #10), plus the post-migration baseline-ratchet evidence from #12"
  - Gap: `pr-body.md` references per-service-tier-summary.md and gate-audit-results.md via links but does not embed the per-gate verdict table inline. Post-migration baseline-ratchet evidence is summarised ("ratcheted 1108 to 0") but not the §6.1/§6.2 re-run evidence required by acceptance #12.
  - Suggested approach: extend `pr-body.md` to embed (or paste a condensed) per-gate verdict table from `gate-audit-results.md` and append a "Post-migration baseline-ratchet evidence" section showing the final harness + audit re-run output. Alternative: operator accepts that linking satisfies "include" and documents acceptance in progress.md.

---

## Severity guidance for operator

- **REQ #2 + REQ #9** — these are the load-bearing claims of P3 (the OS-parity gate-correctness harness). Without them, the spec's "OS-parity behaviour" guarantee in §9 acceptance #1 is partially unsubstantiated. Recommend addressing before merge.
- **REQ #8** — same family as REQ #9; reducing this gap is a coverage extension rather than a correctness fix.
- **REQ #20** — cosmetic and arguably already satisfied by linking; lowest severity.
