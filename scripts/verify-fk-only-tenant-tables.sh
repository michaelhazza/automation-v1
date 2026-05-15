#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# verify-fk-only-tenant-tables.sh  (Q2 from Track A2)
#
# Flags tables that hold tenant-private data via FK-scope alone but lack
# their own RLS policy. Specifically, a violation is any table that:
#
#   1. Is created via `CREATE TABLE` in migrations/*.sql.
#   2. Does NOT declare an `organisation_id` column in its CREATE TABLE body
#      (so it is not flagged by verify-rls-protected-tables.sh Check 1).
#   3. References a tenant-scoped parent via `REFERENCES "<parent>"` where
#      <parent> is registered in server/config/rlsProtectedTables.ts.
#   4. Has NO `CREATE POLICY ... ON <table>` statement anywhere in
#      migrations/*.sql.
#   5. Is NOT listed under the `# check2-exempt:` section of
#      scripts/rls-not-applicable-allowlist.txt.
#
# Origin: WF1 (workflow_step_runs et al) + SA1 (skill_analyzer_results) — five
# workflow tables and one skill-analyzer table currently hold tenant-private
# payloads with no Postgres-level isolation. The audit found them by grepping
# `migrations/*.sql` for policy statements against the table names.
#
# Suppression: add the table to the `# check2-exempt:` section of
# scripts/rls-not-applicable-allowlist.txt with a one-line rationale, OR add
# the table to scripts/.gate-baselines/fk-only-tenant-tables.txt with an
# expires-date (preferred — forces a follow-up).
#
# Baseline: scripts/.gate-baselines/fk-only-tenant-tables.txt (seeded with
# the currently-known violations from WF1 + SA1; the Env A and Env B PRs
# will drop entries as their migrations land).
#
# Exit codes:
#   0 — no current FK-only tenant-table violations outside baseline
#   1 — new violation above baseline OR baseline entry past grace period
#   2 — baseline-only violations or within-grace expiry warning
#
# Warning-first rollout: ships with default exit code from check_expiring_baseline.
# ---------------------------------------------------------------------------

set -euo pipefail

# --help flag for self-documentation
if [ "${1:-}" = "--help" ]; then
  sed -n '2,/^# ---/p' "$0" | sed -n '1,/^# ---/p'
  exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
GUARD_ID="fk-only-tenant-tables"
GUARD_NAME="FK-Only Tenant Tables Missing RLS Policy (Q2)"

source "$SCRIPT_DIR/lib/guard-utils.sh"

MANIFEST="$ROOT_DIR/server/config/rlsProtectedTables.ts"
ALLOWLIST="$ROOT_DIR/scripts/rls-not-applicable-allowlist.txt"
MIGRATIONS_DIR="$ROOT_DIR/migrations"

# --list-baseline flag prints the current per-file baseline contents.
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

if [ ! -f "$MANIFEST" ]; then
  echo "manifest not found at $MANIFEST" >&2
  exit 1
fi
if [ ! -f "$ALLOWLIST" ]; then
  echo "allowlist not found at $ALLOWLIST" >&2
  exit 1
fi
if [ ! -d "$MIGRATIONS_DIR" ]; then
  echo "migrations dir not found at $MIGRATIONS_DIR" >&2
  exit 1
fi

# ── Parse the registry: set of tenant-scoped parent table names ─────────────
REGISTRY_TABLES=$(sed -nE "s/.*tableName: *'([^']+)'.*/\1/p" "$MANIFEST" | sort -u)

