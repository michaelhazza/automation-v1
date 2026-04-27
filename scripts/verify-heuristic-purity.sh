#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# verify-heuristic-purity.sh
#
# Enforces that heuristic modules under server/services/systemMonitor/heuristics/
# contain no Drizzle DB mutation calls (.insert( / .update( / .delete().
# Heuristics are pure evaluation functions — all side-effects (fire rows,
# incidents, triage) belong in the orchestration layer (sweepHandler, triageHandler).
# A heuristic that writes directly bypasses rate-limit, throttle, and audit-row
# guarantees. See spec §6.2 / §9.2.
#
# Excludes:
#   - import type lines (compile-time only, no runtime mutation)
#   - files under __tests__/ directories (fixture violations allowed in tests)
#
# SCAN_DIR override: set HEURISTIC_PURITY_SCAN_DIR to a different path for
# self-testing against a fixture directory.
#
# Exit codes:  0 = pass, 1 = blocking violations found.
# ---------------------------------------------------------------------------

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
GATE_ID="heuristic-purity"

SCAN_DIR="${HEURISTIC_PURITY_SCAN_DIR:-$ROOT_DIR/server/services/systemMonitor/heuristics}"

# When using the real heuristics dir, skip __tests__/ sub-directories.
# When SCAN_DIR is overridden (e.g. a fixture dir in scripts/__tests__/),
# skip the exclusion so the self-test can target the fixture directly.
SKIP_TESTS_DIR="${HEURISTIC_PURITY_SCAN_DIR:+no}"
SKIP_TESTS_DIR="${SKIP_TESTS_DIR:-yes}"

if [ ! -d "$SCAN_DIR" ]; then
  echo "[INFO] Heuristic directory not found at $SCAN_DIR — gate skipped."
  echo "[GATE] $GATE_ID: violations=0"
  exit 0
fi

VIOLATIONS=0
VIOLATION_FILES=()

# Patterns that indicate a DB mutation call inside a heuristic module.
PATTERNS=('.insert(' '.update(' '.delete(')

for PATTERN in "${PATTERNS[@]}"; do
  while IFS= read -r MATCH; do
    [ -z "$MATCH" ] && continue
    # Strip CRLF (Windows)
    MATCH="$(echo "$MATCH" | tr -d '\r')"
    FILE="$(echo "$MATCH" | cut -d: -f1)"
    # Skip __tests__/ directories (only when scanning the real heuristics dir)
    if [ "$SKIP_TESTS_DIR" = "yes" ]; then
      echo "$FILE" | grep -q '/__tests__/' && continue
    fi
    # Skip import type lines
    LINE_CONTENT="$(echo "$MATCH" | cut -d: -f3-)"
    echo "$LINE_CONTENT" | grep -q 'import type' && continue
    echo "[VIOLATION] Heuristic mutation call in: $FILE"
    echo "  -> $MATCH"
    VIOLATION_FILES+=("$FILE")
    VIOLATIONS=$((VIOLATIONS + 1))
  done < <(grep -rn "$PATTERN" "$SCAN_DIR" --include="*.ts" 2>/dev/null || true)
done

echo ""
if [ "$VIOLATIONS" -gt 0 ]; then
  echo "[GATE] $GATE_ID: violations=$VIOLATIONS"
  echo "[BLOCKING] $VIOLATIONS heuristic module(s) contain DB mutation calls."
  echo "  Heuristics must be pure functions (evaluate only). Move writes to sweepHandler or triageHandler."
  exit 1
fi

echo "[GATE] $GATE_ID: violations=0"
echo "[PASS] No DB mutation calls found in heuristic modules."
exit 0
