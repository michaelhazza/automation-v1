/**
 * DeliveryChannels — delivery channel selector component
 *
 * Renders a list of available delivery channels for a subaccount's playbook
 * or scheduled task. Queries the available-channels endpoint to determine
 * which channels are connected, then renders checkboxes for each.
 *
 * Always-on invariant: the Email / Inbox channel is always pre-ticked and
 * rendered as a read-only badge — it cannot be unchecked.
 *
 * Spec: docs/memory-and-briefings-spec.md §10.4 (S22)
 */

import { useState, useEffect } from 'react';
import api from '../lib/api';
import {
  type DeliveryChannelConfig,
  type AvailableChannels,
  CHANNEL_META,
  computeChannelState,
} from './DeliveryChannelsPure';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type { DeliveryChannelConfig };

interface DeliveryChannelsProps {
  /** Subaccount ID to load available channels for */
  subaccountId: string;
  /** Current channel selections (controlled component) */
  value: DeliveryChannelConfig;
  /** Called when the user changes a channel selection */
  onChange: (next: DeliveryChannelConfig) => void;
  /** Disable all inputs (e.g. when the form is submitting) */
  disabled?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function DeliveryChannels({
  subaccountId,
  value,
  onChange,
  disabled = false,
}: DeliveryChannelsProps) {
  const [available, setAvailable] = useState<AvailableChannels | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    api
      .get<AvailableChannels>(
        `/api/subaccounts/${subaccountId}/integrations/available-channels`,
      )
      .then((res) => {
        if (!cancelled) setAvailable(res.data);
      })
      .catch(() => {
        if (!cancelled) setError('Could not load available channels.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [subaccountId]);

  if (loading) {
    return (
      <div className="text-sm text-slate-400 py-2">Loading channels…</div>
    );
  }

  if (error || !available) {
    return (
      <div className="text-sm text-red-500 py-2">
        {error ?? 'Failed to load channels.'}
      </div>
    );
  }

  function handleToggle(key: keyof DeliveryChannelConfig) {
    if (key === 'email') return; // always-on — cannot toggle
    onChange({ ...value, [key]: !value[key] });
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
        Delivery Channels
      </p>

      {CHANNEL_META.map(({ key, label, description, alwaysOn }) => {
        const { isChecked, isDisabled, isAvailable } = computeChannelState(
          key,
          value,
          available,
          disabled,
          alwaysOn,
        );

        return (
          <label
            key={key}
            className={[
              'flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors',
              isDisabled
                ? 'opacity-60 cursor-not-allowed'
                : 'hover:bg-slate-50',
              isChecked
                ? 'border-indigo-200 bg-indigo-50/40'
                : 'border-slate-200 bg-white',
            ].join(' ')}
          >
            {alwaysOn ? (
              // Always-on inbox: read-only badge instead of checkbox
              <span
                className="mt-0.5 flex-shrink-0 w-4 h-4 rounded border-2 border-indigo-500 bg-indigo-500 flex items-center justify-center"
                aria-label={`${label} always enabled`}
              >
                <svg
                  className="w-2.5 h-2.5 text-white"
                  viewBox="0 0 10 8"
                  fill="none"
                >
                  <path
                    d="M1 4l3 3 5-6"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
            ) : (
              <input
                type="checkbox"
                checked={!!isChecked}
                disabled={isDisabled}
                onChange={() => handleToggle(key)}
                className="mt-0.5 flex-shrink-0 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer disabled:cursor-not-allowed"
              />
            )}

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-slate-800">
                  {label}
                </span>
                {alwaysOn && (
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 uppercase tracking-wide">
                    Always on
                  </span>
                )}
                {!isAvailable && !alwaysOn && (
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 uppercase tracking-wide">
                    Not connected
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-0.5">{description}</p>
            </div>
          </label>
        );
      })}
    </div>
  );
}
