#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# verify-universal-skill-sync.sh  (P7)
#
# Asserts bidirectional set equality between:
#   - server/config/universalSkills.ts UNIVERSAL_SKILL_NAMES array
#   - server/config/actionRegistry/**  entries where isUniversal: true
#
# Both declarations must mirror each other. If they drift, fix the source —
# no per-finding suppression is accepted (these two lists must stay in sync).
#
# Exit codes:
#   0 — no drift
#   1 — new violation above baseline OR baseline entry past grace period
#   2 — baseline-only violations or within-grace expiry warning
#
# Warning-first rollout promoted to error 2026-05-15 (post-7-day soak from PR #307).
# New violations exit 1 via check_expiring_baseline; baseline-only entries exit 2 (within-grace warning).
# ---------------------------------------------------------------------------

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
GUARD_ID="universal-skill-sync"
GUARD_NAME="Universal Skill Sync (P7)"

source "$SCRIPT_DIR/lib/guard-utils.sh"

emit_header "$GUARD_NAME"

# Delegate to pure helper via Node
RESULT=$(REPO_ROOT="$ROOT_DIR" node --input-type=module <<'NODEEOF'
const { loadUniversalSkillNames, loadActionRegistrySnapshot, diffUniversalSkills } = await import(
  'file://' + process.env.REPO_ROOT + '/scripts/lib/universal-skill-sync-pure.mjs'
);

const names    = loadUniversalSkillNames(process.env.REPO_ROOT);
const registry = loadActionRegistrySnapshot(process.env.REPO_ROOT);
const { onlyInNames, onlyInRegistry } = diffUniversalSkills({ names, registry });

const violations = [];
for (const n of onlyInNames) {
  violations.push(`UNIVERSAL_SKILL_NAMES:0:${n} is in universalSkills.ts but has no isUniversal:true entry in ACTION_REGISTRY`);
}
for (const n of onlyInRegistry) {
  violations.push(`ACTION_REGISTRY:0:${n} has isUniversal:true in ACTION_REGISTRY but is missing from UNIVERSAL_SKILL_NAMES`);
}
process.stdout.write(JSON.stringify(violations));
NODEEOF
)

VIOLATIONS_JSON="$RESULT"

# Parse violations from JSON array via Node
VIOLATION_LINES=$(VIOLATIONS_JSON="$VIOLATIONS_JSON" node --input-type=module <<'NODEEOF'
const list = JSON.parse(process.env.VIOLATIONS_JSON);
process.stdout.write(list.join('\n'));
NODEEOF
)

VIOLATION_COUNT=$(VIOLATIONS_JSON="$VIOLATIONS_JSON" node --input-type=module <<'NODEEOF'
const list = JSON.parse(process.env.VIOLATIONS_JSON);
process.stdout.write(String(list.length));
NODEEOF
)

# Emit each violation
if [ "$VIOLATION_COUNT" -gt 0 ]; then
  while IFS= read -r vline; do
    [ -z "$vline" ] && continue
    # Format: SOURCE:LINE:MSG
    src=$(echo "$vline" | cut -d: -f1)
    lineno=$(echo "$vline" | cut -d: -f2)
    msg=$(echo "$vline" | cut -d: -f3-)
    emit_violation "$GUARD_ID" "warning" "$src" "$lineno" "$msg" \
      "Fix the source: update universalSkills.ts or actionRegistry to match. No suppression — these lists must stay in sync."
  done <<< "$VIOLATION_LINES"
fi

emit_summary "2" "$VIOLATION_COUNT"

exit_code=$(check_expiring_baseline "$GUARD_ID" "$VIOLATION_LINES")
exit "$exit_code"
