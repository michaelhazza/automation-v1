# Pre-Launch RLS Hardening — Spec

**Source:** `docs/pre-launch-hardening-mini-spec.md` § Chunk 1
**Invariants:** `docs/pre-launch-hardening-invariants.md` (commit SHA: `13ffec6d372d3d823352f88cca9b9eb9728910b5`)
**Verification log:** `tasks/builds/pre-launch-hardening-specs/chunk-1-verification-log.md`
**Implementation order:** `1 → {2, 4, 6} → 5 → 3` (this is Chunk 1, foundation; lands first)
**Status:** draft, ready for user review

---

## Table of contents

1. Goal + non-goals
2. Items closed
3. Items NOT closed
4. Key decisions
5. Files touched
6. Implementation Guardrails
7. Test plan
8. Done criteria
9. Rollback notes
10. Deferred Items
11. Review Residuals
12. Coverage Check

---

## 1. Goal + non-goals

### Goal

Close every multi-tenant RLS gap in the pre-testing surface so that the testing round runs against a registry-aligned, FORCE-RLS-protected, phantom-var-free posture.

After Chunk 1 lands:

- Every tenant table in the `RLS_PROTECTED_TABLES` manifest has matching `FORCE ROW LEVEL SECURITY` + `CREATE POLICY` in migrations (3-set drift = 0).
- No migration references the phantom `app.current_organisation_id` session variable.
- Every cited route / lib / service uses the principal-context helpers (no direct `db` import in `server/routes/`; no direct `db` import in `server/lib/` against tenant tables).
- The RLS gates (`verify-rls-coverage.sh`, `verify-rls-contract-compliance.sh`, `verify-rls-session-var-canon.sh`) run with their chosen posture (hard or warn — see § 4).

### Non-goals

- **Subaccount-isolation policy reinstatement on cached-context tables.** Migration 0213 deliberately dropped DB-layer subaccount RLS for `reference_documents`, `document_bundles`, `document_bundle_attachments`, `bundle_resolution_snapshots`, `bundle_suggestion_dismissals` in favour of service-layer filters (Option B-lite). Chunk 2 (CACHED-CTX-DOC) adds the architectural decision to `docs/cached-context-infrastructure-spec.md`. This spec does not reinstate the policies.
- **Principal-context propagation across `canonicalDataService` callers.** That's `S-2` / `P3-H7` and lives in Chunk 6.
- **Maintenance-job admin/org tx contract.** That's `B10-MAINT-RLS` and lives in Chunk 4.
- **Schema column renames / handoff_source_run_id.** Chunk 2.

---

## 2. Items closed

Each item carries the owning `tasks/todo.md` line plus a verbatim ≥10-word snippet for traceability across line shifts.

### 2.1 Already-closed items — re-asserted as invariants (verification only)

These 12 items were closed by migration 0227 (`c6f491c3 feat(phase-1): RLS hardening — migration 0227, service extractions, org-scoped write guards, subaccount resolution, gate baselines`) before Chunk 1 spec authoring began. The Chunk 1 PR re-asserts them as invariants in the cross-chunk invariants doc (`docs/pre-launch-hardening-invariants.md` §1.1–§1.5) and annotates each line in `tasks/todo.md` with `→ verified closed by migration 0227 (commit c6f491c3); owned by pre-launch-rls-hardening-spec`. Per-item evidence is in `tasks/builds/pre-launch-hardening-specs/chunk-1-verification-log.md` § 1.

