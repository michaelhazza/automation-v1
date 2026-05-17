# WF1 RLS Verification — wave-6-rls-residue-and-gate-fix

**Chunk:** 0 (design/audit — no code changes)
**Verification date:** 2026-05-17
**Scope:** Five FK-scoped workflow tables identified as WF1 tables in spec §7.3.
**Method:** grep across all `migrations/*.sql` for `CREATE POLICY` targeting any of the five current table names or their pre-rename names. Cross-referenced against `server/config/rlsProtectedTables.ts` manifest.

---

## Finding

A grep across ALL migrations for `CREATE POLICY` targeting ANY of the five WF1 table names (including pre-rename names) returns **ZERO matches**. None of the five tables have an RLS policy in any migration file. None appear in `server/config/rlsProtectedTables.ts`, confirming they are unprotected at the Postgres policy layer.

---

## Per-Table Verdict

| Table name | Pre-rename name | Policy exists on current main? | Policy migration file | FK parent(s) | FK parent has RLS? | Recommendation |
|-----------|----------------|-------------------------------|----------------------|-------------|-------------------|---------------|
| workflow_step_runs | playbook_step_runs (renamed migration 0221) | NO | none | workflow_runs | deferred (manifest entry exists, policy pending Wave 6) | author contingent migration in Chunk 5 |
| workflow_step_reviews | playbook_step_reviews (renamed migration 0221) | NO | none | workflow_step_runs | NO (no policy, see above) | author contingent migration in Chunk 5 |
| workflow_studio_sessions | playbook_studio_sessions (renamed migration 0221) | NO | none | users | YES (migration 0245 adds RLS policy on users) | author contingent migration in Chunk 5 |
| workflow_run_event_sequences | playbook_run_event_sequences (renamed migration 0221) | NO | none | workflow_runs | deferred (manifest entry exists, policy pending Wave 6) | author contingent migration in Chunk 5 |
| flow_step_outputs | workflow_step_outputs (renamed migration 0219) | NO | none | flow_runs (formerly workflow_runs, renamed migration 0219) | deferred (manifest entry exists under original name, policy pending Wave 6) | author contingent migration in Chunk 5 |

---

## FK Chain Detail

**workflow_step_runs**
- FK: `workflow_step_runs.workflow_run_id` REFERENCES `workflow_runs`
- `workflow_runs` is in the deferred-enforcement manifest (present in `rlsProtectedTables.ts` with a deferred-enforcement comment; no enabling CREATE POLICY has landed as of 2026-05-17)
- Policy template: EXISTS subquery joining via `workflow_run_id -> workflow_runs -> organisation_id`

**workflow_step_reviews**
- FK: `workflow_step_reviews.step_run_id` REFERENCES `workflow_step_runs`
- `workflow_step_runs` itself has no RLS policy (see above)
- Policy template: double-hop EXISTS subquery joining via `step_run_id -> workflow_step_runs -> workflow_run_id -> workflow_runs -> organisation_id`

**workflow_studio_sessions**
- FK: `workflow_studio_sessions.user_id` REFERENCES `users`
- `users` has an RLS policy (migration 0245)
- Policy template: EXISTS subquery joining via `user_id -> users -> organisation_id` (or direct `organisation_id` column if one was added to the table — verify at Chunk 5)

**workflow_run_event_sequences**
- FK: `workflow_run_event_sequences.workflow_run_id` REFERENCES `workflow_runs`
- Same deferred parent as `workflow_step_runs`
- Policy template: EXISTS subquery joining via `workflow_run_id -> workflow_runs -> organisation_id`

**flow_step_outputs**
- FK: `flow_step_outputs.flow_run_id` REFERENCES `flow_runs` (the table formerly known as `workflow_runs` before migration 0219)
- `flow_runs` is in the deferred-enforcement manifest
- Policy template: EXISTS subquery joining via `flow_run_id -> flow_runs -> organisation_id`

---

## Rationale for "Contingent" Recommendation

The Chunk 0 finding is that no RLS policy exists for any of the five tables TODAY (2026-05-17). The recommendation is "author contingent migration in Chunk 5" rather than "author migration unconditionally" because:

1. A parallel branch could land an RLS policy for one or more of these tables before Chunk 5 executes. If Chunk 5 writes a migration without checking first, the result would be a duplicate policy (Postgres errors on duplicate policy names for the same table).

2. The deferred-enforcement parent tables (`workflow_runs`, `flow_runs`) may also receive their own enabling policies between now and Chunk 5. If the parent gains a policy, the EXISTS-chain template for the child tables may need adjustment to avoid double-evaluation overhead.

3. `verify-fk-only-tenant-tables.sh` (gate #75) already tracks these five tables via the baseline in `scripts/.gate-baselines/fk-only-tenant-tables.txt`. Chunk 5 must confirm the baseline entries are still present (meaning no other PR landed the policy) before writing its migration.

**The "contingent" label means:** verify each table's policy state against current `main` at the start of Chunk 5, then write the migration only for tables that still lack a policy.

---

## Verification Evidence

The following grep command was used to confirm zero matches (run on 2026-05-17 against `main` at commit `c2b32e4b`):

```bash
# Search for CREATE POLICY on any WF1 table (current or pre-rename names)
grep -rl "CREATE POLICY" migrations/*.sql | xargs grep -l \
  "workflow_step_runs\|workflow_step_reviews\|workflow_studio_sessions\|workflow_run_event_sequences\|flow_step_outputs\|playbook_step_runs\|playbook_step_reviews\|playbook_studio_sessions\|playbook_run_event_sequences\|workflow_step_outputs"
```

Result: no output (zero files matched).

Cross-reference with `rlsProtectedTables.ts`:

```bash
grep -E "workflow_step_runs|workflow_step_reviews|workflow_studio_sessions|workflow_run_event_sequences|flow_step_outputs" \
  server/config/rlsProtectedTables.ts
```

Result: no output (none of the five tables appear in the manifest).
