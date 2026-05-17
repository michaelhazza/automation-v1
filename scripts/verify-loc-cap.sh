#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# verify-loc-cap.sh  (P3)
#
# Invariant: per-layer LoC caps must not grow above the hard cap without an ADR.
#
# Caps (from docs/codebase-audit-framework.md § Area 10):
#   server/services/*.ts          soft=1500  hard=2500
#   server/routes/*.ts            soft=800   hard=1500
#   client/src/pages/*.tsx        soft=600   hard=1200
#   client/src/components/*.tsx   soft=400   hard=800
#   shared/**/*.ts                soft=500   hard=1000
#
# Counting method: wc -l (matches the audit framework's recipe).
#
# Exclusions:
#   server/db/schema/*.ts
#   server/config/rlsProtectedTables.ts
#   *.generated.ts  (filename) OR // AUTO-GENERATED header
#   migrations/*.sql
#   tasks/**   docs/**
#
# Soft cap → exit 2 contribution (warning).
# Hard cap → exit 1 contribution (error), unless the file is in the baseline.
#
# Allow-list growth: if a file crosses the hard cap and is NOT in
#   scripts/.gate-baselines/loc-cap.txt, fail unless the current commit
#   body contains "ADR-" (signals a deliberate architectural decision).
#
# Baseline: scripts/.gate-baselines/loc-cap.txt
#   Format: # expires: YYYY-MM-DD  then  <relpath>:0:<reason>
#
# Exit codes: 0=pass, 1=hard violations above baseline or past-grace expiry, 2=soft/within-baseline/within-grace expiry warning
# Warning-first rollout promoted to error 2026-05-15 (post-7-day soak from PR #307); exit-1 path was already in place for hard-cap regressions.
# ---------------------------------------------------------------------------

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
GUARD_ID="loc-cap"
GUARD_NAME="LoC Cap Gate (P3)"
BASELINE_FILE="${ROOT_DIR}/scripts/.gate-baselines/loc-cap.txt"
LOC_CAP_PURE="${ROOT_DIR}/scripts/lib/loc-cap-pure.mjs"

source "$SCRIPT_DIR/lib/guard-utils.sh"

emit_header "$GUARD_NAME"

# ── Scan files and apply caps via Node (pure helper) ─────────────────────────
# Uses await import() to dynamically load the pure helper (required for
# --input-type=module inline scripts where static import paths cannot be dynamic).
SCAN_RESULT=$(
  ROOT_DIR="$ROOT_DIR" \
  LOC_CAP_PURE="$LOC_CAP_PURE" \
  node --input-type=module <<'NODEEOF'
const { readdirSync, readFileSync } = await import('node:fs');
const { join, relative } = await import('node:path');
const { applyCaps, isGeneratedContent } = await import('file://' + process.env.LOC_CAP_PURE);

const rootDir = process.env.ROOT_DIR;

function walkFiles(dir) {
  const results = [];
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return results; }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '__tests__') continue;
      results.push(...walkFiles(full));
    } else if (e.isFile()) {
      results.push(full);
    }
  }
  return results;
}

const SCAN_DIRS = ['server/services', 'server/routes', 'client/src/pages', 'client/src/components', 'shared'];
const autoGenExclusions = [];
const files = new Map();

for (const scanDir of SCAN_DIRS) {
  const absDir = join(rootDir, scanDir);
  for (const fullPath of walkFiles(absDir)) {
    const relPath = relative(rootDir, fullPath).replace(/\\/g, '/');
    if (relPath.endsWith('.test.ts') || relPath.endsWith('.test.tsx')) continue;
    try {
      const content = readFileSync(fullPath, 'utf8');
      const firstLine = content.split('\n')[0] || '';
      if (isGeneratedContent(firstLine)) {
        autoGenExclusions.push(relPath);
        continue;
      }
      const lineCount = content.split('\n').length;
      files.set(relPath, lineCount);
    } catch { /* skip unreadable */ }
  }
}

const { soft, hard } = applyCaps({ files, exclusions: autoGenExclusions });

const output = {
  soft: soft.map(f => ({ path: f, lines: files.get(f) })),
  hard: hard.map(f => ({ path: f, lines: files.get(f) })),
};
process.stdout.write(JSON.stringify(output) + '\n');
NODEEOF
)

FILES_SCANNED=$(echo "$SCAN_RESULT" | jq -r '(.soft | length) + (.hard | length)')
HARD_COUNT=$(echo "$SCAN_RESULT" | jq -r '.hard | length')
SOFT_COUNT=$(echo "$SCAN_RESULT" | jq -r '.soft | length')

VIOLATIONS=0
VIOLATION_KEYS=""

# ── Hard cap violations ───────────────────────────────────────────────────────
while IFS= read -r entry; do
  [ -z "$entry" ] && continue
  file=$(echo "$entry" | jq -r '.path')
  lines=$(echo "$entry" | jq -r '.lines')
  key="${file}:0:exceeds hard LoC cap"
  VIOLATION_KEYS="${VIOLATION_KEYS}${key}"$'\n'
  VIOLATIONS=$((VIOLATIONS + 1))

  emit_violation "$GUARD_ID" "error" "$file" "0" \
    "File exceeds hard LoC cap: ${lines} lines (consult docs/codebase-audit-framework.md § Area 10)" \
    "Extract pure helper or split by domain noun; ADR required if adding to baseline"
done < <(echo "$SCAN_RESULT" | jq -c '.hard[]')

# ── Soft cap violations (warning) ─────────────────────────────────────────────
while IFS= read -r entry; do
  [ -z "$entry" ] && continue
  file=$(echo "$entry" | jq -r '.path')
  lines=$(echo "$entry" | jq -r '.lines')

  emit_violation "$GUARD_ID" "warning" "$file" "0" \
    "File exceeds soft LoC cap: ${lines} lines (watch this file)" \
    "Consider extracting a *Pure.ts companion or splitting by domain noun before it crosses the hard cap"
done < <(echo "$SCAN_RESULT" | jq -c '.soft[]')

VIOLATION_KEYS="${VIOLATION_KEYS%$'\n'}"

# ── Baseline check ────────────────────────────────────────────────────────────
BASELINE_EXIT=$(check_expiring_baseline "$GUARD_ID" "$VIOLATION_KEYS")

emit_summary "$FILES_SCANNED" "$VIOLATIONS"

# ADR check for new hard-cap files not in baseline
COMMIT_BODY=""
COMMIT_BODY=$(git log -1 --pretty=%B 2>/dev/null || true)

if [ "$BASELINE_EXIT" = "1" ]; then
  if echo "$COMMIT_BODY" | grep -q "ADR-"; then
    echo "[GATE] ${GUARD_ID}: ADR reference found in commit body — new baseline entry accepted" >&2
    exit 2
  fi
  exit 1
elif [ "$BASELINE_EXIT" = "2" ] || [ "$SOFT_COUNT" -gt 0 ]; then
  exit 2
fi
exit 0
