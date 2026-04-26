#!/usr/bin/env bash
set -euo pipefail

# Validates role-based access control readiness for Automation OS

classify_and_exit() {
  local severity=$1
  local message=$2
  case $severity in
    OK|PASS) echo "$message"; echo "[GATE] rbac-readiness: violations=0"; exit 0 ;;
    BLOCKING) echo "[BLOCKING] $message"; echo "[GATE] rbac-readiness: violations=1"; exit 1 ;;
    WARNING|WARN) echo "[WARNING] $message"; echo "[GATE] rbac-readiness: violations=0"; exit 2 ;;
    INFO) echo "[INFO] $message"; echo "[GATE] rbac-readiness: violations=0"; exit 3 ;;
    *) echo "[ERROR] Unknown severity: $severity"; echo "[GATE] rbac-readiness: violations=1"; exit 1 ;;
  esac
}

SERVICE="docs/service-contracts.json"
DATA="docs/data-relationships.json"

for f in "$SERVICE" "$DATA"; do
  if [ ! -f "$f" ]; then
    classify_and_exit BLOCKING "Required spec file not found: $f"
  fi
done

# Verify users table has role column
HAS_ROLE_COL=$(jq '[.tables[] | select(.name == "users") | .columns[] | select(.name == "role")] | length' "$DATA")
if [ "$HAS_ROLE_COL" -eq 0 ]; then
  classify_and_exit BLOCKING "users table missing 'role' column"
fi

# Verify role enum exists
ROLE_ENUM=$(jq '[.enums[] | select(.enumName == "user_role")] | length' "$DATA")
if [ "$ROLE_ENUM" -eq 0 ]; then
  classify_and_exit BLOCKING "user_role enum not found in data-relationships.json"
fi

# Verify all 5 required roles exist in the enum
REQUIRED_ROLES=("system_admin" "org_admin" "manager" "user" "client_user")
for role in "${REQUIRED_ROLES[@]}"; do
  found=$(jq --arg r "$role" '[.enums[] | select(.enumName == "user_role") | .allowedValues[] | select(. == $r)] | length' "$DATA")
  if [ "$found" -eq 0 ]; then
    classify_and_exit BLOCKING "user_role enum missing required value: $role"
  fi
done

# Verify endpoints with requiredRole use 'requireRole' middleware
ROLE_ENDPOINTS=$(jq '[.endpoints[] | select(has("requiredRole"))] | length' "$SERVICE")
MISSING_REQUIRE_ROLE=$(jq '[.endpoints[] | select(has("requiredRole") and ((.middleware // []) | index("requireRole") == null))] | length' "$SERVICE")
if [ "$MISSING_REQUIRE_ROLE" -gt 0 ]; then
  classify_and_exit BLOCKING "$MISSING_REQUIRE_ROLE role-restricted endpoints missing 'requireRole' in middleware"
fi

# Verify permission_groups and permission_group_members tables exist (permission group system)
for pg_table in "permission_groups" "permission_group_members" "permission_group_categories"; do
  cnt=$(jq --arg t "$pg_table" '[.tables[] | select(.name == $t)] | length' "$DATA")
  if [ "$cnt" -eq 0 ]; then
    classify_and_exit BLOCKING "Permission group table '$pg_table' not found in data-relationships.json"
  fi
done

classify_and_exit OK "RBAC readiness confirmed. user_role enum with 5 roles. $ROLE_ENDPOINTS role-restricted endpoints. Permission group tables present. requireRole middleware verified."
