/**
 * retentionSuccessService — System Agents v7.1 stub handlers for retention/success skills.
 *
 * Handlers: score_nps_csat, prepare_renewal_brief
 *
 * Both are sideEffectClass: 'none' workers — simple stubs returning structured data.
 */

// ---------------------------------------------------------------------------
// score_nps_csat — worker stub: computes NPS/CSAT score from raw responses
// ---------------------------------------------------------------------------

export async function executeScoreNpsCsat(
  input: Record<string, unknown>,
  _context: unknown,
): Promise<unknown> {
  const responses = Array.isArray(input['responses']) ? input['responses'] : [];
  return {
    success: true,
    respondent_count: responses.length,
    nps_score: null,
    csat_score: null,
    message: 'NPS/CSAT scoring (stub — full scoring model deferred)',
  };
}

// ---------------------------------------------------------------------------
// prepare_renewal_brief — worker stub: assembles renewal brief data
// ---------------------------------------------------------------------------

export async function executePrepareRenewalBrief(
  input: Record<string, unknown>,
  _context: unknown,
): Promise<unknown> {
  return {
    success: true,
    account_id: String(input['account_id'] ?? ''),
    renewal_date: input['renewal_date'] ?? null,
    brief: 'Renewal brief (stub — full data assembly deferred)',
  };
}
