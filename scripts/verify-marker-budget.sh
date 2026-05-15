#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# verify-marker-budget.sh  (P10)
#
# Invariant: the per-file count of TODO/FIXME/HACK/TEMP/LEGACY/DEPRECATED
# markers must not grow above the baseline seeded at gate-landing.
#
# Non-growing: files may shrink (or stay at zero) without updating the
# baseline. Only growth above the baselined count fails the gate.
#
# Commit-body trailer (P10 authorisation):
#   Marker-Reason: <one-line rationale>
# When the most recent commit body contains a "Marker-Reason:" line, growth
# is treated as authorised and the gate logs it but still exits with the
# default_exit_code (2 during warning-first rollout). After promotion to
# exit 1 (via §C1 operator decision), trailer-present growth stays exit 2
# while trailer-absent growth becomes exit 1.
#
# Scope: server/, client/src/, shared/  (*.ts, *.tsx)
# Excludes: __tests__/ directories and *.test.ts files
#
# Exit codes:
#   0 = pass (no growth)
#   1 = growth without Marker-Reason trailer (post-promotion enforcement)
#   2 = growth (warning-first rollout; or post-promotion with trailer present)
# ---------------------------------------------------------------------------

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
GUARD_ID="marker-budget"
GUARD_NAME="Marker Budget (TODO/FIXME/HACK non-growing)"
BASELINE_FILE="${ROOT_DIR}/scripts/.gate-baselines/marker-budget.txt"
PER_FILE_HELPER="${ROOT_DIR}/scripts/lib/per-file-counter-pure.mjs"
# Promotion attempt 2026-05-15 reverted: current main exceeds baseline (33 files grew since PR #307 seed), baseline needs re-seeding before promotion. Tracked in tasks/todo.md.
DEFAULT_EXIT_CODE=2

source "$SCRIPT_DIR/lib/guard-utils.sh"

emit_header "$GUARD_NAME"

# ── Parse Marker-Reason: trailer from most recent commit body ─────────────────
MARKER_REASON=""
commit_body=$(git -C "$ROOT_DIR" log -1 --pretty=%B 2>/dev/null || true)
if echo "$commit_body" | grep -qE "^Marker-Reason:\s+\S"; then
  MARKER_REASON=$(echo "$commit_body" | grep -E "^Marker-Reason:\s+" | head -1 | sed 's/^Marker-Reason:\s*//')
fi

# ── Count markers per file via Node ──────────────────────────────────────────

result=$(
  BASELINE_FILE="$BASELINE_FILE" \
  PER_FILE_HELPER="$PER_FILE_HELPER" \
  ROOT_DIR="$ROOT_DIR" \
  node --input-type=module <<'NODEEOF'
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
const { countPerFile, diffAgainstBaseline, isSuppressed } = await import(
  'file://' + process.env.PER_FILE_HELPER
);

const rootDir = process.env.ROOT_DIR;
const baselineFile = process.env.BASELINE_FILE;
const guardId = 'marker-budget';

const SCAN_DIRS = ['server', 'client/src', 'shared'];

function walkFiles(dir) {
  const results = [];
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return results; }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === '__tests__' || e.name === 'node_modules') continue;
      results.push(...walkFiles(full));
    } else if (e.isFile()) {
      if (!e.name.endsWith('.ts') && !e.name.endsWith('.tsx')) continue;
      if (e.name.endsWith('.test.ts') || e.name.endsWith('.test.tsx')) continue;
      results.push(full);
    }
  }
  return results;
}

const fileSet = new Map();
for (const scanDir of SCAN_DIRS) {
  const absDir = join(rootDir, scanDir);
  for (const fullPath of walkFiles(absDir)) {
    const relPath = relative(rootDir, fullPath).replace(/\\/g, '/');
    try { fileSet.set(relPath, readFileSync(fullPath, 'utf8')); } catch { /* skip */ }
  }
}

// Match marker keywords in comments. Word-boundary to avoid false positives.
const patterns = [/\b(TODO|FIXME|HACK|TEMP|LEGACY|DEPRECATED)\b/];

const currentCounts = countPerFile({
  patterns,
  fileSet,
  suppressionPredicate: isSuppressed,
  guardId,
});

let baselineText = '';
try { baselineText = readFileSync(baselineFile, 'utf8'); } catch { /* no baseline yet */ }

const violations = diffAgainstBaseline(currentCounts, baselineText);

for (const v of violations) {
  process.stdout.write(JSON.stringify(v) + '\n');
}
NODEEOF
)

VIOLATIONS=0
while IFS= read -r line; do
  [ -z "$line" ] && continue
  file=$(node -e "process.stdout.write(JSON.parse(process.argv[1]).file)" "$line" 2>/dev/null || true)
  current=$(node -e "process.stdout.write(String(JSON.parse(process.argv[1]).current))" "$line" 2>/dev/null || true)
  baseline=$(node -e "process.stdout.write(String(JSON.parse(process.argv[1]).baseline))" "$line" 2>/dev/null || true)

  if [ -n "$MARKER_REASON" ]; then
    emit_violation "$GUARD_ID" "warning" "$file" "0" \
      "Marker count grew (authorised via Marker-Reason: ${MARKER_REASON}): ${current} (was ${baseline} in baseline)" \
      "Update baseline when markers are intentional. Marker-Reason trailer recorded."
    echo "[GUARD] ${GUARD_ID}: authorised growth in ${file} — Marker-Reason: ${MARKER_REASON}" >&2
  else
    emit_violation "$GUARD_ID" "warning" "$file" "0" \
      "Marker count grew: ${current} (was ${baseline} in baseline)" \
      "Fix or suppress the new markers, or include 'Marker-Reason: <rationale>' in your commit body."
  fi
  VIOLATIONS=$((VIOLATIONS + 1))
done <<< "$result"

FILES_SCANNED=$(echo "$result" | grep -c . || true)

emit_summary "$FILES_SCANNED" "$VIOLATIONS"

if [ "$VIOLATIONS" -gt 0 ]; then
  if [ -n "$MARKER_REASON" ]; then
    # Trailer present: exit 2 (warning) both now and post-promotion
    exit 2
  else
    # No trailer: exit DEFAULT_EXIT_CODE (2 during rollout; 1 post-promotion via §C1)
    exit "$DEFAULT_EXIT_CODE"
  fi
fi
exit 0
