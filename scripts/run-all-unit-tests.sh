#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# run-all-unit-tests.sh — discovers and runs every **/__tests__/*.test.ts
# file via tsx, aggregates results, exits non-zero on any failure.
#
# Convention (per docs/testing-conventions.md):
#   - Pure logic lives in a sibling *Pure.ts file (no db / env imports)
#   - Tests import from the *Pure.ts module only
#   - Tests use the lightweight tsx pattern, not a framework
#   - One assertion helper per file is fine; no shared fixtures beyond
#     server/services/__tests__/fixtures/loadFixtures.ts
#
# Introduced by P0.1 Layer 1 of docs/improvements-roadmap-spec.md.
# ---------------------------------------------------------------------------

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

PASS_COUNT=0
FAIL_COUNT=0
SKIP_COUNT=0
FAILED_FILES=()

echo "=== Unit Tests ==="
echo ""

# Discover every *.test.ts under **/__tests__/ directories.
# Excludes node_modules and dist.
TEST_FILES=$(find . \
  -path ./node_modules -prune -o \
  -path ./dist -prune -o \
  -type f -name "*.test.ts" -path "*/__tests__/*" \
  -print 2>/dev/null | sort)

if [ -z "$TEST_FILES" ]; then
  echo "[INFO] No *.test.ts files found under **/__tests__/"
  exit 0
fi

while IFS= read -r test_file; do
  [ -z "$test_file" ] && continue
  rel="${test_file#./}"
  echo "--- Running: $rel ---"
  if npx tsx "$test_file"; then
    echo "[PASS] $rel"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    local_code=$?
    echo "[FAIL] $rel (exit $local_code)"
    FAIL_COUNT=$((FAIL_COUNT + 1))
    FAILED_FILES+=("$rel")
  fi
  echo ""
done <<< "$TEST_FILES"

echo "=== Unit Test Summary ==="
echo "  PASS: $PASS_COUNT"
echo "  FAIL: $FAIL_COUNT"
echo "  SKIP: $SKIP_COUNT"

if [ $FAIL_COUNT -gt 0 ]; then
  echo ""
  echo "Failed files:"
  for f in "${FAILED_FILES[@]}"; do
    echo "  - $f"
  done
  exit 1
fi

exit 0
