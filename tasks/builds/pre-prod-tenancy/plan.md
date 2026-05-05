# Pre-Prod Tenancy Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every multi-tenant data-isolation gap still open at branch tip on `pre-prod-tenancy` (3 phases) — drive `verify-rls-protected-tables.sh` to exit 0, replace per-row advisory-lock pattern in `measureInterventionOutcomeJob` with a DB-level UNIQUE constraint + `ON CONFLICT DO NOTHING`, and (conditionally) upgrade three maintenance jobs from outer-admin-tx + savepoint to per-org `withOrgTx`.

**Architecture:** Three sequential phases, each with its own commit cadence and review evidence. Phase 1 wires the gate first (creating a documented red-CI window), then ships manifest edits + new policy migrations + allow-list additions to drive the gate to 0. Phase 2 ships migration `0244` (UNIQUE index with `ACCESS EXCLUSIVE` lock) plus a pre-check + load-test deliverable to `progress.md`. Phase 3 splits `withAdminConnection` into an enumeration tx + per-org `withOrgTx` calls, gated on a mandatory advisory-lock audit recorded in three places (commit message, PR description, `progress.md`).

**Tech Stack:** Drizzle ORM, PostgreSQL (transactional DDL, RLS policies, advisory locks), TypeScript on Node, existing job harness, existing `withOrgTx` / `withAdminConnection` / `getOrgScopedDb` primitives. No new libraries, no new feature flags, no new env vars.

**Spec source:** [`docs/superpowers/specs/2026-04-29-pre-prod-tenancy-spec.md`](../../../docs/superpowers/specs/2026-04-29-pre-prod-tenancy-spec.md) — Round 7 (locked).
**Migration range reserved:** `0244–0255` (latest on `main` is `0243`).
**Sister branches (DO NOT edit their files):** `pre-prod-boundary-and-brief-api`, `pre-prod-workflow-and-delegation` — see spec §0.4 for the boundary list.

---

## Pre-flight context the implementer must internalise

Read these once before touching any task. They are not steps; they are framing.

1. **Gates are CI-only.** Per `CLAUDE.md`, `npm run test:gates`, `bash scripts/run-all-gates.sh`, and `bash scripts/verify-*.sh` are forbidden as local invocations. Every gate-status reference in this plan is read from CI output. Local commands the implementer DOES run: `npm run lint`, `npx tsc --noEmit -p server/tsconfig.json`, `npm run build:server` (Phase 2 only), and `npx tsx <pure-test-path>` (targeted to THIS change).
2. **Append-only migrations.** Never edit historical migration files. Every fix is a new migration in `0244–0255`.
3. **Spec round/SHA citation rule.** Every `progress.md` section header MUST cite `[spec round 7 — commit <sha>]`. Get the SHA via `git log -1 --format=%h docs/superpowers/specs/2026-04-29-pre-prod-tenancy-spec.md` at the time of authoring.
4. **`progress.md` is a deliverable, not a scratchpad.** Missing or inconsistent entries are blocking review-time rejects. Every `progress.md` entry is committed in the SAME commit as the code change it justifies, OR in an immediately preceding commit. Post-hoc entries are rejected.
5. **No auto-commits, no auto-pushes from the main session.** The implementer commits explicitly after reviewing the diff; only review agents auto-commit within their own flows.
6. **Squash-on-merge for the Phase 1 PR.** The intermediate red-CI commits inside the branch are for in-branch reviewability, not main's history.
7. **Phase 1 rollback invariant.** Every `0245+` migration must be individually revertible. Each table block in a multi-table file MUST include its OWN `-- rollback:` comment immediately before that table's `CREATE POLICY` — never a single rollback block at the top of a multi-table file. The comment MUST record the prior RLS state so rollback does not accidentally disable RLS that existed before this migration:
   ```
   -- prior RLS state: <enabled+forced (no policy) | enabled (no force, no policy) | disabled (no policy)>
   -- rollback: DROP POLICY <name> ON <table>; [ALTER TABLE <table> NO FORCE ROW LEVEL SECURITY; if FORCE was newly added] [ALTER TABLE <table> DISABLE ROW LEVEL SECURITY; ONLY if RLS was newly enabled here — omit otherwise]
   ```
   To determine prior state, run before authoring: `psql -c "SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = '<table>';"`. This prevents partial lock-in of bad policies AND prevents rollback from regressing pre-existing RLS coverage.
8. **All RLS migrations must be re-runnable without error.** The `DROP POLICY IF EXISTS ... ; CREATE POLICY ...` shape already enforces this — treat it as a stated invariant, not a style choice. Required for CI retries and failed-deploy recovery.
9. **Migration-number rebase check (before first `0245+` commit).** Confirm `main`'s latest migration number has not advanced past `0244` since spec authoring. Run: `ls migrations/*.sql | sort | tail -5`. If `main` has a migration numbered `0244` or higher already, rebase the reserved range before authoring any `0245+` files to avoid merge conflicts late in the branch.

---

## Files to change (single source of truth — mirrors spec §2)

### New migrations (range `0244–0255`)

| Number | Path | Purpose | Phase |
|---|---|---|---|
| `0244` | `migrations/0244_intervention_outcomes_unique.sql` | `CREATE UNIQUE INDEX intervention_outcomes_intervention_unique` (replaces non-unique `intervention_outcomes_intervention_idx`). Holds `ACCESS EXCLUSIVE` for the migration's tx lifetime. | Phase 2 |
| `0244.down` | `migrations/0244_intervention_outcomes_unique.down.sql` | Reverse: drop unique, recreate non-unique on `intervention_id`. | Phase 2 |
| `0245+` | `migrations/0245_<batch>_rls.sql` … (up to `0255`) | Policy migrations for tables classified `register-with-new-policy`. One migration file = one policy shape. Canonical org-isolation: ≤ 4 tables per file. Parent-EXISTS: 1 table per file. | Phase 1 |

### Source files modified

| Path | Change | Phase |
|---|---|---|
| `scripts/run-all-gates.sh` | Add `run_gate "$SCRIPT_DIR/verify-rls-protected-tables.sh"` after the existing `verify-rls-*` block (line 76 in current `main`). FIRST commit on the branch. | Phase 1 |
| `server/config/rlsProtectedTables.ts` | Append `register` + `register-with-new-policy` entries; remove the 4 stale entries (`document_bundle_members`, `reference_document_versions`, `task_activities`, `task_deliverables`). | Phase 1 |
| `scripts/rls-not-applicable-allowlist.txt` | Append `allowlist`-verdict entries (sorted alphabetically by table name) with rationale + `[ref: ...]` per the file's header format rules. Single commit (or domain-split if > 20 entries). | Phase 1 |
| `server/services/systemMonitor/baselines/refreshJob.ts` | Move existing `// allowRlsBypass: ...` comment to within ±1 line of the `allowRlsBypass: true` flag (line 39). | Phase 1 |
| `server/services/systemMonitor/triage/loadCandidates.ts` | Add inline `// allowRlsBypass: <one-sentence justification naming the cross-org operation>` comment within ±1 line of the flag (line 45). | Phase 1 |
| `server/db/schema/interventionOutcomes.ts` | Replace `interventionIdx: index('intervention_outcomes_intervention_idx').on(...)` (line 35) with `interventionUnique: uniqueIndex('intervention_outcomes_intervention_unique').on(...)`. Add `uniqueIndex` to the drizzle import. | Phase 2 |
| `server/services/interventionService.ts` | `recordOutcome` signature `Promise<void>` → `Promise<boolean>`; `db.insert(...).values(...)` → `.onConflictDoNothing({ target: interventionOutcomes.interventionId })`; return `(result.rowCount ?? 0) > 0`. | Phase 2 |
| `server/jobs/measureInterventionOutcomeJob.ts` | Replace lines 254–267 (per-row `db.transaction` + `pg_advisory_xact_lock` + claim-verify) with a single `await interventionService.recordOutcome(decision.recordArgs!)` returning `boolean`. Remove the `import { sql }` if no longer used; verify no other `sql` references remain in the file before removing. | Phase 2 |
| `server/jobs/ruleAutoDeprecateJob.ts` | Split outer admin tx into enumeration tx + per-org `withOrgTx`. | Phase 3 |
| `server/jobs/fastPathDecisionsPruneJob.ts` | Same pattern. | Phase 3 |
| `server/jobs/fastPathRecalibrateJob.ts` | Same pattern. | Phase 3 |

### Tests added / extended

| Path | Phase | Notes |
|---|---|---|
| `server/jobs/__tests__/measureInterventionOutcomeJobPure.test.ts` (extend if exists; create if not) | Phase 2 | Pure-only: assert `decideOutcomeMeasurement` returns identical `recordArgs` shape pre- vs. post-refactor. No DB. |
| `server/jobs/__tests__/<jobName>Pure.test.ts` (extend each, only if pure tests already exist) | Phase 3 | Pure-only: assert org enumeration produces the same ordered list of org IDs and per-org function invocation count matches enumerated org count. |

### Build artefacts (committed in this branch but outside `server/` / `client/`)

| Path | Change | Phase |
|---|---|---|
| `tasks/builds/pre-prod-tenancy/progress.md` | Implementer-authored deliverable. See per-phase sections for required entries. | Phase 1 + 2 + 3 |
| `tasks/todo.md` | Append entries under existing `## Deferred from pre-prod-tenancy spec` heading for any deferral. | Phase 1 + 2 + 3 |
| `.github/pull_request_template.md` | Append the allow-list bypass grep-output prompt. One-time edit; lands with §3.4.3 caller-fix commit. | Phase 1 |

---

## Table of contents

- **Phase 1 — RLS protected-tables registry triage** (`SC-2026-04-26-1`) — Tasks 1.1 → 1.11
- **Phase 2 — `intervention_outcomes` UNIQUE + ON CONFLICT** (`CHATGPT-PR203-R2`) — Tasks 2.1 → 2.7
- **Phase 3 — Per-org `withOrgTx` defense-in-depth** (`B10`, optional, see §5.5) — Tasks 3.1 → 3.8
- **Closing — Rollout & PR** — Tasks C.1 → C.4
- **Deferred items** — captured during implementation
- **Self-review summary**

---

# Phase 1 — RLS protected-tables registry triage (`SC-2026-04-26-1`)

**Phase goal:** Drive `verify-rls-protected-tables.sh` to exit 0 in CI on the post-merge `pre-prod-tenancy` head. 67 violations at branch tip = 61 unregistered tenant tables + 4 stale registry entries + 2 caller-level `allowRlsBypass`-justification-comment violations.

**Phase ordering invariant:** Wire the gate FIRST. Every subsequent commit on the branch is then CI-evaluated against the gate. Expected state during sub-tasks 1.3 → 1.9: gate is RED in CI; every other gate must remain GREEN. Spec §3.5.1 documents this red-CI window.

**Phase deliverables (all in `tasks/builds/pre-prod-tenancy/progress.md`):**
- §3.4.1 classification table with one verdict per row (filled before any policy-migration commit).
- Pre-flight migration-number count (before the first `0245+` commit).
- Mutual-exclusion check output (`comm -12` between manifest and allow-list, empty = pass).

---

### Task 1.1: Wire `verify-rls-protected-tables.sh` into the gate harness (FIRST commit)

**Files:**
- Modify: `scripts/run-all-gates.sh:74-77` (insert after the existing `verify-rls-*` block)

- [ ] **Step 1: Read the current gate-harness block to anchor the insertion.**

Read [`scripts/run-all-gates.sh`](../../../scripts/run-all-gates.sh) lines 73–77. The existing block is:

```bash
# ── Sprint 2 (P1.1 + P1.2) gates from docs/improvements-roadmap-spec.md ──
run_gate "$SCRIPT_DIR/verify-rls-coverage.sh"
run_gate "$SCRIPT_DIR/verify-rls-contract-compliance.sh"
run_gate "$SCRIPT_DIR/verify-rls-session-var-canon.sh"
run_gate "$SCRIPT_DIR/verify-job-idempotency-keys.sh"
```

The new line goes immediately after `verify-rls-session-var-canon.sh` (so the four `verify-rls-*` gates are grouped) and before `verify-job-idempotency-keys.sh`.

- [ ] **Step 2: Insert the new gate line.**

Use Edit:

- `old_string`: `run_gate "$SCRIPT_DIR/verify-rls-session-var-canon.sh"\nrun_gate "$SCRIPT_DIR/verify-job-idempotency-keys.sh"`
- `new_string`: `run_gate "$SCRIPT_DIR/verify-rls-session-var-canon.sh"\nrun_gate "$SCRIPT_DIR/verify-rls-protected-tables.sh"\nrun_gate "$SCRIPT_DIR/verify-job-idempotency-keys.sh"`

