#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# verify-any-budget.sh  (P9)
#
# Invariant: the per-file count of `: any` and `as any` must not grow above
# the baseline seeded at gate-landing.
#
# Non-growing: files may shrink (or stay at zero) without updating the
# baseline. Only growth above the baselined count fails the gate.
#
# Suppression (per-line):
#   // guard-ignore: type-strengthening reason="<rationale, ≤120 chars>"
#   // guard-ignore-next-line: type-strengthening reason="<rationale, ≤120 chars>"
#
# Scope: server/, client/src/, shared/  (*.ts, *.tsx)
# Excludes: __tests__/ directories and *.test.ts files
#
# Exit codes: 0=pass, 1=new violations (count grew), 2=within baseline (warning-first rollout)
# ---------------------------------------------------------------------------

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
GUARD_ID="type-strengthening"
GUARD_NAME="TypeScript any Budget (non-growing)"
BASELINE_FILE="${ROOT_DIR}/scripts/.gate-baselines/any-budget.txt"
PER_FILE_HELPER="${ROOT_DIR}/scripts/lib/per-file-counter-pure.mjs"
DEFAULT_EXIT_CODE=2  # promotion attempt 2026-05-15 reverted: current main exceeds baseline (73 files grew since PR #307 seed), baseline needs re-seeding before promotion. Tracked in tasks/todo.md.

source "$SCRIPT_DIR/lib/guard-utils.sh"

emit_header "$GUARD_NAME"

# ── Count `: any` and `as any` per file, honouring suppressions ──────────────
# Delegate to Node to avoid bash arithmetic and file-reading complexity.

result=$(
  GUARD_ID="$GUARD_ID" \
  BASELINE_FILE="$BASELINE_FILE" \
  PER_FILE_HELPER="$PER_FILE_HELPER" \
  ROOT_DIR="$ROOT_DIR" \
  node --input-type=module <<'NODEEOF'
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
const { countPerFile, diffAgainstBaseline, isSuppressed } = await import(
  'file://' + process.env.PER_FILE_HELPER
);

const rootDir = process.env.ROOT_DIR;
const guardId = process.env.GUARD_ID;
const baselineFile = process.env.BASELINE_FILE;

const SCAN_DIRS = ['server', 'client/src', 'shared'];
const EXTENSIONS = new Set(['.ts', '.tsx']);

function* walkFiles(dir) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === '__tests__' || e.name === 'node_modules') continue;
      yield* walkFiles(full);
    } else if (e.isFile()) {
      const ext = e.name.endsWith('.tsx') ? '.tsx' : e.name.endsWith('.ts') ? '.ts' : '';
      if (!EXTENSIONS.has(ext)) continue;
      if (e.name.endsWith('.test.ts') || e.name.endsWith('.test.tsx')) continue;
      yield full;
    }
  }
}

const fileSet = new Map();
for (const scanDir of SCAN_DIRS) {
  const absDir = join(rootDir, scanDir);
  for (const fullPath of walkFiles(absDir)) {
    const relPath = relative(rootDir, fullPath).replace(/\\/g, '/');
    try {
      fileSet.set(relPath, readFileSync(fullPath, 'utf8'));
    } catch { /* skip unreadable */ }
  }
}

const patterns = [/:\s*any\b/, /\bas\s+any\b/];

const currentCounts = countPerFile({
  patterns,
  fileSet,
  suppressionPredicate: isSuppressed,
  guardId,
});

let baselineText = '';
try { baselineText = readFileSync(baselineFile, 'utf8'); } catch { /* no baseline yet */ }

const violations = diffAgainstBaseline(currentCounts, baselineText);

// Output violations as JSON lines for the shell to parse
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

  emit_violation "$GUARD_ID" "warning" "$file" "0" \
    "': any'/'as any' count grew: ${current} (was ${baseline} in baseline)" \
    "$(format_suppression $GUARD_ID | head -1)"
  VIOLATIONS=$((VIOLATIONS + 1))
done <<< "$result"

FILES_SCANNED=$(echo "$result" | grep -c . || true)

emit_summary "$FILES_SCANNED" "$VIOLATIONS"

if [ "$VIOLATIONS" -gt 0 ]; then
  exit "$DEFAULT_EXIT_CODE"
fi
exit 0
