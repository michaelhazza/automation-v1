import axios from 'axios';
import type { FanoutChannelResult } from '../notifyOperatorFanoutService.js';

// ---------------------------------------------------------------------------
// Slack channel — spec §7.4 row 3. POST to the org-configured Slack webhook.
// Session 2 does NOT retry Slack failures (deferred if pilot feedback requires).
// ---------------------------------------------------------------------------

export async function deliverSlack(params: {
  webhookUrl: string;
  actionId: string;
  title: string;
  message: string;
  reviewQueueLink?: string;
}): Promise<FanoutChannelResult> {
  try {
    const blocks: Array<Record<string, unknown>> = [
      { type: 'header', text: { type: 'plain_text', text: params.title.slice(0, 150) } },
      { type: 'section', text: { type: 'mrkdwn', text: params.message.slice(0, 3000) } },
    ];
    if (params.reviewQueueLink) {
      blocks.push({
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Open in Review Queue' },
            url: params.reviewQueueLink,
          },
        ],
      });
    }

    await axios.post(
      params.webhookUrl,
      { blocks, text: `${params.title} — ${params.message.slice(0, 140)}` },
      { timeout: 10_000 },
    );

    return { channel: 'slack', status: 'delivered', recipientCount: 1 };
  } catch (err) {
    return {
      channel: 'slack',
      status: 'failed',
      recipientCount: 0,
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}
