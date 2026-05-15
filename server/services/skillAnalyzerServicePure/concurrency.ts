// ---------------------------------------------------------------------------
// Concurrency guard — pure, no DB/env/service imports
// ---------------------------------------------------------------------------

/** Concurrency guard used by resolveWarning. Pure so we can test it without
 *  spinning up a DB. Returns one of:
 *    - 'ok' when the client's token matches the row's canonical stamp within
 *      SKEW_MS tolerance.
 *    - 'stale' when the row's stamp has drifted outside tolerance (i.e.,
 *      another session wrote first, or the client fabricated a token).
 *    - 'missing' when neither mergeUpdatedAt nor createdAt exists — indicates
 *      a corrupt row and should 500 rather than 409. */
export type ConcurrencyCheckResult = 'ok' | 'stale' | 'missing';

export function checkConcurrencyStamp(
  rowMergeUpdatedAt: Date | string | null | undefined,
  rowCreatedAt: Date | string | null | undefined,
  clientStamp: Date | string,
  skewMs = 2_000,
): ConcurrencyCheckResult {
  const rowStampRaw = rowMergeUpdatedAt ?? rowCreatedAt;
  if (!rowStampRaw) return 'missing';
  const rowStamp = rowStampRaw instanceof Date ? rowStampRaw : new Date(rowStampRaw);
  const client = clientStamp instanceof Date ? clientStamp : new Date(clientStamp);
  if (Number.isNaN(rowStamp.getTime()) || Number.isNaN(client.getTime())) return 'stale';
  return Math.abs(rowStamp.getTime() - client.getTime()) > skewMs ? 'stale' : 'ok';
}
