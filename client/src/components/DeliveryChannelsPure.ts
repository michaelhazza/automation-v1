/**
 * DeliveryChannelsPure — pure channel-state computation helpers
 *
 * Extracted from DeliveryChannels.tsx so the rendering logic can be
 * tested without a React/jsdom environment.
 *
 * Spec: docs/memory-and-briefings-spec.md §10.4 (S22)
 */

export interface DeliveryChannelConfig {
  email: boolean;
  portal: boolean;
  slack: boolean;
}

export interface AvailableChannels {
  email: boolean;
  portal: boolean;
  slack: boolean;
}

export interface ChannelMeta {
  key: keyof AvailableChannels;
  label: string;
  description: string;
  alwaysOn: boolean;
}

export const CHANNEL_META: ChannelMeta[] = [
  {
    key: 'email',
    label: 'Email / Inbox',
    description: 'Always delivered to the workspace inbox.',
    alwaysOn: true,
  },
  {
    key: 'portal',
    label: 'Client Portal',
    description: 'Visible to client contacts in the portal.',
    alwaysOn: false,
  },
  {
    key: 'slack',
    label: 'Slack',
    description: 'Delivered to the connected Slack workspace.',
    alwaysOn: false,
  },
];

export interface ChannelState {
  isChecked: boolean;
  isDisabled: boolean;
  isAvailable: boolean;
}

/**
 * Compute the rendered state for a single delivery channel row.
 *
 * Always-on invariant: email is always checked and always disabled
 * (rendered as a read-only badge — cannot be unchecked).
 */
export function computeChannelState(
  key: keyof AvailableChannels,
  value: DeliveryChannelConfig,
  available: AvailableChannels,
  disabled: boolean,
  alwaysOn: boolean,
): ChannelState {
  const isAvailable = available[key];
  const isChecked = key === 'email' ? true : value[key] && isAvailable;
  const isDisabled = disabled || alwaysOn || !isAvailable;
  return { isChecked: Boolean(isChecked), isDisabled, isAvailable };
}

/**
 * Compute channel states for all channels at once.
 */
export function computeAllChannelStates(
  value: DeliveryChannelConfig,
  available: AvailableChannels,
  disabled: boolean,
): Record<keyof AvailableChannels, ChannelState> {
  const result = {} as Record<keyof AvailableChannels, ChannelState>;
  for (const meta of CHANNEL_META) {
    result[meta.key] = computeChannelState(
      meta.key,
      value,
      available,
      disabled,
      meta.alwaysOn,
    );
  }
  return result;
}
