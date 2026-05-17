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
- **Prevention gate hardening (1 item)**: P3 — Windows-portable harness test for `scripts/verify-*.sh`

**Total: ~11 items, but the 1,108-callsite migration is the dominant work.**

## 2. Goals

1. Fix the Windows path resolution bug in `scripts/verify-with-org-tx-or-scoped-db.sh` so the gate reports consistent counts across Linux CI and local Windows dev. After this fix, the published baseline matches reality on both platforms.
2. Audit every gate under `scripts/verify-*.sh` for the same `find → temp → Node existsSync` pattern. Confirmed bug-affected gates so far: `verify-with-org-tx-or-scoped-db.sh`, `verify-no-direct-boss-work.sh`. Audit produces the full bug-affected list at chunk 0; each affected gate gets the same fix.
3. Migrate every remaining Tier 1 callsite among the 1,108 residue per the same tier-categorisation pattern as Wave 5 Session N (Tier 1 must-migrate / Tier 2 intentional bypass annotated / Tier 3 already-clean). After this build, the `with-org-tx-or-scoped-db` gate baseline drops to 0 on BOTH Linux and Windows.
4. Author P3 (Windows-portable harness test) so this class of bug cannot recur. For each gate, the harness runs on a freshly-cloned repo (Linux CI is sufficient — goal is OS-parity behaviour) and asserts exit ∈ {0, 1, 2} AND non-empty stdout.

## 3. Non-Goals

- No changes to `getOrgScopedDb()`, `withOrgTx()`, `withAdminConnection()` implementations. Same primitives Wave 5 used.
- No new features, no schema changes (RLS policies already exist; this build wires the connection-side enforcement).
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
- Some callsites the Wave 5 gate skipped on Windows may already have been correctly migrated; chunk 0 verifies. Likely distribution: ~700-900 genuine Tier 1 to migrate, ~100-200 Tier 2 annotation, remainder Tier 3 already-clean.
## 5. Items — Gate honesty fix (must land first)

### 5.1. Fix `scripts/verify-with-org-tx-or-scoped-db.sh` Windows path resolution

Root cause: the gate's pipeline `find ... | TMP_FILES | Node analyser` returns POSIX-style paths on Windows git-bash (`/c/Files/.../actionService.ts`) that Node's `fs.existsSync` rejects, causing the analyser to silently skip every file and report 0 violations.

Fix options (architect chooses during chunk 0):
- **Option A**: convert paths with `cygpath -w` before writing to `TMP_FILES`. Minimal change; relies on `cygpath` being available in CI.
- **Option B (preferred)**: rewrite the analyser to use `fast-glob` or `globby` from Node directly. No shell `find` at all. Slightly bigger change; OS-portable by construction.

Acceptance:
- Gate produces the same violation count on Linux CI AND Windows local dev (within a 5-line tolerance for legitimate OS-specific paths).
- Published baseline reflects Linux truth (no Windows shortcut).
- Targeted Vitest pins the path-handling pure helper if one is extracted.

**THIS FIX LANDS FIRST.** All subsequent migration chunks depend on the gate reporting honest counts.

### 5.2. Capture honest baseline

After §5.1 lands, capture the post-fix Linux baseline. Wave 5 published 0; reality is 1,108 (per tasks/todo.md line 1860). The "1,108" figure refines to the chunk-0 verified count.

Update `scripts/.gate-baselines/with-org-tx-or-scoped-db.txt` to reflect honest current state. Subsequent migration chunks ratchet this number down.

## 6. Items — Other gates with the same bug pattern

### 6.1. Audit every `scripts/verify-*.sh` for the same bug

Pattern: `find ... | pipe-to-temp-file | Node script using fs.existsSync`. Run each gate on Linux CI vs Windows local; diff the violation counts. Any gate where Linux count exceeds Windows count is candidate for the same bug.

**Confirmed bug-affected so far**: 
- `verify-with-org-tx-or-scoped-db.sh` (Wave 5 evidence — 1,108 violations hidden)
- `verify-no-direct-boss-work.sh` (Wave 5 evidence — 4 entries visible only on Linux)

Architect's chunk 0 produces the full audit list. Each bug-affected gate gets the same Option B fix (`fast-glob` / `globby` from Node).

Acceptance: every gate under `scripts/verify-*.sh` produces consistent counts on Linux + Windows.

### 6.2. Author P3 — Windows-portable harness test

New `scripts/test-gate-portability.sh` (or `.github/workflows/gate-portability.yml`) that:
- For each gate, runs on a freshly-cloned repo
- Asserts exit ∈ {0, 1, 2} AND non-empty stdout
- Linux CI is sufficient — goal is OS-parity behaviour, not literal Windows runner provisioning

Acceptance: harness runs in CI; any new gate that silently dies under `set -euo pipefail` + path-handling quirks fails the harness.

## 7. Items — RLS migration residue (1,108 callsites)

### 7.1. The migration pattern (unchanged from Wave 5 Session N)

