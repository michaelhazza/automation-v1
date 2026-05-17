#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# verify-llm-call-site-routes-through-router.sh  (MC4)
#
# Enforces spec §11.5 — every LLM provider call in server/ must route
# through server/services/llmRouter/ or server/services/providers/.
#
# Detection patterns:
#   1. Direct HTTP to provider chat/completion endpoints (fetch-based pattern).
#   2. Direct imports of the openai or @anthropic-ai/sdk packages.
#      (Not currently used in this codebase, but guard against future additions.)
#
# Exempt paths (never checked):
#   - server/services/providers/          (the adapter layer — legitimate callers)
#   - server/services/llmRouter/          (the router itself)
#   - *.test.ts / *.test.tsx              (unit test fixtures)
#
# Baseline-allowlisted call sites (reviewed and accepted):
#   - server/lib/embeddings.ts            (embedding API — not a chat/completion path)
#   - server/services/documentEmbeddingService.ts  (embedding service — not chat)
#   - server/services/transcribeAudioService.ts    (Whisper audio — not chat)
#
# Exit codes:
#   0 — no violations
#   1 — one or more violations (blocking)
# ---------------------------------------------------------------------------

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

# ── Pattern 1: direct HTTP calls to LLM provider endpoints ─────────────────
# Catches: fetch('https://api.openai.com/...'), fetch('https://api.anthropic.com/...'),
#          and equivalent for Gemini and OpenRouter.
endpoint_pattern="(api\.openai\.com|api\.anthropic\.com|generativelanguage\.googleapis\.com|openrouter\.ai/api)"

# ── Pattern 2: direct SDK package imports ───────────────────────────────────
# Catches: import OpenAI from 'openai', import { Anthropic } from '@anthropic-ai/sdk',
#          require('openai'), require('@anthropic-ai/sdk'),
#          dynamic import('openai'), import('@anthropic-ai/sdk')
sdk_pattern="(from\s+['\"]openai['\"]|from\s+['\"]@anthropic-ai|require\s*\(\s*['\"]openai['\"]|require\s*\(\s*['\"]@anthropic-ai|import\s*\(\s*['\"]openai['\"]|import\s*\(\s*['\"]@anthropic-ai)"

# ── Allowlist: baseline-accepted call sites outside the provider layer ──────
# Each entry is a path prefix or exact relative path from ROOT_DIR.
# A new addition requires a spec amendment and reviewer sign-off.
ALLOWLIST_PATHS=(
  "server/lib/embeddings.ts"                     # baseline-allow: embedding API (non-chat)
  "server/services/documentEmbeddingService.ts"  # baseline-allow: embedding service (non-chat)
  "server/services/transcribeAudioService.ts"    # baseline-allow: Whisper audio transcription (non-chat)
)

# ── Collect matches, filter exempt directories and test files ───────────────
raw_matches="$(
  {
    grep -rnE "$endpoint_pattern" server/ --include='*.ts' --include='*.tsx' || true
    grep -rnE "$sdk_pattern"     server/ --include='*.ts' --include='*.tsx' || true
  } | \
    grep -v '^server/services/providers/' | \
    grep -v '^server/services/llmRouter/' | \
    grep -v '\.test\.ts:'  | \
    grep -v '\.test\.tsx:' || true
)"

# ── Remove allowlisted paths line-by-line ──────────────────────────────────
filtered_matches="$raw_matches"
for allowed in "${ALLOWLIST_PATHS[@]}"; do
  # Strip trailing comment before comparing
  path="${allowed%%#*}"
  path="${path%% }"
  filtered_matches="$(echo "$filtered_matches" | grep -v "^${path}:" || true)"
done

if [ -z "$filtered_matches" ] || [ "$filtered_matches" = "" ]; then
  echo "verify-llm-call-site-routes-through-router: PASS — all LLM call sites route through the provider layer."
  echo "[GATE] llm-call-site-routes-through-router: violations=0"
  exit 0
fi

echo "verify-llm-call-site-routes-through-router: BLOCKING FAIL"
echo ""
echo "Every LLM call in server/ must route through server/services/llmRouter/ so"
echo "requests land in llm_requests (cost attribution, billing, observability)."
echo "Direct provider endpoint calls outside the adapter layer bypass the ledger."
echo ""
echo "Offending matches:"
echo "$filtered_matches"
echo ""
echo "Remediation: route the call through llmRouter.routeCall() or, for non-chat"
echo "APIs (embeddings, audio), open a spec discussion before adding a new allowlist"
echo "entry — allowlist additions require reviewer sign-off per spec §11.5."
echo "[GATE] llm-call-site-routes-through-router: violations=1"
exit 1
