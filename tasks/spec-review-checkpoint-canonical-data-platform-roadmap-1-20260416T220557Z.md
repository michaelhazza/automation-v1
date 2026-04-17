# Spec Review HITL Checkpoint — Iteration 1

**Spec:** `docs/canonical-data-platform-roadmap.md`
**Spec commit at start:** `0f2d7d8b1f0109a5d5ae3d82f4aebe6cda34e38a`
**Spec commit updated mid-review:** `00a67e9` (reconcile spec with shipped RLS infra)
**Spec-context commit:** `7cc51443210f4dab6a7b407f7605a151980d2efc`
**Iteration:** 1 of 5
**Timestamp:** 2026-04-16T22:05:57Z

This checkpoint blocks the review loop. Resolve by editing the `Decision:` lines below, then re-invoking the spec-reviewer agent.

---

## Summary

| # | Finding | Question | Recommendation | Why |
|---|---------|----------|----------------|-----|
| 1.1 | `integration_ingestion_stats` unassigned | Which phase creates this table, or is it deferred? | Assign to P1; remove the "not a phase deliverable" contradiction in D8 | P1 is the first phase with scheduled ingestion runs — without this fix the table never gets created |
| 1.2 | `shared_team_ids` missing from canonical required columns | Add the column to conventions, or change the RLS policy to a session-variable join? | Add `shared_team_ids uuid[]` to the required columns table | The RLS policy already uses this column; the spec uses the same array pattern on connections; it's the simplest consistent path |
| 1.3 | `external_id` vs provider-specific column names | Keep generic `external_id` convention, or allow named equivalents? | Update conventions to allow provider-specific named equivalents | P4/P5 schemas are already done and more explicit; `external_id` is only useful for adapters that have no meaningful provider-specific name |
| 1.4 | Delegated principal RLS vs. visibility rules table | Intentional restriction to `private` only, or oversight? | Intentional — fix the visibility rules table to match the policy | Delegation is for private data only; shared-scope data is accessible via user/service principals without a grant |

---

## Mechanical fixes applied this iteration (no human input needed)

- **Finding 4** — P6 appendix entry was missing P2B as an entry dependency. Fixed.
- **Finding 9** — Required indexes section had no exception note for multi-scoped tables. Fixed.
- **Findings 1–3** — Chunk-placeholder duplicate sections already resolved by user's `00a67e9` commit.

---

## Finding 1.1 — `integration_ingestion_stats` unassigned

**Classification:** ambiguous
**Source:** Rubric-load-bearing-claim
**Spec section:** D8 — Bundled-tier pricing, Implications (line 261)

### Finding (verbatim)

> "Every ingestion run records approximate API-call count and row-count ingested, written to an `integration_ingestion_stats` table (rolling window, not per-event history). Sufficient for internal cost tuning; not exposed to customers."

No phase in the spec introduces a migration that creates this table.

### Recommendation

Remove the phrase "not for a phase deliverable" from D8's preamble (it referred to the commercial pricing motion, not the observability table), and add `integration_ingestion_stats` as a schema deliverable in P1. Minimal schema: `(id uuid pk, connection_id uuid fk, sync_started_at timestamptz, api_calls_approx int, rows_ingested int, created_at timestamptz)`, index on `(connection_id)`, rolling retention of 90 days.

### Why

P1 is when scheduled ingestion first runs. Without this fix, the D8 implication is undeliverable from day one — P2 through P6 all run ingestion jobs without recording cost, making tier economics untunable until an out-of-band catch-up migration. The "not for a phase deliverable" phrase in D8 referred to the pricing/billing infrastructure (meters, dashboards, tier enforcement), not the internal observability row. Separating those two things in D8 resolves the tension cleanly and keeps D8 as a commercial decision record without making it deliver billing infrastructure.

### Classification reasoning

Adding a table to P1's deliverables is a scope-addition signal — sent to HITL rather than auto-applied.

### Decision

```
Decision: apply
Modification (if apply-with-modification): <edit here>
Reject reason (if reject): <edit here>
```

---

## Finding 1.2 — `shared_team_ids` missing from canonical required columns

**Classification:** ambiguous
**Source:** Rubric-load-bearing-claim
**Spec section:** Required columns (lines 408–421) vs. P3B RLS policy (line 944)

### Finding (verbatim)

P3B representative RLS policy uses: `visibility_scope = 'shared-team' AND shared_team_ids && current_setting('app.current_team_ids', true)::uuid[]`

`shared_team_ids` is not in the required columns table, not in the required indexes, and no phase migration adds it to canonical tables. The policy would fail at runtime.

### Recommendation

