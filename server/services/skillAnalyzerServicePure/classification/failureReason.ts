/** Derive a human-readable reason for a classification API failure.
 *  Pass the caught error, or null if the parse step returned null
 *  (meaning the API call succeeded but the response was unparseable). */
export function deriveClassificationFailureReason(
  err: unknown,
): 'rate_limit' | 'parse_error' | 'timed_out' | 'unknown' {
  if (err === null || err === undefined) return 'parse_error';
  const e = err as { statusCode?: number; code?: string };
  if (e.code === 'CLASSIFY_TIMEOUT') return 'timed_out';
  if (e?.statusCode === 429) return 'rate_limit';
  return 'unknown';
}
