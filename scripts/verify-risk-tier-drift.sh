#!/usr/bin/env bash
# verify-risk-tier-drift.sh
#
# Detects riskTier drift between ACTION_REGISTRY and the canonical CSV assignments
# at tasks/builds/synthetos-foundation-refactor/risk-tier-assignments.csv.
#
# Slugs in the registry but absent from the CSV are reported as INFO and do not
# block (the CSV may pre-date newer methodology/support entries).
# Slugs in the CSV but absent from the registry, or mismatched riskTiers, are
# BLOCKING (exit 1).
#
# Requires: npm run build:server (loads from dist/).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"
npx tsx "$SCRIPT_DIR/audit-action-registry-risk-tiers.ts"
