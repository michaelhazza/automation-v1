// ---------------------------------------------------------------------------
// approvalChannelServicePure — Vitest unit suite
//
// Spec: tasks/builds/agentic-commerce/spec.md §11.1, §13.2, §13.3
// Plan: tasks/builds/agentic-commerce/plan.md § Chunk 9
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import {
  collectEligibleChannels,
  classifyResponse,
  computeNotificationPayload,
  validateGrantTransition,
  type SubaccountChannel,
  type OrgChannel,
  type ActiveGrant,
} from '../approvalChannelServicePure.js';
import type { ApprovalResolution } from '../../../shared/types/approvalChannel.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeSubaccountChannel(
  overrides: Partial<SubaccountChannel> = {},
): SubaccountChannel {
  return {
    id: 'sub-ch-1',
    channelType: 'in_app',
    enabled: true,
    config: {},
    ...overrides,
  };
}

function makeOrgChannel(overrides: Partial<OrgChannel> = {}): OrgChannel {
  return {
    id: 'org-ch-1',
    channelType: 'in_app',
    enabled: true,
    config: {},
    organisationId: 'org-1',
    ...overrides,
  };
}

function makeGrant(overrides: Partial<ActiveGrant> = {}): ActiveGrant {
  return {
    id: 'grant-1',
    orgChannelId: 'org-ch-1',
    subaccountId: 'sub-1',
    active: true,
    ...overrides,
  };
}

function makeResolution(overrides: Partial<ApprovalResolution> = {}): ApprovalResolution {
  return {
    actionId: 'action-1',
    resolvedBy: {
      userId: 'user-1',
      channelType: 'in_app',
      respondedAt: new Date('2026-05-03T10:00:00.000Z'),
    },
    decision: 'approved',
    resolutionMessage: 'Charge approved',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// collectEligibleChannels
// ---------------------------------------------------------------------------

describe('collectEligibleChannels', () => {
  it('includes a single enabled subaccount channel', () => {
    const result = collectEligibleChannels(
      [makeSubaccountChannel()],
      [],
      [],
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ channelId: 'sub-ch-1', source: 'subaccount' });
  });

  it('excludes disabled subaccount channels', () => {
    const result = collectEligibleChannels(
      [makeSubaccountChannel({ enabled: false })],
      [],
      [],
    );
    expect(result).toHaveLength(0);
  });

  it('includes org channel with active grant', () => {
    const result = collectEligibleChannels(
      [],
      [makeOrgChannel()],
      [makeGrant()],
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ channelId: 'org-ch-1', source: 'org_grant' });
  });

  it('excludes org channel without a grant', () => {
    const result = collectEligibleChannels(
      [],
      [makeOrgChannel()],
      [], // no grants
    );
    expect(result).toHaveLength(0);
  });

  it('excludes org channel with revoked grant (active = false)', () => {
    const result = collectEligibleChannels(
      [],
      [makeOrgChannel()],
      [makeGrant({ active: false })],
    );
    expect(result).toHaveLength(0);
  });

  it('excludes disabled org channel even when grant is active', () => {
    const result = collectEligibleChannels(
      [],
      [makeOrgChannel({ enabled: false })],
      [makeGrant()],
    );
    expect(result).toHaveLength(0);
  });

  it('combines subaccount and org channels', () => {
    const result = collectEligibleChannels(
      [makeSubaccountChannel({ id: 'sub-ch-1' })],
      [makeOrgChannel({ id: 'org-ch-1' })],
      [makeGrant({ orgChannelId: 'org-ch-1' })],
    );
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.channelId)).toContain('sub-ch-1');
    expect(result.map((r) => r.channelId)).toContain('org-ch-1');
  });

  it('only includes org channels whose ID appears in active grants', () => {
    const result = collectEligibleChannels(
      [],
      [
        makeOrgChannel({ id: 'org-ch-1' }),
        makeOrgChannel({ id: 'org-ch-2' }),
      ],
      [makeGrant({ orgChannelId: 'org-ch-1' })], // only ch-1 is granted
    );
    expect(result).toHaveLength(1);
    expect(result[0].channelId).toBe('org-ch-1');
  });

  it('returns empty list when no channels configured at all', () => {
    expect(collectEligibleChannels([], [], [])).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// classifyResponse
// ---------------------------------------------------------------------------

describe('classifyResponse', () => {
  it("classifies as 'winning' when charge is still pending_approval", () => {
    expect(classifyResponse('pending_approval', { decision: 'approved' })).toBe('winning');
  });

  it("classifies as 'winning' for a deny decision on pending_approval", () => {
    expect(classifyResponse('pending_approval', { decision: 'denied' })).toBe('winning');
  });

  it("classifies as 'superseded' when charge is already approved", () => {
    expect(classifyResponse('approved', { decision: 'approved' })).toBe('superseded');
  });

  it("classifies as 'superseded' when charge is already denied", () => {
    expect(classifyResponse('denied', { decision: 'denied' })).toBe('superseded');
  });

  it("classifies as 'superseded' when charge is in any terminal state", () => {
    for (const status of ['blocked', 'failed', 'succeeded', 'shadow_settled']) {
      expect(classifyResponse(status, { decision: 'approved' })).toBe('superseded');
    }
  });
});

// ---------------------------------------------------------------------------
// computeNotificationPayload
// ---------------------------------------------------------------------------

describe('computeNotificationPayload', () => {
  it('includes actionId in output', () => {
    const resolution = makeResolution();
    const payload = computeNotificationPayload(resolution);
    expect(payload.actionId).toBe('action-1');
  });

  it('includes the decision in output', () => {
    const payload = computeNotificationPayload(makeResolution({ decision: 'denied' }));
    expect(payload.decision).toBe('denied');
  });

  it('message contains userId, channelType, and ISO timestamp', () => {
    const payload = computeNotificationPayload(makeResolution());
    expect(payload.message).toContain('user-1');
    expect(payload.message).toContain('in_app');
    expect(payload.message).toContain('2026-05-03T10:00:00.000Z');
  });

  it('message includes the resolution message from the resolution', () => {
    const payload = computeNotificationPayload(
      makeResolution({ resolutionMessage: 'Approved by admin' }),
    );
    expect(payload.message).toContain('Approved by admin');
  });

  it('produces a deterministic output for the same resolution', () => {
    const r = makeResolution();
    expect(computeNotificationPayload(r)).toEqual(computeNotificationPayload(r));
  });
});

// ---------------------------------------------------------------------------
// validateGrantTransition
// ---------------------------------------------------------------------------

describe('validateGrantTransition', () => {
  it('permits active → revoked', () => {
    const result = validateGrantTransition('active', 'revoked');
    expect(result.valid).toBe(true);
  });

  it('rejects revoked → active (re-enablement not permitted)', () => {
    const result = validateGrantTransition('revoked', 'active');
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe('revoked_grant_cannot_be_reactivated');
    }
  });

  it('rejects active → active (no-op)', () => {
    const result = validateGrantTransition('active', 'active');
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe('no_op_transition');
    }
  });

  it('rejects revoked → revoked (no-op)', () => {
    const result = validateGrantTransition('revoked', 'revoked');
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe('no_op_transition');
    }
  });
});
