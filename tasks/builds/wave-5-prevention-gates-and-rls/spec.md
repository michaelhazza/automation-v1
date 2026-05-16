---
status: DRAFT
date: 2026-05-16
author: main-session (claude opus 4.7)
scope_class: Major
source_branch: main
build_slug: wave-5-prevention-gates-and-rls
output_location: tasks/builds/wave-5-prevention-gates-and-rls/spec.md
---

# Wave 5 Session N — prevention gates + full service-tier RLS migration

Single coordinated PR. Major-class. Combines two final pre-prod hardening workstreams: (1) verify or extend 6 prevention gates so the baselined invariant set is complete and consistently surfaced, and (2) migrate the remaining service-tier raw-`db` callsites on tenant-scoped tables to `getOrgScopedDb()` — closing the defence-in-depth gap permanently before production traffic.

This is the final architectural pre-v1 build. After this lands, the codebase is in the cleanest pre-feature state it can be.

> **Note on inventory counts.** "231" comes from the Track A 2026-05-14 audit (F3) and refers to *service files importing `db`*, not raw-`db` *callsites*. Chunk 0 produces the authoritative per-file and per-callsite counts and partitions them into Tier 1 / 2 / 3 (§8). Every count of the form "231" elsewhere in this spec is shorthand for "the Track A file set" and is refined to concrete file + callsite numbers at chunk 0.

---

## 1. Scope

Closes the following `tasks/todo.md` items:

- **Prevention gates (5 still-open + 1 already-closed verify-only)**: PP-CD1, PP-DUP1, PP-SK1, PP-SK2, PP-FE2 (all `[status:open]` — to be closed by this build), plus PP-MC2 (`[status:closed:pr:332]` — verify-only, this build does not re-close it). Chunk 0 produces the per-gate verdict per §5.
- **Service-tier RLS migration (3 findings, ~231 files from the Track A set)**: F3, F4, F7
- **knip configuration (1)**: extend the existing `knip.json` to close ~250 of 306 false-positive flags (a starter `knip.json` lives at repo root already; this build refines it)

**Total: ~9 closeable items (5 still-open gates + F3/F4/F7 + knip), plus PP-MC2 verify-only. F3/F4/F7 cover ~231 service files; chunk 0 confirms the per-callsite count.**

## 2. Goals

1. Ensure all 6 prevention gates are present, baselined where applicable (PP-MC2 is a schema gate with no baseline — see §5.6), and surfaced in `run-all-gates`. Several gates already exist on main with seeded baselines (see §5 for the per-gate current state); the work for those reduces to verifying they are in `run-all-gates` and resolving any remaining semantic deltas. Net-new gates are authored to the same baseline convention; any net-new violation fails the PR.
2. Migrate every Tier 1 service-tier raw-`db.<verb>(<tenant_table>)` callsite with a chunk-0-verified upstream `withOrgTx(...)` entrypoint to read/write through the org-scoped transaction context. The canonical migration is to (a) confirm the caller path runs inside `withOrgTx(...)` (HTTP `authenticate` middleware / `createWorker` already provide this for routed and worker code) and (b) replace `db` with the handle returned by `getOrgScopedDb('<callerName>')`. After this build, raw `db` calls on tenant tables outside the sanctioned admin path are forbidden by the existing `verify-with-org-tx-or-scoped-db.sh` gate (P2) unless suppressed with the existing `// guard-ignore: with-org-tx-or-scoped-db ADR-<id> <rationale>` directive. Any Tier 1 callsite for which chunk 0 cannot name an upstream `withOrgTx` is marked "Tier 1 — blocked, no upstream org context" and escalated to operator; F3/F4/F7 closure is conditional on the blocked-count being zero (see §9.9).
3. Extend the existing `knip.json` to drive the 306 unused-file flags below 30. Most current flags are false positives (config files, dynamic imports, build outputs); the remainder are genuine dead code triaged in a follow-up.
4. Defence-in-depth on tenant isolation is permanent. The org-scoped transaction (RLS + `app.organisation_id` GUC) becomes the primary defence; the app-layer `where(eq(table.organisationId, ...))` predicate stays in place as belt-and-braces (see §6.1).

## 3. Non-Goals

- No behaviour change in any migrated service. Each migration preserves the original query semantics; only the connection handle changes.
- No new features, no schema changes, no new tables, no new permissions.
- No drive-by lint cleanup outside the targets above.
- No changes to the `getOrgScopedDb()` implementation, `withOrgTx`, `withAdminConnection`, or the `verify-with-org-tx-or-scoped-db.sh` guard's analyser semantics. If chunk 0 surfaces a query pattern that none of these primitives supports, the spec is paused and the gap is raised to operator; the spec does not implicitly authorise extending the primitive (see §11 risk row).
- No changes to the RLS policies on tables (policies already exist; this build wires the connection-side enforcement).
- No work on items deferred to v2-backlog: 188 `: any` ratchet, ~80 unused exports in `shared/types/*`, PA-V1 worth-confirming, sandbox advisory, IEE-DEF, OSI-DEF.