# ── Parse check2-exempt allowlist (tables intentionally FK-scoped + policy) ──
CHECK2_EXEMPT=$(awk '
  /^[[:space:]]*#[[:space:]]*check2-exempt:/ { in_section = 1; next }
  in_section && /^[[:space:]]*#/ { next }
  in_section && /^[[:space:]]*$/ { next }
  in_section { print $1 }
' "$ALLOWLIST" | sort -u)

# ── Walk migrations for CREATE TABLE bodies. For each, record:
#    (a) table name
#    (b) whether it declares an organisation_id column
#    (c) the set of parent tables it references via FK
# ─────────────────────────────────────────────────────────────────────────────
FK_ONLY_TABLES_FILE=$(mktemp)
trap 'rm -f "$FK_ONLY_TABLES_FILE"' EXIT

find "$MIGRATIONS_DIR" -maxdepth 1 -name '*.sql' ! -name '*.down.sql' -print0 |
  while IFS= read -r -d '' migration_file; do
    awk -v registry="$REGISTRY_TABLES" '
      BEGIN {
        in_table = 0; current = ""; has_org = 0; parents = ""
        # Build a set of tenant-scoped parents.
        n = split(registry, arr, "\n")
        for (i = 1; i <= n; i++) reg[arr[i]] = 1
      }
      /^CREATE TABLE[[:space:]]+/ {
        line = $0
        match(line, /CREATE TABLE[[:space:]]+(IF NOT EXISTS[[:space:]]+)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?/, m)
        if (m[2] != "") {
          in_table = 1
          current = m[2]
          has_org = 0
          parents = ""
        }
        next
      }
      in_table == 1 {
        if ($0 ~ /^[[:space:]]*"?organisation_id"?[[:space:]]+/) {
          has_org = 1
        }
        # Match REFERENCES — schema-qualified form "public"."table" first, then plain "table".
        # Drizzle ALTER TABLE uses "public"."table"; inline column REFERENCES use plain "table".
        if (match($0, /REFERENCES[[:space:]]+"?[a-zA-Z_][a-zA-Z0-9_]*"?\."?([a-zA-Z_][a-zA-Z0-9_]*)"?/, fkm)) {
          parent = fkm[1]
        } else if (match($0, /REFERENCES[[:space:]]+"?([a-zA-Z_][a-zA-Z0-9_]*)"?/, fkm)) {
          parent = fkm[1]
        } else {
          parent = ""
        }
        if (parent != "" && parent in reg) {
          if (parents == "") parents = parent
          else parents = parents "," parent
        }
        if ($0 ~ /^[[:space:]]*\);/) {
          # Emit the table when it has no organisation_id but does FK-reference
          # a tenant-scoped parent.
          if (has_org == 0 && parents != "") {
            print current "\t" parents
          }
          in_table = 0; current = ""; has_org = 0; parents = ""
        }
      }
    ' "$migration_file" >> "$FK_ONLY_TABLES_FILE"
  done

# Dedupe — a table can appear in multiple migrations (CREATE TABLE in one,
# ALTER in another). Keep the first FK-bearing CREATE TABLE row.
FK_ONLY_TABLES=$(sort -u "$FK_ONLY_TABLES_FILE")

# ── For each FK-only table, check whether it has a CREATE POLICY anywhere. ──
VIOLATION_KEYS=""
VIOLATIONS=0

while IFS=$'\t' read -r table parents; do
  [ -z "$table" ] && continue

  # Skip tables in the check2-exempt allowlist.
  if [ -n "$CHECK2_EXEMPT" ] && echo "$CHECK2_EXEMPT" | grep -qx "$table"; then
    continue
  fi

  # Grep up migrations only for a CREATE POLICY targeting this table.
  # Handles plain (ON "table"), unquoted (ON table), and schema-qualified
  # (ON "public"."table" or ON public.table) forms.
  policy_table_pattern="(\"?[a-zA-Z_][a-zA-Z0-9_]*\"?\.)?\"?${table}\"?"
  if find "$MIGRATIONS_DIR" -maxdepth 1 -name '*.sql' ! -name '*.down.sql' -print0 | \
       xargs -0 grep -qE "CREATE POLICY[[:space:]]+[^;]+[[:space:]]+ON[[:space:]]+${policy_table_pattern}" 2>/dev/null; then
    continue
  fi

  emit_violation "$GUARD_ID" "error" "migrations/" "0" \
    "Table '$table' is FK-scoped to tenant-protected parent(s) [${parents}] but has no CREATE POLICY in any migration and is not in the check2-exempt allowlist." \
    "Add an EXISTS-based CREATE POLICY in a new migration joining via the FK to the tenant-scoped parent, OR add '$table' to the # check2-exempt: section of scripts/rls-not-applicable-allowlist.txt with a one-line rationale citing the protecting migration."

  VIOLATION_KEYS="${VIOLATION_KEYS}migrations/:0:Table '$table' is FK-scoped to tenant-protected parent(s) [${parents}] but has no CREATE POLICY in any migration and is not in the check2-exempt allowlist.
"
  VIOLATIONS=$((VIOLATIONS + 1))
done <<< "$FK_ONLY_TABLES"

VIOLATION_KEYS="${VIOLATION_KEYS%$'\n'}"

emit_summary "$(find "$MIGRATIONS_DIR" -maxdepth 1 -name '*.sql' ! -name '*.down.sql' | wc -l)" "$VIOLATIONS"

exit_code=$(check_expiring_baseline "$GUARD_ID" "$VIOLATION_KEYS")
exit "$exit_code"
