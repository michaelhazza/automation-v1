#!/usr/bin/env bash
# P11 — verify-no-new-cycles.sh
# Detects circular dependency regressions using madge.
# Compares current cycle count against scripts/.gate-baselines/circular-deps.txt.
# New cycles → exit 2 (warning-first rollout). Reductions are silent.
#
# Usage: bash scripts/verify-no-new-cycles.sh
# Exit codes: 0 = at or below baseline, 2 = regression (new cycles)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
GUARD_ID="no-new-cycles"

source "$SCRIPT_DIR/lib/guard-utils.sh"

# Use a distinct var name — guard-utils.sh defines BASELINE_FILE for a different purpose
CYCLES_BASELINE_FILE="$ROOT_DIR/scripts/.gate-baselines/circular-deps.txt"

emit_header "$GUARD_ID"

# Run madge and write JSON to a temp file
TMP_CYCLES=$(mktemp)
cd "$ROOT_DIR"
npx madge --circular --json server/ client/ shared/ worker/ 2>/dev/null > "$TMP_CYCLES" || true

# Resolve temp file path for Node on Windows (cygpath if available)
TMP_CYCLES_NODE="$TMP_CYCLES"
if command -v cygpath >/dev/null 2>&1; then
  TMP_CYCLES_NODE="$(cygpath -m "$TMP_CYCLES")"
fi

CURRENT_COUNT=$(CYCLES_FILE="$TMP_CYCLES_NODE" node --input-type=module <<'NODEEOF'
import { readFileSync } from 'node:fs';
const arr = JSON.parse(readFileSync(process.env.CYCLES_FILE, 'utf8'));
process.stdout.write(String(arr.length));
NODEEOF
)

rm -f "$TMP_CYCLES"

# Read baseline count from baseline file
BASELINE_COUNT=0
if [ -f "$CYCLES_BASELINE_FILE" ]; then
  RAW=$(grep -E '^cycle-count:[0-9]+$' "$CYCLES_BASELINE_FILE" | head -1 || true)
  if [ -n "$RAW" ]; then
    BASELINE_COUNT="${RAW#cycle-count:}"
  fi
fi

echo ""
echo "Circular dependencies — current: $CURRENT_COUNT, baseline: $BASELINE_COUNT"
echo "[GATE] ${GUARD_ID}: violations=${CURRENT_COUNT}"

if [ "$CURRENT_COUNT" -gt "$BASELINE_COUNT" ]; then
  echo "⚠ Regression: $CURRENT_COUNT cycles exceeds baseline of $BASELINE_COUNT" >&2
  exit 2
fi

exit 0