| Mini-spec ID | todo.md line | Verbatim snippet |
|---|---|---|
| `P3-C1` | 841 | "P3-C1 — Missing `FORCE ROW LEVEL SECURITY` + `CREATE POLICY` on `memory_review_queue`" |
| `P3-C2` | 842 | "P3-C2 — Missing `FORCE ROW LEVEL SECURITY` on `drop_zone_upload_audit`" |
| `P3-C3` | 843 | "P3-C3 — Missing `FORCE ROW LEVEL SECURITY` on `onboarding_bundle_configs`" |
| `P3-C4` | 844 | "P3-C4 — Missing `FORCE ROW LEVEL SECURITY` on `trust_calibration_state`" |
| `P3-C6` | 845 | "P3-C6 — Direct `db` import in `server/routes/memoryReviewQueue.ts`" |
| `P3-C7` | 846 | "P3-C7 — Direct `db` import in `server/routes/systemAutomations.ts`" |
| `P3-C8` | 847 | "P3-C8 — Direct `db` import in `server/routes/subaccountAgents.ts`" |
| `P3-C9` | 848 | "P3-C9 — Missing `resolveSubaccount` in `server/routes/clarifications.ts`" |
| `P3-C10` | 849 | "P3-C10 — Missing `organisationId` filter in `server/services/documentBundleService.ts`" |
| `P3-C11` | 850 | "P3-C11 — Missing `organisationId` filter in `server/services/skillStudioService.ts`" |
| `P3-H2` | 851 | "P3-H2 — Direct `db` import in `server/lib/briefVisibility.ts`" |
| `P3-H3` | 852 | "P3-H3 — Direct `db` import in `server/lib/workflow/onboardingStateHelpers.ts`" |

### 2.2 Truly-open items — closed by this spec's migrations

| Mini-spec ID | todo.md line | Verbatim snippet | Resolution |
|---|---|---|---|
| `P3-C5` | 840 | "P3-C5 — Phantom RLS session var `app.current_organisation_id` in migrations 0205, 0206, 0207, 0208" | New corrective migration sweeps **6 migrations** (0204, 0205, 0206, 0207, 0208, 0212 — verification log § 2 documents that 0212 was missed by the mini-spec). Each occurrence is replaced with `current_setting('app.organisation_id', true)` per the migration 0213 pattern. |
| `GATES-2026-04-26-1` | 935 (resolved B-1/B-2/B-3 follow-up note) | "REVIEW: Migration 0227 over-scope (`reference_documents` + `reference_document_versions`). RESOLVED: removed both blocks from `migrations/0227_rls_hardening_corrective.sql`; added a header note explaining 0202/0203 hardening belongs in a follow-on migration with a parent-EXISTS policy variant" | New corrective migration adds `FORCE ROW LEVEL SECURITY` to both tables. `reference_document_versions` has no `organisation_id` column; its policy uses parent-EXISTS WITH CHECK against `reference_documents.organisation_id`. |

### 2.3 SC-1 — registry/migration drift audit

`SC-1 / SC-2026-04-26-1` is closed by the verification log's § 3 + § 4: the 3-set drift is **2** (was 60 at mini-spec time; reduced by migration 0227). Both drifting tables are covered by `GATES-2026-04-26-1` above. After Chunk 1's two corrective migrations land, drift = 0.

### 2.4 Gate-blocking decision

The mini-spec asks: "Should the RLS gate become hard-blocking (vs warn) once the registry is reconciled?" This spec recommends **hard-blocking** (see § 4.2). User adjudicates at review.

---

## 3. Items NOT closed

| What | Why deferred | Where it lives |
|---|---|---|
| Subaccount-isolation policy reinstatement on cached-context tables | Architectural decision: Option B-lite (service-layer filters) is the chosen posture per migration 0213 | Chunk 2 CACHED-CTX-DOC documents the decision in `docs/cached-context-infrastructure-spec.md` |
| `S-2` / `P3-H7` Principal-context propagation across `canonicalDataService` callers | Cross-cutting service signature work; out of Chunk 1 surface | Chunk 6 (Gate Hygiene) |
| `B10-MAINT-RLS` Maintenance jobs admin/org tx contract | Job-layer pattern; not RLS-policy work | Chunk 4 |
| `WB-1` `agent_runs.handoff_source_run_id` write-path | Schema decision; needs architect call | Chunk 2 |
| Anything in mini-spec § "Explicitly out of scope" that touches RLS | Per mini-spec | Post-launch |

---

## 4. Key decisions

### 4.1 SC-1 per-table classification — resolved

