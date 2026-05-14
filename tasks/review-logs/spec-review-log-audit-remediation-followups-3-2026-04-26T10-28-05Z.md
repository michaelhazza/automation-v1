# Spec Review Log — audit-remediation-followups — Iteration 3

**Spec:** `docs/superpowers/specs/2026-04-26-audit-remediation-followups-spec.md`
**Spec commit at iteration start:** `6f1eca5157c64c0ab90255851c317e2d7fee2760`
**Spec-context commit:** `03cf81883b6c420567c30cfc509760020d325949`
**Codex output:** `tasks/review-logs/_spec-review-audit-remediation-followups-iter3-codex-output.txt`

## Findings classification (14)

| # | Source | Section | Description | Class | Disposition |
|---|---|---|---|---|---|
| 1 | X-cut #1 | A1/A3 DoD, B1, E1 | `npm run typecheck` doesn't exist; `npm test -- <pattern>` not supported | mechanical | auto-apply (real script names + `npx tsx --test`) |
| 2 | X-cut #2 | B1, E1 | Jest APIs (`expect.rejects.toThrow`, `it.skip`); repo uses `node:test` | mechanical | auto-apply |
| 3 | X-cut #3 | All items | Items lack per-item Status pointer; §0 says uniform shape | mechanical | auto-apply (single §0 note pointing at §5) |
| 4 | A1 #1 | A1 step 2 + 4 | Object-literal first args banned, but `listInactiveContacts(args: {...})` exists at canonicalDataService.ts:493 | mechanical | auto-apply (split shape: positional vs args-object methods) |
| 5 | A2 #1 | A2 step 2 | `withAdminConnection` is callback-based (not handle factory) — wrap-returned-handle won't work | mechanical | auto-apply (introduce `withAdminConnectionGuarded` shim) |
| 6 | A2 #2 | A2 architecture rule | DoD over-broad ("all writes through getOrgScopedDb") conflicts with deliberate `withAdminConnection` writes | mechanical | auto-apply (narrow rule + carve out admin-bypass) |
| 7 | A3 #1 | A3 acceptance/tests | "Existing route tests" claim unverified — no such tests exist for these services | mechanical | auto-apply (mandate new pure-function tests) |
| 8 | C2 #1 | C2 algorithm | Count-only fixture can't satisfy "name the deleted entry" acceptance | mechanical | auto-apply (path-list fixture instead) |
| 9 | D3 #1 | D3 audit verdict + approach | Stale narrative ("subtraction may not be running") — gate DOES subtract 2; refresh from real run | mechanical | auto-apply (captured fresh: 94 vs 99 = 5 surplus readPaths post-subtract) |
| 10 | E2 #1 | E2 acceptance | Hardcoded "26 warnings" remains after Step 0 declared them placeholders | mechanical | auto-apply (replace with `<N>` placeholder) |
| 11 | G1 #1 | G1 step 1.1, 1.3 | Drizzle introspect diff procedure unspecified; missing-org write outcome wrong | mechanical | auto-apply (specify diff via prettier-normalized + diff -u; split outcome by SELECT vs INSERT) |
| 12 | G2 #1 | G2 step 5 | Pre-merge WARN baseline doesn't exist | mechanical | auto-apply (current-state observation only) |
| 13 | G2 #2 | G2 step 4 | `bundleUtilizationJob` disabled until Phase 6 (verified in file header) | mechanical | auto-apply (split steps: enqueue manually for disabled jobs) |
| 14 | B2/Tracking | §5 rows | Tracking says "bundle with B2-ext" while body says split DoD | mechanical | auto-apply ("may bundle OR ship separately") |

## Mechanical changes applied

### Cross-cutting
- All `npm run typecheck` references → `npm run build:server` (TypeScript-checks server tree). Single replace_all. (Note: `lint` script DOES exist; left as-is.)
- All `npm test -- <pattern>` references → `npx tsx --test <path>` with parenthetical explaining the repo's harness (`node:test` via `tsx`, aggregate via `npm run test:unit`).
- §0 reviewer's contract: added "**Per-item status is tracked in §5 Tracking** — items do not carry an inline `Status:` field" line.

