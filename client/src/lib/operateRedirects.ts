// client/src/lib/operateRedirects.ts
//
// Deterministic URL builder for the four operate-stream redirects (C8).
//
// Locked redirect grammar:
//   /admin/runs/:runId?<query>
//     → /run-trace/:runId?<query>
//   /admin/subaccounts/:subaccountId/runs/:runId?<query>
//     → /run-trace/:runId?subaccountId=:subaccountId&<query>
//   /admin/agent-inbox?<query>
//     → /inbox?<query>
//   /subaccounts/:subaccountId/agent-inbox?<query>
//     → /inbox?subaccountId=:subaccountId&<query>
//
// Deterministic query-param ordering (LOCKED):
//   When promoting a path param to a query param (:subaccountId rows), emit
//   the promoted param FIRST, then inbound keys in their original insertion
//   order. Use URLSearchParams, set('subaccountId', ...) first (overwrites any
//   inbound key), then append remaining inbound keys that are NOT subaccountId.
//   Do NOT sort, dedupe non-conflicting keys, or reorder.
//
// Hash fragments are passed through unchanged.

/**
 * Build the redirect target URL.
 *
 * @param targetBase  - the new canonical path, e.g. "/run-trace/:runId-value"
 * @param inboundSearch - the raw search string from the old URL (e.g. "?step=3")
 * @param promotedParam - if set, emits this key=value FIRST in the output QS,
 *                        then appends remaining inbound params (skipping that key)
 * @param hash - raw hash string from the old URL (e.g. "#section")
 */
export function buildOperateRedirectUrl(
  targetBase: string,
  inboundSearch: string,
  promotedParam?: { key: string; value: string },
  hash?: string,
): string {
  if (!promotedParam) {
    // Simple passthrough — no promotion needed
    const qs = inboundSearch && inboundSearch !== '?' ? inboundSearch : '';
    const fragment = hash && hash !== '#' ? hash : '';
    return `${targetBase}${qs}${fragment}`;
  }

  // Build output QS: promoted param first, then inbound (skip promoted key)
  const out = new URLSearchParams();
  out.set(promotedParam.key, promotedParam.value);

  const inbound = new URLSearchParams(inboundSearch);
  for (const [k, v] of inbound.entries()) {
    if (k !== promotedParam.key) {
      out.append(k, v);
    }
  }

  const qs = out.toString() ? `?${out.toString()}` : '';
  const fragment = hash && hash !== '#' ? hash : '';
  return `${targetBase}${qs}${fragment}`;
}
