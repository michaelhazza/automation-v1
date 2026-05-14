# G1 Migration Sequencing — Progress Log

**Build slug:** tasks/builds/audit-remediation-followups/g1-migration-sequencing/
**Spec section:** §1 Group G — G1

## Status
Script authored. First-run against local dev DB is an operator step requiring DATABASE_URL.

## Files created
- scripts/verify-migration-sequencing.sh — implements 4 checks
- scripts/__tests__/migration-sequencing/ — deliberate-fault fixtures

## First-run output
Pending operator execution. Run:
  DATABASE_URL=<local-dev-db-url> bash scripts/verify-migration-sequencing.sh

## Checks implemented
1. Migration file sequential ordering (no gaps, no duplicates)
2. Fresh-DB migration replay (all SQL files execute without error)
3. Tenant tables have FORCE ROW LEVEL SECURITY
4. Forward-reference check (FK REFERENCES to not-yet-declared tables)
