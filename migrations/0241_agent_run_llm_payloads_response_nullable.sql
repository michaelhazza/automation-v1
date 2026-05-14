-- Spec: docs/superpowers/specs/2026-04-28-pre-test-integration-harness-spec.md §1.5 Option A.
-- Allow `response IS NULL` on the failure path when there is no usable
-- provider output to persist. Partial responses (streaming interrupted,
-- usage-without-content) are stored non-null; null is reserved for "no
-- usable provider output exists".
BEGIN;
ALTER TABLE agent_run_llm_payloads ALTER COLUMN response DROP NOT NULL;
COMMIT;
