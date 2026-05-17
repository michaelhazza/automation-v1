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

Single coordinated PR. Major-class. Combines two final pre-prod hardening workstreams: (1) seed 6 baselined prevention gates that lock in invariants for future development, and (2) migrate all 231 service-tier `db` callsites on tenant-scoped tables to `getOrgScopedDb()` — closing the defence-in-depth gap permanently before production traffic.

This is the final architectural pre-v1 build. After this lands, the codebase is in the cleanest pre-feature state it can be.

---

## 1. Scope

Closes the following `tasks/todo.md` items:

- **Prevention gates (6)**: PP-CD1, PP-DUP1, PP-SK1, PP-SK2, PP-FE2, PP-MC2
- **Service-tier RLS migration (3 findings, ~231 files)**: F3, F4, F7
- **knip configuration (1)**: knip.json authorship closes ~250 of 306 false-positive flags

**Total: ~10 items, but F3/F4/F7 cover ~231 files of mechanical migration.**

## 2. Goals

1. Seed 6 baselined warn-gates so future PRs cannot regress on cycles, duplication, skill-registry drift, frontend complexity, or critical-path coverage. Each gate captures current main as its baseline; any net-new violation fails the PR.
2. Migrate every service-tier `db.<verb>(<tenant_table>)` callsite to `getOrgScopedDb()`. After this build, raw `db` calls on tenant tables are forbidden by gate (P2 widen) outside an explicit `guard-ignore` annotation.
3. Author `knip.json` to close the 306 unused-file flags (most are false positives — config files, dynamic imports, build outputs). Target: under 30 real flags remaining after this PR.
4. Defence-in-depth on tenant isolation is permanent. App-layer `where(eq(table.organisationId, ...))` filtering is no longer the only line of defence.

## 3. Non-Goals

- No behaviour change in any migrated service. Each migration preserves the original query semantics; only the connection pool wrapper changes.
- No new features, no schema changes, no new tables, no new permissions.
- No drive-by lint cleanup outside the targets above.
- No changes to the `getOrgScopedDb()` implementation itself (it works; this build just adopts it).
- No changes to the RLS policies on tables (policies already exist; this build wires the connection-side enforcement).
- No work on items deferred to v2-backlog: 188 `: any` ratchet, ~80 unused exports in `shared/types/*`, PA-V1 worth-confirming, sandbox advisory, IEE-DEF, OSI-DEF.

## 4. Framing Assumptions

- Repo is pre-production. The pre-prod window is the cheapest time to do the RLS migration; post-prod migrations cost 5-10x more due to rolling deploys and customer impact.
- `getOrgScopedDb()` is the canonical scoped-read primitive (defined in `server/lib/orgScopedDb.ts` — architect confirms path during chunk 0). It opens a transaction, sets `app.organisation_id` GUC, and runs queries within scope.
- The 231-file count comes from Track A finding F3 (audit 2026-05-14). Architect's chunk 0 produces a fresh count from current main and partitions into three tiers (§8).
- TypeScript strict mode is on. Existing tsconfig path mapping is immutable.
- Some service files intentionally bypass RLS (admin tier, system-tier reads, cross-tenant audit). These are categorised as Tier 2 (intentional bypass, documented) and stay on raw `db` with an explicit `guard-ignore: rls-intentional-bypass` annotation + WHY comment.
- Some service files already use `getOrgScopedDb()` and need no work — they're in Tier 3.
- Repo is pre-prod per `docs/spec-context.md`; testing posture is `static_gates_primary`. New unit tests authored only for new pure helpers; existing test suite verifies migrated services preserve semantics.
## 5. Items — Prevention gates

Each gate captures current main as a baseline file under `scripts/.gate-baselines/`. Any net-new violation fails the PR. Existing violations stay grandfathered until ratcheted down by future work.

### 5.1. PP-CD1 — `scripts/verify-no-new-cycles.sh` (warn-gate)

