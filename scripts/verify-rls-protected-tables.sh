#!/usr/bin/env bash
set -euo pipefail

# verify-rls-protected-tables.sh
#
# Spec: docs/superpowers/specs/2026-04-26-audit-remediation-followups-spec.md §A2
#
# Single gate, three checks:
#
#   1. (Phase 1, blocking)  Schema-vs-registry diff.
#      Walk `migrations/*.sql`, find every `CREATE TABLE` whose body declares
#      an `organisation_id` column, and diff that set against the manifest in
#      `server/config/rlsProtectedTables.ts` and the allowlist
#      `scripts/rls-not-applicable-allowlist.txt`.
#        - In migrations + not in registry + not in allowlist -> fail.
#        - In registry + not in any migration                  -> fail (stale).
#
#   2. (Phase 3 flag-drift, blocking)  `allowRlsBypass: true` justification.
#      Grep `server/` for any `allowRlsBypass:\s*true` literal. Each hit must
#      carry an inline `// allowRlsBypass:` justification comment within +/-1
#      line. Missing comment -> fail.
#
#   3. (Phase 3 write-path coverage, advisory)  Raw `.execute(sql\`...\`)` writes
#      that reference a registered tenant-table name without a same-block
#      `assertRlsAwareWrite(` within +/-10 lines. Emits violations, does NOT
#      affect the exit code (advisory mode per spec §0.1 Gate Quality Bar).
#
# Output: emits the C1 standard `[GATE] rls-protected-tables: violations=<n>`
# count line. Counts include the schema-diff and flag-justification violations
# only — the write-path advisory is reported separately and never increments
# the gate's exit code.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
GUARD_ID="rls-protected-tables"
GUARD_NAME="RLS Protected Tables (schema diff + flag justification + write-path advisory)"

source "$SCRIPT_DIR/lib/guard-utils.sh"

MANIFEST="$ROOT_DIR/server/config/rlsProtectedTables.ts"
ALLOWLIST="$ROOT_DIR/scripts/rls-not-applicable-allowlist.txt"
MIGRATIONS_DIR="$ROOT_DIR/migrations"

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

VIOLATIONS=0
ADVISORY=0

# ── Parse the registry ───────────────────────────────────────────────────────
# Extract the set of tableName values from the manifest.
REGISTRY_TABLES=$(sed -nE "s/.*tableName: *'([^']+)'.*/\1/p" "$MANIFEST" | sort -u)

# ── Parse the allowlist ──────────────────────────────────────────────────────
# Strip comment lines and blank lines; first whitespace-delimited token per row
# is the table name.
ALLOWLIST_TABLES=$(awk '
  /^[[:space:]]*#/ { next }
  /^[[:space:]]*$/ { next }
  { print $1 }
' "$ALLOWLIST" | sort -u)

# ── Parse migrations: find tables with organisation_id ──────────────────────
# Drizzle-emitted `CREATE TABLE "<name>" (` opens a multi-line body terminated
# by `);`. A table is tenant-scoped iff its body contains an `organisation_id`
# column declaration. We accumulate inside the body and emit the table name on
# close if the body matched.
MIGRATION_TABLES_FILE=$(mktemp)
trap 'rm -f "$MIGRATION_TABLES_FILE"' EXIT

# Use awk to walk every .sql file under migrations/ (skip the _down/ subdir).
find "$MIGRATIONS_DIR" -maxdepth 1 -name '*.sql' -print0 |
  while IFS= read -r -d '' migration_file; do
    awk '
      BEGIN { in_table = 0; current = ""; has_org = 0 }
      /^CREATE TABLE[[:space:]]+/ {
        # Extract the table name. Handles both "name" and unquoted forms.
        line = $0
        match(line, /CREATE TABLE[[:space:]]+(IF NOT EXISTS[[:space:]]+)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?/, m)
        if (m[2] != "") {
          in_table = 1
          current = m[2]
          has_org = 0
        }
        next
      }
      in_table == 1 {
        # Match `"organisation_id" <type>` or `organisation_id <type>` at the
        # start of the line (Drizzle indents columns with a tab).
        if ($0 ~ /^[[:space:]]*"?organisation_id"?[[:space:]]+/) {
          has_org = 1
        }
        # Closing paren ends the table body.
        if ($0 ~ /^[[:space:]]*\);/) {
          if (has_org == 1) print current
          in_table = 0
          current = ""
          has_org = 0
        }
      }
    ' "$migration_file" >> "$MIGRATION_TABLES_FILE"
  done

