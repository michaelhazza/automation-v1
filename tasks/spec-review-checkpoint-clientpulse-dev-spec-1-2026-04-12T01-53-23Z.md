# Spec Review HITL Checkpoint — Iteration 1

**Spec:** `docs/clientpulse-dev-spec.md`
**Spec commit:** `90e465caf0a4bef3dcef3972ea2acd053d88f84d`
**Spec-context commit:** `7cc51443210f4dab6a7b407f7605a151980d2efc`
**Iteration:** 1 of 5
**Timestamp:** 2026-04-12T01:53:23Z

This checkpoint blocks the review loop. The loop will not proceed to iteration 2 until every finding below is resolved by the human. Resolve by editing this file in place and changing the `Decision:` line for each finding, then re-invoking the spec-reviewer agent.

---

## Finding 1.1 — RLS policies for new org-scoped tables

**Classification:** ambiguous
**Signal matched:** Could be "Add a new cross-cutting contract" (directional) or could be mechanical enforcement of an existing codebase pattern (the RLS manifest + CI gate)
**Source:** Rubric-load-bearing-claims-without-contracts

### Spec section

Section 11 (Migration inventory) and the four new table definitions in Sections 3.2, 4.1, 6.5.

### Finding (from rubric review)

The spec introduces 4 new tables: `modules`, `subscriptions`, `org_subscriptions`, and `reports`. The codebase has an RLS manifest at `server/config/rlsProtectedTables.ts` with a CI gate (`verify-rls-coverage.sh`) that fails when a manifest entry has no matching `CREATE POLICY` in any migration.

- **`reports`** has an `organisation_id` column and contains per-org health/intelligence data. It is analogous to `agent_runs` (which has RLS). This table almost certainly needs an RLS policy.
- **`org_subscriptions`** has an `organisation_id` column and contains per-org billing state. Cross-tenant leak would reveal billing status of other orgs.
- **`modules`** is a system-admin-managed catalogue with no `organisation_id` column. It is read by all orgs but written only by system admins. Likely does NOT need RLS.
- **`subscriptions`** is a system-admin-managed catalogue with no `organisation_id` column. Same as `modules` — likely does NOT need RLS.

The spec mentions "RLS three-layer tenant isolation" as an existing primitive (Section 2.5) but never specifies which of the new tables need RLS policies, and the migration inventory (Section 11) does not include any RLS migration.

### Tentative recommendation (non-authoritative)

If this were mechanical, I would add to the migration inventory:
- A new migration (e.g. 0107) that adds RLS policies for `reports` and `org_subscriptions`
- Add both tables to `server/config/rlsProtectedTables.ts`
- Leave `modules` and `subscriptions` without RLS (system-admin catalogues, no org_id column)

This is marked as ambiguous because:
1. The decision about which tables need RLS has security implications
2. The codebase currently has 14 RLS-protected tables — whether to add 2 more is a security-posture decision
3. In pre-production with no live data, the urgency is low, and the human may prefer to defer RLS for these tables to a later sprint

### Reasoning

The existing codebase pattern is clear: org-scoped tables with `organisation_id` get RLS policies. Both `reports` and `org_subscriptions` fit this pattern. However, whether to add them NOW (in this spec) or defer them is a sequencing/scope question I cannot resolve mechanically. Adding them is 0.5 day of work and affects the migration inventory and effort estimates.

### Decision

Edit the line below to one of: `apply`, `apply-with-modification`, `reject`, `stop-loop`. If `apply-with-modification`, add the modification inline. If `reject`, add a one-sentence reason. If `stop-loop`, the review loop exits and the spec stays in its current state for the human to rethink.

```
Decision: apply
Modification (if apply-with-modification): 
Reject reason (if reject): 
```

---

## How to resume the loop

After editing all `Decision:` lines above:

1. Save this file.
2. Re-invoke the spec-reviewer agent with the same spec path.
3. The agent will read this checkpoint file as its first action, honour each decision (apply, apply-with-modification, reject, or stop-loop), and continue to iteration 2.

If you want to stop the loop entirely without resolving findings, set any decision to `stop-loop` and the loop will exit immediately after honouring the findings that have been marked `apply` or `apply-with-modification`.
