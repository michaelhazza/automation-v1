-- P3B legacy-compat: add backward-compatible policy branches so the canonical
-- RLS enforcement in 0167/0168 does not break existing callers that have not
-- yet been migrated to `withPrincipalContext`.
--
-- Without this compat layer, any caller that hasn't set
-- `app.current_principal_type` (which is every current production code path,
-- including `canonicalDataService`, `connectorPollingService`, `intelligenceSkillExecutor`,
-- and the GHL webhook) would see every canonical table return zero rows and
-- every write rejected.
--
-- The compat policies allow:
--   - SELECT on canonical tables when `app.current_principal_type` is unset,
--     restricted to org match (legacy behaviour, matches pre-P3B posture)
--   - INSERT/UPDATE/DELETE on canonical tables when `app.current_principal_type`
--     is unset, restricted to org match (legacy ingestion-writer posture)
--
-- These policies are OR'd with the principal-scoped policies. Once all callers
-- pass a principal context (P3C), delete this migration or issue a follow-up
-- that drops the legacy-compat policies.
--
-- IMPORTANT: these policies still require `app.organisation_id` to be set,
-- so any caller that uses the raw `db` handle WITHOUT opening a `withOrgTx`
-- block will NOT be rescued by this migration. See the DEPLOYMENT GATE
-- comment below `integration_connections_legacy_org_read` for the full
-- P3C caller-refactor checklist that must land before this branch is
-- deployed to any environment running with RLS enforced.
--
-- Note on the `IS NULL OR = ''` predicate: `current_setting(name, true)` returns
-- NULL when the GUC has never been set in the current transaction, and returns
-- the set value otherwise. Legacy callers (pre-P3C) never call `set_config`
-- for `app.current_principal_type` at all, so the GUC is NULL for them.
-- `withPrincipalContext` sets it to a non-empty role name ('user', 'service',
-- 'delegated'), so it is never empty string in practice — but we match both
-- NULL and '' defensively, consistent with the existing org-scope idiom in
-- migrations 0079, 0082, 0083, 0084, 0088, and 0091.

-- ---------------------------------------------------------------------------
-- canonical_accounts
-- ---------------------------------------------------------------------------
CREATE POLICY canonical_accounts_legacy_org_read ON canonical_accounts
  FOR SELECT USING (
    organisation_id = current_setting('app.organisation_id', true)::uuid
    AND (current_setting('app.current_principal_type', true) IS NULL
         OR current_setting('app.current_principal_type', true) = '')
  );
CREATE POLICY canonical_accounts_legacy_org_write ON canonical_accounts
  FOR ALL USING (
    organisation_id = current_setting('app.organisation_id', true)::uuid
    AND (current_setting('app.current_principal_type', true) IS NULL
         OR current_setting('app.current_principal_type', true) = '')
  ) WITH CHECK (
    organisation_id = current_setting('app.organisation_id', true)::uuid
    AND (current_setting('app.current_principal_type', true) IS NULL
         OR current_setting('app.current_principal_type', true) = '')
  );

-- ---------------------------------------------------------------------------
-- canonical_contacts
-- ---------------------------------------------------------------------------
CREATE POLICY canonical_contacts_legacy_org_read ON canonical_contacts
  FOR SELECT USING (
    organisation_id = current_setting('app.organisation_id', true)::uuid
    AND (current_setting('app.current_principal_type', true) IS NULL
         OR current_setting('app.current_principal_type', true) = '')
  );
CREATE POLICY canonical_contacts_legacy_org_write ON canonical_contacts
  FOR ALL USING (
    organisation_id = current_setting('app.organisation_id', true)::uuid
    AND (current_setting('app.current_principal_type', true) IS NULL
         OR current_setting('app.current_principal_type', true) = '')
  ) WITH CHECK (
    organisation_id = current_setting('app.organisation_id', true)::uuid
    AND (current_setting('app.current_principal_type', true) IS NULL
         OR current_setting('app.current_principal_type', true) = '')
  );

-- ---------------------------------------------------------------------------
-- canonical_opportunities
-- ---------------------------------------------------------------------------
CREATE POLICY canonical_opportunities_legacy_org_read ON canonical_opportunities
  FOR SELECT USING (
    organisation_id = current_setting('app.organisation_id', true)::uuid
    AND (current_setting('app.current_principal_type', true) IS NULL
         OR current_setting('app.current_principal_type', true) = '')
  );
CREATE POLICY canonical_opportunities_legacy_org_write ON canonical_opportunities
  FOR ALL USING (
    organisation_id = current_setting('app.organisation_id', true)::uuid
    AND (current_setting('app.current_principal_type', true) IS NULL
         OR current_setting('app.current_principal_type', true) = '')
  ) WITH CHECK (
    organisation_id = current_setting('app.organisation_id', true)::uuid
    AND (current_setting('app.current_principal_type', true) IS NULL
         OR current_setting('app.current_principal_type', true) = '')
  );

