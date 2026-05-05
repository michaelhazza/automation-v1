#!/usr/bin/env bash
set -euo pipefail

# Gate: Data dictionary registry covers all canonical tables and column lists match.
# This is a lightweight grep-based check. Full validation runs via the pure validator in tests.

REGISTRY_FILE="server/services/canonicalDictionary/canonicalDictionaryRegistry.ts"

if [ ! -f "$REGISTRY_FILE" ]; then
  echo "FAIL: Dictionary registry file not found: $REGISTRY_FILE"
  echo "[GATE] canonical-dictionary: violations=1"
  exit 1
fi

# Collect canonical table names from schema files.
# Table names may appear on the same line as pgTable( or on the following line,
# so we use perl to extract the first string argument after pgTable(.
SCHEMA_TABLES=$(perl -0777 -ne "while (/pgTable\(\s*'(canonical_[^']*)'/g) { print \"\$1\n\" }" server/db/schema/*.ts \
  | sort -u)

FAIL=0
for TABLE in $SCHEMA_TABLES; do
  if ! grep -q "'$TABLE'" "$REGISTRY_FILE"; then
    echo "FAIL: Table $TABLE not found in dictionary registry"
    FAIL=1
  fi
done

if [ "$FAIL" -eq 1 ]; then
  echo "[GATE] canonical-dictionary: violations=1"
  exit 1
fi

echo "PASS: verify-canonical-dictionary (all canonical tables covered)"
echo "[GATE] canonical-dictionary: violations=0"
