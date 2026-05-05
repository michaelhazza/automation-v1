# rls-protected-tables test fixtures

These fixtures document the failure modes for `scripts/verify-rls-protected-tables.sh`.
They are NOT real migrations; they live here for documentation and manual fixture testing.

## Failure modes

### 1. Schema-vs-registry drift (blocking, Phase 1)

A new migration that creates a tenant table without registering it.

See `unregistered-table-fixture.sql`. To reproduce:

1. Drop the fixture into `migrations/9999_fixture.sql` (DO NOT COMMIT).
2. Run `bash scripts/verify-rls-protected-tables.sh`.
3. Expect: gate fails with
   `Table 'sample_tenant_widget' has organisation_id but is not in rlsProtectedTables.ts and not in rls-not-applicable-allowlist.txt.`
4. Either register the table in `server/config/rlsProtectedTables.ts` or add it
   to `scripts/rls-not-applicable-allowlist.txt` to clear the failure.
5. Remove the fixture.

### 2. Stale registry entry (blocking, Phase 1)

A table in `rlsProtectedTables.ts` whose policy migration no longer exists or
whose `CREATE TABLE` was never authored.

To reproduce: add a fake entry to the manifest pointing at a non-existent
migration and run the gate. Expect:
`Registry entry '<table>' has no matching CREATE TABLE ... organisation_id in any migration.`

### 3. Missing `allowRlsBypass: true` justification comment (blocking, Phase 3)

Any call site that passes `allowRlsBypass: true` to
`withAdminConnectionGuarded` must carry an inline justification comment within
+/-1 line. The comment shape: `// allowRlsBypass: <one-sentence rationale>`.

To reproduce: add a call site without the comment and run the gate. Expect:
`allowRlsBypass: true is missing the inline justification comment.`

The check is blocking on day 1 — there is no advisory-mode interim per spec
§A2 DoD Phase 3.

### 4. Raw `.execute(sql)` write-path coverage (advisory, Phase 3)

Any `.execute(sql\`...\`)` call within +/-10 lines of a registered tenant-table
name must be paired with an `assertRlsAwareWrite('<table>')` call in the same
window. If absent, the gate emits an advisory violation but exits 0. The
baseline is tracked in `scripts/guard-baselines.json`. Promotion to blocking
follows the spec §0.1 Gate Quality Bar protocol.

## Why these aren't real fixture migrations

We don't drop fixture `.sql` files into `migrations/` because the migrations
tree is monotonic and Drizzle would attempt to apply any `.sql` file present.
The fixture below is a documentation reference; running the gate against a
locally-edited migration directory is the test path.
