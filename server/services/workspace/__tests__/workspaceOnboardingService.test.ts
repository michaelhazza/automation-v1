/**
 * workspaceOnboardingService.test.ts — status-aware idempotency resume logic
 *
 * Three stages:
 *   A: prior attempt left identity at 'provisioned' → retry resumes and activates
 *   B: prior attempt fully completed ('active') → retry is no-op, idempotent: true
 *   C: prior attempt left identity at 'revoked' → retry returns failure
 *
 * Runnable via:
 *   npx tsx server/services/workspace/__tests__/workspaceOnboardingService.test.ts
 *
 * Uses direct function mocking (mutating exported service objects in-place) and
 * wraps each onboard() call in withOrgTx() so getOrgScopedDb() receives the mock tx.
 *
 * Env vars are stubbed before dynamic import so env.ts validation passes without
 * a real DATABASE_URL. No DB connection is made during the test.
 */

import { strict as assert } from 'node:assert';
// S5: type-only import — `WorkspaceAdapter` is an `export interface`, which
// erases at runtime, so trying to extract it from `typeof <namespace>` resolves
// to `never` and silently disables type-checking on `NOOP_ADAPTER`. `import type`
// is stripped by tsx at runtime and gives the test a real shape to satisfy.
import type { WorkspaceAdapter } from '../../../../shared/types/workspaceAdapterContract.js';

// ── Stub required env vars before any module that imports server/lib/env.ts ──
//    env.ts validation runs at module evaluation time; these must be set first.
process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
process.env.JWT_SECRET = 'test-jwt-secret-that-is-at-least-32-chars-long!';
process.env.EMAIL_FROM = 'test@example.com';

