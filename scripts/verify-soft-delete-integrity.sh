#!/usr/bin/env bash
set -euo pipefail

# Validates soft-delete cascade completeness for Automation OS

# jq on Windows (winget binary) under Git Bash has two portability hazards:
#   (1) CRLF line endings on stdout — break bash word-splitting on captured
#       output (each token ends up with a trailing \r).
#   (2) MSYS auto-converts Unix-style argv tokens (e.g. `--arg p
#       "/api/engines"`) to Windows paths, mangling the comparison value.
# Solution: convert positional file args to Windows native form via cygpath,
# disable global path conv, then strip \r. No-op on Linux/macOS.
jq() {
  if command -v cygpath >/dev/null 2>&1; then
    local args=()
    local a
    for a in "$@"; do
      if [ -f "$a" ]; then args+=("$(cygpath -m "$a")"); else args+=("$a"); fi
    done
    MSYS_NO_PATHCONV=1 command jq "${args[@]}" | tr -d '\r'
  else
    command jq "$@" | tr -d '\r'
  fi
}

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

DATA="docs/data-relationships.json"
if [ ! -f "$DATA" ]; then
  classify_and_exit BLOCKING "data-relationships.json not found"
fi

# All tables with softDelete:true must have softDeleteColumn set
SOFT_DELETE_TABLES=$(jq -r '.tables[] | select(.softDelete == true) | .name' "$DATA")
for table in $SOFT_DELETE_TABLES; do
  sdc=$(jq -r --arg t "$table" '.tables[] | select(.name == $t) | .softDeleteColumn // empty' "$DATA")
  if [ -z "$sdc" ]; then
    classify_and_exit BLOCKING "Table $table softDelete:true but softDeleteColumn not set"
  fi
  if [ "$sdc" != "deletedAt" ]; then
    classify_and_exit BLOCKING "Table $table softDeleteColumn should be 'deletedAt' (got: $sdc)"
  fi
done

# Verify all FK columns are covered by either cascade or non-cascading exemption
FK_COUNT=$(jq '[.tables[].columns[] | select(has("references"))] | length' "$DATA")
CASCADE_COUNT=$(jq '[.softDeleteCascades[].cascadeTargets[]] | length' "$DATA")
NON_CASCADE_COUNT=$(jq '.nonCascadingForeignKeys | length' "$DATA")
TOTAL=$((CASCADE_COUNT + NON_CASCADE_COUNT))
if [ "$FK_COUNT" -ne "$TOTAL" ]; then
  classify_and_exit BLOCKING "Soft-delete cascade coverage gap: $FK_COUNT FKs but ($CASCADE_COUNT + $NON_CASCADE_COUNT) = $TOTAL classified"
fi

# Verify executions table has no deletedAt (immutable audit records)
EXEC_SOFT=$(jq '[.tables[] | select(.name == "executions") | select(.softDelete == true)] | length' "$DATA")
if [ "$EXEC_SOFT" -gt 0 ]; then
  classify_and_exit BLOCKING "executions table must not have softDelete:true - execution records are immutable audit trail"
fi

SOFT_COUNT=$(jq '[.tables[] | select(.softDelete == true)] | length' "$DATA")
HARD_COUNT=$(jq '[.tables[] | select(.softDelete == false)] | length' "$DATA")

classify_and_exit OK "Soft-delete integrity confirmed. $SOFT_COUNT soft-delete tables (all with deletedAt + softDeleteColumn). $FK_COUNT FKs fully classified."
