#!/usr/bin/env bash
set -euo pipefail

# Validates $schema identifiers and no placeholder tokens in all JSON spec files

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

declare -A EXPECTED_SCHEMAS
EXPECTED_SCHEMAS["docs/scope-manifest.json"]="scope-manifest-v6"
EXPECTED_SCHEMAS["docs/env-manifest.json"]="env-manifest-v2"
EXPECTED_SCHEMAS["docs/data-relationships.json"]="data-relationships-v2"
EXPECTED_SCHEMAS["docs/service-contracts.json"]="service-contracts-v2"
EXPECTED_SCHEMAS["docs/ui-api-deps.json"]="ui-api-deps-v2"

for file in "${!EXPECTED_SCHEMAS[@]}"; do
  expected="${EXPECTED_SCHEMAS[$file]}"
  if [ ! -f "$file" ]; then
    classify_and_exit BLOCKING "Spec file not found: $file"
  fi
  actual=$(jq -r '.["$schema"] // empty' "$file")
  if [ "$actual" != "$expected" ]; then
    classify_and_exit BLOCKING "$file schema mismatch (expected: $expected, got: $actual)"
  fi
done

# Check for placeholder tokens in JSON files
for file in docs/scope-manifest.json docs/env-manifest.json docs/data-relationships.json docs/service-contracts.json docs/ui-api-deps.json; do
  if grep -q -E '\bTBD\b|\bTODO\b|\bplaceholder\b|\bFIXME\b|\bXXX\b' "$file" 2>/dev/null; then
    classify_and_exit BLOCKING "$file contains placeholder tokens (TBD/TODO/placeholder/FIXME/XXX)"
  fi
done

classify_and_exit OK "Schema compliance validated. All 5 JSON files have correct \$schema identifiers. No placeholder tokens detected."
