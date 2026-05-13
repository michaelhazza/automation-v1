// guard-ignore-file: pure-helper-convention reason="Uses vi.mock to stub db + eaDraftService; dispatchService is an orchestrator, not a pure helper"
/**
 * eaDraftDispatchService.test.ts
 *
 * Verifies chatgpt-pr-review R2 F2: the dispatch hook claims the draft
 * (idle -> sending) BEFORE routing, and marks send_failed if the route
 * throws. Drafts must never remain in `approved` + `idle` after a failed
 * dispatch attempt — manual retry then works from `send_failed`.
 *
 * Run via:
 *   npx vitest run server/services/eaDrafts/__tests__/eaDraftDispatchService.test.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock surface
// ---------------------------------------------------------------------------

const fakeDraftRow = {
  id: 'draft-1',
  organisationId: 'org-1',
  subaccountId: 'sub-1',
  ownerUserId: 'user-1',
  proposalActionId: 'action-1',
  kind: 'slack_post' as const,
  body: { channelId: 'C123', text: 'hello' },
  sendState: 'idle' as const,
};

let claimSendMock = vi.fn();
let markSendFailedMock = vi.fn();

vi.mock('../eaDraftService.js', () => ({
  eaDraftService: {
    claimSend: (...args: unknown[]) => claimSendMock(...args),
    markSendFailed: (...args: unknown[]) => markSendFailedMock(...args),
  },
}));

// Stub db.select(...).from(...).where(...).limit(...) to return [fakeDraftRow]
// for the eaDrafts lookup performed by dispatchAfterApproval.
const dbSelectChain = {
  from: () => dbSelectChain,
  where: () => dbSelectChain,
  limit: () => Promise.resolve([fakeDraftRow]),
};
vi.mock('../../../db/index.js', () => ({
  db: {
    select: () => dbSelectChain,
  },
}));

// Make the slack handler throw to simulate "failure before claim" scenarios.
// (e.g. dynamic import target throws, body mismatch, routing bug.)
const slackHandlerMock: ReturnType<typeof vi.fn> = vi.fn(async (
  _draftId: string,
  _ctx: { _dispatchPreClaimed?: boolean },
) => {
  throw new Error('simulated routing failure');
});
vi.mock('../../slack/slackActionService.js', () => ({
  slackActionService: {
    executeApprovedDraftSend: slackHandlerMock,
  },
}));

// Stub the actions/eaDrafts schema imports so the dispatch module loads
// without pulling the real drizzle schema graph.
vi.mock('../../../db/schema/eaDrafts.js', () => ({ eaDrafts: {} }));
vi.mock('../../../db/schema/actions.js', () => ({ actions: {} }));

beforeEach(() => {
  claimSendMock = vi.fn();
  markSendFailedMock = vi.fn();
  slackHandlerMock.mockClear();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('eaDraftDispatchService.dispatchAfterApproval — R2 F2 claim-first', () => {
  it('claims the draft before invoking the handler', async () => {
    claimSendMock.mockResolvedValue({ claimed: true });
    // Override the default throwing impl for the success path of this test.
    slackHandlerMock.mockImplementationOnce(async () => ({ sent: true, ts: '123' }));

    const { eaDraftDispatchService } = await import('../eaDraftDispatchService.js');
    await eaDraftDispatchService.dispatchAfterApproval('action-1', 'org-1');

    expect(claimSendMock).toHaveBeenCalledWith('draft-1', { organisationId: 'org-1' });
    expect(claimSendMock).toHaveBeenCalledTimes(1);
    expect(slackHandlerMock).toHaveBeenCalledTimes(1);
    // Handler was passed the pre-claimed flag so it skips its own claim.
    const handlerCall = slackHandlerMock.mock.calls[0] as unknown as [
      string,
      { _dispatchPreClaimed?: boolean },
    ];
    expect(handlerCall[1]._dispatchPreClaimed).toBe(true);
    expect(markSendFailedMock).not.toHaveBeenCalled();
  });

  it('returns silently when claim is already in flight (idempotent)', async () => {
    claimSendMock.mockResolvedValue({ claimed: false, reason: 'DRAFT_SEND_IN_FLIGHT' });

    const { eaDraftDispatchService } = await import('../eaDraftDispatchService.js');
    await eaDraftDispatchService.dispatchAfterApproval('action-1', 'org-1');

    expect(claimSendMock).toHaveBeenCalledTimes(1);
    expect(slackHandlerMock).not.toHaveBeenCalled();
    expect(markSendFailedMock).not.toHaveBeenCalled();
  });

  it('marks send_failed when routing throws after a successful claim', async () => {
    claimSendMock.mockResolvedValue({ claimed: true });
    // slackHandlerMock default impl throws.

    const { eaDraftDispatchService } = await import('../eaDraftDispatchService.js');
    await eaDraftDispatchService.dispatchAfterApproval('action-1', 'org-1');

    expect(claimSendMock).toHaveBeenCalledTimes(1);
    expect(slackHandlerMock).toHaveBeenCalledTimes(1);
    expect(markSendFailedMock).toHaveBeenCalledWith('draft-1', { organisationId: 'org-1' });
    expect(markSendFailedMock).toHaveBeenCalledTimes(1);
  });
});
