import type { FanoutChannelResult } from '../notifyOperatorFanoutService.js';

// ---------------------------------------------------------------------------
// In-app channel — spec §7.4 row 1. Session 1 ships notify_operator as an
// action row in the review queue, which IS the in-app notification surface.
// This channel is therefore a trivial "delivered" receipt — the action-row
// insert already happened upstream in the propose → approve → execute chain.
// A follow-up session may split out a dedicated notifications table; until
// then the review queue is the surface operators actually check.
// ---------------------------------------------------------------------------

export async function deliverInApp(params: {
  organisationId: string;
  subaccountId: string | null;
  actionId: string;
  recipientUserIds: string[];
  title: string;
  message: string;
}): Promise<FanoutChannelResult> {
  // The action row is already the in-app surface. Record delivery for audit.
  return {
    channel: 'in_app',
    status: 'delivered',
    recipientCount: params.recipientUserIds.length,
  };
}
