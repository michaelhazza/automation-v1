#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# verify-skill-registry-alignment.sh  (PP-SK1)
#
# Asserts symmetric alignment between ACTION_REGISTRY snapshot keys and
# .md files under server/skills/.
#
# Naming rule (W4AA-DEBT-2): action type X.Y → file X_Y.md (dots → underscores).
#
# Excluded from analysis (non-skill markdown):
#   - server/skills/README.md
#   - server/skills/__tests__/**
#
# Baseline: scripts/.gate-baselines/skill-registry-alignment.txt
#   Format: mismatch-count:<n>
#
# Exit codes: 0 = at or below baseline, 1 = regression (new mismatches)
# ---------------------------------------------------------------------------
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
GUARD_ID="skill-registry-alignment"
BASELINE_FILE="$ROOT_DIR/scripts/.gate-baselines/skill-registry-alignment.txt"
SNAPSHOT="$ROOT_DIR/scripts/snapshots/action-registry.snapshot.json"
SKILLS_DIR="$ROOT_DIR/server/skills"

source "$SCRIPT_DIR/lib/guard-utils.sh"
emit_header "$GUARD_ID"

RESULT=$(
  SNAPSHOT="$SNAPSHOT" SKILLS_DIR="$SKILLS_DIR" \
  node --input-type=module <<'NODEEOF'
import { readFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';

const snapshot = JSON.parse(readFileSync(process.env.SNAPSHOT, 'utf8').replace(/\r/g, ''));
const skillsDir = process.env.SKILLS_DIR;
const registryKeys = Object.keys(snapshot.entries);

// Registry keys → expected filenames
const expectedFromRegistry = new Map(
  registryKeys.map(k => [k.replace(/\./g, '_') + '.md', k])
);

function walkMd(dir) {
  const results = [];
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return results; }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (e.name === '__tests__') continue;
      results.push(...walkMd(join(dir, e.name)));
    } else if (e.isFile() && e.name.endsWith('.md') && e.name !== 'README.md') {
      results.push(e.name);
    }
  }
  return results;
}

const actualFiles = new Set(walkMd(skillsDir));
const mismatches = [];

// Registry keys with no corresponding .md file
for (const [expectedFile, key] of expectedFromRegistry) {
  if (!actualFiles.has(expectedFile)) {
    mismatches.push(`REGISTRY:${key}:registry entry has no .md file (expected server/skills/${expectedFile})`);
  }
}

// .md files with no corresponding registry entry
for (const file of actualFiles) {
  const dotForm  = basename(file, '.md').replace(/_/g, '.');
  const uscore   = basename(file, '.md');
  if (!snapshot.entries[dotForm] && !snapshot.entries[uscore]) {
    mismatches.push(`SKILL_FILE:${file}:.md file has no registry entry (tried: ${dotForm}, ${uscore})`);
  }
}

process.stdout.write(JSON.stringify({ mismatches }));
NODEEOF
)

MISMATCH_COUNT=$(R="$RESULT" node -e \
  "const r=JSON.parse(process.env.R); process.stdout.write(String(r.mismatches.length))")
MISMATCH_LINES=$(R="$RESULT" node -e \
  "const r=JSON.parse(process.env.R); process.stdout.write(r.mismatches.join('\n'))")

if [ "$MISMATCH_COUNT" -gt 0 ]; then
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    src=$(echo "$line" | cut -d: -f1)
    key=$(echo "$line" | cut -d: -f2)
    msg=$(echo "$line" | cut -d: -f3-)
    emit_violation "$GUARD_ID" "error" "$src" "0" "$key: $msg" \
      "Add the missing .md file to server/skills/ or remove the orphan registry entry."
  done <<< "$MISMATCH_LINES"
fi

emit_summary "checked" "$MISMATCH_COUNT"

BASELINE_COUNT=0
if [ -f "$BASELINE_FILE" ]; then
  RAW=$(grep -E '^mismatch-count:[0-9]+$' "$BASELINE_FILE" | head -1 || true)
  [ -n "$RAW" ] && BASELINE_COUNT="${RAW#mismatch-count:}"
fi

echo "Skill registry alignment — current: $MISMATCH_COUNT, baseline: $BASELINE_COUNT"
echo "[GATE] ${GUARD_ID}: violations=${MISMATCH_COUNT}"

if [ "$MISMATCH_COUNT" -gt "$BASELINE_COUNT" ]; then
  echo "Regression: $MISMATCH_COUNT mismatches exceeds baseline of $BASELINE_COUNT" >&2
  exit 1
fi
exit 0
