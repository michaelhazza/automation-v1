#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# verify-agents-view-in-workflow-routes.sh  (Q6 from Track A2)
#
# Flags any handler in server/routes/workflow*.ts (or server/routes/workflowRuns*.ts)
# that gates on AGENTS_* permissions. Workflow routes should gate on
# WORKFLOW_* permissions (WORKFLOW_RUNS_VIEW, WORKFLOW_RUNS_START,
# WORKFLOW_TEMPLATES_READ, WORKFLOW_STUDIO_ACCESS, etc.).
#
# Origin: WF5, WF8 — `server/routes/workflowRuns.ts` reused AGENTS_VIEW /
# AGENTS_EDIT for org-tier workflow operations because no WORKFLOW_RUNS_VIEW_ALL
# / WORKFLOW_RUNS_ADMIN org-tier perms existed. After Env A lands and migrates
# the routes, this gate should pass with an empty baseline (no flagged uses).
#
# Suppression: if a workflow route legitimately must gate on an agent perm,
# add a same-line `// guard-ignore: agents-view-in-workflow-routes reason="..."`
# comment with a one-line rationale.
#
# Baseline: scripts/.gate-baselines/agents-view-in-workflow-routes.txt seeded
# with the WF5 entries from `server/routes/workflowRuns.ts`. Env A removes
# them; baseline entries become past-grace after 90 days if Env A stalls.
#
# Exit codes:
#   0 — no current violations outside baseline
#   1 — new violation above baseline OR baseline entry past grace period
#   2 — baseline-only violations or within-grace expiry warning
# ---------------------------------------------------------------------------

set -euo pipefail

# --help flag
if [ "${1:-}" = "--help" ]; then
  sed -n '2,/^# ---/p' "$0" | sed -n '1,/^# ---/p'
  exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
GUARD_ID="agents-view-in-workflow-routes"
GUARD_NAME="AGENTS_* perms inside workflow routes (Q6)"

source "$SCRIPT_DIR/lib/guard-utils.sh"

# --list-baseline flag
if [ "${1:-}" = "--list-baseline" ]; then
  BASELINE_FILE="${ROOT_DIR}/scripts/.gate-baselines/${GUARD_ID}.txt"
  if [ -f "$BASELINE_FILE" ]; then
    cat "$BASELINE_FILE"
  else
    echo "(no baseline file at ${BASELINE_FILE})"
  fi
  exit 0
fi

emit_header "$GUARD_NAME"

ROUTES_DIR="$ROOT_DIR/server/routes"

VIOLATIONS=0
VIOLATION_KEYS=""
FILES_SCANNED=0

# Walk every workflow*.ts route file. Match lines that reference an AGENTS_*
# permission constant (AGENTS_VIEW, AGENTS_EDIT, AGENTS_ADMIN, AGENTS_DELETE,
# AGENTS_CREATE, etc.).
while IFS= read -r route_file; do
  [ -z "$route_file" ] && continue
  FILES_SCANNED=$((FILES_SCANNED + 1))

  while IFS= read -r match; do
    [ -z "$match" ] && continue
    lineno=$(echo "$match" | cut -d: -f1)
    line_text=$(echo "$match" | cut -d: -f2-)
    rel_path=$(realpath --relative-to="$ROOT_DIR" "$route_file" 2>/dev/null \
               || echo "$route_file" | sed "s|$ROOT_DIR/||")
    rel_path=$(echo "$rel_path" | sed 's|\\|/|g')

    # Skip if the line (or the previous line) carries a suppression for this gate.
    is_suppressed "$route_file" "$lineno" "$GUARD_ID" && continue

    emit_violation "$GUARD_ID" "error" "$rel_path" "$lineno" \
      "Workflow route gates on AGENTS_* permission — rename to a WORKFLOW_* permission or annotate with guard-ignore" \
      "Switch to a WORKFLOW_* permission (WORKFLOW_RUNS_VIEW, WORKFLOW_RUNS_START, WORKFLOW_TEMPLATES_READ, WORKFLOW_STUDIO_ACCESS, etc.) or suppress with: // guard-ignore: ${GUARD_ID} reason=\"<rationale>\""

    VIOLATION_KEYS="${VIOLATION_KEYS}${rel_path}:${lineno}:Workflow route gates on AGENTS_* permission — rename to a WORKFLOW_* permission or annotate with guard-ignore
"
    VIOLATIONS=$((VIOLATIONS + 1))
  done < <(grep -nE "ORG_PERMISSIONS\.AGENTS_[A-Z_]+|SUBACCOUNT_PERMISSIONS\.AGENTS_[A-Z_]+|\bAGENTS_[A-Z_]+\b" \
             "$route_file" 2>/dev/null || true)
done < <(find "$ROUTES_DIR" -maxdepth 1 -name 'workflow*.ts' -not -name '*.test.ts' 2>/dev/null || true)

VIOLATION_KEYS="${VIOLATION_KEYS%$'\n'}"

emit_summary "$FILES_SCANNED" "$VIOLATIONS"

exit_code=$(check_expiring_baseline "$GUARD_ID" "$VIOLATION_KEYS")
exit "$exit_code"
