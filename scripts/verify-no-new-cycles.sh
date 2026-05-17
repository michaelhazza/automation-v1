#!/usr/bin/env bash
# P11 — verify-no-new-cycles.sh
# Detects circular dependency regressions using madge.
# Compares current cycle count against scripts/.gate-baselines/circular-deps.txt.
# New cycles → exit 1 (error). Reductions are silent.
# Warning-first rollout promoted to error 2026-05-15 (post-7-day soak from PR #307).
#
# Gate scope (wave-4 spec §5.4 confirmed 2026-05-16): this gate runs against the
# full server/ + client/ + shared/ + worker/ graph. There is no allowlist for
# framework/tooling cycles today — current baseline is 0, so any new cycle is
# a regression irrespective of source. If a future tooling cycle becomes
# unavoidable, narrow scope here AND add the corresponding tolerance comment.
#
# Usage: bash scripts/verify-no-new-cycles.sh
# Exit codes: 0 = at or below baseline, 1 = regression (new cycles)

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
TMP_CYCLES_STDERR=$(mktemp)
cd "$ROOT_DIR"
set +e
npx madge --circular --json server/ client/ shared/ > "$TMP_CYCLES" 2> "$TMP_CYCLES_STDERR"
MADGE_EXIT=$?
set -e

# madge exits 0 on no cycles AND on cycles-found. Any non-zero exit is a tool error.
# Fail closed: a silent madge failure (broken install, parse error, bad CLI flag) must
# not produce a clean pass with zero cycles.
if [ "$MADGE_EXIT" -ne 0 ]; then
  echo "⚠ madge failed (exit $MADGE_EXIT) — gate cannot evaluate cycle count" >&2
  echo "--- madge stderr ---" >&2
  cat "$TMP_CYCLES_STDERR" >&2
  echo "--- end madge stderr ---" >&2
  rm -f "$TMP_CYCLES" "$TMP_CYCLES_STDERR"
  exit 1
fi

# Resolve temp file path for Node on Windows (cygpath if available)
TMP_CYCLES_NODE="$TMP_CYCLES"
if command -v cygpath >/dev/null 2>&1; then
  TMP_CYCLES_NODE="$(cygpath -m "$TMP_CYCLES")"
fi

CURRENT_COUNT=$(CYCLES_FILE="$TMP_CYCLES_NODE" node --input-type=module <<'NODEEOF'
import { readFileSync } from 'node:fs';
try {
  const arr = JSON.parse(readFileSync(process.env.CYCLES_FILE, 'utf8'));
  if (!Array.isArray(arr)) {
    process.stderr.write('madge output is not a JSON array\n');
    process.exit(2);
  }
  process.stdout.write(String(arr.length));
} catch (e) {
  process.stderr.write('Failed to parse madge JSON: ' + e.message + '\n');
  process.exit(2);
}
NODEEOF
) || {
  echo "⚠ Failed to parse madge JSON output — gate cannot evaluate cycle count" >&2
  rm -f "$TMP_CYCLES" "$TMP_CYCLES_STDERR"
  exit 1
}

rm -f "$TMP_CYCLES" "$TMP_CYCLES_STDERR"

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
  exit 1
fi

exit 0