The 73 manifest entries × FORCE-RLS-coverage cross-reference produces 71 aligned + 2 manifest-only (`reference_documents`, `reference_document_versions`). The full per-table classification table lives in `tasks/builds/pre-launch-hardening-specs/chunk-1-verification-log.md` § 4. The two drifting tables are closed by `GATES-2026-04-26-1`'s migration in this spec.

**Decision: drift = 2; both addressed. Post-Chunk-1, drift = 0.**

### 4.2 Gate-blocking posture — recommendation, awaiting user adjudication

The mini-spec leaves open: should `verify-rls-coverage.sh` and `verify-rls-contract-compliance.sh` exit with hard-block (CI fail) or warn-only when a violation is found?

**Recommendation: hard-block.** Rationale:

- Drift is 2 known-deferred tables on entry, 0 after Chunk 1 lands. The false-positive rate is essentially zero.
- Pre-production posture (per `docs/spec-context.md:14`): no users, no live data. The cost of a CI failure during testing is negligible.
- The cost of a latent fail-open RLS gap during the testing round is high — it poisons every test-data assumption built on top of it.
- The gate is the primary mechanism enforcing invariants 1.1 and 1.2 (manifest registration mandatory; three-layer fail-closed isolation).

**Implementation:** the existing scripts already exit non-zero on violation; the change is to wire them as required CI checks rather than informational. Add to `package.json` test scripts and CI workflow per the standard verification-command convention in `CLAUDE.md`.

**Open question routed to user for adjudication at PR review** (see § Review Residuals below): confirm hard-block, or specify warn-only with a re-evaluation date.

### 4.3 Phantom-var sweep scope — drift discovered

Mini-spec named migrations 0205, 0206, 0207, 0208 (4 migrations). Verification log § 2 found **6 active uses across 6 migrations** — adds 0204 (which the mini-spec also owns by listing as part of the cached-context surface) and 0212 (which the mini-spec missed entirely).

**Decision:** the corrective migration sweeps all 6. Audit trail in the verification log § 2.

### 4.4 Reference-documents parent-EXISTS policy shape

`reference_document_versions` has no `organisation_id` column (see `migrations/0203_reference_document_versions.sql`). The FORCE RLS policy must scope via the parent document:

```sql
CREATE POLICY reference_document_versions_org_isolation ON reference_document_versions
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM reference_documents
      WHERE reference_documents.id = reference_document_versions.document_id
        AND reference_documents.organisation_id = current_setting('app.organisation_id', true)::uuid
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM reference_documents
      WHERE reference_documents.id = reference_document_versions.document_id
        AND reference_documents.organisation_id = current_setting('app.organisation_id', true)::uuid
    )
  );
```

`reference_documents` itself uses the standard org-id-column policy. Both tables get `FORCE ROW LEVEL SECURITY`.

---

## 5. Files touched

### New migrations (the only code-side artefacts in Chunk 1)

| File | Purpose |
|---|---|
| `migrations/0228_phantom_var_sweep.sql` (or next available number — verify before commit) | Replaces every active `current_setting('app.current_organisation_id', true)` with `current_setting('app.organisation_id', true)` across migrations 0204, 0205, 0206, 0207, 0208, 0212. Strategy: `DROP POLICY IF EXISTS ...` then re-create with the canonical var. Idempotent re-run. |
| `migrations/0229_reference_documents_force_rls_parent_exists.sql` (or next available) | Adds `FORCE ROW LEVEL SECURITY` to both `reference_documents` and `reference_document_versions`; the latter uses parent-EXISTS WITH CHECK per § 4.4. |

### Manifest / config

`server/config/rlsProtectedTables.ts` — both `reference_documents` (line 472) and `reference_document_versions` (line 478) entries are updated to point at the new `policyMigration` value (the new corrective migrations) and have their `rationale` text updated to note the parent-EXISTS shape for `reference_document_versions`.

### CI / gate wiring (subject to § 4.2 adjudication)

If hard-blocking is approved:

