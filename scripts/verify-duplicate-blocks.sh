#!/usr/bin/env bash
# P12 — verify-duplicate-blocks.sh
# Detects duplicate code block regressions using jscpd.
# Compares current clone count against scripts/.gate-baselines/duplicate-blocks.txt.
# New clones → exit 2 (warning-first rollout). Reductions are silent.
#
# Usage: bash scripts/verify-duplicate-blocks.sh
# Exit codes: 0 = at or below baseline, 2 = regression (new clones)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
GUARD_ID="no-duplicate-blocks"

source "$SCRIPT_DIR/lib/guard-utils.sh"

# Use a distinct var name — guard-utils.sh defines BASELINE_FILE for a different purpose
CLONES_BASELINE_FILE="$ROOT_DIR/scripts/.gate-baselines/duplicate-blocks.txt"

JSCPD_REPORT_DIR=$(mktemp -d)

emit_header "$GUARD_ID"

# Run jscpd and write JSON report to temp dir
cd "$ROOT_DIR"
npx jscpd --min-tokens 15 --reporters json --output "$JSCPD_REPORT_DIR" \
  server/ client/ shared/ worker/ >/dev/null 2>&1 || true

REPORT_FILE="$JSCPD_REPORT_DIR/jscpd-report.json"

# Resolve path for Node on Windows (cygpath if available)
REPORT_FILE_NODE="$REPORT_FILE"
if command -v cygpath >/dev/null 2>&1; then
  REPORT_FILE_NODE="$(cygpath -m "$REPORT_FILE")"
fi

CURRENT_COUNT=0
if [ -f "$REPORT_FILE" ]; then
  CURRENT_COUNT=$(JSCPD_REPORT="$REPORT_FILE_NODE" node --input-type=module <<'NODEEOF'
import { readFileSync } from 'node:fs';
const report = JSON.parse(readFileSync(process.env.JSCPD_REPORT, 'utf8'));
process.stdout.write(String(report?.statistics?.total?.clones ?? 0));
NODEEOF
  )
fi

rm -rf "$JSCPD_REPORT_DIR"

# Read baseline count from baseline file
BASELINE_COUNT=0
if [ -f "$CLONES_BASELINE_FILE" ]; then
  RAW=$(grep -E '^clone-count:[0-9]+$' "$CLONES_BASELINE_FILE" | head -1 || true)
  if [ -n "$RAW" ]; then
    BASELINE_COUNT="${RAW#clone-count:}"
  fi
fi

echo ""
echo "Duplicate blocks — current: $CURRENT_COUNT, baseline: $BASELINE_COUNT"
echo "[GATE] ${GUARD_ID}: violations=${CURRENT_COUNT}"

if [ "$CURRENT_COUNT" -gt "$BASELINE_COUNT" ]; then
  echo "⚠ Regression: $CURRENT_COUNT clones exceeds baseline of $BASELINE_COUNT" >&2
  exit 2
fi

exit 0
