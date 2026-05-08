#!/usr/bin/env bash
# verify-scorecard-rls.sh — CI gate for Trust & Verification Layer Stage 2.
#
# Asserts that each of the five Stage 2 tables has:
#   (a) a CREATE POLICY statement in its migration file, AND
#   (b) a manifest entry in server/config/rlsProtectedTables.ts pointing at
#       the correct migration file.
#
# Exit codes (per run-all-gates.sh convention):
#   0 — all checks pass
#   1 — one or more tables are missing a policy or manifest entry (blocking)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

FAIL=0

# ── Table → migration map ─────────────────────────────────────────────────────

declare -A TABLE_MIGRATIONS
TABLE_MIGRATIONS=(
  ["scorecards"]="0290_scorecards.sql"
  ["agent_scorecard_attachments"]="0291_agent_scorecard_attachments.sql"
  ["scorecard_judgements"]="0292_scorecard_judgements.sql"
  ["bench_runs"]="0293_bench_runs.sql"
  ["bench_results"]="0293_bench_runs.sql"
)

# ── Check each table ──────────────────────────────────────────────────────────

for table in "${!TABLE_MIGRATIONS[@]}"; do
  migration="${TABLE_MIGRATIONS[$table]}"
  migration_file="$ROOT_DIR/migrations/$migration"

  # (a) Migration file exists and contains CREATE POLICY
  if [ ! -f "$migration_file" ]; then
    echo "[FAIL] Migration file missing: migrations/$migration (required for $table)"
    FAIL=1
    continue
  fi

  if ! grep -q "CREATE POLICY" "$migration_file"; then
    echo "[FAIL] No CREATE POLICY found in migrations/$migration (table: $table)"
    FAIL=1
  fi

  # (b) Manifest entry exists in rlsProtectedTables.ts
  manifest="$ROOT_DIR/server/config/rlsProtectedTables.ts"
  if ! grep -q "'$table'" "$manifest"; then
    echo "[FAIL] Table '$table' not found in server/config/rlsProtectedTables.ts"
    FAIL=1
  fi

  if ! grep -q "'$migration'" "$manifest"; then
    echo "[FAIL] Migration '$migration' not referenced in server/config/rlsProtectedTables.ts for table '$table'"
    FAIL=1
  fi
done

if [ $FAIL -eq 0 ]; then
  echo "[PASS] All Stage 2 scorecard tables have RLS policies and manifest entries."
  exit 0
else
  exit 1
fi
