// ---------------------------------------------------------------------------
// Pure cutoff math for `maintenance:llm-inflight-history-cleanup`.
//
// Deferred-items brief §6. Short retention — 7 days by default — because
// the archive is for recent-incident forensics, not long-term financial
// records (the ledger is the durable record for those).
// ---------------------------------------------------------------------------

export function computeInflightHistoryCutoff(params: {
  nowMs:         number;
  retentionDays: number;
}): Date {
  const ttlMs = params.retentionDays * 24 * 60 * 60 * 1000;
  return new Date(params.nowMs - ttlMs);
}