For each tenant-table query of the form:
```typescript
const rows = await db.select().from(table).where(eq(table.organisationId, orgId)).limit(10);
```

Convert to:
```typescript
const scopedDb = getOrgScopedDb('callerName.functionName');
const rows = await scopedDb.select().from(table).limit(10);
// app-layer where(eq(table.organisationId, orgId)) STAYS as defence-in-depth
// per Wave 5 §6.1 spec decision
```

The wrapper retrieves the ALS-bound scoped transaction (which was already opened by the upstream `authenticate` middleware or `createWorker` wrapper). RLS policies enforce `organisation_id = current_setting('app.organisation_id')` at the database layer.

### 7.2. F3 / F4 / F7 — completion of Wave 5 partials

Wave 5 Session N's tier categorisation marked these as "must-migrate" but the Windows-blinded gate let some land unmigrated:
- **F3**: `verify-rls-contract-compliance.sh` allowlist on `server/services/` masks raw-db usage at service tier — broader than just one service
- **F4**: `agentExecutionService` post-#314 split — some lifecycle phase modules still have raw `db` calls
- **F7**: `skillExecutor` post-#311 split — `db.update(tasks)` write at the legacy line:4302 callsite

Chunk 0 produces the per-callsite location list from the post-#5.1 honest gate output.

### 7.3. WF1 / WF3 / WF4 / WF6 — workflowEngine residue

Wave 5 Session N migrated workflow services per its tier list, but the Windows-blinded gate let some land unmigrated:
- **WF1**: 5 FK-scoped tenant tables (workflow_step_runs, workflow_step_reviews, workflow_studio_sessions, workflow_run_event_sequences, flow_step_outputs) need RLS policies. Wave 5 may have added the policies; verify against current main. If still missing, author migration.
- **WF3**: `workflowEngineService.ts` raw `db` callsites
- **WF4**: workflow tick worker `resolveOrgContext: () => null` pattern
- **WF6**: `workflowAgentRunHook.ts:36-39` raw `db.select` on `agent_runs`

Chunk 0 verifies which are landed vs which are residue.
## 8. Migration tier categorisation

Same rules as Wave 5 Session N §8. Architect's chunk 0 produces the per-callsite verdict (per-callsite, not per-file — per Wave 5 spec decision codified at §8 of Wave 5 N spec, captured 2026-05-16 Codex iter2 #2):

| Tier | Description | Action |
|---|---|---|
| **Tier 1 — must-migrate** | Callsite touches a tenant-scoped table on a tenant-traffic path. Upstream entrypoint (authenticate middleware or createWorker wrapper) verified. | Convert to `getOrgScopedDb('source')` |
| **Tier 2 — intentional bypass** | Cross-tenant by design (admin tier, system-tier audit aggregation, cross-tenant prune, migration scripts). | Annotate with one of the three guard-ignore forms per Wave 5 §4 framing + WHY comment + ADR-ref. Migrate connection acquisition to `withAdminConnection({source, reason}, async tx => {...})` if not already. |
| **Tier 3 — already-clean** | Uses `getOrgScopedDb()` today OR doesn't touch tenant tables. | No work needed |
| **Tier 1-blocked** | Tier 1 callsite for which chunk 0 cannot name a concrete upstream entrypoint of the required shape. | **STOP. Escalate to operator.** No automated migration; F3/F4/F7 closure conditional on blocked-count == 0. |

Expected distribution from 1,108 residue: ~700-900 Tier 1, ~100-200 Tier 2, remainder Tier 3 + blocked. Chunk 0 confirms.

## 9. Acceptance Criteria

A build is complete when ALL of the following hold:

