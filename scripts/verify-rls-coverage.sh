#!/usr/bin/env bash
set -euo pipefail

# verify-rls-coverage.sh
#
# Sprint 2 P1.1 Layer 1 gate. Asserts that every entry in the
# RLS_PROTECTED_TABLES manifest in server/config/rlsProtectedTables.ts has a
# matching CREATE POLICY statement in the migration it claims. Fails the
# build when a table has been added to the manifest without a matching
# policy, or when a policy file claims to protect a table that is not
# registered in the manifest.
#
# This is the "canary" that prevents Layer 1 coverage from silently
# regressing: new tenant-owned tables land on the manifest + a migration
# in the same commit, or this gate blocks the PR.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
GUARD_ID="rls-coverage"
GUARD_NAME="RLS Coverage"

source "$SCRIPT_DIR/lib/guard-utils.sh"

MANIFEST="$ROOT_DIR/server/config/rlsProtectedTables.ts"
MIGRATIONS_DIR="$ROOT_DIR/migrations"

emit_header "$GUARD_NAME"

if [ ! -f "$MANIFEST" ]; then
  echo "❌ manifest not found at $MANIFEST" >&2
  exit 1
fi

if [ ! -d "$MIGRATIONS_DIR" ]; then
  echo "❌ migrations dir not found at $MIGRATIONS_DIR" >&2
  exit 1
fi

VIOLATIONS=0

# ── §4.5 Historical baseline (0204–0208 + 0212) ────────────────────────────
# Migrations 0204–0208 and 0212 were corrected at runtime by 0213_fix_cached_context_rls.sql.
# Their source .sql files still carry the original (broken) phantom-var CREATE POLICY text
# because migrations are immutable once applied. The live DB state is correct; the static
# scan is noise. These files are baselined here and must carry the @rls-baseline: annotation.
# New occurrences in any other file remain blocking.

HISTORICAL_BASELINE_FILES=(
  "0204_document_bundles.sql"
  "0205_document_bundle_members.sql"
  "0206_document_bundle_attachments.sql"
  "0207_bundle_resolution_snapshots.sql"
  "0208_model_tier_budget_policies.sql"
  "0212_bundle_suggestion_dismissals.sql"
)
BASELINE_ANNOTATION="@rls-baseline:"

is_coverage_baselined() {
  local migration="$1"
  local migration_path="$MIGRATIONS_DIR/$migration"
  local basename
  basename=$(basename "$migration_path")
  for entry in "${HISTORICAL_BASELINE_FILES[@]}"; do
    if [[ "$basename" == "$entry" ]]; then
      if grep -q "$BASELINE_ANNOTATION" "$migration_path"; then
        return 0  # baselined + annotated — skip all three checks
      fi
      # In allowlist but annotation is missing — emit a specific violation then skip
      emit_violation "$GUARD_ID" "error" "$migration_path" "0" \
        "Migration $basename is in the RLS-coverage historical baseline but is missing the '$BASELINE_ANNOTATION' annotation." \
        "Add '-- @rls-baseline: phantom-var policy replaced at runtime by migration 0213_fix_cached_context_rls.sql' to $basename."
      VIOLATIONS=$((VIOLATIONS + 1))
      return 0  # skip further checks for this entry (violation already emitted above)
    fi
  done
  return 1  # not in allowlist — proceed with normal checks
}

# ── Parse the manifest ──────────────────────────────────────────────────────
# Extract (tableName, policyMigration) tuples via grep over the TS source.
# This avoids booting a node runtime inside the gate. The manifest entries
# are a fixed shape:
#   tableName: 'foo',
#   schemaFile: 'foo.ts',
#   policyMigration: '0079_rls_tasks_actions_runs.sql',
# The manifest parser walks the file line-by-line. Each entry in the
# manifest is a block of `tableName: '...'`, `schemaFile: '...'`,
# `policyMigration: '...'` lines. We use sed to extract the quoted
# strings and pair them up by position.
MANIFEST_TABLES_RAW=$(sed -nE "s/.*tableName: *'([^']+)'.*/\1/p" "$MANIFEST")
MANIFEST_POLICIES_RAW=$(sed -nE "s/.*policyMigration: *'([^']+)'.*/\1/p" "$MANIFEST")

MANIFEST_TUPLES=$(paste <(echo "$MANIFEST_TABLES_RAW") <(echo "$MANIFEST_POLICIES_RAW"))

if [ -z "$MANIFEST_TUPLES" ]; then
  echo "❌ Could not parse any (tableName, policyMigration) tuples from the manifest." >&2
  echo "   Manifest parser expects the canonical shape — see $MANIFEST" >&2
  exit 1
fi

