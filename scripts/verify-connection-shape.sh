#!/usr/bin/env bash
set -euo pipefail

# Gate: The integration_connections Drizzle schema has the P3A columns:
#   ownership_scope, classification, visibility_scope
#
# These columns are required for principal-based connection scoping.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
GUARD_ID="connection-shape"
GUARD_NAME="Connection Shape (P3A)"

source "$SCRIPT_DIR/lib/guard-utils.sh"

VIOLATIONS=0
FILES_SCANNED=0

emit_header "$GUARD_NAME"

SCHEMA_FILE="$ROOT_DIR/server/db/schema/integrationConnections.ts"

if [ ! -f "$SCHEMA_FILE" ]; then
  emit_violation "$GUARD_ID" "error" "$SCHEMA_FILE" "0" \
    "integrationConnections.ts does not exist" \
    "Create the schema file with P3A connection columns"
  emit_summary "0" "1"
  exit 1
fi

FILES_SCANNED=1
REQUIRED_COLUMNS=("ownership_scope" "classification" "visibility_scope")

for col in "${REQUIRED_COLUMNS[@]}"; do
  if ! grep -q "$col" "$SCHEMA_FILE"; then
    emit_violation "$GUARD_ID" "error" "$SCHEMA_FILE" "1" \
      "Missing required column '$col'" \
      "Add '$col' column via migration for P3A connection scoping"
    VIOLATIONS=$((VIOLATIONS + 1))
  fi
done

emit_summary "$FILES_SCANNED" "$VIOLATIONS"

exit_code=$(check_baseline "$GUARD_ID" "$VIOLATIONS" 2)
exit "$exit_code"
