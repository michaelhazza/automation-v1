#!/usr/bin/env bash
# P12 — verify-duplicate-blocks.sh
# Detects duplicate code block regressions using jscpd.
# Compares current clone count against scripts/.gate-baselines/duplicate-blocks.txt.
# New clones → exit 1 (error mode). Reductions are silent.
# Promoted to exit-1 error mode 2026-05-16 after re-seeding baseline (post-Wave-5 count); current ceiling 9335 absorbs the Session-K W4AA-DEBT-17 re-seed.
#
# Usage: bash scripts/verify-duplicate-blocks.sh
# Exit codes: 0 = at or below baseline, 1 = regression (new clones)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
GUARD_ID="no-duplicate-blocks"

source "$SCRIPT_DIR/lib/guard-utils.sh"

# Use a distinct var name — guard-utils.sh defines BASELINE_FILE for a different purpose
CLONES_BASELINE_FILE="$ROOT_DIR/scripts/.gate-baselines/duplicate-blocks.txt"

JSCPD_REPORT_DIR=$(mktemp -d)
JSCPD_STDERR=$(mktemp)

emit_header "$GUARD_ID"

# Run jscpd and write JSON report to temp dir.
# jscpd exits 0 on success regardless of clone count (clones are reported in the
# JSON, not via exit code). Any non-zero exit indicates a tool error (broken
# install, bad CLI flag, parse failure) — fail closed rather than defaulting to 0.
cd "$ROOT_DIR"
set +e
npx jscpd --min-tokens 15 --reporters json --output "$JSCPD_REPORT_DIR" \
  server/ client/ shared/ worker/ >/dev/null 2> "$JSCPD_STDERR"
JSCPD_EXIT=$?
set -e

if [ "$JSCPD_EXIT" -ne 0 ]; then
  echo "⚠ jscpd failed (exit $JSCPD_EXIT) — gate cannot evaluate clone count" >&2
  echo "--- jscpd stderr ---" >&2
  cat "$JSCPD_STDERR" >&2
  echo "--- end jscpd stderr ---" >&2
  rm -rf "$JSCPD_REPORT_DIR" "$JSCPD_STDERR"
  exit 1
fi

REPORT_FILE="$JSCPD_REPORT_DIR/jscpd-report.json"

# Report file must exist on success — if it doesn't, the output path changed
# upstream or jscpd silently skipped writing. Either way, fail closed.
if [ ! -f "$REPORT_FILE" ]; then
  echo "⚠ jscpd succeeded but did not produce $REPORT_FILE — gate cannot evaluate clone count" >&2
  rm -rf "$JSCPD_REPORT_DIR" "$JSCPD_STDERR"
  exit 1
fi

# Resolve path for Node on Windows (cygpath if available)
REPORT_FILE_NODE="$REPORT_FILE"
if command -v cygpath >/dev/null 2>&1; then
  REPORT_FILE_NODE="$(cygpath -m "$REPORT_FILE")"
fi

CURRENT_COUNT=$(JSCPD_REPORT="$REPORT_FILE_NODE" node --input-type=module <<'NODEEOF'
import { readFileSync } from 'node:fs';
try {
  const report = JSON.parse(readFileSync(process.env.JSCPD_REPORT, 'utf8'));
  const clones = report?.statistics?.total?.clones;
  if (typeof clones !== 'number') {
    process.stderr.write('jscpd report missing statistics.total.clones\n');
    process.exit(2);
  }
  process.stdout.write(String(clones));
} catch (e) {
  process.stderr.write('Failed to parse jscpd report: ' + e.message + '\n');
  process.exit(2);
}
NODEEOF
) || {
  echo "⚠ Failed to parse jscpd report — gate cannot evaluate clone count" >&2
  rm -rf "$JSCPD_REPORT_DIR" "$JSCPD_STDERR"
  exit 1
}

rm -rf "$JSCPD_REPORT_DIR" "$JSCPD_STDERR"

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
  exit 1
fi

exit 0
