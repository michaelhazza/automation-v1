/**
 * systemIncidentService.escalation.regression.test.ts
 *
 * Regression safety net for the B2 fix in commit 3423a0d5 — verifies
 * that escalateIncidentToAgent sets the `app.organisation_id` GUC at
 * the top of its transaction BEFORE invoking taskService.createTaskCore.
 *
 * Without this, FORCE-RLS on `tasks` rejects the insert when the
 * caller does NOT go through the orgScoping HTTP middleware (e.g.
 * system-monitoring jobs or boot-time escalations).
 *
 * Build: pre-test-hardening  Source review: pr-reviewer S1 recommendation
 */

import { describe, it, expect, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Module-level mocks — hoisted before any production imports.
// ---------------------------------------------------------------------------

const txInstrumentation = vi.hoisted(() => ({
  executeCalls: [] as Array<{ sqlString: string }>,
  insertCalls: [] as string[],
  taskServiceCreateCalls: [] as Array<{ organisationId: string }>,
}));

// Mock db.transaction so we capture the order of execute() calls inside it.
vi.mock('../../db/index.js', () => ({
  db: {
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        execute: vi.fn(async (q: unknown) => {
          const repr = (() => {
            try { return JSON.stringify(q); }
            catch { return String(q); }
          })();
          txInstrumentation.executeCalls.push({ sqlString: repr });
          return [];
        }),
        insert: vi.fn(() => {
          txInstrumentation.insertCalls.push('insert');
          return {
            values: vi.fn().mockResolvedValue([]),
          };
        }),
        update: vi.fn(() => ({
          set: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          returning: vi.fn().mockResolvedValue([
            {
              id: 'incident-1111',
              status: 'escalated',
              escalationCount: 1,
              escalatedTaskId: 'task-2222',
            },
          ]),
        })),
        select: vi.fn(() => {
          const chain: Record<string, unknown> = {};
          const resolved = Promise.resolve([]);
          chain.from = vi.fn(() => chain);
          chain.where = vi.fn(() => chain);
          chain.orderBy = vi.fn(() => chain);
          chain.limit = vi.fn(() => resolved);
          chain.then = (onfulfilled: (v: unknown[]) => unknown, onrejected?: (e: unknown) => unknown) =>
            resolved.then(onfulfilled, onrejected);
          return chain;
        }),
      };
      return fn(tx);
    }),
  },
}));

// Mock taskService so the escalation does not pull in the full task-creation graph.
// PTH-CGT-R5-F1: post-refactor, escalateIncidentToAgent uses createTaskCore +
// emitCreateTaskSideEffects (split for after-commit semantics). Mock both.
vi.mock('../taskService.js', () => ({
  taskService: {
    createTask: vi.fn(async (input: { organisationId: string }) => {
      txInstrumentation.taskServiceCreateCalls.push({ organisationId: input.organisationId });
      return { id: 'task-2222', organisationId: input.organisationId };
    }),
    createTaskCore: vi.fn(async (input: { organisationId: string }) => {
      txInstrumentation.taskServiceCreateCalls.push({ organisationId: input.organisationId });
      return { id: 'task-2222', organisationId: input.organisationId };
    }),
    emitCreateTaskSideEffects: vi.fn(),
  },
}));

// Mock the sysOps context resolver so we control the GUC value.
vi.mock('../systemOperationsOrgResolver.js', () => ({
  resolveSystemOpsContext: vi.fn(async () => ({
    organisationId: 'sysops-org-1111-2222-3333-444444444444',
    subaccountId: 'sysops-sub-1111-2222-3333-444444444444',
  })),
}));

// Mock the incident lookup so we control the escalation precondition.
vi.mock('../systemIncidentServicePure.js', () => ({
  canTransition: vi.fn(() => true),
  computeEscalationVerdict: vi.fn(() => ({ allowed: true })),
  resolutionEventPayload: vi.fn(() => ({})),
}));

// ---------------------------------------------------------------------------

import { systemIncidentService } from '../systemIncidentService.js';

describe('systemIncidentService.escalateIncidentToAgent — B2 regression', () => {
  it('sets the app.organisation_id GUC as the first execute() call inside its transaction (before taskService.createTaskCore runs)', async () => {
    // Reset instrumentation for this test.
    txInstrumentation.executeCalls.length = 0;
    txInstrumentation.insertCalls.length = 0;
    txInstrumentation.taskServiceCreateCalls.length = 0;

    // Stub getIncident: the service reads the incident outside the tx before
    // escalating. We monkey-patch the prototype method on the service object
    // (the service is a literal-typed singleton).
    const getIncidentSpy = vi
      .spyOn(systemIncidentService, 'getIncident')
      .mockResolvedValueOnce({
        incident: {
          id: 'incident-1111',
          organisationId: 'org-orig-aaaa-bbbb-cccc-dddddddddddd',
          subaccountId: 'sub-orig-aaaa-bbbb-cccc-dddddddddddd',
          status: 'open',
          severity: 'high',
          source: 'webhook',
          summary: 'Webhook handler crashed',
          fingerprint: 'webhook:teamwork:handler_failed',
          firstSeenAt: new Date('2026-05-10T00:00:00Z'),
          lastSeenAt: new Date('2026-05-11T00:00:00Z'),
          escalationCount: 0,
          escalatedAt: null,
          escalatedTaskId: null,
          previousTaskIds: [],
          occurrenceCount: 5,
          errorCode: 'TEAMWORK_BAD_GATEWAY',
          suppressedUntil: null,
          rateLimitWindowStartedAt: null,
          rateLimitCount: 0,
          classification: 'unclassified',
          createdAt: new Date('2026-05-10T00:00:00Z'),
          updatedAt: new Date('2026-05-11T00:00:00Z'),
        },
        events: [],
        suppressions: [],
      } as never);

    try {
      await systemIncidentService.escalateIncidentToAgent('incident-1111', 'user-1234');

      // The tx.execute() recording must show SELECT set_config first.
      expect(txInstrumentation.executeCalls.length).toBeGreaterThanOrEqual(1);
      const firstExecute = txInstrumentation.executeCalls[0]!.sqlString;
      expect(firstExecute).toMatch(/set_config/i);
      expect(firstExecute).toMatch(/app\.organisation_id/);
      expect(firstExecute).toContain('sysops-org-1111-2222-3333-444444444444');

      // taskService.createTask was called with the sysOps org id (not the incident's org).
      expect(txInstrumentation.taskServiceCreateCalls.length).toBe(1);
      expect(txInstrumentation.taskServiceCreateCalls[0]!.organisationId)
        .toBe('sysops-org-1111-2222-3333-444444444444');
    } finally {
      getIncidentSpy.mockRestore();
    }
  });
});
