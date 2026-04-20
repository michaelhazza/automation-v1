-- Migration 0186 — cost_aggregates `source_type` + `feature_tag` dimensions
--
-- No DDL: `cost_aggregates.entity_type` is a text column already polymorphic
-- across entity types. This migration only documents the two new values the
-- costAggregateService upsert path now writes ('source_type', 'feature_tag').
--
-- The actual write-side change is in server/services/costAggregateService.ts
-- which adds two dimension rows per upsert. The unique upsert key
-- (entity_type, entity_id, period_type, period_key) remains unchanged.

BEGIN;

COMMENT ON COLUMN cost_aggregates.entity_type IS
  'organisation | subaccount | run | agent | task_type | provider | platform | execution_phase | source_type | feature_tag';

COMMIT;
