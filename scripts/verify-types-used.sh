#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# verify-types-used.sh  (P14)
#
# Walks shared/types/*.ts and flags exported types/interfaces/consts that are:
#   (a) NOT imported by any file under server/, client/, or worker/
#   (b) NOT referenced as part of a discriminated union (| TypeName)
#
# Suppression (per-export):
#   // guard-ignore: types-used reason="<rationale>"
#   or the next-line form:
#   // guard-ignore-next-line: types-used reason="<rationale>"
#
# Pre-existing dead exports are baselined at scripts/.gate-baselines/types-used.txt.
# Only NEW unreferenced exports (above baseline) fail.
#
# Explicitly excludes migrations/ per spec §13 Q4.
#
# Exit codes:
#   0 — no unreferenced exports outside baseline
#   1 — new unreferenced exports above baseline OR baseline entry past grace period
#   2 — baseline-only violations or within-grace expiry warning
#
# Warning-first rollout promoted to error 2026-05-15 (post-7-day soak from PR #307).
# New violations exit 1 via check_expiring_baseline; baseline-only entries exit 2 (within-grace warning).
# ---------------------------------------------------------------------------

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
GUARD_ID="types-used"
GUARD_NAME="Types Used (P14)"

source "$SCRIPT_DIR/lib/guard-utils.sh"

emit_header "$GUARD_NAME"

# Delegate to pure helper via Node
RESULT=$(REPO_ROOT="$ROOT_DIR" node --input-type=module <<'NODEEOF'
const { findUnreferencedExports } = await import(
  'file://' + process.env.REPO_ROOT + '/scripts/lib/types-used-pure.mjs'
);

const unreferenced = findUnreferencedExports(process.env.REPO_ROOT);
const violations = unreferenced.map(e => `${e.file}:${e.line}:${e.name} is exported but not referenced in server/, client/, or worker/`);
process.stdout.write(JSON.stringify(violations));
NODEEOF
)

VIOLATIONS_JSON="$RESULT"

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

if [ "$VIOLATION_COUNT" -gt 0 ]; then
  while IFS= read -r vline; do
    [ -z "$vline" ] && continue
    src=$(echo "$vline" | cut -d: -f1)
    lineno=$(echo "$vline" | cut -d: -f2)
    msg=$(echo "$vline" | cut -d: -f3-)
    emit_violation "$GUARD_ID" "warning" "$src" "$lineno" "$msg" \
      "Either import/reference this type from production code, or add: $(format_suppression "$GUARD_ID" | head -1)"
  done <<< "$VIOLATION_LINES"
fi

emit_summary "$(find "$ROOT_DIR/shared/types" -name '*.ts' 2>/dev/null | wc -l | tr -d ' ')" "$VIOLATION_COUNT"

exit_code=$(check_expiring_baseline "$GUARD_ID" "$VIOLATION_LINES")
exit "$exit_code"