-- ---------------------------------------------------------------------------
-- canonical_conversations
-- ---------------------------------------------------------------------------
CREATE POLICY canonical_conversations_legacy_org_read ON canonical_conversations
  FOR SELECT USING (
    organisation_id = current_setting('app.organisation_id', true)::uuid
    AND (current_setting('app.current_principal_type', true) IS NULL
         OR current_setting('app.current_principal_type', true) = '')
  );
CREATE POLICY canonical_conversations_legacy_org_write ON canonical_conversations
  FOR ALL USING (
    organisation_id = current_setting('app.organisation_id', true)::uuid
    AND (current_setting('app.current_principal_type', true) IS NULL
         OR current_setting('app.current_principal_type', true) = '')
  ) WITH CHECK (
    organisation_id = current_setting('app.organisation_id', true)::uuid
    AND (current_setting('app.current_principal_type', true) IS NULL
         OR current_setting('app.current_principal_type', true) = '')
  );

-- ---------------------------------------------------------------------------
-- canonical_revenue: read policy already org-scoped; add legacy write
-- ---------------------------------------------------------------------------
CREATE POLICY canonical_revenue_legacy_org_write ON canonical_revenue
  FOR ALL USING (
    organisation_id = current_setting('app.organisation_id', true)::uuid
    AND (current_setting('app.current_principal_type', true) IS NULL
         OR current_setting('app.current_principal_type', true) = '')
  ) WITH CHECK (
    organisation_id = current_setting('app.organisation_id', true)::uuid
    AND (current_setting('app.current_principal_type', true) IS NULL
         OR current_setting('app.current_principal_type', true) = '')
  );

-- ---------------------------------------------------------------------------
-- health_snapshots: read policy already org-scoped; add legacy write
-- ---------------------------------------------------------------------------
CREATE POLICY health_snapshots_legacy_org_write ON health_snapshots
  FOR ALL USING (
    organisation_id = current_setting('app.organisation_id', true)::uuid
    AND (current_setting('app.current_principal_type', true) IS NULL
         OR current_setting('app.current_principal_type', true) = '')
  ) WITH CHECK (
    organisation_id = current_setting('app.organisation_id', true)::uuid
    AND (current_setting('app.current_principal_type', true) IS NULL
         OR current_setting('app.current_principal_type', true) = '')
  );

-- ---------------------------------------------------------------------------
-- anomaly_events: read policy already org-scoped; add legacy write
-- ---------------------------------------------------------------------------
CREATE POLICY anomaly_events_legacy_org_write ON anomaly_events
  FOR ALL USING (
    organisation_id = current_setting('app.organisation_id', true)::uuid
    AND (current_setting('app.current_principal_type', true) IS NULL
         OR current_setting('app.current_principal_type', true) = '')
  ) WITH CHECK (
    organisation_id = current_setting('app.organisation_id', true)::uuid
    AND (current_setting('app.current_principal_type', true) IS NULL
         OR current_setting('app.current_principal_type', true) = '')
  );

-- ---------------------------------------------------------------------------
-- canonical_metrics: read policy already org-scoped; add legacy write
-- ---------------------------------------------------------------------------
CREATE POLICY canonical_metrics_legacy_org_write ON canonical_metrics
  FOR ALL USING (
    organisation_id = current_setting('app.organisation_id', true)::uuid
    AND (current_setting('app.current_principal_type', true) IS NULL
         OR current_setting('app.current_principal_type', true) = '')
  ) WITH CHECK (
    organisation_id = current_setting('app.organisation_id', true)::uuid
    AND (current_setting('app.current_principal_type', true) IS NULL
         OR current_setting('app.current_principal_type', true) = '')
  );

-- ---------------------------------------------------------------------------
-- canonical_metric_history: read policy already org-scoped; add legacy write
-- ---------------------------------------------------------------------------
CREATE POLICY canonical_metric_history_legacy_org_write ON canonical_metric_history
  FOR ALL USING (
    organisation_id = current_setting('app.organisation_id', true)::uuid
    AND (current_setting('app.current_principal_type', true) IS NULL
         OR current_setting('app.current_principal_type', true) = '')
  ) WITH CHECK (
    organisation_id = current_setting('app.organisation_id', true)::uuid
    AND (current_setting('app.current_principal_type', true) IS NULL
         OR current_setting('app.current_principal_type', true) = '')
  );

-- ---------------------------------------------------------------------------
-- integration_connections: principal_read is tighter than org match; legacy
-- fallback allows org-scoped read when principal type is unset
-- ---------------------------------------------------------------------------
CREATE POLICY integration_connections_legacy_org_read ON integration_connections
  FOR SELECT USING (
    organisation_id = current_setting('app.organisation_id', true)::uuid
    AND (current_setting('app.current_principal_type', true) IS NULL
         OR current_setting('app.current_principal_type', true) = '')
  );

