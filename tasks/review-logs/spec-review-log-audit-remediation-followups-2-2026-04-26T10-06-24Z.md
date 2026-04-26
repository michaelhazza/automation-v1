# Spec Review Log — audit-remediation-followups — Iteration 2

**Spec:** `docs/superpowers/specs/2026-04-26-audit-remediation-followups-spec.md`
**Spec commit at iteration start:** `1f8be27c311ed7ff589296603d2ec8cb052fd73b`
**Spec-context commit:** `03cf81883b6c420567c30cfc509760020d325949`
**Codex output:** `tasks/review-logs/_spec-review-audit-remediation-followups-iter2-codex-output.txt`

## Findings classification (16)

| # | Source | Section | Description | Class | Disposition |
|---|---|---|---|---|---|
| 1 | A1 #1 | A1 step 2 / tests | `PrincipalContext` binding mechanism unnamed; `withPrincipalContext` exists at `server/db/withPrincipalContext.ts` and is the named primitive | mechanical | auto-apply |
| 2 | A1 #2 | A1 step 4 | Negative pattern misses object-literal / spread / chained shapes | mechanical | auto-apply (positive allowlist) |
| 3 | A1 #3 | A1 step 6 | `tasks/baselines/principal-context-propagation.txt` competes with centralized `guard-baselines.json` | mechanical | auto-apply |
| 4 | A2/A3 #1 | A2 DoD | Reintroduces rejected `@rls-not-applicable` annotation in DoD wording | mechanical | auto-apply |
| 5 | A2/A3 #2 | §2 line 1064 | A1→A2 dependency claim stale (A2 is Proxy/table-based, not principal-flag-based) | mechanical | auto-apply |
| 6 | A2/A3 #3 | A3 step 2 + DoD | `server/middleware/orgScoping.ts` doesn't exist (real entry: `auth.ts`); DoD claimed services use `withOrgTx` while Approach forbids it | mechanical | auto-apply |
| 7 | B2 #1 | B2 Files | New gate doesn't justify why `verify-job-idempotency-keys.sh` insufficient | mechanical | auto-apply (justify or extend) |
| 8 | B2 #2 | B2 connectorPollingSync | Conflates "lease prevents double-execution" (concurrency) with idempotency | mechanical | auto-apply (separate claims) |
| 9 | B2 #3 | B2 / B2-ext DoD | Single body but two tracking rows — partial completion not recordable | mechanical | auto-apply (split DoD) |
| 10 | C2 #1 | C2 algorithm vs acceptance | "Allow ≥5 entries" vs "Deletion of one path → fail" contradiction | mechanical | auto-apply (expected-count fixture file) |
| 11 | C3 #1 | C3 step 2 | `queryPlannerTables` derivation undefined (registry keyed on actions, not tables) | mechanical | auto-apply (inspect-first; fallback narrows scope) |
| 12 | D3/E2 #1 | D3 Goal | Implies "five missing readPaths" but gate is line-counter (94 vs 99 — readPath is HIGHER, not LOWER) | mechanical | auto-apply (diagnose-first; fix shape depends on diagnosis) |
| 13 | D3/E2 #2 | E2 audit verdict | "yaml missing" diagnosis is stale — `yaml` IS in package.json | mechanical | auto-apply (Step 0: re-run gate) |
| 14 | X-cut #1 | F2 in §2 | "Independent" vs "blocked on Phase 5A" contradiction | mechanical | auto-apply (resolved by row-split into 8 + 8b) |
| 15 | X-cut #2 | G1 step 1.2 | Historical-state access mechanism unspecified | mechanical | auto-apply (scope to current-order replay only) |
| 16 | X-cut #3 | H1 logging helper | Missing from Files; `server/lib/logging/` subtree unjustified vs existing `server/lib/logger.ts` | mechanical | auto-apply (path → `server/lib/derivedDataMissingLog.ts`; add to Files) |

## Mechanical changes applied

