/**
 * connectionTokenServicePure
 *
 * Pure helper functions for connectionTokenService. No I/O.
 * Extracted per the pure/impure split enforced by verify-pure-helper-convention.sh.
 */

// Default refresh buffer: refresh tokens 5 minutes before they expire.
const DEFAULT_REFRESH_BUFFER_MS = 5 * 60 * 1000;

// Stripe SPT (Stripe-issued sub-merchant tokens) have a shorter effective
// lifetime than typical OAuth tokens; a 10-minute pre-roll ensures the
// token is still valid when the IEE worker receives and uses it, accounting
// for queue latency and round-trip time.
const STRIPE_AGENT_REFRESH_BUFFER_MS = 10 * 60 * 1000;

/**
 * Returns the refresh buffer in milliseconds for the given provider.
 * The buffer is the lead time before token expiry at which a proactive
 * refresh is triggered. Larger buffer = earlier refresh = less risk of
 * a stale token reaching the call site.
 *
 * Per-provider overrides allow each integration to tune for its own
 * token lifecycle. All unrecognised providers default to 5 minutes.
 */
export function getRefreshBufferMs(providerType: string): number {
  switch (providerType) {
    case 'stripe_agent':
      return STRIPE_AGENT_REFRESH_BUFFER_MS;
    default:
      return DEFAULT_REFRESH_BUFFER_MS;
  }
}
