# Spec Review Final Report — audit-remediation-followups

**Spec:** `docs/superpowers/specs/2026-04-26-audit-remediation-followups-spec.md`
**Spec commit at start:** `264f59ef536e7ed8c685a609ce417133b8e0255a`
**Spec commit at finish:** `e38a8866590d30bc1639dc0bb33d1a787a466e14`
**Spec-context commit:** `03cf81883b6c420567c30cfc509760020d325949`
**Iterations run:** 3 of 5
**Exit condition:** two-consecutive-mechanical-only

---

## Iteration summary

| # | Codex | Rubric | Accepted | Rejected | Auto-decided |
|---|---|---|---|---|---|
| 1 | 15 | 5 | 20 | 0 | 1 (inline F2 multi-process test) |
| 2 | 16 | 0 | 16 | 0 | 0 |
| 3 | 14 | 0 | 14 | 0 | 0 |

Total: **50 findings, 50 mechanical fixes applied, 0 rejected, 1 directional auto-decided inline.**

---

## Mechanical changes — section-by-section summary

### §0 framing
- Front-matter dates corrected. Added Testing-posture paragraph naming the carved-out integration-test envelope (RLS / idempotency / crash-resume) and calling out F2 multi-process test as outside-envelope (manual smoke). Added §5-tracking pointer.

### A1 — Principal-context propagation
- Migration shape split per method category: positional → `(principal, ...rest)`; args-object → `(principal, args)`. Uniform across the service.
- Named primitive: `withPrincipalContext(principal, fn)` from `server/db/withPrincipalContext.ts` (binds principal session vars on top of `withOrgTx`-bound `app.organisation_id`).
- Gate hardened: positive-allowlist call-site granularity (accepts `fromOrgId(`, `withPrincipalContext(`, locally-typed `: PrincipalContext`); rejects bare identifiers, raw object literals (first-arg position), spread.
- Baseline switched to centralized `scripts/guard-baselines.json` (no parallel `tasks/baselines/*.txt`).

