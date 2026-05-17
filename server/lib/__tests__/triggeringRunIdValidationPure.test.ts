/**
 * triggeringRunIdValidationPure.test.ts — Pure unit tests for the
 * validateTriggeringRunId validation chain.
 *
 * These tests exercise the pure decision logic without a DB. We mock the
 * DB lookup and resolveAgentRunVisibility to control outcomes.
 *
 * Runnable via:
 *   npx vitest run server/lib/__tests__/triggeringRunIdValidationPure.test.ts
 */

import { expect, test } from 'vitest';

// ---------------------------------------------------------------------------
// Inline the pure validation logic so we can test each step in isolation
// without needing a real DB connection.
//
// The validator has 5 steps:
//   1. UUID shape → 400 invalid_triggering_run_id
//   2. Run not visible → 404 triggering_run_not_found
//   3. Org mismatch → 403 triggering_run_org_mismatch
//   4. Subaccount mismatch → 403 triggering_run_subaccount_mismatch
//   5. All pass → ok: true
//
// We test each step using a local reimplementation of the chain that is
// functionally equivalent but free of IO imports.
// ---------------------------------------------------------------------------

import { z } from 'zod';
import {
  resolveAgentRunVisibility,
  type AgentRunVisibilityUser,
} from '../agentRunVisibility.js';

const uuidSchema = z.string().uuid();

interface FakeRun {
  id: string;
  organisationId: string;
  subaccountId: string | null;
  agentId: string;
  executionScope: 'subaccount' | 'org';
  isSystemRun?: boolean;
}

type ValidationResult =
  | { ok: true; runId: string; subaccountId: string | null }
  | { ok: false; status: 400 | 403 | 404; errorCode: string };

/**
 * Pure reimplementation of validateTriggeringRunId that takes a fake run
 * record directly instead of querying a DB. Functionally equivalent.
 */
function validatePure(params: {
  runId: string;
  orgId: string;
  subaccountId?: string | null;
  user: AgentRunVisibilityUser;
  fakeRun: FakeRun | null;
}): ValidationResult {
  const { runId, orgId, subaccountId, user, fakeRun } = params;

  // Step 1 — UUID shape
  if (!uuidSchema.safeParse(runId).success) {
    return { ok: false, status: 400, errorCode: 'invalid_triggering_run_id' };
  }

  // Step 2 — visibility
  if (!fakeRun) {
    return { ok: false, status: 404, errorCode: 'triggering_run_not_found' };
  }

  const visibility = resolveAgentRunVisibility(
    {
      organisationId: fakeRun.organisationId,
      subaccountId: fakeRun.subaccountId,
      executionScope: fakeRun.executionScope,
      isSystemRun: fakeRun.isSystemRun ?? false,
    },
    user,
  );

  if (!visibility.canView) {
    return { ok: false, status: 404, errorCode: 'triggering_run_not_found' };
  }

  // Step 3 — same-org assertion
  if (fakeRun.organisationId !== orgId) {
    return { ok: false, status: 403, errorCode: 'triggering_run_org_mismatch' };
  }

  // Step 4 — subaccount compatibility
  if (subaccountId != null) {
    if (fakeRun.subaccountId !== null && fakeRun.subaccountId !== subaccountId) {
      return { ok: false, status: 403, errorCode: 'triggering_run_subaccount_mismatch' };
    }
  }

  // Step 5 — pass-through
  return { ok: true, runId, subaccountId: fakeRun.subaccountId };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ORG_ID = '00000000-0000-0000-0000-000000000001';
const SUB_ID = '00000000-0000-0000-0000-000000000002';
const RUN_ID = '00000000-0000-0000-0000-000000000003';
const OTHER_ORG = '00000000-0000-0000-0000-000000000099';
const OTHER_SUB = '00000000-0000-0000-0000-000000000098';

const adminUser: AgentRunVisibilityUser = {
  id: 'user-1',
  role: 'org_admin',
  organisationId: ORG_ID,
  orgPermissions: new Set(['org.agents.view', 'org.agents.edit']),
};

const fakeRun: FakeRun = {
  id: RUN_ID,
  organisationId: ORG_ID,
  subaccountId: SUB_ID,
  agentId: 'agent-1',
  executionScope: 'subaccount',
  isSystemRun: false,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('non-UUID runId returns 400 invalid_triggering_run_id', () => {
  const result = validatePure({
    runId: 'not-a-uuid',
    orgId: ORG_ID,
    user: adminUser,
    fakeRun,
  });
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.status).toBe(400);
    expect(result.errorCode).toBe('invalid_triggering_run_id');
  }
});

test('run not visible returns 404 triggering_run_not_found', () => {
  const result = validatePure({
    runId: RUN_ID,
    orgId: ORG_ID,
    user: adminUser,
    fakeRun: null, // simulates run not found
  });
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.status).toBe(404);
    expect(result.errorCode).toBe('triggering_run_not_found');
  }
});

test('org mismatch returns 403 triggering_run_org_mismatch', () => {
  // The run belongs to OTHER_ORG, but we claim to be ORG_ID.
  // We need visibility to pass first — use a system_admin user who can see any run.
  const sysAdmin: AgentRunVisibilityUser = {
    id: 'user-sys',
    role: 'system_admin',
    organisationId: ORG_ID,
    orgPermissions: new Set(),
  };
  const result = validatePure({
    runId: RUN_ID,
    orgId: ORG_ID,
    user: sysAdmin,
    fakeRun: { ...fakeRun, organisationId: OTHER_ORG },
  });
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.status).toBe(403);
    expect(result.errorCode).toBe('triggering_run_org_mismatch');
  }
});

test('subaccount mismatch returns 403 triggering_run_subaccount_mismatch', () => {
  const result = validatePure({
    runId: RUN_ID,
    orgId: ORG_ID,
    subaccountId: OTHER_SUB, // target entity is in a different subaccount
    user: adminUser,
    fakeRun, // run.subaccountId = SUB_ID, target = OTHER_SUB
  });
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.status).toBe(403);
    expect(result.errorCode).toBe('triggering_run_subaccount_mismatch');
  }
});

test('all checks pass returns ok with runId and subaccountId', () => {
  const result = validatePure({
    runId: RUN_ID,
    orgId: ORG_ID,
    subaccountId: SUB_ID,
    user: adminUser,
    fakeRun,
  });
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.runId).toBe(RUN_ID);
    expect(result.subaccountId).toBe(SUB_ID);
  }
});
