/**
 * workflowEngineServicePure pure unit tests — runnable via:
 *   npx vitest run server/services/__tests__/workflowEngineServicePure.test.ts
 *
 * Spec: tasks/builds/agentic-commerce/spec.md §7.3 — validateResumeKind guard.
 * Plan: tasks/builds/agentic-commerce/plan.md §Chunk 10.
 */

import { expect, test } from 'vitest';
import { validateResumeKind } from '../workflowEngineServicePure.js';

// ── spend_approval kind ──────────────────────────────────────────────────────

test('spend slug + spend_approval reviewKind → valid', () => {
  const result = validateResumeKind(
    { reviewKind: 'spend_approval' },
    { actionSlug: 'pay_invoice' },
  );
  expect(result.valid).toBe(true);
});

test('spend slug (purchase_resource) + spend_approval reviewKind → valid', () => {
  const result = validateResumeKind(
    { reviewKind: 'spend_approval' },
    { actionSlug: 'purchase_resource' },
  );
  expect(result.valid).toBe(true);
});

test('spend slug (subscribe_to_service) + spend_approval reviewKind → valid', () => {
  const result = validateResumeKind(
    { reviewKind: 'spend_approval' },
    { actionSlug: 'subscribe_to_service' },
  );
  expect(result.valid).toBe(true);
});

test('spend slug (top_up_balance) + spend_approval reviewKind → valid', () => {
  const result = validateResumeKind(
    { reviewKind: 'spend_approval' },
    { actionSlug: 'top_up_balance' },
  );
  expect(result.valid).toBe(true);
});

test('spend slug (issue_refund) + spend_approval reviewKind → valid', () => {
  const result = validateResumeKind(
    { reviewKind: 'spend_approval' },
    { actionSlug: 'issue_refund' },
  );
  expect(result.valid).toBe(true);
});

// ── non-spend action kinds ───────────────────────────────────────────────────

test('non-spend slug + action_call_approval reviewKind → valid', () => {
  const result = validateResumeKind(
    { reviewKind: 'action_call_approval' },
    { actionSlug: 'config_create_agent' },
  );
  expect(result.valid).toBe(true);
});

test('non-spend slug + supervised_mode reviewKind → valid', () => {
  const result = validateResumeKind(
    { reviewKind: 'supervised_mode' },
    { actionSlug: 'config_list_agents' },
  );
  expect(result.valid).toBe(true);
});

// ── review_kind_mismatch cases ───────────────────────────────────────────────

test('spend slug + non-spend reviewKind → mismatch with expected spend_approval', () => {
  const result = validateResumeKind(
    { reviewKind: 'action_call_approval' },
    { actionSlug: 'pay_invoice' },
  );
  expect(result.valid).toBe(false);
  if (!result.valid) {
    expect(result.code).toBe('review_kind_mismatch');
    expect(result.expected).toBe('spend_approval');
    expect(result.got).toBe('action_call_approval');
  }
});

test('non-spend slug + spend_approval reviewKind → mismatch with expected action_call_approval', () => {
  const result = validateResumeKind(
    { reviewKind: 'spend_approval' },
    { actionSlug: 'config_create_agent' },
  );
  expect(result.valid).toBe(false);
  if (!result.valid) {
    expect(result.code).toBe('review_kind_mismatch');
    expect(result.expected).toBe('action_call_approval');
    expect(result.got).toBe('spend_approval');
  }
});

test('missing actionSlug + spend_approval reviewKind → mismatch (empty slug is not a spend slug)', () => {
  const result = validateResumeKind(
    { reviewKind: 'spend_approval' },
    {},
  );
  expect(result.valid).toBe(false);
  if (!result.valid) {
    expect(result.code).toBe('review_kind_mismatch');
  }
});

test('missing actionSlug + non-spend reviewKind → valid (no slug means no spend classification)', () => {
  const result = validateResumeKind(
    { reviewKind: 'action_call_approval' },
    {},
  );
  expect(result.valid).toBe(true);
});
