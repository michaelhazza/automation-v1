import type { FanoutChannelResult } from '../notifyOperatorFanoutService.js';

// ---------------------------------------------------------------------------
// In-app channel — spec §7.4 row 1. notify_operator already wrote the
// review-queue row upstream in the propose → approve → execute chain, which
// is the actual in-app surface operators check. A dedicated per-user
// notification record / WebSocket push is deferred to a follow-up session.
// Until then, report `skipped_not_configured` so the audit trail honestly
// reflects that this channel performs no additional delivery beyond the
// already-existing review-queue row.
// ---------------------------------------------------------------------------

export async function deliverInApp(params: {
  organisationId: string;
  subaccountId: string | null;
  actionId: string;
  recipientUserIds: string[];
  title: string;
  message: string;
}): Promise<FanoutChannelResult> {
  return {
    channel: 'in_app',
    status: 'skipped_not_configured',
    recipientCount: 0,
    errorMessage: 'in-app delivery currently maps to the review-queue row written upstream; no per-user notification record or push is emitted yet',
  };
}
