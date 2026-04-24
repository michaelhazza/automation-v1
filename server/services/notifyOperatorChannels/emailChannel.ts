import { emailService } from '../emailService.js';
import type { FanoutChannelResult } from '../notifyOperatorFanoutService.js';

// ---------------------------------------------------------------------------
// Email channel — spec §7.4 row 2. Thin wrapper over the existing
// emailService.sendGenericEmail. One call per recipient; aggregated into a
// single FanoutChannelResult.
// ---------------------------------------------------------------------------

export async function deliverEmail(params: {
  organisationId: string;
  actionId: string;
  recipientEmails: string[];
  title: string;
  message: string;
  reviewQueueLink?: string;
}): Promise<FanoutChannelResult> {
  if (params.recipientEmails.length === 0) {
    return { channel: 'email', status: 'skipped_not_configured', recipientCount: 0, errorMessage: 'No recipient emails resolved' };
  }

  const body = params.reviewQueueLink
    ? `${params.message}\n\nOpen in review queue: ${params.reviewQueueLink}`
    : params.message;

  let delivered = 0;
  let firstError: string | null = null;
  for (const email of params.recipientEmails) {
    try {
      await emailService.sendGenericEmail(email, params.title, body);
      delivered += 1;
    } catch (err) {
      if (!firstError) firstError = err instanceof Error ? err.message : String(err);
    }
  }

  if (delivered === 0) {
    return {
      channel: 'email',
      status: 'failed',
      recipientCount: params.recipientEmails.length,
      errorMessage: firstError ?? 'All email deliveries failed',
    };
  }

  return {
    channel: 'email',
    status: 'delivered',
    recipientCount: delivered,
    errorMessage: firstError ?? undefined,
  };
}
