-- Performance test seed for measureInterventionOutcomeJob
-- 2 orgs x 100 eligible actions = 200 rows total
-- Actions: status=completed, action_type in eligible set,
--          executed_at = NOW() - 2 hours (past 1h minimum, well within 14d)
--          subaccount_id populated so resolveAccountIdForSubaccount can find canonical_account

BEGIN;

-- Step 1: Insert connector_configs for each org
INSERT INTO connector_configs (id, organisation_id, connector_type, status)
VALUES
  ('11100001-0000-0000-0000-000000000001', 'bde54a4f-7e21-418a-8741-4a5f2a143a00', 'perf_test', 'active'),
  ('11100001-0000-0000-0000-000000000002', '421fa9b9-0055-44d0-adbd-51e439c4cb0a', 'perf_test', 'active')
ON CONFLICT (id) DO NOTHING;

-- Step 2: Insert canonical_accounts for each org + subaccount
INSERT INTO canonical_accounts (id, organisation_id, connector_config_id, subaccount_id, external_id, status, visibility_scope)
VALUES
  ('22200001-0000-0000-0000-000000000001',
   'bde54a4f-7e21-418a-8741-4a5f2a143a00',
   '11100001-0000-0000-0000-000000000001',
   'b0c7a111-4230-4cb8-aefb-8ca7d16abced',
   'perf-test-account-org1',
   'active', 'shared_subaccount'),
  ('22200001-0000-0000-0000-000000000002',
   '421fa9b9-0055-44d0-adbd-51e439c4cb0a',
   '11100001-0000-0000-0000-000000000002',
   'bc1acf55-d004-4cdb-a823-5b56c4b55d7c',
   'perf-test-account-org2',
   'active', 'shared_subaccount')
ON CONFLICT (id) DO NOTHING;

-- Step 3: Insert 100 eligible actions per org
-- org1 (bde54a4f), agent 62245e06, subaccount b0c7a111
INSERT INTO actions (
  id, organisation_id, subaccount_id, agent_id,
  action_type, action_category, is_external, gate_level,
  status, idempotency_key, payload_json,
  executed_at
)
SELECT
  gen_random_uuid(),
  'bde54a4f-7e21-418a-8741-4a5f2a143a00',
  'b0c7a111-4230-4cb8-aefb-8ca7d16abced',
  '62245e06-c784-4b3f-ae0f-fd03f7c27a40',
  'notify_operator',
  'notification',
  false,
  'auto',
  'completed',
  'perf-test-org1-' || i::text,
  '{"perf_test":true}'::jsonb,
  NOW() - INTERVAL '2 hours'
FROM generate_series(1, 100) AS s(i);

-- org2 (421fa9b9), agent 14364e29, subaccount bc1acf55
INSERT INTO actions (
  id, organisation_id, subaccount_id, agent_id,
  action_type, action_category, is_external, gate_level,
  status, idempotency_key, payload_json,
  executed_at
)
SELECT
  gen_random_uuid(),
  '421fa9b9-0055-44d0-adbd-51e439c4cb0a',
  'bc1acf55-d004-4cdb-a823-5b56c4b55d7c',
  '14364e29-a8e2-4d1f-9e0d-538122061b18',
  'notify_operator',
  'notification',
  false,
  'auto',
  'completed',
  'perf-test-org2-' || i::text,
  '{"perf_test":true}'::jsonb,
  NOW() - INTERVAL '2 hours'
FROM generate_series(1, 100) AS s(i);

-- Verify counts
SELECT 'connector_configs' AS tbl, count(*) FROM connector_configs WHERE connector_type = 'perf_test'
UNION ALL
SELECT 'canonical_accounts', count(*) FROM canonical_accounts WHERE external_id LIKE 'perf-test-account-%'
UNION ALL
SELECT 'actions_org1', count(*) FROM actions WHERE idempotency_key LIKE 'perf-test-org1-%'
UNION ALL
SELECT 'actions_org2', count(*) FROM actions WHERE idempotency_key LIKE 'perf-test-org2-%';

COMMIT;
