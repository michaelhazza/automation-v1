# Stub: Canonical-registry 3-set drift test upgrade

**Trigger to activate:** When the next `canonical_*` table is added OR when Phase 5A spec authoring picks up.

**Scope (one paragraph).** Upgrade `server/services/__tests__/canonicalRegistryDriftPure.test.ts` from 2-set comparison to 3-set comparison per `docs/superpowers/specs/2026-04-26-audit-remediation-followups-spec.md` §C3. Add a `canonicalTable: string` metadata field to each entry in `server/services/crmQueryPlanner/executors/canonicalQueryRegistryMeta.ts`; extract the `queryPlannerTables` set from the registry metadata; assert `queryPlannerTables ⊆ dictionaryTables`. Update the test's header comment to reflect three-set comparison. Small, mechanical, blocked only by the metadata-field addition.

**Origin:** C3 follow-up in legacy `tasks/todo.md`.
