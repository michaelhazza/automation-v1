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
#
# STATUS (2026-05-17): HELD — baseline file and run-all-gates.sh wiring
# deliberately deferred per spec §13 until W4AA-DEBT-1 (orphan ACTION_REGISTRY
# entries) lands on main and reduces the live mismatch count to 0. Seeding
# the baseline at mismatch-count:0 now would fail CI immediately. A separate
# post-W4AA-DEBT-1 PR will seed the baseline and wire the gate.
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
  SNAPSHOT="$SNAPSHOT" SKILLS_DIR="$SKILLS_DIR" PURE_LIB="${SCRIPT_DIR}/lib/skill-registry-alignment-pure.mjs" \
  node --input-type=module <<'NODEEOF'
import { readFileSync } from 'node:fs';
const { computeMismatches, walkSkillsMd } = await import('file:///' + process.env.PURE_LIB.replace(/\\/g, '/').replace(/^\//, ''));

const snapshot = JSON.parse(readFileSync(process.env.SNAPSHOT, 'utf8').replace(/\r/g, ''));
const skillsDir = process.env.SKILLS_DIR;

const actualFiles = walkSkillsMd(skillsDir);
const rawMismatches = computeMismatches(snapshot, actualFiles);

// Convert to string format expected by the parser below
const mismatches = rawMismatches.map(m => `${m.type}:${m.key}:${m.message}`);
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
