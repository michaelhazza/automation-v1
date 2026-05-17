#!/usr/bin/env bash
# P16 — verify-knip-config.sh
# Asserts knip.json exists at the repo root and that its entry list intersects
# each required dynamic-entry surface. No suppression mechanism.
#
# Required surfaces (each must appear as a glob or exact path in the entry array):
#   server/index.ts               — server entry
#   client/src/main.tsx           — client entry
#   .claude/hooks/*.js            — Claude hooks
#   server/config/*.ts            — server config registries
#   scripts/__fixtures__/*        — gate fixture files
#
# Usage: bash scripts/verify-knip-config.sh
# Exit codes: 0 = all surfaces declared, 1 = one or more surfaces missing.
# Warning-first rollout promoted to error 2026-05-15 (post-7-day soak from PR #307).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
GUARD_ID="knip-config"
KNIP_CONFIG="$ROOT_DIR/knip.json"
CHECK_HELPER="$SCRIPT_DIR/lib/check-knip-config.mjs"

source "$SCRIPT_DIR/lib/guard-utils.sh"

emit_header "$GUARD_ID"

# Assert knip.json exists
if [ ! -f "$KNIP_CONFIG" ]; then
  echo "❌ knip.json not found at repo root" >&2
  echo "[GATE] ${GUARD_ID}: violations=1"
  exit 1
fi

# Resolve paths for Node on Windows (cygpath if available)
KNIP_CONFIG_NODE="$KNIP_CONFIG"
CHECK_HELPER_NODE="$CHECK_HELPER"
if command -v cygpath >/dev/null 2>&1; then
  KNIP_CONFIG_NODE="$(cygpath -m "$KNIP_CONFIG")"
  CHECK_HELPER_NODE="$(cygpath -m "$CHECK_HELPER")"
fi

# Delegate surface intersection check to the helper module
VIOLATIONS=$(KNIP_CONFIG_FILE="$KNIP_CONFIG_NODE" node "$CHECK_HELPER_NODE")

echo ""
echo "[GATE] ${GUARD_ID}: violations=${VIOLATIONS}"

if [ "$VIOLATIONS" -gt 0 ]; then
  exit 1
fi

exit 0