# ── Forward check: every manifest entry must have a matching CREATE POLICY ──
while IFS=$'\t' read -r table migration; do
  [ -z "$table" ] && continue
  migration_path="$MIGRATIONS_DIR/$migration"

  if [ ! -f "$migration_path" ]; then
    emit_violation "$GUARD_ID" "error" "$MANIFEST" "0" \
      "Table '$table' declares policyMigration='$migration' but that file does not exist." \
      "Create the migration or update the manifest entry's policyMigration field."
    VIOLATIONS=$((VIOLATIONS + 1))
    continue
  fi

  # Skip historical migrations whose policies were repaired at runtime by a later
  # corrective migration (0213 for 0204–0208/0212, 0227 for others). The reverse
  # check below still validates that any CREATE POLICY in those corrective
  # migrations is registered in the manifest.
  if is_coverage_baselined "$migration"; then
    continue
  fi

  # Scan ALL migrations (not just policyMigration) for the three required
  # statements. This lets corrective migrations (e.g. 0227_rls_hardening_corrective)
  # satisfy the check for tables whose original policyMigration lacked FORCE or
  # CREATE POLICY.
  if ! grep -rqE "CREATE POLICY[[:space:]]+[a-zA-Z_]+[[:space:]]+ON[[:space:]]+${table}\\b" "$MIGRATIONS_DIR"; then
    emit_violation "$GUARD_ID" "error" "$migration_path" "0" \
      "No migration creates a policy on table '$table' (manifest policyMigration: $migration)." \
      "Add 'CREATE POLICY <name> ON $table USING (...) WITH CHECK (...)' to the migration or a corrective migration."
    VIOLATIONS=$((VIOLATIONS + 1))
  fi

  if ! grep -rqE "ALTER TABLE[[:space:]]+${table}[[:space:]]+ENABLE ROW LEVEL SECURITY" "$MIGRATIONS_DIR"; then
    emit_violation "$GUARD_ID" "error" "$migration_path" "0" \
      "No migration ENABLE ROW LEVEL SECURITY on table '$table' (manifest policyMigration: $migration)." \
      "Add 'ALTER TABLE $table ENABLE ROW LEVEL SECURITY;' to the migration or a corrective migration."
    VIOLATIONS=$((VIOLATIONS + 1))
  fi

  if ! grep -rqE "ALTER TABLE[[:space:]]+${table}[[:space:]]+FORCE ROW LEVEL SECURITY" "$MIGRATIONS_DIR"; then
    emit_violation "$GUARD_ID" "error" "$migration_path" "0" \
      "No migration FORCE ROW LEVEL SECURITY on table '$table' (manifest policyMigration: $migration)." \
      "Add 'ALTER TABLE $table FORCE ROW LEVEL SECURITY;' so the table owner is not exempt from the policy."
    VIOLATIONS=$((VIOLATIONS + 1))
  fi
done <<< "$MANIFEST_TUPLES"

# ── Reverse check: every CREATE POLICY in migrations must be manifest-known ─
# This catches the reverse drift — someone wrote a policy but forgot to
# register the table in the manifest, so the integration test and CI
# coverage check would skip it.
MANIFEST_TABLES=$(echo "$MANIFEST_TUPLES" | awk -F'\t' '{print $1}' | sort -u)

# Look for CREATE POLICY statements across all migrations.
while IFS= read -r match; do
  [ -z "$match" ] && continue
  file=$(echo "$match" | cut -d: -f1)
  content=$(echo "$match" | cut -d: -f3-)

  # Extract the table name after "ON".
  policy_table=$(echo "$content" | sed -nE 's/.*CREATE POLICY[[:space:]]+[a-zA-Z_]+[[:space:]]+ON[[:space:]]+([a-zA-Z_]+).*/\1/p')
  [ -z "$policy_table" ] && continue

  if ! echo "$MANIFEST_TABLES" | grep -qx "$policy_table"; then
    emit_violation "$GUARD_ID" "error" "$file" "0" \
      "Migration creates a policy on '$policy_table' but the table is not registered in rlsProtectedTables.ts." \
      "Add an RlsProtectedTable entry for '$policy_table' to server/config/rlsProtectedTables.ts."
    VIOLATIONS=$((VIOLATIONS + 1))
  fi
done < <(grep -rn "CREATE POLICY" "$MIGRATIONS_DIR" --include='*.sql' 2>/dev/null || true)

FILES_SCANNED=$(find "$MIGRATIONS_DIR" -name '*.sql' -not -path '*/_down/*' 2>/dev/null | wc -l)

emit_summary "$FILES_SCANNED" "$VIOLATIONS"

exit_code=$(check_baseline "$GUARD_ID" "$VIOLATIONS" 1)
exit "$exit_code"
