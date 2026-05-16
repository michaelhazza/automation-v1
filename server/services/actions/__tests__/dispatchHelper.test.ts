import { describe, it, expect, vi } from 'vitest';

vi.mock('../../eaDrafts/eaDraftService.js', () => ({
  eaDraftService: {
    claimSend: vi.fn(),
    markSendFailed: vi.fn(),
    markSent: vi.fn(),
  },
}));

import { dispatchWithDraftClaim } from '../dispatchHelper.js';
import { eaDraftService } from '../../eaDrafts/eaDraftService.js';

const mockClaim = eaDraftService.claimSend as ReturnType<typeof vi.fn>;
const mockFail = eaDraftService.markSendFailed as ReturnType<typeof vi.fn>;
const mockSent = eaDraftService.markSent as ReturnType<typeof vi.fn>;

const ctx = { organisationId: 'org1', subaccountId: 'sub1', ownerUserId: 'user1' };

describe('dispatchWithDraftClaim', () => {
  it('skips claimSend when _dispatchPreClaimed is true', async () => {
    mockSent.mockResolvedValue(undefined);
    const result = await dispatchWithDraftClaim({
      draftId: 'draft1',
      ctx: { ...ctx, _dispatchPreClaimed: true },
      performDispatch: async () => ({ id: 'evt1' }),
      resolveSentId: (r) => r.id,
    });
    expect(result).toEqual({ id: 'evt1' });
    expect(mockClaim).not.toHaveBeenCalled();
    expect(mockSent).toHaveBeenCalledWith('draft1', 'evt1', expect.objectContaining({ _dispatchPreClaimed: true }));
  });

  it('calls claimSend and throws if not claimed', async () => {
    mockClaim.mockResolvedValue({ claimed: false });
    await expect(
      dispatchWithDraftClaim({
        draftId: 'draft2',
        ctx,
        performDispatch: async () => ({}),
        resolveSentId: () => '',
      }),
    ).rejects.toMatchObject({ statusCode: 409, errorCode: 'DRAFT_SEND_IN_FLIGHT' });
    expect(mockFail).not.toHaveBeenCalled();
  });

  it('calls markSendFailed and rethrows when performDispatch fails', async () => {
    mockClaim.mockResolvedValue({ claimed: true });
    mockFail.mockResolvedValue(undefined);
    const boom = new Error('network error');
    await expect(
      dispatchWithDraftClaim({
        draftId: 'draft3',
        ctx,
        performDispatch: async () => { throw boom; },
        resolveSentId: () => '',
      }),
    ).rejects.toBe(boom);
    expect(mockFail).toHaveBeenCalledWith('draft3', ctx);
  });

  it('calls markSent with resolveSentId result on success', async () => {
    mockClaim.mockResolvedValue({ claimed: true });
    mockSent.mockResolvedValue(undefined);
    await dispatchWithDraftClaim({
      draftId: 'draft4',
      ctx,
      performDispatch: async () => ({ ts: 'slack123' }),
      resolveSentId: (r) => r.ts,
    });
    expect(mockSent).toHaveBeenCalledWith('draft4', 'slack123', ctx);
  });
});
