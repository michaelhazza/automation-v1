import { eaDraftService } from '../eaDrafts/eaDraftService.js';

interface DispatchCtx {
  organisationId: string;
  subaccountId: string;
  ownerUserId: string;
  _dispatchPreClaimed?: boolean;
}

export async function dispatchWithDraftClaim<T>(args: {
  draftId: string;
  ctx: DispatchCtx;
  performDispatch: () => Promise<T>;
  resolveSentId: (result: T) => string;
}): Promise<T> {
  if (!args.ctx._dispatchPreClaimed) {
    const claimed = await eaDraftService.claimSend(args.draftId, args.ctx);
    if (!claimed.claimed) {
      throw Object.assign(
        new Error(`Draft ${args.draftId} send already in flight`),
        { statusCode: 409, errorCode: 'DRAFT_SEND_IN_FLIGHT' },
      );
    }
  }

  let result: T;
  try {
    result = await args.performDispatch();
  } catch (err) {
    await eaDraftService.markSendFailed(args.draftId, args.ctx);
    throw err;
  }

  await eaDraftService.markSent(args.draftId, args.resolveSentId(result), args.ctx);
  return result;
}
