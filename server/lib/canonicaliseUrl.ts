/**
 * Canonical URL helper for content fingerprinting / dedup.
 *
 * Spec v3.4 §6.7.2 / T17. Used by the Reporting Agent fingerprint logic so
 * "the same item under a different URL variant" deduplicates correctly.
 *
 * Single source of truth — same helper called on write (when persisting a
 * fingerprint) and on compare (when checking the prior fingerprint).
 *
 * Rules applied:
 *  - Lowercase host
 *  - Strip default ports (`:80` for http, `:443` for https)
 *  - Strip URL fragment
 *  - Strip well-known tracking query params (utm_*, gclid, fbclid, ref,
 *    source, mc_cid, mc_eid)
 *  - Sort remaining query params alphabetically for stability
 *  - Normalise trailing slash on the path (preserve root `/`, strip elsewhere)
 */

const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_id',
  'gclid',
  'fbclid',
  'mc_cid',
  'mc_eid',
  'ref',
  'source',
  'igshid',
  'yclid',
  '_ga',
]);

export function canonicaliseUrl(input: string): string {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    // Invalid URL — return as-is, lowercase. This shouldn't happen in
    // practice because the worker resolves the URL via Playwright, but the
    // helper must not throw.
    return input.toLowerCase();
  }

  // Lowercase host
  parsed.hostname = parsed.hostname.toLowerCase();

  // Strip default ports
  if (
    (parsed.protocol === 'http:' && parsed.port === '80') ||
    (parsed.protocol === 'https:' && parsed.port === '443')
  ) {
    parsed.port = '';
  }

  // Strip fragment
  parsed.hash = '';

  // Strip tracking query params, sort the rest for stability
  const filtered = Array.from(parsed.searchParams.entries())
    .filter(([key]) => !TRACKING_PARAMS.has(key.toLowerCase()))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  parsed.search = '';
  for (const [k, v] of filtered) {
    parsed.searchParams.append(k, v);
  }

  // Normalise trailing slash: keep root '/' but strip a trailing slash on
  // any non-root path so '/foo/' === '/foo'.
  if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
    parsed.pathname = parsed.pathname.slice(0, -1);
  }

  return parsed.toString();
}