Add `shared_team_ids uuid[] NOT NULL DEFAULT '{}'` to the Required columns table, and add `(shared_team_ids) using gin` to the Required indexes. Document that adapters populate this from the connection's team visibility when writing canonical rows, and that rows default to `{}` (no team access) until a team is explicitly granted visibility.

### Why

The spec already uses `shared_team_ids uuid[]` on `integration_connections` (P3A) for the same purpose. The canonical-row pattern is a direct analogue. The RLS policy is already written to use this column — changing it to join through `team_members` instead would require every canonical SELECT to issue an extra join against a potentially large membership table. The array-overlap check with a GIN index is the fast path, consistent with the existing connections pattern, and the minimum change that makes the policy work.

### Classification reasoning

Extending the required-columns convention affects every canonical table P3A migrates — non-trivial scope addition that warrants human confirmation.

### Decision

```
Decision: apply
Modification (if apply-with-modification): <edit here>
Reject reason (if reject): <edit here>
```

---

## Finding 1.3 — `external_id` convention vs. provider-specific names in P4/P5

**Classification:** ambiguous
**Source:** Rubric-contradiction
**Spec section:** Required columns (line 417) and Required indexes (line 429) vs. P4/P5 schemas

### Finding (verbatim)

Required columns: `` `external_id` | text nullable | Provider's ID for this row, for idempotent upsert; unique per `(source_connection_id, external_id)` where present ``

P4 `canonical_emails` uses `provider_message_id text NOT NULL` with `UNIQUE (source_connection_id, provider_message_id)` — no `external_id`.
P5 `canonical_calendar_events` uses `provider_event_id text NOT NULL` with `UNIQUE (source_connection_id, provider_event_id)` — no `external_id`.

### Recommendation

Update the conventions section required-columns row and required-index row to read: "Provider's ID for this row for idempotent upsert. Use `external_id` for generic adapters, or a provider-specific name (e.g. `provider_message_id`, `provider_event_id`) where the intent is clearer. The required index is `UNIQUE (source_connection_id, <id_column>)`."

### Why

The P4/P5 schemas are already written and more explicit — `provider_message_id` is unambiguous in a way `external_id` is not. Renaming them would be a breaking, cosmetic change. Generic adapters that have no natural provider-specific name (future file-sync adapters, etc.) can still use `external_id`. The invariant the convention protects is idempotent upsert via a unique key per connection — naming the invariant rather than the column is the right level of abstraction.

### Classification reasoning

Naming convention decision — could reasonably go either way; not a pure consistency fix.

### Decision

```
Decision: apply
Modification (if apply-with-modification): <edit here>
Reject reason (if reject): <edit here>
```

---

## Finding 1.4 — Delegated principal RLS vs. visibility rules table

**Classification:** ambiguous
**Source:** Rubric-invariant
**Spec section:** Principal model visibility rules table (lines 348–356) vs. P3B delegated branch (lines 950–952)

### Finding (verbatim)

Visibility rules table (delegated column): `shared-subaccount` → Yes, `shared-org` → Yes.

P3B RLS policy delegated branch:
```sql
-- delegated principals: narrow scope, validated further at service layer
(current_setting('app.current_principal_type', true) = 'delegated'
  AND visibility_scope = 'private'
  AND owner_user_id::text = current_setting('app.current_principal_id', true))
```

Only `private` rows are reachable via the policy. `shared-subaccount` and `shared-org` rows are blocked by RLS before the service layer sees them.

### Recommendation

The policy is correct. Fix the visibility rules table: change `shared-subaccount` and `shared-org` in the delegated column from "Yes" to "No". Add a footnote: "Delegated principals access the grantor's private data only. Shared-scope data does not require delegation — it is accessible to service and user principals directly."

### Why

Delegation grants exist to let an agent act on a specific user's private data (their Gmail inbox, their private calendar). Shared-subaccount and shared-org data (CRM contacts, revenue metrics, public calendar events) is accessible to any service principal running in that subaccount — no grant is needed to reach it. If a delegated principal could also see shared data, the blast radius of a compromised or over-granted delegation would be significantly wider than its stated purpose implies. The policy comment ("narrow scope, validated further at service layer") already signals this was a deliberate design choice; the visibility rules table was simply not updated when the narrower policy was written.

### Classification reasoning

The policy comment hints at intentional restriction, but only a human can confirm it matches the intended product behaviour — sent to HITL rather than auto-applying a rules-table correction.

### Decision

```
Decision: apply
Modification (if apply-with-modification): <edit here>
Reject reason (if reject): <edit here>
```

---

## How to resume

Edit all `Decision:` lines (options: `apply`, `apply-with-modification`, `reject`, `stop-loop`), save, then re-invoke:

```
spec-reviewer: review docs/canonical-data-platform-roadmap.md
```

The agent reads this file first, honours each decision, then continues to iteration 2.
