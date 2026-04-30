/**
 * workspaceOnboardingService.test.ts — status-aware idempotency resume logic
 *
 * Three stages:
 *   A: prior attempt left identity at 'provisioned' → retry resumes and activates
 *   B: prior attempt fully completed ('active') → retry is no-op, idempotent: true
 *   C: prior attempt left identity at 'revoked' → retry returns failure
 *
 * Uses direct function mocking (mutating exported service objects in-place) and
 * wraps each onboard() call in withOrgTx() so getOrgScopedDb() receives the mock tx.
 *
 * Env vars are stubbed before dynamic import so env.ts validation passes without
 * a real DATABASE_URL. No DB connection is made during the test.
 */

import { describe, test, expect, beforeAll } from 'vitest';
// S5: type-only import — `WorkspaceAdapter` is an `export interface`, which
// erases at runtime, so trying to extract it from `typeof <namespace>` resolves
// to `never` and silently disables type-checking on `NOOP_ADAPTER`.
import type { WorkspaceAdapter } from '../../../../shared/types/workspaceAdapterContract.js';

// Stub required env vars before any module that imports server/lib/env.ts.
// env.ts validation runs at module evaluation time; ??= ensures idempotency.
process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/test';
process.env.JWT_SECRET ??= 'test-jwt-secret-that-is-at-least-32-chars-long!';
process.env.EMAIL_FROM ??= 'test@example.com';

// Service handles — populated in beforeAll after env stubs are in place.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let withOrgTx: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let workspaceIdentityService: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let workspaceActorService: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let onboard: any;

beforeAll(async () => {
  ({ withOrgTx } = await import('../../../instrumentation.js'));
  ({ workspaceIdentityService } = await import('../workspaceIdentityService.js'));
  ({ workspaceActorService } = await import('../workspaceActorService.js'));
  ({ onboard } = await import('../workspaceOnboardingService.js'));
});

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

const AGENT_ROW: MockRow = { id: AGENT_ID, workspaceActorId: ACTOR_ID };
const ACTOR_ROW: MockRow = { id: ACTOR_ID, organisationId: ORG_ID, displayName: 'Test Agent' };

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

describe('Stage A: identity at provisioned → resume and activate', () => {
  test('A1: calls transition(activate) and writes all three audit events', async () => {
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

      expect(result).toBeDefined();
      expect('failureReason' in result).toBe(false);
      expect(result.identityId).toBe(IDENTITY_ID);
      expect(result.emailAddress).toBe(EMAIL_ADDRESS);
      expect(result.idempotent).toBe(true);

      expect(transitionCalled).toBe(true);
      expect(capturedTransitionId).toBe(IDENTITY_ID);
      expect(capturedAction).toBe('activate');

      const allActions = insertedActions.flat();
      expect(allActions).toContain('identity.provisioned');
      expect(allActions).toContain('actor.onboarded');
      expect(allActions).toContain('identity.activated');

      expect(conflictDoNothingCallCount.value).toBeGreaterThan(0);
    } finally {
      restoreTransition();
      restoreDisplayName();
    }
  });

  test('A2: noOpDueToRace on transition is treated as success', async () => {
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

      expect(result).toBeDefined();
      expect('failureReason' in result).toBe(false);
      expect(result.idempotent).toBe(true);
    } finally {
      restoreTransition();
      restoreDisplayName();
    }
  });
});

// ── Stage B: identity already 'active' → no-op path ────────────────────────

describe('Stage B: identity already active → no-op, idempotent: true', () => {
  test('B1: returns idempotent: true, does not call transition', async () => {
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

      expect(result).toBeDefined();
      expect('failureReason' in result).toBe(false);
      expect(result.identityId).toBe(IDENTITY_ID);
      expect(result.idempotent).toBe(true);
      expect(transitionCalled).toBe(false);
      expect(conflictDoNothingCallCount.value).toBeGreaterThan(0);
    } finally {
      restoreTransition();
    }
  });

  test('B2: adapter provisionIdentity is never called when identity is active', async () => {
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

    expect(adapterCalled).toBe(false);
  });
});

// ── Stage C: identity at 'revoked' → terminal state path ────────────────────

describe('Stage C: identity at revoked → failure, no transition', () => {
  test('C1: returns failure(workspace_identity_provisioning_failed) for revoked', async () => {
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

      expect(result).toBeDefined();
      expect('failureReason' in result).toBe(true);
      expect((result as { failureReason: string }).failureReason).toBe('workspace_identity_provisioning_failed');
      expect(transitionCalled).toBe(false);
    } finally {
      restoreTransition();
    }
  });

  test('C2: archived identity also returns failure', async () => {
    const { tx } = buildMockTx({
      agentRow: AGENT_ROW,
      actorRow: ACTOR_ROW,
      existingIdentityRow: makeIdentityRow('archived'),
    });

    const result = await withOrgTx(
      { tx, organisationId: ORG_ID, source: 'test' },
      () => onboard(BASE_PARAMS, { adapter: NOOP_ADAPTER, connectorConfigId: CONNECTOR_CONFIG_ID }),
    );

    expect(result).toBeDefined();
    expect('failureReason' in result).toBe(true);
    expect((result as { failureReason: string }).failureReason).toBe('workspace_identity_provisioning_failed');
  });
});
