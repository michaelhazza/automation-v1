# migration-sequencing test fixtures

These fixtures are used to verify `scripts/verify-migration-sequencing.sh` detects specific failure modes:

- `out-of-order-fixture.sql` — represents a migration arriving out of sequence
- `missing-rls-fixture.sql` — represents a tenant table (has `organisation_id`) without FORCE RLS

Each fixture should cause the script to fail with the offending table/file named in output.
These are NOT real migrations; they live here for documentation and manual fixture testing.