## 4. Framing Assumptions

- Repo is pre-production. The pre-prod window is the cheapest time to do the RLS migration; post-prod migrations cost 5-10x more due to rolling deploys and customer impact.
- The org-scoped transaction primitives — `withOrgTx(...)`, `getOrgScopedDb(source: string)`, and `withAdminConnection(...)` — already exist (`server/lib/orgScopedDb.ts`, `server/instrumentation.ts`, `server/lib/adminDbConnection.ts`). `withOrgTx` (entered automatically by the HTTP `authenticate` middleware (`server/middleware/auth.ts`, which opens `withOrgTx` and issues the `app.organisation_id` GUC set_config before delegating to the route handler) and by `createWorker` for pg-boss jobs) opens the transaction and issues `SELECT set_config('app.organisation_id', ...)`. `getOrgScopedDb('<callerName>')` returns the in-flight ALS-bound drizzle handle (or throws `failure('missing_org_context')`); it takes a single source string, not `(orgId, source)`. `withAdminConnection({ source, reason }, async tx => { ... })` acquires an admin-capable connection and emits a structured stderr admin-bypass log entry; the helper itself does NOT acquire BYPASSRLS — the caller must explicitly run `await tx.execute(sql\`SET LOCAL ROLE admin_role\`)` (the Postgres role with BYPASSRLS) inside the callback for cross-tenant access. Spec §6 and §8 phrase the migration around these existing contracts.
- The "231" figure comes from the Track A 2026-05-14 audit and counts *service files importing `db`*, not raw-`db` callsites. Chunk 0 refreshes the count from current main, produces a per-callsite inventory, and partitions into three tiers (§8).
- TypeScript strict mode is on. Existing tsconfig path mapping is immutable.
- Some service files intentionally read/write across tenants (admin tier, system-tier, audit aggregation, migration scripts). These are categorised as Tier 2 and migrated to `withAdminConnection(...)` if they aren't already on it. The existing per-line guard suppression accepts three equivalent forms (any of these is valid):
  - `// guard-ignore: with-org-tx-or-scoped-db ADR-<id> <rationale>`
  - `// guard-ignore: with-org-tx-or-scoped-db reason="<rationale ≤120 chars>"`
  - `// guard-ignore-next-line: with-org-tx-or-scoped-db reason="<rationale>"` on the line preceding the call site
  No new annotation primitive is introduced; this build uses whichever of the three forms is most natural for each residue site.
- Some service files already use `getOrgScopedDb()` and need no work — they're in Tier 3.
- Repo is pre-prod per `docs/spec-context.md`; testing posture is `static_gates_primary`. The migration's acceptance is build + lint + the relevant static gates passing + the tier verdict reviewed by chunk 0 + spec-conformance review; existing runtime tests run for services that already have them, but new runtime tests are authored only for new pure helpers per the project's standing posture.
## 5. Items — Prevention gates

Each gate's baseline lives under `scripts/.gate-baselines/`. Any net-new violation fails the PR; existing violations stay grandfathered until ratcheted down by future work.

Several of these gates already exist on main with seeded baselines from earlier waves. The per-gate verdict below states the current state (script path, baseline path, last-seeded date, exit-mode) and the *delta still required for this build*. Chunk 0 reconfirms each verdict against current main before any work begins.

### 5.1. PP-CD1 — `scripts/verify-no-new-cycles.sh`

**Current state:** Gate exists. Baseline `scripts/.gate-baselines/circular-deps.txt` seeded 2026-05-14 at `cycle-count:0` (post-Wave-4). Warning-first rollout was promoted to error mode 2026-05-15.

**Delta for this build:** confirm the gate is wired into `run-all-gates`; no script or baseline change needed unless chunk 0 finds a regression.

**Acceptance:** gate passes against current main; appears in `run-all-gates`; forced new cycle in a scratch branch returns exit 1.

### 5.2. PP-DUP1 — `scripts/verify-duplicate-blocks.sh`

**Current state:** Gate exists (named `verify-duplicate-blocks.sh`, not `verify-no-new-duplicate-blocks.sh`). Runs `jscpd --min-tokens 15` over `server/ client/ shared/ worker/`. Baseline `scripts/.gate-baselines/duplicate-blocks.txt` seeded 2026-05-14 at `clone-count:8769`. Gate currently exits 2 (warning) on regression — promotion to exit 1 (error) was attempted 2026-05-15 and reverted because current main exceeded baseline (9118 vs 8769); tracked in `tasks/todo.md`.

