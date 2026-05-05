# Pre-Launch Hardening — Consolidated Spec

**Source:** `docs/pre-launch-hardening-mini-spec.md` (audit of `tasks/todo.md` 2026-04-26 — 78 deferred items grouped into 6 phases).
**Invariants:** `docs/pre-launch-hardening-invariants.md` (commit SHA: `1cc81656138663496a09915db28587ffd83fbddc`) — 7 categories, 43 invariants, typed Gate / Test / Static / Manual enforcement with named owners.
**Architect inputs (pinned):**
- Phase 2 (Schema Decisions): `tasks/builds/pre-launch-hardening-specs/architect-output/schema-decisions.md` (commit SHA: `65494c88eb12bbaf22b2ed05ec1f29f14601f566`)
- Phase 6 (Dead-Path): `tasks/builds/pre-launch-hardening-specs/architect-output/dead-path-completion.md` (commit SHA: `6bbbd737d48b9393146cd35f4930c0efdbb1be54`)
**Verification log:** `tasks/builds/pre-launch-hardening-specs/chunk-1-verification-log.md` (Phase 1 SC-1 audit + closed-by-0227 evidence)
**Status:** draft, ready for user review

---

## Executive summary

Single consolidated spec for the pre-launch hardening sprint. Closes the deferred-items audit (`tasks/todo.md` 2026-04-26) before the testing round runs. Six phases, binding implementation order, 27 truly-open items + 27 verified-closed-by-prior-work items. All cross-flow invariants live in the companion invariants doc; per-phase contracts (idempotency posture, retry classification, terminal events, source-of-truth precedence, observability hooks, response shapes) are pinned in each phase's section.

This document supersedes the prior 6 per-chunk spec files (which have been removed from `docs/`). The original chunk numbering is preserved as cross-reference annotations on each phase header so traceability against the mini-spec remains intact.

## Implementation order (BINDING)

```
1 → {2, 3, 4} → 5 → 6
```

Translates from the mini-spec's `1 → {2, 4, 6} → 5 → 3` notation. Within this consolidated spec the phases are renumbered to linear implementation order:

- **Phase 1 — RLS Hardening Sweep** (was Chunk 1) — foundation; lands first.
- **Phase 2 — Schema Decisions + Renames** (was Chunk 2) — parallel zone; blocks Phase 5.
- **Phase 3 — Maintenance-Job RLS Contract** (was Chunk 4) — parallel zone; independent.
- **Phase 4 — Gate Hygiene Cleanup** (was Chunk 6) — parallel zone; independent.
- **Phase 5 — Execution-Path Correctness** (was Chunk 5) — depends on Phase 2 (schema landings).
- **Phase 6 — Dead-Path Completion** (was Chunk 3) — depends on Phases 1, 2, 5; lands last.

PR merge order does NOT imply dependency order. Engineers picking up implementation branches MUST honour the order graph above per invariant 5.6.

---

## Table of contents

1. Cross-chunk invariants (companion doc reference)
2. Phase 1 — RLS Hardening Sweep
3. Phase 2 — Schema Decisions + Renames
4. Phase 3 — Maintenance-Job RLS Contract
5. Phase 4 — Gate Hygiene Cleanup
6. Phase 5 — Execution-Path Correctness
7. Phase 6 — Dead-Path Completion
8. Consolidated Open Decisions (10 HITL items across 5 phases)

---

## 1. Cross-chunk invariants (companion doc reference)

The full invariants set lives in `docs/pre-launch-hardening-invariants.md` (pinned at SHA `1cc81656`). 7 categories:

- **§ 1 — RLS contract invariants** (8 invariants).
- **§ 2 — Naming and schema invariants** (6 invariants).
- **§ 3 — Execution contract invariants** (6 invariants).
- **§ 4 — Gate expectations** (5 invariants).
- **§ 5 — Spec-vs-implementation translation rules** (6 invariants).
- **§ 6 — State / Lifecycle invariants** (5 invariants).
- **§ 7 — Cross-flow operational invariants** (7 invariants — idempotency posture, source-of-truth precedence, correlation key, status enum, retry classification, status-vs-executionStatus distinction, terminal-event guarantee + post-terminal prohibition).

Plus an **Invariant Violation Protocol** governing how violations are resolved (resolve / accept-as-directional / defer / amend).

Each phase below references the relevant invariants by number. Implementation MUST satisfy every cited invariant; deviation requires the post-freeze amendment protocol per `tasks/builds/pre-launch-hardening-specs/plan.md` § Task 6.5.

---

## 2. Phase 1 — RLS Hardening Sweep (was Chunk 1)

### 1. Goal + non-goals

#### Goal

Close every multi-tenant RLS gap in the pre-testing surface so that the testing round runs against a registry-aligned, FORCE-RLS-protected, phantom-var-free posture.

After Phase 1 lands:

- Every tenant table in the `RLS_PROTECTED_TABLES` manifest has matching `FORCE ROW LEVEL SECURITY` + `CREATE POLICY` in migrations (3-set drift = 0).
- No migration references the phantom `app.current_organisation_id` session variable.
- Every cited route / lib / service uses the principal-context helpers (no direct `db` import in `server/routes/`; no direct `db` import in `server/lib/` against tenant tables).
- The RLS gates (`verify-rls-coverage.sh`, `verify-rls-contract-compliance.sh`, `verify-rls-session-var-canon.sh`) run with their chosen posture (hard or warn — see § 4).

#### Non-goals

- **Subaccount-isolation policy reinstatement on cached-context tables.** Migration 0213 deliberately dropped DB-layer subaccount RLS for `reference_documents`, `document_bundles`, `document_bundle_attachments`, `bundle_resolution_snapshots`, `bundle_suggestion_dismissals` in favour of service-layer filters (Option B-lite). Phase 2 (CACHED-CTX-DOC) adds the architectural decision to `docs/cached-context-infrastructure-spec.md`. This spec does not reinstate the policies.
- **Principal-context propagation across `canonicalDataService` callers.** That's `S-2` / `P3-H7` and lives in Phase 4.
- **Maintenance-job admin/org tx contract.** That's `B10-MAINT-RLS` and lives in Phase 3.
- **Schema column renames / handoff_source_run_id.** Phase 2.

---

### 2. Items closed

Each item carries the owning `tasks/todo.md` line plus a verbatim ≥10-word snippet for traceability across line shifts.

#### 2.1 Already-closed items — re-asserted as invariants (verification only)

These 12 items were closed by migration 0227 (`c6f491c3 feat(phase-1): RLS hardening — migration 0227, service extractions, org-scoped write guards, subaccount resolution, gate baselines`) before Phase 1 spec authoring began. The Phase 1 PR re-asserts them as invariants in the cross-chunk invariants doc (`docs/pre-launch-hardening-invariants.md` §1.1–§1.5) and annotates each line in `tasks/todo.md` with `→ verified closed by migration 0227 (commit c6f491c3); owned by pre-launch-rls-hardening-spec`. Per-item evidence is in `tasks/builds/pre-launch-hardening-specs/chunk-1-verification-log.md` § 1.

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

#### 2.2 Truly-open items — closed by this spec's migrations

| Mini-spec ID | todo.md line | Verbatim snippet | Resolution |
|---|---|---|---|
| `P3-C5` | 840 | "P3-C5 — Phantom RLS session var `app.current_organisation_id` in migrations 0205, 0206, 0207, 0208" | New corrective migration sweeps **6 migrations** (0204, 0205, 0206, 0207, 0208, 0212 — verification log § 2 documents that 0212 was missed by the mini-spec). Each occurrence is replaced with `current_setting('app.organisation_id', true)` per the migration 0213 pattern. |
| `GATES-2026-04-26-1` | 935 (resolved B-1/B-2/B-3 follow-up note) | "REVIEW: Migration 0227 over-scope (`reference_documents` + `reference_document_versions`). RESOLVED: removed both blocks from `migrations/0227_rls_hardening_corrective.sql`; added a header note explaining 0202/0203 hardening belongs in a follow-on migration with a parent-EXISTS policy variant" | New corrective migration adds `FORCE ROW LEVEL SECURITY` to both tables. `reference_document_versions` has no `organisation_id` column; its policy uses parent-EXISTS WITH CHECK against `reference_documents.organisation_id`. |

#### 2.3 SC-1 — registry/migration drift audit

`SC-1 / SC-2026-04-26-1` is closed by the verification log's § 3 + § 4: the 3-set drift is **2** (was 60 at mini-spec time; reduced by migration 0227). Both drifting tables are covered by `GATES-2026-04-26-1` above. After Phase 1's two corrective migrations land, drift = 0.

#### 2.4 Gate-blocking decision

The mini-spec asks: "Should the RLS gate become hard-blocking (vs warn) once the registry is reconciled?" This spec recommends **hard-blocking** (see § 4.2). User adjudicates at review.

---

### 3. Items NOT closed

| What | Why deferred | Where it lives |
|---|---|---|
| Subaccount-isolation policy reinstatement on cached-context tables | Architectural decision: Option B-lite (service-layer filters) is the chosen posture per migration 0213 | Phase 2 CACHED-CTX-DOC documents the decision in `docs/cached-context-infrastructure-spec.md` |
| `S-2` / `P3-H7` Principal-context propagation across `canonicalDataService` callers | Cross-cutting service signature work; out of Phase 1 surface | Phase 4 (Gate Hygiene) |
| `B10-MAINT-RLS` Maintenance jobs admin/org tx contract | Job-layer pattern; not RLS-policy work | Phase 3 |
| `WB-1` `agent_runs.handoff_source_run_id` write-path | Schema decision; needs architect call | Phase 2 |
| Anything in mini-spec § "Explicitly out of scope" that touches RLS | Per mini-spec | Post-launch |

---

### 4. Key decisions

#### 4.1 SC-1 per-table classification — resolved

The 73 manifest entries × FORCE-RLS-coverage cross-reference produces 71 aligned + 2 manifest-only (`reference_documents`, `reference_document_versions`). The full per-table classification table lives in `tasks/builds/pre-launch-hardening-specs/chunk-1-verification-log.md` § 4. The two drifting tables are closed by `GATES-2026-04-26-1`'s migration in this spec.

**Decision: drift = 2; both addressed. Post-Chunk-1, drift = 0.**

#### 4.2 Gate-blocking posture — recommendation, awaiting user adjudication

The mini-spec leaves open: should `verify-rls-coverage.sh` and `verify-rls-contract-compliance.sh` exit with hard-block (CI fail) or warn-only when a violation is found?

**Recommendation: hard-block.** Rationale:

- Drift is 2 known-deferred tables on entry, 0 after Phase 1 lands. The false-positive rate is essentially zero.
- Pre-production posture (per `docs/spec-context.md:14`): no users, no live data. The cost of a CI failure during testing is negligible.
- The cost of a latent fail-open RLS gap during the testing round is high — it poisons every test-data assumption built on top of it.
- The gate is the primary mechanism enforcing invariants 1.1 and 1.2 (manifest registration mandatory; three-layer fail-closed isolation).

**Implementation:** the existing scripts already exit non-zero on violation; the change is to wire them as required CI checks rather than informational. Add to `package.json` test scripts and CI workflow per the standard verification-command convention in `CLAUDE.md`.

**Open question routed to user for adjudication at PR review** (see § Review Residuals below): confirm hard-block, or specify warn-only with a re-evaluation date.

#### 4.3 Phantom-var sweep scope — drift discovered

Mini-spec named migrations 0205, 0206, 0207, 0208 (4 migrations). Verification log § 2 found **6 active uses across 6 migrations** — adds 0204 (which the mini-spec also owns by listing as part of the cached-context surface) and 0212 (which the mini-spec missed entirely).

**Decision:** the corrective migration sweeps all 6. Audit trail in the verification log § 2.

#### 4.4 Reference-documents parent-EXISTS policy shape

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

### 5. Files touched

#### New migrations (the only code-side artefacts in Phase 1)

| File | Purpose |
|---|---|
| `migrations/0228_phantom_var_sweep.sql` (or next available number — verify before commit) | Replaces every active `current_setting('app.current_organisation_id', true)` with `current_setting('app.organisation_id', true)` across migrations 0204, 0205, 0206, 0207, 0208, 0212. Strategy: `DROP POLICY IF EXISTS ...` then re-create with the canonical var. Idempotent re-run. |
| `migrations/0229_reference_documents_force_rls_parent_exists.sql` (or next available) | Adds `FORCE ROW LEVEL SECURITY` to both `reference_documents` and `reference_document_versions`; the latter uses parent-EXISTS WITH CHECK per § 4.4. |

#### Manifest / config

`server/config/rlsProtectedTables.ts` — both `reference_documents` (line 472) and `reference_document_versions` (line 478) entries are updated to point at the new `policyMigration` value (the new corrective migrations) and have their `rationale` text updated to note the parent-EXISTS shape for `reference_document_versions`.

#### CI / gate wiring (subject to § 4.2 adjudication)

If hard-blocking is approved:

- `package.json` — add `verify:rls` script chaining `verify-rls-coverage.sh` + `verify-rls-contract-compliance.sh` + `verify-rls-session-var-canon.sh`.
- CI workflow file (TBD per repo convention) — promote the `verify:rls` step from informational to required.

#### No server / lib / route / service changes

The 12 already-closed items in § 2.1 require **no code changes** — they are already correct on `main`. The Phase 1 PR re-asserts them as invariants in `docs/pre-launch-hardening-invariants.md` (already done in Task 0.6 — pinned at `cf2ecbd0`).

#### Documentation updates

- `tasks/todo.md` — annotate the 14 cited items per § 8 below.
- `tasks/builds/pre-launch-hardening-specs/progress.md` — mark Task 1 complete; record Phase 1 PR URL.

---

### 6. Implementation Guardrails

#### MUST reuse

From `docs/spec-context.md § accepted_primitives`:

- `withOrgTx` / `getOrgScopedDb` / `withAdminConnection` (`server/middleware/orgScoping.ts`, `server/instrumentation.ts`) — three-layer fail-closed isolation entry points.
- `RLS_PROTECTED_TABLES` manifest (`server/config/rlsProtectedTables.ts`) — single source of truth for tenant-isolated tables. New entries land in the same migration that creates the policy.
- `verify-rls-coverage.sh` + `verify-rls-contract-compliance.sh` (`scripts/gates/`) — CI gates that enforce manifest coverage and direct-DB-access prohibition.
- `verify-rls-session-var-canon.sh` — bans the phantom `app.current_organisation_id` (per invariant 1.3).
- `rls.context-propagation.test.ts` (`server/services/__tests__/`) — integration test harness for Layer B RLS default-deny posture.
- Migration 0213's pattern for the phantom-var sweep — it is the documented precedent for the corrective approach.
- Migration 0227's pattern for FORCE RLS + CREATE POLICY in one block — it is the documented precedent for tenant-table hardening.

#### MUST NOT introduce

- New service layers when `withOrgTx` / `getOrgScopedDb` / `withAdminConnection` fit (per `convention_rejections` in `docs/spec-context.md:73`).
- A new "RlsService" or similar wrapper. The three-layer model is the architecture; new wrappers contradict invariant 1.1.
- Any new RLS session variable beyond the five canonical ones in invariant 1.3.
- Subaccount-isolation policies on the cached-context tables — Option B-lite is the chosen posture per migration 0213 (invariant 1.6).
- Vitest / Jest / Playwright / Supertest tests (per `docs/spec-context.md § convention_rejections`).

#### Known fragile areas

- **Migration ordering on the phantom-var sweep.** The `DROP POLICY IF EXISTS` + `CREATE POLICY` shape must reference the exact policy names from migrations 0204–0212. Audit each name from the source migration file before writing the corrective.
- **Parent-EXISTS subquery cost on `reference_document_versions`.** The policy runs the EXISTS subquery on every row read. The table is small (~thousands of rows expected) and the subquery hits an indexed FK, but if a future feature drives heavy `reference_document_versions` access, monitor query plans.
- **`reference_documents` has 0 dummy data today.** The policy is added to a near-empty table; tests cannot easily exercise it. Rely on the `rls.context-propagation.test.ts` harness pattern.

---

### 7. Test plan

Per `docs/spec-context.md § testing posture` (`runtime_tests: pure_function_only`, `static_gates_primary`):

#### Static gates (primary)

- `verify-rls-coverage.sh` — must pass with the new manifest entries pointing at the new corrective migrations.
- `verify-rls-contract-compliance.sh` — must pass.
- `verify-rls-session-var-canon.sh` — must pass; no remaining `app.current_organisation_id` active uses (comments excluded).
- `migrations/` `npm run db:generate` — must succeed; new migration files have a valid header and follow the established naming convention.

#### Runtime test (pure-function, existing harness)

- `server/services/__tests__/rls.context-propagation.test.ts` — extend the existing test loop to cover `reference_documents` and `reference_document_versions`. The test asserts:
  - With `app.organisation_id` unset, both tables return zero rows (default-deny).
  - With `app.organisation_id` set to org A, only org A rows are visible.
  - The parent-EXISTS variant on `reference_document_versions` still hides versions belonging to org B's parent documents when the session is set to org A.

No new test files. No supertest. No e2e.

#### Sanity grep checklist (manual, run before PR)

```bash
## Active phantom-var uses (expect zero after sweep)
grep -nE "current_organisation_id" migrations/*.sql | grep -vE "^migrations/[^:]+:--"

## Direct db imports in routes (expect zero)
grep -nE "^import.*\bdb\b" server/routes/*.ts

## Direct db imports in lib against tenant tables (expect zero — ignore lib/orgScopedDb.ts which legitimately exports the tenant-aware accessor)
grep -nE "^import.*\bdb\b" server/lib/**/*.ts | grep -v "lib/orgScopedDb.ts"

## Manifest entries referencing reference_documents (expect new policyMigration value)
grep -A1 "tableName: 'reference_document" server/config/rlsProtectedTables.ts
```

---

### 8. Done criteria

- [ ] New corrective migration `0228_phantom_var_sweep.sql` (or next available number) lands; `verify-rls-session-var-canon.sh` passes; no active uses of `app.current_organisation_id` remain (comments-only references retained for historical context).
- [ ] New corrective migration `0229_reference_documents_force_rls_parent_exists.sql` (or next available) lands; both `reference_documents` and `reference_document_versions` have `FORCE ROW LEVEL SECURITY`; the parent-EXISTS policy on the versions table is in place.
- [ ] `server/config/rlsProtectedTables.ts` updated for both tables (new `policyMigration` value + rationale tweak).
- [ ] `rls.context-propagation.test.ts` extended to cover both tables; passes.
- [ ] `tasks/todo.md` annotated for all 14 cited items per § 8 (12 closed-by-0227, 2 closed-by-this-spec).
- [ ] Gate-blocking decision (§ 4.2) adjudicated by user; if hard-block approved, CI wiring lands in this PR.
- [ ] SC-1 3-set drift = 0 (verification log § 3 + § 4 update notes the post-Chunk-1 state).
- [ ] PR body links the verification log + this spec; test plan checked off in PR template.

---

### 9. Rollback notes

The two corrective migrations are reversible per the project's standard `_down.sql` pattern (or the `db:rollback` workflow if that's the convention — verify before commit):

- **`0228_phantom_var_sweep.sql` rollback:** restore the original phantom var in each affected migration. This is a no-op for runtime correctness because the phantom var was already silently fail-open; it just restores the pre-sweep state.
- **`0229_reference_documents_force_rls_parent_exists.sql` rollback:** drop the new `FORCE` and the new policies; the underlying `ENABLE ROW LEVEL SECURITY` from 0202/0203 remains.

If the gate-blocking promotion is reverted (i.e. the user wants to back out of hard-block), the rollback is a `package.json` script + CI workflow revert; no DB impact.

---

### 10. Deferred Items

None for Phase 1.

The verification log § 2 surfaced one mini-spec drift that this spec absorbs (migration 0212 was missed; sweep extends to it). No remaining deferrals.

