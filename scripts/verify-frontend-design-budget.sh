#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# verify-frontend-design-budget.sh  (P8)
#
# Invariant: files importing enterprise/admin dashboard components must be
# listed in docs/frontend-design-allowlist.json.
#
# Monitored components (discovered from client/src/components/**):
#   MetricCard          — client/src/components/MetricCard.tsx
#   RunActivityChart    — client/src/components/ActivityCharts.tsx
#   SuccessRateChart    — client/src/components/ActivityCharts.tsx
#   SparkLine           — client/src/components/ActivityCharts.tsx
#   PnlKpiCard          — client/src/components/system-pnl/PnlKpiCard.tsx
#   PnlSparkline        — client/src/components/system-pnl/PnlSparkline.tsx
#   PnlTrendChart       — client/src/components/system-pnl/PnlTrendChart.tsx
#   SparklineChart      — client/src/components/clientpulse/SparklineChart.tsx
#   SpendTrendChart     — client/src/pages/govern/components/SpendTrendChart.tsx
#
# Scope: client/src/**/*.tsx (all React component files)
# Excludes: __tests__/ directories and *.test.tsx files
#
# Suppression: add the file to docs/frontend-design-allowlist.json with a reason.
# No per-line guard-ignore — the allow-list JSON is the only suppression surface.
#
# Baseline: scripts/.gate-baselines/frontend-design-budget.txt
#   (intentionally empty at landing — all current importers seeded into allow-list)
#
# Exit codes: 0=pass, 1=violations (files not in allow-list), 2=within baseline
# Warning-first rollout promoted to error 2026-05-15 (post-7-day soak from PR #307); exit-1 path was already in place via check_expiring_baseline.
# ---------------------------------------------------------------------------

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
GUARD_ID="frontend-design-budget"
GUARD_NAME="Frontend Design Budget (P8)"
BASELINE_FILE="${ROOT_DIR}/scripts/.gate-baselines/frontend-design-budget.txt"
ALLOWLIST_FILE="${ROOT_DIR}/docs/frontend-design-allowlist.json"
ALLOWLIST_PURE="${ROOT_DIR}/scripts/lib/frontend-design-allowlist-pure.mjs"

source "$SCRIPT_DIR/lib/guard-utils.sh"

emit_header "$GUARD_NAME"

if [ ! -f "$ALLOWLIST_FILE" ]; then
  echo "[GATE] ${GUARD_ID}: allow-list not found at ${ALLOWLIST_FILE}" >&2
  exit 1
fi

# ── Scan TSX files and check against allow-list ───────────────────────────────
# Uses await import() to dynamically load the pure helper (required for
# --input-type=module inline scripts where static import paths cannot be dynamic).
SCAN_RESULT=$(
  ROOT_DIR="$ROOT_DIR" \
  ALLOWLIST_FILE="$ALLOWLIST_FILE" \
  ALLOWLIST_PURE="$ALLOWLIST_PURE" \
  node --input-type=module <<'NODEEOF'
const { readdirSync, readFileSync } = await import('node:fs');
const { join, relative } = await import('node:path');
const { isInAllowlist, scanImports } = await import('file://' + process.env.ALLOWLIST_PURE);

const rootDir = process.env.ROOT_DIR;

const MONITORED_COMPONENTS = [
  'MetricCard',
  'RunActivityChart',
  'SuccessRateChart',
  'SparkLine',
  'PnlKpiCard',
  'PnlSparkline',
  'PnlTrendChart',
  'SparklineChart',
  'SpendTrendChart',
];

const allowlistText = readFileSync(process.env.ALLOWLIST_FILE, 'utf8');
const allowlist = JSON.parse(allowlistText);

function walkFiles(dir) {
  const results = [];
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return results; }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '__tests__') continue;
      results.push(...walkFiles(full));
    } else if (e.isFile() && e.name.endsWith('.tsx')) {
      if (e.name.endsWith('.test.tsx')) continue;
      results.push(full);
    }
  }
  return results;
}

const violations = [];
let filesScanned = 0;

const absDir = join(rootDir, 'client/src');
for (const fullPath of walkFiles(absDir)) {
  const relPath = relative(rootDir, fullPath).replace(/\\/g, '/');
  filesScanned++;

  let content;
  try { content = readFileSync(fullPath, 'utf8'); } catch { continue; }

  const found = scanImports({ content, components: MONITORED_COMPONENTS });
  if (found.length === 0) continue;

  if (!isInAllowlist({ file: relPath, allowlist })) {
    violations.push({ path: relPath, components: found });
  }
}

const output = { violations, filesScanned };
process.stdout.write(JSON.stringify(output) + '\n');
NODEEOF
)

FILES_SCANNED=$(echo "$SCAN_RESULT" | jq -r '.filesScanned')
VIOLATIONS=0
VIOLATION_KEYS=""

while IFS= read -r entry; do
  [ -z "$entry" ] && continue
  file=$(echo "$entry" | jq -r '.path')
  components=$(echo "$entry" | jq -r '.components | join(", ")')
  key="${file}:0:imports monitored component(s) not in allow-list"
  VIOLATION_KEYS="${VIOLATION_KEYS}${key}"$'\n'
  VIOLATIONS=$((VIOLATIONS + 1))

  emit_violation "$GUARD_ID" "error" "$file" "0" \
    "File imports enterprise/admin component(s) [${components}] but is not in docs/frontend-design-allowlist.json" \
    "Add this file to docs/frontend-design-allowlist.json with a reason field explaining why dashboard density is appropriate"
done < <(echo "$SCAN_RESULT" | jq -c '.violations[]')

VIOLATION_KEYS="${VIOLATION_KEYS%$'\n'}"

BASELINE_EXIT=$(check_expiring_baseline "$GUARD_ID" "$VIOLATION_KEYS")

emit_summary "$FILES_SCANNED" "$VIOLATIONS"

if [ "$BASELINE_EXIT" = "1" ]; then
  exit 1
elif [ "$BASELINE_EXIT" = "2" ] || [ "$VIOLATIONS" -gt 0 ]; then
  exit 2
fi
exit 0