**Delta for this build:**
1. Re-seed the baseline against post-Wave-4 main (chunk 0 captures the new count).
2. Promote the gate to exit-1 / error mode once the baseline matches current state.
3. Confirm wiring in `run-all-gates`.

**Acceptance:** baseline re-seeded; gate exits 1 on a forced new duplication; passes against current main.

### 5.3. PP-SK1 — `scripts/verify-skill-registry-alignment.sh`

**Current state:** No gate by this name on main; this is net-new.

**Delta for this build:** author the gate so it:
1. Reads `scripts/snapshots/action-registry.snapshot.json` (the authoritative `ACTION_REGISTRY` snapshot).
2. Reads all `.md` files under `server/skills/` (every skill — methodology and intelligence alike — lives here; methodology skills are distinguished by their registry entry, not by directory location).
3. Asserts the symmetric set: every registry key has a corresponding `.md` file (after applying the X.Y ↔ X_Y rule from W4AA-DEBT-2), and every `.md` file under `server/skills/` has a registry entry.
4. Excludes any non-skill markdown files in `server/skills/` (e.g. `README.md`, `__tests__/**/*.md`) via an explicit ignore list captured in the gate header.

**Baseline contract:** baseline file `scripts/.gate-baselines/skill-registry-alignment.txt`, format `mismatch-count:<n>` (single numeric entry) matching the convention used by `circular-deps.txt` and `duplicate-blocks.txt`. Seeded baseline is `mismatch-count:0` (Session K's W4AA-DEBT-1 lands the orphan-resolution work BEFORE N's chunk 0 seeds this gate — see §13). Gate exits 1 on `current-count > baseline` and 0 otherwise. Forced-failure verification: introduce a registry entry with no `.md` file (or vice versa) in a scratch branch and confirm exit 1.

**Acceptance:** gate seeded at `mismatch-count:0`; gate exits 0 against current main post-K-merge; forced-failure scenario returns exit 1; gate appears in `run-all-gates`.

### 5.4. PP-SK2 — Verify bidirectional `UNIVERSAL_SKILL_NAMES` ↔ `ACTION_REGISTRY.isUniversal` lint is wired

**Current state:** `scripts/verify-universal-skill-sync.sh` (P7) already asserts bidirectional set equality (see the script header: "Asserts bidirectional set equality between … UNIVERSAL_SKILL_NAMES array … and ACTION_REGISTRY entries where isUniversal: true. Both declarations must mirror each other."). Promoted to error mode 2026-05-15. Baseline `scripts/.gate-baselines/universal-skill-sync.txt` currently carries two grandfathered entries seeded 2026-05-14:
- `UNIVERSAL_SKILL_NAMES:0:read_codebase is in universalSkills.ts but has no isUniversal:true entry in ACTION_REGISTRY` (expires 2026-08-14)
- `ACTION_REGISTRY:0:search_codebase has isUniversal:true in ACTION_REGISTRY but is missing from UNIVERSAL_SKILL_NAMES` (expires 2026-08-14)

So the gate currently exits **2** (within-grace warning) on current main, not 0. New violations beyond these two baseline entries exit 1 via `check_expiring_baseline`.

**Delta for this build:** resolve the two baselined entries — pick one direction for each pair (add `isUniversal:true` to the registry entry, OR remove the name from `UNIVERSAL_SKILL_NAMES`) — and remove the corresponding baseline lines. Chunk 0 captures the chosen direction for each pair after a brief operator check. Confirm the gate is in `run-all-gates`.

**Acceptance:** baseline file `universal-skill-sync.txt` contains zero grandfathered entries (header comment only); gate exits 0 against current main; gate present in `run-all-gates`; forced-failure scenario (introduce a one-sided entry in a scratch branch) returns exit 1.

### 5.5. PP-FE2 — Frontend complexity budget

**Current state:** `scripts/verify-frontend-design-budget.sh` already exists. It enforces that files importing enterprise/admin dashboard components (`MetricCard`, `RunActivityChart`, `SuccessRateChart`, `SparkLine`, `PnlKpiCard`, `PnlSparkline`, `PnlTrendChart`, `SparklineChart`, `SpendTrendChart`) appear in `docs/frontend-design-allowlist.json`. Baseline `scripts/.gate-baselines/frontend-design-budget.txt` is intentionally empty at landing; all current importers are seeded into the allow-list. Promoted to error mode 2026-05-15.