### A1
- Step 2 expanded: explicit migration shape per category. Positional methods → `(principal, ...rest)`. Args-object methods → `(principal, args)`. Single uniform shape across the service. Reference: `canonicalDataService.ts:493` (`listInactiveContacts(args: {...})`).
- Step 4 gate-matcher: clarified that under split-positional shape, an object literal as the SECOND argument is fine; the matcher inspects only the first arg's shape.

### A2
- Step 2 runtime guard: introduced `withAdminConnectionGuarded(options, fn)` shim instead of "wrap returned handle" (which doesn't fit the callback-based actual `withAdminConnection(options, fn)` API at `server/lib/adminDbConnection.ts:58`). The shim wraps the `tx` argument passed into the user callback before user code sees it. `RlsBoundaryAdminWriteToProtectedTable` only fires when no `SET LOCAL ROLE admin_role` is detected in the same callback (best-effort role-switch detection).
- Tests: 4 cases → 5 cases, splitting the admin-bypass case into "with-role-switch (succeeds)" vs "without-role-switch (throws)".
- DoD architecture rule: narrowed from "all writes through `getOrgScopedDb`" to "request- and job-scoped writes" with explicit carve-out for deliberate cross-org writes via `withAdminConnection` + `SET LOCAL ROLE admin_role`.

### A3
- Acceptance criteria: documented that no existing tests cover these services on current main; mandate new tests.
- Tests required: explicit new files `briefVisibilityServicePure.test.ts` and `onboardingStateServicePure.test.ts`, both following `node:test` + `node:assert`.

### B1
- Approach: rewrote example assertions in `node:test` + `node:assert` style (`assert.rejects(...)` instead of `expect(...).rejects.toThrow(...)`).

### C2
- Approach: replaced count-only fixture with path-list fixture (`scripts/architect-context-expected.txt`, one path per line). Gate fails on missing entry / unexpected entry / order mismatch — all with the offending entry named.
- Acceptance criteria: aligned with new mechanism (deletion fails naming entry; addition fails naming entry).

### D3
- Audit verdict: refreshed with actual gate output captured this iteration (`FAIL: -5 actions missing readPath tag` / `Literal action entries: 94, with readPath: 99`); clarified that `99` IS post-subtract-2 — there are 5 SURPLUS readPaths.
- Approach Step 1: concrete grep commands; Step 2 patch shape options (a/b/c) now match reality of "5 surplus", not "5 missing".

### E1
- "Convert to `it.skip`" → "Convert to `node:test` `skip` option" with concrete example (`test('...', { skip: 'reason' }, () => { ... })`).
- Acceptance criteria: matching language.

### E2
- Acceptance criteria: hardcoded `26 warnings` / `1 blocking error` → `<N>` placeholders pending Step 0's fresh capture.
- "(currently 7) violators" — explicitly noted that the historical 7-count must be re-confirmed.

### G1
- Step 1.1: spelled out Drizzle introspect diff procedure (prettier-normalize + `diff -u`, ignore whitespace/comment/import-order trivia).
- Step 1.3: split missing-org outcome by operation type — `SELECT` returns zero rows silently (RLS); `INSERT/UPDATE/DELETE` is REJECTED with a Postgres error (FORCE RLS). A tenant-table write that returns zero rows instead of erroring is itself a finding.

### G2
- Step 4: split into per-job sub-bullets. `bundleUtilizationJob` disabled until Phase 6 → "enqueue manually via the queue admin tooling". `measureInterventionOutcomeJob` hourly. `ruleAutoDeprecateJob` nightly → "enqueue manually; do NOT wait for the nightly slot". `connectorPollingSync` continuous.
- Step 5: removed pre-merge vs post-merge WARN comparison (no baseline exists). Replaced with "current-state observation only".

### §5 Tracking
- B2 row: "bundle with B2-ext" → "may bundle with B2-ext OR ship separately (split DoD allows partial completion)".
- B2-ext row: same treatment.

## Rejected findings

None.

## Directional / ambiguous findings (autonomously decided)

None this iteration. All 14 findings classified as mechanical and auto-applied.

## Counts

- mechanical_accepted: 14
- mechanical_rejected: 0
- directional_or_ambiguous: 0

## Iteration 3 Summary

- Mechanical findings accepted: 14
- Mechanical findings rejected: 0
- Directional findings: 0
- Ambiguous findings: 0
- Reclassified → directional: 0
- Autonomous decisions: 0
- Spec commit after iteration: <set after commit>
