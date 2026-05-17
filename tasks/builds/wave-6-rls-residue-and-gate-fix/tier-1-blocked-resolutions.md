# Tier 1-blocked Resolutions — wave-6-rls-residue-and-gate-fix

**Date:** 2026-05-18
**Blocked count:** 0

No Tier 1-blocked entries were found in tier-categorisation.md. All callsites were resolvable to a concrete upstream entrypoint within 5 hops, or were correctly classified as Tier 2 / guard-ignore.

The tier-categorisation.md lists entries in the following verdict distribution:
- Tier 1 (migrated to getOrgScopedDb/withOrgTx): ~883 entries
- Tier 2 (guard-ignore or withAdminConnection): 159 entries
- Tier 0 / already-migrated (pre-existing org-scoped): annotated where applicable
- Tier 1-blocked: 0

The absence of Tier 1-blocked entries reflects the design of the Wave 6 migration: every callsite that could not be directly migrated was either:
(a) Confirmed as a legitimate admin/cross-tenant operation (Tier 2, annotated with ADR-0041 rationale), or
(b) Already using an org-scoped connection from a prior wave migration (Tier 0).

No escalation deferral table is required.
