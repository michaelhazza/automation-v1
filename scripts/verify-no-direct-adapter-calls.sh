#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# verify-no-direct-adapter-calls.sh
#
# Enforces spec §9.4 — the LLM observability & ledger generalisation spec.
#
# Production code outside `server/services/llmRouter.ts` and
# `server/services/providers/*.ts` MUST NOT import or call any LLM provider
# adapter directly. Direct adapter calls bypass the `llm_requests` ledger,
# which means zero cost attribution, zero billing, zero debugging signal.
#
# The assertCalledFromRouter() runtime check (§8.5) closes the loop at
# runtime; this static gate closes it at build time. Together they make
# the "no dark LLM calls" claim (A1) a hard guarantee.
#
# Scope: every adapter registered in server/services/providers/registry.ts.
# If a new provider is added, extend the PROVIDER_NAMES array.
#
# Exempt callers:
#   - server/services/llmRouter.ts         (the router itself)
#   - server/services/providers/*.ts       (intra-provider fallback)
#   - *.test.ts / *.test.tsx               (unit test stubbing)
#   - temporary per-file whitelist below   (P2 bootstrap only; P3 removes)
#
# Exit codes:
#   0 — no violations
#   1 — one or more violations (blocking)
# ---------------------------------------------------------------------------

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

# Provider names mirror the keys registered in
# server/services/providers/registry.ts. Keep in sync when adding a new provider.
PROVIDER_NAMES=(anthropic openai gemini openrouter)

# Temporary whitelist for P2 bootstrap. P3 removes every entry here as the
# analyzer migration lands. An empty array at that point means the gate is
# fully enforcing.
WHITELIST_FILES=(
  "server/jobs/skillAnalyzerJob.ts"
  "server/services/skillAnalyzerService.ts"
)

# Build the regex alternation dynamically so new providers only need an
# entry in PROVIDER_NAMES.
providers_alt="$(IFS='|'; echo "${PROVIDER_NAMES[*]}")"

# ── 1. Direct adapter imports ──────────────────────────────────────────────
import_pattern="from.*providers/(${providers_alt})Adapter"

# ── 2. Explicit call sites (e.g. anthropicAdapter.call(...)) ───────────────
call_pattern="(${providers_alt})Adapter\\.call"

# Collect raw matches (file:line:content), then filter against exempt paths
# and the whitelist.
raw_matches="$(
  {
    grep -rnE "$import_pattern" server/ --include='*.ts' || true
    grep -rnE "$call_pattern" server/ --include='*.ts' || true
  } | \
    grep -v 'server/services/llmRouter.ts:' | \
    grep -v 'server/services/providers/' | \
    grep -v '\.test\.ts:' | \
    grep -v '\.test\.tsx:' || true
)"

# Remove whitelisted files line-by-line so the rest of the gate still runs.
filtered_matches="$raw_matches"
for wf in "${WHITELIST_FILES[@]}"; do
  filtered_matches="$(echo "$filtered_matches" | grep -v "^${wf}:" || true)"
done

# If whitelist is non-empty, emit an advisory note so the tail of the gate
# output makes clear that enforcement is not yet fully closed.
if [ ${#WHITELIST_FILES[@]} -gt 0 ]; then
  echo "verify-no-direct-adapter-calls: whitelist contains ${#WHITELIST_FILES[@]} file(s):"
  for wf in "${WHITELIST_FILES[@]}"; do
    echo "  - $wf  (P2 bootstrap; P3 removes)"
  done
  echo ""
fi

if [ -z "$filtered_matches" ] || [ "$filtered_matches" = "" ]; then
  echo "verify-no-direct-adapter-calls: PASS — no direct adapter calls outside the router + whitelist."
  exit 0
fi

echo "verify-no-direct-adapter-calls: BLOCKING FAIL"
echo ""
echo "Production code must route every LLM call through llmRouter.routeCall()"
echo "so the call lands in llm_requests. See docs spec §9.4 and §8.5."
echo ""
echo "Offending matches:"
echo "$filtered_matches"
echo ""
echo "Remediation: replace adapter.call({...}) with llmRouter.routeCall({"
echo "  messages, system, maxTokens, temperature,"
echo "  context: { organisationId, sourceType, sourceId, featureTag, ... },"
echo "  postProcess?: ..., abortSignal?: ...,"
echo "}). See server/jobs/skillAnalyzerJob.ts for the analyzer migration"
echo "pattern after it lands in P3."
exit 1
