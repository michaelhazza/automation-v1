#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# verify-no-db-in-routes.sh
#
# Detects direct database imports in server/routes/**/*.ts files.
# Route handlers must delegate DB queries to server/services/ — not import
# the db handle directly.
#
# BASELINE-GROWTH RULE (P2 tighten — ADR required for new entries):
#   If the current violation count exceeds the baseline count AND the last
#   commit body does not contain an ADR reference ("ADR-"), the gate exits 1
#   (hard fail). Without ADR evidence the gate exits 2 (warning — violations
#   exist but are within the existing baseline).
#
# False-positive exclusion:
#   Lines beginning with "import type" are skipped — type-only imports carry
#   no runtime DB access and are legitimate in route files for typing purposes.
#
# Suppression (co-located on the violating line):
#   // guard-ignore: no-db-in-routes reason="<rationale ≤120 chars>"
#   // guard-ignore-next-line: no-db-in-routes reason="<rationale>"
# ---------------------------------------------------------------------------
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
GUARD_ID="no-db-in-routes"
GUARD_NAME="No Direct DB in Routes"

source "$SCRIPT_DIR/lib/guard-utils.sh"

VIOLATIONS=0
VIOLATION_KEYS=""
FILES_SCANNED=0

emit_header "$GUARD_NAME"

while IFS= read -r line; do
  file=$(echo "$line" | cut -d: -f1)
  lineno=$(echo "$line" | cut -d: -f2)
  content=$(echo "$line" | cut -d: -f3-)

  # Skip import type lines — type-only imports carry no runtime DB access.
  if echo "$content" | grep -qE '^\s*import\s+type\s+'; then
    continue
  fi

  # Check for a bare guard-ignore that mentions this guard but lacks required T1 shape or legacy shape
  current_line=$(sed -n "${lineno}p" "$file" 2>/dev/null || true)
  if echo "$current_line" | grep -qE "guard-ignore.*${GUARD_ID}" && ! is_suppressed "$file" "$lineno" "$GUARD_ID"; then
    emit_violation "$GUARD_ID" "error" "$file" "$lineno" \
      "Malformed guard-ignore: must be T1 format (guard-ignore ${GUARD_ID}: <ADR-id> <rationale>) or legacy (guard-ignore: ${GUARD_ID} reason=\"...\")" \
      "Fix the suppression comment to match the required format"
    VIOLATIONS=$((VIOLATIONS + 1))
    rel_path="${file#$ROOT_DIR/}"
    VIOLATION_KEYS="${VIOLATION_KEYS}${rel_path}:${lineno}:direct db import in route handler
"
    continue
  fi

  is_suppressed "$file" "$lineno" "$GUARD_ID" && continue

  rel_path="${file#$ROOT_DIR/}"
  emit_violation "$GUARD_ID" "warning" "$file" "$lineno" \
    "$content" \
    "Move database queries to a service in server/services/"
  VIOLATIONS=$((VIOLATIONS + 1))
  VIOLATION_KEYS="${VIOLATION_KEYS}${rel_path}:${lineno}:direct db import in route handler
"
done < <(grep -rn "import.*db.*from.*['\"].*\/db" "$ROOT_DIR/server/routes/" --include='*.ts' 2>/dev/null || true)

FILES_SCANNED=$(find "$ROOT_DIR/server/routes/" -name '*.ts' -not -path '*/node_modules/*' | wc -l)

emit_summary "$FILES_SCANNED" "$VIOLATIONS"

# ── Baseline check with ADR-required growth guard ───────────────────────────
# Use the expiring baseline file (.gate-baselines/no-db-in-routes.txt).
# If violations grew above baseline, require an ADR reference in the commit.
exit_code=$(check_expiring_baseline "$GUARD_ID" "$VIOLATION_KEYS")

if [ "$exit_code" = "1" ]; then
  # New violations found above baseline — check for ADR in commit body.
  commit_body=$(git log -1 --pretty=%B 2>/dev/null || echo "")
  if echo "$commit_body" | grep -qE "ADR-[0-9a-zA-Z-]+"; then
    # ADR documented — demote to warning (exit 2).
    echo "[GATE] no-db-in-routes: baseline growth documented via ADR — treating as warning" >&2
    exit 2
  else
    echo "[GATE] no-db-in-routes: new violations above baseline require an ADR reference in the commit body" >&2
    exit 1
  fi
fi

exit "$exit_code"