Items in mini-spec § "Explicitly out of scope" that touch RLS (e.g. observability of RLS policy evaluation, cross-org analytics RLS) remain post-launch by the mini-spec's framing; they are not deferred *from* this spec — they were never in scope.

---

### 11. Review Residuals

_(Populated by user adjudication at PR review. Per `tasks/builds/pre-launch-hardening-specs/progress.md` § Workflow deviations, the `spec-reviewer` agent is skipped; this section captures the user's directional + HITL calls instead.)_

#### HITL decisions (user must answer)

- **Gate-blocking posture (§ 4.2):** confirm hard-block (recommended) or specify warn-only with re-evaluation date.

#### Directional uncertainties (explicitly accepted tradeoffs)

- **Phantom-var sweep migration approach.** This spec uses `DROP POLICY IF EXISTS` + `CREATE POLICY` with the canonical var rather than per-policy `ALTER POLICY` statements (which Postgres does not directly support for `USING` / `WITH CHECK` rewrites). The drop-and-recreate approach is mechanically equivalent and matches migration 0213's precedent. Accepted; not flagging.
- **Tests added in `rls.context-propagation.test.ts` extension.** The test posture is `pure_function_only`; this is an integration test against a Postgres instance, but it's an *existing* test harness named in `docs/spec-context.md § accepted_primitives` — extending it is not introducing a new test category. Accepted.

#### Not adjudicated by `spec-reviewer`

Per workflow deviation in progress.md, `spec-reviewer` was skipped for this spec. The user reviews directly. Cadence-bypass means this PR is reviewed alongside Phases 3 and 4 in a batch.

---

### 12. Coverage Check

Every bullet in the mini-spec § "Phase 1 — RLS Hardening Sweep" `Items` block is mapped to the section of this spec that closes it. An unchecked box blocks merge.

#### Mini-spec Items (verbatim)

- [x] `P3-C1` `P3-C2` `P3-C3` `P3-C4` — 4 tables missing FORCE RLS — **addressed in § 2.1** (verified closed by migration 0227).
- [x] `P3-C5` — phantom RLS session var across migrations 0205/0206/0207/0208 — **addressed in § 2.2 + § 4.3** (corrective migration; sweep extends to 0204 and 0212 per verification log § 2).
- [x] `P3-C6..C9` — 4 routes import `db` directly — **addressed in § 2.1** (verified closed by migration 0227 service extractions).
- [x] `P3-C10` — `documentBundleService` queries agents/tasks without orgId — **addressed in § 2.1** (verified closed).
- [x] `P3-C11` — `skillStudioService` queries skills without orgId — **addressed in § 2.1** (verified closed).
- [x] `P3-H2` — `briefVisibility.ts` direct `db` import — **addressed in § 2.1** (verified closed).
- [x] `P3-H3` — `onboardingStateHelpers.ts` direct `db` import — **addressed in § 2.1** (verified closed).
- [x] `SC-1` (`SC-2026-04-26-1`) — 60-table delta — **addressed in § 2.3 + § 4.1** (drift reduced to 2 by migration 0227; remaining 2 closed by GATES-2026-04-26-1 in this spec).
- [x] `GATES-2026-04-26-1` — `reference_documents` / `_versions` FORCE RLS via parent-EXISTS WITH CHECK — **addressed in § 2.2 + § 4.4** (corrective migration with parent-EXISTS policy on the versions table).

#### Mini-spec Key decisions (verbatim)

- [x] **For `SC-1`: which of the 60 tables are tenant-scoped vs system tables?** — **addressed in § 4.1 + verification log § 4** (full per-table classification; 71 aligned, 2 manifest-only — both subject to GATES-2026-04-26-1).
- [x] **Should the RLS gate become hard-blocking (vs warn) once the registry is reconciled?** — **addressed in § 4.2** (recommendation: hard-block; routed to user for adjudication).

#### Final assertion

- [x] **No item from mini-spec § "Phase 1 — RLS Hardening Sweep" is implicitly skipped.** Every cited item appears in either § 2.1 (closed by 0227, verified) or § 2.2 (truly open, closed by this spec's migrations). Both Key decisions are addressed in § 4. Out-of-scope items are listed explicitly in § 3.

#### Mini-spec done criteria — mapped to this spec's § 8

- [x] "Zero `import { db } from` in `server/routes/`" — verified clean by sanity-grep checklist in § 7; no code change needed.
- [x] "Every tenant table has FORCE RLS + valid policies; gate enforces hard." — closed by Phase 1's two corrective migrations + § 4.2 hard-block recommendation.
- [x] "SC-1 registry == migrations == code expectations (3-set drift = 0)." — closed by GATES-2026-04-26-1 migration; verification log § 4 documents the post-Chunk-1 state.

---

## 3. Phase 2 — Schema Decisions + Renames (was Chunk 2)

### 1. Goal + non-goals

#### Goal

Lock in the schema column shapes and table-name decisions that block Riley Wave 1 today, plus close the BUNDLE-DISMISS-RLS unique-key drift and document the cached-context Option B-lite RLS posture (CACHED-CTX-DOC). After Phase 2 lands:

- `safety_mode` exists on `workflow_runs` as a separate column from `run_mode`.
- `subaccount_agents.portal_default_safety_mode` exists for the portal-default resolution path.
- `system_skills.side_effects` exists as a top-level boolean column.
- `automations.input_schema` / `output_schema` validation is wired with `ajv` + JSON Schema draft-07.
- `agent_runs.handoff_source_run_id` write-path is implemented (both columns set on handoff runs).
- `bundle_suggestion_dismissals` unique key includes `organisation_id`.
- `docs/cached-context-infrastructure-spec.md` documents Option B-lite RLS posture as a first-class architectural decision.
- Heartbeat gate Rule 3 ("Check now") is dropped from v1.
- "Meaningful output" definition is pinned.
- DELEG-CANONICAL — `delegation_outcomes` is canonical for analytics.
- W1-6 + W1-29 already closed by surrounding work; spec re-asserts and annotates.

#### Non-goals

- Implementing the heartbeat gate itself (Riley Wave 1 deliverable).
- Implementing the portal UI surface for `portal_default_safety_mode` (Wave 2/3).
- Backfilling existing `system_skills` rows with `side_effects` per-skill (separate seed-script pass).
- Migrating `agentActivityService.getRunChain` and trace-session ID logic to read `handoffSourceRunId` instead of `parentRunId` (post-launch refactor).
- Anything in mini-spec § "Out of scope".

---

### 2. Items closed

#### 2.1 Already-closed items — verified state on 2026-04-26

These 2 items were closed by surrounding work between mini-spec authoring and Phase 2 spec authoring. The Phase 2 PR re-asserts them as invariants (already covered by invariants 2.1 and 2.2) and annotates `tasks/todo.md` with `→ verified closed; owned by pre-launch-schema-decisions-spec`.

| Mini-spec ID | todo.md line | Verified state (2026-04-26) |
|---|---|---|
| `W1-6` | 646 | Migration `0222_rename_automations_columns.sql` exists with all three `RENAME COLUMN` statements. `server/db/schema/automations.ts` declares `automationEngineId`, `parentAutomationId`, `systemAutomationId`. No legacy column-name references in `server/services/automationService.ts`. **CLOSED.** |
| `W1-29` | 647 | `server/workflows/` directory exists with `event-creation.workflow.ts`, `intelligence-briefing.workflow.ts`, `weekly-digest.workflow.ts`. No `*.playbook.ts` files remain in `server/`. **CLOSED.** |

#### 2.2 Truly-open items — closed by this spec

The 10 remaining items are addressed via the architect resolutions in § 4. Each cites the architect output's section and the verbatim ≥10-word snippet from `tasks/todo.md`.

| Mini-spec ID | todo.md line | Resolution (architect output § n) |
|---|---|---|
| `F6` | 503 | § 1 — keep split (`safety_mode` separate from `run_mode`) |
| `F10` | 504 | § 2 — `subaccount_agents.portal_default_safety_mode` adopted |
| `F11` | 505 | § 3 — top-level `system_skills.side_effects boolean DEFAULT true` |
| `F15` | 506 | § 4 — ajv + JSON Schema draft-07 + permissive `additionalProperties` |
| `F21` | 507 | § 5 — drop Rule 3 from v1; ship 3-rule heartbeat gate |
| `F22` | 508 | § 6 — `status='completed' AND (action OR memory write)` |
| `WB-1` | 637 | § 7 — populate both `handoffSourceRunId` AND `parentRunId` |
| `DELEG-CANONICAL` | 332 | § 8 — `delegation_outcomes` is canonical |
| `BUNDLE-DISMISS-RLS` | 480 | § 11 — extend unique index to `(org, user, hash)` + service onConflict update |
| `CACHED-CTX-DOC` | 491 | § 12 — `docs/cached-context-infrastructure-spec.md` § RLS amendment |

---

### 3. Items NOT closed

| What | Why deferred | Where it lives |
|---|---|---|
| Heartbeat gate implementation | Riley Wave 1 deliverable; Phase 2 only authors the column decisions | Riley Wave 1 spec |
| Portal UI for `portal_default_safety_mode` | Wave 2/3 deliverable | Riley Wave 2/3 spec |
| `system_skills.side_effects` backfill from markdown | Separate seed-script pass | Riley §6.4 audit follow-up |
| `agentActivityService.getRunChain` migration to `handoffSourceRunId` | Cross-cutting consumer migration; ships dead-code in trace-session derivation if rushed | Post-launch refactor |
| `agent_runs` Drizzle self-reference FK restoration | TS-inference wall is documented at `agent_runs.ts:219-225`; FK lives in migration only | Linked to AGENT-RUNS-SPLIT in mini-spec § Out of scope |
| Empty-schema validation behaviour for `automations.input_schema` (treat empty/null as "no schema") | Architect Open Decision; spec body confirms | § Open Decisions / Review Residuals |

---

### 4. Key decisions (per architect output)

The architect resolution document at `tasks/builds/pre-launch-hardening-specs/architect-output/schema-decisions.md` (commit SHA `d5dc0b78`) is the authoritative source for each decision below. This section gives a one-paragraph summary plus a pointer to the architect output's section. Spec implementation MUST follow the architect's resolution; deviation requires a re-pin per invariant 5.5.

#### 4.1 F6 — `safety_mode` vs `run_mode` (architect § 1)

**Decision:** keep the split. New `workflow_runs.safety_mode text NOT NULL DEFAULT 'explore'` column. Existing `run_mode` (`auto|supervised|background|bulk`) stays. The two dimensions are orthogonal.

#### 4.2 F10 — Portal run-mode column name (architect § 2)

**Decision:** add `subaccount_agents.portal_default_safety_mode text NOT NULL DEFAULT 'explore'` in the same migration as F6. Resolution order in `resolveSafetyMode`: parentRun → request → portal default → agent default → `'explore'` literal (5-step ladder).

#### 4.3 F11 — `side_effects` storage (architect § 3)

**Decision:** top-level `system_skills.side_effects boolean NOT NULL DEFAULT true` with backfill from markdown frontmatter at seed time. Default `true` (safe) per Riley §6.4.

#### 4.4 F15 — `input_schema` validator (architect § 4)

**Decision:** ajv (existing primitive) + JSON Schema draft-07 + permissive `additionalProperties` default (don't inject `false`). Best-effort skip on parse/compile failure per Riley §5.4.

#### 4.5 F21 — Rule 3 "Check now" (architect § 5)

**Decision:** drop Rule 3 from v1. Heartbeat gate ships with 3 rules (renumbered 1/2/3 from former 1/2/4). Riley spec body amendment required.

#### 4.6 F22 — "Meaningful" output (architect § 6)

**Decision:** `agent_run.status = 'completed' AND (action_proposed_count >= 1 OR memory_block_written_count >= 1)`. Pure helper `computeMeaningfulOutputPure()` + tx-coherent terminal-state hook in `agentRunFinalizationService.ts`.

#### 4.7 WB-1 — `handoff_source_run_id` write-path (architect § 7)

**Decision:** populate BOTH `handoffSourceRunId` AND `parentRunId` for handoff runs. Spawn runs: `parentRunId` only. Both-cause runs: distinct values per invariant 1.3 of the hierarchical-delegation spec. Two file changes: `agentExecutionService.ts:179, 395-412` + `agentScheduleService.ts:115-134`.

#### 4.8 DELEG-CANONICAL — Canonical truth (architect § 8)

**Decision:** `delegation_outcomes` is canonical for "what was attempted and what was the outcome." `agent_runs` telemetry columns are per-run snapshots for joins. Future analytics consumers read from `delegation_outcomes`.

#### 4.9 W1-6 — Verified closed (architect § 9)

Migration 0222 + Drizzle schema already aligned. Spec annotates `tasks/todo.md` and re-asserts as invariant 2.1.

#### 4.10 W1-29 — Verified closed (architect § 10)

`server/workflows/` directory + `*.workflow.ts` files already in place. Spec annotates `tasks/todo.md` and re-asserts as invariant 2.2.

#### 4.11 BUNDLE-DISMISS-RLS — Unique-key vs RLS (architect § 11)

**Decision:** extend unique index to `(organisation_id, user_id, doc_set_hash)` (3-column). Service-side change at `documentBundleService.ts:378` updates `onConflictDoUpdate` target to match the new unique key. New corrective migration drops the 2-column index, adds the 3-column index. Drizzle schema at `server/db/schema/bundleSuggestionDismissals.ts:28` updates the `uniqueIndex` declaration. Spec amendment to `docs/cached-context-infrastructure-spec.md` §5.12 documents the multi-org dismissal semantics.

#### 4.12 CACHED-CTX-DOC — Option B-lite documentation (architect § 12)

**Decision:** add a § "RLS Posture (Option B-lite)" subsection to `docs/cached-context-infrastructure-spec.md` documenting: (1) why DB-layer subaccount RLS is intentionally not enforced on the cached-context tables; (2) which code paths are the authority (service-layer subaccount filters); (3) what triggers reinstating the policies (real cross-subaccount data leak signal post-launch); (4) how future cached-context tables register (must add a header comment naming Option B-lite OR opt-in to DB-layer subaccount RLS in their migration).

---

### 5. Files touched

#### Modified

| File | Change |
|---|---|
| `server/db/schema/workflowRuns.ts` | Add `safetyMode` column (F6) |
| `server/db/schema/subaccountAgents.ts` | Add `portalDefaultSafetyMode` column (F10) |
| `server/db/schema/systemSkills.ts` | Add `sideEffects` column (F11) |
| `server/db/schema/bundleSuggestionDismissals.ts` | Update unique-index declaration to 3-column (BUNDLE-DISMISS-RLS) |
| `server/services/agentExecutionService.ts` | `AgentRunRequest` accepts `handoffSourceRunId`; INSERT path populates it (WB-1); `resolveSafetyMode` extends with portal-default step (F10); thread `safetyMode` into workflow-run INSERT (F6) |
| `server/services/agentScheduleService.ts` | Handoff worker passes `handoffSourceRunId: data.sourceRunId` to `executeRun()` (WB-1) |
| `server/services/agentRunFinalizationService.ts` | Terminal-state hook computes `isMeaningful` and updates `subaccount_agents.last_meaningful_tick_at` (F22) |
| `server/services/systemSkillService.ts` | `createSystemSkill` / `updateSystemSkill` accept `sideEffects` (F11) |
| `server/services/invokeAutomationStepService.ts` | Pre-dispatch validation hook calls `validateInputAgainstSchema` (F15) |
| `server/services/invokeAutomationStepPure.ts` | Add `validateInputAgainstSchema` helper using ajv (F15) |
| `server/services/documentBundleService.ts:378` | Update `onConflictDoUpdate` target to include `organisationId` (BUNDLE-DISMISS-RLS) |
| `docs/cached-context-infrastructure-spec.md` | Add § "RLS Posture (Option B-lite)" subsection (CACHED-CTX-DOC) |
| `docs/cached-context-infrastructure-spec.md` §5.12 | Amend to clarify multi-org dismissal semantics (BUNDLE-DISMISS-RLS) |
| `docs/riley-observations-dev-spec.md` §4.8 column inventory | Add `safety_mode` and `portal_default_safety_mode` to inventory (F6, F10) |
| `docs/riley-observations-dev-spec.md` §6.6 resolveSafetyMode | Update 4-step ladder to 5-step (F10) |
| `docs/riley-observations-dev-spec.md` §7.4 / §7.5 | Drop Rule 3 from heartbeat gate; renumber (F21) |
| `docs/riley-observations-dev-spec.md` §7.6 / §12.17 | Pin "meaningful" definition (F22) |

#### Created

| File | Purpose |
|---|---|
| New migration in Riley sequence (next available number — 0223+) | `ALTER TABLE workflow_runs ADD COLUMN safety_mode...`; `ALTER TABLE subaccount_agents ADD COLUMN portal_default_safety_mode...`; `ALTER TABLE system_skills ADD COLUMN side_effects...` plus matching `_down` reversals (F6, F10, F11) |
| New corrective migration | `DROP INDEX ... bundle_suggestion_dismissals_user_doc_set_uq; CREATE UNIQUE INDEX ... ON bundle_suggestion_dismissals (organisation_id, user_id, doc_set_hash);` plus `_down` (BUNDLE-DISMISS-RLS) |
| `server/services/__tests__/agentExecutionServicePure.test.ts` (extension) | Pure tests for handoff-run INSERT mapping (WB-1) |
| `server/services/__tests__/invokeAutomationStepPure.test.ts` (extension) | Pure tests for ajv validation (F15) |
| `server/services/__tests__/computeMeaningfulOutputPure.test.ts` | Pure tests for "meaningful" definition (F22) |

#### Untouched (verified-closed scope)

- `migrations/0222_rename_automations_columns.sql` (W1-6 already done)
- `server/db/schema/automations.ts` (W1-6 already declares new column names)
- `server/workflows/*.workflow.ts` (W1-29 already done)

---

### 6. Implementation Guardrails

#### MUST reuse

- `ajv` (existing primitive) — F15 validator.
- Existing `Ajv` singleton instance pattern from `agent_execution_events` validator.
- `withOrgTx` / `getOrgScopedDb` for any tenant-scoped writes.
- `actionService.proposeAction` audit trail for action-proposal counting (F22).
- Existing migration `_down.sql` convention.

#### MUST NOT introduce

- A new "SchemaValidator" service. The pure helper `validateInputAgainstSchema` lives in `invokeAutomationStepPure.ts` per architect § 4.
- A new "MeaningfulOutputCalculator" service. The pure helper `computeMeaningfulOutputPure` is co-located.
- New `Ajv` configuration variants beyond the singleton with `strict: false`.
- A `safety_mode` value beyond `'explore' | 'execute'`.
- Changes to `agent_runs` Drizzle self-reference FK (per architect § 7 Open sub-question — preserves the TS-inference wall).
- Vitest / Jest / Playwright / Supertest tests (per `convention_rejections`).

#### Known fragile areas

- **Migration ordering.** F6/F10/F11 schema additions land in a single migration to keep the schema-decisions PR atomic. BUNDLE-DISMISS-RLS migration is a separate corrective. WB-1 has no migration (column already exists).
- **`handoff_source_run_id` Drizzle FK.** Per architect § 7, Open sub-question — DO NOT add `.references()` to the Drizzle schema. The FK lives in migration 0216 only; the Drizzle inference wall is documented at `agent_runs.ts:219-225`.
- **`onConflictDoUpdate` target update for BUNDLE-DISMISS-RLS.** The change at `documentBundleService.ts:378` must include all three columns in the conflict target. Mismatch with the new unique index causes runtime errors.
- **Riley spec body amendments.** Many §4.6 of "Files touched" entries are Riley spec edits, not Phase 2 code edits. Coordinate at consistency sweep (Task 6.6) so the Riley author and Phase 2 implementation don't collide.

---

### 7. Test plan

Per `docs/spec-context.md § testing posture` (`runtime_tests: pure_function_only`, `static_gates_primary`):

#### Pure unit tests (per architect output)

1. **`agentExecutionServicePure.test.ts` (extension)** — for `runSource === 'handoff'`, request maps both `parentRunId` and `handoffSourceRunId` to `data.sourceRunId`. For `runSource === 'spawn'`, only `parentRunId` is set. (WB-1 per architect § 7.)
2. **`invokeAutomationStepPure.test.ts` (extension)** — parseable+valid → `{ ok: true }`; parseable+invalid → `{ errors: [...] }`; unparseable → skip (best-effort posture). (F15 per architect § 4.)
3. **`computeMeaningfulOutputPure.test.ts` (new)** — five cases: status≠completed → false; completed+0+0 → false; completed+1+0 → true; completed+0+1 → true; completed+many+many → true. (F22 per architect § 6.)
4. **`bundleSuggestionDismissalsPure.test.ts` (or service-level pure helper)** — the `onConflictDoUpdate` target call signature uses 3 columns; collision on 2-column subset does NOT trigger the upsert path. (BUNDLE-DISMISS-RLS per architect § 11.)

#### Static gates

- `verify-rls-coverage.sh` → must pass after the BUNDLE-DISMISS-RLS index update (manifest entry unchanged; index change is a corrective).
- `verify-rls-contract-compliance.sh` → must pass.
- TypeScript build → must pass (`AgentRunRequest` extension, schema column additions surface all callers).
- `npm run db:generate` → migration files validate.
- Sanity grep before commit:
  - `grep -nE "safetyMode|safety_mode" server/db/schema/workflowRuns.ts` → 1+ matches.
  - `grep -nE "portalDefaultSafetyMode|portal_default_safety_mode" server/db/schema/subaccountAgents.ts` → 1+ matches.
  - `grep -nE "sideEffects|side_effects" server/db/schema/systemSkills.ts` → 1+ matches.
  - `grep -nE "handoffSourceRunId" server/services/agentExecutionService.ts` → 2+ matches (interface + INSERT).
  - `grep -nE "organisation_id.*user_id.*doc_set_hash" server/db/schema/bundleSuggestionDismissals.ts` → 1 match.

#### No new test categories

No vitest, jest, playwright, supertest, frontend tests, or e2e per `docs/spec-context.md § convention_rejections`. Pure tests only.

---

### 8. Done criteria

- [ ] F6: `safetyMode` column on `workflow_runs`; declared in Drizzle; migration adds column with default `'explore'`.
- [ ] F10: `portalDefaultSafetyMode` column on `subaccount_agents`; same migration as F6.
- [ ] F11: `sideEffects` column on `system_skills`; default `true`; same migration as F6/F10.
- [ ] F15: ajv validator helper in `invokeAutomationStepPure.ts`; called from pre-dispatch path; pure tests pass.
- [ ] F21: Riley spec amended to drop Rule 3; rule renumbered.
- [ ] F22: `computeMeaningfulOutputPure` exists; terminal-state hook updated; pure tests pass.
- [ ] WB-1: `AgentRunRequest` accepts `handoffSourceRunId`; INSERT path populates it; handoff worker passes it through; pure tests pass.
- [ ] DELEG-CANONICAL: spec body amends `docs/canonical-data-platform-roadmap.md` (or wherever DELEG-CANONICAL lives) with the canonical-truth declaration; future analytics consumers cite it.
- [ ] BUNDLE-DISMISS-RLS: corrective migration drops 2-column index, adds 3-column index; service `onConflictDoUpdate.target` updated; pure test passes.
- [ ] CACHED-CTX-DOC: `docs/cached-context-infrastructure-spec.md` § "RLS Posture (Option B-lite)" subsection added with all 6 architect-named points.
- [ ] W1-6: `tasks/todo.md:646` annotated `→ verified closed by migration 0222 + Drizzle schema; owned by pre-launch-schema-decisions-spec`.
- [ ] W1-29: `tasks/todo.md:647` annotated similarly.
- [ ] All sanity-grep checks pass.
- [ ] All static gates pass.
- [ ] PR body links spec + architect output (commit `65494c88`); test plan checked off.

---

### 9. Rollback notes

- F6/F10/F11 migration: revert via the matching `_down.sql` (drops columns). Code revert restores pre-Chunk-2 state. No data loss (columns are new; default values harmlessly disappear).
- BUNDLE-DISMISS-RLS migration: revert via `_down.sql` (re-adds 2-column index, drops 3-column). Service code revert restores pre-Chunk-2 onConflict target.
- WB-1: file revert restores `parentRunId`-only INSERT. Existing handoff runs in-flight retain their `parentRunId` value; new handoff runs lose `handoffSourceRunId` population. No data corruption.
- F15 ajv validator: file revert removes the helper; pre-dispatch validation reverts to no-validation (existing behaviour).
- F22 meaningful-output hook: file revert restores existing terminal-state behaviour. `last_meaningful_tick_at` stops advancing per the new rule; reverts to whatever the pre-existing rule was.
- F21 Riley spec amendment: revert via doc revert. Rule 3 re-appears in the heartbeat gate spec body; implementation status of the rule is independent.
- DELEG-CANONICAL: doc revert. No code impact.
- CACHED-CTX-DOC: doc revert. No code impact.

No DB data loss in any rollback path. No cross-tenant exposure risks (BUNDLE-DISMISS-RLS rollback briefly restores the 2-column unique-key drift, but RLS still scopes reads).

---

### 10. Deferred Items

- **`agentActivityService.getRunChain` migration to read `handoffSourceRunId`.** Cross-cutting consumer migration; ships dead-code in trace-session derivation if rushed. Trigger to revisit: the WB-1 implementation reveals a runtime bug in handoff-chain rendering that the existing `parentRunId` consumer misses. Resolution: post-launch refactor.
- **`agent_runs` Drizzle self-reference FK restoration.** Architect § 7 Open sub-question — TS-inference wall is documented at `agent_runs.ts:219-225`. Trigger to revisit: AGENT-RUNS-SPLIT (mini-spec § Out of scope) or a TypeScript version that handles self-references better.
- **Backfill `system_skills.side_effects` from markdown frontmatter.** Architect § 3 Open sub-question — separate seed-script pass post-migration. Trigger to revisit: any audit shows DB rows out-of-sync with markdown.
- **Empty-string input schema handling.** Architect § 4 Open sub-question — treat `inputSchema === '' || inputSchema === null` as "no schema" → skip validation. Confirmed in spec body but flagged as a directional uncertainty.

---

### 11. Review Residuals

_(Populated by user adjudication at PR review. `spec-reviewer` agent skipped per `tasks/builds/pre-launch-hardening-specs/progress.md § Workflow deviations`.)_

#### HITL decisions (user must answer)

- **F6 — default for legacy `workflow_runs` rows.** Architect recommends leaving at the new `'explore'` default for safety; alternative is backfill to `'execute'`. Pre-launch posture says no live data, so the recommendation should be safe. User confirms.
- **F10 — Inheritance precedence.** 5-step ladder (parentRun → request → portal default → agent default → 'explore' literal). Architect recommendation; user confirms or amends.
- **F22 — "Action proposed but rejected" counted as meaningful.** Architect recommends yes (the proposal itself is the meaningful signal). User confirms.

#### Directional uncertainties (explicitly accepted tradeoffs)

- **F11 — Default `true` (safe).** Architect picks safe-mode default; Riley §6.4 line 1046 supports it. Accepted.
- **F15 — Permissive `additionalProperties` default.** Architect picks permissive over strict for friction-light pre-launch authoring. Accepted; if production posture later wants strict, that's a Phase-2 spec amendment.
- **F21 — Drop Rule 3 entirely vs preserve as no-op.** Architect picks drop. Accepted; alternative would ship dead code.
- **WB-1 — Both columns set on handoff runs (backward-compat).** Architect picks vs. clearing `parentRunId` for handoff runs. Cross-cutting consumer migration deferred. Accepted.
- **F15 ajv compile cache scope.** Module-scoped Map without LRU. Architect notes pre-launch <100 automations per org makes unbounded fine. Accepted; cap if scale signal emerges.

---

### 12. Coverage Check

#### Mini-spec Items (verbatim)

- [x] `F6` / §6.3 / §12.25 — `safety_mode` vs pre-existing `run_mode` collision — **addressed in § 4.1 (architect § 1)**.
- [x] `F10` / §6.8 / §12.13 — Portal run-mode field unnamed — **addressed in § 4.2 (architect § 2)**.
- [x] `F11` / §6.4 / §12.22 — `side_effects` runtime storage — **addressed in § 4.3 (architect § 3)**.
- [x] `F15` / §5.4–§5.5 / §12.23 — `input_schema` / `output_schema` validator + format — **addressed in § 4.4 (architect § 4)**.
- [x] `F21` / §7.4 / §12.16 — Rule 3 "Check now" trigger — **addressed in § 4.5 (architect § 5)**.
- [x] `F22` / §7.6 / §12.17 — Definition of "meaningful" output — **addressed in § 4.6 (architect § 6)**.
- [x] `WB-1` — `agent_runs.handoff_source_run_id` write-path — **addressed in § 4.7 (architect § 7)**.
- [x] `DELEG-CANONICAL` — canonical truth — **addressed in § 4.8 (architect § 8)**.
- [x] `W1-6` — Verified closed — **addressed in § 2.1 + § 4.9 (architect § 9)**.
- [x] `W1-29` — Verified closed — **addressed in § 2.1 + § 4.10 (architect § 10)**.
- [x] `BUNDLE-DISMISS-RLS` — unique-key vs RLS — **addressed in § 4.11 (architect § 11)**.
- [x] `CACHED-CTX-DOC` — Option B-lite documentation — **addressed in § 4.12 (architect § 12)**.

#### Mini-spec Key decisions (verbatim)

- [x] **F6 / F10 / F11: 3 architect calls; resolves migration 0205 blockers** — **addressed in § 4.1, 4.2, 4.3**.
- [x] **WB-1: do we reuse `parentRunId` or split into a dedicated handoff edge?** — **addressed in § 4.7** (both columns, backward-compat).
- [x] **DELEG-CANONICAL: pick one truth or document the contract that keeps them aligned** — **addressed in § 4.8**.

#### Final assertion

- [x] **No item from mini-spec § "Phase 2 — Schema Decisions + Renames" is implicitly skipped.** Every cited item appears in either § 2.1 (verified closed) or § 4 (decision pinned via architect output). All 3 Key decisions are addressed in § 4.

#### Mini-spec done criteria — mapped to this spec's § 8

- [x] "All ambiguous columns have names + types." — § 8 first 3 checkboxes (F6/F10/F11 columns).
- [x] "Migration 0205 unblocked." — § 8 first 3 checkboxes (the same migration carries all three; renamed to next available number per architect).
- [x] "Drizzle schema, SQL migrations, and code all use the new names." — § 8 W1-6 + W1-29 verified-closed annotations + sanity-grep.
- [x] "W1-6 grep-clean." — § 8 W1-6 annotation; verification pass already confirmed grep-clean state.

---

## 4. Phase 3 — Maintenance-Job RLS Contract (was Chunk 4)

### 1. Goal + non-goals

#### Goal

Mirror the `server/jobs/memoryDedupJob.ts` admin/org tx contract in three maintenance jobs that currently use direct `db` access and silently no-op against RLS-protected tables:

- `server/jobs/ruleAutoDeprecateJob.ts`
- `server/jobs/fastPathDecisionsPruneJob.ts`
- `server/jobs/fastPathRecalibrateJob.ts`

After Phase 3 lands, the three jobs execute their intended writes under the same admin-context-then-per-org-tx pattern, so test memory state isn't garbage when the testing round runs.

#### Non-goals

- Adding new functionality to any job. The fix is purely about routing existing reads/writes through the principal-context helpers.
- Changing the schedule, retry posture, or job registration. Phase 3 does not touch `server/services/queueService.ts` or worker registration.
- Touching `memoryDedupJob.ts`. It already follows the contract.
- Adding a generic "maintenance job framework" or shared helper. Per `docs/spec-context.md § convention_rejections`, "do not introduce new service layers when existing primitives fit" — `withAdminConnection` + `withOrgTx` already are the framework.

---

### 2. Items closed

#### 2.1 B10-MAINT-RLS — maintenance jobs bypass admin/org tx contract

| Field | Value |
|---|---|
| Mini-spec ID | `B10` (mini-spec coined `B10-MAINT-RLS`) |
| `tasks/todo.md` line | 349 |
| Verbatim snippet (≥10 words) | "B10 — maintenance jobs bypass the admin/org tx contract (architectural)." |
| Verified by | `grep -nE "withAdminConnection\|withOrgTx\|^import.*\bdb\b" server/jobs/<job>.ts` for each of the 3 jobs |
| Verified state (2026-04-26) | All 3 jobs import `db` directly at the top of file; none call `withAdminConnection`. The reference pattern in `memoryDedupJob.ts` calls `withAdminConnection` at line 24 and uses the inner tx parameter. |
| Resolution in this spec | Refactor each job to: enumerate orgs inside `withAdminConnection({ source: '<job-source>' })` with `SET LOCAL ROLE admin_role`, then wrap each per-org iteration in `withOrgTx({ organisationId: org.id, source: '<job-source>' })`. |

The 3 jobs and their authoritative state:

- **`server/jobs/ruleAutoDeprecateJob.ts:43`** — currently `import { db } from '../db/index.js'`. Reads/writes `memory_blocks` (RLS-protected per manifest line 169).
- **`server/jobs/fastPathDecisionsPruneJob.ts:7`** — currently `import { db } from '../db/index.js'`. Reads/writes `fast_path_decisions` (RLS-protected per manifest line 439).
- **`server/jobs/fastPathRecalibrateJob.ts:9`** — currently `import { db } from '../db/index.js'`. Reads/writes `fast_path_decisions` (RLS-protected per manifest line 439).

Without `app.organisation_id` set, every SELECT against `memory_blocks` and `fast_path_decisions` returns zero rows per org, so the jobs are silent no-ops. The fix mirrors `memoryDedupJob.ts` lines 14, 24, 63.

---

### 3. Items NOT closed

| What | Why deferred | Where it lives |
|---|---|---|
| Other maintenance jobs that may also bypass the contract | Phase 3 is scoped to the 3 jobs the mini-spec named; broader audit is out of scope | Future audit-runner pass |
| Job-schedule changes / retry tuning | Not part of the contract; not in mini-spec | Post-launch ops backlog |
| Generic "withMaintenanceTx" helper | Per `convention_rejections` — existing primitives fit | Not a deferral, a non-goal |
| Wiring `agent_runs.is_test_run` exclusion in these jobs (P3-L9) | Separate todo; cost-ledger surface, not RLS contract | `tasks/todo.md:903` (P3-L9), separate effort |

---

### 4. Key decisions

**None architectural.** The mini-spec explicitly states "Key decisions: none — contract already exists in `memoryDedupJob`." This spec inherits that.

The only choice is the per-job `source: '<job-source>'` string for `withAdminConnection` and `withOrgTx`. Following `memoryDedupJob.ts` precedent, the convention is `<job-name-kebab-case>`:

- `ruleAutoDeprecateJob` → `source: 'rule-auto-deprecate'`
- `fastPathDecisionsPruneJob` → `source: 'fast-path-decisions-prune'`
- `fastPathRecalibrateJob` → `source: 'fast-path-recalibrate'`

These strings flow into the audit log emitted by `withAdminConnection` per `architecture.md` § 1360. Mechanical decision — not architectural.

---

### 5. Files touched

#### Modified

| File | Change |
|---|---|
| `server/jobs/ruleAutoDeprecateJob.ts` | Replace direct `db` access with `withAdminConnection` (org enumeration) + per-org `withOrgTx`. Mirror `memoryDedupJob.ts` shape. |
| `server/jobs/fastPathDecisionsPruneJob.ts` | Same pattern. |
| `server/jobs/fastPathRecalibrateJob.ts` | Same pattern. |

#### Created

| File | Purpose |
|---|---|
| `server/jobs/__tests__/ruleAutoDeprecateJobPure.test.ts` (or co-located by repo convention) | Pure unit test asserting that the per-org tx contract is invoked and the job's write logic runs against the org-scoped tx parameter. |
| `server/jobs/__tests__/fastPathDecisionsPruneJobPure.test.ts` | Same. |
| `server/jobs/__tests__/fastPathRecalibrateJobPure.test.ts` | Same. |

The 3 pure tests follow the existing pure-test convention. They do **not** require a real Postgres instance — they assert the wrapper call shape with mocks for `withAdminConnection` / `withOrgTx`. Per `docs/spec-context.md`: `runtime_tests: pure_function_only`.

#### Untouched (non-goals confirmed)

- `server/jobs/memoryDedupJob.ts` — already correct.
- `server/services/queueService.ts` — job registration unchanged.
- `server/lib/adminDbConnection.ts` / `server/middleware/orgScoping.ts` — primitives unchanged.

---

### 6. Implementation Guardrails

#### MUST reuse

From `docs/spec-context.md § accepted_primitives`:

- `withAdminConnection` (`server/lib/adminDbConnection.ts`) — admin-context entry point that sets `SET LOCAL ROLE admin_role` and logs to `audit_events`.
- `withOrgTx` (`server/middleware/orgScoping.ts`) — per-org tx helper that sets `app.organisation_id`.
- `getOrgScopedDb` (only inside the per-org callback) — Drizzle handle bound to the current `withOrgTx`.
- `memoryDedupJob.ts` lines 14, 24, 63 — the precedent shape. Copy structure; do not invent variants.

#### MUST NOT introduce

- A new wrapper function over `withAdminConnection`/`withOrgTx`. Mirror the precedent inline in each job.
- A new "MaintenanceJobBase" class or interface.
- Any signature change to `withAdminConnection` or `withOrgTx`.
- Vitest / Jest / Playwright / Supertest tests (per `convention_rejections`). Pure tests only.
- Changes to which orgs the jobs iterate over. The `SELECT id FROM organisations` enumeration in `memoryDedupJob.ts` is the precedent; adopt it verbatim unless a job has a documented filter requirement (none of the 3 do per their current code).

#### Known fragile areas

- **Row-decay arithmetic in `ruleAutoDeprecateJob`.** The job currently computes deprecation candidates against `memory_blocks` directly. The refactor must preserve the exact decay arithmetic (cutoff timestamps, `last_used_at` semantics) — it just runs it inside the per-org tx. Audit each query before-and-after by diffing the SQL string output.
- **Idempotency on `fastPathDecisionsPruneJob`.** Pruning is destructive (DELETE). Confirm the per-org tx wrapping does not change the `WHERE` predicate in a way that causes double-deletes on retry. The pure test covers the retry path.
- **`fastPathRecalibrateJob` UPDATE shape.** The recalibration reads + writes `fast_path_decisions`. Ensure the read happens inside the same `withOrgTx` block as the write so RLS scope is preserved across the read-then-write.

---

### 6.5 Pre-implementation hardening (execution-safety contracts)

Folded in 2026-04-26 from external review feedback. Each item is a hard requirement for the implementation PR.

#### 6.5.1 Per-org error isolation (REQUIRED) + sequential processing (REQUIRED)

**Problem 1 (error isolation).** "Mirror `memoryDedupJob`" leaves error-isolation behaviour implicit. Failure mode: one org's per-org callback throws → entire job aborts → other orgs not processed.

**Problem 2 (backpressure).** Without an ordering rule, a future "optimisation" might run orgs in parallel, where one large org dominates connection-pool capacity or a slow org delays the rest unevenly.

**Idempotency posture (per invariant 7.1):** `state-based` (each per-org operation is idempotent against the org's data; re-running the job recomputes from current state without producing duplicates).

**Retry classification (per invariant 7.5):** `safe` (operations are idempotent against current data; pg-boss retry on failure is acceptable).

**Retry semantics (per invariant 7.1):** retry → safe; the per-org operation is idempotent. If the job runner retries the entire job, all orgs are re-processed; outcomes are deterministic from the current data.

**Contract.**

- **Sequential per-org processing REQUIRED.** Jobs MUST iterate orgs serially in v1. No `Promise.all` over the org list; no worker-fan-out. Justification: predictable connection-pool usage; no large-org-blocks-others starvation; easier to reason about per-org error isolation. If post-launch traffic shows the sequential approach is too slow, parallelisation is a separate spec amendment with explicit per-org concurrency limit.
- **Per-org try/catch boundary REQUIRED.** Each `withOrgTx` invocation is wrapped in a try/catch. A throw inside org A's callback is caught, logged, and the loop continues to org B.
- **Failure logging REQUIRED.** On per-org failure, emit structured log: `{ event: '<job-source>.org_failed', orgId, error, errorClass }` (where `errorClass` is one of `tx_failure | logic_failure | unknown`).
- **Continue iteration REQUIRED.** Per-org throw never aborts the job. The job's overall completion status is `partial_with_errors` if any org failed; `success` if all orgs succeeded; `failed` only if the admin-connection acquire itself failed (precedes any org iteration).
- **Outcome counters REQUIRED.** Job emits `{ event: '<job-source>.completed', orgsAttempted, orgsSucceeded, orgsFailed, durationMs }` at end of run regardless of mixed outcomes.

**Reference contract in `memoryDedupJob.ts`** — confirm at implementation time that `memoryDedupJob` follows the sequential + per-org-isolation pattern; if it does not, this spec's behaviour is the new reference and `memoryDedupJob` should be updated to match in a follow-up.

#### 6.5.2 No-silent-partial-success per job

Per invariant 7.4, every job emits an explicit terminal `status: 'success' | 'partial' | 'failed'` field in its final observability event AND in the pg-boss completion result. No implicit success-by-absence.

- **`status: 'success'`:** all orgs processed without throw; emitted rows match expected shape.
- **`status: 'partial'`:** ≥1 org threw, ≥1 org succeeded → per-failed-org log emitted; outcome counters reflect mix; pg-boss job marked complete (NOT failed) with the partial result body.
- **`status: 'failed'`:** admin-connection acquire fails OR org enumeration query fails → nothing processed; pg-boss job marked failed; standard pg-boss retry policy applies.

Source of truth (per invariant 7.2): the `<job-source>.completed` event with its outcome counters is authoritative for the job's outcome. The pg-boss `state` column is derived; if pg-boss says complete but the event says `failed`, the event wins for human triage.

#### 6.5.3 Observability hooks

For each of the 3 jobs (`<job-source>` is the kebab-case name from § 4). Per invariant 7.3, the `jobRunId` is the correlation key; every event in a single job run carries the same `jobRunId`.

Terminal event (per invariant 7.7) is `<job-source>.completed` with the discriminated `status` field. Every job run emits exactly one terminal event regardless of mixed per-org outcomes.

- `<job-source>.started` (jobRunId, scheduledAt)
- `<job-source>.org_started` (jobRunId, orgId)
- `<job-source>.org_completed` (jobRunId, orgId, rowsAffected, durationMs, status: 'success')
- `<job-source>.org_failed` (jobRunId, orgId, error, errorClass, status: 'failed')
- `<job-source>.completed` (jobRunId, orgsAttempted, orgsSucceeded, orgsFailed, durationMs, status: 'success' | 'partial' | 'failed') — TERMINAL

Best-effort emission (graded-failure tier); never blocks the job.

---

### 7. Test plan

Per `docs/spec-context.md § testing posture` (`runtime_tests: pure_function_only`):

#### Pure unit tests (one per job)

For each of the 3 jobs:

1. **Wrapper-shape assertion.** With `withAdminConnection` and `withOrgTx` mocked, invoking the job's exported handler must call `withAdminConnection` exactly once with the expected `source` string, and call `withOrgTx` once per org returned by the org-enumeration query, each with the expected `organisationId` and `source`.
2. **Per-org write logic.** With the inner tx mocked, the job's per-org function must call the expected SELECT/UPDATE/DELETE shapes against the tx handle (not against the top-level `db`).
3. **Empty-org-set behaviour.** Zero orgs → zero `withOrgTx` calls; admin connection still acquired.
4. **Per-org error isolation.** A throw in org A's `withOrgTx` callback must not prevent org B's iteration. (Mirror the precedent in `memoryDedupJob.ts` if it has explicit error isolation; otherwise document the observed behaviour.)

#### Static gate

- `verify-rls-contract-compliance.sh` — must pass after the refactor. The gate currently flags direct `db` use in jobs against tenant tables (per invariant 1.5 enforcement); the refactor moves the 3 jobs from violating to compliant.
- Sanity grep before commit: `grep -nE "^import.*\bdb\b" server/jobs/{ruleAutoDeprecate,fastPathDecisionsPrune,fastPathRecalibrate}Job.ts` — must return zero.

#### No new test categories

No vitest, jest, playwright, supertest, frontend tests, or e2e per `docs/spec-context.md § convention_rejections`.

---

### 8. Done criteria

- [ ] All 3 jobs use `withAdminConnection` for org enumeration and `withOrgTx` for per-org work; direct `db` import removed from all 3.
- [ ] One pure unit test per job, each covering the 4 cases in § 7.
- [ ] `verify-rls-contract-compliance.sh` passes.
- [ ] `tasks/todo.md` line 349 annotated `→ owned by pre-launch-maintenance-job-rls-spec`.
- [ ] PR body links the spec; test plan checked off.

---

### 9. Rollback notes

Each job is reverted independently by restoring its previous direct-`db` shape from git history. No DB migration involved; the rollback is per-file `git revert` granularity. Pure tests are dropped on rollback (additive only).

If the rollback restores the silent-no-op behaviour, the practical effect on production is zero (the jobs were already no-oping under RLS); the practical effect on testing is that decay/pruning/recalibration stops running, which is the pre-Chunk-4 state.

---

### 10. Deferred Items

None for Phase 3.

The mini-spec scoped this chunk to exactly one item with no decisions. No deferrals surfaced during drafting.

---

### 11. Review Residuals

_(Populated by user adjudication at PR review. `spec-reviewer` agent skipped per `tasks/builds/pre-launch-hardening-specs/progress.md § Workflow deviations`.)_

#### HITL decisions (user must answer)

None — the contract is fixed.

#### Directional uncertainties (explicitly accepted tradeoffs)

- **Source-string convention.** § 4 picks kebab-case job names matching `memoryDedupJob`'s precedent. If the user prefers a different convention (e.g. snake_case to match existing audit-event source strings), call out at review and the implementation PR adopts it.

---

### 12. Coverage Check

#### Mini-spec Items (verbatim)

- [x] `B10-MAINT-RLS` — `ruleAutoDeprecateJob.ts`, `fastPathDecisionsPruneJob.ts`, `fastPathRecalibrateJob.ts` need to mirror the admin/org tx contract from `memoryDedupJob.ts` — **addressed in § 2.1 + § 5 (3 modified jobs + 3 pure tests)**.

#### Mini-spec Key decisions (verbatim)

- [x] **Key decisions: none — contract already exists in `memoryDedupJob`** — **addressed in § 4 (no architectural decisions; only the mechanical source-string choice)**.

#### Final assertion

- [x] **No item from mini-spec § "Phase 3 — Maintenance Job RLS Contract" is implicitly skipped.** The chunk has exactly one item; it is fully addressed.

#### Mini-spec done criteria — mapped to this spec's § 8

- [x] "All three jobs execute their intended writes under the same RLS contract as `memoryDedupJob`" — § 8 first checkbox.
- [x] "Test added per job that verifies a real row is decayed/pruned/recalibrated" — § 8 second checkbox + § 7 cases (1-4).

---

## 5. Phase 4 — Gate Hygiene Cleanup (was Chunk 6)

### 1. Goal + non-goals

#### Goal

Keep CI honest during the testing round. Verification done 2026-04-26 against `tasks/todo.md` shows ~10 of 16 cited Phase 4 items are already closed; this spec re-asserts those as invariants and addresses the 5 truly-open items in one bundled PR.

After Phase 4 lands, every gate the mini-spec lists is green or has a documented baseline; the registry-vs-reality drift the mini-spec was written against has been closed by surrounding work.

#### Non-goals

- New gates, or any new gate-style script. The 5 open items are all small touches against existing artefacts.
- Reformulating the gate framework. `scripts/verify-*.sh` is the established convention.
- Anything in mini-spec § "Out of scope" (LAEL-P1-1 emission, TEST-HARNESS, INC-IDEMPOT, etc.).

---

### 2. Items closed

#### 2.1 Already-closed items — verified state on 2026-04-26

These 11 items were closed by surrounding work between mini-spec authoring (2026-04-26) and Phase 4 spec authoring. The Phase 4 PR re-asserts them as invariants in `docs/pre-launch-hardening-invariants.md` (already covered by invariants 1.4, 1.5, 4.2) and annotates each `tasks/todo.md` line with `→ verified closed; owned by pre-launch-gate-hygiene-spec`.

| Mini-spec ID | todo.md line | Verbatim snippet | Verified state (2026-04-26) |
|---|---|---|---|
| `P3-H4` | 858 | "P3-H4 — `server/lib/playbook/actionCallAllowlist.ts` does not exist but is expected by `verify-action-call-allowlist.sh`" | File now exists at `server/lib/workflow/actionCallAllowlist.ts` (path moved from playbook/ to workflow/); gate at `scripts/verify-action-call-allowlist.sh:29` references the workflow/ path. **CLOSED.** |
| `P3-H5` | 859 | "P3-H5 — `measureInterventionOutcomeJob.ts:213-218` queries `canonicalAccounts` outside `canonicalDataService`" | `grep -nE "canonicalAccounts" server/jobs/measureInterventionOutcomeJob.ts` → no matches. **CLOSED.** |
| `P3-H6` | 860 | "P3-H6 — `server/services/referenceDocumentService.ts:7` imports directly from `providers/anthropicAdapter`" | `grep -nE "anthropicAdapter" server/services/referenceDocumentService.ts` → no matches. **CLOSED.** |
| `P3-H7` + `S-2` (partial) | 861 + 940 | "P3-H7 — 5+ files import `canonicalDataService` without `PrincipalContext` / `fromOrgId` migration shim"; "S-2 — Principal-context propagation is import-only across 4 of 5 files" | Verified call-sites: `server/services/connectorPollingService.ts:125,151` calls `fromOrgId`; `server/services/intelligenceSkillExecutor.ts` calls `fromOrgId`; `server/services/crmQueryPlanner/executors/canonicalQueryRegistry.ts:43,60,73,86` calls `fromOrgId`; `server/routes/webhooks/ghlWebhook.ts:112` calls `fromOrgId`; `server/config/actionRegistry.ts:1` carries the `@principal-context-import-only` marker explicitly documenting the design (registry references canonicalDataService only in handler-classification documentation). **CLOSED.** |
| `P3-M11` | 880 | "P3-M11 — 5 workflow skills missing YAML frontmatter" | All 5 skills (`workflow_estimate_cost.md`, `workflow_propose_save.md`, `workflow_read_existing.md`, `workflow_simulate.md`, `workflow_validate.md`) start with `---` frontmatter delimiter. **CLOSED.** |
| `P3-M12` | 881 | "P3-M12 — `scripts/verify-integration-reference.mjs` crashes with `ERR_MODULE_NOT_FOUND: 'yaml'`" | `package.json` includes `"yaml": "^2.8.3"`. **CLOSED.** |
| `P3-M15` | 863 | "P3-M15 — `canonical_flow_definitions` + `canonical_row_subaccount_scopes` missing from canonical dictionary registry" | Both tables present in `server/services/canonicalDictionary/canonicalDictionaryRegistry.ts`. `bash scripts/verify-canonical-dictionary.sh` → `PASS: verify-canonical-dictionary (all canonical tables covered)`. **CLOSED.** |
| `P3-L1` | 882 | "P3-L1 — Missing explicit `package.json` deps: `express-rate-limit`, `zod-to-json-schema`, `docx`, `mammoth`" | Verified by `package.json` grep — no flagged missing deps. **CLOSED.** |
| `S3-CONFLICT-TESTS` (`S3`) | 351 | "S3 — strengthen rule-conflict parser tests" | `server/services/__tests__/ruleConflictDetectorPure.test.ts` includes the three required cases: line 68 `'rejects conflict with unknown existingRuleId'`, line 83 `'rejects conflict with invalid conflictKind'`, line 98 `'rejects conflict with out-of-range confidence'`. **CLOSED.** |
| `S5-PURE-TEST` (`S-5`) | 947 | "S-5 — Pure unit test for `saveSkillVersion` orgId-required throw contract" | `server/services/__tests__/skillStudioServicePure.test.ts` exists and asserts `'saveSkillVersion: orgId is required for scope=org'` (verified). **CLOSED.** |
| `P3-M13` / `P3-M14` | 864, 865 | "verify-input-validation.sh WARNING — some routes may lack Zod validation"; "verify-permission-scope.sh WARNING — some permission checks incomplete" | These are warning-level gates, not failures. Live counts captured 2026-04-26: `verify-input-validation.sh = 44 violations`, `verify-permission-scope.sh = 13 violations`. Both are baselined per § 2.2 SC-COVERAGE-BASELINE; that closes the requirement to *capture* the baseline. The actual reduction work is out of scope per mini-spec ("manual scan of routes added in last 3 PRs; add Zod schemas where missing" is a separate effort). **CLOSED-AS-BASELINED.** |

#### 2.2 Truly-open items — closed by this spec

| Mini-spec ID | todo.md line | Verbatim snippet | Resolution |
|---|---|---|---|
| `P3-M10` | 879 | "P3-M10 — Skill visibility drift: `smart_skip_from_website` and `weekly_digest_gather` have visibility `internal`, expected `basic`" | Run `npx tsx scripts/apply-skill-visibility.ts` (per todo guidance), then re-run `skills:verify-visibility`. The script updates the markdown frontmatter on both skills from `visibility: internal` to `visibility: basic`. |
| `P3-M16` | 883 | "P3-M16 — `docs/capabilities.md:1001` — 'Anthropic-scale distribution' in customer-facing Non-goals section" | Manual edit at line 1001: replace `"Anthropic-scale distribution isn't the agency play."` with `"Hyperscaler-scale distribution isn't the agency play."` per the existing remediation note. |
| `S2-SKILL-MD` (`S2`) | 350 | "S2 — add skill definition .md files for `ask_clarifying_questions` and `challenge_assumptions`" | Create both `.md` files at `server/skills/ask_clarifying_questions.md` and `server/skills/challenge_assumptions.md` with YAML frontmatter matching the existing skill-file convention. The handler entries already exist in `SKILL_HANDLERS` so runtime dispatch works; the markdown definitions surface the skills in config-assistant and skill-studio UIs. |
| `RLS-CONTRACT-IMPORT` (`GATES-2`) | n/a (mini-spec coined; no labeled todo entry) | (mini-spec text only) | Update `scripts/verify-rls-contract-compliance.sh` to skip lines beginning with `import type` (or matching the `import type ... from ... db` pattern) when scanning for direct-`db` violations. Add a fixture test under `server/services/__tests__/` (or the existing gate test convention) that exercises both runtime and type-only imports — the type-only import must NOT trigger the gate. |
| `SC-COVERAGE-BASELINE` (≈`REQ #35`) | 916 | "REQ #35 — `verify-input-validation.sh` (44) and `verify-permission-scope.sh` (13) warnings (§5.7)" | Capture the baseline numbers in `tasks/builds/pre-launch-hardening-specs/progress.md` § Coverage Baseline (new section). Live counts as of 2026-04-26: `verify-input-validation.sh = 44 violations`; `verify-permission-scope.sh = 13 violations`. Future PRs touching input-validation or permission-scope must cite the baseline + delta in their PR body. |

---

### 3. Items NOT closed

| What | Why deferred | Where it lives |
|---|---|---|
| Reducing the 44 input-validation warnings to zero | Out of scope per mini-spec (`P3-M13` resolution is "manual scan ... add Zod schemas where missing" — separate effort) | Post-launch CI hygiene backlog |
| Reducing the 13 permission-scope warnings to zero | Same as above (`P3-M14`) | Post-launch CI hygiene backlog |
| All `P3-M3..M9` items (`as any` suppressions, dlqMonitorService typing, deprecated `toolCallsLog` column, handoff depth/fallback tests) | Not in mini-spec § Phase 4 | Separate audit-runner pass |
| `P3-L2..L10` | Low-priority items not in mini-spec § Phase 4 | Post-launch backlog |
| All "build-during-testing watchlist" items in mini-spec | By design — earn their value when traffic exists | Built during testing round |

---

### 4. Key decisions

**None architectural.** The mini-spec explicitly states "Key decisions: none. Pure cleanup." The 5 truly-open items are mechanical.

The only directional choice is the editorial wording for `P3-M16`: the existing remediation note in `tasks/todo.md:883` recommends `"hyperscaler-scale distribution"` or `"provider-marketplace-scale distribution"`. This spec adopts `"hyperscaler-scale distribution"` (shorter; reads cleanly in the customer-facing Non-goals section). User can override at review.

For `RLS-CONTRACT-IMPORT`, the gate update strategy is the simpler regex approach: match lines beginning with `import type` (with optional whitespace) and exclude them from the direct-`db` scan. No AST parsing — that would inflate the gate's complexity for a single feature.

---

### 5. Files touched

#### Modified

| File | Change |
|---|---|
| `server/skills/smart_skip_from_website.md` | Frontmatter `visibility:` field changes from `internal` to `basic` |
| `server/skills/weekly_digest_gather.md` | Same |
| `docs/capabilities.md:1001` | Replace `"Anthropic-scale distribution"` with `"Hyperscaler-scale distribution"` |
| `scripts/verify-rls-contract-compliance.sh` | Add `import type` line filter to the direct-`db` scan |
| `tasks/builds/pre-launch-hardening-specs/progress.md` | Add `## Coverage Baseline` section recording 44 / 13 baseline counts |

#### Created

| File | Purpose |
|---|---|
| `server/skills/ask_clarifying_questions.md` | New skill definition file. YAML frontmatter matches existing skill convention (`name`, `description`, `category`, `visibility`, `inputs`, `outputs`); body documents the skill behaviour. Handler entry already exists in `SKILL_HANDLERS`. |
| `server/skills/challenge_assumptions.md` | Same. |
| Fixture test for `RLS-CONTRACT-IMPORT` | Either a small `.test.ts` file or a fixture under `scripts/__tests__/` per repo convention. Asserts: runtime `import { db } from ...` triggers the gate; `import type { db } from ...` does NOT. |

#### Untouched (verification-only — no code change in this PR)

- `server/lib/workflow/actionCallAllowlist.ts` (P3-H4 already exists)
- `server/jobs/measureInterventionOutcomeJob.ts` (P3-H5 already correct)
- `server/services/referenceDocumentService.ts` (P3-H6 already correct)
- `server/services/connectorPollingService.ts`, `intelligenceSkillExecutor.ts`, `crmQueryPlanner/executors/canonicalQueryRegistry.ts`, `routes/webhooks/ghlWebhook.ts`, `config/actionRegistry.ts` (P3-H7 + S-2 already correct)
- 5 workflow skill `.md` files (P3-M11 already has frontmatter)
- `package.json` (P3-M12 + P3-L1 already complete)
- `server/services/canonicalDictionary/canonicalDictionaryRegistry.ts` (P3-M15 already complete)
- `server/services/__tests__/ruleConflictDetectorPure.test.ts` (S3 already covers all 3 cases)
- `server/services/__tests__/skillStudioServicePure.test.ts` (S5 already exists with the orgId-required assertion)

---

### 6. Implementation Guardrails

#### MUST reuse

- Existing skill `.md` template (any of `server/skills/*.md` — pick one with similar shape, e.g. `read_data_source.md` or another internal skill — and clone its frontmatter structure).
- `npx tsx scripts/apply-skill-visibility.ts` for P3-M10 — it's the documented remediation per `tasks/todo.md:879`.
- The existing `scripts/verify-*.sh` shell-script convention for the gate update.

#### MUST NOT introduce

- A new skill-loader / skill-registry pattern. The 2 new `.md` files use the existing convention.
- A complex AST-based gate replacement. The `import type` filter is a simple regex update.
- Any new package.json dependency.
- Vitest / Jest / Playwright / Supertest tests for the gate fixture. Per `convention_rejections`, the gate fixture is a tsx-runnable static check, matching the existing convention.

#### Known fragile areas

- **`apply-skill-visibility.ts`.** This script edits markdown frontmatter in-place. After running, `git diff server/skills/smart_skip_from_website.md server/skills/weekly_digest_gather.md` should show only the `visibility:` line changing. If the diff is broader, abort and investigate.
- **`docs/capabilities.md` editorial rule.** Per `CLAUDE.md` rule 1: "Never auto-rewrite capabilities.md." The Phase 4 PR makes a single targeted line edit; do not let any tooling reflow surrounding lines.
- **`scripts/verify-rls-contract-compliance.sh` regex.** False-positive risk: a line starting with `import type` but containing a runtime `import` later (e.g. via re-export inside the same statement). The fixture test covers this case explicitly.

---

### 7. Test plan

Per `docs/spec-context.md § testing posture` (`runtime_tests: pure_function_only`, `static_gates_primary`):

#### Static gates

- `verify-action-call-allowlist.sh` → must pass (already passing per P3-H4 verification).
- `verify-canonical-dictionary.sh` → must pass (already passing per P3-M15 verification).
- `verify-rls-contract-compliance.sh` → must pass with the new `import type` filter; fixture test asserts the filter behaves correctly.
- `npm run skills:verify-visibility` → must pass after `apply-skill-visibility.ts` runs.
- `verify-input-validation.sh` → 44 violations baseline captured in progress.md.
- `verify-permission-scope.sh` → 13 violations baseline captured in progress.md.

#### No new pure tests needed

The 3 pure-test items in mini-spec scope (S3, S5) are already closed. The new fixture for `RLS-CONTRACT-IMPORT` is a static gate test, not a pure unit test.

---

### 8. Done criteria

- [ ] `server/skills/smart_skip_from_website.md` and `weekly_digest_gather.md` have `visibility: basic` in frontmatter; `npm run skills:verify-visibility` passes.
- [ ] `docs/capabilities.md:1001` reads `"Hyperscaler-scale distribution isn't the agency play."` (or user-approved alternative).
- [ ] `server/skills/ask_clarifying_questions.md` and `server/skills/challenge_assumptions.md` exist with valid YAML frontmatter; both skills surface in config-assistant and skill-studio UIs (validated by `npm run skills:verify-visibility` pass).
- [ ] `scripts/verify-rls-contract-compliance.sh` skips `import type` lines; fixture test passes (runtime import triggers gate; type import does not).
- [ ] `tasks/builds/pre-launch-hardening-specs/progress.md` has a `## Coverage Baseline` section with `verify-input-validation.sh = 44` and `verify-permission-scope.sh = 13`.
- [ ] `tasks/todo.md` annotated for all 16 cited items per § 2.
- [ ] PR body links the spec; test plan checked off.

---

### 9. Rollback notes

Each item is reverted independently:

- Skill visibility (P3-M10) — re-run `apply-skill-visibility.ts` with the original `internal` value, or revert the markdown files.
- Capabilities edit (P3-M16) — single-line `git revert` on `docs/capabilities.md`.
- New skill `.md` files (S2-SKILL-MD) — delete; `SKILL_HANDLERS` entries are unchanged so dispatch still works (just without UI surfacing).
- Gate update (RLS-CONTRACT-IMPORT) — `git revert` on `scripts/verify-rls-contract-compliance.sh`; fixture test removed.
- Coverage baseline (SC-COVERAGE-BASELINE) — pure documentation; no rollback needed (numbers are point-in-time).

No DB impact. No service-level impact.

---

### 10. Deferred Items

None for Phase 4.

The verification-only items in § 2.1 are not deferrals — they're already complete and re-asserted as invariants. Real deferrals are routed to § 3 (Items NOT closed) and tracked separately.

---

### 11. Review Residuals

_(Populated by user adjudication at PR review. `spec-reviewer` agent skipped per `tasks/builds/pre-launch-hardening-specs/progress.md § Workflow deviations`.)_

#### HITL decisions (user must answer)

- **Capabilities.md editorial wording.** § 4 picks `"Hyperscaler-scale distribution"`. The remediation note in `tasks/todo.md:883` allows either that OR `"provider-marketplace-scale distribution"`. User confirms which at review.

#### Directional uncertainties (explicitly accepted tradeoffs)

- **`RLS-CONTRACT-IMPORT` regex approach.** § 4 picks regex over AST parsing for the gate update. Trade-off: simpler implementation, edge case where a line has both `import type` and runtime imports (covered by fixture test). Accepted; alternative is full AST parse which is overkill for one feature.
- **Baseline values are point-in-time.** § 2.2 captures `44 + 13` as of 2026-04-26. If significant other Chunk PRs land before this PR merges, the baseline may need re-capture. Accepted; the baseline-capture step is fast.

---

### 12. Coverage Check

#### Mini-spec Items (verbatim)

- [x] `P3-H4` — `server/lib/playbook/actionCallAllowlist.ts` does not exist — **addressed in § 2.1** (verified closed; file at `server/lib/workflow/actionCallAllowlist.ts`).
- [x] `P3-H5` — `measureInterventionOutcomeJob` queries `canonicalAccounts` outside service — **addressed in § 2.1** (verified closed).
- [x] `P3-H6` — `referenceDocumentService.ts` imports `anthropicAdapter` directly — **addressed in § 2.1** (verified closed).
- [x] `P3-H7` / `S-2` — propagate `PrincipalContext` through callers — **addressed in § 2.1** (verified closed across all 5 files).
- [x] `P3-M10..M16` — skill visibility drift, missing YAML, yaml dep, dictionary entries, capabilities editorial — **P3-M10 + P3-M16 in § 2.2; P3-M11/M12/M13/M14/M15 in § 2.1**.
- [x] `P3-L1` — explicit package.json deps — **addressed in § 2.1** (verified closed).
- [x] `S2-SKILL-MD` — `.md` definitions for `ask_clarifying_questions` and `challenge_assumptions` — **addressed in § 2.2**.
- [x] `S3-CONFLICT-TESTS` — strengthen rule-conflict parser tests — **addressed in § 2.1** (verified closed).
- [x] `S5-PURE-TEST` — `saveSkillVersion` pure unit test — **addressed in § 2.1** (verified closed).
- [x] `SC-COVERAGE-BASELINE` — capture pre-Phase-2 baseline counts — **addressed in § 2.2**.
- [x] `RLS-CONTRACT-IMPORT` (`GATES-2`) — gate skips `import type` lines — **addressed in § 2.2**.

#### Mini-spec Key decisions (verbatim)

- [x] **"Key decisions: none. Pure cleanup."** — **addressed in § 4 (no architectural decisions; only the editorial-wording choice for P3-M16 routed to user)**.

#### Final assertion

- [x] **No item from mini-spec § "Phase 4 — Gate Hygiene Cleanup" is implicitly skipped.** Every cited item appears in either § 2.1 (verified closed) or § 2.2 (closed by this spec). The two warning gates (P3-M13, P3-M14) are closed-as-baselined per the SC-COVERAGE-BASELINE pattern.

#### Mini-spec done criteria — mapped to this spec's § 8

- [x] "All gates green; all warning baselines captured." — § 8 first 5 checkboxes (gates green) + § 2.2 SC-COVERAGE-BASELINE (warning baselines).

---

## 6. Phase 5 — Execution-Path Correctness (was Chunk 5)

### 1. Goal + non-goals

#### Goal

Make the dispatcher and execution loops resist race conditions and contract gaps that surface only under sustained testing — close the 5 truly-open execution-path correctness items before the testing round runs.

After Phase 5 lands:

- Dispatcher boundaries re-check invalidation after every awaited I/O (invariant 3.1).
- Multi-webhook resolutions are rejected at dispatch (invariant 3.3 / W1-43 rule 4).
- `errorMessage` is threaded into memory extraction on normal-path failed runs (invariant 3.6).
- `runResultStatus = 'partial'` is decoupled from summary presence (invariant 3.5 + 6.3).
- Skill error envelope shape is one of two documented options with 100% adherence (invariant 2.4).

#### Non-goals

- Adding new step types or new dispatcher branches.
- Changing the §5.7 error vocabulary beyond what W1-38's resolution already accomplished (verified closed; see § 2.1).
- Reworking the tick loop's scheduler / queue semantics. Phase 5 stays inside the existing loop shape.
- Anything in mini-spec § "Out of scope" (LAEL-P1-1, TEST-HARNESS, etc.).

---

### 2. Items closed

#### 2.1 Already-closed items — verified state on 2026-04-26

| Mini-spec ID | todo.md line | Verbatim snippet | Verified state |
|---|---|---|---|
| `W1-44` | 649 | "REQ W1-44 — Pre-dispatch connection resolution not implemented" | `server/services/invokeAutomationStepService.ts:128` resolves `automation.requiredConnections`; missing keys fail with `code: 'automation_missing_connection'` at dispatch (lines 130–155). **CLOSED.** |
| `W1-38` | 651 | "REQ W1-38 engine-not-found — dispatcher emits `automation_execution_error`, not in §5.7 vocabulary (ambiguous)" | `grep -rE "automation_execution_error" server/` → no matches. The engine-not-found case now emits `automation_not_found` (line 95) and the engine-load-failed case emits `automation_composition_invalid` (line 162). The ambiguous code is gone. **CLOSED.** |

#### 2.2 Truly-open items — closed by this spec

| Mini-spec ID | todo.md line | Verbatim snippet | Resolution |
|---|---|---|---|
| `C4b-INVAL-RACE` | 667 | "Inline-dispatch step handlers do not re-check invalidation after awaiting external I/O" (Codex iter 3 finding #7) | Add a re-read + invalidation-check wrapper around every `*Internal` helper call that follows an `await` on external I/O in `workflowEngineService.ts`. Single helper `withInvalidationGuard(stepRunId, work)` wraps the late-write to discard if `status === 'invalidated'`. See § 4 for scope decision. |
| `W1-43` | 648 | "REQ W1-43 — Dispatcher §5.10a rule 4 defence-in-depth not implemented" | Add a pure-function assertion inside `resolveDispatch` (`server/services/invokeAutomationStepService.ts`) that verifies the automation row conforms to the single-webhook contract: exactly one non-empty `webhookPath`, no alternative webhook fields. Emits `automation_composition_invalid` on violation. |
| `HERMES-S1` | 92–105 | "§6.8 errorMessage gap on normal-path failed runs" — `agentExecutionService.ts:1350-1368` passes `errorMessage: null` into `extractRunInsights` even when `derivedRunResultStatus === 'failed'` | Thread `errorMessage` from `preFinalizeMetadata` (already in scope at line 1370) into `extractRunInsights` when the derived status is `failed`. The current code at line ~1659 explicitly says `errorMessage: null as string | null,` with a "future refactor could surface" comment — that's the resolution. |
| `H3-PARTIAL-COUPLING` | 152–171 | "H3 — `runResultStatus='partial'` coupling to summary presence" — `computeRunResultStatus` line 572 demotes `completed` → `partial` when `!hasSummary` | Per architect decision: pick option (a) separate `hasSummary` flag, OR (b) side-channel `summaryMissing=true`, OR (c) monitor-and-revisit. § 4 below recommends (b) — keep `runResultStatus` purely about task outcome; surface `summaryMissing` as a side-channel field on the run row. |
| `C4a-6-RETSHAPE` | 337 | "REQ #C4a-6 — Return-shape contract for delegation errors" — spec §4.3 mandates `{ code, message, context }`; ~40 skills return `error: <string>` | **DEPENDS ON CHUNK 2 ARCHITECT OUTPUT.** The Phase 2 architect resolves whether to grandfather the flat-string pattern or migrate to the nested envelope (per invariant 2.4). § 4 below documents both branches; the spec ships against whichever Phase 2 picks. |

---

### 3. Items NOT closed

| What | Why deferred | Where it lives |
|---|---|---|
| Adding new step types or step-run statuses | Out of scope; `shared/runStatus.ts` sets are closed per invariant 6.5 | Future spec if needed |
| Reworking the tick loop's scheduler | Out of scope; existing loop shape is preserved | Post-launch performance work |
| LAEL-P1-1, TEST-HARNESS, INC-IDEMPOT, etc. | Mini-spec § "Build-during-testing watchlist" — earn value when traffic exists | Built during testing round |
| Other execution-path issues not cited by mini-spec | Out of scope | Separate audit-runner pass |

---

### 4. Key decisions

#### 4.1 C4b-INVAL-RACE — single helper vs per-call-site (resolved inline)

**Decision: single helper `withInvalidationGuard`.**

Mini-spec poses: "scope of the invalidation re-check wrapper (one helper or per-call-site)". The single-helper approach wins because:

- DRY across the 4 internal-helper call sites (`action_call`, `agent_call`, `prompt`, `invoke_automation`).
- Mirrors the public `completeStepRun` / `completeStepRunFromReview` pattern (already centralised).
- Easier to test (one pure-function unit covers the race).
- New step types added later automatically inherit the protection.

Helper shape (in `server/services/workflowEngineService.ts`):

```typescript
async function withInvalidationGuard<T>(
  stepRunId: string,
  externalWork: () => Promise<T>,
): Promise<T | { discarded: true; reason: 'invalidated' }> {
  const result = await externalWork();
  const [sr] = await db.select().from(workflowStepRuns).where(eq(workflowStepRuns.id, stepRunId)).limit(1);
  if (sr?.status === 'invalidated') {
    return { discarded: true, reason: 'invalidated' };
  }
  return result;
}
```

Call sites: each `*Internal` helper that performs an `await` on external I/O (action_call's tool dispatch, agent_call's sub-run trigger, prompt's LLM call, invoke_automation's webhook) wraps the I/O in `withInvalidationGuard(stepRun.id, ...)`. If the result is `{ discarded: true }`, the late-write skips and the outer step state stays `invalidated`.

#### 4.2 H3-PARTIAL-COUPLING — chosen option (resolved inline)

**Decision: option (b) side-channel `summaryMissing=true`.**

Three options from `tasks/todo.md:162-170`:
- (a) Separate `hasSummary` flag column on `agent_runs` — schema change; risks invariant 2.6 (schema landings under Phase 2).
- (b) Side-channel `summaryMissing=true` — no schema change; informational field only; preserves `runResultStatus` semantics.
- (c) Monitor-and-revisit — kicks the can; conflicts with invariant 3.5 ("summary failure must not demote a successful run").

(b) wins because:

- No schema change; ships in the implementation PR without coordinating with Phase 2.
- Invariant 3.5 is closed (success runs without summaries no longer get demoted to partial).
- The side-channel field can be a key on `runMetadata` JSONB or returned only in the response shape — no DDL.

`computeRunResultStatus` signature changes to:

```typescript
export function computeRunResultStatus(
  finalStatus: string,
  hasError: boolean,
  hadUncertainty: boolean,
): 'success' | 'partial' | 'failed';
// hasSummary parameter removed; partial reachable ONLY from per-step aggregation per invariant 6.3
```

Callers that need to surface "summary missing" do so via a separate field on the response/extraction shape.

#### 4.3 C4a-6-RETSHAPE — Phase 5 owns this decision (recommendation: Branch A grandfather)

**Ownership resolution.** The cross-spec consistency sweep (Task 6.6) surfaced unowned-decision drift between Phases 2 / 5 / 6: each chunk pointed at another for the C4a-6-RETSHAPE decision. The Phase 2 architect output covered schema decisions and renames; C4a-6-RETSHAPE is an execution-path concern and lives in Phase 5. This spec now owns it.

**Recommendation: Branch A — grandfather the flat-string pattern.** Rationale:

- Pre-launch posture (`docs/spec-context.md § Architecture defaults`): rapid_evolution, prefer existing primitives, no introduce-then-defer.
- Migrating ~40 skill handlers from `error: '<code-string>'` to `error: { code, message, context }` is high-effort low-value pre-launch — every handler ships pre-launch with a minor refactor for no direct testing-round benefit.
- The 3 delegation skills (`spawn_sub_agents`, `reassign_task`, third per `tasks/todo.md:337`) bring their return shapes back to align with the legacy flat-string pattern. The amendment to `docs/hierarchical-delegation-dev-spec.md` §4.3 documents the legacy pattern as canonical for v1.
- Branch B (migrate) becomes a Phase-2 spec when explicit operator value emerges (e.g., LLM-facing serialisation needs richer error context). Trigger documented in § 10 Deferred Items.

User can override at PR review (§ Review Residuals captures this as a HITL question — recommendation flagged but not enforced).

Branches documented for completeness:

**Branch A — grandfather the flat-string pattern (RECOMMENDED):**
- No code change to ~40 existing skill handlers.
- Spec § 4.3 of `docs/hierarchical-delegation-dev-spec.md` is amended to acknowledge the legacy pattern.
- Three delegation skills (`spawn_sub_agents`, `reassign_task`, third per spec) bring their return shape into alignment with the legacy flat-string pattern.

**Branch B — migrate all skills to nested envelope (alternative):**
- All ~40 skill handlers refactor `error: '<code-string>'` to `error: { code: '<code-string>', message: '...', context: {...} }`.
- LLM-facing serialisation, agent prompt parsing, `executeWithActionAudit` audit log all updated.
- Bigger code change; bigger payoff (consistent error envelope across the platform).

Implementation PR ships against Branch A by default; if user picks Branch B at review, implementation PR scope expands.

#### 4.4 W1-43 rule 4 implementation (resolved inline)

**Decision: pure-function assertion in `resolveDispatch`.**

The current code at line 162 already validates "engine assigned" → `automation_composition_invalid`. Add a sibling check before that branch:

```typescript
function assertSingleWebhook(automation: AutomationRow): null | AutomationStepError {
  const webhookFields = [
    automation.webhookPath,
    // ...any future multi-webhook fields the spec rejects
  ].filter((v) => v != null && v !== '');
  if (webhookFields.length !== 1) {
    return {
      code: 'automation_composition_invalid',
      type: 'execution',
      message: `Automation '${automation.id}' must have exactly one outbound webhook; found ${webhookFields.length}.`,
      retryable: false,
    };
  }
  return null;
}
```

Today the schema enforces single-webhook implicitly via the `webhookPath` text column shape. The assertion catches mutated / migrated rows where the contract was violated by a non-schema path.

---

### 5. Files touched

#### Modified

| File | Change |
|---|---|
| `server/services/workflowEngineService.ts` | Add `withInvalidationGuard` helper. Wrap each `*Internal` helper's external-I/O await with the guard. |
| `server/services/invokeAutomationStepService.ts` | Add `assertSingleWebhook` pure helper. Call before engine-load (current line 162). |
| `server/services/agentExecutionService.ts` | Thread `errorMessage` from `preFinalizeMetadata` into `extractRunInsights` call (current line ~1659). Replace `errorMessage: null as string | null,` with `errorMessage: derivedRunResultStatus === 'failed' ? extractErrorMessage(preFinalizeMetadata) : null,`. |
| `server/services/agentExecutionServicePure.ts` | Refactor `computeRunResultStatus` per § 4.2: remove `hasSummary` parameter; partial reachable only from per-step aggregation. Update callers in `agentExecutionService.ts`. |
| Spec doc `docs/hierarchical-delegation-dev-spec.md` | (Branch A only — if Phase 2 picks grandfather) §4.3 amendment to acknowledge legacy flat-string pattern. |
| ~40 skill handlers in `server/services/skillExecutor.ts` and the skill modules it dispatches to | (Branch B only — if Phase 2 picks migrate) refactor each `error: '<code-string>'` return to nested envelope. Enumerate during implementation. |

#### Created

| File | Purpose |
|---|---|
| `server/services/__tests__/invalidationRaceP​ure.test.ts` (or co-located) | Pure simulation test for C4b: concurrent invalidate + dispatch result; asserts late writer hard-discards. |
| `server/services/__tests__/assertSingleWebhookPure.test.ts` | Pure test for W1-43: zero / one / multiple webhook fields. |
| `server/services/__tests__/computeRunResultStatusPure.test.ts` (or extension) | Pure test for H3 + invariant 6.3: all-completed → success; any-error → failed/partial; cancelled / skipped aggregation; summary absence does NOT demote. |
| `server/services/__tests__/extractRunInsightsErrorMessagePure.test.ts` | Pure test for HERMES-S1: failed-without-throw runs receive threaded errorMessage. |

#### Untouched (verification-only — no code change)

- `server/services/invokeAutomationStepService.ts` lines 95 (engine-not-found), 128–155 (required-connection check), 162–168 (engine-load) — verified correct per § 2.1.
- `shared/runStatus.ts` — sets are closed per invariant 6.5; no changes here.

---

### 6. Implementation Guardrails

#### MUST reuse

- `failure() + FailureReason enum` (`shared/iee/failure.ts`) for any new error path (per `accepted_primitives`).
- `shared/runStatus.ts` `TERMINAL_RUN_STATUSES` / `IN_FLIGHT_RUN_STATUSES` / `AWAITING_RUN_STATUSES` — single source of truth (invariant 6.5).
- `agentExecutionEventService` for any new event emission.
- Existing `*Internal` helper shape in `workflowEngineService.ts` — wrap, don't replace.

#### MUST NOT introduce

- New step types or new run statuses without a `runStatus.ts` update + spec amendment (invariant 6.5).
- A new "WorkflowEngineFramework" or "DispatcherBase" abstraction. The single-helper approach in § 4.1 is the framework.
- New `error_code` strings outside §5.7 vocabulary (invariant 3.4).
- Vitest / Jest / Playwright / Supertest. Pure tests only (per `convention_rejections`).
- A schema column for H3 — the side-channel option (b) deliberately avoids DDL (§ 4.2).

#### Known fragile areas

- **`withInvalidationGuard` re-read cost.** Each external-I/O await now incurs an extra SELECT on `workflow_step_runs`. The query is indexed by primary key; cost is negligible. Confirm at implementation time by EXPLAIN.
- **`computeRunResultStatus` signature change.** `hasSummary` parameter removed. Audit every caller; the typecheck will surface them. Implementation PR includes the call-site updates.
- **Branch B (skill error envelope migrate).** ~40 skills return error strings. Audit each; LLM-facing serialisation may need updates. The spec calls out this risk in § Review Residuals.

---

### 6.5 Pre-implementation hardening (execution-safety contracts)

Folded in 2026-04-26 from external review feedback.

#### 6.5.1 No-silent-partial-success per execution flow

Per invariant 7.4, every flow surfaces an explicit terminal `status: 'success' | 'partial' | 'failed'`.

- **C4b-INVAL-RACE (`withInvalidationGuard`):** **Idempotency posture (per invariant 7.1):** `state-based`. **Retry classification (per invariant 7.5):** `guarded`. Late writer that finds `status === 'invalidated'` returns `{ discarded: true, reason: 'invalidated' }` — explicit signal, NOT silent. The caller logs the discard via `step.dispatch.invalidation_discarded` (see § 6.5.2) and the run's outcome reflects the invalidation per `runStatus.ts`. Source of truth (invariant 7.2): the `workflow_step_runs.status` row is authoritative; the late writer never overwrites a terminal state.
- **W1-43 (`assertSingleWebhook`):** **Idempotency posture:** `state-based`. **Retry classification (per invariant 7.5):** `safe` (the assertion is pure; no side effects). Multi-webhook input emits `automation_composition_invalid` with the count in the message. Step transitions to `error` — never silent. Status enum: `failed`.
- **HERMES-S1 (errorMessage threading):** **Idempotency posture:** `non-idempotent (intentional)`. **Retry classification (per invariant 7.5):** `unsafe` (memory extraction has side effects in `memory_blocks`; guarded upstream by terminal-state idempotency — terminal-state transition is one-way, so the extraction fires at most once per run). Failed-without-throw runs receive the threaded `errorMessage` from `preFinalizeMetadata`; memory extraction sees a non-null value. The "silent" path the bug created (extraction skipped because errorMessage was null) is explicitly closed.
- **H3-PARTIAL-COUPLING:** **Idempotency posture:** `state-based`. **Retry classification (per invariant 7.5):** `safe` (pure computation; no side effects). `runResultStatus` reflects the per-step aggregation rule from invariant 6.3 ONLY. Summary absence is surfaced via the orthogonal `summaryMissing` side-channel field, never via `runResultStatus = 'partial'`. Both signals visible to the consumer; user-facing surface chooses which to display. Status enum mapping: `runResultStatus = 'success'` → status: 'success'; `'partial'` → 'partial'; `'failed'` → 'failed'.
- **C4a-6-RETSHAPE (Branch A):** **Idempotency posture:** `non-idempotent (intentional)`. **Retry classification (per invariant 7.5):** `unsafe` (skill handlers may have side effects; re-dispatch is governed upstream by Phase 6 § 4.5.2 optimistic guard). Every skill handler error matches the legacy flat-string shape `{ success: false, error: '<code-string>', context }`. No partial envelopes. Branch B (if user picks at review) requires every handler to match the nested shape `{ success: false, error: { code, message, context } }` — fixture test asserts.

#### 6.5.2 Observability hooks

The `agentExecutionEventService` is the canonical primitive (per invariant 6.5 / `accepted_primitives`). Per invariant 7.3, every event in a single execution chain carries the same `runId` (or `stepRunId` for step-level events). Cross-flow trace reconstruction filters on a single key.

Required emissions for the 5 closed items:

- **C4b-INVAL-RACE:** terminal event (per invariant 7.7) is `step.dispatch.completed | step.dispatch.invalidation_discarded | step.dispatch.failed`:
  - `step.dispatch.started` (runId, stepRunId, stepType)
  - `step.dispatch.completed` (runId, stepRunId, durationMs, outputBytes, status: 'success') — TERMINAL on dispatch success
  - `step.dispatch.invalidation_discarded` (runId, stepRunId, status: 'success', discarded: true) — TERMINAL when guard fires after I/O
  - `step.dispatch.failed` (runId, stepRunId, error, status: 'failed') — TERMINAL on dispatch failure
- **W1-43:**
  - `step.dispatch.composition_invalid` (runId, stepRunId, automationId, webhookCount, status: 'failed') — TERMINAL when `assertSingleWebhook` returns error (folds into the `step.dispatch.failed` family)
- **HERMES-S1:**
  - `run.terminal.extracted_with_errorMessage` (runId, errorMessageLength) — emitted ONLY when threading occurs (failed run + non-null errorMessage)
- **H3:**
  - `run.terminal.summary_missing` (runId, runResultStatus) — emitted ONLY when `summaryMissing=true` so consumers can correlate
- **C4a-6-RETSHAPE:**
  - No new emission; the existing skill-execution event already carries error envelope. Branch B implementation adds shape-validation in the emission helper if migrating.

Best-effort emission via `agentExecutionEventService` (graded-failure tier).

#### 6.5.3 Webhook timeout posture (cross-reference)

Phase 6 § 4.5.5 pins the 30-second webhook timeout + retry posture for `invokeAutomationStep`. That contract is binding for Phase 5's W1-43 / W1-44 dispatcher boundary too — the dispatcher emits `automation_webhook_timeout` (or `automation_missing_connection` for W1-44) with the same failure-classification rules. Cross-spec consistency: the timeout is implemented once in `invokeAutomationStep`, both Phases 5 + 6 cite it.

---

### 7. Test plan

#### Pure unit tests (4 files per § 5)

1. **C4b invalidation race** — set up: stepRun in `running`, simulate concurrent invalidation (mock the SELECT to return `status: 'invalidated'` after the await), assert late write returns `{ discarded: true, reason: 'invalidated' }` and the row stays `invalidated`.
2. **W1-43 single-webhook assertion** — three cases: zero webhooks (returns error), one webhook (returns null), two webhooks (returns error with `automation_composition_invalid`).
3. **H3 + invariant 6.3 aggregation** — all-completed → success; any-error → failed; cancelled aggregation; skipped aggregation; partial reachable only via per-step mix; summary absence does NOT demote.
4. **HERMES-S1 errorMessage threading** — failed run with `preFinalizeMetadata.errorMessage='X'` → `extractRunInsights` receives `errorMessage: 'X'`. Failed run with no errorMessage → null. Success run → null regardless.

#### Static gates

- `verify-rls-contract-compliance.sh` → must pass (no direct `db` use changes).
- TypeScript build → must pass (signature change for `computeRunResultStatus` surfaces all callers).
- Sanity grep before commit: `grep -rE "automation_execution_error" server/` → must remain zero (W1-38 closed).

#### Branch A vs Branch B test deltas

If Phase 2 picks **Branch B** (migrate skill error envelope):
- Add a fixture-based test that iterates the registered skill handlers and asserts every error return matches the nested `{ code, message, context }` shape.

If Phase 2 picks **Branch A** (grandfather):
- No additional test; `docs/hierarchical-delegation-dev-spec.md` §4.3 amendment is the deliverable.

---

### 8. Done criteria

- [ ] `withInvalidationGuard` helper present in `workflowEngineService.ts`; all 4 internal-helper external-I/O awaits wrapped.
- [ ] `assertSingleWebhook` present in `invokeAutomationStepService.ts`; called before engine-load; emits `automation_composition_invalid` on violation.
- [ ] `agentExecutionService.ts` line ~1659 threads `errorMessage` from `preFinalizeMetadata` for failed-without-throw runs.
- [ ] `computeRunResultStatus` no longer accepts `hasSummary`; partial reachable only via per-step aggregation; all callers updated.
- [ ] C4a-6-RETSHAPE: implementation matches whichever branch (A or B) Phase 2 architect picked.
- [ ] 4 pure unit tests per § 5 land green.
- [ ] `tasks/todo.md` annotated for all 7 cited items per § 8.
- [ ] PR body links the spec; test plan checked off.

---

### 9. Rollback notes

- `withInvalidationGuard` — additive helper; rollback via `git revert`. Internal helpers fall back to no re-check.
- `assertSingleWebhook` — additive; rollback restores pre-check behaviour (schema still enforces single-webhook implicitly).
- HERMES-S1 errorMessage threading — single-line diff at line 1659; rollback restores `errorMessage: null`.
- H3 `computeRunResultStatus` signature change — bigger blast radius (every caller). Rollback restores `hasSummary` parameter; partial-from-no-summary returns. Acceptable because pre-Chunk-5 state is the current production state.
- C4a-6-RETSHAPE Branch A: spec doc revert. Branch B: ~40 file revert; bigger lift.

No DB migrations involved.

---

### 10. Deferred Items

None for Phase 5.

The 5 truly-open items in § 2.2 are all closed; the 2 verified-closed items in § 2.1 require no spec action; the C4a-6-RETSHAPE branching is documented in § 4.3 but blocks on Phase 2.

---

### 11. Review Residuals

_(Populated by user adjudication at PR review. `spec-reviewer` agent skipped per `tasks/builds/pre-launch-hardening-specs/progress.md § Workflow deviations`.)_

#### HITL decisions (user must answer)

- **C4a-6-RETSHAPE branch.** Confirm Phase 2 architect picked Branch A (grandfather flat-string) or Branch B (migrate to nested envelope). Implementation cannot start the C4a-6-RETSHAPE work until this is locked.

#### Directional uncertainties (explicitly accepted tradeoffs)

- **H3 option choice.** § 4.2 picks option (b) side-channel. Trade-off: rejected option (a) schema-flag (cleaner long-term but introduces DDL during a chunk that explicitly avoids schema work) and option (c) monitor-and-revisit (kicks the can; conflicts with invariant 3.5). Accepted; if option (a) is preferred, the spec is amended and Phase 2 picks up the schema column.
- **C4b single-helper scope.** § 4.1 picks single helper over per-call-site. Trade-off: rejected per-call-site as noisier and harder to audit. Accepted.

---

### 12. Coverage Check

#### Mini-spec Items (verbatim)

- [x] `C4b-INVAL-RACE` — re-check invalidation after I/O in `workflowEngineService.ts` tick switch — **addressed in § 2.2 + § 4.1 (single helper)**.
- [x] `W1-43` — dispatcher §5.10a rule 4 defence-in-depth in `invokeAutomationStepService.ts:165-166` — **addressed in § 2.2 + § 4.4 (assertSingleWebhook)**.
- [x] `W1-44` — pre-dispatch `required_connections` resolution; fail at dispatch — **addressed in § 2.1 (verified closed)**.
- [x] `W1-38` — add `automation_execution_error` to §5.7 error vocabulary (spec + code align) — **addressed in § 2.1 (verified closed; ambiguous code removed)**.
- [x] `HERMES-S1` — thread `errorMessage` from `preFinalizeMetadata` into `agentExecutionService.ts:1350-1368` — **addressed in § 2.2 + § 5 modified files**.
- [x] `H3-PARTIAL-COUPLING` — decouple `runResultStatus='partial'` from summary presence — **addressed in § 2.2 + § 4.2 (option b side-channel)**.
- [x] `C4a-6-RETSHAPE` — skill handler error envelope: spec mandates `{code, message, context}`; ~40 skills return flat string — **addressed in § 2.2 + § 4.3 (branching depends on Phase 2 architect)**.

#### Mini-spec Key decisions (verbatim)

- [x] **C4a-6-RETSHAPE: grandfather or migrate. Either way, spec must reflect reality** — **addressed in § 4.3 (both branches documented; routed to user via § Review Residuals)**.
- [x] **C4b: scope of the invalidation re-check wrapper (one helper or per-call-site)** — **addressed in § 4.1 (single helper picked with rationale)**.

#### Final assertion

- [x] **No item from mini-spec § "Phase 5 — Execution-Path Correctness" is implicitly skipped.** Every cited item appears in either § 2.1 (verified closed) or § 2.2 (closed by this spec). Both Key decisions are addressed in § 4.

#### Mini-spec done criteria — mapped to this spec's § 8

- [x] "Race-condition test for C4b passes (concurrent invalidate + dispatch result)" — § 7 test 1.
- [x] "W1-43/44 enforced at dispatcher boundary with tests" — § 7 test 2 (W1-43); W1-44 already verified closed.
- [x] "HERMES-S1 verified by failed-run-without-throw test extracting memory" — § 7 test 4.
- [x] "Skill error envelope contract is one of two documented options and 100% adherent" — § 4.3 (both branches) + § 7 (Branch B fixture if migrating).

---

## 7. Phase 6 — Dead-Path Completion (was Chunk 3)

### 1. Goal + non-goals

#### Goal

Wire up the four silently-dead write paths the product surfaces today, so the testing round runs against a fully-functional Brief approval flow, conversation-follow-up agent-run path, rule-drafting endpoint, and post-approval automation dispatch.

After Phase 6 lands:

- BriefApprovalCard's approve/reject buttons end-to-end functional with execution record linkage (DR3).
- Follow-up messages in any Brief surface re-invoke fast-path or Orchestrator via `classifyChatIntent` (DR2).
- `POST /api/rules/draft-candidates` returns 200 with valid `candidates[]` payload (DR1).
- Approved review-gated `invoke_automation` steps actually dispatch their webhook (C4a-REVIEWED-DISP).

#### Non-goals

- Adding follow-up re-invocation for non-Brief scopes (`task`, `agent_run`). Per DR2 architect resolution: explicitly excluded; those surfaces don't currently enqueue orchestration; adding them is a new feature.
- Async post-approval dispatch. C4a-REVIEWED-DISP architect resolution picks Option A (synchronous resume) for v1; pg-boss enqueue is a documented Deferred Item.
- Skill error envelope migration. DR1 uses the legacy flat `{ error: string }` matching `rules.ts` precedent; envelope migration is bound to Phase 5 C4a-6-RETSHAPE.

---

### 2. Items closed

All 4 cited items are truly open (verified 2026-04-26 — no surrounding work has closed any of them):

| Mini-spec ID | todo.md line | Verbatim snippet | Resolution |
|---|---|---|---|
| `DR3` | 371 | "DR3 — wire approve/reject actions on `BriefApprovalCard` artefacts" | New `briefApprovalService.decideBriefApproval()` + new POST route + superseding-artefact pattern. See § 4.1. |
| `DR2` | 370 | "DR2 — re-invoke fast-path + Orchestrator on follow-up conversation messages" | `classifyChatIntent` gate on follow-ups; `simple_reply` skips Orchestrator; non-Brief scopes excluded; shared `handleBriefMessage()` helper extracted. See § 4.2. |
| `DR1` | 369 | "DR1 — add `POST /api/rules/draft-candidates` route" | New POST handler in `server/routes/rules.ts` with `authenticate + requireOrgPermission(BRIEFS_WRITE)`. Calls `ruleCandidateDrafter.draftCandidates(...)`. See § 4.3. |
| `C4a-REVIEWED-DISP` | 665 | "Review-gated `invoke_automation` steps never dispatch after approval" | Option A — dedicated resume path. New `WorkflowEngineService.resumeInvokeAutomationStep()`; `decideApproval` routes `invoke_automation` step type to it instead of `completeStepRun`. See § 4.4. |

Verified state on 2026-04-26:

- DR1: `grep "draft-candidates" server/routes/rules.ts` → no matches. Route still missing.
- DR2: `briefConversationService.ts` has no `classifyChatIntent` call; only `briefCreationService.ts` does. Follow-ups still one-way.
- DR3: `client/src/components/brief-artefacts/ApprovalCard.tsx` exists; `onApprove`/`onReject` not wired (per mini-spec).
- C4a-REVIEWED-DISP: `server/services/workflowRunService.ts:537 decideApproval` → calls `completeStepRun` at lines 503, 581 unconditionally; no step-type-aware routing.

---

### 3. Items NOT closed

| What | Why deferred | Where it lives |
|---|---|---|
| Follow-up re-invocation for non-Brief scopes (`task`, `agent_run` conversations) | Architect explicitly excludes; those surfaces don't currently enqueue orchestration; new feature | Post-launch feature backlog |
| Async post-approval dispatch (pg-boss enqueue) | v1 picks synchronous resume; webhooks typically <30s | `## Deferred Items` § 10 below |
| Skill error envelope migration in `rules.ts` | Bound to Phase 5 C4a-6-RETSHAPE branch decision | Phase 5 spec § 4.3 |
| Conversation-level rate limiting (DR2 spam protection) | Architect-flagged open question | `## Open Decisions` (§ Review Residuals) |
| Brief-approval second-tier human approval (high-risk action chain) | Architect recommends single-gate | `## Open Decisions` (§ Review Residuals) |

---

### 4. Key decisions (per architect output)

Each decision below is a verbatim distillation of the architect's resolution document at `tasks/builds/pre-launch-hardening-specs/architect-output/dead-path-completion.md`. The architect SHA `6bbbd737` is pinned in front-matter; any amendment of that file requires re-pinning per invariant 5.5.

#### 4.1 DR3 — BriefApprovalCard approve/reject

- **Route:** `POST /api/briefs/:briefId/approvals/:artefactId/decision`. Body: `{ decision: 'approve' | 'reject', reason?: string }`.
- **Dispatch:** New `briefApprovalService.decideBriefApproval()` composing `actionService.proposeAction` (accepted primitive). **Synchronous** — not pg-boss.
- **Execution-record linkage:** Superseding artefact via `writeConversationMessage` using existing `parentArtefactId` chain. No new `brief_approvals` table.
- **Client refresh:** 200 response carries the superseding artefact for in-place state patch; WS event `brief.artefact.updated` covers other tabs.

#### 4.2 DR2 — Conversation follow-up → agent run

- **Trigger:** `classifyChatIntent` gate on every follow-up.
- **Passive acks:** `simple_reply` route produces inline artefacts; skips Orchestrator. `FILLER_RE` regex inside the classifier handles dedupe.
- **Non-Brief scopes:** explicitly excluded.
- **Refactor:** Extract shared `handleBriefMessage()` helper from `briefCreationService.createBrief` and reuse from the follow-up path in `briefConversationService`.

#### 4.3 DR1 — POST /api/rules/draft-candidates

- **Location:** `server/routes/rules.ts` (extends existing rules router).
- **Guards:** `authenticate` + `requireOrgPermission(BRIEFS_WRITE)`.
- **Logic:** org-scoped JSONB scan for artefactId → validate `kind === 'approval'` → load `tasks.description` for `briefContext` → call `listRules({ orgId, ... })` (top 20) → call `ruleCandidateDrafter.draftCandidates(...)`.
- **Error envelope:** flat `{ error: string }` matching existing `rules.ts` pattern. Aligns with Phase 5 C4a-6-RETSHAPE Branch A recommendation (grandfather flat-string); see Phase 5 spec § 4.3. If user picks Branch B at review, Phase 5 + Phase 6 ship together against nested envelope.

#### 4.4 C4a-REVIEWED-DISP — Post-approval invoke_automation dispatch

**Option A — dedicated resume path.**

- New `WorkflowEngineService.resumeInvokeAutomationStep()`:
  1. Re-read step row + invalidation check (per invariant 6.4 — depends on Phase 5's `withInvalidationGuard` helper).
  2. Transition `review_required` → `running`.
  3. Re-invoke `invokeAutomationStep()` with original step params.
  4. On success: `completeStepRunInternal` with real webhook output.
  5. On failure: emit `automation_*` per § 5.7 vocabulary; transition to `error`.

- `WorkflowRunService.decideApproval` extends to detect `stepType === 'invoke_automation'` in approved branch and route to the new resume path instead of `completeStepRun`.

Satisfies invariants 3.1, 6.1, 6.2, 6.4.

---

### 4.5 Pre-implementation hardening (execution-safety contracts)

This section pins execution-safety contracts that the architect output left implicit. Folded in 2026-04-26 from external review feedback. Each item is a hard requirement for the implementation PR; missing any of them is a directional finding for the post-merge review.

#### 4.5.1 DR3 idempotency contract

**Problem.** Architect § 1 doesn't pin idempotency behaviour. Failure modes: double-click approve → duplicate `proposeAction` calls; network retry → duplicate dispatch; concurrent approvals → race.

**Idempotency posture (per invariant 7.1):** `key-based`.

**Retry classification (per invariant 7.5):** `safe` (idempotent against the partial unique index).

**Retry semantics (per invariant 7.1):** retry of identical decision → HTTP 200 idempotent return (same response shape). Different decision for same artefact → HTTP 409.

**First-commit-wins rule (concurrent different decisions).** When two simultaneous requests carry different decisions for the same `artefactId` (e.g. Request A: approve, Request B: reject hitting the partial unique index in the same instant), the **first commit wins** (FIFO at the database level, decided by the partial unique index's serialisation). The losing request returns HTTP 409 with the winning decision attached. There is **no deterministic preference** between approve and reject — neither outcome is privileged. This rule prevents future "business logic override" attempts (e.g. "if approve and reject race, approve wins") from being added without a deliberate spec amendment.

**Classification clarification (idempotent-hit vs conflict).** Both `brief.approval.idempotent_hit` (HTTP 200) and `brief.approval.conflict` (HTTP 409) are non-mutating terminal outcomes. The semantic distinction:

- **idempotent_hit (`status: 'success'`):** the same decision was already recorded; the system honoured the user's intent. **No failure of any kind.**
- **conflict (`status: 'failed'`):** a *different* decision was already recorded; the user's intent for THIS request was NOT honoured. This is **failed intent, not failed system** — the system is healthy; the conflict is in the user's request relative to the already-decided state.

Monitoring/analytics may filter on `status` directly; both are non-mutating but only `conflict` indicates an unmet user intent worth surfacing.

**DR1 artefact-ID collision = hard failure.** When the JSONB scan in § 4.5.4 returns more than one row for an artefactId (per the uniqueness rule), the lookup throws `artefact_id_collision`. The HTTP response is **HTTP 500** (system error). There is **no fallback to "first match"**, **no silent continuation**, **no soft-skip**. The collision is a data-integrity red flag and MUST surface as a hard failure so operator dashboards see it. The `rule.draft_candidates.collision_detected` event is emitted alongside the throw and persists even if the request itself returns 500.

**Stale-decision guard (per invariant 7.2 source-of-truth precedence).** Before invoking `actionService.proposeAction`, the service re-validates the artefact against the current execution-record state. If the parent brief's `tasks.status` is `'cancelled'` OR the underlying action's `actionPolicy` has been disabled since the artefact was emitted, the decision is rejected with HTTP 410 `{ error: 'artefact_stale', reason: '<cancelled_brief|disabled_policy|...>' }`. Pre-launch staleness is rare (rapid testing, no live data) but the rule is in place; spec author confirms the validation surface during implementation.

**Artefact ID uniqueness (per invariant 6.5 + new requirement).** Artefact IDs are generated via the existing UUIDv7 generator in `shared/ids.ts` (or equivalent) and are **globally unique within an organisation** by construction. The org-scoped JSONB scan from § 4.5.4 returns at most one match per artefactId. If two matches are returned, the lookup throws `artefact_id_collision` — fail-loud, not silent.

**Contract.**

- **Idempotency key:** `(artefactId, decision)`. The first decision recorded for an `artefactId` is canonical; subsequent decisions for the same `artefactId` return the existing superseding artefact unchanged (HTTP 200, same response body).
- **Enforcement mechanism:** pre-check in `briefApprovalService.decideBriefApproval()` reads the `conversation_messages` JSONB chain for any artefact whose `parentArtefactId === artefactId AND kind === 'approval_decision'`. If found, return that artefact directly; do NOT call `actionService.proposeAction`. If not found, transactional INSERT of the decision artefact with a unique partial index on `(parent_artefact_id) WHERE kind = 'approval_decision'` to catch race conditions.
- **Unique-violation translation (REQUIRED).** When two requests pass the pre-check simultaneously and both attempt the INSERT, one wins; the second hits the partial unique index and Postgres raises `23505 unique_violation`. The service MUST catch this exact error code and translate it into the defined behaviour: re-fetch the now-existing decision artefact, then return either HTTP 200 idempotent (if the existing decision matches the requested decision) OR HTTP 409 conflict (if it differs). **Raw `unique_violation` errors MUST NOT bubble as HTTP 500.** Any 500 from this code path is a violation of this contract; pure tests assert the catch-and-translate handles all four cases (insert-wins / lose-with-same / lose-with-different / unrelated-error).
- **HTTP semantics:** second-and-subsequent identical requests return HTTP 200 with `idempotent: true` field on the response. Different decisions for the same `artefactId` (approve then reject) return HTTP 409 `{ error: 'approval_already_decided' }` with the prior decision attached.
- **Test:** spec-named pure test `briefApprovalServicePure.test.ts` extension — five cases: first decision succeeds; identical retry returns existing artefact + `idempotent: true`; conflicting second decision returns 409; stale artefact (cancelled brief) returns 410; collision (two matches) throws `artefact_id_collision`.

#### 4.5.2 C4a-REVIEWED-DISP execution guard (CRITICAL)

**Problem.** Architect § 4 describes the resume path but doesn't pin a transition guard. Failure modes: concurrent approvals processed in parallel; approval-request retry; tick-loop overlap → duplicate webhook dispatch.

**Idempotency posture (per invariant 7.1):** `state-based` (the `WHERE status = 'review_required'` predicate is the lock).

**Retry classification (per invariant 7.5):** `guarded`.

**Retry semantics (per invariant 7.1):** retry → no-op via guard (returns `alreadyResumed: true`).

**HTTP-disconnect / gateway-timeout behaviour.** The resume path runs synchronously inside the `decideApproval` HTTP handler; the webhook fetch can take up to 30s (per § 4.5.5). If the client disconnects mid-call OR the gateway times out before the webhook completes:

- **Server-side execution continues to completion.** Node's request lifecycle is decoupled from the in-flight webhook fetch; the server does not abort the fetch when the response socket closes. The fetch completes (or times out per § 4.5.5).
- **Result is still persisted.** `completeStepRunInternal` writes the terminal `workflow_step_runs` row regardless of whether the HTTP response was delivered to the client. The decision artefact's `executionStatus` updates atomically.
- **Result is still emitted via observability events.** All events in § 4.5.7 fire regardless of HTTP-response delivery — the trace remains intact.
- **Client recovery path.** On reconnect, the client polls (or receives via WS event `brief.artefact.updated`) the latest artefact state for the conversation. The client UI sees the executed outcome even though the original HTTP response was lost.

This isolation between HTTP transport and execution lifecycle is binding for v1; testing-round operators will see consistent state regardless of network instability.

**Source of truth (per invariant 7.2):** the `workflow_step_runs` row is ground truth for the step's outcome. If the artefact's `executionStatus` field disagrees with the step row's terminal status (rare; only via partial write failure), the step row wins and the artefact is corrected on next read.

**Contract.**

- **Optimistic transition predicate.** `resumeInvokeAutomationStep` performs the `review_required → running` transition with a guarded UPDATE: `UPDATE workflow_step_runs SET status = 'running' WHERE id = $1 AND status = 'review_required' RETURNING *`. If the UPDATE returns zero rows, the resume call exits without invoking the webhook (another concurrent approval already won the race; the late caller returns success with `alreadyResumed: true`).
- **No advisory locks needed.** The optimistic predicate IS the lock — Postgres serialises the UPDATE within the row. Advisory locks add complexity for no additional safety.
- **Idempotency on retry.** If `decideApproval` HTTP request retries (network failure mid-call), the second call sees `status === 'running'` (set by the first call's UPDATE) and short-circuits before re-invoking the webhook. The decision row is the source of truth; the webhook is invoked exactly once per decision artefact.
- **Test:** pure test `resumeInvokeAutomationStepPure.test.ts` extension — concurrent-resume case: two threads call resume on the same `stepRunId`; UPDATE returns zero rows for the loser; loser exits without invoking; one webhook dispatch total.

#### 4.5.3 DR2 loop protection + concurrency cap (lightweight)

**Problem.** Architect § 2 flagged "Conversation-level rate limiting" as an Open Decision but didn't pin a default. Failure mode 1 (frequency): classifier misfire on a sequence of passive-ack-shaped messages → repeated orchestrator runs. Failure mode 2 (concurrency): two follow-ups arrive in quick succession, both pass the cap check, both enqueue an orchestrator → duplicated runs.

**Idempotency posture (per invariant 7.1):** `state-based` (frequency cap + active-run check are stateful gates; not key-based, since each follow-up message is intentionally distinct).

**Retry classification (per invariant 7.5):** `guarded`.

**Retry semantics (per invariant 7.1):** retry → reclassify allowed (each follow-up classification is independent; the user message is the input). Idempotency for retries of the SAME `conversationMessageId` is provided by the underlying `conversation_messages` UNIQUE on `(conversation_id, message_id)`.

**Suppressed follow-up ordering (Option A — current behaviour, locked in v1).** When a follow-up message arrives during an active orchestrator run AND is suppressed by the concurrency cap, the message is **NOT re-queued** for orchestration after the active run completes. The message persists in `conversation_messages` (the user input is preserved as a record) and the `simple_reply` sentinel artefact is emitted, but no orchestrator job is enqueued at any future point for that suppressed message. The user must send another follow-up after the active run completes to trigger orchestration.

  Rationale: pre-launch posture; replay-on-completion (Option B) requires storing suppressed-message state and re-classifying after the active run, which is feature work beyond dead-path completion. Option B is documented in § 10 Deferred Items as a post-launch enhancement triggered by operator UX feedback.

**Contract.**

- **Frequency cap (loop protection).** Maximum **5 orchestrator invocations per conversation per 10-minute sliding window.** Tracked by counting `agent_runs` rows with `triggerType = 'brief_followup'` and `conversationId = $1` and `createdAt > now() - interval '10 minutes'`.
- **Concurrency cap (overlap protection).** Maximum **1 active orchestrator run per conversation at any time.** Before enqueue, check for any `agent_runs` row with `conversationId = $1` and `status IN (IN_FLIGHT_RUN_STATUSES from runStatus.ts)`. If one exists, short-circuit to `simple_reply` with sentinel artefact: "An analysis is still running — your follow-up will be processed once it completes." No orchestrator job enqueued.
- **When either cap reached.** The `handleBriefMessage` helper short-circuits to `simple_reply` path. No orchestrator job enqueued. Frequency-cap and concurrency-cap have distinct sentinel messages and distinct log events.
- **Caps are informational, not enforced via DB constraint.** Pure-function check at request time. If frequency cap hit, log `brief.followup.cap_hit`. If concurrency cap hit, log `brief.followup.concurrency_blocked`.
- **Cap precedence (when both exceeded simultaneously).** Frequency cap takes precedence: only `brief.followup.cap_hit` is emitted, NOT `brief.followup.concurrency_blocked`. Both events are mutually exclusive per request — never both. Rationale: frequency-cap triggers indicate user behaviour (loop-shaped traffic) while concurrency-cap triggers indicate system-state (in-flight run); when both apply, the user-behaviour signal is the more actionable one for triage.
- **Test:** pure test `briefMessageHandlerPure.test.ts` extension — six cases: 6th orchestration in 10-min window short-circuits (frequency); follow-up arriving while prior run in-flight short-circuits (concurrency); window-resets after 10 minutes; cap is per-conversation (different conversations reset independently); two simultaneous follow-ups → first wins, second sees in-flight and short-circuits; frequency check happens BEFORE concurrency check (both events emit on the appropriate trigger).

#### 4.5.4 DR1 JSONB index assumption

**Problem.** Architect § 3 names the JSONB containment scan but doesn't require the supporting index. Failure mode: scan degrades to seq-scan as `conversation_messages` grows.

**Contract.**

- **Required index.** `conversation_messages.artefacts` has a GIN index. Verified at implementation time by `\d conversation_messages` and confirmed in the Drizzle schema.
- **If absent.** Implementation PR includes a corrective migration adding `CREATE INDEX CONCURRENTLY conversation_messages_artefacts_gin_idx ON conversation_messages USING GIN (artefacts)`. Verified by `EXPLAIN ANALYZE` showing index scan, not seq-scan.
- **Performance budget.** The artefact lookup query must complete in <100ms p95 on the testing-round dataset (≤10000 conversation_messages rows).
- **Test:** sanity grep at implementation time: `grep -nE "GIN.*artefacts" server/db/schema/conversationMessages.ts migrations/*conversation*.sql` → must return at least one match. If zero, the corrective migration ships in this PR.

#### 4.5.5 Webhook timeout + retry posture (C4a-REVIEWED-DISP)

**Problem.** Architect § 4 says "webhooks typically <30s" but doesn't pin timeout, retry, or failure classification.

**Contract.**

- **Timeout:** the webhook fetch in `invokeAutomationStep` has a hard timeout of **30 seconds**. After 30s, the fetch is aborted; the resume path emits `automation_execution_error` with `code: 'automation_webhook_timeout'` (added to §5.7 vocabulary if not already present).
- **Retry posture:** **NO automatic retry on timeout in v1.** The decision artefact is marked failed; the timeout is a **terminal failure for that decision artefact**. A subsequent re-approve attempt by the user hits the C4a-REVIEWED-DISP idempotency guard in 4.5.2 (state-based: `status === 'running'` or terminal) and short-circuits — the prior decision is returned, NOT a fresh dispatch. **Re-dispatching the webhook for a timed-out decision requires either (a) a brand-new approval artefact emitted by the orchestrator on a subsequent run, OR (b) an explicit manual-retry mechanism (deferred to post-launch — see § 10 Deferred Items).** In v1, the user cannot directly retry the same approval after timeout; this is the documented contract, not a bug.
- **Failure classification:** webhook 4xx → user-error; webhook 5xx → system-error; timeout → system-error; network failure → system-error. Distinction surfaces in the artefact's `executionStatus` and the audit log.
- **Test:** pure test on the timeout path — assert `automation_webhook_timeout` is emitted; failure is classified as system-error; no retry attempted.

#### 4.5.6 No-silent-partial-success per flow

**Problem.** Each flow can partially complete; without explicit success/partial/failure definitions, partial results can be misread as success.

**DR3 — BriefApprovalCard decision.**

- **Success:** decision artefact written + `proposeAction` returned ok + execution record linked.
- **Partial:** N/A — DR3 is atomic; if `proposeAction` fails, the decision artefact still writes, but with `executionStatus: 'failed'` so the client sees the user input was captured but the action wasn't dispatched.
- **Failure:** decision artefact write fails → HTTP 500; user re-tries via the idempotency guard.

**DR2 — Conversation follow-up.**

- **Success:** classifier returns + (Orchestrator job enqueued OR simple_reply artefact emitted).
- **Partial:** classifier returns but enqueue fails → HTTP 500 with `{ error: 'orchestrator_enqueue_failed' }`; the user message is already persisted in `conversation_messages` (independent transaction), so retry replays the classifier.
- **Failure:** classifier itself fails → log `chat_intent_classifier_failed`; default to `simple_reply` path with a sentinel artefact rather than block the user message.

**DR1 — POST /api/rules/draft-candidates.**

- **Success:** scan finds artefact + `kind === 'approval'` + `briefContext` loaded + `draftCandidates` returns ≥1 candidate → HTTP 200 with full payload.
- **Partial:** scan finds artefact + briefContext loaded + `draftCandidates` returns 0 candidates → HTTP 200 with `{ candidates: [] }` (empty is success, not partial).
- **Failure:** scan finds nothing → HTTP 404; wrong kind → HTTP 422; `draftCandidates` throws → HTTP 500.

**C4a-REVIEWED-DISP — Resume path.**

- **Success:** transition + webhook dispatch + `completeStepRunInternal` with real output.
- **Partial:** transition succeeds, webhook fails → step transitions to `error` with the right code; `executionStatus` on the brief approval artefact updates to reflect the dispatch failure; user sees the failure in-place. NOT silent.
- **Failure:** transition guard returns zero rows (concurrent winner) → exit with `alreadyResumed: true`; this is success of the SECOND caller, not a partial outcome.

#### 4.5.7 Observability hooks per flow

**Problem.** Each flow needs operational signals so production incidents can be debugged without log archaeology.

**Required emissions** (use existing `agentExecutionEventService` where applicable; otherwise structured `logger.info` with the named event):

- **DR3:** terminal event (per invariant 7.7) is exactly one of `brief.approval.completed | brief.approval.failed | brief.approval.idempotent_hit`:
  - `brief.approval.received` (artefactId, decision, userId, orgId, conversationId, executionId)
  - `brief.approval.dispatched` (artefactId, executionId, latencyMs)
  - `brief.approval.idempotent_hit` (artefactId, executionId, status: 'success') — TERMINAL when 4.5.1 idempotency short-circuit fires
  - `brief.approval.completed` (artefactId, executionId, latencyMs, status: 'success', executionStatus: 'queued' | 'completed') — TERMINAL on first-decision success
  - `brief.approval.conflict` (artefactId, priorDecision, attemptedDecision, status: 'failed') — TERMINAL when 409 fires (concurrent different decisions; per § 4.5.1 first-commit-wins rule)
  - `brief.approval.stale` (artefactId, reason, status: 'failed') — TERMINAL when 410 fires (per § 4.5.1 stale-decision guard)
  - `brief.approval.failed` (artefactId, executionId, error, status: 'failed') — TERMINAL on uncaught failure
- **DR2:** terminal event (per invariant 7.7) is exactly one of `brief.followup.orchestrator_enqueued | brief.followup.simple_reply_emitted | brief.followup.cap_hit | brief.followup.concurrency_blocked | brief.followup.failed`:
  - `brief.followup.classified` (conversationId, intentKind, latencyMs, runId)
  - `brief.followup.orchestrator_enqueued` (conversationId, jobId, runId, status: 'success') — TERMINAL for orchestration path
  - `brief.followup.simple_reply_emitted` (conversationId, artefactId, runId, status: 'success') — TERMINAL for simple-reply path
  - `brief.followup.cap_hit` (conversationId, count, windowStart, status: 'partial') — frequency cap TERMINAL from 4.5.3
  - `brief.followup.concurrency_blocked` (conversationId, activeRunId, status: 'partial') — concurrency cap TERMINAL from 4.5.3
  - `brief.followup.failed` (conversationId, error, status: 'failed') — TERMINAL on classifier or enqueue failure
- **DR1:**
  - `rule.draft_candidates.requested` (artefactId, orgId)
  - `rule.draft_candidates.returned` (artefactId, candidateCount, latencyMs, status: 'success')
  - `rule.draft_candidates.collision_detected` (artefactId, orgId, matchCount) — emitted when the JSONB scan returns more than one row for an artefactId (per § 4.5.1 uniqueness rule); data-integrity red flag, surfaces to operator dashboards
  - `rule.draft_candidates.failed` (artefactId, orgId, error, status: 'failed') — terminal event per invariant 7.7
- **C4a-REVIEWED-DISP:** terminal event (per invariant 7.7) is exactly one of `step.resume.completed | step.resume.failed | step.resume.guard_blocked`:
  - `step.resume.started` (stepRunId, runId, automationId)
  - `step.resume.guard_blocked` (stepRunId, runId, status: 'success', alreadyResumed: true) — TERMINAL when optimistic predicate returns zero rows (concurrent winner)
  - `step.resume.completed` (stepRunId, runId, executionStatus, latencyMs, status: 'success' | 'partial') — TERMINAL on dispatch outcome
  - `step.resume.webhook_timeout` (stepRunId, runId, automationId, timeoutMs, status: 'failed') — from 4.5.5; followed by `step.resume.failed`
  - `step.resume.failed` (stepRunId, runId, error, status: 'failed') — TERMINAL on dispatch failure

Each event is best-effort (graded-failure tier per `accepted_primitives` / `agentExecutionEventService`); emission failure does not block the user-facing path.

**Correlation key (per invariant 7.3).** Every event in the chain `brief.approval.received → brief.approval.dispatched → step.resume.started → step.resume.completed → brief.artefact.updated` carries the same `executionId` field at top level. For DR2 the chain `brief.followup.classified → brief.followup.orchestrator_enqueued → run.terminal.*` carries `runId`. Trace reconstruction is via single-key filter on `executionId` or `runId`.

#### 4.5.8 DR3 response shape (explicit contract)

Per invariant 7.4, every response carries a discriminated `status` field at top level.

```json
// HTTP 200 (first decision OR idempotent retry)
{
  "status": "success" | "partial" | "failed",   // discriminated terminal state per invariant 7.4
  "artefact": { /* superseding decision artefact, full shape */ },
  "executionId": "exec_01h...",                  // correlation key per invariant 7.3
  "executionStatus": "queued" | "completed" | "failed",
  "idempotent": false                            // true on retry of identical decision
}

// HTTP 409 (conflicting decision)
{
  "status": "failed",
  "error": "approval_already_decided",
  "priorDecision": "approve" | "reject",
  "priorArtefact": { /* the existing decision artefact */ }
}

// HTTP 410 (stale artefact — per § 4.5.1 stale-decision guard)
{
  "status": "failed",
  "error": "artefact_stale",
  "reason": "cancelled_brief" | "disabled_policy" | "other"
}

// HTTP 404 (artefact not found)
{ "status": "failed", "error": "artefact_not_found" }

// HTTP 422 (artefact exists but wrong kind)
{ "status": "failed", "error": "artefact_not_approval" }
```

---

### 5. Files touched

#### Modified

| File | Change | From which decision |
|---|---|---|
| `server/services/briefApprovalService.ts` | **new file** — `decideBriefApproval()` composing `actionService.proposeAction` + superseding-artefact emission | DR3 |
| `server/services/briefConversationService.ts` | Extend POST /messages handler with `handleBriefMessage` helper call | DR2 |
| `server/services/briefCreationService.ts` | Refactor to use shared `handleBriefMessage` helper | DR2 |
| `server/services/briefMessageHandlerPure.ts` | **new file** (or co-located) — shared classify→dispatch logic | DR2 |
| `server/services/workflowEngineService.ts` | New `resumeInvokeAutomationStep()` method | C4a-REVIEWED-DISP |
| `server/services/workflowRunService.ts` | Extend `decideApproval` to route `invoke_automation` to resume path | C4a-REVIEWED-DISP |
| `server/routes/briefs.ts` | New POST `/:briefId/approvals/:artefactId/decision` handler | DR3 |
| `server/routes/rules.ts` | New POST `/draft-candidates` handler | DR1 |
| `client/src/components/brief-artefacts/ApprovalCard.tsx` | Wire `onApprove` / `onReject` handlers | DR3 |
| `client/src/pages/BriefDetailPage.tsx` (or equivalent) | Pass handlers down; refresh on response | DR3 |

#### Untouched (reused as-is)

- `server/services/actionService.ts` — `proposeAction` reused.
- `server/services/ruleCandidateDrafter.ts` — `draftCandidates(...)` reused.
- `server/services/invokeAutomationStepService.ts` — entry signature reused by C4a-REVIEWED-DISP resume path.
- `server/services/chatTriageClassifier.ts` — `classifyChatIntent` reused.
- `server/services/orchestratorFromTaskJob.ts` — reused for `needs_orchestrator` / `needs_clarification` paths.

#### Cross-chunk dependencies

- **Phase 5's `withInvalidationGuard`** — C4a-REVIEWED-DISP's resume path uses it. Phase 5 spec PR #207 introduces it. Phase 6 implementation cannot start until Phase 5 is merged.
- **Phase 5's C4a-6-RETSHAPE branch decision** — affects whether DR1 ships flat or nested error envelope. If Branch B (migrate), Phase 5's PR migrates `rules.ts` envelopes; Phase 6 cites the migration but doesn't perform it.

---

### 6. Implementation Guardrails

#### MUST reuse

- `actionService.proposeAction` (accepted primitive) — DR3 dispatch.
- `writeConversationMessage` parent-link mechanic — DR3 superseding artefact.
- `classifyChatIntent` from `chatTriageClassifier.ts` — DR2 gate.
- `generateSimpleReply` — DR2 simple_reply path.
- `orchestratorFromTaskJob` — DR2 needs_orchestrator path.
- `listRules({ orgId, ... })` — DR1 related-rules lookup.
- `ruleCandidateDrafter.draftCandidates(...)` — DR1 candidate draft.
- `WorkflowEngineService.completeStepRunInternal` — C4a-REVIEWED-DISP resume path post-success.
- `withInvalidationGuard` (from Phase 5) — C4a-REVIEWED-DISP invalidation re-check.

#### MUST NOT introduce

- New `brief_approvals` table. Architect explicitly rejects (DR3).
- New step types or new run statuses (invariants 6.5).
- pg-boss enqueue for any of the 4 paths in v1.
- Vitest / Jest / Playwright / Supertest tests (per `convention_rejections`).
- A new `WorkflowEngineFramework` abstraction. The single-method addition (`resumeInvokeAutomationStep`) is the framework.

#### Known fragile areas

- **Brief-approval state machine.** The superseding-artefact pattern relies on the `parentArtefactId` chain being correctly set by the original approval emission. Audit existing approval emissions (in `briefArtefactEmitter` or equivalent) before commit.
- **`handleBriefMessage` extraction.** The brief-creation path has subtle differences from the follow-up path (e.g., the brief-creation path also writes the brief skeleton; the follow-up path only writes the message). Ensure the helper preserves both flows correctly.
- **`resumeInvokeAutomationStep` and tick loop.** The resume path runs synchronously from `decideApproval`; ensure no tick-loop side effects are duplicated (e.g., the step shouldn't appear twice in an active-step query during the resume window).
- **Conversation message JSONB scan (DR1).** The `artefacts @> ...::jsonb` scan on `conversation_messages` is unbounded. Ensure org-scoping prevents cross-org reads (it does, via the `WHERE organisation_id = $1` clause).

---

### 7. Test plan

Per `docs/spec-context.md § testing posture` (`runtime_tests: pure_function_only`):

#### Pure unit tests

1. **`briefApprovalServicePure.test.ts`** — assertion: `decideBriefApproval()` calls `actionService.proposeAction` with the correct payload; emits the superseding artefact via `writeConversationMessage`; returns the artefact in the response shape.
2. **`briefMessageHandlerPure.test.ts`** — three cases: `simple_reply` produces inline artefact + skips Orchestrator; `needs_orchestrator` enqueues `orchestratorFromTaskJob`; `passive_ack` (FILLER_RE) short-circuits.
3. **`ruleDraftCandidatesPure.test.ts`** — assertion: route handler scans org-scoped artefacts; rejects non-`approval` artefacts (422); rejects missing artefacts (404); calls `draftCandidates` with the loaded `briefContext` and existing rules.
4. **`resumeInvokeAutomationStepPure.test.ts`** — assertion: re-read + invalidation check happens before re-invoke; on success, `completeStepRunInternal` receives the real webhook output (not empty `{}`); on failure, transitions to `error` with the right code.

#### Static gates

- `verify-rls-coverage.sh`, `verify-rls-contract-compliance.sh` → must continue to pass (no new tenant tables; service-layer org-scoping reused).
- TypeScript build → must pass (`AgentRunRequest` may need extension for DR3 metadata; audit at impl time).
- Sanity grep before commit:
  - `grep -nE "POST.*'/:?briefId/approvals" server/routes/briefs.ts` → expect 1 match (new route).
  - `grep -nE "draft-candidates" server/routes/rules.ts` → expect 1 match.
  - `grep -nE "resumeInvokeAutomationStep" server/services/workflowEngineService.ts` → expect 1+ matches.
  - `grep -nE "classifyChatIntent" server/services/briefConversationService.ts` → expect 1+ matches via `handleBriefMessage`.

#### No new test categories

No vitest, jest, playwright, supertest, frontend tests, or e2e per `docs/spec-context.md § convention_rejections`.

---

### 8. Done criteria

- [ ] DR3: `briefApprovalService.decideBriefApproval()` exists; new POST route handles approve/reject; superseding artefact emitted; `ApprovalCard.tsx` handlers wired; clicks update brief state in-place.
- [ ] DR2: `handleBriefMessage()` helper exists and is called from both creation and follow-up paths; `classifyChatIntent` runs on every follow-up; `simple_reply` produces inline artefact; `needs_orchestrator`/`needs_clarification` re-enqueues orchestrator job.
- [ ] DR1: `POST /api/rules/draft-candidates` returns 200 with `{ candidates: [] }` for valid request; 404 for missing artefactId; 422 for non-approval artefact.
- [ ] C4a-REVIEWED-DISP: `resumeInvokeAutomationStep()` exists; `decideApproval` routes `invoke_automation` to it; webhook actually fires post-approval; step row carries real output (not empty).
- [ ] All 4 pure tests pass.
- [ ] `tasks/todo.md` annotated for all 4 cited items.
- [ ] PR body links spec + architect output; test plan checked off.

---

### 9. Rollback notes

- DR3: revert `briefApprovalService.ts` (new file delete) + the route handler addition + the client handler wiring. Brief approve/reject buttons revert to silent no-ops (current production state).
- DR2: revert `handleBriefMessage` extraction; follow-ups stop re-invoking. Current production state.
- DR1: delete the route handler. The client `ApprovalSuggestionPanel` will resume 404'ing (current production state).
- C4a-REVIEWED-DISP: revert `resumeInvokeAutomationStep` + the `decideApproval` extension. Approved invoke_automation steps revert to terminating with empty output (current production state).

No DB migrations involved. All four reverts are file-revert granularity. New services are additive; deletion is safe.

---

### 10. Deferred Items

- **Async post-approval dispatch.** v1 picks synchronous resume per architect § 4. Trigger to revisit: webhook latencies routinely exceed 30s in testing-round traffic, OR an HTTP timeout incident links to a stuck approval response. Resolution: move post-approval dispatch to a pg-boss job that the approval response acknowledges immediately. Out of scope for v1.
- **Manual retry path for timed-out approvals.** v1 contract per § 4.5.5: timeout is terminal; re-dispatch requires a new artefact. Trigger to revisit: testing-round operators routinely need to retry timed-out webhooks without waiting for the orchestrator's next run. Resolution: dedicated `POST /api/briefs/:briefId/approvals/:artefactId/retry` route that emits a fresh approval artefact (new artefactId) and re-enters the dispatch path. Until then, users who want to retry a timed-out webhook must either wait for the orchestrator to re-emit the approval OR manually re-trigger the orchestrator via DR2.
- **Conversation-level rate limiting on follow-ups.** Architect-flagged risk: a user could spam follow-ups and trigger many Orchestrator runs. Trigger to revisit: spam observed in testing, OR per-org cost spike attributable to follow-up loops. Resolution: piggyback on existing rate-limit middleware OR add a per-conversation cooldown.
- **Follow-up re-invocation for non-Brief scopes.** Out-of-scope per § 1; new feature. Trigger to revisit: explicit operator request for `task` or `agent_run` conversation surfaces.
- **Skill error envelope migration in `rules.ts`.** Bound to Phase 5 C4a-6-RETSHAPE Branch B. If Branch A (grandfather), this entry stays open indefinitely; if Branch B (migrate), this entry closes when Phase 5 implementation lands.

---

### 11. Review Residuals

_(Populated by user adjudication at PR review. `spec-reviewer` agent skipped per `tasks/builds/pre-launch-hardening-specs/progress.md § Workflow deviations`.)_

#### HITL decisions (user must answer)

- **High-risk action handling for brief approvals.** Architect recommends brief approval IS the only required human gate. User confirms or specifies a chained second-tier approval flow.
- **Rate limiting cooldown for DR1 + DR2.** User confirms "no rate-limit in v1" or specifies a cooldown.

#### Directional uncertainties (explicitly accepted tradeoffs)

- **Synchronous post-approval dispatch (C4a-REVIEWED-DISP).** Architect picks synchronous over async because v1 webhooks typically <30s. Trade-off documented in § 10 with a re-visit trigger.
- **DR1 flat error envelope.** Matches existing `rules.ts` precedent; migration deferred to Phase 5. Accepted.
- **`briefApprovalService` as a new primitive.** Justified per architect: composes `actionService.proposeAction` for a domain-specific use case, not as a generic wrapper. Accepted.

---

### 12. Coverage Check

#### Mini-spec Items (verbatim)

- [x] `DR3` — `BriefApprovalCard` approve/reject buttons are silent no-ops — **addressed in § 2 + § 4.1 + § 5 modifications**.
- [x] `DR2` — Conversation follow-ups don't re-invoke fast-path/Orchestrator — **addressed in § 2 + § 4.2 + § 5 modifications**.
- [x] `DR1` — `POST /api/rules/draft-candidates` route missing — **addressed in § 2 + § 4.3 + § 5 modifications**.
- [x] `C4a-REVIEWED-DISP` — review-gated `invoke_automation` never dispatches after approval — **addressed in § 2 + § 4.4 + § 5 modifications**.

#### Mini-spec Key decisions (verbatim)

- [x] **DR2: what's the trigger semantics for conversational follow-ups?** — **addressed in § 4.2** (`classifyChatIntent` gate; `simple_reply` skips; non-Brief scopes excluded).
- [x] **C4a-REVIEWED-DISP: resume the original step or branch a new one?** — **addressed in § 4.4** (Option A — dedicated resume path).

#### Final assertion

- [x] **No item from mini-spec § "Phase 6 — Dead-Path Completion" is implicitly skipped.** Every cited item appears in § 2 + § 4 + § 5. Both Key decisions are addressed in § 4.

#### Mini-spec done criteria — mapped to this spec's § 8

- [x] "Approve/reject buttons end-to-end functional with tests." — § 8 first checkbox + § 7 test 1.
- [x] "Follow-up message in any chat surface results in a new agent run (or documented decision why not)." — § 8 second checkbox; non-Brief scopes documented as out-of-scope in § 3.
- [x] "Approved external automations dispatch and surface their result." — § 8 fourth checkbox + § 7 test 4.
- [x] "`POST /api/rules/draft-candidates` returns 200 with valid payload." — § 8 third checkbox + § 7 test 3.

---

## 8. Consolidated Open Decisions (10 HITL items across 5 phases)

The 10 outstanding HITL decisions across the 6 phases. The user adjudicates each at PR review; implementation ships against the chosen value. Recommendations are non-binding but pinned per phase as the "best v1 default."

| # | Phase | Decision | Recommendation |
|---|---|---|---|
| 1 | Phase 1 (RLS) | RLS gate posture (`verify-rls-coverage.sh` / `-contract-compliance.sh` / `-session-var-canon.sh`): hard-block vs warn-only? | **Hard-block** — drift = 2 known-deferred tables; pre-launch posture means false-positive cost is near zero; latent fail-open RLS gap is high cost. |
| 2 | Phase 2 (Schema) | F6 default for legacy `workflow_runs.safety_mode` rows. | **Leave at `'explore'`** — safe default; pre-launch has no live data. |
| 3 | Phase 2 (Schema) | F10 inheritance precedence (5-step ladder vs 4-step). | **Adopt 5-step:** parentRun → request → portal default → agent default → 'explore' literal. |
| 4 | Phase 2 (Schema) | F22 — does a rejected action proposal count as "meaningful" output? | **Yes** — the proposal itself is the meaningful signal; rejection is a downstream decision. |
| 5 | Phase 5 (Execution) | C4a-6-RETSHAPE: Branch A (grandfather flat-string) vs Branch B (migrate to nested envelope). | **Branch A** — pre-launch posture; ~40 skill handlers of low-value migration risk; legacy pattern works. Resolved via consistency sweep v1. |
| 6 | Phase 5 (Execution) | C4b-INVAL-RACE wrapper scope: single helper vs per-call-site. | **Single helper `withInvalidationGuard`** — DRY across 4 internal-helper call sites; mirrors the public `completeStepRun` pattern. |
| 7 | Phase 5 (Execution) | H3 option for partial-coupling fix: separate `hasSummary` flag (a) / side-channel `summaryMissing` (b) / monitor-and-revisit (c). | **Option (b) side-channel `summaryMissing`** — no DDL; preserves `runResultStatus` semantics. |
| 8 | Phase 6 (Dead-Path) | High-risk action handling for brief approvals: single human gate vs chained second-tier? | **Single human gate** — the brief approval IS the human gate; no chained approval flow. |
| 9 | Phase 6 (Dead-Path) | Rate limiting for DR1 + DR2 (per-org cooldown vs none). | **No v1 cooldown** — defer to existing rate-limit middleware OR post-launch UX-driven cap. |
| 10 | Phase 4 (Gate Hygiene) | `docs/capabilities.md` editorial wording for the "Anthropic-scale distribution" line. | **`Hyperscaler-scale distribution`** — vs `provider-marketplace-scale distribution` alternative. |

After all 10 decisions are adjudicated:
- Resolved values are recorded in each phase's `## Review Residuals § HITL decisions` section (or analogue) on the same PR.
- The consistency sweep is re-run against the merged state.
- Task 6.5 spec freeze is re-stamped at the post-merge HEAD.
- Implementation may begin per the binding order `1 → {2, 3, 4} → 5 → 6`.

If the user overrides any recommendation, the implementation PR for the affected phase ships against the user's value.

---

## End of consolidated spec

The 6 per-phase specifications above are the authoritative source for implementation. The companion invariants doc (`docs/pre-launch-hardening-invariants.md` SHA `1cc81656`) governs cross-phase rules. Architect outputs in `tasks/builds/pre-launch-hardening-specs/architect-output/` are the audit trail for Phase 2 + Phase 6 decision provenance. Nothing in this consolidated spec was newly authored at consolidation time — it is a re-organisation of the previously-authored 6 chunk specs into a single multi-phase document for cleaner implementation reading.
