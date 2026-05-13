# Stub: Integration-test infra hardening

**Trigger to activate:** When the next integration-test authoring sprint surfaces friction with current TEST_ORG_ID seeding or the non-superuser CI role.

**Scope (one paragraph).** Ship the three named test-infra deferrals as one short build: TI-006 (canonical UUID for TEST_ORG_ID + harness seeding), TI-007 (conventions doc — `docs/testing-conventions.md` formalisation), TI-008 (non-superuser CI role for RLS verification). All three carry concrete effort estimates in the original integration-tests-fix-brief; they share the same harness work.

**Origin:** TI-006 / 007 / 008 in legacy `tasks/todo.md`.
