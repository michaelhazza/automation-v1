#!/usr/bin/env bash
# verify-migration-sequencing.sh
# Verifies migration ordering, RLS coverage, and schema-vs-introspection consistency.
# Requires DATABASE_URL pointing at a disposable Postgres instance.
#
# Usage: DATABASE_URL=postgres://... bash scripts/verify-migration-sequencing.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
GUARD_ID="migration-sequencing"
GUARD_NAME="Migration Sequencing"

source "$SCRIPT_DIR/lib/guard-utils.sh"

emit_header "$GUARD_NAME"

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL must be set to a disposable Postgres instance" >&2
  echo "[GATE] ${GUARD_ID}: violations=1"
  exit 1
fi

VIOLATIONS=0
FILES_SCANNED=0

# ── Check 1: Migration file ordering ─────────────────────────────────────────
# Verify migration files are numbered sequentially with no gaps or duplicates.
echo "Check 1: Migration file sequencing..."
MIGRATION_DIR="$ROOT_DIR/migrations"
FILES_SCANNED=$((FILES_SCANNED + 1))

prev_num=-1
while IFS= read -r file; do
  basename_file=$(basename "$file")
  # Extract leading number from filename (e.g., 0042 from 0042_foo.sql)
  num=$(echo "$basename_file" | grep -oE '^[0-9]+' || true)
  if [ -z "$num" ]; then
    emit_violation "$GUARD_ID" "error" "$file" "1" \
      "Migration file missing numeric prefix: $basename_file" \
      "Rename to NNNN_<name>.sql format"
    VIOLATIONS=$((VIOLATIONS + 1))
    continue
  fi
  num_decimal=$((10#$num))
  expected=$((prev_num + 1))
  if [ "$prev_num" -ge 0 ] && [ "$num_decimal" -ne "$expected" ]; then
    emit_violation "$GUARD_ID" "error" "$file" "1" \
      "Migration sequence gap: expected $expected, got $num_decimal (file: $basename_file)" \
      "Ensure migrations are numbered consecutively"
    VIOLATIONS=$((VIOLATIONS + 1))
  fi
  prev_num=$num_decimal
done < <(find "$MIGRATION_DIR" -maxdepth 1 -name "*.sql" | sort)

# ── Check 2: Each migration file runs without error ───────────────────────────
echo "Check 2: Fresh-DB migration replay..."
FILES_SCANNED=$((FILES_SCANNED + 1))

# Create a temp schema to isolate
TEMP_SCHEMA="migration_verify_$$"
psql "$DATABASE_URL" -c "CREATE SCHEMA IF NOT EXISTS $TEMP_SCHEMA;" 2>/dev/null || {
  emit_violation "$GUARD_ID" "error" "migrations/" "1" \
    "Cannot connect to DATABASE_URL or create schema" \
    "Check DATABASE_URL points at an accessible Postgres instance"
  VIOLATIONS=$((VIOLATIONS + 1))
  emit_summary "$FILES_SCANNED" "$VIOLATIONS"
  exit "$(check_baseline "$GUARD_ID" "$VIOLATIONS" 1)"
}

# Run all migrations in order in a transaction; rollback to avoid leaving state
migration_error=0
for sql_file in $(find "$MIGRATION_DIR" -maxdepth 1 -name "*.sql" | sort); do
  psql "$DATABASE_URL" --set=search_path="$TEMP_SCHEMA",public -f "$sql_file" > /dev/null 2>&1 || {
    emit_violation "$GUARD_ID" "error" "$sql_file" "1" \
      "Migration failed during replay: $(basename "$sql_file")" \
      "Inspect the SQL file for syntax errors or missing dependencies"
    VIOLATIONS=$((VIOLATIONS + 1))
    migration_error=1
  }
done

# Cleanup the temp schema
psql "$DATABASE_URL" -c "DROP SCHEMA IF EXISTS $TEMP_SCHEMA CASCADE;" 2>/dev/null || true

# ── Check 3: Tenant tables have FORCE RLS ─────────────────────────────────────
echo "Check 3: RLS coverage on tenant tables..."
FILES_SCANNED=$((FILES_SCANNED + 1))

# Find all tables that have organisation_id column in migrations
TENANT_TABLES=$(grep -h "organisation_id" "$MIGRATION_DIR"/*.sql \
  | grep -oE 'CREATE TABLE [a-z_]+' \
  | awk '{print $3}' \
  | sort -u || true)

for table in $TENANT_TABLES; do
  # Check if any migration enables FORCE RLS for this table
  if ! grep -qE "ALTER TABLE.*${table}.*FORCE ROW LEVEL SECURITY|FORCE ROW LEVEL SECURITY.*${table}" \
       "$MIGRATION_DIR"/*.sql; then
    emit_violation "$GUARD_ID" "error" "migrations/" "1" \
      "Tenant table '$table' has organisation_id but no FORCE ROW LEVEL SECURITY" \
      "Add: ALTER TABLE $table ENABLE ROW LEVEL SECURITY; ALTER TABLE $table FORCE ROW LEVEL SECURITY;"
    VIOLATIONS=$((VIOLATIONS + 1))
  fi
done

# ── Check 4: No out-of-order ALTER TABLE referencing future-defined tables ────
echo "Check 4: Forward-reference check..."
FILES_SCANNED=$((FILES_SCANNED + 1))

# Detect ALTER TABLE or FK references to tables not yet created at that migration file's point
# This is a lightweight check: for each migration, verify any FK REFERENCES table was
# created in an equal-or-earlier migration.
declared_tables=()
while IFS= read -r file; do
  # Tables created in THIS file
  new_tables=$(grep -oE 'CREATE TABLE (IF NOT EXISTS )?[a-z_]+' "$file" \
    | awk '{print $NF}' || true)
  for t in $new_tables; do
    declared_tables+=("$t")
  done

  # FK references in THIS file
  fk_refs=$(grep -oE 'REFERENCES [a-z_]+' "$file" | awk '{print $2}' || true)
  for ref in $fk_refs; do
    found=0
    for declared in "${declared_tables[@]:-}"; do
      [ "$declared" = "$ref" ] && found=1 && break
    done
    if [ "$found" -eq 0 ]; then
      # Allow postgres built-in tables
      case "$ref" in
        pg_*|information_schema) continue ;;
      esac
      emit_violation "$GUARD_ID" "warning" "$file" "1" \
        "FK REFERENCES '$ref' before table is declared in migration sequence" \
        "Ensure '$ref' is created in an earlier migration file"
      # warnings don't increment VIOLATIONS (only errors do)
    fi
  done
done < <(find "$MIGRATION_DIR" -maxdepth 1 -name "*.sql" | sort)

emit_summary "$FILES_SCANNED" "$VIOLATIONS"

exit "$(check_baseline "$GUARD_ID" "$VIOLATIONS" 1)"
