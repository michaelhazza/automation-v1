// ---------------------------------------------------------------------------
// Channel availability pure helpers (spec §7.4). No I/O — consumes a snapshot
// of org configuration and secrets and returns availability flags.
// ---------------------------------------------------------------------------

export type ChannelAvailability = {
  inApp: true;
  email: boolean;
  slack: boolean;
};

export type ChannelKey = 'in_app' | 'email' | 'slack';

export function deriveChannelAvailability(inputs: {
  /** Email configured when the org has a registered from-address in its secrets or config. */
  emailFromAddress: string | null;
  /** Slack configured when the org has stored a webhook URL in organisationSecrets. */
  slackWebhookUrl: string | null;
}): ChannelAvailability {
  return {
    inApp: true,
    email: typeof inputs.emailFromAddress === 'string' && inputs.emailFromAddress.length > 0,
    slack: typeof inputs.slackWebhookUrl === 'string' && inputs.slackWebhookUrl.length > 0,
  };
}

/**
 * Given the operator's requested channels + availability, return the action plan:
 * - `dispatch` channels actually attempt delivery
 * - `skipped` channels record skipped_not_configured without attempting
 */
export function planFanout(inputs: {
  requested: readonly ChannelKey[];
  availability: ChannelAvailability;
}): { dispatch: ChannelKey[]; skipped: ChannelKey[] } {
  const dispatch: ChannelKey[] = [];
  const skipped: ChannelKey[] = [];
  for (const channel of inputs.requested) {
    if (channel === 'in_app' && inputs.availability.inApp) dispatch.push(channel);
    else if (channel === 'email' && inputs.availability.email) dispatch.push(channel);
    else if (channel === 'slack' && inputs.availability.slack) dispatch.push(channel);
    else skipped.push(channel);
  }
  return { dispatch, skipped };
}