1. `scripts/verify-with-org-tx-or-scoped-db.sh` reports the same violation count on Linux CI and Windows local dev (within 5-line tolerance).
2. Every gate audited per §6.1 either passes the OS-parity test OR has the same fix applied.
3. P3 (Windows-portable harness) lands; runs in CI.
4. All Tier 1 callsites migrated to `getOrgScopedDb()`. Honest baseline drops to 0 (or to the count of Tier 1-blocked callsites with operator-confirmed deferral).
5. All Tier 2 callsites have `// guard-ignore: with-org-tx-or-scoped-db` annotation + WHY comment + ADR reference.
6. `npm run build:server` exits 0.
7. `npm run build:client` exits 0.
8. `npm run lint` exits 0.
9. Existing test suite passes (no behaviour regression in migrated services).
10. Tier 1-blocked count = 0 (or operator-explicit deferral with rationale logged).
11. `tasks/todo.md` items F3/F4/F7/WF1/WF3/WF4/WF6/P3 + the 3 Wave 6 follow-ups marked `[status:closed:pr:<num>]` in the merge commit.
12. PR body includes a per-service-tier summary AND a per-gate verdict table (mirrors Wave 5 §9 acceptance #10).

## 10. Chunks (high-level)

Architect refines during plan phase. Expected shape — Major build, many chunks:

- **Chunk 0**: gate honesty fix design + per-callsite tier categorisation + plan write. Produces:
  - `tasks/builds/wave-6-rls-residue-and-gate-fix/gate-fix-design.md` (Option A vs B decision)
  - `tasks/builds/wave-6-rls-residue-and-gate-fix/tier-categorisation.md` listing every residue callsite
  - `tasks/builds/wave-6-rls-residue-and-gate-fix/gate-audit-results.md` listing every bug-affected gate
  - Migration order: highest-traffic services FIRST
- **Chunk 1**: Apply gate honesty fix (§5.1). MUST LAND FIRST. All subsequent chunks depend on honest counts.
- **Chunk 2**: Audit + fix other gates (§6.1-6.2). P3 portability harness.
- **Chunks 3-N**: RLS migration residue, grouped by domain to keep PRs reviewable. Suggested grouping:
  - Chunk 3: agent-execution residue (F4 completion)
  - Chunk 4: skill-execution residue (F7 completion)
  - Chunk 5: workflow services (WF1/3/4/6 completion)
  - Chunk 6: billing / cost services
  - Chunk 7: personal-assistant services residue
  - Chunk 8: sandbox services residue
  - Chunk 9: integration services residue
  - Chunks 10-12+: remaining Tier 1 services (architect partitions by domain)
  - Chunk 13: Tier 2 annotation sweep
- **Chunk N+1**: Tier 1-blocked escalation review (operator confirms each deferral with rationale)
- **Chunk N+2**: spec-conformance + pr-reviewer + reality-checker + final review pass

Total: 15-20 chunks. If any per-domain chunk exceeds 50 files, split further.

## 11. Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| Some residue callsites are genuinely cross-tenant (admin tier) but the original developer didn't annotate. Architect's chunk 0 categorisation surfaces them. | high | Each Tier 2 verdict requires a WHY comment + ADR reference. Reviewer scrutinises rationale. |
| Tier 1-blocked count > 0 because some callsite path has no upstream `authenticate` / `createWorker` entrypoint (e.g., scheduled jobs that need a new entrypoint). | medium | If chunk 0 surfaces this, build pauses and operator decides: (a) extend an existing entrypoint, (b) accept the blocked-count as v2-backlog with explicit rationale, (c) defer the entire callsite. |
| The Option B fix (fast-glob / globby) introduces a new npm dependency that conflicts with knip.json | low | Both libraries are widely-used, pinned in package.json. Chunk 0 audits the addition. |
| Wave 5's "0 baseline" claim being wrong creates trust loss with the operator | already-happened | Mitigated by surfacing the correction explicitly in this spec's preamble and by Wave 6's per-gate verdict table. |
| Branch goes stale during the multi-day build window | high | Daily `git fetch origin main + merge` discipline. S2 sync at each chunk boundary. |
| Concurrent Wave 6 sessions (P knip triage, Q cleanup) touch the same residue files | medium | File-overlap deconfliction documented in §13. Q's stale-status sweep waits until O's chunk 0 categorisation publishes. |

## 12. Out of Scope

- LAEL Phase 3 retention tiering (v2-backlog)
- Hermes H2 rollup-vs-ledger asymmetry (v2-backlog)
- 188 `:any` ratchet (let `verify-any-budget.sh` ratchet naturally)
- IEE-DEF (dead-code pending live traffic)
- OSI-DEF future-state operator-session items
- Sandbox advisory waiting on e2b SDK
- The operator's 1-2 features (Wave 6 Session R, separate branches)

## 13. File-overlap deconfliction

This session runs concurrently with Sessions P (knip triage) and Q (cleanup batch), plus Session R (operator's feature). File-overlap analysis:

- **Session P (knip triage)**: touches mostly `client/src/components/**` (101 candidates) and `server/{routes,services}/<deprecated-file>.ts` (~33 server candidates). **Limited overlap with O** — most knip candidates are dead code paths that wouldn't have raw `db` callsites. Confirm via chunk 0.
- **Session Q (cleanup batch)**: touches `scripts/*` (gate baselines), `server/services/*` (stale-status verification only — no actual edits), `client/src/components/*` (19 duplicate exports drop), `shared/types/page.ts` (pagePreview/pageServing type moves). **Overlap with O** on `server/services/*` is verification-only — Q reads, O writes. **Hard coordination**: Q's chunk 0 stale-status sweep WAITS until O publishes chunk-0 tier categorisation, then Q's status flips reflect O's verdicts.
- **Session R (operator's feature)**: operator-scoped, file-overlap unknown until R's spec lands. If R touches services that overlap with O's migration, R rebases on O OR architect coordinates merge order. **Recommendation**: R's chunk 0 reads O's tier-categorisation.md before drafting its plan.

**Hard rule (carried from Wave 5)**: any merge conflict on tenant-isolation code (Session O RLS chunks) requires operator review — no automated conflict resolution.

**Migration priority within O**: Tier 1 high-traffic services FIRST (agent-execution, workflow, billing). Tier 2 annotation sweep LAST. If the build runs long, the most-critical surfaces are protected first.