- `package.json` — add `verify:rls` script chaining `verify-rls-coverage.sh` + `verify-rls-contract-compliance.sh` + `verify-rls-session-var-canon.sh`.
- CI workflow file (TBD per repo convention) — promote the `verify:rls` step from informational to required.

### No server / lib / route / service changes

The 12 already-closed items in § 2.1 require **no code changes** — they are already correct on `main`. The Chunk 1 PR re-asserts them as invariants in `docs/pre-launch-hardening-invariants.md` (already done in Task 0.6 — pinned at `cf2ecbd0`).

### Documentation updates

- `tasks/todo.md` — annotate the 14 cited items per § 8 below.
- `tasks/builds/pre-launch-hardening-specs/progress.md` — mark Task 1 complete; record Chunk 1 PR URL.

---

## 6. Implementation Guardrails

### MUST reuse

From `docs/spec-context.md § accepted_primitives`:

- `withOrgTx` / `getOrgScopedDb` / `withAdminConnection` (`server/middleware/orgScoping.ts`, `server/instrumentation.ts`) — three-layer fail-closed isolation entry points.
- `RLS_PROTECTED_TABLES` manifest (`server/config/rlsProtectedTables.ts`) — single source of truth for tenant-isolated tables. New entries land in the same migration that creates the policy.
- `verify-rls-coverage.sh` + `verify-rls-contract-compliance.sh` (`scripts/gates/`) — CI gates that enforce manifest coverage and direct-DB-access prohibition.
- `verify-rls-session-var-canon.sh` — bans the phantom `app.current_organisation_id` (per invariant 1.3).
- `rls.context-propagation.test.ts` (`server/services/__tests__/`) — integration test harness for Layer B RLS default-deny posture.
- Migration 0213's pattern for the phantom-var sweep — it is the documented precedent for the corrective approach.
- Migration 0227's pattern for FORCE RLS + CREATE POLICY in one block — it is the documented precedent for tenant-table hardening.

### MUST NOT introduce

- New service layers when `withOrgTx` / `getOrgScopedDb` / `withAdminConnection` fit (per `convention_rejections` in `docs/spec-context.md:73`).
- A new "RlsService" or similar wrapper. The three-layer model is the architecture; new wrappers contradict invariant 1.1.
- Any new RLS session variable beyond the five canonical ones in invariant 1.3.
- Subaccount-isolation policies on the cached-context tables — Option B-lite is the chosen posture per migration 0213 (invariant 1.6).
- Vitest / Jest / Playwright / Supertest tests (per `docs/spec-context.md § convention_rejections`).

### Known fragile areas

- **Migration ordering on the phantom-var sweep.** The `DROP POLICY IF EXISTS` + `CREATE POLICY` shape must reference the exact policy names from migrations 0204–0212. Audit each name from the source migration file before writing the corrective.
- **Parent-EXISTS subquery cost on `reference_document_versions`.** The policy runs the EXISTS subquery on every row read. The table is small (~thousands of rows expected) and the subquery hits an indexed FK, but if a future feature drives heavy `reference_document_versions` access, monitor query plans.
- **`reference_documents` has 0 dummy data today.** The policy is added to a near-empty table; tests cannot easily exercise it. Rely on the `rls.context-propagation.test.ts` harness pattern.

---

## 7. Test plan

Per `docs/spec-context.md § testing posture` (`runtime_tests: pure_function_only`, `static_gates_primary`):

### Static gates (primary)

- `verify-rls-coverage.sh` — must pass with the new manifest entries pointing at the new corrective migrations.
- `verify-rls-contract-compliance.sh` — must pass.
- `verify-rls-session-var-canon.sh` — must pass; no remaining `app.current_organisation_id` active uses (comments excluded).
- `migrations/` `npm run db:generate` — must succeed; new migration files have a valid header and follow the established naming convention.

### Runtime test (pure-function, existing harness)