**Delta for this build:** PP-FE2 reuses this existing gate — do **not** author a parallel `verify-page-complexity-budget.sh` or a parallel `// frontend-design: admin-only-acceptance` suppression scheme. If `docs/frontend-design-principles.md § Complexity budget per screen` names additional component literals not yet monitored (e.g. canonical `Chart*` / `Stat*` literals), extend the existing gate's monitored set and add any new importers to `docs/frontend-design-allowlist.json` rather than creating a second gate. Chunk 0 cross-references the doc against the gate's monitored list and produces the extension delta (zero or more new monitored literals).

**Acceptance:** the existing gate's monitored set covers every component literal named in `docs/frontend-design-principles.md § Complexity budget per screen`; gate passes against current main; allowlist diff (if any) is reviewed in PR.

### 5.6. PP-MC2 — `scripts/verify-critical-path-coverage.sh`

**Current state:** Gate exists. Authored to consume `tasks/critical-paths-manifest.yml` per Wave 4 Session G chunk 4. The script header documents PP-MC2 as its identifier and lists six checks (manifest version, per-entry id/description/surface/coverage/last_verified, exactly-one-of coverage path, test_path exists, gate_path exists, last_verified within 180 days). Manifest exists. This is a **schema gate** — it validates the manifest's shape on every run and has no `.gate-baselines/` file (there is nothing to grandfather; either every entry is well-formed or it isn't). Already `[status:closed:pr:332]` in `tasks/todo.md`.

**Delta for this build:** confirm the gate is in `run-all-gates` and passing on current main. No script change required.

**Acceptance:** gate present in `run-all-gates`; passes against current main.

## 6. Items — Service-tier RLS migration (F3/F4/F7)

### 6.1. The migration pattern

Tenant-table reads/writes in service files currently take the form:
```typescript
const rows = await db.select().from(table).where(eq(table.organisationId, orgId)).limit(10);
```

Migrate to the org-scoped handle returned by the existing primitive:
```typescript
const scopedDb = getOrgScopedDb('callerName.functionName');
const rows = await scopedDb
  .select()
  .from(table)
  .where(eq(table.organisationId, orgId))
  .limit(10);
```

Contract:

- The `withOrgTx(...)` block that opens the transaction and issues `SELECT set_config('app.organisation_id', ...)` is established **upstream** by the HTTP `authenticate` middleware (`server/middleware/auth.ts`, which opens `withOrgTx` and issues the `app.organisation_id` GUC set_config before delegating to the route handler) or the `createWorker(...)` pg-boss wrapper — not by `getOrgScopedDb`. The migration does **not** introduce new `withOrgTx` call sites; it relies on the existing one.
- `getOrgScopedDb('callerName.functionName')` takes a single source string. It returns the in-flight ALS-bound transaction handle. If the caller is reached outside any `withOrgTx(...)` block, it throws `failure('missing_org_context')` (Layer A fail-closed). This makes "is this path actually inside an org context?" a runtime-enforced invariant rather than a reviewer judgement.
- The app-layer `where(eq(table.organisationId, orgId))` predicate **stays in place** as defence-in-depth. The org-scoped transaction (RLS + `app.organisation_id` GUC) is the primary defence; the app-layer predicate is the second line. Removing the app-layer predicate is **out of scope** for this build and would require a separate, narrower spec with explicit per-path proof that the org context is established.
- For each Tier 1 migration, chunk 0 names the entrypoint that establishes the org context (HTTP route + middleware, worker queue + `createWorker`, or a higher-level service already inside `withOrgTx`). If chunk 0 cannot name one, the file is escalated to operator before migration — never silently migrated.

**Intended RLS contract.** For every tenant table that lives in the `RLS_PROTECTED_TABLES` manifest (`server/config/rlsProtectedTables.ts`), the table-level RLS policy rejects any row where the tenant key is not equal to the value of the relevant Postgres GUC. The manifest itself records only `{tableName, schemaFile, policyMigration, rationale}` — it does **not** carry tenant-key metadata. Chunk 0 derives the actual tenant key and policy reference for each tenant table touched by a Tier 1 migration by reading the schema file and the named `policyMigration` SQL, and records the derived `(table, tenant_key, policy_migration)` triple in `tier-categorisation.md`. This grounds the defence-in-depth claim per-table rather than assuming `organisation_id` generically. Combined with the app-layer predicate, a tenant breach requires both the RLS GUC and the predicate to be wrong on the same query — that's the defence-in-depth posture this spec is buying.

### 6.2. Targets

The Track A finding F3 cites ~231 service files importing `db` (per the 2026-05-14 audit; chunk 0 refreshes the count from current main and produces a per-callsite inventory). Not all of these files contain tenant-table queries — many import `db` for sanctioned cross-tenant admin reads (Tier 2, which migrate to `withAdminConnection`) or already use `getOrgScopedDb()` (Tier 3, no work needed).

