#!/usr/bin/env bash
set -euo pipefail

# Gate: The integrationConnections schema must contain the P3A columns:
#   ownershipScope, classification, visibilityScope
#
# These columns are required for principal-based connection scoping.
#
# Exit 2 (warning) rather than 1 (blocking) so pre-migration schemas are
# surfaced without blocking the pipeline.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

SCHEMA_FILE="server/db/schema/integrationConnections.ts"

if [ ! -f "$SCHEMA_FILE" ]; then
  echo "FAIL: $SCHEMA_FILE does not exist"
  exit 1
fi

REQUIRED_COLUMNS=("ownership_scope" "classification" "visibility_scope")
MISSING=()

for col in "${REQUIRED_COLUMNS[@]}"; do
  if ! grep -q "$col" "$SCHEMA_FILE"; then
    MISSING+=("$col")
  fi
done

if [ ${#MISSING[@]} -gt 0 ]; then
  echo "WARNING: integrationConnections schema missing required P3A columns:"
  for m in "${MISSING[@]}"; do
    echo "  - $m"
  done
  echo ""
  echo "Add these columns via migration before P3B connection scoping."
  exit 2
fi

echo "PASS: verify-connection-shape"
