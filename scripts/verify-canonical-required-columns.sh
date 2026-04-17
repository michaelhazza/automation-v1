#!/usr/bin/env bash
set -euo pipefail

# Gate: Every canonical_* schema file must contain the P3A visibility columns:
#   ownerUserId, visibilityScope, sharedTeamIds, sourceConnectionId
#
# These columns are required for the principal-based visibility predicate.
# Schema files that predate P3A will fail this gate until migrated.
#
# Exit 2 (warning) rather than 1 (blocking) so pre-migration schemas are
# surfaced without blocking the pipeline.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

REQUIRED_COLUMNS=("owner_user_id" "visibility_scope" "shared_team_ids" "source_connection_id")
SCHEMA_DIR="server/db/schema"
MISSING=()

for schema_file in "$SCHEMA_DIR"/canonical*.ts; do
  [ -f "$schema_file" ] || continue
  basename="$(basename "$schema_file")"

  # Skip canonicalMetrics — it has its own column shape
  # (metrics are computed aggregates, not source-of-record entities)
  if [[ "$basename" == "canonicalMetrics.ts" ]]; then
    continue
  fi

  for col in "${REQUIRED_COLUMNS[@]}"; do
    if ! grep -q "$col" "$schema_file"; then
      MISSING+=("$basename is missing column '$col'")
    fi
  done
done

if [ ${#MISSING[@]} -gt 0 ]; then
  echo "WARNING: Canonical schema files missing required P3A columns:"
  for m in "${MISSING[@]}"; do
    echo "  - $m"
  done
  echo ""
  echo "Add these columns via migration before P3B RLS policies can be applied."
  exit 2
fi

echo "PASS: verify-canonical-required-columns"