MIGRATION_TABLES=$(sort -u "$MIGRATION_TABLES_FILE")

# ── Check 1: tables in migrations missing from registry + allowlist ─────────
while IFS= read -r table; do
  [ -z "$table" ] && continue
  if echo "$REGISTRY_TABLES" | grep -qx "$table"; then
    continue
  fi
  if echo "$ALLOWLIST_TABLES" | grep -qx "$table"; then
    continue
  fi
  emit_violation "$GUARD_ID" "error" "migrations/" "0" \
    "Table '$table' has organisation_id but is not in rlsProtectedTables.ts and not in rls-not-applicable-allowlist.txt." \
    "Add an RlsProtectedTable entry to server/config/rlsProtectedTables.ts (with a CREATE POLICY in the matching migration), or add '$table' with a one-line rationale to scripts/rls-not-applicable-allowlist.txt."
  VIOLATIONS=$((VIOLATIONS + 1))
done <<< "$MIGRATION_TABLES"

# ── Check 2: registry entries with no matching migration ────────────────────
while IFS= read -r table; do
  [ -z "$table" ] && continue
  if echo "$MIGRATION_TABLES" | grep -qx "$table"; then
    continue
  fi
  emit_violation "$GUARD_ID" "error" "$MANIFEST" "0" \
    "Registry entry '$table' has no matching CREATE TABLE ... organisation_id in any migration." \
    "Remove the stale manifest entry, or add the migration that introduces the table."
  VIOLATIONS=$((VIOLATIONS + 1))
done <<< "$REGISTRY_TABLES"

# ── Check 3: allowRlsBypass: true justification comment ─────────────────────
# Match `allowRlsBypass: true` (with optional whitespace). Each hit must carry
# `// allowRlsBypass:` on the same line, the line above, or the line below.
SERVER_DIR="$ROOT_DIR/server"
if [ -d "$SERVER_DIR" ]; then
  while IFS= read -r match; do
    [ -z "$match" ] && continue
    file=$(echo "$match" | cut -d: -f1)
    lineno=$(echo "$match" | cut -d: -f2)

    # Skip the rlsBoundaryGuard implementation file itself — it defines the
    # option and contains the literal in API/JSDoc strings.
    case "$file" in
      *"server/lib/rlsBoundaryGuard.ts") continue ;;
      *"server/lib/__tests__/rlsBoundaryGuard.test.ts") continue ;;
    esac

    # Look for a justification on the same line, the line above, or below.
    same=$(sed -n "${lineno}p" "$file" 2>/dev/null || true)
    above_no=$((lineno - 1))
    below_no=$((lineno + 1))
    above=""
    below=""
    [ "$above_no" -ge 1 ] && above=$(sed -n "${above_no}p" "$file" 2>/dev/null || true)
    below=$(sed -n "${below_no}p" "$file" 2>/dev/null || true)

    if echo "$same$above$below" | grep -qE "//[[:space:]]*allowRlsBypass:"; then
      continue
    fi

    rel="${file#$ROOT_DIR/}"
    emit_violation "$GUARD_ID" "error" "$rel" "$lineno" \
      "allowRlsBypass: true is missing the inline justification comment." \
      "Add a '// allowRlsBypass: <one-sentence justification naming the cross-org operation>' comment within +/-1 line. Vague justifications ('needed', 'admin work') are not sufficient."
    VIOLATIONS=$((VIOLATIONS + 1))
  done < <(grep -rnE "allowRlsBypass:[[:space:]]*true" "$SERVER_DIR" --include='*.ts' 2>/dev/null || true)
