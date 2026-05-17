---
status: DRAFT
date: 2026-05-17
author: main-session (claude opus 4.7)
scope_class: Major
source_branch: main
build_slug: wave-6-rls-residue-and-gate-fix
output_location: tasks/builds/wave-6-rls-residue-and-gate-fix/spec.md
parent_build: tasks/builds/wave-5-prevention-gates-and-rls/spec.md
---

# Wave 6 Session O — RLS residue + gate honesty fix

Closes the gap Wave 5 Session N (PR #335) left. Wave 5's `with-org-tx-or-scoped-db = 0` baseline was a **Windows-only artefact** — the gate's `find → temp → Node existsSync` chain returns POSIX-style paths on Windows git-bash (`/c/Files/...`) that Node's `fs.existsSync` rejects, causing the analyser to silently skip every file and report 0 violations regardless of actual state.

**Linux CI's honest count post-Wave-5: 1,108 callsites remaining.** Wave 5 genuinely migrated ~1,045 callsites; the rest were always there but invisible to the local Windows gate.

This is the final Major-class consolidation build before v1 lockdown. After this lands, the defence-in-depth tenant-isolation migration is permanently complete.

---

## 1. Scope

Closes the following `tasks/todo.md` items:

- **Wave 6 follow-ups (3 items, lines 1859-1862)**: Windows path fix, RLS residue migration, audit other gates for the same bug
- **Track A residue (3 items)**: F3, F4, F7 — completion of the Wave 5 partial migration
- **Track A2 workflow residue (4 items)**: WF1, WF3, WF4, WF6 — items that Wave 5 partially migrated but the Windows-blinded gate didn't catch
- **Prevention gate hardening (1 item)**: P3 — OS-parity gate-correctness harness for every gate invoked by `scripts/run-all-gates.sh` (per §6.2)

**Total: ~11 items, but the 1,108-callsite migration is the dominant work.**

## 2. Goals

1. Fix the Windows path resolution bug in `scripts/verify-with-org-tx-or-scoped-db.sh` so the gate reports consistent counts across Linux CI and local Windows dev. After this fix, the published baseline matches reality on both platforms.
2. Audit every gate invoked by `scripts/run-all-gates.sh` (regardless of directory or extension — `scripts/verify-*.sh`, `scripts/gates/*.sh`, `.mjs`/`.js` verification scripts) for the same `find → temp → Node existsSync` pattern. Confirmed bug-affected gates so far: `verify-with-org-tx-or-scoped-db.sh`, `verify-no-direct-boss-work.sh`. Audit produces the full bug-affected list at chunk 0; each affected gate gets the same Option B fix.
3. Migrate every remaining Tier 1 callsite among the 1,108 residue per the §8 tier-categorisation pattern: Tier 1 callsites migrate to `getOrgScopedDb('source')`; Tier 2 callsites migrate to `withAdminConnection(...)` where possible (the analyser stops counting them once they leave `db.*` form); Tier 0 / Tier 3 / Tier 2-residue (callsites that retain `db.*`) receive mandatory `guard-ignore` annotations so the analyser drops their counts. After this build, the `with-org-tx-or-scoped-db` gate baseline drops to the §9 acceptance #4 canonical target — the count of operator-deferred Tier 1-blocked callsites only — on BOTH Linux and Windows. The goal is 0 if no Tier 1-blocked deferrals.
4. Author P3 (OS-parity gate-correctness harness, see §6.2) so this class of bug cannot recur. For each file-scanning gate, the harness asserts the gate detects a seeded-fixture violation; for each non-file-scanning gate, the harness asserts exit ∈ {0, 1, 2} AND non-empty stdout. Linux CI is the canonical runner — the goal is OS-parity behaviour, not literal Windows runner provisioning.

## 3. Non-Goals

- No changes to `getOrgScopedDb()`, `withOrgTx()`, `withAdminConnection()` implementations. Same primitives Wave 5 used.
- No new features. No schema changes EXCEPT a contingent RLS-policy migration if chunk 0's WF1 verification (§7.3) finds the five FK-scoped workflow tables still lacking policies — in which case a single follow-on migration ships in the same chunk as the WF1 code migration (§10). Connection-side enforcement is the primary scope; the contingent migration is a narrow exception.
- No drive-by lint cleanup outside the migration scope.
- No work on items deferred to v2-backlog (Hermes H2, LAEL Phase 3, IEE-DEF, OSI-DEF, 188 `:any` ratchet).
- No re-litigation of Wave 5's tier categorisation — same rules apply.
- No changes to the existing `// guard-ignore: with-org-tx-or-scoped-db` annotation patterns (Wave 5 codified three equivalent forms; this build uses the same forms).

## 4. Framing Assumptions

- Repo is pre-production. Pre-prod is still the cheapest time to do the migration; production migrations cost 5-10x more.
- The org-scoped transaction primitives `withOrgTx(...)`, `getOrgScopedDb('source')`, `withAdminConnection(...)` already exist and are battle-tested through Wave 5's ~1,045-callsite migration. This build adds no new primitives.
- The upstream entrypoints (HTTP `authenticate` middleware + `createWorker(...)` pg-boss wrapper) establish the DB transaction and set the `app.organisation_id` GUC. Every Tier 1 callsite this build migrates must trace to one of these entrypoints, OR be marked Tier 2 (intentional bypass) with a guard-ignore annotation, OR be Tier 1-blocked (escalated to operator).
- The Wave 5 spec § 4-6 contracts apply verbatim to this build. Pattern reuse, not invention.
- 1,108 is the count from Linux CI on PR #335 post-merge. Chunk 0 produces a fresh count from current main + per-file partition into tiers.
- TypeScript strict mode is on. Existing tsconfig path mapping is immutable.
- Some callsites the Wave 5 gate skipped on Windows may already have been correctly migrated (Tier 0 false positives); chunk 0 verifies. Likely distribution: ~700-900 genuine Tier 1 to migrate, ~100-200 Tier 2 annotation, remainder split between Tier 0 (analyser false positive) and Tier 3 (non-tenant table).

## 5. Items — Gate honesty fix (must land first)

### 5.1. Fix `scripts/verify-with-org-tx-or-scoped-db.sh` Windows path resolution

Root cause: the gate's pipeline `find ... | TMP_FILES | Node analyser` returns POSIX-style paths on Windows git-bash (`/c/Files/.../actionService.ts`) that Node's `fs.existsSync` rejects, causing the analyser to silently skip every file and report 0 violations.

**Fix: Option B (Node-native enumeration).** Rewrite the analyser to enumerate files from Node directly using the existing `glob` dependency (`glob ^13.0.6`, already pinned in `package.json` — no new npm dependency). Remove the shell `find` step entirely. OS-portable by construction.

Option A (`cygpath -w` shim around `find`) was considered and **rejected**: `cygpath` is not guaranteed on every CI image, and the shim leaves the analyser brittle to future POSIX-Windows path drift. Option B is the only path that closes the bug class permanently. Chunk 0's `gate-fix-design.md` records the Option A / B comparison for the audit trail even though Option B is the chosen design.

For consistency, every bug-affected gate (per §6.1) uses the same Option B fix. No per-gate decision; one design.

Acceptance:
- Gate produces the same violation count on Linux CI AND Windows local dev. Any divergence (target: 0; hard cap: 5 lines) MUST be enumerated in `gate-audit-results.md` with per-path classification as **OS-specific noise** (e.g. symlink target on one OS only) or **security-impacting** (any path that touches a tenant table is security-impacting and gets investigated, not tolerated). Linux CI is the canonical truth; the Windows-local divergence is a tripwire for residual portability bugs.
- Published numeric baseline (in `scripts/guard-baselines.json` per §5.2) reflects Linux truth.
- A pure path-normalisation helper (e.g. `scripts/lib/gate-file-enumerator.mjs`) **MUST** be extracted, matching the existing repo convention for gate helpers (cf. `scripts/lib/with-org-tx-analyser.mjs`, `scripts/lib/check-knip-config.mjs`). Gate shell scripts invoke it via `node --input-type=module` or direct path import; a `.ts` file would require a `tsx` runner the gates do not currently use.
- A targeted Vitest test pins the helper's behaviour on POSIX-style git-bash paths (`/c/Files/...`), Windows-style paths (`C:\Files\...`), and Linux paths. Pure-function unit test per `docs/spec-context.md § runtime_tests: pure_function_only`.

**THIS FIX LANDS FIRST (Chunk 1).** All subsequent migration chunks depend on the gate reporting honest counts.

### 5.2. Capture honest baseline

After §5.1 lands, capture the post-fix Linux baseline. Wave 5 published 0; reality is 1,108 (per tasks/todo.md line 1860). The "1,108" figure refines to the chunk-0 verified count.

The canonical numeric baseline for this gate lives in `scripts/guard-baselines.json` under the key `with-org-tx-or-scoped-db` (currently `1108`). The `scripts/.gate-baselines/with-org-tx-or-scoped-db.txt` file is a header-only narrative log — it is NOT the numeric baseline. Update `guard-baselines.json` to reflect honest current state; subsequent migration chunks ratchet this number down. The narrative log in `.gate-baselines/` may also be updated for context but is not load-bearing.

## 6. Items — Other gates with the same bug pattern

### 6.1. Audit every gate invoked by `scripts/run-all-gates.sh` for the same bug

**Scope:** every script invoked by `scripts/run-all-gates.sh` regardless of extension or directory — `scripts/verify-*.sh`, `scripts/gates/*.sh`, and any `.mjs` / `.js` verification scripts. The bug pattern is `find ... | pipe-to-temp-file | Node script using fs.existsSync`; the scope is defined by the bug pattern, not by directory or file extension.

Run each gate on Linux CI vs Windows local; diff the violation counts. Any gate where Linux count exceeds Windows count is candidate for the same bug.

**Confirmed bug-affected so far**:
- `verify-with-org-tx-or-scoped-db.sh` (Wave 5 evidence — 1,108 violations hidden)
- `verify-no-direct-boss-work.sh` (Wave 5 evidence — 4 entries visible only on Linux)

Architect's chunk 0 produces `gate-audit-results.md` with the full audit list. **Each bug-affected gate gets the Option B fix** (Node-native enumeration via existing `glob ^13.0.6`). **Non-bug-affected file-scanning gates do NOT need a refactor** — their existing enumeration is OS-portable. They DO still need to pass the §6.2 seeded-fixture harness so future regressions are caught. Gates that are already file-scanning via Node-native enumeration (or via shell pipelines that have been verified portable) carry a one-line rationale in `gate-audit-results.md` instead of a refactor.

**`gate-audit-results.md` required columns (one row per gate invoked by `run-all-gates.sh`):**

- Gate path (e.g. `scripts/verify-with-org-tx-or-scoped-db.sh`)
- Uses `find` → temp file → Node `fs.existsSync` pattern (yes/no)
- Baseline source: `guard-baselines.json` key / `.gate-baselines/<file>.txt` / inline / none
- Linux count (current)
- Windows count (current)
- Bug verdict: `bug-affected` / `not-affected` / `n/a (not file-scanning)`
- Fix decision: `apply-Option-B` / `no-change` / `excluded-with-rationale`
- Residual risk: one sentence

Acceptance: every gate invoked by `run-all-gates.sh` produces consistent counts on Linux CI and Windows local (target: 0 divergence; hard cap: 5 lines, with every tolerated divergence enumerated and classified in `gate-audit-results.md` per §5.1), OR is documented as explicitly excluded with rationale (e.g. gates that do not scan files have no portability surface).

### 6.2. Author P3 — OS-parity gate-correctness harness

New `scripts/test-gate-portability.sh` (or `.github/workflows/gate-portability.yml`) that:

- For each file-scanning gate, runs against a **seeded fixture directory** containing at least one known violation of the gate's invariant. Asserts the gate detects the seeded violation (i.e. exits with the expected non-zero code AND reports the seeded file in stdout).
- For each non-file-scanning gate, asserts exit ∈ {0, 1, 2, 3} AND non-empty stdout. Exit 3 is the "legacy informational" code documented in `scripts/run-all-gates.sh:33` (used by readiness/manifest checks); it is accepted in the harness but a gate emitting 3 must include a rationale row in `gate-audit-results.md`.

**Fixture-injection contract (REQUIRED for every file-scanning gate, bug-affected or not).** Every file-scanning gate accepts a `GATE_ROOT` environment variable (default: repo root computed from the script's location). The harness sets `GATE_ROOT` to a fixture directory containing one seeded violation per gate. Gates that currently derive `ROOT_DIR` from the script location must be updated to honour `GATE_ROOT` when set — this is the one mandatory change for non-bug-affected file-scanning gates. Per-gate ad-hoc fixture-routing is prohibited — `GATE_ROOT` is the single injection point.

**Path-form simulation contract (REQUIRED for every bug-affected gate's enumerator).** Every gate's pure enumerator helper extracted under Option B carries a Vitest test that pins behaviour on POSIX-style git-bash paths (`/c/Files/...`), Windows-style paths (`C:\Files\...`), and Linux paths (`/usr/...`) — not only the gate that triggered this build. The §5.1 path-form test is the per-gate pattern, not the one-time exception. Without this, "OS-parity behaviour" on Linux CI does not generalise to Windows-local-dev behaviour.

- Runs on Linux CI. Goal is OS-parity behaviour (a Linux-passing gate that would silently die on Windows fails the harness via fixture-detection failure). The Wave 5 failure mode (gate "produces valid output and count 0" without actually scanning) is caught by the seeded-fixture assertion. Windows-vs-POSIX path handling is caught by the per-gate enumerator-helper Vitest path-form fixture.

Acceptance: harness runs in CI; any new gate that fails the seeded-fixture assertion OR silently dies under `set -euo pipefail` + path-handling quirks fails the harness. The harness IS the load-bearing enforcement of the Linux + Windows count parity claim — without it, that claim is unsubstantiated.

## 7. Items — RLS migration residue (1,108 callsites)

### 7.1. The migration pattern (unchanged from Wave 5 Session N)

For each tenant-table query of the form:
```typescript
const rows = await db.select().from(table).where(eq(table.organisationId, orgId)).limit(10);
```

Convert to:
```typescript
const scopedDb = getOrgScopedDb('callerName.functionName');
const rows = await scopedDb
  .select()
  .from(table)
  .where(eq(table.organisationId, orgId)) // RETAIN — defence-in-depth per Wave 5 §6.1
  .limit(10);
```

The app-layer `where(eq(table.organisationId, orgId))` predicate **must be retained** during migration. RLS at the database layer is the primary tenant boundary; the app-layer predicate is the redundant second layer. Migration that mechanically drops the predicate silently removes defence-in-depth across the codebase and is the highest-risk failure mode of this build (see §11).

The wrapper retrieves the ALS-bound scoped transaction (which was already opened by the upstream `authenticate` middleware or `createWorker` wrapper). RLS policies enforce `organisation_id = current_setting('app.organisation_id')` at the database layer.

### 7.1.1. Mechanical-migration authoring rules (per-callsite)

Every Tier 1 migration MUST preserve:

- Same selected columns, joins, predicates (including the org-id predicate), order, limit
- Same transaction nesting — if the function already receives a `tx` parameter, use that instead of acquiring a new scoped db
- Same return shape and error handling

**Dual-GUC Tier 1 callsites.** Some tenant tables are keyed on `(organisation_id, subaccount_id)` and rely on both `app.organisation_id` AND `app.subaccount_id` GUCs being set inside the scoped transaction (see `server/lib/orgScoping.ts::setOrgAndSubaccountGUC`). The default `authenticate` middleware + `createWorker` wrappers set only `app.organisation_id`. For a Tier 1 callsite against a dual-GUC table:

- **If the upstream entrypoint already calls `setOrgAndSubaccountGUC`** (chunk 0 verifies by reading the route/worker source), the callsite migrates normally to `getOrgScopedDb()`.
- **If the upstream entrypoint sets only `app.organisation_id`** and has subaccount context available, chunk 0 extends the entrypoint to call `setOrgAndSubaccountGUC` BEFORE the callsite migrates. This counts as a small entrypoint change, not a primitive change (per §3 non-goal).
- **If the upstream entrypoint has no subaccount context**, the callsite is **Tier 1-blocked** — operator decides whether to (a) thread subaccount context through, (b) accept as v2-backlog, or (c) defer the callsite.

Import-path and naming rules:

- Import `getOrgScopedDb` and `withAdminConnection` using a **relative path** from the caller (`server/tsconfig.json` uses `moduleResolution: bundler` with no `paths` alias for `server/*`). Example from `server/services/agentExecutionService/x.ts`: `import { getOrgScopedDb } from '../../lib/orgScopedDb.js';`. Match the file's existing import style (the `.js` suffix is required by bundler resolution against `.ts` source — repo convention). Builders must NOT introduce alternative import-path conventions.
- Rename the local binding to `scopedDb` when an existing `db` binding is in scope. Do NOT shadow `db` — name collisions cause review confusion across 1108 callsites.
- Functions already receiving a transaction (`async (tx) => { ... tx.select()... }`) continue to use `tx`. Do NOT call `getOrgScopedDb()` inside a callback that already has an ALS-bound transaction; that creates nested-transaction confusion.

The `source` argument to `getOrgScopedDb(source)` uses the Wave 5 convention: `serviceName.functionName` (e.g. `getOrgScopedDb('agentExecutionService.executeRun')`). Inconsistent source strings across 1108 callsites weaken diagnostics and review; the convention is mandatory.

### 7.2. F3 / F4 / F7 — completion of Wave 5 partials

Wave 5 Session N's tier categorisation marked these as "must-migrate" but the Windows-blinded gate let some land unmigrated:
- **F3**: `verify-rls-contract-compliance.sh` allowlist on `server/services/` masks raw-db usage at service tier — broader than just one service
- **F4**: `agentExecutionService` post-#314 split — some lifecycle phase modules still have raw `db` calls
- **F7**: `skillExecutor` post-#311 split — `db.update(tasks)` write at the legacy line:4302 callsite

Chunk 0 produces the per-callsite location list from the post-#5.1 honest gate output.

### 7.3. WF1 / WF3 / WF4 / WF6 — workflowEngine residue

Wave 5 Session N migrated workflow services per its tier list, but the Windows-blinded gate let some land unmigrated:
- **WF1**: 5 FK-scoped tenant tables (workflow_step_runs, workflow_step_reviews, workflow_studio_sessions, workflow_run_event_sequences, flow_step_outputs) need RLS policies. Wave 5 may have added the policies; verify against current main. If still missing, author a contingent RLS-policy migration per §3. **Deployment-ordering contract:** the policy migration filename is a strictly-lower migration number than any companion change (numeric ordering in `migrations/*.sql` defines deployment order), AND every WF1 RLS-protected table is added to `server/config/rlsProtectedTables.ts` in the SAME migration commit that creates the policy. Deployment runs migrations before booting the server (standard `npm run db:migrate` → `npm run dev` / production-equivalent boot sequence). Switching to `getOrgScopedDb()` against a table with no RLS policy under the `synthetos_app` role would silently 0-row every query and is the worst failure mode in this build.
- **WF3**: `workflowEngineService.ts` raw `db` callsites
- **WF4**: workflow tick worker `resolveOrgContext: () => null` pattern
- **WF6**: `workflowAgentRunHook.ts:36-39` raw `db.select` on `agent_runs`

Chunk 0 verifies which are landed vs which are residue.
## 8. Migration tier categorisation

Same rules as Wave 5 Session N §8. Architect's chunk 0 produces the per-callsite verdict (per-callsite, not per-file — per Wave 5 spec decision codified at §8 of Wave 5 N spec, captured 2026-05-16 Codex iter2 #2).

**Tenant-table source of truth:** `server/config/rlsProtectedTables.ts` is the canonical manifest of policy-protected tenant tables. **FK-only tenant tables** (tenant-scoped via foreign-key parent — RLS policies use `EXISTS (SELECT 1 FROM parent WHERE ...)` rather than a direct `app.organisation_id` predicate) are enumerated by `scripts/.gate-baselines/fk-only-tenant-tables.txt`, the baseline produced by `scripts/verify-fk-only-tenant-tables.sh`. Chunk 0 reads BOTH sources (the manifest + the FK-only baseline) to decide whether each callsite's target table is tenant-scoped.

**The 1108-callsite partition (chunk 0):** the honest gate output reports raw-`db` callsites lacking org-scoped context. Not all of these touch tenant tables. Chunk 0 partitions the 1108 into:
- **Tenant-table callsites** → Tier 1 (migrate) or Tier 2 (intentional bypass)
- **Non-tenant-table callsites** → Tier 3 (the gate flags raw-`db` on system/reference tables; the callsite is harmless from a tenant-isolation standpoint but may still want an annotation for analyser quiet)
- **Tier 0 — analyser false positive** → callsite already uses `getOrgScopedDb()` / `withAdminConnection()` but the analyser walk missed the upstream wiring. Document each false positive in `tier-categorisation.md` with a 1-line analyser-walk-limit explanation; do NOT migrate.

| Tier | Description | Action |
|---|---|---|
| **Tier 1 — must-migrate** | Callsite touches a tenant-scoped table (per `server/config/rlsProtectedTables.ts`) on a tenant-traffic path. Upstream entrypoint (authenticate middleware or createWorker wrapper) verified by chunk 0 — name the route or worker, not merely "the path has a `withOrgTx` call somewhere upstream." | Convert to `getOrgScopedDb('serviceName.functionName')` per §7.1 + §7.1.1 |
| **Tier 2 — intentional bypass** | Cross-tenant by design (admin tier, system-tier audit aggregation, cross-tenant prune, migration scripts). | Migrate connection acquisition to `withAdminConnection({ source, reason }, async tx => { await tx.execute(sql`SET LOCAL ROLE admin_role`); /* ...queries... */ })` per Wave 5 §4 — `withAdminConnection` itself does NOT acquire BYPASSRLS; the caller must explicitly `SET LOCAL ROLE admin_role` (the Postgres role with BYPASSRLS) inside the callback for cross-tenant access. If — and only if — a specific callsite cannot move to `withAdminConnection` (e.g. it lives in a context where the admin connection cannot be wired), retain `db` with one of the three accepted guard-ignore forms per Wave 5 §4 + WHY comment + ADR reference. Each such residue gets a per-callsite rationale that an independent reviewer reads in chunk 0. |
| **Tier 3 — non-tenant** | Callsite touches a non-tenant table (system / reference / global). Raw-`db` is acceptable here. | **Annotation MANDATORY** (so the analyser drops the count): `// guard-ignore: with-org-tx-or-scoped-db reason="non-tenant table <name>"`. No migration needed. |
| **Tier 0 — analyser false positive** | Callsite is already correctly wired (uses `getOrgScopedDb()` or `withAdminConnection()`) but the analyser walk missed the upstream binding. | Document in `tier-categorisation.md` with a 1-line analyser-walk-limit explanation AND **annotation MANDATORY**: `// guard-ignore: with-org-tx-or-scoped-db reason="analyser-walk-limit; upstream <entrypoint>"`. Do NOT migrate. |
| **Tier 1-blocked** | Tier 1 callsite for which chunk 0 cannot name a concrete upstream entrypoint of the required shape. | **STOP. Escalate to operator.** No automated migration; F3/F4/F7 closure conditional on blocked-count == 0. |

**Mandatory per-callsite fields in `tier-categorisation.md`** (carried verbatim from Wave 5 §8):

- `file:line` (callsite location)
- Call expression (e.g. `db.select().from(agents)`)
- Target table (and whether it appears in `RLS_PROTECTED_TABLES` — `server/config/rlsProtectedTables.ts` is the membership manifest, not a key-metadata source)
- Tenant key for the table — the column or columns the table's RLS policy keys on. Derived from the table's policy migration (`migrations/<num>_*.sql`) or schema definition (`server/db/schema/*.ts`). Examples: `organisation_id`, `subaccount_id`, `parent_run_id` (FK-only — policy uses `EXISTS (SELECT 1 FROM parent WHERE ...)`), or dual-GUC (`(organisation_id, subaccount_id)`)
- Tier verdict (0 / 1 / 1-blocked / 2 / 3)
- For Tier 1: **named** upstream entrypoint — the concrete route handler (named in `server/routes/...`) using `authenticate` middleware OR the named pg-boss worker registered via `createWorker(...)`. Not "some upstream `withOrgTx` exists."
- For Tier 2: bypass rationale + ADR reference (or `reason="..."` ≤120 chars) + chosen suppression form
- For Tier 1-blocked: required new entrypoint (if any), owning domain, risk

**Blocked Tier 1 follow-up format.** Any blocked callsite the operator defers must land in `tasks/todo.md` as a single-line entry with: file:line, owning domain, required new entrypoint, risk surface, and proposed v2-backlog disposition. The build does not close until all blocked entries are either resolved or explicitly logged with operator-confirmed deferral.

Expected distribution from 1,108 residue: ~700-900 Tier 1, ~100-200 Tier 2, remainder Tier 3 + Tier 0 + blocked. Chunk 0 confirms.

## 9. Acceptance Criteria

A build is complete when ALL of the following hold:

1. `scripts/verify-with-org-tx-or-scoped-db.sh` reports the same violation count on Linux CI and Windows local dev (target: 0 divergence; hard cap: 5 lines, with every tolerated divergence enumerated and classified per §5.1 / §6.1).
2. Every **bug-affected file-scanning gate** has the Option B fix applied. Every **file-scanning gate** (bug-affected and non-bug-affected alike) passes the §6.2 OS-parity + seeded-fixture test. Every **non-file-scanning gate** passes the §6.2 exit-code/stdout assertion. Exceptions must be documented in `gate-audit-results.md` with rationale (e.g. legacy exit-3 informational gate; or a non-bug-affected file-scanning gate whose existing enumeration is verified portable).
3. P3 OS-parity gate-correctness harness (§6.2) lands; runs in CI.
4. **All Tier 1 callsites migrated to `getOrgScopedDb()`. All Tier 2 callsites either migrated to `withAdminConnection(...)` (analyser stops counting these once the call expression is no longer `db.*`) OR — if they cannot move — retained as `db.*` with the mandatory `guard-ignore` annotation. All Tier 0 callsites annotated. All Tier 3 callsites annotated. Honest baseline (`scripts/guard-baselines.json` key `with-org-tx-or-scoped-db`) drops to the count of operator-deferred Tier 1-blocked callsites only. Target: post-build value equals `(operator-deferred Tier 1-blocked)`; goal is 0 if no Tier 1-blocked deferrals. The analyser ignores `guard-ignore`-annotated callsites AND no longer matches `withAdminConnection(...)` (it pattern-matches `db.*`); the baseline therefore reflects only unannotated, unmigrated callsites. This is the canonical rule that governs §2 goal #3, §8 tier semantics, and §11 risk row 4.**
5. **Every Tier 1 migration preserves query semantics** — same selected columns, joins, predicates (including the app-layer `where(eq(table.organisationId, orgId))` defence-in-depth predicate), order, limit, transaction nesting, return shape, and error handling per §7.1.1.
6. All Tier 2 callsites either migrated to `withAdminConnection({ source, reason }, ...)` (with `SET LOCAL ROLE admin_role` inside the callback — no annotation needed since the call expression is no longer `db.*`) OR retain `db` with one of the three Wave 5 §4 guard-ignore forms + WHY comment + ADR reference.
7. `npm run build:server` exits 0.
8. `npm run build:client` exits 0.
9. `npm run lint` exits 0.
10. **CI passes** — `run-all-gates.sh`, the existing test suite, lint, and typecheck all pass in CI. Per CLAUDE.md "test gates are CI-only", the implementer does NOT run the broader suite locally; CI is the canonical pass.
11. Tier 1-blocked count = 0 (or operator-explicit deferral with rationale logged per §8 blocked Tier 1 follow-up format).
12. **After the final migration chunk lands, rerun §6.1 audit + §6.2 harness; baseline OS-parity holds AND `scripts/guard-baselines.json` counts ratchet to expected post-migration values.**
13. `tasks/todo.md` items F3/F4/F7/WF1/WF3/WF4/WF6/P3 + the 3 Wave 6 follow-ups marked `[status:closed:pr:<num>]` in the merge commit.
14. PR body includes a per-service-tier summary AND a per-gate verdict table (mirrors Wave 5 §9 acceptance #10), plus the post-migration baseline-ratchet evidence from #12.

## 10. Chunks (high-level)

Architect refines during plan phase. Expected shape — Major build, many chunks:

- **Chunk 0 (design only)**: gate honesty fix design + tier-categorisation framework + plan write. Produces:
  - `tasks/builds/wave-6-rls-residue-and-gate-fix/gate-fix-design.md` (Option A vs B comparison; Option B is the chosen design per §5.1)
  - `tasks/builds/wave-6-rls-residue-and-gate-fix/gate-audit-results.md` listing every bug-affected gate (audit can complete pre-fix using the same Linux-vs-Windows count diff Wave 5 established)
  - Migration order: highest-traffic services FIRST (agent-execution, workflow, billing)
  - **Tier-categorisation framework only** — the per-callsite list itself is refreshed in Chunk 1' (below) once the honest gate output exists. The framework defines the mandatory fields (per §8) and the partition rules (Tier 0 / 1 / 1-blocked / 2 / 3).
- **Chunk 1 (gate honesty fix — MUST LAND FIRST)**: Apply gate honesty fix (§5.1) to `verify-with-org-tx-or-scoped-db.sh`. Pure-helper Vitest pin (§5.1 acceptance). All subsequent chunks depend on honest counts.
- **Chunk 1' (post-fix per-callsite categorisation)**: With Chunk 1 landed, run the now-honest gate to produce the per-callsite categorisation. Produces:
  - `tasks/builds/wave-6-rls-residue-and-gate-fix/tier-categorisation.md` listing every residue callsite with the §8 mandatory fields.
- **Chunk 2 (other gates + P3 harness)**: Audit + fix other gates per §6.1 (Option B applied uniformly). Land P3 OS-parity harness per §6.2. The Wave 5 follow-up `verify-no-direct-boss-work.sh` fix lands here.
- **Chunks 3-N (per-domain migration)**: RLS migration residue, grouped by domain to keep PRs reviewable. **Each per-domain chunk handles BOTH Tier 1 callsites AND that domain's Tier 2 callsites inline** — a file mixing Tier 1 and Tier 2 callsites is migrated in one pass to avoid review ambiguity and raw-`db` residue hiding in migrated files. Suggested grouping:
  - Chunk 3: agent-execution residue (F4 completion)
  - Chunk 4: skill-execution residue (F7 completion)
  - Chunk 5: workflow services (WF1/3/4/6 completion). If chunk 0 verification finds WF1 RLS policies missing, the **policy migration ships in this chunk and runs FIRST**, before any WF code switches to `getOrgScopedDb()` (see §7.3).
  - Chunk 6: billing / cost services
  - Chunk 7: personal-assistant services residue
  - Chunk 8: sandbox services residue
  - Chunk 9: integration services residue
  - Chunks 10-12+: remaining Tier 1 services (architect partitions by domain)
  - Chunk 13: **Final Tier 2 annotation audit sweep** — verifies every Tier 2 callsite touched in per-domain chunks has the §8 / Wave 5 §4 form correctly applied; no new Tier 2 work happens here.
- **Chunk N+1**: Tier 1-blocked escalation review (operator confirms each deferral with rationale per §8 blocked-tier follow-up format).
- **Chunk N+2 (final-pass verification)**: Rerun §6.1 audit and §6.2 harness against the post-migration codebase (§9 acceptance #12). Verify all baselines ratchet to expected values. Then: spec-conformance + pr-reviewer + reality-checker + final review pass.

Total: 15-20 chunks. If any per-domain chunk exceeds 50 files, split further.

## 11. Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| **Mechanical predicate removal across 1108 callsites.** A bulk migration that strips `.where(eq(table.organisationId, orgId))` while moving from `db` to `getOrgScopedDb()` silently removes the app-layer defence-in-depth layer Wave 5 §6.1 explicitly retained. Without the predicate, a future RLS-policy regression has no second line of defence. | high | §7.1 + §7.1.1 mandate predicate retention. §9 acceptance #5 makes it load-bearing. The §7.1 example explicitly retains the predicate; reviewers reject any migration diff that drops it. |
| **Tier 1 migration against a tenant table with no RLS policy returns 0 rows silently (WF1 risk).** Switching `db` → `getOrgScopedDb()` under the `synthetos_app` Postgres role on a tenant table that lacks an RLS policy produces zero-row reads and zero-row writes — the worst correctness failure mode in this build. | medium | §7.3 mandates the WF1 contingent RLS-policy migration ships in the SAME chunk as the code migration but runs FIRST. Chunk 0 verifies each WF1 target table has a policy on current main before authoring the code migration. |
| Some residue callsites are genuinely cross-tenant (admin tier) but the original developer didn't annotate. Architect's chunk 0 categorisation surfaces them. | high | Each Tier 2 verdict requires a WHY comment + ADR reference. Reviewer scrutinises rationale. |
| Tier 1-blocked count > 0 because some callsite path has no upstream `authenticate` / `createWorker` entrypoint (e.g., scheduled jobs that need a new entrypoint). | medium | If chunk 0 surfaces this, build pauses and operator decides: (a) extend an existing entrypoint, (b) accept the blocked-count as v2-backlog with explicit rationale, (c) defer the entire callsite. |
| The Option B fix uses the existing `glob ^13.0.6` dependency — no new package introduced. | low | §5.1 mandates the existing `glob` dependency. Chunk 0 confirms no other library is needed. |
| Wave 5's "0 baseline" claim being wrong creates trust loss with the operator | already-happened | Mitigated by surfacing the correction explicitly in this spec's preamble and by Wave 6's per-gate verdict table. |
| Branch goes stale during the multi-day build window | high | Daily `git fetch origin main + merge` discipline. S2 sync at each chunk boundary. |
| Concurrent Wave 6 sessions (P knip triage, Q cleanup) touch the same residue files | medium | File-overlap deconfliction documented in §13. Q's stale-status sweep waits until O's chunk 0 categorisation publishes. |

## 12. Out of Scope (Deferred Items)

This section serves as the spec's `Deferred Items` list per `docs/spec-authoring-checklist.md` §7.

- LAEL Phase 3 retention tiering (v2-backlog)
- Hermes H2 rollup-vs-ledger asymmetry (v2-backlog)
- 188 `:any` ratchet (let `verify-any-budget.sh` ratchet naturally)
- IEE-DEF (dead-code pending live traffic)
- OSI-DEF future-state operator-session items
- Sandbox advisory waiting on e2b SDK
- The operator's 1-2 features (Wave 6 Session R, separate branches)
- Any Tier 1-blocked callsite the operator defers per §8 — logged in `tasks/todo.md` with the §8 blocked-tier handoff format.

## 13. File-overlap deconfliction

> **HARD RULE — TENANT-ISOLATION MERGE CONFLICTS (carried from Wave 5, also surfaced at §9 acceptance and §11 risk).** Any merge conflict on tenant-isolation code (every file touched by an O chunk, every `scripts/verify-*.sh` Option B fix, every `scripts/guard-baselines.json` ratchet, every RLS-policy migration) requires **operator review — no automated conflict resolution**. The agent's `git merge` / `git rebase` discipline aborts on conflict and surfaces the diff to the operator. This rule is load-bearing: the build's correctness depends on tenant-table predicate retention (§7.1.1) and entrypoint-named Tier 1 verdicts (§8) — both invisible to a mechanical conflict resolver.

This session runs concurrently with Sessions P (knip triage) and Q (cleanup batch), plus Session R (operator's feature). File-overlap analysis:

- **Session P (knip triage)**: touches mostly `client/src/components/**` (101 candidates) and `server/{routes,services}/<deprecated-file>.ts` (~33 server candidates). **Limited overlap with O** — most knip candidates are dead code paths that wouldn't have raw `db` callsites. Confirm via chunk 0.
- **Session Q (cleanup batch)**: touches `scripts/*` (gate baselines), `server/services/*` (stale-status verification only — no actual edits), `client/src/components/*` (19 duplicate exports drop), `shared/types/page.ts` (pagePreview/pageServing type moves). **Overlap with O** on `server/services/*` is verification-only — Q reads, O writes. **Hard coordination**: Q WAITS until O publishes BOTH (a) chunk-0 tier categorisation AND (b) Chunk 1 gate-honesty fix AND (c) the post-fix baseline ratchet in `scripts/guard-baselines.json`. Q's stale-status sweep then reflects O's verdicts AND honest baselines. Q must NOT edit `scripts/.gate-baselines/*` or `scripts/guard-baselines.json` while O's chunks are in flight.
- **Session R (operator's feature)**: operator-scoped, file-overlap unknown until R's spec lands. If R touches services that overlap with O's migration, R rebases on O OR architect coordinates merge order. **Recommendation**: R's chunk 0 reads O's tier-categorisation.md before drafting its plan.

**Migration priority within O**: Tier 1 high-traffic services FIRST (agent-execution, workflow, billing). Tier 2 annotation audit sweep LAST (per-domain Tier 2 work happens inline with each domain's chunk — see §10). If the build runs long, the most-critical surfaces are protected first.