This gate exists per Wave 1 prevention proposal P11 but currently runs as warning-only. Promote to error mode and seed baseline.

Baseline: current `madge --circular --json` output (post-Wave-4 likely close to 0 server cycles thanks to CD1 super-cycle break, plus a small number of small cycles that survived). Architect captures exact count at chunk 0.

Acceptance: gate seeded; passes against current main; fails on a forced new cycle.

### 5.2. PP-DUP1 — `scripts/verify-no-new-duplicate-blocks.sh` (jscpd baseline gate)

Author new gate that runs `jscpd --min-tokens 50 --min-lines 10` against `server/` and `client/src/`. Baseline current duplicated-line count (Wave 2 audit reported 4,298 server + 3,495 client; Wave 4 reduced both by ~1,800 client). Architect captures exact post-Wave-4 count.

Acceptance: gate seeded; passes against current main; fails on a forced new duplication.

### 5.3. PP-SK1 — `scripts/verify-skill-registry-alignment.sh`

Author new gate that:
1. Reads `scripts/snapshots/action-registry.snapshot.json` (the authoritative `ACTION_REGISTRY` snapshot).
2. Reads all `.md` files under `server/skills/`.
3. Asserts the symmetric set: every registry key has a corresponding `.md` file (after applying the X.Y ↔ X_Y rule from W4AA-DEBT-2), and every `.md` file has a registry entry.
4. Allowlist methodology-only `.md` files under `docs/methodologies/` (decision from W4 G chunk 0).