### A1
- Step 2: explicit `withPrincipalContext(principal, async (tx) => {...})` from `server/db/withPrincipalContext.ts` as the named binding mechanism; clarified which session vars come from `withOrgTx` vs `withPrincipalContext`.
- Step 4: replaced narrow negative matcher with positive allowlist of accepted first-arg shapes (`fromOrgId(`, `withPrincipalContext(`, locally-typed `: PrincipalContext` identifier); object literals / spread / bare identifiers all rejected.
- Step 6: replaced `tasks/baselines/principal-context-propagation.txt` with `scripts/guard-baselines.json` per the centralized baseline store.
- Tests: added assertion that `withPrincipalContext` is invoked inside method bodies; broke down session-var assertions into org-set vs principal-set; added per-shape gate fixtures.
- DoD: updated to reflect call-site granularity + positive-allowlist matcher + centralized baseline.

### A2
- DoD wording: "carry `@rls-not-applicable` annotation" → "appear in `scripts/rls-not-applicable-allowlist.txt`".

### A3
- Step 2: `server/middleware/orgScoping.ts` → `server/middleware/auth.ts` (HTTP path) and `server/lib/createWorker.ts` (pg-boss path).
- DoD: tightened to "use `getOrgScopedDb` (with nested `.transaction(...)` where needed)"; explicit "Neither service imports `withOrgTx` directly".

### §2 Sequencing
- Removed stale "A2 reads PrincipalContext flags" claim — A2 is now Proxy/table-based.
- Added explicit "Independent of A1" note for A2.
- Split row 8 into 8 (A3, F1 — independent parallel-shippable) and 8b (F2 — blocked behind Phase-5A).

### B2
- Files list: added paragraph explaining why a new `verify-job-concurrency-headers.sh` is complementary (not duplicative) to existing `verify-job-idempotency-keys.sh`; preferred path is to extend the existing gate.
- connectorPollingSync sub-bullet: separated concurrency (lease) from idempotency (per-phase no-op predicates).
- DoD: split into B2 (idempotency only) and B2-ext (concurrency only) sub-blocks so partial completion is recordable.

### C2
- Algorithm: replaced "≥5 entries (allow one drop)" with `scripts/architect-context-expected-count.txt` fixture-file approach.
- Acceptance criteria: aligned with new algorithm — both directions of count drift fail.

### C3
- Step 2: split into "build two sets initially"; step 3 introduces "inspect `canonicalQueryRegistry` first" with two options (preferred metadata extraction; fallback narrows scope to two-set comparison only).
- Acceptance criteria: third assertion qualified with "if step 3 preferred path applies".

### D3
- Goal: corrected to reflect that 99 > 94 (readPath HIGHER, not five missing). Real cause is unknown; investigation must come first.
- Approach: rewritten as Step 1 (diagnose) → Step 2 (patch shape depends on diagnosis) → Step 3 (fallback gate-rewrite as separate task) → Step 4 (re-run) → Step 5 (close todo).
- Acceptance criteria: diagnosis must be captured in `progress.md`.

### E2
- Audit verdict: marked as PARTIAL; flagged "yaml missing" diagnosis as stale (yaml IS in package.json).
- Step 0 added: re-run the gate before any other work; replace stale diagnosis with current state.
- verify-integration-reference.mjs steps reorganised around Step 0's findings.
- Files list: identify YAML source by running gate, do not leave as "TBD".

### G1
- Step 1.2 (snapshot+rewind history): removed entirely. Scoped to current-order replay only with explicit "historical-state access is out of scope" preamble.
- Step 1.1: added schema-introspection vs Drizzle-schema match assertion (Drizzle is authoritative).

### H1
- Files list: added new `server/lib/derivedDataMissingLog.ts` (sibling of `server/lib/logger.ts`); added new `scripts/derived-data-null-safety-fields.txt` allowlist file.
- Step 5: log helper path corrected to `server/lib/derivedDataMissingLog.ts`; added "delegates to existing logger.ts" clarifier so no new logger framework is introduced.

## Rejected findings

None.

## Directional / ambiguous findings (autonomously decided)

None this iteration. All 16 findings classified as mechanical and auto-applied.

## Counts

- mechanical_accepted: 16
- mechanical_rejected: 0
- directional_or_ambiguous: 0

## Iteration 2 Summary

- Mechanical findings accepted: 16
- Mechanical findings rejected: 0
- Directional findings: 0
- Ambiguous findings: 0
- Reclassified → directional: 0
- Autonomous decisions: 0
- Spec commit after iteration: <set after commit>