- `server/services/__tests__/rls.context-propagation.test.ts` — extend the existing test loop to cover `reference_documents` and `reference_document_versions`. The test asserts:
  - With `app.organisation_id` unset, both tables return zero rows (default-deny).
  - With `app.organisation_id` set to org A, only org A rows are visible.
  - The parent-EXISTS variant on `reference_document_versions` still hides versions belonging to org B's parent documents when the session is set to org A.

No new test files. No supertest. No e2e.

### Sanity grep checklist (manual, run before PR)

```bash
# Active phantom-var uses (expect zero after sweep)
grep -nE "current_organisation_id" migrations/*.sql | grep -vE "^migrations/[^:]+:--"

# Direct db imports in routes (expect zero)
grep -nE "^import.*\bdb\b" server/routes/*.ts

# Direct db imports in lib against tenant tables (expect zero — ignore lib/orgScopedDb.ts which legitimately exports the tenant-aware accessor)
grep -nE "^import.*\bdb\b" server/lib/**/*.ts | grep -v "lib/orgScopedDb.ts"

# Manifest entries referencing reference_documents (expect new policyMigration value)
grep -A1 "tableName: 'reference_document" server/config/rlsProtectedTables.ts
```

---

## 8. Done criteria

- [ ] New corrective migration `0228_phantom_var_sweep.sql` (or next available number) lands; `verify-rls-session-var-canon.sh` passes; no active uses of `app.current_organisation_id` remain (comments-only references retained for historical context).
- [ ] New corrective migration `0229_reference_documents_force_rls_parent_exists.sql` (or next available) lands; both `reference_documents` and `reference_document_versions` have `FORCE ROW LEVEL SECURITY`; the parent-EXISTS policy on the versions table is in place.
- [ ] `server/config/rlsProtectedTables.ts` updated for both tables (new `policyMigration` value + rationale tweak).
- [ ] `rls.context-propagation.test.ts` extended to cover both tables; passes.
- [ ] `tasks/todo.md` annotated for all 14 cited items per § 8 (12 closed-by-0227, 2 closed-by-this-spec).
- [ ] Gate-blocking decision (§ 4.2) adjudicated by user; if hard-block approved, CI wiring lands in this PR.
- [ ] SC-1 3-set drift = 0 (verification log § 3 + § 4 update notes the post-Chunk-1 state).
- [ ] PR body links the verification log + this spec; test plan checked off in PR template.

---

## 9. Rollback notes

The two corrective migrations are reversible per the project's standard `_down.sql` pattern (or the `db:rollback` workflow if that's the convention — verify before commit):

- **`0228_phantom_var_sweep.sql` rollback:** restore the original phantom var in each affected migration. This is a no-op for runtime correctness because the phantom var was already silently fail-open; it just restores the pre-sweep state.
- **`0229_reference_documents_force_rls_parent_exists.sql` rollback:** drop the new `FORCE` and the new policies; the underlying `ENABLE ROW LEVEL SECURITY` from 0202/0203 remains.

If the gate-blocking promotion is reverted (i.e. the user wants to back out of hard-block), the rollback is a `package.json` script + CI workflow revert; no DB impact.

---

## 10. Deferred Items

None for Chunk 1.

The verification log § 2 surfaced one mini-spec drift that this spec absorbs (migration 0212 was missed; sweep extends to it). No remaining deferrals.

Items in mini-spec § "Explicitly out of scope" that touch RLS (e.g. observability of RLS policy evaluation, cross-org analytics RLS) remain post-launch by the mini-spec's framing; they are not deferred *from* this spec — they were never in scope.

---

## 11. Review Residuals