-- ===========================================================================
-- DEPLOYMENT GATE — this migration + 0168 together are NOT safe to deploy
-- without the P3C caller refactor.
--
-- The legacy-compat policies above require `app.organisation_id` to be set
-- (via `withOrgTx` / `set_config`). Every current call site in the branch
-- that touches canonical tables or `integration_connections` uses the raw
-- `db` handle without opening a `withOrgTx` block — `canonicalDataService`,
-- `connectorPollingService`, `intelligenceSkillExecutor`, the `ghlWebhook`
-- route, and the `githubWebhook` route are all in this bucket.
--
-- Under 0168's `ENABLE + FORCE ROW LEVEL SECURITY` those call sites will:
--   - SELECT: return zero rows (the legacy-compat USING clause evaluates
--     to NULL because `app.organisation_id` is unset)
--   - INSERT: fail WITH CHECK with an RLS violation
--   - UPDATE/DELETE: match zero rows and silently no-op
--
-- An earlier draft added "no-context bootstrap" policies here that fired
-- whenever BOTH `app.organisation_id` and `app.current_principal_type`
-- were unset. That re-opened table-wide reads on the unauthenticated
-- webhook paths (`ghlWebhook` reading `canonical_accounts` by external_id,
-- `githubWebhook` reading `integration_connections` with only a
-- `providerType` filter) and was correctly flagged as a cross-tenant
-- disclosure vector. It was removed. The narrow, principled fix is to
-- route raw-db callers through `withOrgTx` / `withAdminConnection` — that
-- work is the first deliverable of P3C and MUST land before this branch
-- is deployed to any environment that runs with RLS enforced.
--
-- Shipping-readiness checklist (mirror in `docs/canonical-data-platform-p1-p2-p3-impl.md`):
--   [ ] P3C-01  `canonicalDataService` routes every call through `getOrgScopedDb(...)`
--   [ ] P3C-02  `connectorPollingService` opens a `withOrgTx(orgId, ...)` per connection
--   [ ] P3C-03  `intelligenceSkillExecutor` opens `withOrgTx` / `withPrincipalContext`
--   [ ] P3C-04  `ghlWebhook.ts` bootstrap SELECT moves to `withAdminConnection`
--               with an explicit `SET LOCAL ROLE admin_role`; subsequent writes
--               wrapped in `withOrgTx(orgId, ...)` once the org is known.
--   [ ] P3C-05  `githubWebhook.ts` follows the same pattern as P3C-04
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- NULL-safe dedup on canonical_metric_history (B5)
--
-- The 0066 unique index on (account_id, metric_slug, period_type,
-- period_start, period_end) cannot enforce uniqueness when period_start or
-- period_end is NULL, because NULL != NULL in a unique index. Polling
-- pipelines call appendMetricHistory on every tick; for metrics without a
-- fixed window, NULL-period rows accumulate unbounded.
--
-- Drop the old index, collapse any pre-existing duplicate rows (the exact
-- condition this migration is meant to prevent going forward — and the
-- condition under which `CREATE UNIQUE INDEX` would otherwise fail on
-- production databases), and recreate with a COALESCE sentinel so NULLs
-- compare equal for dedup purposes.
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS canonical_metric_history_dedup_idx;

-- Collapse existing duplicates before building the unique index.
-- The dedup contract says rows with identical (account_id, metric_slug,
-- period_type, period_start, period_end) are semantically identical, so
-- keeping one physical tuple per key (the ctid-smallest) and deleting the
-- rest is safe. `IS NOT DISTINCT FROM` compares NULLs as equal, matching
-- the COALESCE-based uniqueness the new index enforces.
--
-- Because 0168 already applied `FORCE ROW LEVEL SECURITY` to this table
-- before 0169 runs, and the migration runner does not set
-- `app.organisation_id`, the DELETE would match zero rows under the
-- legacy-compat policy. Switch to `admin_role` (BYPASSRLS, declared in
-- migration 0079 which every environment has applied) for the duration
-- of the cleanup, then RESET so the CREATE UNIQUE INDEX that follows
-- runs back under the migration runner's default role and any later
-- statements in the transaction are unaffected. `SET LOCAL` scopes the
-- role change to the current transaction (the migration runner opens
-- one transaction per SQL file).
SET LOCAL ROLE admin_role;

DELETE FROM canonical_metric_history a
  USING canonical_metric_history b
  WHERE a.ctid > b.ctid
    AND a.account_id = b.account_id
    AND a.metric_slug = b.metric_slug
    AND a.period_type = b.period_type
    AND a.period_start IS NOT DISTINCT FROM b.period_start
    AND a.period_end IS NOT DISTINCT FROM b.period_end;

RESET ROLE;

CREATE UNIQUE INDEX canonical_metric_history_dedup_idx
  ON canonical_metric_history (
    account_id,
    metric_slug,
    period_type,
    COALESCE(period_start, 'epoch'::timestamptz),
    COALESCE(period_end, 'epoch'::timestamptz)
  );
