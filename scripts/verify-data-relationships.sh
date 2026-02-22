#!/usr/bin/env bash
set -euo pipefail

# Validates data-relationships.json schema integrity and FK coverage for Automation OS

SPEC_FILE="docs/data-relationships.json"

classify_and_exit() {
  local severity=$1
  local message=$2
  case $severity in
    OK|PASS) echo "$message"; exit 0 ;;
    BLOCKING) echo "[BLOCKING] $message"; exit 1 ;;
    WARNING|WARN) echo "[WARNING] $message"; exit 2 ;;
    INFO) echo "[INFO] $message"; exit 3 ;;
    *) echo "[ERROR] Unknown severity: $severity"; exit 1 ;;
  esac
}

if [ ! -f "$SPEC_FILE" ]; then
  classify_and_exit BLOCKING "data-relationships.json not found at $SPEC_FILE"
fi

SCHEMA=$(jq -r '.["$schema"] // empty' "$SPEC_FILE")
if [ "$SCHEMA" != "data-relationships-v2" ]; then
  classify_and_exit BLOCKING "data-relationships.json schema mismatch (expected: data-relationships-v2, got: $SCHEMA)"
fi

TABLE_COUNT=$(jq '.tables | length' "$SPEC_FILE")
if [ "$TABLE_COUNT" -ne 10 ]; then
  classify_and_exit BLOCKING "table count mismatch (expected: 10, got: $TABLE_COUNT)"
fi

TABLES=$(jq -r '.tables[].name' "$SPEC_FILE")
for table in $TABLES; do
  tenant_key=$(jq -r --arg t "$table" '.tables[] | select(.name == $t) | .tenantKey // empty' "$SPEC_FILE")
  if [ -z "$tenant_key" ]; then
    classify_and_exit BLOCKING "table $table missing tenantKey"
  fi
  case "$tenant_key" in
    container|direct|indirect|none) ;;
    *) classify_and_exit BLOCKING "table $table tenantKey invalid value '$tenant_key' (allowed: container|direct|indirect|none)" ;;
  esac

  is_soft=$(jq -r --arg t "$table" '.tables[] | select(.name == $t) | .softDelete' "$SPEC_FILE")
  if [ "$is_soft" = "true" ]; then
    has_deleted_at=$(jq --arg t "$table" '[.tables[] | select(.name == $t) | .columns[] | select(.name == "deletedAt")] | length' "$SPEC_FILE")
    if [ "$has_deleted_at" -eq 0 ]; then
      classify_and_exit BLOCKING "table $table softDelete:true but no deletedAt column"
    fi
    bad_unique=$(jq --arg t "$table" '
      [.tables[] | select(.name == $t) | .columns[] |
        select(.unique == true and (.partialUnique == null or .partialUnique == false) and (.primaryKey == null or .primaryKey == false))
      ] | length' "$SPEC_FILE")
    if [ "$bad_unique" -gt 0 ]; then
      classify_and_exit BLOCKING "SOFT-DELETE VIOLATION: table $table has unique:true without partialUnique on soft-deletable table"
    fi
    bad_idx=$(jq --arg t "$table" '
      [.tables[] | select(.name == $t) | .indexes[]? |
        select(.unique == true and (.partialUnique == null or .partialUnique == false))
      ] | length' "$SPEC_FILE")
    if [ "$bad_idx" -gt 0 ]; then
      classify_and_exit BLOCKING "SOFT-DELETE VIOLATION: table $table index with unique:true without partialUnique"
    fi
  fi

  missing_drizzle=$(jq --arg t "$table" '
    [.tables[] | select(.name == $t) | .columns[] | select(has("drizzle") | not)] | length' "$SPEC_FILE")
  if [ "$missing_drizzle" -gt 0 ]; then
    classify_and_exit BLOCKING "table $table has $missing_drizzle columns missing drizzle mapping"
  fi
done

FK_COUNT=$(jq '[.tables[].columns[] | select(has("references"))] | length' "$SPEC_FILE")
CASCADE_COUNT=$(jq '[.softDeleteCascades[].cascadeTargets[]] | length' "$SPEC_FILE")
NON_CASCADE_COUNT=$(jq '.nonCascadingForeignKeys | length' "$SPEC_FILE")
EXPECTED_TOTAL=$((CASCADE_COUNT + NON_CASCADE_COUNT))
if [ "$FK_COUNT" -ne "$EXPECTED_TOTAL" ]; then
  classify_and_exit BLOCKING "FK coverage gap: $FK_COUNT FK columns but $CASCADE_COUNT cascade + $NON_CASCADE_COUNT non-cascading = $EXPECTED_TOTAL. Classify all FKs."
fi

classify_and_exit OK "data-relationships.json valid. $TABLE_COUNT tables. FK coverage complete: $FK_COUNT = $CASCADE_COUNT cascade + $NON_CASCADE_COUNT non-cascading. Drizzle mappings present."