fi

# ── Check 4 (advisory): raw .execute(sql ...) on tenant tables ──────────────
# Advisory only. Emits violations to stderr, never affects exit code.
# Heuristic: for every line containing `.execute(` followed by a `sql` template
# tag in `server/`, check whether that line OR any line within +/-10 lines of
# it mentions any registered tenant-table name. If so, the same +/-10-line
# window must also contain `assertRlsAwareWrite(`. Otherwise emit advisory.
if [ -d "$SERVER_DIR" ]; then
  # Build a regex alternation of registered table names for fast matching.
  TABLES_REGEX=$(echo "$REGISTRY_TABLES" | paste -sd '|' -)

  if [ -n "$TABLES_REGEX" ]; then
    while IFS= read -r match; do
      [ -z "$match" ] && continue
      file=$(echo "$match" | cut -d: -f1)
      lineno=$(echo "$match" | cut -d: -f2)

      # Skip the rlsBoundaryGuard implementation files.
      case "$file" in
        *"server/lib/rlsBoundaryGuard.ts") continue ;;
        *"server/lib/__tests__/rlsBoundaryGuard.test.ts") continue ;;
      esac

      start=$((lineno - 10))
      [ "$start" -lt 1 ] && start=1
      end=$((lineno + 10))
      window=$(sed -n "${start},${end}p" "$file" 2>/dev/null || true)

      # Does the window mention a registered tenant table?
      if ! echo "$window" | grep -qE "\b($TABLES_REGEX)\b"; then
        continue
      fi

      # Is there an assertRlsAwareWrite( call in the same window?
      if echo "$window" | grep -q "assertRlsAwareWrite("; then
        continue
      fi

      rel="${file#$ROOT_DIR/}"
      if [ "${GUARD_OUTPUT:-text}" = "json" ]; then
        jq -nc \
          --arg guard "$GUARD_ID" \
          --arg severity "advisory" \
          --arg file "$rel" \
          --arg line "$lineno" \
          --arg message "Raw .execute(sql ...) near a registered tenant table without a same-block assertRlsAwareWrite() call (advisory)." \
          --arg fix "Either route the write through a Drizzle builder method (.insert / .update / .delete) on a getOrgScopedDb / withAdminConnectionGuarded handle, OR call assertRlsAwareWrite('<table>') within +/-10 lines of the .execute(sql ...) call." \
          '{guard:$guard, severity:$severity, file:$file, line:($line|tonumber), message:$message, fix:$fix}'
      else
        echo "[advisory] $rel:$lineno"
        echo "  Raw .execute(sql ...) near a registered tenant table without a same-block assertRlsAwareWrite() call."
        echo "  -> Route through getOrgScopedDb / withAdminConnectionGuarded, or call assertRlsAwareWrite('<table>') within +/-10 lines."
        echo ""
      fi
      ADVISORY=$((ADVISORY + 1))
    done < <(grep -rnE "\.execute\([[:space:]]*sql" "$SERVER_DIR" --include='*.ts' 2>/dev/null || true)
  fi
fi

# ── Summary ─────────────────────────────────────────────────────────────────
FILES_SCANNED=$(find "$MIGRATIONS_DIR" -maxdepth 1 -name '*.sql' 2>/dev/null | wc -l)

if [ "${GUARD_OUTPUT:-text}" != "json" ] && [ "$ADVISORY" -gt 0 ]; then
  echo "[advisory] write-path coverage: $ADVISORY potential gaps (advisory only — does not affect exit code)"
fi

emit_summary "$FILES_SCANNED" "$VIOLATIONS"

exit_code=$(check_baseline "$GUARD_ID" "$VIOLATIONS" 1)
exit "$exit_code"
