#!/usr/bin/env bash
set -euo pipefail

# verify-rls-session-var-canon.sh
#
# Bans the phantom session variable `app.current_organisation_id` from all
# migrations and server code.
#
# The canonical RLS session variables in this codebase are:
#   app.organisation_id         — set by server/middleware/auth.ts and
#                                  server/lib/createWorker.ts. Used by every
#                                  org-scoped RLS policy (migrations 0079–0081,
#                                  0188, 0200, 0213).
#   app.current_subaccount_id   — set by server/db/withPrincipalContext.ts.
#   app.current_principal_type  — set by server/db/withPrincipalContext.ts.
#   app.current_principal_id    — set by server/db/withPrincipalContext.ts.
#   app.current_team_ids        — set by server/db/withPrincipalContext.ts.
#
# The variable name `app.current_organisation_id` is NEVER set anywhere — it
# was a naming-asymmetry rewrite proposal documented in
# docs/canonical-data-platform-roadmap.md that was explicitly rejected (see
# docs/canonical-data-platform-p1-p2-p3-impl.md §623). Using it in a policy
# silently disables RLS for that policy because `current_setting(..., true)`
# returns NULL when the variable is unset, and the cast / comparison then
# fails closed by returning no rows.
#
# Historical breakage: migrations 0202–0208 and 0212 (the Cached Context
# Infrastructure initial migrations) referenced `app.current_organisation_id`
# and had to be repaired by migration 0213. Migrations 0202–0208/0212 are
# immutable; 0213 supersedes them. The 10 matches in those files are baselined.
#
# This guard prevents any NEW migration or server-side code from regressing
# to the phantom variable.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
GUARD_ID="rls-session-var-canon"
GUARD_NAME="RLS Session Variable Canonical Names"

source "$SCRIPT_DIR/lib/guard-utils.sh"

emit_header "$GUARD_NAME"

VIOLATIONS=0

# ── Historical baseline ───────────────────────────────────────────────────────
# Migrations 0204–0208 and 0212 were authored with the phantom session variable
# before migration 0213 established the canonical name. They are immutable
# (migrations are append-only); migration 0213 repairs the policies at runtime.
# Files in this list are skipped when they also carry a @rls-baseline: comment.
HISTORICAL_BASELINE_FILES=(
  "migrations/0204_document_bundles.sql"
  "migrations/0205_document_bundle_members.sql"
  "migrations/0206_document_bundle_attachments.sql"
  "migrations/0207_bundle_resolution_snapshots.sql"
  "migrations/0208_model_tier_budget_policies.sql"
  "migrations/0212_bundle_suggestion_dismissals.sql"
)
BASELINE_ANNOTATION="@rls-baseline:"

# Returns 0 (true) when the file basename is in HISTORICAL_BASELINE_FILES AND
# the file contains the @rls-baseline: annotation comment.
is_baselined() {
  local file="$1"
  local rel="${file#$ROOT_DIR/}"
  local matched=0
  for entry in "${HISTORICAL_BASELINE_FILES[@]}"; do
    if [ "$rel" = "$entry" ]; then
      matched=1
      break
    fi
  done
  [ "$matched" -eq 0 ] && return 1
  grep -q "$BASELINE_ANNOTATION" "$file" 2>/dev/null && return 0
  return 1
}

# Rule: no reference to current_setting('app.current_organisation_id', ...)
# in any migration .sql file or server-side .ts file.
while IFS= read -r line; do
  [ -z "$line" ] && continue
  file=$(echo "$line" | cut -d: -f1)
  lineno=$(echo "$line" | cut -d: -f2)
  content=$(echo "$line" | cut -d: -f3-)

  rel="${file#$ROOT_DIR/}"

  # Skip baselined historical migrations that carry the @rls-baseline: annotation.
  is_baselined "$file" && continue

  is_suppressed "$file" "$lineno" "$GUARD_ID" && continue

  emit_violation "$GUARD_ID" "error" "$rel" "$lineno" \
    "Uses phantom session var 'app.current_organisation_id' — this variable is never set anywhere." \
    "Replace with current_setting('app.organisation_id', true) (the canonical org session var set by auth.ts / createWorker.ts). See migration 0213 for the canonical RLS pattern."
  VIOLATIONS=$((VIOLATIONS + 1))
done < <(grep -rnE "current_setting\(\s*'app\.current_organisation_id'" \
  "$ROOT_DIR/migrations/" "$ROOT_DIR/server/" \
  --include='*.sql' --include='*.ts' 2>/dev/null || true)

MIGRATION_COUNT=$(find "$ROOT_DIR/migrations/" -name '*.sql' 2>/dev/null | wc -l)
SERVER_COUNT=$(find "$ROOT_DIR/server/" -name '*.ts' -not -path '*/node_modules/*' 2>/dev/null | wc -l)
FILES_SCANNED=$((MIGRATION_COUNT + SERVER_COUNT))

emit_summary "$FILES_SCANNED" "$VIOLATIONS"

exit_code=$(check_baseline "$GUARD_ID" "$VIOLATIONS" 1)
exit "$exit_code"