Architect's chunk 0 produces the authoritative tier categorisation (§8) and migration target list, with separate counts for: files reviewed, raw-`db` callsites found, Tier 1 callsites to migrate, Tier 2 callsites to move to `withAdminConnection` (or annotate with the existing guard-ignore form), and Tier 3 files skipped. The PR summary in §9 reports each of these counts.

### 6.3. F4 — `agentExecutionService.executeRun` residue

Track A F4 specifically calls out `agentExecutionService.executeRun` (now in `server/services/agentExecutionService/` post-#314 split) for mixed-posture queries. The post-split barrel likely still has raw `db` callsites on `organisations`, `subaccounts`, `agent_runs`, `subaccountAgents`. Migrate every Tier 1 callsite to `getOrgScopedDb('agentExecutionService.<function>')`; route any Tier 2 callsite (cross-tenant admin reads) through `withAdminConnection(...)`.

### 6.4. F7 — `skillExecutor.ts:4302` raw `db.update(tasks)`

Now in `server/services/skillExecutor/` post-#311 split. Locate the legacy line-4302 callsite (its current line number after the split is captured by chunk 0) and migrate. If the callsite currently carries a `guard-ignore: with-org-tx-or-scoped-db ...` directive, remove it once the call has been migrated; do not leave residue suppression behind.

## 7. Items — knip.json extension

A starter `knip.json` already lives at repo root (entry: `server/index.ts`, `client/src/main.tsx`, `worker/src/index.ts`, `.claude/hooks/*.js`, `server/config/*.ts`, `scripts/__fixtures__/*`; project glob covers `server/`, `client/src/`, `shared/`, `worker/src/`, `scripts/` `.ts`/`.mjs`, and `.claude/hooks/**/*.js`; existing `ignore` excludes tests, node_modules, dist, migrations). This file is the starting point — extend it to drive the 306 unused-file flags below 30.

Extension targets (chunk 0 confirms which are missing from the starter and adds them):

- Build tooling entry: `vite.config.ts`, `drizzle.config.ts`, and any other config file the build resolves at runtime.
- Dynamic imports allowlist: any module imported via `await import(...)` or `import(...)` expressions (e.g. `docx`, `mammoth`, optional integration deps).
- Generated files: `shared/derived/**` (skipped from analysis since they're regenerated).
- Any additional entry surface (e.g. CLI scripts under `scripts/` that ship as standalone binaries).

After extending, run `knip` and verify the unused-file flag count drops from 306 to under 30. The remaining flags are *candidate* unused-file flags pending follow-up triage (some may still be false positives that need a further config tweak; some will be real dead code). That triage is out of scope for this build and gets a separate follow-up (post-v1) decision.
## 8. Migration tier categorisation

Architect's chunk 0 produces the canonical tier list. Expected shape:

| Tier | Description | Action |
|---|---|---|
| **Tier 1 — must-migrate** | Service touches a tenant-scoped table (`organisations`, `subaccounts`, `agents`, `agent_runs`, `actions`, `audit_events`, `voice_profiles`, etc.) on a tenant-traffic path. App-layer filtering is currently the only defence. | Migrate to `getOrgScopedDb('<callerName>')` running inside the existing upstream `withOrgTx(...)` block. Keep the app-layer `where(eq(table.organisationId, orgId))` predicate as defence-in-depth (§6.1). |
| **Tier 2 — sanctioned bypass** | Service intentionally reads/writes cross-tenant (admin tier, system-tier, audit aggregation, cross-tenant prune, migration scripts). The contract for this path is `server/lib/adminDbConnection.ts::withAdminConnection`, which acquires an admin-capable connection AND emits a structured stderr admin-bypass log entry (`console.warn` with `source` and `reason` metadata; the FK and recursive-transaction constraints on `audit_events` mean the admin path deliberately does *not* insert there). The helper itself does **not** acquire BYPASSRLS — the caller must explicitly run `await tx.execute(sql\`SET LOCAL ROLE admin_role\`)` (a Postgres role with BYPASSRLS) inside the callback for cross-tenant access. The stderr log is grep-able during incident response and captured by the usual log aggregation. | Migrate the callsite to the existing `withAdminConnection({ source, reason }, async tx => { await tx.execute(sql\`SET LOCAL ROLE admin_role\`); /* ...queries... */ })` pattern where cross-tenant access is required. If — and only if — a specific callsite cannot move to `withAdminConnection` (e.g. it lives in a context where the admin connection cannot be wired), retain `db` with one of the three accepted guard-ignore forms enumerated in §4. Each such residue requires an ADR reference or `reason="..."` rationale that an independent reviewer reads in chunk 0. |
| **Tier 3 — already-clean** | Service already uses `getOrgScopedDb()` / `withAdminConnection` or doesn't touch tenant tables. | No work needed |

Expected distribution (architect confirms): roughly Tier 1 = 150-180, Tier 2 = 30-50, Tier 3 = 30-60. Total ≈ 231 files. Per-callsite counts are produced by chunk 0 alongside the per-file count.

**Verdict granularity.** The canonical tier verdict is **per raw-`db` callsite**, not per file. A single service file can legitimately contain both tenant-traffic Tier 1 callsites (migrate to `getOrgScopedDb`) and sanctioned Tier 2 callsites (migrate to `withAdminConnection`); these are common in services that have both a per-tenant route handler and an admin / cron entry point. `tier-categorisation.md` lists every callsite separately with file:line + tier verdict + (for Tier 1) the upstream `withOrgTx` entrypoint or (for Tier 2) the bypass rationale. A file-level rollup may appear as summary metadata in the same artifact, but the per-callsite list is the source of truth.

Migration *chunks* are grouped by domain — each chunk migrates a domain's worth of Tier 1 callsites plus migrates / annotates the domain's Tier 2 callsites, with a per-callsite checklist inside the chunk. Chunk 0 produces the chunk-by-chunk migration list ordered by traffic-criticality (highest-traffic domains first to limit blast radius if anything regresses).

## 9. Acceptance Criteria

A build is complete when ALL of the following hold:

1. All 6 prevention gates are present in `run-all-gates`, baselined where applicable (PP-MC2 has `n/a` baseline as a schema gate per §5.6), and passing on current main (per the per-gate deltas in §5 — some require zero script change, some require re-seeding or source alignment, PP-SK1 is net-new).
2. All Tier 1 callsites with a chunk-0-verified upstream `withOrgTx(...)` block are migrated to use `getOrgScopedDb('<callerName>')`; the app-layer `where(eq(table.organisationId, orgId))` predicate is preserved. Any Tier 1 callsite for which chunk 0 cannot name an upstream `withOrgTx` entrypoint is recorded as **"Tier 1 — blocked, no upstream org context"** in `tier-categorisation.md` and escalated to operator; these are not migrated in this build (per §3 the spec does not introduce new `withOrgTx` call sites, and per §6.1 such callsites are escalated rather than silently migrated). The PR summary in criterion 10 reports the blocked-callsite count alongside the migrated count.
3. All Tier 2 callsites migrated to `withAdminConnection(...)` where the wiring permits. Residue Tier 2 callsites that cannot move (chunk 0 names them) carry the existing `// guard-ignore: with-org-tx-or-scoped-db ADR-<id> <rationale>` (or `reason="..."`) form — no new annotation primitive.
4. `scripts/verify-with-org-tx-or-scoped-db.sh` continues to pass post-migration. The gate already performs per-callsite AST analysis (single-level same-file caller walk via `scripts/lib/with-org-tx-analyser.mjs`); this build does **not** modify the analyser's semantics. If chunk 0 surfaces an analyser-coverage gap, it is raised to operator before any change is proposed.
5. `knip.json` extended; `knip` reports < 30 unused-file flags.
6. `npm run build:server` exits 0.
7. `npm run lint` exits 0.
8. Static gates relevant to the migration pass: at minimum `verify-with-org-tx-or-scoped-db.sh`, `verify-rls-coverage.sh`, `verify-rls-contract-compliance.sh`, and the six prevention gates listed in §5. Runtime tests are not added by this build; for migrated services that already have runtime test coverage, the existing tests are run unchanged and must continue to pass (services without existing tests rely on the static gates + tier-verdict review for acceptance — per the `static_gates_primary` posture from `docs/spec-context.md`).
9. `tasks/todo.md` items PP-CD1, PP-DUP1, PP-SK1, PP-SK2, PP-FE2, and the knip-306 line marked `[status:closed:pr:<num>]` in the merge commit. PP-MC2 is already `[status:closed:pr:332]` per the existing Wave 4 work; this build verifies the gate remains present and passing but does not re-close the item.

  **F3, F4, F7 closure is conditional**: each may be closed only if the blocked-Tier-1 count for the relevant scope is zero (i.e. every Tier 1 callsite had a chunk-0-verified upstream `withOrgTx`). If any blocked Tier 1 callsites remain after operator triage:
   - F3/F4/F7 are NOT closed by this build; the merge commit marks them `[status:partial:pr:<num>:remaining=<n>-blocked-callsites]` and the remaining work spawns a follow-up spec (per §3, primitive changes are out of scope).
   - The PR summary in criterion 10 names every blocked callsite by `file:line` so the follow-up has its target list.
10. PR body includes two summaries:
    - **Migration summary:** "Files reviewed: X. Raw-`db` callsites found: Y. Tier 1 callsites migrated: A. Tier 1 callsites blocked (no upstream org context, escalated to operator): A'. Tier 2 callsites moved to `withAdminConnection`: B. Tier 2 residue annotated with the existing `guard-ignore: with-org-tx-or-scoped-db` form: C. Tier 3 callsites (already clean / no tenant table): D."
    - **Gate verdict summary:** one row per gate (PP-CD1, PP-DUP1, PP-SK1, PP-SK2, PP-FE2, PP-MC2) listing: script path, baseline path (or `n/a — schema gate, no baseline` for PP-MC2), current baseline count (or `n/a` where the baseline path is `n/a`), exit mode (error/warn), forced-failure verification (a one-line note that the gate was confirmed to exit non-zero on an induced violation in a scratch branch). Also include one row for `knip.json` with flag count before/after.

## 10. Chunks (high-level)

Architect refines during plan phase. Expected shape — large build, many small chunks:

- **Chunk 0**: tier categorisation + plan write. Produces:
  - `tasks/builds/wave-5-prevention-gates-and-rls/tier-categorisation.md` listing every raw-`db` callsite as `file:line` with: the callsite (e.g. `db.select().from(agents)`), the tenant key for the table touched (per `RLS_PROTECTED_TABLES`), the tier verdict (Tier 1 / Tier 1 blocked / Tier 2 / Tier 3), and — for Tier 1 — the upstream `withOrgTx(...)` entrypoint that establishes the org context, OR — for Tier 2 — the bypass rationale + chosen suppression form (ADR / `reason="..."` / `withAdminConnection` migration). File-level rollups (file count, callsite count per tier) appear as summary metadata at the top of the file; the per-callsite list below is the source of truth (§8 verdict-granularity rule).
  - Per-gate state confirmation per §5 (current script, baseline path, baseline count or `n/a` for schema gates, exit mode) and the delta required for this build
  - Order of migration chunks (highest-traffic first)
- **Chunks 1-6**: prevention gates — one chunk per gate. PP-CD1 and PP-MC2 require zero script change and reduce to a `run-all-gates` wiring check; PP-SK2 requires no script change but DOES require source alignment for the two grandfathered `universal-skill-sync.txt` entries (operator-chosen direction at chunk 0) followed by baseline cleanup; PP-DUP1 requires baseline re-seed + promotion to error mode; PP-FE2 extends the existing gate's monitored set if chunk 0 finds a gap; PP-SK1 is the only net-new script.
- **Chunks 7-N**: RLS migration, grouped by domain to keep PRs reviewable. Each chunk migrates a domain's Tier 1 callsites and annotates / re-wires the domain's Tier 2 callsites. Suggested grouping:
  - Chunk 7: agent-execution services (agentExecutionService residue + agentExecutionLoop)
  - Chunk 8: skill execution services (skillExecutor handlers — F7)
  - Chunk 9: workflow services (workflowEngine residue post-#319)
  - Chunk 10: billing / cost services (cost ledger, llmRouter, costAggregates)
  - Chunk 11: personal-assistant services (PA-V1 + V2)
  - Chunk 12: sandbox services
  - Chunk 13: integration services (calendar, slack, crm, etc.)
  - Chunk 14: remaining Tier 1 services (architect names)
  - Chunk 15: Tier 2 annotation sweep (intentional bypasses)
- **Chunk N+1**: knip.json extension + flag triage
- **Chunk N+2**: spec-conformance + pr-reviewer + reality-checker + final review pass

(Note: no separate chunk to "widen the P2 guard" — the existing analyser already does per-callsite AST analysis; this build relies on it without modification. If chunk 0 surfaces an analyser-coverage gap that requires a script change, a new chunk is added then.)

Total: 18-22 chunks. Architect may split per-domain chunks further if a domain has > 30 service files.

## 11. Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| Some Tier 1 migrations regress behaviour because the org-scoped handle semantics differ from raw `db` in an unexpected way | medium | Each chunk's PR review re-reads the migrated callsite against the original query and confirms the rewrite preserves semantics (same selected columns, same predicates, same join shape, same limit/order). Services with existing runtime tests run them unchanged; services without runtime tests rely on static gates + spec-conformance review per the `static_gates_primary` posture (§9.8). If chunk 0 surfaces a callsite whose semantics cannot be statically verified, it is escalated to operator before migration. |
| Tier 2 categorisation is wrong (a "sanctioned bypass" was actually a missed migration) | medium | Each Tier 2 callsite migrates to `withAdminConnection({ source, reason }, ...)`, which emits a structured stderr admin-bypass log entry (`console.warn` with `source` + `reason` metadata) on every invocation — grep-able during incident response and captured by the usual log aggregation. The admin path deliberately does NOT insert into `audit_events` (FK / recursive-tx constraints on that table). Tier 2 residue that cannot move retains one of the three accepted guard-ignore forms enumerated in §4 so the bypass is explicit at code-review time. An independent reviewer reads every Tier 2 entry in chunk 0's `tier-categorisation.md`. |
| `getOrgScopedDb` / `withAdminConnection` don't support some query patterns currently used in raw `db` (e.g. cross-tenant joins, raw SQL templates) | low-medium | Chunk 0 includes a feature-parity audit against the existing primitives. If a gap surfaces on a **tenant-traffic Tier 1 callsite**, the spec is paused and the gap is raised to operator — primitive changes are out of scope per §3 and require a separate spec; the callsite is NOT silently downgraded to Tier 2. If the gap surfaces on a **genuinely sanctioned cross-tenant callsite** that cannot move to `withAdminConnection` for unrelated reasons (e.g. it lives in a context where the admin connection cannot be wired), it remains as Tier 2 residue with an explicit ADR or `reason="..."` rationale per §4 / §8. The distinction is which side of the tenant boundary the callsite is on — tenant-traffic callsites escalate; sanctioned bypasses stay as Tier 2. |
| The 231-file migration is bigger than estimated and overruns timeline | high | Build is Major-class with built-in chunking. If a chunk's per-domain count exceeds 30 files, split further. Operator may pause the build at any chunk boundary if confidence drops. |
| Branch goes stale during 5-7 day build window because other PRs merge to main | medium | Architect's chunk 0 includes a daily `git fetch origin main + merge` discipline. S2 sync at each chunk boundary. |
| Gate baselines drift because Wave 5 Session K's tasks.ts await-fix lands AFTER this build's chunk 0 captured baselines | low | Coordinate with Session K: K finishes its tasks.ts await fixes FIRST. N's chunk 0 captures baselines AFTER K's merge. Sequencing handled in the launch prompts. |

## 12. Out of Scope

The following stay v2-backlog or are addressed in other sessions:

- **Capabilities registry backfill** — Session L scope.
- **LAEL Phase 1+2 + Hermes Tier 1** — Session M scope.
- **Wave 4 carry-forward debt** — Session K scope.
- **CI workflow consolidation** — Session K scope.
- **PA-V1 worth-confirming, sandbox advisory, IEE-DEF, OSI-DEF future-state** — v2-backlog per Wave 1/2 operator decisions.
- **188 `: any` ratchet** — let `verify-any-budget.sh` ratchet naturally.
- **~80 unused exports in `shared/types/*`** — per-export manual cross-check, v2-backlog.

## 13. File-overlap deconfliction

This session runs concurrently with Sessions K, L, M. File-overlap analysis:

- **Session K** (cleanup + CI): touches `server/services/skillExecutor/handlers/tasks.ts` for W4AA-DEBT-15 await fixes. **Session N is likely to touch the same file** for RLS migration (Tier 1 candidate). COORDINATION: K finishes first; N's chunk 0 captures baselines AFTER K merges. The PP-AE2 gate seeding (covered by Wave 4 G already) is unaffected.
- **Session K** also owns **W4AA-DEBT-1** — the resolution of the 17 orphan `ACTION_REGISTRY` entries (either creating skill stubs or removing the entries). **PP-SK1's baseline seeding (`mismatch-count:0`) depends on this work landing first.** COORDINATION: K's W4AA-DEBT-1 merges BEFORE N's chunk 0 seeds PP-SK1; if W4AA-DEBT-1 slips, PP-SK1's chunk is reordered to land after K's merge and the rest of N's work proceeds in parallel.
- **Session K** touches `server/services/llmRouter/routeCall.ts:449` (T1 metric). **Session N may touch this file** for RLS migration. COORDINATION: same as above — K first, N's chunk 0 after.
- **Session L** (capabilities backfill): zero overlap with N.
- **Session M** (LAEL + Hermes): touches `server/services/agentExecutionService/*` for emission sites. **Session N also touches these files** for F4 RLS residue. COORDINATION: Architect chunk 0 produces an explicit per-file merge order — for each shared file, chunk 0 names which session lands first and the other session rebases onto it. The "M adds new lines, N edits existing lines" property reduces conflict surface but does not eliminate it; the per-file ordering is the deconfliction contract, not git's auto-merge.

**Hard rule**: if a merge conflict surfaces during N's RLS migration chunks, STOP and surface to operator before resolving. Tenant-isolation code is too sensitive for an automated conflict resolution.

**Migration order priority**: Tier 1 high-traffic services FIRST (agent-execution, workflow, billing). Tier 2 annotation sweep LAST. This way, if the build runs long, the most-critical surfaces are protected first.