Acceptance: gate seeded; passes against current main (after K's W4AA-DEBT-1 creates stubs or removes the 17 orphan entries).

### 5.4. PP-SK2 — Bidirectional `UNIVERSAL_SKILL_NAMES` ↔ `ACTION_REGISTRY.isUniversal` lint

Pre-existing `scripts/verify-universal-skill-sync.sh` (P7 from Wave 1) covers one direction. Extend to verify the bidirectional invariant: every `isUniversal:true` entry in registry is in `UNIVERSAL_SKILL_NAMES`, AND every name in `UNIVERSAL_SKILL_NAMES` has a registry entry with `isUniversal:true`.

Acceptance: bidirectional check passes; gate exits 0 against current main.

### 5.5. PP-FE2 — `scripts/verify-page-complexity-budget.sh`

Author new gate that scans `client/src/pages/**/*.tsx`, counts component imports per page (`MetricCard`, `Sparkline`, `Chart*`, `Stat*`, plus the canonical KPI literals named in `docs/frontend-design-principles.md § Complexity budget per screen`), and fails on pages exceeding the documented budget unless they carry an explicit `// frontend-design: admin-only-acceptance` or equivalent header annotation.

Baseline: post-Wave-4 FE state (FE1/4/5/6 either trimmed or documented-acceptance).

Acceptance: gate seeded; passes against current main.

### 5.6. PP-MC2 — `scripts/verify-critical-path-coverage.sh`

Author new gate consuming `tasks/critical-paths-manifest.yml` (the manifest authored by Wave 4 Session G chunk 4). Asserts each critical path declares either:
- a named test file (path must exist), OR
- a named gate (path must exist), OR
- a documented `wont-test` rationale (one-line free text).

Acceptance: manifest exists from Wave 4; gate seeded; passes against current main.

## 6. Items — Service-tier RLS migration (F3/F4/F7)

### 6.1. The migration pattern

For each tenant-table query of the form:
```typescript
const rows = await db.select().from(table).where(eq(table.organisationId, orgId)).limit(10);
```

Convert to:
```typescript
const scopedDb = await getOrgScopedDb(orgId, 'callerName.functionName');
const rows = await scopedDb.select().from(table).limit(10);
// app-layer where(eq(table.organisationId, orgId)) is no longer needed
// but MAY be kept as defence-in-depth — operator decision in chunk 0
```

The wrapper opens a transaction, sets `app.organisation_id` GUC, runs the query. RLS policies on `table` reject any row where `organisation_id != current_setting('app.organisation_id')`.

### 6.2. Targets

The Track A finding F3 cites 231 service files importing `db`. Not all 231 are tenant-table queries — many import `db` for cross-tenant admin reads (Tier 2) or have already migrated (Tier 3).

Architect's chunk 0 produces the authoritative tier categorisation (§8) and migration target list.

### 6.3. F4 — `agentExecutionService.executeRun` residue

Track A F4 specifically calls out `agentExecutionService.executeRun` (now in `server/services/agentExecutionService/` post-#314 split) for mixed-posture queries. The post-split barrel likely still has raw `db` callsites on `organisations`, `subaccounts`, `agent_runs`, `subaccountAgents`. Migrate every one to `getOrgScopedDb()`.

### 6.4. F7 — `skillExecutor.ts:4302` raw `db.update(tasks)`

Now in `server/services/skillExecutor/` post-#311 split. Locate the legacy line-4302 callsite and migrate. Remove the `guard-ignore-next-line` annotation if the trust chain cleans up.

## 7. Items — knip.json authorship

Author `knip.json` at repo root configured for the project's actual entry points:

- Server entry: `server/index.ts`
- Client entry: `client/src/main.tsx`
- Worker entry: `worker/src/index.ts` (or equivalent)
- Build tooling: `vite.config.ts`, `drizzle.config.ts`, etc.
- Dynamic imports allowlist: any module imported via `await import()` or `import()` (e.g., the `docx`, `mammoth`, `pg` optional deps)
- Test files: `**/__tests__/**`, `**/*.test.ts`, `**/*.test.tsx`
- Migration scripts: `migrations/**`
- Generated files: `shared/derived/**`

After authoring, run `knip` and verify the unused-file flag count drops from 306 to under 30. The remaining flags are genuinely unused (real dead code) — they get a separate follow-up (post-v1) decision.
## 8. Migration tier categorisation

Architect's chunk 0 produces the canonical tier list. Expected shape:

| Tier | Description | Action |
|---|---|---|
| **Tier 1 — must-migrate** | Service touches a tenant-scoped table (`organisations`, `subaccounts`, `agents`, `agent_runs`, `actions`, `audit_events`, `voice_profiles`, etc.) on a tenant-traffic path. App-layer filtering is currently the only defence. | Migrate to `getOrgScopedDb()` |
| **Tier 2 — intentional bypass** | Service intentionally reads/writes cross-tenant (admin tier, system-tier, audit aggregation, cross-tenant prune, migration scripts). | Annotate `// guard-ignore: rls-intentional-bypass` + WHY comment |
| **Tier 3 — already-clean** | Service already uses `getOrgScopedDb()` or doesn't touch tenant tables. | No work needed |

Expected distribution (architect confirms): roughly Tier 1 = 150-180, Tier 2 = 30-50, Tier 3 = 30-60. Total ≈ 231.

The migration is per-service. Each service file gets one chunk in the plan. Chunk 0 produces the chunk-by-chunk migration list ordered by traffic-criticality (highest-traffic services first to limit blast radius if anything regresses).

## 9. Acceptance Criteria

A build is complete when ALL of the following hold:

1. All 6 prevention gates seeded and passing on current main.
2. All Tier 1 services migrated to `getOrgScopedDb()`.
3. All Tier 2 services annotated with `guard-ignore: rls-intentional-bypass` + WHY comment.
4. `scripts/verify-with-org-tx-or-scoped-db.sh` widened (per Wave 1 Track A prevention P2): flags any new `db.<verb>(<tenant_table>)` in `server/services/` without a sibling `getOrgScopedDb()` call OR an explicit `guard-ignore` annotation. Baseline accepts current main after migration.
5. `knip.json` authored; `knip` reports < 30 unused-file flags.
6. `npm run build:server` exits 0.
7. `npm run lint` exits 0.
8. Existing test suite passes (no behaviour regression in migrated services).
9. `tasks/todo.md` items F3, F4, F7, PP-CD1, PP-DUP1, PP-SK1, PP-SK2, PP-FE2, PP-MC2, and the knip-306 line marked `[status:closed:pr:<num>]` in the merge commit.
10. PR body includes a per-service-tier summary: "Tier 1: X migrated, Tier 2: Y annotated, Tier 3: Z skipped, total: 231 files reviewed".

## 10. Chunks (high-level)

Architect refines during plan phase. Expected shape — large build, many small chunks:

- **Chunk 0**: tier categorisation + plan write. Produces:
  - `tasks/builds/wave-5-prevention-gates-and-rls/tier-categorisation.md` listing every service file with tier verdict
  - Order of migration chunks (highest-traffic first)
- **Chunks 1-6**: prevention gates (1 chunk per gate)
- **Chunks 7-N**: RLS migration, grouped by domain to keep PRs reviewable. Suggested grouping:
  - Chunk 7: agent-execution services (agentExecutionService residue + agentExecutionLoop)
  - Chunk 8: skill execution services (skillExecutor handlers — F7)
  - Chunk 9: workflow services (workflowEngine residue post-#319)
  - Chunk 10: billing / cost services (cost ledger, llmRouter, costAggregates)
  - Chunk 11: personal-assistant services (PA-V1 + V2)
  - Chunk 12: sandbox services
  - Chunk 13: integration services (calendar, slack, crm, etc.)
  - Chunk 14: remaining Tier 1 services (architect names)
  - Chunk 15: Tier 2 annotation sweep (intentional bypasses)
- **Chunk N+1**: widen `verify-with-org-tx-or-scoped-db.sh` (P2)
- **Chunk N+2**: knip.json + flag triage
- **Chunk N+3**: spec-conformance + pr-reviewer + reality-checker + final review pass

Total: 18-22 chunks. Architect may split per-domain chunks further if a domain has > 30 service files.

## 11. Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| Some Tier 1 migrations regress behaviour because `getOrgScopedDb` semantics differ from raw `db` in an unexpected way | medium | Each chunk's PR review includes manual verification of the migrated callsite's existing test coverage. If a service has no test, architect surfaces it during chunk 0; operator decides whether to add a test or accept the risk. |
| Tier 2 categorisation is wrong (a "intentional bypass" was actually a missed migration) | medium | Each Tier 2 entry requires a WHY comment that an independent reviewer reads. The `guard-ignore: rls-intentional-bypass` annotation makes the bypass explicit in code review. |
| `getOrgScopedDb` doesn't support some query patterns currently used in raw `db` (e.g., cross-tenant joins, raw SQL templates) | low-medium | Architect's chunk 0 includes a feature-parity audit. If gaps surface, EITHER extend `getOrgScopedDb` (preferred) OR document the gap and add to Tier 2 with explicit rationale. |
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
- **Session K** touches `server/services/llmRouter/routeCall.ts:449` (T1 metric). **Session N may touch this file** for RLS migration. COORDINATION: same as above — K first, N's chunk 0 after.
- **Session L** (capabilities backfill): zero overlap with N.
- **Session M** (LAEL + Hermes): touches `server/services/agentExecutionService/*` for emission sites. **Session N also touches these files** for F4 RLS residue. COORDINATION: Architect-level — if both M and N target the same file, M's emission additions are surgical (add new lines, no edits to existing lines) while N's migration changes existing lines. Git merge handles this naturally if architect orders chunks so M's emission chunks land before N's RLS chunks on the same file, OR vice versa with explicit chunk 0 sequencing.

**Hard rule**: if a merge conflict surfaces during N's RLS migration chunks, STOP and surface to operator before resolving. Tenant-isolation code is too sensitive for an automated conflict resolution.

**Migration order priority**: Tier 1 high-traffic services FIRST (agent-execution, workflow, billing). Tier 2 annotation sweep LAST. This way, if the build runs long, the most-critical surfaces are protected first.
