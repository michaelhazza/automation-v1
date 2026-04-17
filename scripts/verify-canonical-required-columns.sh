#!/usr/bin/env bash
set -euo pipefail

# Gate: Every canonical_* schema file must contain the P3A visibility columns:
#   owner_user_id, visibility_scope, shared_team_ids, source_connection_id
#
# These columns are required for the principal-based visibility predicate.
#
# Tables that MUST have them (error if missing):
#   canonical_accounts, canonical_contacts, canonical_opportunities, canonical_conversations
#
# Other canonical tables get a warning (exit 2), not a hard fail.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
GUARD_ID="canonical-required-columns"
GUARD_NAME="Canonical Required Columns (P3A)"

source "$SCRIPT_DIR/lib/guard-utils.sh"

VIOLATIONS=0
FILES_SCANNED=0

emit_header "$GUARD_NAME"

REQUIRED_COLUMNS=("owner_user_id" "visibility_scope" "shared_team_ids" "source_connection_id")
SCHEMA_DIR="$ROOT_DIR/server/db/schema"

# Tables that MUST have the columns (hard fail if missing)
REQUIRED_TABLES=(
  "canonicalAccounts"
  "canonicalEntities"  # contains canonical_contacts, canonical_opportunities, canonical_conversations
)

is_required_table() {
  local basename="$1"
  for t in "${REQUIRED_TABLES[@]}"; do
    if [[ "$basename" == "${t}.ts" ]]; then
      return 0
    fi
  done
  return 1
}

for schema_file in "$SCHEMA_DIR"/canonical*.ts; do
  [ -f "$schema_file" ] || continue
  basename="$(basename "$schema_file")"
  FILES_SCANNED=$((FILES_SCANNED + 1))

  for col in "${REQUIRED_COLUMNS[@]}"; do
    if ! grep -q "$col" "$schema_file"; then
      lineno=1
      severity="warning"
      if is_required_table "$basename"; then
        severity="error"
      fi

      emit_violation "$GUARD_ID" "$severity" "$schema_file" "$lineno" \
        "$basename is missing column '$col'" \
        "Add '$col' column via migration for P3A visibility predicate"
      VIOLATIONS=$((VIOLATIONS + 1))
    fi
  done
done

emit_summary "$FILES_SCANNED" "$VIOLATIONS"

# Use exit code 2 (warning) since some tables may not be migrated yet
exit_code=$(check_baseline "$GUARD_ID" "$VIOLATIONS" 2)
exit "$exit_code"