- [ ] **Step 3: Confirm insertion locally.**

Run: `grep -n "verify-rls-protected-tables" scripts/run-all-gates.sh`
Expected output: one line, e.g. `77:run_gate "$SCRIPT_DIR/verify-rls-protected-tables.sh"`. Two or more matches = duplicate insertion; revert and re-edit.

- [ ] **Step 4: Lint clean.**

Run: `npm run lint`
Expected: clean (a shell-script edit shouldn't affect lint, but confirm no incidental staged changes broke it).

- [ ] **Step 5: Commit.**

```bash
git add scripts/run-all-gates.sh
git commit -m "$(cat <<'EOF'
feat(pre-prod-tenancy): wire verify-rls-protected-tables.sh into gate harness

Phase 1 step 1 of pre-prod-tenancy spec §3.5. Wiring the gate first means
every subsequent branch commit is CI-evaluated against it; the resulting
known-red CI window is documented in spec §3.5.1.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

> **CI expectation from this commit forward:** `verify-rls-protected-tables.sh` reports RED in CI; every other gate reports GREEN. If any other gate goes RED on this commit, STOP — that's a real regression. Do not proceed until it's GREEN again.

---

### Task 1.2: Author the §3.4.1 classification deliverable to `progress.md`

**Files:**
- Create or extend: `tasks/builds/pre-prod-tenancy/progress.md`

- [ ] **Step 1: Get the spec SHA for the citation.**

Run: `git log -1 --format=%h docs/superpowers/specs/2026-04-29-pre-prod-tenancy-spec.md`
Expected: a 7–8-char commit hash (e.g. `8374492a`). Save this — it goes in every `progress.md` section header authored in this phase.

- [ ] **Step 2: Read the latest CI gate output to confirm the 67-violation set.**

Open the most recent CI run for the branch tip (after Task 1.1 lands) and copy the `verify-rls-protected-tables.sh` output. The gate emits `[GATE] verify-rls-protected-tables.sh: violations=67` plus a per-violation listing. The 61 unregistered tables, 4 stale entries, and 2 caller-level violations should match spec §3.4.1 / §3.4.2 / §3.4.3. If the count differs, the table set has shifted since spec authoring — STOP and add a `## Pre-classification baseline delta` paragraph noting the new count and which tables are added/removed vs. the spec's 67-entry list, then proceed against the new set.

- [ ] **Step 3: Append the classification section to `progress.md`.**

Append the following structure, then fill the verdict / notes columns by walking the §3.3 decision tree against each row. Read the spec's §3.3 + §3.3.1 rubric and §3.4.1 authoring posture before filling.

```markdown
## Phase 1 — RLS registry triage classification ([spec round 7 — commit <sha-from-step-1>])

### Pre-flight summary
- Branch tip CI gate count: 67 violations (61 unregistered + 4 stale + 2 caller-level)
- Authored by: <implementer name / agent-run id>
- Date: <YYYY-MM-DD>

### §3.4.1 — Unregistered tenant tables (61)

| Table | Owning migration | Has policy? | Verdict | Notes |
|---|---|---|---|---|
| account_overrides | <fill> | <fill> | <register | register-with-new-policy | allowlist> | <fill — for parent-EXISTS: parent table + FK col; for allowlist: rationale + spec-anchor citation per §3.3.1> |
| action_events | <fill> | <fill> | <fill> | <fill> |
| ... (all 61 rows from spec §3.4.1, in spec order) ... | | | | |
| workflow_engines | <fill> | <fill> | registry-edit-only | Sister-branch-owned (§0.4) — no new policy migration here. |
| workflow_runs | <fill> | <fill> | registry-edit-only | Same sister-branch scope-out. |
| workspace_entities | <fill> | <fill> | <fill> | <fill> |
| workspace_health_findings | <fill> | <fill> | <fill> | <fill> |
| workspace_items | <fill> | <fill> | <fill> | <fill> |
| workspace_memory_entries | <fill> | <fill> | <fill> | <fill> |

### §3.4.2 — Stale registry entries (4)
- `document_bundle_members` → drop (parent `document_bundles` policied via 0213 + 0228)
- `reference_document_versions` → drop (policied via 0229)
- `task_activities` → drop after `tasks` USING+WITH CHECK confirmation (Task 1.4)
- `task_deliverables` → drop after `tasks` USING+WITH CHECK confirmation (Task 1.4)

### §3.4.3 — Caller-level violations (2)
- `server/services/systemMonitor/baselines/refreshJob.ts:39` — move existing comment from line 37 onto line 38
- `server/services/systemMonitor/triage/loadCandidates.ts:45` — add inline justification within ±1 line
```

For each row, run:

```bash
grep -lE "CREATE TABLE[[:space:]]+\"?<table>\"?" migrations/*.sql
grep -nE "CREATE POLICY .* ON \"?<table>\"?" migrations/*.sql
```

Apply the §3.3 decision tree:
- **Has policy + tenant-private** → `register`
- **No policy + tenant-private** → `register-with-new-policy`
- **No policy + system-wide / cross-tenant / audit-only** → `allowlist` (MUST cite §3.3.1 anchor in notes)

The §3.3.1 tie-breaker: when in doubt, classify as `tenant-private`.

- [ ] **Step 4: Run the pre-flight migration-number count.**

Count the `register-with-new-policy` rows in the §3.4.1 output. Apply §2.1.1 batching (canonical: ≤ 4/file; parent-EXISTS: 1/file).

Append to `progress.md`:

```markdown
### Phase 1 migration-number pre-flight count
- register-with-new-policy verdicts: <N> tables
- Canonical-shape tables (batched up to 4 per file): <C> tables → ceil(C/4) files
- Parent-EXISTS tables (1 file each):                <P> tables → P files
- Total 0245+ migration files needed:                ceil(C/4) + P = <T>
- Available migration slots (0245–0255):             11
- Outcome: <T <= 11 → no overflow, proceed | T > 11 → STOP rule triggered (§6 hard rules)>
```

If `T > 11`, STOP. Surface the overflow to the user with the deferred-table list before pushing further commits — see spec §6 hard rules for the deferred-rescope block format.

- [ ] **Step 5: Commit the classification deliverable.**

```bash
git add tasks/builds/pre-prod-tenancy/progress.md
git commit -m "$(cat <<'EOF'
docs(pre-prod-tenancy): classification deliverable + pre-flight count (Phase 1 §3.4.1)

Spec §3.4.1 classification table filled with verdicts per the §3.3 decision tree.
Pre-flight migration-number count appended per §6.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

> **Lock invariant:** Once the first `0245+` migration commit lands (Task 1.6), the verdicts in this `progress.md` table are LOCKED. Reclassification mid-flight requires reverting the affected migration commit first — see spec §3.4.1 progress-table-lock note.

---

### Task 1.3: Drop the 4 stale registry entries

**Files:**
- Modify: `server/config/rlsProtectedTables.ts`

- [ ] **Step 1: Read the current entries to confirm line numbers.**

Run: `grep -n "document_bundle_members\|reference_document_versions\|task_activities\|task_deliverables" server/config/rlsProtectedTables.ts`

- [ ] **Step 2: Remove the 4 entries.**

For each table, use Edit to remove the entire entry object (`{ tableName: '<table>', schemaFile: '<...>', policyMigration: '<...>', rationale: '<...>' },` block). The `tasks/*` entries are removed only after Task 1.4 confirms the `tasks` parent has both `USING` and `WITH CHECK` clauses.

If Task 1.4 has NOT YET completed, drop only `document_bundle_members` and `reference_document_versions` here, and split the `task_activities` / `task_deliverables` removal into a separate commit after Task 1.4. Do NOT speculatively drop the task entries — a USING-only parent policy on `tasks` would mean the children need parent-EXISTS migrations, not registry drops.

- [ ] **Step 3: Verify removal.**

Run: `grep -n "document_bundle_members\|reference_document_versions" server/config/rlsProtectedTables.ts`
Expected: no matches.

- [ ] **Step 4: TypeScript clean.**

Run: `npx tsc --noEmit -p server/tsconfig.json`
Expected: no errors. (Removing array entries should not break compile; if it does, an unrelated drift exists — fix or escalate.)

- [ ] **Step 5: Commit.**

```bash
git add server/config/rlsProtectedTables.ts
git commit -m "$(cat <<'EOF'
fix(pre-prod-tenancy): drop 2 of 4 stale registry entries (Phase 1 §3.4.2)

document_bundle_members and reference_document_versions are parent-FK-scoped;
parents are policied (0213+0228 and 0229 respectively). Schema walker cannot
see parent-EXISTS scoping, so the gate flagged these as stale.

task_activities + task_deliverables removal deferred to Task 1.4-followup
pending USING+WITH CHECK confirmation on the `tasks` parent.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 1.4: Verify `tasks` parent has both USING and WITH CHECK clauses

**Files:**
- Read-only: `migrations/*.sql`
- Modify: `server/config/rlsProtectedTables.ts` (drop remaining 2 stale entries OR ship parent-EXISTS migration)
- Append: `tasks/builds/pre-prod-tenancy/progress.md`

- [ ] **Step 1: Locate the `tasks` policy.**

Run: `grep -nE "CREATE POLICY .* ON \"?tasks\"?" migrations/*.sql`

- [ ] **Step 2: Read the policy block.**

Open each match and read the full policy. The block MUST contain both `USING (...)` AND `WITH CHECK (...)` clauses, each gated on `organisation_id = current_setting('app.organisation_id', true)::uuid` (plus the canonical non-null guards from spec §2.1).

- [ ] **Step 3: Decide and document the verdict.**

Append to `progress.md`:

```markdown
### Task 1.4 — `tasks` parent USING + WITH CHECK verification ([spec round 7 — commit <sha>])

- Policy migration: `migrations/<file>.sql`
- USING clause present: <yes | no>
- WITH CHECK clause present: <yes | no>
- Verdict: <drop-children-from-registry | ship-parent-EXISTS-migration-for-children | escalate>
```

- [ ] **Step 4a (verdict = drop children): drop the two task children from the registry.**

Use Edit on `server/config/rlsProtectedTables.ts` to remove `task_activities` + `task_deliverables` entries. Commit alongside the `progress.md` entry:

```bash
git add server/config/rlsProtectedTables.ts tasks/builds/pre-prod-tenancy/progress.md
git commit -m "$(cat <<'EOF'
fix(pre-prod-tenancy): drop remaining 2 stale registry entries (Phase 1 §3.4.2)

Confirmed `tasks` parent policy has both USING and WITH CHECK clauses
(see progress.md). Children task_activities + task_deliverables are correctly
scoped via parent-FK; gate was flagging them as stale because the schema
walker cannot see parent-EXISTS scoping.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4b (verdict = ship parent-EXISTS): ship a `0245+` migration for the children, do NOT drop registry entries.**

This branch defers to Task 1.6 (the policy-migration phase). Update the §3.4.1 classification table verdicts for these tables to `register-with-new-policy` and re-run the pre-flight count (Task 1.2 step 4) — adding two parent-EXISTS files may push the count over 11 and trigger §6's STOP rule.

- [ ] **Step 4c (verdict = escalate): STOP and surface to the user.**

If the `tasks` parent has only `USING` and no `WITH CHECK`, the parent itself is partially-policied. This is out of scope for this branch — surface as an architectural finding via `triage-agent: idea: tasks parent missing WITH CHECK`, defer with an entry in `tasks/todo.md § Deferred from pre-prod-tenancy spec`, and proceed to Task 1.5 leaving `task_activities` / `task_deliverables` entries IN the registry (the gate will continue to flag them as stale; the deferred-items entry documents why this is intentional).

---

### Task 1.5: Append `register` (policy-already-exists) entries to the manifest

**Files:**
- Modify: `server/config/rlsProtectedTables.ts`

**Cap: max 15 manifest entries per commit.** Multiple commits if total `register` count exceeds 15. Each commit is reviewable row-by-row.

- [ ] **Step 1: For each table whose verdict in `progress.md` is `register`, write the manifest entry.**

Each new entry follows the existing shape (read the file to confirm the current convention before authoring):

```ts
{
  tableName: '<table>',
  schemaFile: 'server/db/schema/<file>.ts',
  policyMigration: 'migrations/<existing-migration-with-CREATE-POLICY>.sql',
  rationale: '<one-sentence rationale citing the policy migration>',
},
```

- [ ] **Step 2: TypeScript clean.**

Run: `npx tsc --noEmit -p server/tsconfig.json`
Expected: clean.

- [ ] **Step 3: Commit (one commit per ≤ 15-entry batch).**

```bash
git add server/config/rlsProtectedTables.ts
git commit -m "$(cat <<'EOF'
fix(pre-prod-tenancy): register N tenant tables with existing policies (Phase 1 §3.5 step 3)

Batch <i> of <total>. Each entry's policyMigration field cites the migration
that added the CREATE POLICY block. See tasks/builds/pre-prod-tenancy/progress.md
for the per-table classification.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 1.6: Author + apply `register-with-new-policy` migrations (`0245+`)

**Files:**
- Create: `migrations/0245_<batch>_rls.sql` … (up to `0255`), one file per commit.
- Modify: `server/config/rlsProtectedTables.ts` (manifest entries pointing at each new migration)

**Migration shape — canonical org-isolation (≤ 4 tables per file):**

```sql
-- migrations/0245_<batch-name>_rls.sql
ALTER TABLE <table_1> ENABLE ROW LEVEL SECURITY;
ALTER TABLE <table_1> FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS <table_1>_org_isolation ON <table_1>;
CREATE POLICY <table_1>_org_isolation ON <table_1>
  USING (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  )
  WITH CHECK (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  );

-- repeat the ALTER + DROP POLICY + CREATE POLICY block for each additional table
-- in this batch, up to 4 tables. Each block is self-contained.
```

**Migration shape — parent-EXISTS (one table per file):**

Use the shape from `migrations/0229_reference_documents_force_rls_parent_exists.sql:49-67`. The block MUST include parent-EXISTS in BOTH `USING` and `WITH CHECK` clauses.

**Hard invariant before authoring a parent-EXISTS migration (per spec §2.1):**

- [ ] **Step 1 (parent-EXISTS only): verify FK NOT NULL against migration history AND Drizzle schema.**

Run: `grep -nE "<fk_column>[^,]*NOT NULL" migrations/*.sql` against the child's CREATE TABLE migration AND any subsequent ALTER COLUMN migrations. Then read the Drizzle schema file and confirm the field has `.notNull()`. The two MUST agree. If they disagree, escalate to the user — DO NOT assume the schema file is authoritative.

If the FK is nullable, the table is NOT a parent-EXISTS candidate. Either add an `organisation_id` column via a separate migration and use the canonical shape, or defer to a follow-up branch with a §9 deferred-items entry.

If multiple parent tables OR'd via multiple `EXISTS` clauses are needed, escalate — the spec forbids OR'd parent-EXISTS clauses (widens access by design).

**Performance invariant (parent-EXISTS only):** Parent-EXISTS policies must only be used when the FK column is indexed and the parent table is small or indexed on the join key. Add a comment immediately below the `-- rollback:` block in the migration:
```sql
-- performance note: FK <fk_column> is indexed (see migration <N>); parent table <parent> is <small reference table | indexed on <col>>
```
If the FK is not indexed, do NOT author the parent-EXISTS migration — add a separate index migration first, or reclassify the table as `allowlist` with escalation to the user.

- [ ] **Step 2: Author the migration.**

Use the canonical-or-parent-EXISTS shape above. One file = one shape (no mixing). Up to 4 canonical-shape tables per file. Parent-EXISTS files are always solo.

- [ ] **Step 3: Generate the Drizzle migration metadata if needed.**

Run: `npm run db:generate`
Expected: this updates `migrations/meta/_journal.json` and creates the metadata sidecar. Verify the new migration file is picked up.

If `db:generate` rewrites your hand-authored SQL, prefer the existing convention used by `0227–0229` (hand-authored `.sql` files committed alongside the meta updates) — read those migrations to confirm the convention before relying on `db:generate`.

- [ ] **Step 4: Apply the migration to the dev DB.**

Run: `npm run db:migrate` (or whatever the project's apply command is — confirm by reading `package.json` `scripts`).
Expected: migration applies cleanly. Re-run is a no-op (the `DROP POLICY IF EXISTS ... ; CREATE POLICY ...` shape is idempotent).

- [ ] **Step 5: Append matching manifest entries.**

Update `server/config/rlsProtectedTables.ts` with one entry per table this migration policied. The `policyMigration` field cites the new file. Same shape as Task 1.5.

- [ ] **Step 6: TypeScript clean.**

Run: `npx tsc --noEmit -p server/tsconfig.json`
Expected: clean.

- [ ] **Step 7: Commit (one commit per migration file + its manifest entries).**

```bash
git add migrations/0245_<batch-name>_rls.sql server/config/rlsProtectedTables.ts
# include migrations/meta/_journal.json if db:generate updated it
git commit -m "$(cat <<'EOF'
feat(pre-prod-tenancy): add RLS policy migration 0245 for <batch-name> tables

Canonical org-isolation policy for <list of N tables>. Manifest entries appended.
See tasks/builds/pre-prod-tenancy/progress.md §3.4.1 for the per-table verdict.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 8: Repeat steps 1–7 for each subsequent `0246+` migration.**

> **Coverage gate invariant:** Every `0245+` migration file MUST have matching manifest entries committed in the same commit. `verify-rls-coverage.sh` will fail if a policy migration lacks a manifest entry — this is the mechanism that ties new policy migrations to the gate. Failing to include the manifest entry in the same commit will turn the coverage gate RED.

> **Locked-table reminder:** Once this first `0245+` migration commits, the §3.4.1 verdicts in `progress.md` are LOCKED. If a later table needs reclassification, revert the affected migration commit first, update the verdict, then re-author.

---

### Task 1.7: Append `allowlist` entries to `scripts/rls-not-applicable-allowlist.txt`

**Files:**
- Modify: `scripts/rls-not-applicable-allowlist.txt`
- Modify: each caller file of an allow-listed table (function-level annotations)

**Single commit, holistic review.** Sort entries alphabetically. If > 20 entries, split by coherent domain (e.g. system-monitor tables in one commit, reference-data tables in another) — never split alphabetically.

- [ ] **Step 1: Read the existing allowlist file's header for the format rules.**

Open `scripts/rls-not-applicable-allowlist.txt`. Read the header (lines ~1–60). The 4-rule format requires: one-sentence rationale, `[ref: ...]` citation to invariant ID or spec section, function-level `@rls-allowlist-bypass: <table> <fn-name> [ref: ...]` annotation at every caller.

- [ ] **Step 2: For each `allowlist`-verdict table, append the entry.**

Format (paste verbatim, substituting actual table + rationale):

```
<table>  # <one-sentence rationale citing why RLS doesn't apply>  [ref: <invariant-id-or-spec-section>]
```

Sort all new entries alphabetically by table name within the appended block.

- [ ] **Step 3: For each allowlisted table, enumerate callers and add the function-level annotation.**

For each table:

```bash
grep -nE "<table_name>" server/
```

For each caller, add a function-level comment immediately above the function declaration:

```ts
// @rls-allowlist-bypass: <table_name> <fnName> [ref: <invariant-id-or-spec-section>]
async function fnName(...) { ... }
```

The `<fnName>` MUST match the immediately-following function declaration verbatim (allowlist file header rule 4).

- [ ] **Step 4: Run the mutual-exclusion check.**

Spec §3.3.1 hard invariant: a given table name MUST appear in the manifest OR the allowlist, never both. Run:

```bash
comm -12 <(awk '{print $1}' scripts/rls-not-applicable-allowlist.txt | sort -u) <(grep -oE "tableName: '\K[^']+" server/config/rlsProtectedTables.ts | sort -u)
```

Expected output: empty (no overlap). Non-empty output names offending tables — reconcile by deciding which lane is correct, removing from the wrong file, and re-running the check before commit.

Append the check output (empty or not) to `progress.md`:

```markdown
### Mutual-exclusion check ([spec round 7 — commit <sha>])
Command: comm -12 ...
Output: <empty | tables: ...>
Verdict: <pass | resolved by removing X from Y>
```

- [ ] **Step 4b: Allowlist growth check.**

Count new entries being added. Append to `progress.md`:

```markdown
### Allowlist growth ([spec round 7 — commit <sha>])
- Entries before this PR: <N>
- Entries added this PR: <M>
- Justification for growth: <each new entry is bounded by the §3.3.1 criteria; no table enters without a unique-invariant rationale>
```

Any new allowlisted table must not increase the allowlist size without justification recorded here. Unchecked allowlist growth silently bypasses RLS coverage.

- [ ] **Step 5: TypeScript clean.**

Run: `npx tsc --noEmit -p server/tsconfig.json`
Expected: clean.

- [ ] **Step 6: Commit.**

```bash
git add scripts/rls-not-applicable-allowlist.txt server/<every-caller-file-modified>.ts tasks/builds/pre-prod-tenancy/progress.md
git commit -m "$(cat <<'EOF'
fix(pre-prod-tenancy): allow-list N system-wide tables + caller annotations (Phase 1 §3.5 step 5)

N tables added to scripts/rls-not-applicable-allowlist.txt with rationale
+ [ref:] citation. Each caller function carries the @rls-allowlist-bypass
annotation per the 4-rule format in the allowlist file's header.

Mutual-exclusion check (manifest ∩ allowlist) returns empty.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 1.8: Resolve §3.4.3 caller-level violations on `systemMonitor` files

**Files:**
- Modify: `server/services/systemMonitor/baselines/refreshJob.ts`
- Modify: `server/services/systemMonitor/triage/loadCandidates.ts`

- [ ] **Step 1: Read the current state of `refreshJob.ts:35–42`.**

The existing comment at line 37 is two lines above the `allowRlsBypass: true` flag at line 39. The gate's heuristic enforces ±1 line.

- [ ] **Step 2: Move the comment.**

Use Edit to relocate the comment from line 37 to line 38 (immediately above the flag). Do NOT change the substantive justification — it is already specific (`cross-tenant aggregate reads against agent_runs / agents`).

- [ ] **Step 3: Read the current state of `loadCandidates.ts:42–48`.**

There is no inline justification comment within ±1 line of the flag at line 45.

- [ ] **Step 4: Add the comment.**

Use Edit to add a comment immediately above the `allowRlsBypass: true` flag. The substantive text MUST name the cross-org operation (the gate rejects vague text like `needed`, `admin work`).

Suggested wording (verify against the actual call site's intent before committing):

```ts
// allowRlsBypass: cross-org candidate enumeration for triage scheduler
allowRlsBypass: true,
```

- [ ] **Step 5: TypeScript clean.**

Run: `npx tsc --noEmit -p server/tsconfig.json`
Expected: clean.

- [ ] **Step 6: Commit.**

```bash
git add server/services/systemMonitor/baselines/refreshJob.ts server/services/systemMonitor/triage/loadCandidates.ts
git commit -m "$(cat <<'EOF'
fix(pre-prod-tenancy): inline allowRlsBypass justifications on systemMonitor (Phase 1 §3.4.3)

Move/add the inline justification comment within ±1 line of allowRlsBypass:true
on refreshJob.ts:39 and loadCandidates.ts:45 so the gate's heuristic surfaces them.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 1.9: Update `.github/pull_request_template.md` for allow-list grep prompt

**Files:**
- Modify: `.github/pull_request_template.md`

- [ ] **Step 1: Read the current template.**

Open `.github/pull_request_template.md`.

- [ ] **Step 2: Append the prompt.**

Add (near the end of the template, after the existing testing/verification sections):

```markdown
### RLS allow-list query touches (if applicable)

If this PR touches a query against an RLS-not-applicable allow-list table,
paste `grep -nE "@rls-allowlist-bypass" <each touched file>` output here:

```
(paste output, or write `n/a — no allow-list table queries touched`)
```
```

- [ ] **Step 3: Commit (alongside Task 1.8 commit if both land same session).**

```bash
git add .github/pull_request_template.md
git commit -m "$(cat <<'EOF'
docs(pre-prod-tenancy): PR template prompts allow-list grep output (spec §2.6, §7.5)

One-time edit — every future PR that touches an allow-list-table query
must paste grep -nE "@rls-allowlist-bypass" output per the spec §7.5
continuous-enforcement contract.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 1.10: Confirm the gate exits 0 on the branch tip in CI

- [ ] **Step 1: Push all Phase 1 commits.**

```bash
git push origin pre-prod-tenancy
```

- [ ] **Step 2: Wait for CI to complete.**

Open the CI run for the latest commit. DO NOT run the gate locally — per CLAUDE.md it is CI-only. The implementer's job here is to read the CI output, not invoke the harness.

- [ ] **Step 3: Confirm `verify-rls-protected-tables.sh` reports GREEN.**

Read the gate-suite output. The acceptance line is `[GATE] verify-rls-protected-tables.sh: violations=0` (or equivalent for the harness format).

If the gate is still RED:
- Read the per-violation list from the CI output.
- For unregistered-table violations: a manifest entry is missing or the policy migration didn't actually policy a table the manifest claims it does. Open the migration and the manifest, reconcile.
- For caller-level violations: a comment is outside the ±1-line window. Re-check the line numbers.
- For stale-registry violations: a removed entry was re-added by an unrelated edit. Search the diff for `tableName: '<stale>'`.
Fix in one or more follow-up commits and re-push.

- [ ] **Step 4: Confirm every other gate is GREEN.**

Read the CI run's gate summary. Every gate other than `verify-rls-protected-tables.sh` must be GREEN at this point. If any is RED, fix it before opening the PR — this is no longer the documented red-CI window.

- [ ] **Step 5: Append the acceptance entry to `progress.md`.**

```markdown
### Phase 1 acceptance ([spec round 7 — commit <sha>])
- CI gate `verify-rls-protected-tables.sh` exit code: 0 (GREEN)
- Other gates affected: `verify-rls-coverage.sh` (must remain GREEN — every new policy migration creates a manifest entry)
- Commit at acceptance: <sha>
- CI run: <link>
```

```bash
git add tasks/builds/pre-prod-tenancy/progress.md
git commit -m "docs(pre-prod-tenancy): Phase 1 acceptance recorded

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 1.11: Phase 1 self-check before opening PR

- [ ] **Step 1: Re-run the §1 verification table from spec.**

For each row in spec §1 (e.g. `P3-C1` closed by `migrations/0227_rls_hardening_corrective.sql:22-39`), open the cited file and confirm the closure evidence still holds. This guards against a sister-branch merge regressing the work in flight.

- [ ] **Step 2: Confirm sister-branch scope-out.**

Run: `git diff origin/main..pre-prod-tenancy --name-only | grep -E "server/routes/sessionMessage.ts|server/routes/briefs.ts|server/services/scopeResolutionService.ts|server/services/briefCreationService.ts|server/index.ts|server/middleware/|server/services/workflowEngineService.ts|server/services/workflowRunService.ts|server/services/invokeAutomationStepService.ts|server/services/agentExecutionService.ts|server/services/agentScheduleService.ts|server/db/schema/agentRuns.ts"`

Expected: empty output. Any match = sister-branch scope violation; revert the offending change.

- [ ] **Step 3: Confirm `npx tsc --noEmit -p server/tsconfig.json` is clean.**

- [ ] **Step 4: Confirm `npm run lint` is clean.**

> Phase 1 ready for PR. The Phase 1 PR description requirements (gate-status block, pre-flight count block, allow-list grep+NEW-call-sites block) are assembled in Closing Task C.2.

---

# Phase 2 — `intervention_outcomes` UNIQUE + `ON CONFLICT DO NOTHING` (`CHATGPT-PR203-R2`)

**Phase goal:** Replace the per-row `db.transaction(...)` + `pg_advisory_xact_lock` + claim-verify pattern in `server/jobs/measureInterventionOutcomeJob.ts:254-267` with a DB-level UNIQUE constraint on `intervention_outcomes(intervention_id)` + `INSERT ... ON CONFLICT (intervention_id) DO NOTHING`. The unique constraint replaces the advisory lock entirely; the `recordOutcome` service becomes the single owner of the insert.

**Phase deliverables (all in `tasks/builds/pre-prod-tenancy/progress.md`):**
- §4.2.0 pre-check result (count of duplicate `intervention_id` values + sample if non-zero + chosen resolution path).
- §4.7 load-test triple: legacy rows/sec/org, new rows/sec/org, multiplier (≥ 5×) + absolute floor confirmation (≥ 200 rows/sec/org).
- Single-writer grep output for the post-refactor state (1 expected hit; reviewer manually confirms each hit is a write operation).

---

### Task 2.1: Extend the pure unit test for `decideOutcomeMeasurement`

**Files:**
- Test: `server/jobs/__tests__/measureInterventionOutcomeJobPure.test.ts` (extend if it exists; create if not)

- [ ] **Step 1: Check whether the pure-test file already exists.**

Run: `ls server/jobs/__tests__/measureInterventionOutcomeJobPure.test.ts 2>/dev/null || echo "missing"`

If the file is missing, mirror the structure of an existing pure test in `server/jobs/__tests__/` (e.g. another `*Pure.test.ts`) for naming + `node:test` (or `tsx test`) conventions.

- [ ] **Step 2: Write the test asserting `decideOutcomeMeasurement` is unchanged.**

The test imports `decideOutcomeMeasurement` (a pure function called from `measureInterventionOutcomeJob.ts:231`) and asserts the three branches (`too_early`, `no_post_snapshot`, `record`) return the args the job currently consumes. The test exists to fail loudly if the pure function's contract drifts during the refactor.

```ts
// server/jobs/__tests__/measureInterventionOutcomeJobPure.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { decideOutcomeMeasurement } from '../measureInterventionOutcomeJobPure.js';

describe('decideOutcomeMeasurement', () => {
  it('returns too_early when window has not elapsed', () => {
    const result = decideOutcomeMeasurement({
      action: { id: 'a1', executedAt: new Date('2026-04-29T00:00:00Z') } as any,
      accountId: 'acct1',
      measurementWindowHours: 24,
      postSnapshot: undefined,
      postAssessment: undefined,
      now: new Date('2026-04-29T01:00:00Z'),
    });
    assert.equal(result.kind, 'too_early');
  });

  it('returns no_post_snapshot when window elapsed but snapshot missing', () => {
    const result = decideOutcomeMeasurement({
      action: { id: 'a1', executedAt: new Date('2026-04-29T00:00:00Z') } as any,
      accountId: 'acct1',
      measurementWindowHours: 24,
      postSnapshot: undefined,
      postAssessment: undefined,
      now: new Date('2026-04-30T00:01:00Z'),
    });
    assert.equal(result.kind, 'no_post_snapshot');
  });

  it('returns record with the canonical recordArgs shape', () => {
    const result = decideOutcomeMeasurement({
      action: {
        id: 'a1',
        organisationId: 'org1',
        accountId: 'acct1',
        interventionTypeSlug: 'slug',
        executedAt: new Date('2026-04-29T00:00:00Z'),
      } as any,
      accountId: 'acct1',
      measurementWindowHours: 24,
      postSnapshot: { score: 80, observedAt: new Date('2026-04-30T00:01:00Z') },
      postAssessment: { band: 'green', observedAt: new Date('2026-04-30T00:01:00Z') },
      now: new Date('2026-04-30T00:01:00Z'),
    });
    assert.equal(result.kind, 'record');
    if (result.kind === 'record') {
      assert.ok(result.recordArgs.organisationId);
      assert.ok(result.recordArgs.interventionId);
      assert.ok(result.recordArgs.accountId);
      assert.ok(result.recordArgs.interventionTypeSlug);
    }
  });
});
```

> Open `server/jobs/measureInterventionOutcomeJob.ts:231` and the corresponding `decideOutcomeMeasurement` source to confirm the actual input/output shape before writing the test. The shape above is illustrative; copy the real types from the source.

- [ ] **Step 3: Run the test (it must pass against the un-refactored code).**

Run: `npx tsx server/jobs/__tests__/measureInterventionOutcomeJobPure.test.ts`
Expected: PASS. (If `decideOutcomeMeasurement` lives in a `Pure.ts` file, the test pulls from there; otherwise import path adjusts.)

- [ ] **Step 4: Commit.**

```bash
git add server/jobs/__tests__/measureInterventionOutcomeJobPure.test.ts
git commit -m "$(cat <<'EOF'
test(pre-prod-tenancy): pin decideOutcomeMeasurement contract before refactor (Phase 2 §7.2)

Pure-only assertions for too_early / no_post_snapshot / record branches.
Pre-refactor pin so any drift in the canonical recordArgs shape during the
ON CONFLICT refactor surfaces as a test failure.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2.2: Run the §4.2.0 mandatory pre-check

**Files:**
- Append: `tasks/builds/pre-prod-tenancy/progress.md`

- [ ] **Step 1: Verify write-quiescent state on the dev DB.**

The pre-check's read consistency contract requires either a `REPEATABLE READ` tx OR an immediate-before-apply path with verified write quiescence. The pre-prod framing (no live agency, no live user) makes the immediate-before-apply path realistic — but quiescence MUST be verified.

Quiescence checks:
- No pg-boss workers consuming jobs that touch `intervention_outcomes` (stop the worker process or confirm no `measureInterventionOutcomeJob` is scheduled).
- No `measureInterventionOutcomeJob` schedule actively firing.
- No manual scripts mid-run.
- No other developer's local server connected to the same DB.

Run: `psql -c "SELECT count(*) FROM pg_stat_activity WHERE state = 'active' AND query NOT LIKE '%pg_stat_activity%'"` (substitute project's actual DB connection command — read `package.json` or `.env` to confirm).
Expected: 1 (the implementer's own session).

- [ ] **Step 2: Run the pre-check query.**

```sql
SELECT intervention_id, COUNT(*) AS dupes
FROM intervention_outcomes
GROUP BY intervention_id
HAVING COUNT(*) > 1;
```

Three possible outcomes per spec §4.2.0:
- **Empty result.** Default expectation. Proceed to Task 2.3 (no dedup needed).
- **Non-empty + deterministic "correct row" rule applies.** Document the rule (one paragraph) in `progress.md` and modify Task 2.3's migration to dedup by that rule. NOT by `ctid`.
- **Non-empty + no deterministic rule.** STOP. Surface to user with count + 5–10-row sample for the most-duplicated `intervention_id`.

- [ ] **Step 3: Append pre-check result to `progress.md`.**

```markdown
### Phase 2 §4.2.0 pre-check ([spec round 7 — commit <sha>])

- DB queried: <dev | other>
- Quiescence verified: yes (active sessions = 1; no scheduler firing; no other servers)
- Quiescence command output: `<paste output>`
- Pre-check query result: <empty | N duplicate intervention_id values>
- Sample (if non-empty): <5–10 rows>
- Resolution: <proceed-no-dedup | dedup-rule-applied | STOPPED-escalated-to-user>
- Dedup rule (if applied): <paragraph naming the column + semantic + citation>
```

- [ ] **Step 4: Commit (alongside Task 2.3 if same session — see Task 2.3 step 7).**

This commit can stand alone or be combined with the migration commit. The spec requires the pre-check note to land in or before the `0244` commit, never after.

---

### Task 2.3: Write `0244` migration + Drizzle schema edit

**Files:**
- Create: `migrations/0244_intervention_outcomes_unique.sql`
- Create: `migrations/0244_intervention_outcomes_unique.down.sql`
- Modify: `server/db/schema/interventionOutcomes.ts:1` (drizzle import) + `:35` (index → uniqueIndex)

- [ ] **Step 1: Author the forward migration.**

Create `migrations/0244_intervention_outcomes_unique.sql`:

```sql
-- Replace the non-unique index with a UNIQUE index on intervention_id.
-- The existing index is named `intervention_outcomes_intervention_idx`
-- (per server/db/schema/interventionOutcomes.ts:35) and was added by an
-- earlier migration; the unique replacement enforces exactly-once
-- write semantics for measureInterventionOutcomeJob.
--
-- §4.2.0 pre-check: implementer has confirmed either zero pre-existing
-- duplicates OR has applied a deterministic, reviewer-vetted dedup rule
-- (recorded in tasks/builds/pre-prod-tenancy/progress.md). The migration
-- below assumes that pre-check has happened; it does NOT default to a
-- ctid-based dedup. If duplicates exist at apply time without a vetted
-- rule, the LOCK + CREATE UNIQUE INDEX path below will fail loudly and
-- roll back — the correct outcome.

-- Acquire ACCESS EXCLUSIVE on the table for the migration's duration.
LOCK TABLE intervention_outcomes IN ACCESS EXCLUSIVE MODE;

-- (Optional) Conditional dedup block — only present if §4.2.0 produced
-- a deterministic rule. Default form has NO dedup block.

DROP INDEX IF EXISTS intervention_outcomes_intervention_idx;
CREATE UNIQUE INDEX intervention_outcomes_intervention_unique
  ON intervention_outcomes (intervention_id);
```

If the §4.2.0 pre-check surfaced duplicates AND a deterministic rule applies, append the dedup block BETWEEN the `LOCK TABLE` and the `DROP INDEX` lines. Example for the "most-recent created_at wins" rule:

```sql
DELETE FROM intervention_outcomes a
USING intervention_outcomes b
WHERE a.intervention_id = b.intervention_id
  AND a.created_at < b.created_at;
```

- [ ] **Step 2: Author the down migration.**

Create `migrations/0244_intervention_outcomes_unique.down.sql`:

```sql
DROP INDEX IF EXISTS intervention_outcomes_intervention_unique;
CREATE INDEX IF NOT EXISTS intervention_outcomes_intervention_idx
  ON intervention_outcomes (intervention_id);
```

> The down migration does NOT restore any rows the optional dedup `DELETE` removed. Implementers MUST take a `pg_dump` of `intervention_outcomes` before applying `0244` against any database whose row history matters.

- [ ] **Step 3: Edit the Drizzle schema file.**

Open `server/db/schema/interventionOutcomes.ts`. Two edits:

a) Add `uniqueIndex` to the drizzle import on line 1:

```ts
// before:
import { pgTable, uuid, text, integer, boolean, timestamp, index } from 'drizzle-orm/pg-core';

// after:
import { pgTable, uuid, text, integer, boolean, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
```

b) Replace line 35:

```ts
// before:
interventionIdx: index('intervention_outcomes_intervention_idx').on(table.interventionId),

// after:
interventionUnique: uniqueIndex('intervention_outcomes_intervention_unique').on(table.interventionId),
```

- [ ] **Step 4: Run `db:generate` if the project uses it for journal updates.**

Run: `npm run db:generate`
Expected: `migrations/meta/_journal.json` updates to reference `0244`. The hand-authored `.sql` file is preserved (this branch follows the `0227–0229` convention, not Drizzle-generated SQL).

If `db:generate` rewrites or removes the hand-authored file, undo and follow the existing migration convention (commit the file as-is + meta updates).

- [ ] **Step 5: Apply the migration to the dev DB.**

Run: `npm run db:migrate` (substitute the project's actual command — read `package.json` `scripts`).
Expected: migration applies cleanly. Confirm by running:

```sql
\d intervention_outcomes
```

Expected: an index named `intervention_outcomes_intervention_unique` shows as `UNIQUE`.

If apply fails with `23505 unique_violation`, the §4.2.0 pre-check missed a duplicate. Revert the migration commit, re-run the pre-check (Task 2.2), then resume.

- [ ] **Step 6: TypeScript clean.**

Run: `npx tsc --noEmit -p server/tsconfig.json`
Expected: clean. The Drizzle schema edit changes the export key (`interventionIdx` → `interventionUnique`), but indexes are not exported by name — no caller should reference the key. If a caller does, fix it.

- [ ] **Step 7: Commit (Task 2.2's pre-check note + Task 2.3 schema/migration as one atomic commit).**

```bash
git add migrations/0244_intervention_outcomes_unique.sql migrations/0244_intervention_outcomes_unique.down.sql server/db/schema/interventionOutcomes.ts migrations/meta/_journal.json tasks/builds/pre-prod-tenancy/progress.md
git commit -m "$(cat <<'EOF'
feat(pre-prod-tenancy): UNIQUE index on intervention_outcomes(intervention_id) (Phase 2 §4.2)

Migration 0244 replaces non-unique intervention_outcomes_intervention_idx
with intervention_outcomes_intervention_unique (UNIQUE), under ACCESS
EXCLUSIVE for the migration's tx lifetime. Drizzle schema updated to
uniqueIndex(...). Pre-check (§4.2.0) recorded in progress.md.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2.4: Refactor `interventionService.recordOutcome` + the job

**Files:**
- Modify: `server/services/interventionService.ts:53-105` (signature + body)
- Modify: `server/jobs/measureInterventionOutcomeJob.ts:254-269` (replace per-row tx block) and any unused `import { sql }` cleanup

- [ ] **Step 1: Change `recordOutcome` signature + body.**

Open `server/services/interventionService.ts`. Read the current `recordOutcome` (lines 53–105) to confirm the input shape before authoring.

Edit the signature on line 70:

```ts
// before:
}): Promise<void> {

// after:
}): Promise<boolean> {
```

Edit the body — replace the existing `await db.insert(interventionOutcomes).values({...} as typeof interventionOutcomes.$inferInsert);` (lines 87–104) with:

```ts
const result = await db
  .insert(interventionOutcomes)
  .values({
    organisationId: data.organisationId,
    interventionId: data.interventionId,
    accountId: data.accountId,
    interventionTypeSlug: data.interventionTypeSlug,
    triggerEventId: data.triggerEventId,
    runId: data.runId,
    configVersion: data.configVersion,
    healthScoreBefore: data.healthScoreBefore,
    healthScoreAfter: data.healthScoreAfter,
    outcome,
    measuredAfterHours: data.measuredAfterHours ?? 24,
    deltaHealthScore: delta,
    bandBefore: data.bandBefore,
    bandAfter: data.bandAfter,
    bandChanged,
    executionFailed: data.executionFailed ?? false,
  } as typeof interventionOutcomes.$inferInsert)
  .onConflictDoNothing({ target: interventionOutcomes.interventionId });

return (result.rowCount ?? 0) > 0;
```

- [ ] **Step 2: Replace the job's per-row tx block.**

Open `server/jobs/measureInterventionOutcomeJob.ts`. Read lines 250–280 to anchor the replacement.

Edit lines 250–267 (the comment + `db.transaction(...)` block):

```ts
// before:
      // Per-org advisory lock + claim-verify: hold the lock for this org,
      // re-check NOT EXISTS to defend against a sibling worker that wrote
      // the outcome row between the eligibility SELECT and now, then write.
      // The advisory lock is released when the transaction commits.
      const wrote = await db.transaction(async (tx) => {
        const lockKey = `${row.organisation_id}::measureInterventionOutcomes`;
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey})::bigint)`);

        const [existing] = await tx
          .select({ id: interventionOutcomes.interventionId })
          .from(interventionOutcomes)
          .where(eq(interventionOutcomes.interventionId, row.id))
          .limit(1);
        if (existing) return false;

        await interventionService.recordOutcome(decision.recordArgs!);
        return true;
      });

// after:
      // recordOutcome internally INSERTs into intervention_outcomes with
      // ON CONFLICT (intervention_id) DO NOTHING. Returns true iff a new
      // row was inserted; false on the no-op conflict path.
      const wrote = await interventionService.recordOutcome(decision.recordArgs!);
```

- [ ] **Step 3: Remove unused imports.**

Run: `grep -n "sql\b\|interventionOutcomes\|^import" server/jobs/measureInterventionOutcomeJob.ts | head -30`

If `sql` or `interventionOutcomes` or `eq` are no longer used elsewhere in the file, remove them from the imports. If any of those identifiers still appears later in the file (e.g. another query block), leave the import alone.

- [ ] **Step 4: Run the single-writer grep.**

Spec §4.3 invariant. Run:

```bash
grep -rnE "(interventionOutcomes|'intervention_outcomes')" server/ \
  | grep -E "(\.insert\(|\.update\(|onConflict|sql\`(INSERT|UPDATE))"
```

Expected: exactly ONE hit — `server/services/interventionService.ts` line containing `.onConflictDoNothing({ target: interventionOutcomes.interventionId })`.

For each hit, manually open the source line and confirm it is a runtime write operation (not a comment, log string, type-import shim, or test fixture). Annotate each hit in the PR-description block (Closing Task C.2):

```
<file>:<line> — write | read | comment | log | import
```

- [ ] **Step 5: Run the pure test (Task 2.1).**

Run: `npx tsx server/jobs/__tests__/measureInterventionOutcomeJobPure.test.ts`
Expected: PASS. The `decideOutcomeMeasurement` contract should be unchanged by this refactor.

- [ ] **Step 6: TypeScript clean.**

Run: `npx tsc --noEmit -p server/tsconfig.json`
Expected: clean. The `recordOutcome` signature change from `Promise<void>` to `Promise<boolean>` may surface call sites that ignored the return value — those compile fine (boolean is assignable to discarded result), but if any call site explicitly typed the return as `void`, fix it.

- [ ] **Step 7: Build server.**

Run: `npm run build:server`
Expected: clean. Per CLAUDE.md, the build is run when the change touches the build surface; the schema change qualifies.

- [ ] **Step 8: Lint clean.**

Run: `npm run lint`
Expected: clean.

- [ ] **Step 9: Commit (separate from Task 2.3 — schema and code roll back independently).**

```bash
git add server/services/interventionService.ts server/jobs/measureInterventionOutcomeJob.ts
git commit -m "$(cat <<'EOF'
refactor(pre-prod-tenancy): intervention_outcomes ON CONFLICT DO NOTHING (Phase 2 §4.3)

recordOutcome signature Promise<void> → Promise<boolean>; insert switches to
.onConflictDoNothing({ target: interventionOutcomes.interventionId }).
measureInterventionOutcomeJob drops per-row db.transaction + pg_advisory_xact_lock
+ claim-verify. Single-writer invariant: recordOutcome is the only writer to
intervention_outcomes (grep confirms 1 expected hit).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2.5: §4.7 load test (legacy vs. new + relative + absolute)

**Files:**
- Append: `tasks/builds/pre-prod-tenancy/progress.md`
- Optional: temporary harness script (committed only if it's reusable)

The spec mandates BOTH a relative pass condition (≥ 5× speedup vs. legacy) AND an absolute floor (≥ 200 rows/sec/org).

- [ ] **Step 1: Decide fixture size.**

Default: 10,000 rows / 5 orgs (2,000/org). If seed-data dependencies block local setup, fall back to 1,000 rows / 2 orgs (the smaller fallback fixture) and defer the upgrade to `tasks/todo.md § Deferred from pre-prod-tenancy spec`.

- [ ] **Step 2: Stash the legacy code path locally for the comparison run.**

Create a feature-flagged local-only branch on top of the refactor commit OR check out the previous commit (the refactor commit's parent) on a scratch worktree. The legacy path is the per-row `db.transaction` + advisory-lock pattern that existed before Task 2.4.

Recommended: `git worktree add /tmp/legacy-perf <commit-before-task-2.4>` and run the legacy timing there. Discard the worktree after measurement.

- [ ] **Step 3: Seed the test DB.**

Insert N actions ready for outcome measurement. The exact seed SQL depends on the existing seeding harness — read `server/jobs/__tests__/` and `tasks/.../integration test runs` references in the spec to find the canonical pattern. If no harness exists, write a one-off SQL script that inserts the minimum row shape `runMeasureInterventionOutcome` consumes (read the job's eligibility SELECT to derive the shape).

- [ ] **Step 4: Run both implementations under a stopwatch.**

For each path (legacy + new), run `runMeasureInterventionOutcome()` and capture wall-clock time + `summary.written` count.

```ts
// scratch script — not committed unless it's reusable
const t0 = Date.now();
const summary = await runMeasureInterventionOutcome();
const elapsedMs = Date.now() - t0;
const rowsPerSecPerOrg = (summary.written / 5) / (elapsedMs / 1000);
console.log({ elapsedMs, written: summary.written, rowsPerSecPerOrg });
```

Run each path 3 times and take the median to dampen noise.

- [ ] **Step 5: Verify pass conditions.**

- Relative: new is ≥ 5× faster than legacy (`legacy_ms / new_ms >= 5`).
- Absolute: new ≥ 200 rows/sec/org.
- Correctness: `summary.written` matches the eligible-row count exactly across both runs (no dropped or double-counted rows).

If absolute < 200 but the local environment has a clear ceiling (e.g. test DB on slow disk), capture the measured ceiling in `progress.md` AND route the absolute floor to `tasks/todo.md § Deferred from pre-prod-tenancy spec` for re-measurement on a representative environment.

- [ ] **Step 5b: Concurrent worker contention check.**

Run 2–3 concurrent executions of `runMeasureInterventionOutcome()` against the same seeded dataset to confirm the `ON CONFLICT DO NOTHING` constraint correctly absorbs concurrent writers (the advisory lock it replaced did this via mutual exclusion; the DB constraint must do it via conflict resolution):

```ts
// scratch — run concurrently against the same seeded rows:
const results = await Promise.all([
  runMeasureInterventionOutcome(),
  runMeasureInterventionOutcome(),
  // optionally: runMeasureInterventionOutcome(),
]);
```

Expected:
- No duplicate rows in `intervention_outcomes` after all runs complete.
- Total `written` across all concurrent results equals the eligible-row count (no double-writes; no dropped rows).
- No uncaught exceptions from conflicting inserts.

After the concurrent runs complete, run the mechanical proof query against the DB:

```sql
SELECT intervention_id, COUNT(*)
FROM intervention_outcomes
GROUP BY intervention_id
HAVING COUNT(*) > 1;
```

Expected: zero rows. This is the authoritative proof that ON CONFLICT DO NOTHING absorbed concurrent writers correctly. A non-zero result means the unique constraint failed to enforce single-write semantics — STOP and surface to user (the constraint is not behaving as designed and the entire Phase 2 refactor is suspect).

Append to the load-test block in `progress.md`:
```
- Concurrency check: <N> concurrent runs, total written = <eligible_count>.
- DB-state proof query: SELECT intervention_id, COUNT(*) FROM intervention_outcomes GROUP BY intervention_id HAVING COUNT(*) > 1; → 0 rows (pass).
```

- [ ] **Step 6: Append load-test triple to `progress.md`.**

```markdown
### Phase 2 §4.7 load-test result ([spec round 7 — commit <sha>])

- Fixture: <10,000 rows / 5 orgs | 1,000 rows / 2 orgs fallback>
- Legacy rows/sec/org: <X>
- New rows/sec/org: <Y>
- Multiplier: <Y/X> (pass: ≥ 5)
- Absolute floor: <Y> rows/sec/org (pass: ≥ 200; or measured-ceiling-deferred)
- Correctness: summary.written = <eligible_count> on both paths (pass)
- Hardware: <CPU + DB host description>
- Run timestamp: <ISO 8601>
```

- [ ] **Step 7: Commit the progress.md update.**

```bash
git add tasks/builds/pre-prod-tenancy/progress.md
git commit -m "$(cat <<'EOF'
docs(pre-prod-tenancy): Phase 2 §4.7 load-test result

Legacy vs. new throughput captured against <fixture>; relative ≥ 5× and
absolute ≥ 200 rows/sec/org pass conditions confirmed.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2.6: Phase 2 acceptance self-check

- [ ] **Step 1: Confirm acceptance criteria from spec §4.8 row by row.**

- `migrations/0244_intervention_outcomes_unique.sql` + `.down.sql` exist.
- Forward migration applies cleanly to a fresh DB (re-run `db:migrate` against a fresh dev DB if doubt).
- Down migration reverses cleanly (`db:rollback` or equivalent).
- `server/db/schema/interventionOutcomes.ts:35` uses `uniqueIndex(...)`.
- `server/jobs/measureInterventionOutcomeJob.ts` no longer contains `pg_advisory_xact_lock` or `db.transaction(` for the per-row write path. Verify: `grep -nE "pg_advisory_xact_lock|db\.transaction\(" server/jobs/measureInterventionOutcomeJob.ts` returns no matches.
- `interventionService.recordOutcome` uses `.onConflictDoNothing({ target: interventionOutcomes.interventionId })`. Verify: `grep -n "onConflictDoNothing" server/services/interventionService.ts`.
- Pure test passes: `npx tsx server/jobs/__tests__/measureInterventionOutcomeJobPure.test.ts`.
- Load-test triple in `progress.md` carries all three numbers.
- `npx tsc --noEmit -p server/tsconfig.json` clean.
- Phase 2 introduces no new RLS-gate violations: confirm CI's `verify-rls-protected-tables.sh` is still GREEN on the latest commit.

- [ ] **Step 2: Confirm sister-branch scope-out.**

Same command as Phase 1 Task 1.11 step 2. Expected: empty.

- [ ] **Step 3: Append Phase 2 acceptance to `progress.md`.**

```markdown
### Phase 2 acceptance ([spec round 7 — commit <sha>])
- All §4.8 criteria confirmed.
- CI gate snapshot: verify-rls-protected-tables.sh still GREEN at commit <sha>.
```

- [ ] **Step 4: Commit.**

```bash
git add tasks/builds/pre-prod-tenancy/progress.md
git commit -m "docs(pre-prod-tenancy): Phase 2 acceptance recorded

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2.7: Decide whether to proceed to Phase 3

Spec §5.5 conditional: Phase 3 ships only if Phase 1 + Phase 2 finished under the branch's reasonable budget (heuristic: ≤ 3 days end-to-end). The three jobs are functional today (no silent no-ops); the upgrade is defense-in-depth, not correctness.

- [ ] **Step 1: Time-box decision.**

If the cumulative work-time on Phase 1 + Phase 2 ≤ 3 days, proceed to Phase 3 (Tasks 3.1 onward).

If > 3 days, defer Phase 3:
- Append to `tasks/todo.md` under `## Deferred from pre-prod-tenancy spec`:
  ```markdown
  ### B10 — Maintenance-job per-org `withOrgTx` defense-in-depth (deferred from pre-prod-tenancy)
  Trigger: Phase 1+2 merged on <date>; remaining defense-in-depth upgrade
  routed to follow-up branch. See pre-prod-tenancy spec §5 for the contract.
  ```
- Commit and skip to Closing Task C.1.

If proceeding to Phase 3, continue to Task 3.1.

---

# Phase 3 — Maintenance-job per-org `withOrgTx` defense-in-depth (`B10`, optional)

**Phase goal:** Upgrade three maintenance jobs from "outer admin tx + per-org savepoint" to "outer admin tx for enumeration only, then a fresh `withOrgTx` per org for the per-org work." The per-org work currently runs under `admin_role` (RLS bypassed); the upgrade re-engages tenant-scoped policies for each org's writes.

**Phase deliverables (per job — three jobs total):**
- §5.2.1 advisory-lock audit verdict in THREE places (commit message + PR description block + `progress.md` paragraph). All three must agree byte-for-byte.
- Per-job idempotency posture (`state-based`) and concurrency contract (Pattern A or Pattern B) recorded.

**Pattern reference:**
- `withOrgTx` lives at `server/instrumentation.ts:172`.
- `withAdminConnection` lives at `server/lib/adminDbConnection.ts:58`.

The pattern (per spec §5.2):

```ts
// before:
result = await withAdminConnection(
  { source, reason },
  async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE admin_role`);
    // ... advisory lock ...
    const orgs = await tx.execute(sql`SELECT id FROM organisations LIMIT 500`) as ...;
    for (const org of orgs) {
      const result = await tx.transaction(async (subTx) => {
        return applyDecayForOrg(subTx, org.id);  // RLS bypassed under admin_role
      });
    }
  },
);

// after:
const orgs = await withAdminConnection(
  { source, reason: 'enumerate orgs' },
  async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE admin_role`);
    // (advisory lock if Pattern A — enumeration-only)
    return (await tx.execute(sql`SELECT id FROM organisations LIMIT 500`)) as Array<{ id: string }>;
  },
);

for (const org of orgs) {
  try {
    const { decayed, autoDeprecated } = await withOrgTx(
      { organisationId: org.id, source: `${SOURCE}:per-org` },
      async (orgTx) => applyDecayForOrg(orgTx, org.id),
    );
    // accumulate ...
  } catch (err) {
    // existing per-org error handling preserved
  }
}
```

---

### Task 3.1: Audit `ruleAutoDeprecateJob` for advisory-lock pattern (Pattern A vs. Pattern B)

**Files:**
- Read-only audit: `server/jobs/ruleAutoDeprecateJob.ts`
- Append: `tasks/builds/pre-prod-tenancy/progress.md`

- [ ] **Step 1: Locate the lock acquisition.**

Run: `grep -nE "pg_advisory_xact_lock|pg_try_advisory_lock" server/jobs/ruleAutoDeprecateJob.ts`
Expected: at least one match (per spec §5.3, line ~169).

- [ ] **Step 2: Enumerate all writes inside the admin tx.**

Run: `grep -nE "(\.insert\(|\.update\(|\.delete\(|sql\`(INSERT|UPDATE|DELETE))" server/jobs/ruleAutoDeprecateJob.ts`

Then trace `applyDecayForOrg` (the per-org function called inside the loop) and any callees — recursively. Run the same grep against each callee file.

- [ ] **Step 3: Classify each write.**

For each write hit:
- **Enumeration-scope** (e.g. updating a `last_run_at` row, counting orgs, logging) — does NOT depend on per-org mutual exclusion.
- **Per-org-scope** (e.g. the per-org decay update) — DOES depend on per-org mutual exclusion if any concurrent runner could race the same org.

- [ ] **Step 4: Decide Pattern.**

- ALL writes are enumeration-scope → **Pattern A**. Default and expected.
- ANY per-org-scope write that is not idempotent on its own → **Pattern B**. The Phase 3 commit must acquire a session-level advisory lock outside `withOrgTx` per org.
- Unable to determine confidently → **default to Pattern B**. Bias toward correctness.

**Hard rule for Pattern B classification:** A write is non-idempotent if it is (a) an `UPDATE` without a deterministic `WHERE` clause (i.e. the same call twice could produce different results), or (b) an `INSERT` without a unique constraint target. If ANY per-org-scope write satisfies either definition, Pattern B is mandatory — not optional. When in doubt about idempotency, classify as Pattern B.

If the lock is implicitly tied to in-tx state (e.g. `SELECT ... FOR UPDATE` rather than a named advisory key), defer this job to a follow-up branch with a §9 entry; the other two jobs can still ship.

- [ ] **Step 5: Append the audit paragraph to `progress.md`.**

```markdown
### Phase 3 §5.2.1 audit — ruleAutoDeprecateJob ([spec round 7 — commit <sha>])

- Lock acquisition: line <N3> (`pg_advisory_xact_lock(hashtext(...))::bigint`)
- Writes within lock scope:
  - line <N1> — <enumeration-scope | per-org-scope> — <description>
  - line <N2> — <enumeration-scope | per-org-scope> — <description>
- Per-org function: `applyDecayForOrg` (lines <range>)
- Per-org-function writes:
  - line <Na> — <description>
- Pattern: <A | B>
- Rationale: <one paragraph — why Pattern A is sufficient OR why Pattern B is required>
```

The Pattern letter, line numbers, and lock-acquisition reference recorded here MUST match byte-for-byte the commit message line and the PR description block authored in Task 3.2.

---

### Task 3.2: Refactor `ruleAutoDeprecateJob` to per-org `withOrgTx`

**Files:**
- Modify: `server/jobs/ruleAutoDeprecateJob.ts`

- [ ] **Step 1: Read the current job's outer block (lines ~150–250).**

Anchor the edits before authoring. Identify:
- The `withAdminConnection({ source, reason }, async (tx) => { ... })` outer block.
- The inner `for (const org of orgs)` loop and its `tx.transaction(async (subTx) => applyDecayForOrg(subTx, org.id))` savepoint.
- Any accumulators (`decayed`, `autoDeprecated`, etc.) that are summed across orgs.

- [ ] **Step 2: Confirm `withOrgTx` and `withAdminConnection` import paths.**

Run: `grep -n "withOrgTx\|withAdminConnection" server/jobs/ruleAutoDeprecateJob.ts`

Expected: `withAdminConnection` is already imported. `withOrgTx` may not be — add the import if missing:

```ts
import { withOrgTx } from '../instrumentation.js';
```

- [ ] **Step 3: Refactor the outer block (Pattern A — default).**

The shape per spec §5.2:

```ts
// Step 1: enumerate orgs under admin_role.
const orgs = await withAdminConnection(
  { source, reason: 'enumerate orgs' },
  async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE admin_role`);
    // (Pattern A: advisory lock here if cross-job mutual exclusion is required —
    //  scoped to enumeration only. Released when admin tx commits.)
    return (await tx.execute(sql`SELECT id FROM organisations LIMIT 500`)) as Array<{ id: string }>;
  },
);

// Step 2: for each org, do the per-org work in a fresh tenant-scoped tx.
const accumulators = { decayed: 0, autoDeprecated: 0 };
for (const org of orgs) {
  try {
    const result = await withOrgTx(
      { organisationId: org.id, source: `${source}:per-org` },
      async (orgTx) => applyDecayForOrg(orgTx, org.id),
    );
    accumulators.decayed += result.decayed;
    accumulators.autoDeprecated += result.autoDeprecated;
  } catch (err) {
    logger.error('ruleAutoDeprecate.org_failed', {
      orgId: org.id,
      err: err instanceof Error ? err.message : String(err),
    });
    // existing per-org error handling preserved
  }
}
```

If Pattern B was the audit verdict (Task 3.1 step 4), the lock acquisition moves OUTSIDE `withOrgTx` per org and uses a session-level (cross-tx) mechanism. Read the existing lock semantics carefully and translate before writing the code.

- [ ] **Step 4: Verify `applyDecayForOrg` does not contain `SET LOCAL ROLE admin_role` or admin-only operations.**

Run: `grep -nE "SET LOCAL ROLE|admin_role" server/jobs/ruleAutoDeprecateJob.ts | head -10`

Inside `applyDecayForOrg` and any callees, confirm there is no `SET LOCAL ROLE admin_role`. If there is, the function relied on the admin role and lifting it under `withOrgTx` would fail RLS — escalate as a Pattern-B edge case or defer this job.

- [ ] **Step 5: TypeScript clean.**

Run: `npx tsc --noEmit -p server/tsconfig.json`
Expected: clean.

- [ ] **Step 6: Lint clean.**

Run: `npm run lint`
Expected: clean.

- [ ] **Step 7: If a pure test exists for this job, extend it.**

Run: `ls server/jobs/__tests__/ruleAutoDeprecateJob*.test.ts 2>/dev/null`

If a `*Pure.test.ts` exists, extend it to assert org-enumeration order is unchanged and per-org function invocation count matches the enumerated org count.

If none exists, do NOT introduce one — pure tests are added only when a clear unit boundary already exists. This is a refactor, not a new feature; the type-check + acceptance rerun (Task 3.7) is the contract.

- [ ] **Step 8: Run any extended pure test.**

Run: `npx tsx server/jobs/__tests__/ruleAutoDeprecateJobPure.test.ts` (only if extended).
Expected: PASS.

- [ ] **Step 9: Commit (one commit per job — spec §8.2).**

The commit message MUST include the audit verdict line per spec §5.2.1 enforcement.

```bash
git add server/jobs/ruleAutoDeprecateJob.ts
git commit -m "$(cat <<'EOF'
refactor(pre-prod-tenancy): ruleAutoDeprecateJob per-org withOrgTx (Phase 3 §5.2)

advisory-lock-audit: pattern-A | line <N1>, <N2> (writes); line <N3> (lock acquisition)

Outer admin tx scoped to org enumeration; per-org applyDecayForOrg now runs
under withOrgTx with app.organisation_id set, re-engaging RLS policies that
were previously bypassed under admin_role.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

> Substitute the actual line numbers from Task 3.1 step 5. The Pattern letter and line numbers MUST match `progress.md` byte-for-byte.

---

### Task 3.3: Audit `fastPathDecisionsPruneJob` for advisory-lock pattern

**Files:**
- Read-only audit: `server/jobs/fastPathDecisionsPruneJob.ts`
- Append: `tasks/builds/pre-prod-tenancy/progress.md`

- [ ] **Step 1: Mirror Task 3.1 steps 1–4 against `fastPathDecisionsPruneJob.ts`.**

Spec §5.3 references the per-org block at lines 90–... Run the same grep commands and decision tree.

- [ ] **Step 2: Append the audit paragraph to `progress.md`.**

```markdown
### Phase 3 §5.2.1 audit — fastPathDecisionsPruneJob ([spec round 7 — commit <sha>])

- Lock acquisition: line <N3>
- Writes within lock scope: lines <N1, N2 ...>
- Per-org function: <name> (lines <range>)
- Per-org-function writes: lines <Na ...>
- Pattern: <A | B>
- Rationale: <paragraph>
```

- [ ] **Step 3: Commit (alongside Task 3.4 if same session).**

```bash
git add tasks/builds/pre-prod-tenancy/progress.md
git commit -m "docs(pre-prod-tenancy): Phase 3 audit — fastPathDecisionsPruneJob

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3.4: Refactor `fastPathDecisionsPruneJob` to per-org `withOrgTx`

**Files:**
- Modify: `server/jobs/fastPathDecisionsPruneJob.ts`

- [ ] **Step 1: Mirror Task 3.2 steps 1–8 against `fastPathDecisionsPruneJob.ts`.**

Same pattern: enumerate orgs under `withAdminConnection`, then loop with `withOrgTx` per org.

- [ ] **Step 2: Commit with the audit verdict line.**

```bash
git add server/jobs/fastPathDecisionsPruneJob.ts
git commit -m "$(cat <<'EOF'
refactor(pre-prod-tenancy): fastPathDecisionsPruneJob per-org withOrgTx (Phase 3 §5.2)

advisory-lock-audit: pattern-A | line <N1>, <N2> (writes); line <N3> (lock acquisition)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3.5: Audit `fastPathRecalibrateJob` for advisory-lock pattern

**Files:**
- Read-only audit: `server/jobs/fastPathRecalibrateJob.ts`
- Append: `tasks/builds/pre-prod-tenancy/progress.md`

- [ ] **Step 1: Mirror Task 3.1 steps 1–4 against `fastPathRecalibrateJob.ts`.**

Spec §5.3 references the per-org block at lines 108–...

- [ ] **Step 2: Append the audit paragraph to `progress.md`.**

```markdown
### Phase 3 §5.2.1 audit — fastPathRecalibrateJob ([spec round 7 — commit <sha>])

- Lock acquisition: line <N3>
- Writes within lock scope: lines <N1, N2 ...>
- Per-org function: <name> (lines <range>)
- Per-org-function writes: lines <Na ...>
- Pattern: <A | B>
- Rationale: <paragraph>
```

- [ ] **Step 3: Commit.**

```bash
git add tasks/builds/pre-prod-tenancy/progress.md
git commit -m "docs(pre-prod-tenancy): Phase 3 audit — fastPathRecalibrateJob

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3.6: Refactor `fastPathRecalibrateJob` to per-org `withOrgTx`

**Files:**
- Modify: `server/jobs/fastPathRecalibrateJob.ts`

- [ ] **Step 1: Mirror Task 3.2 steps 1–8 against `fastPathRecalibrateJob.ts`.**

- [ ] **Step 2: Commit with the audit verdict line.**

```bash
git add server/jobs/fastPathRecalibrateJob.ts
git commit -m "$(cat <<'EOF'
refactor(pre-prod-tenancy): fastPathRecalibrateJob per-org withOrgTx (Phase 3 §5.2)

advisory-lock-audit: pattern-A | line <N1>, <N2> (writes); line <N3> (lock acquisition)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3.7: Phase 3 acceptance self-check

- [ ] **Step 1: Confirm spec §5.4 acceptance criteria.**

- All three jobs use `withOrgTx({ organisationId: org.id, source: ... })` for per-org work.
- Verify: `grep -nE "withOrgTx\b" server/jobs/{ruleAutoDeprecateJob,fastPathDecisionsPruneJob,fastPathRecalibrateJob}.ts` — three matches expected (one per job).
- No per-org `tx.transaction(...)` savepoint inside an outer admin tx.
- Verify: `grep -nE "tx\.transaction\(" server/jobs/{ruleAutoDeprecateJob,fastPathDecisionsPruneJob,fastPathRecalibrateJob}.ts` — no matches expected for per-org work (an enumeration-only `tx.transaction` is fine if Pattern A keeps the lock there).
- Outer admin tx is enumeration-only.
- `npx tsc --noEmit -p server/tsconfig.json` clean.
- CI gate `verify-rls-protected-tables.sh` still GREEN (Phase 3 must not regress Phase 1).

- [ ] **Step 2: Confirm sister-branch scope-out.**

Same command as Phase 1 Task 1.11 step 2.

- [ ] **Step 3: Append Phase 3 acceptance to `progress.md`.**

```markdown
### Phase 3 acceptance ([spec round 7 — commit <sha>])
- All §5.4 criteria confirmed.
- Three jobs refactored: ruleAutoDeprecateJob, fastPathDecisionsPruneJob, fastPathRecalibrateJob.
- Pattern verdicts: <A or B per job>.
- CI gate snapshot: verify-rls-protected-tables.sh still GREEN at commit <sha>.
```

- [ ] **Step 4: Commit.**

```bash
git add tasks/builds/pre-prod-tenancy/progress.md
git commit -m "docs(pre-prod-tenancy): Phase 3 acceptance recorded

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3.8: Cross-check audit-verdict consistency before opening PR

The Phase 3 contract requires the audit verdict in three places (commit message + PR description block + `progress.md`) to agree byte-for-byte. The reviewer is going to spot-check ≥ 1 job at random; the implementer pre-verifies all three.

- [ ] **Step 1: For each of the three jobs, extract the commit-message audit line.**

Run: `git log origin/main..pre-prod-tenancy --pretty=%B | grep -A 0 "advisory-lock-audit:"`

Expected: three lines, one per job, each of the form `advisory-lock-audit: pattern-A | line <N1>, <N2> (writes); line <N3> (lock acquisition)`.

- [ ] **Step 2: Open `tasks/builds/pre-prod-tenancy/progress.md` and read the three audit paragraphs.**

For each job, confirm the Pattern letter, write line numbers, and lock-acquisition line in the paragraph match the commit-message line byte-for-byte.

If any disagreement: the implementer reconciles by amending the offending source (commit message via `git commit --amend` BEFORE pushing — never after; `progress.md` via a follow-up commit). After reconciliation, re-run this cross-check.

- [ ] **Step 3: Pre-author the PR description block.**

The Phase 3 PR description requires the block (per spec §5.2.1):

```
## Phase 3 advisory-lock audits
- ruleAutoDeprecateJob.ts        : Pattern <A|B> | writes lines <...> | lock line <...>
- fastPathDecisionsPruneJob.ts   : Pattern <A|B> | writes lines <...> | lock line <...>
- fastPathRecalibrateJob.ts      : Pattern <A|B> | writes lines <...> | lock line <...>
```

Save this block as a draft in `tasks/builds/pre-prod-tenancy/progress.md` under a `### PR description draft` heading so it's at hand when assembling the PR (Closing Task C.2). It MUST match the commit messages and the per-job paragraphs byte-for-byte.

- [ ] **Step 4: Commit the PR-description draft (alongside Phase 3 acceptance).**

```bash
git add tasks/builds/pre-prod-tenancy/progress.md
git commit -m "docs(pre-prod-tenancy): Phase 3 audit triplet cross-check + PR-description draft

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

# Closing — Rollout, PR, review pipeline

### Task C.1: Pre-merge baseline reverification (spec §8.3)

Before opening the PR, re-run the spec §1 verification table to confirm no `main` merge regressed previously-closed work.

- [ ] **Step 1: Read each row in spec §1 and verify the cited closure evidence still holds.**

For each item — `P3-C1` through `P3-H3` plus `P3-C5` and `B10`-partial — open the cited migration or source file at the cited lines and confirm the closure evidence is unchanged. Specifically:

- `P3-C1`: `migrations/0227_rls_hardening_corrective.sql:22-39` — confirm `memory_review_queue` ENABLE+FORCE+policy block.
- `P3-C2`: `migrations/0227_rls_hardening_corrective.sql:41-59` — `drop_zone_upload_audit` FORCE.
- `P3-C3`: `migrations/0227_rls_hardening_corrective.sql:61-79` — `onboarding_bundle_configs` FORCE.
- `P3-C4`: `migrations/0227_rls_hardening_corrective.sql:81-99` — `trust_calibration_state` FORCE.
- `GATES-2026-04-26-1`: `migrations/0229_reference_documents_force_rls_parent_exists.sql` exists; `scripts/verify-rls-coverage.sh:56-63` baseline allowlist no longer lists `0202`/`0203`.
- `P3-C6`: `server/routes/memoryReviewQueue.ts` imports `memoryReviewQueueService` + `resolveSubaccount`; no `db` imports.
- `P3-C7`: `server/routes/systemAutomations.ts` imports only `systemAutomationService`.
- `P3-C8`: `server/routes/subaccountAgents.ts` carries the 9 `resolveSubaccount` call sites.
- `P3-C9`: `server/routes/clarifications.ts` imports `clarificationService` + calls `resolveSubaccount`.
- `P3-C10`: `server/services/documentBundleService.ts` `verifySubjectExists` uses `getOrgScopedDb(...)` and applies the org filter.
- `P3-C11`: `server/services/skillStudioService.ts:168, 309, 318` carry the org filter.
- `P3-H2`: `server/lib/briefVisibility.ts` is a thin re-export.
- `P3-H3`: `server/lib/workflow/onboardingStateHelpers.ts` is a thin re-export.

For each row, if the cited evidence holds, mark `[x]` in `tasks/todo.md`. If any row no longer holds, STOP — a sister branch regressed the work; surface to user before merging.

- [ ] **Step 2: Confirm latest CI run on the branch tip is fully GREEN (every gate, not only the Phase 1 hard gate).**

- [ ] **Step 3: Confirm `npx tsc --noEmit -p server/tsconfig.json` is clean locally.**

- [ ] **Step 4: Append baseline-reverification result to `progress.md`.**

```markdown
### Pre-merge baseline reverification ([spec round 7 — commit <sha>])
- §1 closure evidence still holds: yes (all 14 rows re-verified)
- Sister-branch merge from main during in-flight: <none | yes — see §8.4 delta entry>
- CI status at branch tip: all gates GREEN
```

- [ ] **Step 5: Commit if anything was added to `progress.md` or `tasks/todo.md`.**

```bash
git add tasks/builds/pre-prod-tenancy/progress.md tasks/todo.md
git commit -m "docs(pre-prod-tenancy): pre-merge baseline reverification

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task C.2: Assemble the PR description

The PR description must include several blocks per spec §3.5.1, §6, §7.5, §5.2.1. Assemble them from the `progress.md` content.

- [ ] **Step 1: Push the branch.**

```bash
git push -u origin pre-prod-tenancy
```

- [ ] **Step 2: Wait for CI on the latest commit; capture the gate-status output.**

Open the CI run for the latest commit and copy the `[GATE] <name>: violations=<n>` lines.

- [ ] **Step 3: Draft the PR description.**

Required blocks (in this order):

```markdown
## Summary
- Phase 1 (`SC-2026-04-26-1`): drove `verify-rls-protected-tables.sh` to exit 0 — 61 tenant tables registered (or allow-listed with rationale + caller annotations), 4 stale entries dropped, 2 caller-level violations resolved on `systemMonitor` files. Gate now wired into `scripts/run-all-gates.sh`.
- Phase 2 (`CHATGPT-PR203-R2`): replaced the per-row `db.transaction` + `pg_advisory_xact_lock` pattern in `measureInterventionOutcomeJob` with a UNIQUE constraint (migration 0244) + `INSERT ... ON CONFLICT (intervention_id) DO NOTHING`. `recordOutcome` is the single writer to `intervention_outcomes`.
- Phase 3 (`B10`, optional — <shipped | deferred to follow-up>): three maintenance jobs (`ruleAutoDeprecateJob`, `fastPathDecisionsPruneJob`, `fastPathRecalibrateJob`) upgraded from outer-admin-tx + savepoint to per-org `withOrgTx`. Per-job advisory-lock audit recorded in three places.

## CI gate state — Phase 1 known-red window resolution
As of commit <sha>:
- verify-rls-protected-tables.sh   : GREEN
- verify-rls-coverage.sh           : GREEN
- verify-rls-contract-compliance.sh: GREEN
- verify-rls-session-var-canon.sh  : GREEN
- (paste every other gate from the latest CI run with its GREEN/RED status)

CI fails on intermediate commits by design — see spec §3.5.1; evaluate head only.

## Phase 1 migration-number pre-flight count
register-with-new-policy verdicts: <N> tables
Canonical-shape tables (batched up to 4 per file): <C> tables → ceil(C/4) files
Parent-EXISTS tables (1 file each):                <P> tables → P files
Total 0245+ migration files needed:                ceil(C/4) + P = <T>
Available migration slots (0245–0255):             11
Outcome: <T <= 11 → no overflow, proceed | T > 11 → STOP rule triggered>

## Phase 1 allow-list table query touches
Touched files:
- server/services/systemMonitor/baselines/refreshJob.ts
- server/services/systemMonitor/triage/loadCandidates.ts
- (every file containing a query against any newly-allow-listed table)

Full grep output (`grep -nE "@rls-allowlist-bypass" <each file above>`):
<paste output>

NEW call sites added by this PR (the diff added a query against an allow-listed table at):
- (one entry per new call site, or "n/a — no new call sites; only existing call sites modified")

## Phase 2 single-writer invariant grep
Command: grep -rnE "(interventionOutcomes|'intervention_outcomes')" server/ | grep -E "(\.insert\(|\.update\(|onConflict|sql\`(INSERT|UPDATE))"
Output: 1 hit.
Per-hit annotation:
- server/services/interventionService.ts:<line> — write (.onConflictDoNothing on intervention_outcomes — the single owner of the insert per spec §4.3)

## Phase 3 advisory-lock audits (only if Phase 3 shipped)
- ruleAutoDeprecateJob.ts        : Pattern <A|B> | writes lines <...> | lock line <...>
- fastPathDecisionsPruneJob.ts   : Pattern <A|B> | writes lines <...> | lock line <...>
- fastPathRecalibrateJob.ts      : Pattern <A|B> | writes lines <...> | lock line <...>

## Test plan
- [ ] Local: `npm run lint` clean
- [ ] Local: `npx tsc --noEmit -p server/tsconfig.json` clean
- [ ] Local: `npx tsx server/jobs/__tests__/measureInterventionOutcomeJobPure.test.ts` passes
- [ ] CI: every gate GREEN on the head commit
- [ ] CI: `verify-rls-protected-tables.sh` GREEN
- [ ] CI: `verify-rls-coverage.sh` GREEN

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

- [ ] **Step 4: Open the PR.**

```bash
gh pr create --title "Pre-Prod Tenancy Hardening (3 phases — RLS registry, intervention_outcomes UNIQUE, per-org withOrgTx)" --body "$(cat <<'EOF'
<paste the assembled body from step 3>
EOF
)"
```

> **Squash-on-merge.** The intermediate red-CI commits during Phase 1 are for in-branch reviewability — when the PR merges to `main`, squash (or rebase to a single commit) so the noisy intermediate-red history is not on `main`.

---

### Task C.3: Run the review pipeline

Per CLAUDE.md, Standard/Significant/Major tasks require this sequence. This branch is Major.

- [ ] **Step 1: `spec-conformance` first (spec-driven task).**

Invoke from the main session:

```
spec-conformance: verify the current branch against its spec
```

Expected: `CONFORMANT_AFTER_FIXES` or `CONFORMANT`. If `NON_CONFORMANT`, address findings and re-run.

If `CONFORMANT_AFTER_FIXES`, re-run `pr-reviewer` on the expanded changed-code set after the agent's mechanical fixes land.

- [ ] **Step 2: `pr-reviewer`.**

```
pr-reviewer: review the changes in this branch (Phase 1 + Phase 2 + Phase 3 — RLS registry triage, intervention_outcomes unique, per-org withOrgTx)
```

Address blocking + strong findings in-branch. Defer N1-class polish to `tasks/todo.md` per the agent's deferred-items contract.

- [ ] **Step 3: `dual-reviewer` (optional — only if user explicitly asks; local-only).**

```
dual-reviewer: tenant-hardening branch review — three phases as described in PR
```

- [ ] **Step 4: Confirm CI is GREEN on the latest commit before merging.**

---

### Task C.4: Mark spec items closed in `tasks/todo.md`

Per spec §1.1, every closed item from the §1 verification table was already marked `[x]` in `tasks/todo.md`. After merge, also mark `[x]`:
- `SC-2026-04-26-1` — RLS registry triage (Phase 1 deliverable).
- `CHATGPT-PR203-R2` — `intervention_outcomes` unique + ON CONFLICT (Phase 2 deliverable).
- `B10` — maintenance jobs per-org `withOrgTx` (Phase 3 deliverable, only if shipped; otherwise leave open with a deferred-to-follow-up note).

- [ ] **Step 1: Edit `tasks/todo.md` to mark the closed items.**

Each entry follows the existing pattern: `[x]` + closure citation (`closed by PR #<N>` or `closed by commit <sha>`).

- [ ] **Step 2: Commit on the merge target (typically `main` after merge — leave the merge to the user).**

This step happens AFTER the PR merges. The user owns the merge action.

---

## Deferred items (capture during implementation; persist in `tasks/todo.md § Deferred from pre-prod-tenancy spec`)

Track each deferral as it arises. Existing categories per spec §9:

- **Phase 3 (`B10`) maintenance-job per-org `withOrgTx`** — if §5.5 budget rule defers it, capture with the trigger "Phase 1+2 merged on <date>; remaining defense-in-depth upgrade routed to follow-up branch."
- **Sister-branch-owned tables needing new policies** — if a §3.4.1 verdict is `register-with-new-policy` for a table whose owning migration is in `agentRuns.ts` (or another sister-branch path), the registry edit lands here but the policy migration is deferred. Capture with table name + intended policy shape.
- **Phase 1 migration-number-ceiling overflow** — if pre-flight count > 11, defer remaining tables with table list + intended verdicts.
- **Phase 2 load-test absolute rows/sec/org figure** — if the local environment can't sustain ≥ 200 rows/sec/org, capture measured ceiling + trigger for re-measurement.
- **Phase 2 §7.4 gate-self-test fixture** — only if the gate gains a `--fixture-path` argument in a follow-up.
- **CI pipeline-config verification (§9 last item)** — confirm CI actually invokes `bash scripts/run-all-gates.sh` on PR open. If it does not, the gate-wiring is theatre; surface as an architectural finding.
- **Phase 3 advisory-lock pattern-B job deferral** — if any of the three jobs cannot cleanly express the lock under a session-level mechanism, defer that job individually; the other two still ship.
- **`tasks` parent partial-policy escalation (Task 1.4 step 4c)** — if the `tasks` parent has only `USING` and no `WITH CHECK`, the parent itself is partially-policied; out of scope here but block the registry drop and route to a follow-up.

Each entry in `tasks/todo.md` carries a one-line trigger condition and a back-link to the relevant spec section.

---

## Self-review summary (writing-plans skill)

This plan was authored against spec round 7 (commit hash captured at authoring time per Task 1.2 step 1). The author ran the writing-plans skill self-review:

**1. Spec coverage.** Each spec section maps to at least one plan task:
- §0 framing — surfaced in the pre-flight context block.
- §1 verification log — Task C.1 re-runs each row.
- §2 file inventory — mirrored in the "Files to change" table at the top of the plan.
- §3 Phase 1 — Tasks 1.1 → 1.11 (gate wiring, classification deliverable, stale entries, parent-USING+WITH-CHECK verification, register entries, register-with-new-policy migrations, allow-list, caller fixes, PR template, gate confirmation, self-check).
- §4 Phase 2 — Tasks 2.1 → 2.7 (pure test pin, pre-check, schema migration, refactor, load test, acceptance, Phase 3 decision).
- §5 Phase 3 — Tasks 3.1 → 3.8 (audit + refactor for each of three jobs, then triplet cross-check).
- §6 migration sequence + overflow STOP — encoded in Task 1.2 step 4 + Task 1.6 + Closing C.2 PR-description block.
- §7 test matrix — Task 2.1 (pure test) + Task 3.2 step 7 (job-pure tests if extant) + acceptance gates referenced from CI throughout.
- §8 rollout ordering + per-phase commit cadence + sister-branch merge handling — encoded throughout commits and Task C.1.
- §9 deferred items — captured per-task and consolidated in the "Deferred items" block above.
- §10 execution-safety contracts — Phase 2 idempotency / retry / concurrency contracts pinned in spec §4.4–§4.6 and reflected in Task 2.4 (the refactor lands the contract; the spec is the source of truth for the contract text). Phase 3 contracts in spec §5.6 reflected in Tasks 3.1/3.3/3.5 audit and 3.2/3.4/3.6 refactors.
- §11 self-consistency checklist — the spec has already self-checked; this plan does not re-litigate.

**2. Placeholder scan.** No `TBD`, `implement later`, `add appropriate error handling`, or `similar to Task N` placeholders. Every code step shows actual code, actual commands, actual expected output. Substitution markers (`<sha>`, `<N>`, `<table>`) are explicit slots the implementer fills with real values from the live state — they are not placeholders for unknown logic.

**3. Type consistency.** `recordOutcome` is `Promise<boolean>` from Task 2.3 onward (Tasks 2.4, 2.6, 2.7). `withOrgTx` and `withAdminConnection` import paths verified against current `main` (`server/instrumentation.ts:172` and `server/lib/adminDbConnection.ts:58`). Index name `intervention_outcomes_intervention_unique` consistent across migration SQL, Drizzle schema, and `onConflictDoNothing` target reference.

**Risks / ambiguities for the build session to flag if encountered:**

1. **Task 1.2 may surface a different gate-output count.** Spec was authored at 67 violations; if `main` has moved, the table-set freeze invariant kicks in (spec §3.4.1) — the implementer authors a `## Pre-classification baseline delta` paragraph against the new set rather than blindly using the spec's 61-row table.
2. **Task 1.6 may hit the `0245–0255` ceiling.** If pre-flight count > 11, STOP rule fires (spec §6 hard rules). The plan instructs the implementer to surface to user before pushing further commits — this is a deliberate rescope, not an implementer-side decision.
3. **Task 2.2's pre-check may surface duplicates.** Default expectation is empty result; non-zero result + no deterministic rule → STOP and escalate. The plan does not pre-decide a dedup rule; it deliberately routes that decision to the user.
4. **Phase 3 advisory-lock audit may surface a Pattern-B job that cannot use a session-level lock.** Defer that job individually (spec §5.2.1 step 5) rather than blocking the other two.
5. **`Drizzle db:generate` behaviour vs. hand-authored SQL.** The repo follows the hand-authored convention (see `0227–0229`). If `db:generate` rewrites or removes the `0244` SQL, undo and follow the existing convention; the plan instructs the implementer to verify before relying on `db:generate`.
6. **Sister-branch merge during Phase 1.** If `pre-prod-boundary-and-brief-api` or `pre-prod-workflow-and-delegation` merges to `main` mid-Phase-1, spec §8.4's hard requirement kicks in — a `## Post-merge classification delta` entry MUST land before further branch commits. The plan references this in the pre-flight context (item 4 — `progress.md` is a deliverable) but does not have a dedicated task because the trigger is external (a sister branch's merge timing).
