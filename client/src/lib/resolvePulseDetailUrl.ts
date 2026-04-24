/**
 * resolvePulseDetailUrl.ts
 *
 * Fallback resolver for legacy opaque `detailUrl` tokens.
 * Used ONLY when `item.resolvedUrl` is null.
 *
 * Resolution rules mirror the backend's `_resolveUrlForItem` helper (Task 1.2).
 * Every call logs a WARN so callers can detect reliance on the fallback path.
 */

export function resolvePulseDetailUrl(
  detailUrl: string,
  subaccountId?: string | null,
): string | null {
  try {
    console.warn('[resolvePulseDetailUrl] fallback_resolver_used', { detailUrl });

    const [prefix, id] = detailUrl.split(':', 2);

    switch (prefix) {
      case 'review':
        return subaccountId ? `/clientpulse/clients/${subaccountId}` : null;

      case 'task':
        return subaccountId ? `/admin/subaccounts/${subaccountId}/workspace` : null;

      case 'run':
        return `/runs/${id}/live`;

      case 'health':
        return '/admin/health';

      default:
        return null;
    }
  } catch {
    // Malformed token — do not propagate to caller
    return null;
  }
}