_(Populated by user adjudication at PR review. Per `tasks/builds/pre-launch-hardening-specs/progress.md` § Workflow deviations, the `spec-reviewer` agent is skipped; this section captures the user's directional + HITL calls instead.)_

### HITL decisions (user must answer)

- **Gate-blocking posture (§ 4.2):** confirm hard-block (recommended) or specify warn-only with re-evaluation date.

### Directional uncertainties (explicitly accepted tradeoffs)

- **Phantom-var sweep migration approach.** This spec uses `DROP POLICY IF EXISTS` + `CREATE POLICY` with the canonical var rather than per-policy `ALTER POLICY` statements (which Postgres does not directly support for `USING` / `WITH CHECK` rewrites). The drop-and-recreate approach is mechanically equivalent and matches migration 0213's precedent. Accepted; not flagging.
- **Tests added in `rls.context-propagation.test.ts` extension.** The test posture is `pure_function_only`; this is an integration test against a Postgres instance, but it's an *existing* test harness named in `docs/spec-context.md § accepted_primitives` — extending it is not introducing a new test category. Accepted.

### Not adjudicated by `spec-reviewer`

Per workflow deviation in progress.md, `spec-reviewer` was skipped for this spec. The user reviews directly. Cadence-bypass means this PR is reviewed alongside Chunks 4 and 6 in a batch.

---

## 12. Coverage Check

Every bullet in the mini-spec § "Chunk 1 — RLS Hardening Sweep" `Items` block is mapped to the section of this spec that closes it. An unchecked box blocks merge.

### Mini-spec Items (verbatim)

- [x] `P3-C1` `P3-C2` `P3-C3` `P3-C4` — 4 tables missing FORCE RLS — **addressed in § 2.1** (verified closed by migration 0227).
- [x] `P3-C5` — phantom RLS session var across migrations 0205/0206/0207/0208 — **addressed in § 2.2 + § 4.3** (corrective migration; sweep extends to 0204 and 0212 per verification log § 2).
- [x] `P3-C6..C9` — 4 routes import `db` directly — **addressed in § 2.1** (verified closed by migration 0227 service extractions).
- [x] `P3-C10` — `documentBundleService` queries agents/tasks without orgId — **addressed in § 2.1** (verified closed).
- [x] `P3-C11` — `skillStudioService` queries skills without orgId — **addressed in § 2.1** (verified closed).
- [x] `P3-H2` — `briefVisibility.ts` direct `db` import — **addressed in § 2.1** (verified closed).
- [x] `P3-H3` — `onboardingStateHelpers.ts` direct `db` import — **addressed in § 2.1** (verified closed).
- [x] `SC-1` (`SC-2026-04-26-1`) — 60-table delta — **addressed in § 2.3 + § 4.1** (drift reduced to 2 by migration 0227; remaining 2 closed by GATES-2026-04-26-1 in this spec).
- [x] `GATES-2026-04-26-1` — `reference_documents` / `_versions` FORCE RLS via parent-EXISTS WITH CHECK — **addressed in § 2.2 + § 4.4** (corrective migration with parent-EXISTS policy on the versions table).

### Mini-spec Key decisions (verbatim)

- [x] **For `SC-1`: which of the 60 tables are tenant-scoped vs system tables?** — **addressed in § 4.1 + verification log § 4** (full per-table classification; 71 aligned, 2 manifest-only — both subject to GATES-2026-04-26-1).
- [x] **Should the RLS gate become hard-blocking (vs warn) once the registry is reconciled?** — **addressed in § 4.2** (recommendation: hard-block; routed to user for adjudication).

### Final assertion

- [x] **No item from mini-spec § "Chunk 1 — RLS Hardening Sweep" is implicitly skipped.** Every cited item appears in either § 2.1 (closed by 0227, verified) or § 2.2 (truly open, closed by this spec's migrations). Both Key decisions are addressed in § 4. Out-of-scope items are listed explicitly in § 3.

### Mini-spec done criteria — mapped to this spec's § 8

- [x] "Zero `import { db } from` in `server/routes/`" — verified clean by sanity-grep checklist in § 7; no code change needed.
- [x] "Every tenant table has FORCE RLS + valid policies; gate enforces hard." — closed by Chunk 1's two corrective migrations + § 4.2 hard-block recommendation.
- [x] "SC-1 registry == migrations == code expectations (3-set drift = 0)." — closed by GATES-2026-04-26-1 migration; verification log § 4 documents the post-Chunk-1 state.