### A2 — RLS write-boundary guard
- Path drift fixed (`scripts/gates/verify-rls-coverage.sh` → `scripts/verify-rls-coverage.sh`; `server/lib/db/` → `server/lib/`; `server/db/migrations/*.sql` → `migrations/*.sql`).
- Runtime guard: Proxy wrapping of `getOrgScopedDb` + new `withAdminConnectionGuarded(options, fn)` shim (since `withAdminConnection` is callback-based, not a handle factory). Best-effort `SET LOCAL ROLE admin_role` detection differentiates deliberate admin bypass.
- Replaced in-source `@rls-not-applicable` annotation with file-based `scripts/rls-not-applicable-allowlist.txt` (TS comments aren't visible to SQL parsing).
- Architecture rule narrowed to "request- and job-scoped writes" with explicit admin-bypass carve-out.
- Tests: 5 cases including admin-bypass with/without role-switch.

### A3 — briefVisibilityService + onboardingStateService
- Function-local `getOrgScopedDb()` (not module-top — would throw at import).
- Removed wrong `withOrgTx(orgId, fn)` signature.
- Audit-verified no existing tests cover these services; mandate two new pure-function tests under `node:test`.
- Step 4 acknowledges `verify-rls-contract-compliance.sh` allowlists `server/services/**`.

### B1 — saveSkillVersion test
- Rewrote example assertions in `node:test` + `node:assert` style (`assert.rejects` instead of Jest's `expect.rejects.toThrow`).

### B2 / B2-ext — Job idempotency + concurrency
- Justified new gate vs existing `verify-job-idempotency-keys.sh` (complementary, not duplicative; preferred path is to extend existing).
- `connectorPollingSync` separated concurrency (lease) from idempotency (per-phase no-op predicates) — the original conflation is the failure mode B2 fixes.
- DoD split into B2 (idempotency) + B2-ext (concurrency) sub-blocks for partial-completion tracking.
- `Jest --repeats 10` → `tsx` repeat loop.
- §5 row notes: "may bundle OR ship separately".

### C2 — architect.md drift guard
- Path-list fixture (`scripts/architect-context-expected.txt`, one path per line) replaces count-only fixture so "name the deleted entry" acceptance is achievable.

### C3 — Canonical registry drift test
- `queryPlannerTables` derivation made conditional: preferred path requires explicit `canonicalTable` metadata; fallback narrows scope to two-set comparison (planner registry is keyed on semantic actions, not table names).

### C4 — actionRegistry comment cleanup
- Pre-A1 path: comment-only fix. Post-A1 path: remove dead import entirely (no annotation needed under A1's call-site granularity).

### D1 — Baseline capture
- "Checkout main at f824a03" → "first parent of merge commit f824a03 — `f824a03^1`".
- Baseline destination: `tasks/builds/audit-remediation/progress.md` (NOT the merged source spec).

### D3 — verify-skill-read-paths cleanup
- Audit verdict refreshed with current gate output (`94 actions, 99 readPath = 5 surplus` post-subtract-2). Patch options match the surplus situation, not the inverse "5 missing" inference.

### E1 — Pre-existing test failures
- `it.skip` → `node:test` `skip` option. `npm test -- <pattern>` → `npx tsx --test <path>`.

### E2 — Pre-existing gate failures
- "yaml missing" diagnosis flagged as stale (`yaml ^2.8.3` IS in package.json). Step 0 mandates re-running before any work; hardcoded counts → `<N>` placeholders.
- Baselines stored in existing `scripts/guard-baselines.json` (NOT invented `scripts/baselines/integration-reference.txt`).

### F2 — configDocuments parsedCache durability
- Removed invented `kvStoreWithTtlService.ts`. Restructured as consumer-only migration onto Phase-5A `rateLimitStoreService` (named in source spec §8.1).
- Three sub-cases handle Phase-5A status (merged+general API → migrate; merged+specific shape → defer; unmerged → defer).
- Removed multi-process integration test (outside carved-out envelope).
- §2 sequencing: split into row 8 (independent A3, F1) + row 8b (F2 blocked behind Phase-5A).

### G1 — Migration sequencing verification
- "Staging" → "disposable database / local dev DB". Test writes wrapped in `BEGIN…ROLLBACK`. Risk language: "verification-by-controlled-write" (not "read-only").
- Drizzle introspect diff procedure spelled out (prettier-normalize + `diff -u`).
- Missing-org outcome split by op type: SELECT silent / INSERT-UPDATE-DELETE rejected with error.
- Scoped to current-order replay only; historical-state access out of scope.

### G2 — Post-merge smoke test runbook
- Step 4 split per-job: `bundleUtilizationJob` disabled-until-Phase-6 (enqueue manually); `ruleAutoDeprecateJob` nightly (enqueue manually); `measureInterventionOutcomeJob` hourly; `connectorPollingSync` continuous.
- Step 5 removed pre-merge WARN comparison (no baseline exists); current-state observation only.

### H1 — Cross-service null-safety
- Logging helper path corrected (`server/lib/derivedDataMissingLog.ts`, sibling of existing `server/lib/logger.ts` — NOT a new `server/lib/logging/` subtree). Added `scripts/derived-data-null-safety-fields.txt` to Files.

### Cross-cutting
- `npm run typecheck` → `npm run build:server` throughout. `npm test -- <pattern>` → `npx tsx --test <path>` with parenthetical explanation of repo's `node:test` + `tsx` harness.

---

## Rejected findings

None across all three iterations.

---

## Directional / ambiguous (autonomously decided)

| Iter | Finding | Decision | Rationale |
|---|---|---|---|
| 1 | F2 multi-process integration test | AUTO-DECIDED reject inline | Outside carved-out integration-test envelope per framing assumption #2. Restart durability via manual smoke; multi-process correctness is `rateLimitStoreService`'s own responsibility. Resolved by F2 rewrite — no tasks/todo.md entry needed. |

No items routed to `tasks/todo.md` — every finding either cleanly mapped to mechanical or was resolved inline.

---

## Mechanically tight, but verify directionally

This spec is now mechanically tight against the rubric and against Codex's best-effort review across three iterations. The human has adjudicated every directional finding that surfaced (one). However:

- Review did NOT re-verify the framing assumptions in `docs/spec-context.md`. Spec is post-merge backlog — nothing here blocks shipping. Re-read §0 framing paragraph if product context has shifted.
- Review did NOT catch findings outside Codex's and the rubric's reach. Notable areas needing human eye:
  - A1↔A2 sequencing decoupling (spec now allows parallel ship — verify safe).
  - F2 "depend on Phase-5A or defer" vs introducing a generic KV-TTL primitive sooner.
  - H1 null-safety rule enforced via gate (as proposed) vs code review only at this stage.
- Review did NOT prescribe what to build next. §2 Sequencing and §4 DoD table are advisory.

**Recommended next step:** read §0 (especially the new Testing posture paragraph) and §2 (Sequencing) once more, confirm headline framings match current intent, then implement in §2 order. First-six-items batch (G2, G1, E1/E2, D1/D2/D3, B1/C4, C1) is the lowest-risk parallel-shippable group.