// Dynamic imports — loaded after env stubs are in place
const { withOrgTx } = await import('../../../instrumentation.js');
const { workspaceIdentityService } = await import('../workspaceIdentityService.js');
const { workspaceActorService } = await import('../workspaceActorService.js');
const { onboard } = await import('../workspaceOnboardingService.js');

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err instanceof Error ? err.message : String(err)}`);
  }
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ── Fixed UUIDs used across all stages ─────────────────────────────────────

const ORG_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const SUBACCOUNT_ID = 'bbbbbbbb-0000-0000-0000-000000000002';
const AGENT_ID = 'cccccccc-0000-0000-0000-000000000003';
const ACTOR_ID = 'dddddddd-0000-0000-0000-000000000004';
const IDENTITY_ID = 'eeeeeeee-0000-0000-0000-000000000005';
const REQUEST_ID = 'ffffffff-0000-0000-0000-000000000006';
const USER_ID = 'a1a1a1a1-0000-0000-0000-000000000007';
const CONNECTOR_CONFIG_ID = 'b2b2b2b2-0000-0000-0000-000000000008';
const EMAIL_ADDRESS = 'agent@test.example.com';

// ── Base params shared across stages ────────────────────────────────────────

const BASE_PARAMS = {
  organisationId: ORG_ID,
  subaccountId: SUBACCOUNT_ID,
  agentId: AGENT_ID,
  displayName: 'Test Agent',
  emailLocalPart: 'agent',
  emailSendingEnabled: true,
  onboardingRequestId: REQUEST_ID,
  initiatedByUserId: USER_ID,
};

// ── Noop adapter (must never be invoked in idempotency-path tests) ───────────
// All methods throw — these tests exercise the resume/idempotency paths only;
// the adapter MUST NOT be reached. Typing as `WorkspaceAdapter` ensures any
// future addition to the contract surfaces here as a type error rather than
// being silently elided (S5 fix).

const noopMethod = async (): Promise<never> => {
  throw new Error('Adapter should not be called when identity already exists');
};

const NOOP_ADAPTER: WorkspaceAdapter = {
  backend: 'synthetos_native',
  provisionIdentity: noopMethod,
  suspendIdentity: noopMethod,
  resumeIdentity: noopMethod,
  revokeIdentity: noopMethod,
  archiveIdentity: noopMethod,
  sendEmail: noopMethod,
  fetchInboundSince: noopMethod,
  createEvent: noopMethod,
  respondToEvent: noopMethod,
  fetchUpcoming: noopMethod,
};

// ── Common fixture rows ──────────────────────────────────────────────────────

type MockRow = Record<string, unknown>;

const AGENT_ROW: MockRow = {
  id: AGENT_ID,
  workspaceActorId: ACTOR_ID,
};

const ACTOR_ROW: MockRow = {
  id: ACTOR_ID,
  organisationId: ORG_ID,
  displayName: 'Test Agent',
};

function makeIdentityRow(status: string): MockRow {
  return {
    id: IDENTITY_ID,
    organisationId: ORG_ID,
    actorId: ACTOR_ID,
    emailAddress: EMAIL_ADDRESS,
    status,
    provisioningRequestId: REQUEST_ID,
  };
}

// ── Mock tx builder ─────────────────────────────────────────────────────────
//
// Builds a minimal drizzle-like mock tx. Routes:
//   - 1st select → agents (returns agentRow)
//   - 2nd select → workspaceActors (returns actorRow)
//   - 3rd select → workspaceIdentities (returns existingIdentityRow or [])
//   - every insert → captures action names; records whether .onConflictDoNothing() was chained

interface MockTxResult {
  tx: unknown;
  insertedActions: string[][];
  conflictDoNothingCallCount: { value: number };
}

function buildMockTx(opts: {
  agentRow: MockRow;
  actorRow: MockRow;
  existingIdentityRow: MockRow | null;
}): MockTxResult {
  const insertedActions: string[][] = [];
  const conflictDoNothingCallCount = { value: 0 };

  let selectCallCount = 0;

  const mockTx = {
    select: () => {
      selectCallCount++;
      const callIdx = selectCallCount;
      return {
        from: (_table: unknown) => ({
          where: (_cond: unknown): Promise<MockRow[]> => {
            if (callIdx === 1) return Promise.resolve([opts.agentRow]);
            if (callIdx === 2) return Promise.resolve([opts.actorRow]);
            if (callIdx === 3) return Promise.resolve(opts.existingIdentityRow ? [opts.existingIdentityRow] : []);
            return Promise.resolve([]);
          },
        }),
      };
    },
    insert: (_table: unknown) => ({
      values: (v: unknown) => {
        const rows = Array.isArray(v) ? v : [v];
        const actions = rows
          .map((r: Record<string, unknown>) => r['action'] as string)
          .filter(Boolean);
        return {
          onConflictDoNothing: (): Promise<unknown[]> => {
            conflictDoNothingCallCount.value++;
            insertedActions.push(actions);
            return Promise.resolve([]);
          },
        };
      },
    }),
  };

  return { tx: mockTx, insertedActions, conflictDoNothingCallCount };
}

// ── Patch/restore helpers ────────────────────────────────────────────────────

function patchTransition(impl: (id: string, action: string, userId: string) => Promise<{ status: string; noOpDueToRace: boolean }>): () => void {
  const original = workspaceIdentityService.transition;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (workspaceIdentityService as any).transition = impl;
  return () => { (workspaceIdentityService as any).transition = original; };
}

function patchUpdateDisplayName(): () => void {
  const original = workspaceActorService.updateDisplayName;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (workspaceActorService as any).updateDisplayName = async () => ({});
  return () => { (workspaceActorService as any).updateDisplayName = original; };
}

// ── Stage A: identity at 'provisioned' → resume path ────────────────────────

console.log('');
console.log('workspaceOnboardingService — idempotency resume logic');
console.log('');
console.log('Stage A: identity at provisioned → resume and activate:');

await test('A1: calls transition(activate) and writes all three audit events', async () => {
  let transitionCalled = false;
  let capturedTransitionId = '';
  let capturedAction = '';

  const restoreTransition = patchTransition(async (id, action) => {
    transitionCalled = true;
    capturedTransitionId = id;
    capturedAction = action;
    return { status: 'active', noOpDueToRace: false };
  });
  const restoreDisplayName = patchUpdateDisplayName();

  const { tx, insertedActions, conflictDoNothingCallCount } = buildMockTx({
    agentRow: AGENT_ROW,
    actorRow: ACTOR_ROW,
    existingIdentityRow: makeIdentityRow('provisioned'),
  });

  try {
    const result = await withOrgTx(
      { tx, organisationId: ORG_ID, source: 'test' },
      () => onboard(BASE_PARAMS, { adapter: NOOP_ADAPTER, connectorConfigId: CONNECTOR_CONFIG_ID }),
    );

    assert(
      typeof result === 'object' && result !== null && !('failureReason' in result),
      'should not return failure',
    );
    const r = result as { identityId: string; emailAddress: string; idempotent: boolean };
    assertEqual(r.identityId, IDENTITY_ID, 'identityId');
    assertEqual(r.emailAddress, EMAIL_ADDRESS, 'emailAddress');
    assertEqual(r.idempotent, true, 'idempotent flag');

    assert(transitionCalled, 'transition() must be called');
    assertEqual(capturedTransitionId, IDENTITY_ID, 'transition called with correct identityId');
    assertEqual(capturedAction, 'activate', 'transition action is activate');

    const allActions = insertedActions.flat();
    assert(allActions.includes('identity.provisioned'), 'identity.provisioned written');
    assert(allActions.includes('actor.onboarded'), 'actor.onboarded written');
    assert(allActions.includes('identity.activated'), 'identity.activated written');

    assert(conflictDoNothingCallCount.value > 0, 'onConflictDoNothing must be chained');
  } finally {
    restoreTransition();
    restoreDisplayName();
  }
});

await test('A2: noOpDueToRace on transition is treated as success', async () => {
  const restoreTransition = patchTransition(async () => ({ status: 'active', noOpDueToRace: true }));
  const restoreDisplayName = patchUpdateDisplayName();

  const { tx } = buildMockTx({
    agentRow: AGENT_ROW,
    actorRow: ACTOR_ROW,
    existingIdentityRow: makeIdentityRow('provisioned'),
  });

  try {
    const result = await withOrgTx(
      { tx, organisationId: ORG_ID, source: 'test' },
      () => onboard(BASE_PARAMS, { adapter: NOOP_ADAPTER, connectorConfigId: CONNECTOR_CONFIG_ID }),
    );

    assert(
      typeof result === 'object' && result !== null && !('failureReason' in result),
      'should succeed even when noOpDueToRace',
    );
    assertEqual((result as { idempotent: boolean }).idempotent, true, 'idempotent: true on race');
  } finally {
    restoreTransition();
    restoreDisplayName();
  }
});

// ── Stage B: identity already 'active' → no-op path ────────────────────────

console.log('Stage B: identity already active → no-op, idempotent: true:');

await test('B1: returns idempotent: true, does not call transition', async () => {
  let transitionCalled = false;
  const restoreTransition = patchTransition(async () => {
    transitionCalled = true;
    return { status: 'active', noOpDueToRace: false };
  });

  const { tx, conflictDoNothingCallCount } = buildMockTx({
    agentRow: AGENT_ROW,
    actorRow: ACTOR_ROW,
    existingIdentityRow: makeIdentityRow('active'),
  });

  try {
    const result = await withOrgTx(
      { tx, organisationId: ORG_ID, source: 'test' },
      () => onboard(BASE_PARAMS, { adapter: NOOP_ADAPTER, connectorConfigId: CONNECTOR_CONFIG_ID }),
    );

    assert(
      typeof result === 'object' && result !== null && !('failureReason' in result),
      'should not return failure',
    );
    const r = result as { identityId: string; idempotent: boolean };
    assertEqual(r.identityId, IDENTITY_ID, 'identityId');
    assertEqual(r.idempotent, true, 'idempotent: true');

    assert(!transitionCalled, 'transition() must NOT be called when identity is already active');
    assert(conflictDoNothingCallCount.value > 0, 'onConflictDoNothing chained on backfill insert');
  } finally {
    restoreTransition();
  }
});

await test('B2: adapter provisionIdentity is never called when identity is active', async () => {
  let adapterCalled = false;
  const strictAdapter = {
    backend: 'synthetos_native' as const,
    provisionIdentity: async (): Promise<never> => {
      adapterCalled = true;
      throw new Error('adapter must not be called');
    },
    deprovisionIdentity: async () => {},
    syncIdentitySettings: async () => {},
  };

  const { tx } = buildMockTx({
    agentRow: AGENT_ROW,
    actorRow: ACTOR_ROW,
    existingIdentityRow: makeIdentityRow('active'),
  });

  await withOrgTx(
    { tx, organisationId: ORG_ID, source: 'test' },
    () => onboard(BASE_PARAMS, { adapter: strictAdapter, connectorConfigId: CONNECTOR_CONFIG_ID }),
  );

  assert(!adapterCalled, 'adapter must not be called when identity is already active');
});

// ── Stage C: identity at 'revoked' → terminal state path ────────────────────

console.log('Stage C: identity at revoked → failure, no transition:');

await test('C1: returns failure(workspace_identity_provisioning_failed) for revoked', async () => {
  let transitionCalled = false;
  const restoreTransition = patchTransition(async () => {
    transitionCalled = true;
    return { status: 'revoked', noOpDueToRace: false };
  });

  const { tx } = buildMockTx({
    agentRow: AGENT_ROW,
    actorRow: ACTOR_ROW,
    existingIdentityRow: makeIdentityRow('revoked'),
  });

  try {
    const result = await withOrgTx(
      { tx, organisationId: ORG_ID, source: 'test' },
      () => onboard(BASE_PARAMS, { adapter: NOOP_ADAPTER, connectorConfigId: CONNECTOR_CONFIG_ID }),
    );

    assert(
      typeof result === 'object' && result !== null && 'failureReason' in result,
      'should return failure object for revoked identity',
    );
    assertEqual(
      (result as { failureReason: string }).failureReason,
      'workspace_identity_provisioning_failed',
      'correct failure reason',
    );
    assert(!transitionCalled, 'transition() must NOT be called for terminal state');
  } finally {
    restoreTransition();
  }
});

await test('C2: archived identity also returns failure', async () => {
  const { tx } = buildMockTx({
    agentRow: AGENT_ROW,
    actorRow: ACTOR_ROW,
    existingIdentityRow: makeIdentityRow('archived'),
  });

  const result = await withOrgTx(
    { tx, organisationId: ORG_ID, source: 'test' },
    () => onboard(BASE_PARAMS, { adapter: NOOP_ADAPTER, connectorConfigId: CONNECTOR_CONFIG_ID }),
  );

  assert(
    typeof result === 'object' && result !== null && 'failureReason' in result,
    'should return failure for archived identity',
  );
  assertEqual(
    (result as { failureReason: string }).failureReason,
    'workspace_identity_provisioning_failed',
    'correct failure reason for archived',
  );
});

// ── Summary ──────────────────────────────────────────────────────────────────

console.log('');
console.log(`${passed} passed, ${failed} failed`);
console.log('');
if (failed > 0) process.exit(1);
